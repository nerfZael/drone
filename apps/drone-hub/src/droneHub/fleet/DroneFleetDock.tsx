import React from 'react';
import { requestJson } from '../http';
import {
  FLEET_ASSIGNMENT_UPDATED_EVENT,
  normalizeFleetAssignmentUpdatedDetail,
  type FleetAssignmentUpdatedDetail,
} from '../app/fleet-assignment-events';
import type { FleetActorPayload } from './fleet-api';
import { provisioningLabel, usePaneReadiness } from '../panes/usePaneReadiness';

type FleetAuditPayload = {
  ok: true;
  items: Array<{
    id: string;
    at: string;
    actor: string;
    actorName: string;
    action: string;
    target: string | null;
    targetName: string | null;
    status: string;
    reason: string | null;
    meta?: Record<string, unknown>;
  }>;
};

type FleetQuotaState = {
  maxChildren: string;
  maxCreationsPerHour: string;
  maxPendingCreationsGlobal: string;
  maxMessagesPerMinute: string;
  maxMessageSizeBytes: string;
  maxReadPageSize: string;
  defaultReadPageSize: string;
  maxReadChars: string;
};

type FleetPolicyDraftState = {
  enabled: boolean;
  capabilities: Record<'drone:create' | 'drone:message:send' | 'drone:message:read', boolean>;
  readScopes: Record<'children' | 'assigned' | 'self', boolean>;
  quotas: FleetQuotaState;
};

type FleetAuditItem = FleetAuditPayload['items'][number];

function formatWhen(iso: string): string {
  const ms = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(ms)) return String(iso ?? '');
  return new Date(ms).toLocaleString();
}

function formatActionLabel(actionRaw: string): string {
  const action = String(actionRaw ?? '').trim();
  if (action === 'create_child') return 'Create child';
  if (action === 'send_message') return 'Send message';
  if (action === 'stop_chat') return 'Stop chat';
  if (action === 'read_messages') return 'Read messages';
  return action.replace(/_/g, ' ') || 'Activity';
}

function activitySubjectLabel(item: FleetAuditItem): string {
  return String(item.targetName ?? '').trim() || String(item.actorName ?? '').trim() || 'Unknown drone';
}

function activityMetaRows(item: FleetAuditItem): Array<{ label: string; value: string }> {
  const meta = item.meta ?? {};
  const rows: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: unknown) => {
    const text = String(value ?? '').trim();
    if (!text) return;
    rows.push({ label, value: text });
  };

  push('Actor', item.actorName);
  push('Target', item.targetName);
  push('Reason', item.reason);
  push('Chat', meta.chat);
  push('Group', meta.group);
  push('Prompt ID', meta.promptId);
  push('Pending state', meta.pendingState);
  if (meta.returned != null) push('Returned', `${meta.returned} messages`);
  if (meta.returnedChars != null) push('Returned chars', meta.returnedChars);
  if (meta.truncated != null) push('Truncated', meta.truncated ? 'Yes' : 'No');
  push('Request ID', meta.requestId);

  return rows;
}

function activityMessagePreview(item: FleetAuditItem): string | null {
  const preview = String(item.meta?.messagePreview ?? '').trim();
  return preview || null;
}

function quotaStateFromPayload(data: FleetActorPayload | null): FleetQuotaState {
  return {
    maxChildren: String(data?.limits.maxChildren ?? 5),
    maxCreationsPerHour: String(data?.limits.maxCreationsPerHour ?? 10),
    maxPendingCreationsGlobal: String(data?.limits.maxPendingCreationsGlobal ?? 50),
    maxMessagesPerMinute: String(data?.limits.maxMessagesPerMinute ?? 30),
    maxMessageSizeBytes: String(data?.limits.maxMessageSizeBytes ?? 8192),
    maxReadPageSize: String(data?.limits.maxReadPageSize ?? 50),
    defaultReadPageSize: String(data?.limits.defaultReadPageSize ?? 20),
    maxReadChars: String(data?.limits.maxReadChars ?? 32000),
  };
}

function policyDraftStateFromPayload(data: FleetActorPayload | null): FleetPolicyDraftState {
  return {
    enabled: data?.config.enabled ?? false,
    capabilities: {
      'drone:create': data ? Boolean(data.config.capabilities.includes('drone:create')) : true,
      'drone:message:send': data ? Boolean(data.config.capabilities.includes('drone:message:send')) : true,
      'drone:message:read': data ? Boolean(data.config.capabilities.includes('drone:message:read')) : true,
    },
    readScopes: {
      children: Boolean(data?.config.readScopes.includes('children') ?? true),
      assigned: Boolean(data?.config.readScopes.includes('assigned')),
      self: Boolean(data?.config.readScopes.includes('self')),
    },
    quotas: quotaStateFromPayload(data),
  };
}

function serializePolicyDraftState(state: FleetPolicyDraftState): string {
  return JSON.stringify(state);
}

function parseQuotaPayload(quotas: FleetQuotaState): { ok: true; value: Record<string, number> } | { ok: false; error: string } {
  const parsed: Record<string, number> = {};
  for (const [key, value] of Object.entries(quotas)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return { ok: false, error: `${key} must be a valid number.` };
    }
    parsed[key] = numeric;
  }
  return { ok: true, value: parsed };
}

function isUnknownDroneError(error: unknown): boolean {
  const status = Number((error as any)?.status ?? 0);
  const message = String((error as any)?.message ?? error ?? '');
  return status === 404 && /unknown drone/i.test(message);
}

function isTransientFetchError(error: unknown): boolean {
  const message = String((error as any)?.message ?? error ?? '').trim().toLowerCase();
  return message === 'failed to fetch' || message.includes('networkerror');
}

export function DroneFleetDock({
  droneId,
  droneName,
  disabled,
  hubPhase,
  hubMessage,
}: {
  droneId: string;
  droneName: string;
  disabled: boolean;
  hubPhase?: 'draft' | 'creating' | 'starting' | 'seeding' | 'error' | null;
  hubMessage?: string | null;
}) {
  const startup = usePaneReadiness({
    hubPhase,
    resetKey: `${droneId}\u0000fleet`,
    timeoutMs: 18_000,
  });
  const [data, setData] = React.useState<FleetActorPayload | null>(null);
  const [audit, setAudit] = React.useState<FleetAuditPayload['items']>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [capabilities, setCapabilities] = React.useState<Record<string, boolean>>({
    'drone:create': true,
    'drone:message:send': true,
    'drone:message:read': true,
  });
  const [readScopes, setReadScopes] = React.useState<Record<string, boolean>>({
    children: true,
    assigned: false,
    self: false,
  });
  const [quotas, setQuotas] = React.useState<FleetQuotaState>(() => quotaStateFromPayload(null));
  const [selectedTargetId, setSelectedTargetId] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [assigning, setAssigning] = React.useState(false);
  const [pollingDisabled, setPollingDisabled] = React.useState(false);
  const [expandedAuditIds, setExpandedAuditIds] = React.useState<Record<string, boolean>>({});
  const hasDataRef = React.useRef(false);
  const dirtyRef = React.useRef(false);
  const latestSaveSeqRef = React.useRef(0);
  const [lastSyncedPolicyKey, setLastSyncedPolicyKey] = React.useState(() =>
    serializePolicyDraftState(policyDraftStateFromPayload(null)),
  );
  const assignableTargets = (data?.availableTargets ?? []).filter((target) => !target.assigned);
  const currentPolicyKey = React.useMemo(
    () =>
      serializePolicyDraftState({
        enabled,
        capabilities,
        readScopes,
        quotas,
      }),
    [capabilities, enabled, quotas, readScopes],
  );
  const policyDirty = currentPolicyKey !== lastSyncedPolicyKey;

  React.useEffect(() => {
    hasDataRef.current = Boolean(data);
  }, [data]);

  React.useEffect(() => {
    dirtyRef.current = policyDirty;
  }, [policyDirty]);

  React.useEffect(() => {
    setPollingDisabled(false);
    setSaveError(null);
    setExpandedAuditIds({});
  }, [droneId]);

  const load = React.useCallback(async () => {
    if (pollingDisabled) return;
    setLoading(true);
    try {
      const [actor, auditResp] = await Promise.all([
        requestJson<FleetActorPayload>(`/api/fleet/actors/${encodeURIComponent(droneId)}`),
        requestJson<FleetAuditPayload>(`/api/fleet/audit?actor=${encodeURIComponent(droneId)}&limit=30`),
      ]);
      setData(actor);
      setAudit(auditResp.items ?? []);
      setError(null);
      startup.markReady();
    } catch (err: any) {
      if (isUnknownDroneError(err)) {
        setPollingDisabled(true);
        setData(null);
        setAudit([]);
        setError('Selected drone is no longer available.');
        return;
      }
      if (hasDataRef.current && isTransientFetchError(err)) {
        setError('Fleet connection lost. Showing last known data.');
        return;
      }
      if (!startup.suppressErrors) setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [droneId, pollingDisabled, startup]);

  React.useEffect(() => {
    let timer: any = null;
    void load();
    if (pollingDisabled) return;
    timer = setInterval(() => {
      void load();
    }, 3000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [load, pollingDisabled]);

  React.useEffect(() => {
    const onFleetAssignmentUpdated = (event: Event) => {
      const detail = normalizeFleetAssignmentUpdatedDetail(
        (event as CustomEvent<FleetAssignmentUpdatedDetail | null>).detail,
      );
      if (!detail || detail.ownerDroneId !== droneId) return;
      setData(detail.actor);
      setError(null);
    };
    window.addEventListener(FLEET_ASSIGNMENT_UPDATED_EVENT, onFleetAssignmentUpdated as EventListener);
    return () => {
      window.removeEventListener(FLEET_ASSIGNMENT_UPDATED_EVENT, onFleetAssignmentUpdated as EventListener);
    };
  }, [droneId]);

  React.useEffect(() => {
    if (!data) return;
    const nextPolicy = policyDraftStateFromPayload(data);
    setLastSyncedPolicyKey(serializePolicyDraftState(nextPolicy));
    if (!dirtyRef.current) {
      setEnabled(nextPolicy.enabled);
      setCapabilities(nextPolicy.capabilities);
      setReadScopes(nextPolicy.readScopes);
      setQuotas(nextPolicy.quotas);
    }
    setSelectedTargetId((prev) => {
      if (prev && data.availableTargets.some((item) => item.id === prev && !item.assigned)) return prev;
      return data.availableTargets.find((item) => !item.assigned)?.id ?? '';
    });
  }, [data]);

  const submitConfig = React.useCallback(async (draft: FleetPolicyDraftState) => {
    const parsedQuotas = parseQuotaPayload(draft.quotas);
    if (!parsedQuotas.ok) {
      setSaveError(parsedQuotas.error);
      return;
    }
    const saveSeq = latestSaveSeqRef.current + 1;
    latestSaveSeqRef.current = saveSeq;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await requestJson<FleetActorPayload>(`/api/fleet/actors/${encodeURIComponent(droneId)}/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: draft.enabled,
          capabilities: Object.entries(draft.capabilities)
            .filter(([, value]) => value)
            .map(([key]) => key),
          readScopes: Object.entries(draft.readScopes)
            .filter(([, value]) => value)
            .map(([key]) => key),
          quotas: parsedQuotas.value,
        }),
      });
      if (saveSeq !== latestSaveSeqRef.current) return;
      setData(next);
    } catch (err: any) {
      if (saveSeq !== latestSaveSeqRef.current) return;
      setSaveError(err?.message ?? String(err));
    } finally {
      if (saveSeq === latestSaveSeqRef.current) setSaving(false);
    }
  }, [droneId]);

  React.useEffect(() => {
    if (!data || !policyDirty) return;
    const parsedQuotas = parseQuotaPayload(quotas);
    if (!parsedQuotas.ok) {
      setSaveError(parsedQuotas.error);
      return;
    }
    if (saveError) setSaveError(null);
    const timer = setTimeout(() => {
      void submitConfig({
        enabled,
        capabilities,
        readScopes,
        quotas,
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [capabilities, data, enabled, policyDirty, quotas, readScopes, saveError, submitConfig]);

  const addAssignment = React.useCallback(async () => {
    if (!selectedTargetId) return;
    setAssigning(true);
    setSaveError(null);
    try {
      const next = await requestJson<FleetActorPayload>(`/api/fleet/actors/${encodeURIComponent(droneId)}/assigned`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: selectedTargetId }),
      });
      setData(next);
    } catch (err: any) {
      setSaveError(err?.message ?? String(err));
    } finally {
      setAssigning(false);
    }
  }, [droneId, selectedTargetId]);

  const removeAssignment = React.useCallback(
    async (targetId: string) => {
      setAssigning(true);
      setSaveError(null);
      try {
        const next = await requestJson<FleetActorPayload>(
          `/api/fleet/actors/${encodeURIComponent(droneId)}/assigned/${encodeURIComponent(targetId)}`,
          { method: 'DELETE' },
        );
        setData(next);
      } catch (err: any) {
        setSaveError(err?.message ?? String(err));
      } finally {
        setAssigning(false);
      }
    },
    [droneId],
  );

  const capabilityToggle = (key: 'drone:create' | 'drone:message:send' | 'drone:message:read') =>
    setCapabilities((prev) => ({ ...prev, [key]: !prev[key] }));
  const readScopeToggle = (key: 'children' | 'assigned' | 'self') => setReadScopes((prev) => ({ ...prev, [key]: !prev[key] }));
  const policyStatusText = saveError ? 'Save failed' : saving ? 'Saving…' : policyDirty ? 'Pending save' : 'Saved';

  return (
    <div className="w-full h-full overflow-auto bg-[var(--panel-alt)]">
      <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            Fleet
          </div>
          <div className="text-[11px] text-[var(--muted)]">{droneName}</div>
        </div>
        <div className="text-[10px] text-[var(--muted-dim)] font-mono">{data?.apiVersion ?? 'loading'}</div>
      </div>

      <div className="p-3 flex flex-col gap-3 text-[11px]">
        {startup.waiting && (
          <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 py-2 text-[var(--muted)]">
            {provisioningLabel(hubPhase)} fleet surface…
            {hubMessage ? ` ${hubMessage}` : ''}
          </div>
        )}
        {hubPhase === 'error' && hubMessage && <div className="rounded border border-[var(--red)]/40 bg-[var(--red-subtle)] px-3 py-2 text-[var(--red)]">{hubMessage}</div>}
        {error && !startup.suppressErrors && <div className="rounded border border-[var(--red)]/40 bg-[var(--red-subtle)] px-3 py-2 text-[var(--red)]">{error}</div>}
        {saveError && <div className="rounded border border-[var(--red)]/40 bg-[var(--red-subtle)] px-3 py-2 text-[var(--red)]">{saveError}</div>}

        {!data && loading && <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-2 text-[var(--muted)]">Loading fleet policy…</div>}

        {data && (
          <>
            <section className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
              <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3">
                <div className="font-medium text-[var(--fg)]">Policy</div>
                <label className="inline-flex items-center gap-2 text-[var(--muted)]">
                  <input type="checkbox" checked={enabled} onChange={() => setEnabled((prev) => !prev)} />
                  Fleet enabled
                </label>
              </div>
              <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Capabilities</div>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={capabilities['drone:create']} onChange={() => capabilityToggle('drone:create')} /> Create children</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={capabilities['drone:message:send']} onChange={() => capabilityToggle('drone:message:send')} /> Send messages</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={capabilities['drone:message:read']} onChange={() => capabilityToggle('drone:message:read')} /> Read messages</label>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Read scopes</div>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={readScopes.children} onChange={() => readScopeToggle('children')} /> Children</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={readScopes.assigned} onChange={() => readScopeToggle('assigned')} /> Assigned</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={readScopes.self} onChange={() => readScopeToggle('self')} /> Self</label>
                </div>
              </div>
              <div className="px-3 pb-3">
                <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] mb-2">Limits</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Object.entries(quotas).map(([key, value]) => (
                    <label key={key} className="flex flex-col gap-1">
                      <span className="text-[10px] text-[var(--muted-dim)]">{key}</span>
                      <input
                        className="rounded border border-[var(--border-subtle)] bg-[var(--panel)] px-2 py-1 text-[11px]"
                        value={value}
                        onChange={(event) => setQuotas((prev) => ({ ...prev, [key]: event.target.value }))}
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-[10px] text-[var(--muted-dim)]">
                    Usage: {data.usage.childrenCount} children, {data.usage.messagesLastMinute} msgs/min, {data.usage.creationsLastHour} creates/hour
                  </div>
                  <div className="text-[10px] text-[var(--muted-dim)]">{policyStatusText}</div>
                </div>
              </div>
            </section>

            <section className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
              <div className="px-3 py-2 border-b border-[var(--border-subtle)] font-medium text-[var(--fg)]">Relationships</div>
              <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] mb-2">Children</div>
                  <div className="flex flex-col gap-1">
                    {data.relationships.children.length === 0 && <div className="text-[var(--muted-dim)]">No children yet</div>}
                    {data.relationships.children.map((child) => (
                      <div key={child.id} className="flex items-center justify-between gap-2 rounded border border-[var(--border-subtle)] px-2 py-1">
                        <span className="truncate">{child.name}</span>
                        <span className="text-[10px] text-[var(--muted-dim)] font-mono">{child.kind === 'pending' ? child.phase || 'pending' : 'ready'}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] mb-2">Assigned</div>
                  <div className="flex gap-2 mb-2">
                    <select
                      className="min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--panel)] px-2 py-1"
                      value={selectedTargetId}
                      onChange={(event) => setSelectedTargetId(event.target.value)}
                    >
                      {assignableTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!selectedTargetId || assigning}
                      onClick={() => void addAssignment()}
                      className="rounded border border-[var(--border-strong)] px-3 py-1 hover:bg-[rgba(255,255,255,.04)] disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {data.relationships.assigned.length === 0 && <div className="text-[var(--muted-dim)]">No assigned drones</div>}
                    {data.relationships.assigned.map((target) => (
                      <div key={target.id} className="flex items-center justify-between gap-2 rounded border border-[var(--border-subtle)] px-2 py-1">
                        <span className="truncate">{target.name}</span>
                        <button
                          type="button"
                          onClick={() => void removeAssignment(target.id)}
                          className="text-[var(--muted-dim)] hover:text-[var(--fg)]"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
              <div className="px-3 py-2 border-b border-[var(--border-subtle)] font-medium text-[var(--fg)]">Activity</div>
              <div className="p-3 flex flex-col gap-2">
                {loading && audit.length === 0 && <div className="text-[var(--muted-dim)]">Loading fleet activity…</div>}
                {!loading && audit.length === 0 && <div className="text-[var(--muted-dim)]">No fleet events yet</div>}
                {audit.map((item) => {
                  const expanded = Boolean(expandedAuditIds[item.id]);
                  const detailRows = activityMetaRows(item);
                  const messagePreview = activityMessagePreview(item);
                  return (
                    <div key={item.id} className="rounded border border-[var(--border-subtle)] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setExpandedAuditIds((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                        className="w-full px-2.5 py-2 text-left transition-colors hover:bg-[rgba(255,255,255,.04)] focus:outline-none focus:bg-[rgba(255,255,255,.04)]"
                      >
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1 flex items-center gap-2 text-[11px]">
                            <span className="font-medium text-[var(--fg)]">{formatActionLabel(item.action)}</span>
                            <span className="text-[var(--muted)] truncate">{activitySubjectLabel(item)}</span>
                            <span className="text-[10px] text-[var(--muted-dim)] whitespace-nowrap">{formatWhen(item.at)}</span>
                          </div>
                          <div className={`text-[10px] uppercase tracking-[0.08em] ${item.status === 'accepted' ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                            {item.status}
                          </div>
                        </div>
                      </button>
                      {expanded && (
                        <div className="border-t border-[var(--border-subtle)] px-2.5 py-2 bg-[rgba(255,255,255,.02)] flex flex-col gap-2">
                          {messagePreview && (
                            <div>
                              <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Message</div>
                              <div className="mt-1 rounded border border-[var(--border-subtle)] bg-[var(--panel)] px-2 py-1.5 text-[11px] text-[var(--fg)] whitespace-pre-wrap break-words">
                                {messagePreview}
                              </div>
                            </div>
                          )}
                          {detailRows.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5">
                              {detailRows.map((row) => (
                                <div key={`${item.id}-${row.label}`} className="min-w-0 flex items-baseline gap-2">
                                  <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] whitespace-nowrap">{row.label}</span>
                                  <span className="text-[11px] text-[var(--muted)] break-all">{row.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {disabled && <div className="text-[10px] text-[var(--muted-dim)]">Daemon transport is currently unavailable. Policy changes still persist and will sync when the drone is reachable again.</div>}
          </>
        )}
      </div>
    </div>
  );
}
