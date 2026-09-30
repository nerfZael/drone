import React from 'react';
import type { ChatWorkspaceAccess, ChatWorkspaceCatalog, ChatWorkspaceOption } from '@drone/assistant-chat';
import { subscribeDesktopEvents } from '../app/desktop-events';
import { subscribeDeviceMeshChanges } from '../app/device-mesh-events';
import { IconSpinner } from '../icons';
import {
  WORKSPACE_CATEGORIES,
  addWorkspace,
  removeWorkspace,
  setPermission,
  workspaceAccessSignature,
  workspaceCategory,
  workspaceOptionMeta,
  type Permission,
} from './workspace-access-model';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

const PERMISSIONS: { key: Permission; label: string; name: string }[] = [
  { key: 'read', label: 'Read', name: 'Read' },
  { key: 'write', label: 'Write', name: 'Write' },
  { key: 'execute', label: 'Run', name: 'Run commands' },
];
const PERMISSION_HELP: Record<Permission, string> = {
  read: 'Read files. Off removes the workspace.',
  write: 'Edit files; includes Read.',
  execute: 'Run commands; includes Read. Commands can change files and reach anything the workspace can.',
};
const GRID = 'grid grid-cols-[minmax(0,1fr)_52px_52px_52px_60px] items-center';
const DRONE_CAP = 5;
const MATCH_LIMIT = 6;
const REFRESH_DEBOUNCE_MS = 400;
const SAVE_DEBOUNCE_MS = 300;

/** The last catalog each picker saw, so reopening shows it at once while a fresh one loads. */
const lastCatalogs = new Map<string, ChatWorkspaceCatalog>();

const catalogUrl = (base: string, deviceId?: string) => (deviceId ? `${base}?deviceId=${encodeURIComponent(deviceId)}` : base);
const offeredBy = (option: ChatWorkspaceOption | undefined, granted?: ChatWorkspaceOption): Record<Permission, boolean> => ({
  // A workspace that is gone from the catalog can still have what it had taken away, never more given.
  read: option ? option.read : Boolean(granted?.read),
  write: option ? option.write : Boolean(granted?.write),
  execute: option ? option.execute : Boolean(granted?.execute),
});

/**
 * Chooses which workspaces an assistant may use, and what each allows. "In use" is a grid of what is selected: click
 * or drag across Read, Write and Run, pick the default, and add more by typing a name. "All workspaces" is a
 * checklist of everything reachable (this device's repositories, folders and drones, and folders other devices
 * share) to add from. Changes save on their own.
 */
export function WorkspaceAccessPicker({
  requestJson,
  endpoint,
  disabled = false,
  onSelectionChange,
  onBusyChange,
  home,
  initialAccess,
}: {
  requestJson: RequestJson;
  /** The catalog: GET lists workspaces and the selection, POST {access, revision} saves it. */
  endpoint: string;
  disabled?: boolean;
  onSelectionChange?: (selectedCount: number) => void;
  onBusyChange?: (busy: boolean) => void;
  /** An always-available workspace shown as a locked first row (the Companion's home, the entity's home folder). */
  home?: { name: string; note: string; onOpen?: () => void };
  /** The selection as the caller already knows it, shown at once instead of waiting for the catalog. */
  initialAccess?: ChatWorkspaceAccess;
}) {
  const [catalog, setCatalog] = React.useState<ChatWorkspaceCatalog | null>(() => lastCatalogs.get(endpoint) ?? null);
  const [draft, setDraft] = React.useState<ChatWorkspaceAccess | null>(() => initialAccess ?? lastCatalogs.get(endpoint)?.access ?? null);
  const [mode, setMode] = React.useState<'inuse' | 'all'>('inuse');
  // One search field beside the tabs: under In use it finds workspaces to add, under All workspaces it filters.
  const [query, setQuery] = React.useState('');
  const [allDrones, setAllDrones] = React.useState(false);
  const [loaded, setLoaded] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [initialLoading, setInitialLoading] = React.useState(() => !lastCatalogs.has(endpoint));
  // Rows turned off while the picker is open stay where they were, faded, so nothing moves under the pointer.
  const [gone, setGone] = React.useState<ChatWorkspaceOption[]>([]);
  const alive = React.useRef(true);
  const loadedRef = React.useRef<Set<string>>(new Set());
  const draftRef = React.useRef<ChatWorkspaceAccess | null>(null);
  const catalogRef = React.useRef<ChatWorkspaceCatalog | null>(null);
  const savingRef = React.useRef(false);
  const savePendingRef = React.useRef(false);
  const saveTimerRef = React.useRef<number | null>(null);
  const painting = React.useRef<{ key: Permission; value: boolean } | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  // Edits made before the first catalog arrived: kept, and saved once it does.
  const editedEarly = React.useRef(false);
  const flushSaveRef = React.useRef<() => Promise<void>>(async () => undefined);
  loadedRef.current = loaded;
  draftRef.current = draft;
  catalogRef.current = catalog;
  const dirty = Boolean(catalog && draft && workspaceAccessSignature(catalog.access) !== workspaceAccessSignature(draft));
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  const locked = disabled;
  const selectedCount = draft?.targets.length ?? 0;

  React.useEffect(() => { onBusyChange?.(dirty || saving); }, [dirty, saving, onBusyChange]);
  React.useEffect(() => { onSelectionChange?.(selectedCount); }, [onSelectionChange, selectedCount]);
  React.useEffect(() => { if (catalog) lastCatalogs.set(endpoint, catalog); }, [catalog, endpoint]);
  React.useEffect(() => {
    alive.current = true;
    const stop = () => { painting.current = null; };
    // The picker's own window: a desktop tool window never tells the Hub window about its mouse.
    const view = rootRef.current?.ownerDocument.defaultView ?? window;
    view.addEventListener('mouseup', stop);
    return () => {
      alive.current = false;
      view.removeEventListener('mouseup', stop);
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  /** Loads the folders one other device shares; unsaved edits are untouched. */
  const loadDevice = React.useCallback(async (deviceId: string) => {
    setLoading((current) => new Set(current).add(deviceId));
    try {
      const result = await requestJson<ChatWorkspaceCatalog>(catalogUrl(endpoint, deviceId));
      if (!alive.current) return;
      setCatalog((current) => current ? {
        ...current,
        workspaces: [...current.workspaces.filter((option) => option.deviceId !== deviceId), ...result.workspaces.filter((option) => option.deviceId === deviceId)],
        devices: current.devices.map((device) => device.id === deviceId ? (result.devices.find((item) => item.id === deviceId) ?? device) : device),
      } : current);
      setLoaded((current) => new Set(current).add(deviceId));
    } catch (loadError: any) {
      if (!alive.current) return;
      setCatalog((current) => current ? {
        ...current,
        devices: current.devices.map((device) => device.id === deviceId ? { ...device, error: loadError?.message ?? String(loadError) } : device),
      } : current);
    } finally {
      if (alive.current) setLoading((current) => { const next = new Set(current); next.delete(deviceId); return next; });
    }
  }, [requestJson, endpoint]);

  /** Reloads the catalog and every other device already loaded; edits still being saved stay as they are. */
  const reload = React.useCallback(async (initial: boolean) => {
    if (initial) setInitialLoading(true);
    try {
      const result = await requestJson<ChatWorkspaceCatalog>(catalogUrl(endpoint));
      if (!alive.current) return;
      const previous = initial ? new Set<string>() : new Set(loadedRef.current);
      const base = new Set(result.workspaces.map((workspace) => workspace.deviceId));
      setCatalog((current) => current && !initial ? {
        ...result,
        workspaces: [...result.workspaces, ...current.workspaces.filter((option) => !base.has(option.deviceId) && previous.has(option.deviceId))],
      } : result);
      setDraft((current) => (current && (dirtyRef.current || editedEarly.current) ? current : result.access));
      setLoaded(new Set([...base, ...previous]));
      if (editedEarly.current) {
        editedEarly.current = false;
        if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => { saveTimerRef.current = null; void flushSaveRef.current(); }, SAVE_DEBOUNCE_MS);
      }
      if (!initial) for (const deviceId of previous) if (!base.has(deviceId)) void loadDevice(deviceId);
    } catch (loadError: any) {
      if (alive.current && initial) setError(loadError?.message ?? String(loadError));
    } finally {
      if (alive.current) setInitialLoading(false);
    }
  }, [loadDevice, requestJson, endpoint]);

  React.useEffect(() => { void reload(true); }, [reload]);

  // Live refresh: this Hub's drones and repositories change through registry events; other devices announce changes to
  // what they share over the mesh.
  React.useEffect(() => {
    const timers = new Map<string, number>();
    const schedule = (key: string, run: () => void) => {
      const existing = timers.get(key);
      if (existing != null) window.clearTimeout(existing);
      timers.set(key, window.setTimeout(() => { timers.delete(key); run(); }, REFRESH_DEBOUNCE_MS));
    };
    const refreshBase = () => schedule('base', () => void reload(false));
    const unsubscribeRegistry = subscribeDesktopEvents({ handlers: { registry_snapshot: refreshBase, registry_delta: refreshBase } });
    const unsubscribeMesh = subscribeDeviceMeshChanges(() => undefined, {
      onCapabilityEvent(event) {
        if (event.capability !== 'workspace' || event.event !== 'workspaces.changed') return;
        if (loadedRef.current.has(event.sourceDeviceId)) schedule(`device:${event.sourceDeviceId}`, () => void loadDevice(event.sourceDeviceId));
      },
    });
    return () => { unsubscribeRegistry(); unsubscribeMesh(); for (const timer of timers.values()) window.clearTimeout(timer); };
  }, [loadDevice, reload]);

  /** Browsing or searching reaches folders other devices share: load each once. */
  const loadOtherDevices = React.useCallback(() => {
    for (const device of catalogRef.current?.devices ?? []) {
      if (!device.error && !loadedRef.current.has(device.id)) void loadDevice(device.id);
    }
  }, [loadDevice]);

  // Edits save on their own. Rapid clicks coalesce, a save in flight queues one more, and a rejected save falls back to
  // what the Hub last accepted.
  const flushSave = React.useCallback(async () => {
    const current = draftRef.current;
    const base = catalogRef.current;
    if (!current || !base || workspaceAccessSignature(current) === workspaceAccessSignature(base.access)) return;
    if (savingRef.current) { savePendingRef.current = true; return; }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const sent = workspaceAccessSignature(current);
    try {
      const result = await requestJson<ChatWorkspaceCatalog>(catalogUrl(endpoint), { method: 'POST', body: JSON.stringify({ access: current, revision: base.revision }) });
      if (!alive.current) return;
      setCatalog((existing) => existing ? { ...existing, access: result.access, revision: result.revision } : result);
      setDraft((latest) => (latest && workspaceAccessSignature(latest) === sent ? result.access : latest));
    } catch (saveError: any) {
      if (!alive.current) return;
      setError(saveError?.message ?? String(saveError));
      setDraft(base.access);
      if (/changed elsewhere/i.test(String(saveError?.message ?? ''))) void reload(false);
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
      if (savePendingRef.current) { savePendingRef.current = false; void flushSave(); }
    }
  }, [reload, requestJson, endpoint]);

  flushSaveRef.current = flushSave;

  const update = React.useCallback((change: (current: ChatWorkspaceAccess) => ChatWorkspaceAccess) => {
    if (!catalogRef.current) editedEarly.current = true;
    setDraft((current) => {
      if (!current) return current;
      const next = change(current);
      // Whatever left the selection keeps its row, faded, until the picker closes.
      const removed = current.targets.filter((target) => !next.targets.some((item) => item.id === target.id));
      if (removed.length) setGone((list) => [...list.filter((item) => !removed.some((r) => r.id === item.id)), ...removed]);
      return next;
    });
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { saveTimerRef.current = null; void flushSave(); }, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  const byId = new Map<string, ChatWorkspaceOption>();
  for (const option of catalog?.workspaces ?? []) byId.set(option.id, option);
  const deviceName = (option: ChatWorkspaceOption) => catalog?.devices.find((device) => device.id === option.deviceId)?.name ?? option.deviceName;
  const selfId = catalog?.devices[0]?.id;
  const describe = (option: ChatWorkspaceOption) => {
    const where = option.deviceId !== selfId ? ` · ${deviceName(option)}` : '';
    const kind = option.kind === 'remote' ? 'Shared folder' : workspaceCategory(option).replace(/ies$/, 'y').replace(/s$/, '');
    return `${kind}${where}`;
  };

  // In use: the selection in the order it was made, and rows turned off during this visit where they were.
  const inUse: { option: ChatWorkspaceOption; selected: boolean }[] = [];
  const seen = new Set<string>();
  for (const target of draft?.targets ?? []) { inUse.push({ option: { ...target, ...(byId.get(target.id) ?? {}) } as ChatWorkspaceOption, selected: true }); seen.add(target.id); }
  for (const option of gone) if (!seen.has(option.id)) inUse.push({ option, selected: false });

  const term = query.trim().toLowerCase();
  const matches = mode === 'inuse' && term
    ? [...byId.values()]
        .filter((option) => !draft?.targets.some((target) => target.id === option.id))
        .filter((option) => `${option.name} ${option.path ?? ''} ${option.runtime ?? ''} ${deviceName(option)}`.toLowerCase().includes(term))
        .slice(0, MATCH_LIMIT)
    : [];
  const add = (option: ChatWorkspaceOption) => update((current) => addWorkspace(current, option));

  const setCell = (option: ChatWorkspaceOption, key: Permission, value: boolean) => {
    const granted = draftRef.current?.targets.find((target) => target.id === option.id) as ChatWorkspaceOption | undefined;
    update((current) => setPermission(current, option, key, value, offeredBy(byId.get(option.id), granted)));
  };
  const column = (key: Permission) => {
    // Only what is in use: a header click never brings back a workspace just removed.
    const rows = inUse.filter((row) => row.selected && offeredBy(byId.get(row.option.id), row.option)[key]);
    const allOn = rows.length > 0 && rows.every((row) => draft?.targets.find((target) => target.id === row.option.id)?.[key]);
    update((current) => rows.reduce((access, row) => setPermission(access, row.option, key, !allOn, offeredBy(byId.get(row.option.id), row.option)), current));
  };

  const tab = (on: boolean) => `h-7 rounded-[7px] px-3 text-[13px] ${on ? 'bg-[var(--surface-strong)] font-medium text-[var(--fg)]' : 'text-[var(--muted)] hover:text-[var(--fg)]'}`;

  return (
    <div ref={rootRef} className="flex min-h-0 flex-col text-[var(--fg)]">
      <div className="flex items-center gap-2 px-3 pb-2 pt-1">
        <div role="group" aria-label="Show" className="flex gap-0.5 rounded-[9px] border border-[var(--border-subtle)] p-[3px]">
          <button type="button" aria-pressed={mode === 'inuse'} className={tab(mode === 'inuse')} onClick={() => setMode('inuse')}>In use</button>
          <button type="button" aria-pressed={mode === 'all'} className={tab(mode === 'all')} onClick={() => { setMode('all'); loadOtherDevices(); }}>All workspaces</button>
        </div>
        <input type="search" value={query} aria-label={mode === 'inuse' ? 'Add a workspace' : 'Filter workspaces'}
          placeholder={mode === 'inuse' ? 'Add a workspace…' : 'Filter…'} disabled={mode === 'inuse' && locked}
          onChange={(event) => { setQuery(event.target.value); loadOtherDevices(); }}
          onKeyDown={(event) => { if (mode === 'inuse' && event.key === 'Enter' && matches[0]) { event.preventDefault(); add(matches[0]); setQuery(''); } }}
          className="h-8 min-w-0 flex-1 rounded-md bg-[var(--surface-softest)] px-2.5 text-[13px] outline-none placeholder:text-[var(--muted-dim)]" />
        {saving ? <IconSpinner className="h-3 w-3 flex-shrink-0 animate-spin text-[var(--muted)]" aria-label="Saving" /> : null}
      </div>
      {matches.length ? (
        <div role="listbox" aria-label="Matching workspaces" className="mx-3 mb-2 overflow-hidden rounded-md bg-[var(--surface-softest)]">
          {matches.map((option, index) => (
            <button key={option.id} type="button" role="option" aria-selected={index === 0} onClick={() => { add(option); setQuery(''); }}
              className={`flex min-h-[36px] w-full items-center gap-2 px-2.5 py-1 text-left hover:bg-[var(--hover)] ${index === 0 ? 'bg-[var(--surface-strong)]' : ''}`}>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{option.name}</span>
              <span className="flex-shrink-0 truncate text-[11px] text-[var(--muted-dim)]">{describe(option)}</span>
            </button>
          ))}
        </div>
      ) : mode === 'inuse' && term && catalog ? (
        <div className="px-3 pb-2 text-[12px] text-[var(--muted)]">
          Nothing matches.{' '}
          <button type="button" className="text-[var(--accent)] hover:underline" onClick={() => { setMode('all'); loadOtherDevices(); }}>Browse all workspaces</button>
        </div>
      ) : null}
      {error ? <div className="border-y border-[var(--border-subtle)] px-3 py-1.5 text-[12px] text-[var(--red)]">{error}</div> : null}

      {mode === 'inuse' ? (
        <>
          <div className={`${GRID} border-b border-[var(--border-subtle)] px-3 pb-1 text-[12px]`}>
            <span className="text-[var(--muted)]">Workspace</span>
            {PERMISSIONS.map((permission) => (
              <button key={permission.key} type="button" disabled={locked} onClick={() => column(permission.key)}
                title={`${PERMISSION_HELP[permission.key]} Click to set it for every workspace in use.`}
                className={`h-7 font-semibold hover:underline disabled:opacity-50 ${permission.key === 'execute' ? 'text-[var(--yellow)]' : 'text-[var(--fg-secondary)]'}`}>
                {permission.label}
              </button>
            ))}
            <span className="text-center font-semibold text-[var(--fg-secondary)]">Default</span>
          </div>
          <div className="min-h-0 flex-1 select-none overflow-y-auto py-1" onMouseLeave={() => { painting.current = null; }}>
            {initialLoading && !catalog && !draft ? (
              <div className="flex items-center gap-2 px-3 py-3 text-[13px] text-[var(--muted)]"><IconSpinner className="h-3 w-3 animate-spin" /> Loading workspaces…</div>
            ) : null}
            {home ? (
              <div className={`${GRID} min-h-[42px] px-3`}>
                <span className="min-w-0">
                  <span className="block truncate text-[13px]">{home.name}</span>
                  <span className="block truncate text-[12px] text-[var(--muted)]">
                    {home.note}
                    {home.onOpen ? <> · <button type="button" onClick={home.onOpen} className="text-[var(--accent)] hover:underline">Open</button></> : null}
                  </span>
                </span>
                {PERMISSIONS.map((permission) => (
                  <span key={permission.key} className="flex justify-center">
                    <Square on={permission.key !== 'execute'} offered={permission.key !== 'execute'} locked run={permission.key === 'execute'} label={`${permission.name} ${home.name} (always)`} />
                  </span>
                ))}
                <span />
              </div>
            ) : null}
            {inUse.map(({ option, selected }) => {
              const target = draft?.targets.find((item) => item.id === option.id);
              const available = byId.has(option.id);
              const offered = offeredBy(byId.get(option.id), option);
              const isDefault = draft?.defaultTargetId === option.id;
              return (
                <div key={option.id} className={`${GRID} min-h-[42px] px-3 ${selected ? 'bg-[var(--surface-softest)]' : 'opacity-55'}`}>
                  <span className="min-w-0" title={workspaceOptionMeta(option)}>
                    <span className="block truncate text-[13px] font-medium">{option.name}</span>
                    <span className="block truncate text-[11px] text-[var(--muted-dim)]">{available || !catalog ? describe(option) : 'Unavailable'}</span>
                  </span>
                  {PERMISSIONS.map((permission) => {
                    const on = Boolean(target?.[permission.key]);
                    const can = !locked && (on || offered[permission.key]);
                    return (
                      <span key={permission.key} className="flex justify-center">
                        <Square
                          on={on} offered={offered[permission.key]} locked={!can} run={permission.key === 'execute'}
                          label={`${permission.name} ${option.name}`}
                          onDown={() => { if (!can) return; painting.current = { key: permission.key, value: !on }; setCell(option, permission.key, !on); }}
                          onEnter={() => { const paint = painting.current; if (!can || !paint || paint.key !== permission.key) return; setCell(option, permission.key, paint.value); }}
                          onKey={() => { if (can) setCell(option, permission.key, !on); }}
                        />
                      </span>
                    );
                  })}
                  <span className="flex justify-center">
                    <button type="button" role="radio" aria-checked={isDefault} aria-label={`Use ${option.name} as the default workspace`}
                      title={isDefault ? 'Default: used when no workspace is named' : 'Make this the default'}
                      disabled={locked || !selected || isDefault}
                      onClick={() => update((current) => ({ ...current, defaultTargetId: option.id }))}
                      className={`h-[18px] w-[18px] rounded-full border-2 p-0 ${isDefault ? 'border-[var(--accent)] bg-[radial-gradient(circle,var(--accent)_42%,transparent_48%)]' : selected ? 'border-[var(--muted-dim)] hover:border-[var(--accent)]' : 'border-transparent'}`} />
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--border-subtle)] py-1">
          {(catalog?.devices ?? []).map((device, deviceIndex) => {
            const options = [...byId.values()].filter((option) => option.deviceId === device.id && (!term || `${option.name} ${option.path ?? ''} ${option.runtime ?? ''}`.toLowerCase().includes(term)));
            const deviceLabel = deviceIndex === 0 ? `This device · ${device.name}` : `Shared by ${device.name}`;
            return (
              <div key={device.id}>
                {deviceIndex > 0 || (catalog?.devices.length ?? 0) > 1 ? <div className="px-3 pb-1 pt-3 text-[12px] font-medium text-[var(--muted)]">{deviceLabel}</div> : null}
                {loading.has(device.id) ? <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--muted)]"><IconSpinner className="h-3 w-3 animate-spin" /> Loading…</div> : null}
                {device.error ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--muted)]">
                    <span className="min-w-0 flex-1">{device.error}</span>
                    <button type="button" onClick={() => void loadDevice(device.id)} className="text-[var(--accent)] hover:underline">Retry</button>
                  </div>
                ) : null}
                {WORKSPACE_CATEGORIES.map((category) => {
                  let rows = options.filter((option) => workspaceCategory(option) === category);
                  if (!rows.length) return null;
                  const drones = category === 'Container drones' || category === 'Host drones';
                  const total = rows.length;
                  if (drones && !allDrones && !term) rows = rows.filter((option, index) => index < DRONE_CAP || draft?.targets.some((target) => target.id === option.id));
                  return (
                    <div key={category}>
                      <div className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]">{category}</div>
                      {rows.map((option) => {
                        const target = draft?.targets.find((item) => item.id === option.id);
                        const grants = target ? PERMISSIONS.filter((permission) => target[permission.key]).map((permission) => permission.label).join(' · ') : '';
                        return (
                          <button key={option.id} type="button" role="checkbox" aria-checked={Boolean(target)} disabled={locked}
                            aria-label={`${target ? 'Remove' : 'Add'} ${option.name}`}
                            onClick={() => update((current) => (target ? removeWorkspace(current, option.id) : addWorkspace(current, option)))}
                            className={`flex min-h-[36px] w-full items-center gap-2.5 px-3 py-1 text-left hover:bg-[var(--hover)] ${target ? 'bg-[var(--surface-softest)]' : ''}`}>
                            <span className={`flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded border text-[12px] font-bold ${target ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent,#11111b)]' : 'border-[var(--muted-dim)]'}`}>{target ? '✓' : ''}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium">{option.name}</span>
                              <span className="block truncate text-[11px] text-[var(--muted-dim)] opacity-80">{workspaceOptionMeta(option)}</span>
                            </span>
                            <span className="flex-shrink-0 text-[12px] text-[var(--muted)]">{grants}</span>
                          </button>
                        );
                      })}
                      {rows.length < total ? (
                        <button type="button" onClick={() => setAllDrones(true)} className="px-3 py-1 text-[12px] text-[var(--accent)] hover:underline">+ {total - rows.length} more</button>
                      ) : null}
                    </div>
                  );
                })}
                {!options.length && !device.error && !loading.has(device.id) && loaded.has(device.id) ? (
                  <div className="px-3 py-1.5 text-[12px] text-[var(--muted)]">{term ? 'No matching workspaces.' : deviceIndex === 0 ? 'No workspaces on this device.' : 'Nothing shared with this Hub.'}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

/** One permission square: on, off, or not offered by the workspace (dashed). Mouse acts on press, so a drag paints. */
function Square({ on, offered, locked, run, label, onDown, onEnter, onKey }: {
  on: boolean; offered: boolean; locked: boolean; run: boolean; label: string;
  onDown?: () => void; onEnter?: () => void; onKey?: () => void;
}) {
  const fill = run ? 'border-[var(--yellow)] bg-[var(--yellow)]' : 'border-[var(--accent)] bg-[var(--accent)]';
  return (
    <button type="button" aria-label={label} aria-pressed={on} disabled={locked && !on}
      onMouseDown={(event) => { if (event.button === 0) { event.preventDefault(); onDown?.(); } }}
      onMouseEnter={() => onEnter?.()}
      onClick={(event) => { if (event.detail === 0) onKey?.(); }}
      className={`flex h-[24px] w-[24px] items-center justify-center rounded-[6px] border p-0 text-[13px] font-bold leading-none text-[var(--on-accent,#11111b)] ${
        !offered ? 'border-dashed border-[var(--border-subtle)] opacity-50' : on ? fill : 'border-[var(--muted-dim)] hover:border-[var(--fg-secondary)]'
      } ${locked ? 'cursor-default' : 'cursor-pointer'} ${locked && on ? 'opacity-70' : ''}`}>
      {on ? '✓' : ''}
    </button>
  );
}
