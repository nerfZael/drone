import React from 'react';
import type {
  ChatWorkspaceAccess,
  ChatWorkspaceCatalog,
  ChatWorkspaceOption,
} from '@drone/assistant-chat';
import { subscribeDesktopEvents } from '../app/desktop-events';
import { subscribeDeviceMeshChanges } from '../app/device-mesh-events';
import { IconChevron, IconSpinner } from '../icons';
import {
  WORKSPACE_CATEGORIES,
  toggleWorkspace,
  workspaceAccessSignature,
  workspaceCategory,
  workspaceOptionMeta,
} from './workspace-access-model';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

const PERMISSIONS = [
  { key: 'read', label: 'R', name: 'Read' },
  { key: 'write', label: 'W', name: 'Write' },
  { key: 'execute', label: 'X', name: 'Execute' },
] as const;

const AUTO_COLLAPSE_CATEGORY_SIZE = 6;
const REFRESH_DEBOUNCE_MS = 400;
const SAVE_DEBOUNCE_MS = 300;

function catalogUrl(threadId: string, deviceId?: string): string {
  const base = `/api/assistant/threads/${encodeURIComponent(threadId)}/workspaces`;
  return deviceId ? `${base}?deviceId=${encodeURIComponent(deviceId)}` : base;
}

/**
 * Per-thread workspace picker. Lists everything the device running the chat can
 * reach: its own repositories, folders, and drones, plus folders other devices
 * shared with it. Changes save on their own, like the rest of the popover.
 */
export function AssistantWorkspacePicker({
  requestJson,
  threadId,
  disabled = false,
  onSelectionChange,
}: {
  requestJson: RequestJson;
  threadId: string;
  disabled?: boolean;
  onSelectionChange?: (selectedCount: number) => void;
}) {
  const [catalog, setCatalog] = React.useState<ChatWorkspaceCatalog | null>(null);
  const [draft, setDraft] = React.useState<ChatWorkspaceAccess | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [categoryToggles, setCategoryToggles] = React.useState<Set<string>>(new Set());
  const [loaded, setLoaded] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState<Set<string>>(new Set());
  const [query, setQuery] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const alive = React.useRef(true);
  const loadedRef = React.useRef<Set<string>>(new Set());
  const draftRef = React.useRef<ChatWorkspaceAccess | null>(null);
  const catalogRef = React.useRef<ChatWorkspaceCatalog | null>(null);
  const savingRef = React.useRef(false);
  const savePendingRef = React.useRef(false);
  const saveTimerRef = React.useRef<number | null>(null);
  loadedRef.current = loaded;
  draftRef.current = draft;
  catalogRef.current = catalog;
  const dirty = Boolean(
    catalog &&
    draft &&
    workspaceAccessSignature(catalog.access) !== workspaceAccessSignature(draft),
  );
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  const locked = disabled || initialLoading;
  const selectedCount = draft?.targets.length ?? 0;
  const needsDefault = Boolean(draft && draft.targets.length > 0 && !draft.defaultTargetId);

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    onSelectionChange?.(selectedCount);
  }, [onSelectionChange, selectedCount]);

  /** Reloads one device's shared folders in place; unsaved edits are untouched. */
  const loadDevice = React.useCallback(
    async (deviceId: string) => {
      setLoading((current) => new Set(current).add(deviceId));
      try {
        const result = await requestJson<ChatWorkspaceCatalog>(catalogUrl(threadId, deviceId));
        if (!alive.current) return;
        setCatalog((current) =>
          current
            ? {
                ...current,
                workspaces: [
                  ...current.workspaces.filter((option) => option.deviceId !== deviceId),
                  ...result.workspaces.filter((option) => option.deviceId === deviceId),
                ],
                devices: current.devices.map((device) =>
                  device.id === deviceId
                    ? (result.devices.find((item) => item.id === deviceId) ?? device)
                    : device,
                ),
              }
            : current,
        );
        setLoaded((current) => new Set(current).add(deviceId));
      } catch (loadError: any) {
        if (!alive.current) return;
        setCatalog((current) =>
          current
            ? {
                ...current,
                devices: current.devices.map((device) =>
                  device.id === deviceId
                    ? { ...device, error: loadError?.message ?? String(loadError) }
                    : device,
                ),
              }
            : current,
        );
      } finally {
        if (alive.current)
          setLoading((current) => {
            const next = new Set(current);
            next.delete(deviceId);
            return next;
          });
      }
    },
    [requestJson, threadId],
  );

  /**
   * Reloads the base catalog plus every device already expanded. The saved
   * selection updates underneath, but edits still being saved stay as they are.
   */
  const reload = React.useCallback(
    async (mode: 'initial' | 'manual' | 'silent') => {
      if (mode === 'initial') setInitialLoading(true);
      if (mode === 'manual') setRefreshing(true);
      if (mode !== 'silent') setError(null);
      try {
        const result = await requestJson<ChatWorkspaceCatalog>(catalogUrl(threadId));
        if (!alive.current) return;
        const previouslyLoaded =
          mode === 'initial' ? new Set<string>() : new Set(loadedRef.current);
        const baseDevices = new Set(result.workspaces.map((workspace) => workspace.deviceId));
        setCatalog((current) =>
          current && mode !== 'initial'
            ? {
                ...result,
                workspaces: [
                  ...result.workspaces,
                  ...current.workspaces.filter(
                    (option) =>
                      !baseDevices.has(option.deviceId) && previouslyLoaded.has(option.deviceId),
                  ),
                ],
              }
            : result,
        );
        setDraft((current) => (current && dirtyRef.current ? current : result.access));
        setLoaded(new Set([...baseDevices, ...previouslyLoaded]));
        if (mode === 'initial') {
          const others = result.devices.filter((device) => !baseDevices.has(device.id));
          setCollapsed(new Set(others.slice(1).map((device) => device.id)));
          const first = others[0];
          if (first && !first.error) void loadDevice(first.id);
        } else {
          for (const deviceId of previouslyLoaded) {
            if (!baseDevices.has(deviceId)) void loadDevice(deviceId);
          }
        }
      } catch (loadError: any) {
        if (alive.current && mode !== 'silent') setError(loadError?.message ?? String(loadError));
      } finally {
        if (alive.current) {
          setInitialLoading(false);
          setRefreshing(false);
        }
      }
    },
    [loadDevice, requestJson, threadId],
  );

  React.useEffect(() => {
    void reload('initial');
  }, [reload]);

  // Live refresh: this Hub's own drone and repo changes arrive as registry
  // events; other devices announce shared-folder policy changes over the mesh.
  React.useEffect(() => {
    const timers = new Map<string, number>();
    const schedule = (key: string, run: () => void) => {
      const existing = timers.get(key);
      if (existing != null) window.clearTimeout(existing);
      timers.set(
        key,
        window.setTimeout(() => {
          timers.delete(key);
          run();
        }, REFRESH_DEBOUNCE_MS),
      );
    };
    const refreshBase = () => schedule('base', () => void reload('silent'));
    const unsubscribeRegistry = subscribeDesktopEvents({
      handlers: { registry_snapshot: refreshBase, registry_delta: refreshBase },
    });
    const unsubscribeMesh = subscribeDeviceMeshChanges(() => undefined, {
      onCapabilityEvent(event) {
        if (event.capability !== 'workspace' || event.event !== 'workspaces.changed') return;
        const deviceId = event.sourceDeviceId;
        if (loadedRef.current.has(deviceId))
          schedule(`device:${deviceId}`, () => void loadDevice(deviceId));
      },
    });
    return () => {
      unsubscribeRegistry();
      unsubscribeMesh();
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, [loadDevice, reload]);

  // Edits save on their own. Rapid clicks coalesce, a save in flight queues one
  // more, and a rejected save falls back to what the hub last accepted.
  const flushSave = React.useCallback(async () => {
    const current = draftRef.current;
    const base = catalogRef.current;
    if (!current || !base) return;
    if (workspaceAccessSignature(current) === workspaceAccessSignature(base.access)) return;
    if (current.targets.length > 0 && !current.defaultTargetId) return;
    if (savingRef.current) {
      savePendingRef.current = true;
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const sent = workspaceAccessSignature(current);
    try {
      const result = await requestJson<ChatWorkspaceCatalog>(catalogUrl(threadId), {
        method: 'POST',
        body: JSON.stringify({ access: current, revision: base.revision }),
      });
      if (!alive.current) return;
      setCatalog((existing) =>
        existing ? { ...existing, access: result.access, revision: result.revision } : result,
      );
      // Only adopt the hub's normalized copy if nothing changed meanwhile.
      setDraft((latest) =>
        latest && workspaceAccessSignature(latest) === sent ? result.access : latest,
      );
    } catch (saveError: any) {
      if (!alive.current) return;
      setError(saveError?.message ?? String(saveError));
      setDraft(base.access);
      if (/changed elsewhere/i.test(String(saveError?.message ?? ''))) void reload('silent');
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
      if (savePendingRef.current) {
        savePendingRef.current = false;
        void flushSave();
      }
    }
  }, [reload, requestJson, threadId]);

  const updateDraft = React.useCallback(
    (change: (current: ChatWorkspaceAccess) => ChatWorkspaceAccess) => {
      setDraft((current) => (current ? change(current) : current));
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void flushSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  const options = new Map<string, ChatWorkspaceOption>();
  for (const target of draft?.targets ?? []) options.set(target.id, target);
  for (const option of catalog?.workspaces ?? []) options.set(option.id, option);
  const search = query.trim().toLowerCase();

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5">
        <input
          aria-label="Search workspaces"
          className="h-6 min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-2 text-[var(--text-10)] text-[var(--fg)] outline-none placeholder:text-[var(--muted-dim)] focus:border-[var(--accent-muted)]"
          placeholder="Search workspaces"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="text-[var(--text-9)] text-[var(--muted-dim)]">
          {saving ? 'Saving…' : needsDefault ? 'Star a default' : ''}
        </span>
        <button
          type="button"
          aria-label="Refresh workspaces"
          title="Refresh"
          disabled={refreshing || initialLoading}
          onClick={() => void reload('manual')}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-40"
        >
          {refreshing ? (
            <IconSpinner className="h-3 w-3 animate-spin" />
          ) : (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.6h-2.6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>

      {error ? (
        <div className="border-b border-[var(--border-subtle)] px-3 py-1.5 text-[var(--text-10)] text-[var(--red)]">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {initialLoading && !catalog ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[var(--text-10)] text-[var(--muted)]">
            <IconSpinner className="h-3 w-3 animate-spin" />
            Loading workspaces…
          </div>
        ) : null}
        {catalog?.devices.map((device) => {
          const selected = draft?.targets.filter((target) => target.deviceId === device.id) ?? [];
          const rows = [...options.values()].filter(
            (option) =>
              option.deviceId === device.id &&
              (!search ||
                `${device.name} ${option.name} ${option.path ?? ''} ${option.runtime ?? ''}`
                  .toLowerCase()
                  .includes(search)),
          );
          if (search && rows.length === 0) return null;
          const open = Boolean(search) || !collapsed.has(device.id);
          const isLoading = loading.has(device.id);
          const isLoaded = loaded.has(device.id);
          return (
            <div key={device.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => {
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(device.id)) next.delete(device.id);
                    else next.add(device.id);
                    return next;
                  });
                  if (!open && !isLoaded && !isLoading) void loadDevice(device.id);
                }}
                className="flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-[var(--hover)]"
              >
                <IconChevron down={open} className="text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)]">
                  {device.name}
                </span>
                {isLoading ? (
                  <IconSpinner className="h-3 w-3 animate-spin text-[var(--muted)]" />
                ) : null}
                {selected.length > 0 ? (
                  <span className="text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--accent)]">
                    {selected.length} selected
                  </span>
                ) : null}
              </button>
              {open ? (
                <div className="pb-1">
                  {device.error ? (
                    <div className="flex items-center gap-2 px-3 py-1.5 text-[var(--text-10)] text-[var(--muted)]">
                      <span className="min-w-0 flex-1">{device.error}</span>
                      <button
                        type="button"
                        onClick={() => void loadDevice(device.id)}
                        className="text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--accent)]"
                      >
                        Retry
                      </button>
                    </div>
                  ) : null}
                  {isLoaded && rows.length === 0 && !device.error ? (
                    <div className="px-3 py-1.5 text-[var(--text-10)] text-[var(--muted)]">
                      {search
                        ? 'No matching workspaces.'
                        : 'Nothing shared with this chat. Share folders with this Hub in the other device’s settings.'}
                    </div>
                  ) : null}
                  {WORKSPACE_CATEGORIES.map((category) => {
                    const entries = rows.filter((row) => workspaceCategory(row) === category);
                    if (entries.length === 0) return null;
                    const categoryKey = `${device.id}:${category}`;
                    const selectedInCategory = entries.filter((entry) =>
                      selected.some((target) => target.id === entry.id),
                    ).length;
                    const collapsedByDefault =
                      (category === 'Container drones' || category === 'Host drones') &&
                      entries.length > AUTO_COLLAPSE_CATEGORY_SIZE &&
                      selectedInCategory === 0;
                    const categoryOpen =
                      Boolean(search) || categoryToggles.has(categoryKey) !== collapsedByDefault;
                    return (
                      <div key={category}>
                        <button
                          type="button"
                          aria-expanded={categoryOpen}
                          onClick={() =>
                            setCategoryToggles((current) => {
                              const next = new Set(current);
                              if (next.has(categoryKey)) next.delete(categoryKey);
                              else next.add(categoryKey);
                              return next;
                            })
                          }
                          className="flex h-6 w-full items-center gap-1.5 px-3 text-left hover:bg-[var(--hover)]"
                        >
                          <span className="min-w-0 flex-1 truncate text-[var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]">
                            {category} · {entries.length}
                            {selectedInCategory > 0 ? ` · ${selectedInCategory} selected` : ''}
                          </span>
                          <IconChevron
                            down={categoryOpen}
                            size={10}
                            className="text-[var(--muted-dim)]"
                          />
                        </button>
                        {categoryOpen
                          ? entries.map((option) => {
                              const target = selected.find((item) => item.id === option.id);
                              const available = catalog.workspaces.some(
                                (item) => item.id === option.id,
                              );
                              const isDefault = draft?.defaultTargetId === option.id;
                              const selectable =
                                !locked &&
                                (Boolean(target) ||
                                  (available && (option.read || option.write || option.execute)));
                              return (
                                <div
                                  key={option.id}
                                  className={`flex items-center gap-2 pl-3 pr-2 ${target ? 'bg-[var(--surface-softest)]' : ''}`}
                                >
                                  <label
                                    className={`flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 py-1 ${selectable || target ? '' : 'cursor-default opacity-45'}`}
                                  >
                                    <input
                                      type="checkbox"
                                      aria-label={`${option.name}, ${workspaceOptionMeta(option)}`}
                                      checked={Boolean(target)}
                                      disabled={!selectable}
                                      onChange={() =>
                                        updateDraft((current) => toggleWorkspace(current, option))
                                      }
                                      className="h-3.5 w-3.5 flex-shrink-0 accent-[var(--accent)]"
                                    />
                                    <span className="min-w-0">
                                      <span className="block truncate text-[var(--text-11)] font-medium text-[var(--fg-secondary)]">
                                        {option.name}
                                      </span>
                                      <span className="block truncate text-[var(--text-9)] text-[var(--muted-dim)]">
                                        {available ? workspaceOptionMeta(option) : 'Unavailable'}
                                      </span>
                                    </span>
                                  </label>
                                  {target ? (
                                    <div className="flex flex-shrink-0 items-center gap-1">
                                      {PERMISSIONS.map((permission) => {
                                        const on = target[permission.key];
                                        const offered = available && option[permission.key];
                                        if (!on && !offered) return null;
                                        const chipLocked = locked || (!on && !offered);
                                        return (
                                          <button
                                            key={permission.key}
                                            type="button"
                                            role="checkbox"
                                            aria-checked={on}
                                            aria-label={`${permission.name} access to ${option.name}`}
                                            title={permission.name}
                                            disabled={chipLocked}
                                            onClick={() =>
                                              updateDraft((current) => {
                                                const next = { ...target, [permission.key]: !on };
                                                if (!next.read && !next.write && !next.execute)
                                                  return toggleWorkspace(current, option);
                                                return {
                                                  ...current,
                                                  targets: current.targets.map((item) =>
                                                    item.id === option.id ? next : item,
                                                  ),
                                                };
                                              })
                                            }
                                            className={`h-5 w-5 rounded text-[var(--text-8)] font-[var(--weight-semibold)] disabled:opacity-40 ${
                                              on
                                                ? 'bg-[var(--accent)] text-[var(--on-accent,#11111b)]'
                                                : 'bg-[var(--surface-strong)] text-[var(--muted)] hover:bg-[var(--hover)]'
                                            }`}
                                          >
                                            {permission.label}
                                          </button>
                                        );
                                      })}
                                      <button
                                        type="button"
                                        role="radio"
                                        aria-checked={isDefault}
                                        aria-label={`Use ${option.name} as the default workspace`}
                                        title={isDefault ? 'Default workspace' : 'Use as default'}
                                        disabled={locked || isDefault}
                                        onClick={() =>
                                          updateDraft((current) => ({
                                            ...current,
                                            defaultTargetId: option.id,
                                          }))
                                        }
                                        className={`flex h-5 w-5 items-center justify-center rounded ${
                                          isDefault
                                            ? 'text-[var(--yellow)]'
                                            : 'text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--fg)]'
                                        }`}
                                      >
                                        <svg
                                          width="11"
                                          height="11"
                                          viewBox="0 0 16 16"
                                          fill={isDefault ? 'currentColor' : 'none'}
                                          aria-hidden="true"
                                        >
                                          <path
                                            d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
                                            stroke="currentColor"
                                            strokeWidth="1.3"
                                            strokeLinejoin="round"
                                          />
                                        </svg>
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })
                          : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
        {catalog && selectedCount === 0 && !initialLoading ? (
          <div className="px-3 py-2 text-[var(--text-10)] text-[var(--muted-dim)]">
            No workspace selected.
          </div>
        ) : null}
      </div>
    </div>
  );
}
