import React from 'react';
import type { ChatWorkspaceCatalog, ChatWorkspaceOption } from '@drone/assistant-chat';
import { useCompanionWorkspace } from './CompanionWorkspaceContext';
import { requestJson } from '../http';
import { contextMenuItemBaseClass } from '../../ui/dropdown';

type CurrentWorkspace = ChatWorkspaceCatalog & { target: ChatWorkspaceOption; droneId: string };

export function CompanionCurrentWorkspaceAccess({ refreshKey }: { refreshKey: boolean }) {
  const workspace = useCompanionWorkspace();
  const [current, setCurrent] = React.useState<CurrentWorkspace | null>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [retry, setRetry] = React.useState(0);
  const loadedDrone = React.useRef('');
  const readDrone = React.useCallback(() => {
    try {
      return String(workspace?.getAppContext().mainDroneId ?? '');
    } catch {
      return '';
    }
  }, [workspace]);
  React.useEffect(() => {
    let alive = true,
      version = 0;
    loadedDrone.current = '';
    const refresh = async (force = false) => {
      const droneId = readDrone();
      if (!force && droneId === loadedDrone.current) return;
      loadedDrone.current = droneId;
      const request = ++version;
      setCurrent(null);
      setError('');
      setLoading(Boolean(droneId));
      if (!droneId) return;
      try {
        const next = await requestJson<CurrentWorkspace>(
          `/api/companion/workspaces/current?droneId=${encodeURIComponent(droneId)}`,
        );
        if (alive && request === version && readDrone() === droneId)
          setCurrent({ ...next, droneId });
      } catch (error) {
        if (alive && request === version)
          setError(error instanceof Error ? error.message : String(error));
      } finally {
        if (alive && request === version) setLoading(false);
      }
    };
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), 1000);
    const onFocus = () => void refresh(true);
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [readDrone, refreshKey, retry]);
  const selected = current?.access.targets.find((target) => target.id === current.target.id);
  const isDefault = current?.access.defaultTargetId === current?.target.id;
  const grant = async () => {
    if (!current || busy) return;
    if (readDrone() !== current.droneId) {
      setRetry((value) => value + 1);
      return;
    }
    const droneId = current.droneId;
    setBusy(true);
    setError('');
    try {
      const access = {
        targets: selected
          ? current.access.targets
          : [
              ...current.access.targets,
              { ...current.target, read: true, write: false, execute: false },
            ],
        defaultTargetId: current.target.id,
      };
      await requestJson('/api/companion/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ access, revision: current.revision }),
      });
      // Reload even after navigation: this save changed the shared access revision.
      setRetry((value) => value + 1);
    } catch (error) {
      if (readDrone() === droneId) setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const label = busy
    ? 'Saving workspace access…'
    : loading
      ? 'Loading workspace…'
      : current
        ? `${selected?.read ? (isDefault ? 'Read enabled' : 'Use workspace') : 'Allow Read'} · ${current.target.name}`
        : error
          ? 'Workspace unavailable'
          : 'Open a drone for workspace access';
  return (
    <div className="min-w-0 max-w-full">
      <button
        type="button"
        disabled={busy || loading || !current || Boolean(selected?.read && isDefault)}
        onClick={() => void grant()}
        title={
          current
            ? `${current.target.deviceName} · ${current.target.path || current.target.name}. Read allows listing, reading and searching files. Makes this the default Companion workspace. Access stays selected when you switch drones.`
            : label
        }
        className={`${contextMenuItemBaseClass} text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-60`}
      >
        <span className="flex w-4 shrink-0 items-center justify-center text-[var(--muted)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {selected?.read && isDefault
              ? <><path d="M20 6 9 17l-5-5" /></>
              : <><path d="M12 5v14M5 12h14" /></>}
          </svg>
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {current ? <span className="dh-type-menu-meta max-w-[8rem] shrink-0 truncate">{current.target.deviceName}</span> : null}
      </button>
      {error && (
        <p role="status" className="px-2.5 py-1 text-xs text-[var(--red)]">
          {error}{' '}
          <button type="button" disabled={busy} className="underline" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}
    </div>
  );
}
