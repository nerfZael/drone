import React from 'react';
import { requestJson } from '../http';
import { provisioningLabel, usePaneReadiness } from '../panes/usePaneReadiness';
import { createEnvDraftEntry, envDraftEntriesToMap, envValueEntriesToDraftEntries, validateEnvDraftEntries, type EnvDraftEntry } from './env-utils';
import { DotenvImportSection } from './DotenvImportSection';
import { EnvEditorRows } from './EnvEditorRows';
import { useEnvDraftImport } from './useEnvDraftImport';

type DroneEnvPayload = {
  ok: true;
  id: string;
  kind: 'real' | 'pending';
  name: string;
  runtime: 'container' | 'host';
  repoPath: string;
  repoLabel: string;
  repoRegistered: boolean;
  repoEntries: Array<{ key: string; value: string; source: 'repo' }>;
  useRepoVars: boolean;
  disabledRepoKeys: string[];
  customEntries: Array<{ key: string; value: string; source: 'drone' }>;
  resolvedEntries: Array<{ key: string; value: string; source: 'repo' | 'drone' }>;
  updatedAt: string | null;
  repoUpdatedAt: string | null;
  autoApplyToNewContainerDrones: boolean;
};

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function areEnvMapsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aEntries = Object.entries(a).sort(([left], [right]) => left.localeCompare(right));
  const bEntries = Object.entries(b).sort(([left], [right]) => left.localeCompare(right));
  if (aEntries.length !== bEntries.length) return false;
  for (let i = 0; i < aEntries.length; i += 1) {
    const [aKey, aValue] = aEntries[i]!;
    const [bKey, bValue] = bEntries[i]!;
    if (aKey !== bKey || aValue !== bValue) return false;
  }
  return true;
}

function AppliedSourceBadge({ source }: { source: 'repo' | 'drone' }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase ${
        source === 'repo'
          ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
          : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--fg-secondary)]'
      }`}
      style={{ fontFamily: 'var(--display)' }}
    >
      {source === 'repo' ? 'Repo' : 'Custom'}
    </span>
  );
}

export function DroneEnvDock({
  droneId,
  droneName,
  disabled,
  hubPhase,
  hubMessage,
}: {
  droneId: string;
  droneName: string;
  disabled: boolean;
  hubPhase?: 'creating' | 'starting' | 'seeding' | 'error' | null;
  hubMessage?: string | null;
}) {
  const startup = usePaneReadiness({
    hubPhase,
    resetKey: `${droneId}\u0000env`,
    timeoutMs: 18_000,
  });
  const [data, setData] = React.useState<DroneEnvPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveNotice, setSaveNotice] = React.useState<string | null>(null);
  const [useRepoVars, setUseRepoVars] = React.useState(false);
  const [disabledRepoKeys, setDisabledRepoKeys] = React.useState<string[]>([]);
  const [customEntries, setCustomEntries] = React.useState<EnvDraftEntry[]>([]);
  const { importText, setImportText, importFromText, importFromFile } = useEnvDraftImport({
    setEntries: setCustomEntries,
    setNotice: setSaveNotice,
    importedMessage: (count) => `${count} variable${count === 1 ? '' : 's'} imported into custom env.`,
  });
  const provisioningText = String(hubMessage ?? '').trim() || provisioningLabel(hubPhase);

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const payload = await requestJson<DroneEnvPayload>(`/api/drones/${encodeURIComponent(droneId)}/env`);
      setData(payload);
      setUseRepoVars(payload.useRepoVars);
      setDisabledRepoKeys(payload.disabledRepoKeys);
      setCustomEntries(envValueEntriesToDraftEntries(payload.customEntries));
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [droneId]);

  const validationError = React.useMemo(() => validateEnvDraftEntries(customEntries), [customEntries]);
  const repoEntries = data?.repoEntries ?? [];
  const disabledRepoKeySet = React.useMemo(() => new Set(disabledRepoKeys), [disabledRepoKeys]);
  const activeRepoEntries = React.useMemo(
    () => repoEntries.filter((entry) => !disabledRepoKeySet.has(entry.key)),
    [disabledRepoKeySet, repoEntries],
  );
  const excludedRepoEntries = React.useMemo(
    () => repoEntries.filter((entry) => disabledRepoKeySet.has(entry.key)),
    [disabledRepoKeySet, repoEntries],
  );
  const customVarMap = React.useMemo(() => envDraftEntriesToMap(customEntries), [customEntries]);
  const persistedCustomVarMap = React.useMemo(
    () => Object.fromEntries((data?.customEntries ?? []).map((entry) => [entry.key, entry.value])),
    [data],
  );
  const persistedDisabledRepoKeys = React.useMemo(
    () => [...(data?.disabledRepoKeys ?? [])].sort((a, b) => a.localeCompare(b)),
    [data],
  );
  const normalizedDisabledRepoKeys = React.useMemo(
    () => [...disabledRepoKeys].sort((a, b) => a.localeCompare(b)),
    [disabledRepoKeys],
  );
  const isDirty = React.useMemo(() => {
    if (!data) return false;
    return (
      useRepoVars !== data.useRepoVars ||
      !areStringArraysEqual(normalizedDisabledRepoKeys, persistedDisabledRepoKeys) ||
      !areEnvMapsEqual(customVarMap, persistedCustomVarMap)
    );
  }, [customVarMap, data, normalizedDisabledRepoKeys, persistedCustomVarMap, persistedDisabledRepoKeys, useRepoVars]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (isDirty || saving) return;
    const timer = window.setInterval(() => {
      void load({ silent: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isDirty, load, saving]);

  const appliedEntries = React.useMemo(() => {
    const combined: Array<{ key: string; value: string; source: 'repo' | 'drone' }> = [];
    if (useRepoVars) {
      for (const entry of activeRepoEntries) {
        if (entry.key in customVarMap) continue;
        combined.push(entry);
      }
    }
    for (const [key, value] of Object.entries(customVarMap).sort(([a], [b]) => a.localeCompare(b))) {
      combined.push({ key, value, source: 'drone' });
    }
    return combined;
  }, [activeRepoEntries, customVarMap, useRepoVars]);

  const updateEntry = React.useCallback((id: string, field: 'key' | 'value', value: string) => {
    setCustomEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)));
  }, []);

  const save = React.useCallback(async () => {
    if (validationError) {
      setSaveNotice(validationError);
      return;
    }
    setSaving(true);
    try {
      const payload = await requestJson<DroneEnvPayload>(`/api/drones/${encodeURIComponent(droneId)}/env`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          useRepoVars,
          disabledRepoKeys,
          vars: customVarMap,
        }),
      });
      setData(payload);
      setUseRepoVars(payload.useRepoVars);
      setDisabledRepoKeys(payload.disabledRepoKeys);
      setCustomEntries(envValueEntriesToDraftEntries(payload.customEntries));
      setSaveNotice('Environment updated.');
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }, [customVarMap, disabledRepoKeys, droneId, useRepoVars, validationError]);

  return (
    <div className="w-full h-full bg-[var(--panel-alt)] overflow-auto">
      <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.12em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Env
          </div>
          <div className="text-[11px] text-[var(--muted-dim)] truncate" title={droneName}>
            {droneName}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || Boolean(validationError)}
          className={`h-8 rounded border px-3 text-[10px] font-semibold tracking-wide uppercase ${
            saving || validationError
              ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted-dim)]'
              : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
          }`}
          style={{ fontFamily: 'var(--display)' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="px-3 py-3 flex flex-col gap-3 text-[11px]">
        {disabled ? (
          <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 py-2 text-[var(--muted-dim)]">
            {provisioningText}
          </div>
        ) : null}
        {loading ? (
          <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 py-3 text-[var(--muted-dim)]">
            Loading environment…
          </div>
        ) : null}
        {startup.waiting && !loading ? (
          <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 py-2 text-[var(--muted-dim)]">
            {startup.timedOut ? 'Environment may still be syncing.' : provisioningText}
          </div>
        ) : null}
        {error ? (
          <div className="rounded border border-[rgba(248,81,73,.2)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--red)]">
            {error}
          </div>
        ) : null}
        {saveNotice ? (
          <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 py-2 text-[var(--muted)]">
            {saveNotice}
          </div>
        ) : null}
        {data ? (
          <>
            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                    Repository Scope
                  </div>
                  <div className="text-[12px] text-[var(--fg-secondary)] truncate" title={data.repoPath || data.repoLabel}>
                    {data.repoLabel}
                  </div>
                  {data.repoPath ? (
                    <div className="text-[10px] text-[var(--muted-dim)] font-mono truncate" title={data.repoPath}>
                      {data.repoPath}
                    </div>
                  ) : null}
                </div>
                <label className="inline-flex items-center gap-2 text-[11px] text-[var(--fg-secondary)]">
                  <input
                    type="checkbox"
                    checked={useRepoVars}
                    onChange={(event) => setUseRepoVars(event.target.checked)}
                    disabled={saving}
                  />
                  Use repo envs
                </label>
              </div>
              <div className="text-[10px] text-[var(--muted-dim)]">
                Repo defaults for new container drones are {data.autoApplyToNewContainerDrones ? 'enabled' : 'disabled'}.
              </div>
            </div>

            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-3 flex flex-col gap-2">
              <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                Applied Variables
              </div>
              {appliedEntries.length === 0 ? (
                <div className="text-[var(--muted-dim)]">No environment variables are currently applied.</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {appliedEntries.map((entry) => (
                    <div key={`applied-${entry.source}-${entry.key}`} className="grid grid-cols-[auto_minmax(0,180px)_minmax(0,1fr)] gap-2 items-center">
                      <AppliedSourceBadge source={entry.source} />
                      <span className="font-mono text-[11px] text-[var(--fg-secondary)] truncate">{entry.key}</span>
                      <span className="font-mono text-[11px] text-[var(--muted-dim)] truncate" title={entry.value}>
                        {entry.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {repoEntries.length > 0 ? (
              <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-3 flex flex-col gap-2">
                <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                  Repository Variables
                </div>
                {activeRepoEntries.length === 0 ? (
                  <div className="text-[var(--muted-dim)]">No active repo variables.</div>
                ) : (
                  activeRepoEntries.map((entry) => (
                    <div key={`repo-${entry.key}`} className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] gap-2 items-center">
                      <span className="font-mono text-[11px] text-[var(--fg-secondary)] truncate">{entry.key}</span>
                      <span className="font-mono text-[11px] text-[var(--muted-dim)] truncate" title={entry.value}>
                        {entry.value}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDisabledRepoKeys((prev) => (prev.includes(entry.key) ? prev : [...prev, entry.key].sort()))}
                        disabled={!useRepoVars || saving}
                        className={`h-8 rounded border px-3 text-[10px] font-semibold tracking-wide uppercase ${
                          !useRepoVars || saving
                            ? 'cursor-not-allowed border-[var(--border-subtle)] text-[var(--muted-dim)]'
                            : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
                        }`}
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        Exclude
                      </button>
                    </div>
                  ))
                )}
                {excludedRepoEntries.length > 0 ? (
                  <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-2">
                    <div className="text-[10px] text-[var(--muted-dim)] uppercase tracking-wide" style={{ fontFamily: 'var(--display)' }}>
                      Excluded From This Drone
                    </div>
                    {excludedRepoEntries.map((entry) => (
                      <div key={`excluded-${entry.key}`} className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] gap-2 items-center opacity-80">
                        <span className="font-mono text-[11px] text-[var(--fg-secondary)] truncate">{entry.key}</span>
                        <span className="font-mono text-[11px] text-[var(--muted-dim)] truncate" title={entry.value}>
                          {entry.value}
                        </span>
                        <button
                          type="button"
                          onClick={() => setDisabledRepoKeys((prev) => prev.filter((key) => key !== entry.key))}
                          disabled={saving}
                          className={`h-8 rounded border px-3 text-[10px] font-semibold tracking-wide uppercase ${
                            saving
                              ? 'cursor-not-allowed border-[var(--border-subtle)] text-[var(--muted-dim)]'
                              : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-3 flex flex-col gap-3">
              <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                Custom Variables
              </div>
              <EnvEditorRows
                entries={customEntries}
                disabled={saving}
                emptyMessage="No custom environment variables yet."
                onChange={updateEntry}
                onRemove={(id) => setCustomEntries((prev) => prev.filter((entry) => entry.id !== id))}
                onAdd={() => setCustomEntries((prev) => [...prev, createEnvDraftEntry()])}
              />
              <DotenvImportSection
                title="Import .env Contents"
                description="Paste `.env` contents here or import a file. Matching keys update existing rows."
                importText={importText}
                onImportTextChange={setImportText}
                onImportText={importFromText}
                onImportFile={importFromFile}
                disabled={saving}
                placeholder={'Paste .env contents here\nAPI_KEY=secret\nDEBUG=true'}
                containerClassName="pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-2"
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
