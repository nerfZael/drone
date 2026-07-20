import React from 'react';
import type { MeshDevice } from './use-device-mesh';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;
type Root = { id: string; label: string; path: string };
type HomeTarget = {
  threadId: string;
  targetDeviceId: string;
  deviceName: string;
  rootId: string;
  workspaceName: string;
  read: boolean;
  write: boolean;
  execute: boolean;
};
type DeviceGrant = {
  deviceId: string;
  rootId: string;
  read: boolean;
  write: boolean;
  execute: boolean;
};
type RemoteWorkspace = {
  id: string;
  name: string;
  read: boolean;
  write: boolean;
  execute: boolean;
};
type Policy = {
  version: 2;
  roots: Root[];
  homeTargets: HomeTarget[];
  deviceGrants: DeviceGrant[];
};

const emptyPolicy: Policy = { version: 2, roots: [], homeTargets: [], deviceGrants: [] };
const fieldClass =
  'min-w-0 rounded border border-[var(--border)] bg-[var(--panel)] px-2.5 py-2 text-[11px] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]';

function normalizedPolicy(value: any): Policy {
  return {
    version: 2,
    roots: Array.isArray(value?.roots) ? value.roots : [],
    homeTargets: Array.isArray(value?.homeTargets) ? value.homeTargets : [],
    deviceGrants: Array.isArray(value?.deviceGrants) ? value.deviceGrants : [],
  };
}

function folderName(folderPath: string): string {
  return (
    folderPath
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || 'Workspace'
  );
}

function grantKey(deviceId: string, rootId: string): string {
  return `${deviceId}\0${rootId}`;
}

function targetKey(target: HomeTarget): string {
  return `${target.threadId}\0${target.targetDeviceId}\0${target.rootId}`;
}

function policyFingerprint(policy: Policy): string {
  return JSON.stringify({
    ...policy,
    deviceGrants: [...policy.deviceGrants].sort((left, right) =>
      grantKey(left.deviceId, left.rootId).localeCompare(grantKey(right.deviceId, right.rootId)),
    ),
    homeTargets: [...policy.homeTargets].sort((left, right) =>
      targetKey(left).localeCompare(targetKey(right)),
    ),
  });
}

function permissionSummary(grant: DeviceGrant | undefined): string {
  if (!grant || (!grant.read && !grant.write && !grant.execute)) return 'No access';
  return [grant.read && 'Read', grant.write && 'Write', grant.execute && 'Run']
    .filter(Boolean)
    .join(' · ');
}

export function CrossDeviceAssistantPolicyPanel({
  requestJson,
  devices,
  selfDeviceId,
  connectedDeviceIds = [],
  mode = 'sharing',
  threadId = '',
  threadTitle = '',
  onClose,
}: {
  requestJson: RequestJson;
  devices: MeshDevice[];
  selfDeviceId: string;
  connectedDeviceIds?: string[];
  mode?: 'sharing' | 'thread';
  threadId?: string;
  threadTitle?: string;
  onClose?: () => void;
}) {
  const [policy, setPolicy] = React.useState<Policy>(emptyPolicy);
  const [savedPolicy, setSavedPolicy] = React.useState<Policy>(emptyPolicy);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [choosing, setChoosing] = React.useState(false);
  const [remoteWorkspaces, setRemoteWorkspaces] = React.useState<
    Record<string, { loading: boolean; error: string | null; workspaces: RemoteWorkspace[] }>
  >({});
  const [remoteReload, setRemoteReload] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const availableDevices = devices.filter(
    (device) => device.id !== selfDeviceId && !device.revokedAt,
  );
  const availableDeviceKey = availableDevices
    .map((device) => device.id)
    .sort()
    .join('\0');
  const connectedDeviceKey = connectedDeviceIds
    .filter((deviceId) => availableDevices.some((device) => device.id === deviceId))
    .sort()
    .join('\0');
  const dirty = policyFingerprint(policy) !== policyFingerprint(savedPolicy);
  const savedGrants = new Map(
    savedPolicy.deviceGrants.map((grant) => [grantKey(grant.deviceId, grant.rootId), grant]),
  );

  React.useEffect(() => {
    let active = true;
    void requestJson<{ policy: Policy }>('/api/device-mesh/cross-device-assistant')
      .then((result) => {
        if (!active) return;
        const next = normalizedPolicy(result.policy);
        setPolicy(next);
        setSavedPolicy(next);
      })
      .catch((nextError) => active && setError(nextError?.message ?? String(nextError)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [requestJson]);

  React.useEffect(() => {
    if (mode !== 'thread') return;
    let active = true;
    const connected = new Set(connectedDeviceIds);
    setRemoteWorkspaces(
      Object.fromEntries(
        availableDevices.map((device) => [
          device.id,
          { loading: connected.has(device.id), error: null, workspaces: [] },
        ]),
      ),
    );
    void Promise.all(
      availableDevices
        .filter((device) => connected.has(device.id))
        .map(async (device) => {
          try {
            const response = await requestJson<{ result?: { workspaces?: RemoteWorkspace[] } }>(
              `/api/device-mesh/cross-device-assistant/remote-workspaces?deviceId=${encodeURIComponent(device.id)}`,
            );
            if (!active) return;
            setRemoteWorkspaces((current) => ({
              ...current,
              [device.id]: {
                loading: false,
                error: null,
                workspaces: Array.isArray(response.result?.workspaces)
                  ? response.result.workspaces
                  : [],
              },
            }));
          } catch (nextError: any) {
            if (!active) return;
            setRemoteWorkspaces((current) => ({
              ...current,
              [device.id]: {
                loading: false,
                error: nextError?.message ?? String(nextError),
                workspaces: [],
              },
            }));
          }
        }),
    );
    return () => {
      active = false;
    };
  }, [availableDeviceKey, connectedDeviceKey, mode, remoteReload, requestJson]);

  React.useEffect(() => {
    if (
      mode !== 'thread' ||
      !Object.entries(remoteWorkspaces).some(
        ([deviceId, remote]) => connectedDeviceIds.includes(deviceId) && remote.error,
      )
    )
      return;
    const timer = window.setTimeout(() => setRemoteReload((current) => current + 1), 3_000);
    return () => window.clearTimeout(timer);
  }, [connectedDeviceKey, mode, remoteWorkspaces]);

  const addRoot = (folderPath = '') => {
    const label = folderPath ? folderName(folderPath) : '';
    setPolicy((current) => ({
      ...current,
      roots: [
        ...current.roots,
        { id: `workspace_${crypto.randomUUID()}`, label, path: folderPath },
      ],
    }));
    setSaved(false);
  };

  const chooseRoot = async (rootId?: string) => {
    setChoosing(true);
    setError(null);
    try {
      const result = await requestJson<{ path: string }>(
        '/api/device-mesh/cross-device-assistant/pick-directory',
        { method: 'POST' },
      );
      if (!rootId) addRoot(result.path);
      else
        setPolicy((current) => ({
          ...current,
          roots: current.roots.map((root) =>
            root.id === rootId
              ? { ...root, path: result.path, label: root.label || folderName(result.path) }
              : root,
          ),
        }));
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setChoosing(false);
    }
  };

  const setGrant = (
    deviceId: string,
    rootId: string,
    change: (current: DeviceGrant) => DeviceGrant,
  ) => {
    setPolicy((current) => {
      const existing = current.deviceGrants.find(
        (grant) => grant.deviceId === deviceId && grant.rootId === rootId,
      ) ?? { deviceId, rootId, read: false, write: false, execute: false };
      const next = change(existing);
      const rest = current.deviceGrants.filter(
        (grant) => !(grant.deviceId === deviceId && grant.rootId === rootId),
      );
      return {
        ...current,
        deviceGrants: next.read || next.write || next.execute ? [...rest, next] : rest,
      };
    });
    setSaved(false);
  };

  const setHomePermission = (
    threadId: string,
    targetDeviceId: string,
    workspace: RemoteWorkspace,
    permission: 'read' | 'write' | 'execute',
  ) => {
    setPolicy((current) => {
      const existing = current.homeTargets.find(
        (target) =>
          target.threadId === threadId &&
          target.targetDeviceId === targetDeviceId &&
          target.rootId === workspace.id,
      ) ?? {
        threadId,
        targetDeviceId,
        deviceName:
          availableDevices.find((device) => device.id === targetDeviceId)?.name ?? targetDeviceId,
        rootId: workspace.id,
        workspaceName: workspace.name,
        read: false,
        write: false,
        execute: false,
      };
      let next = existing;
      if (permission === 'read') next = { ...existing, read: !existing.read };
      else if (permission === 'write') next = { ...existing, write: !existing.write };
      else next = { ...existing, execute: !existing.execute };
      next = {
        ...next,
        deviceName:
          availableDevices.find((device) => device.id === targetDeviceId)?.name ?? targetDeviceId,
        workspaceName: workspace.name,
      };
      const rest = current.homeTargets.filter(
        (target) =>
          !(
            target.threadId === threadId &&
            target.targetDeviceId === targetDeviceId &&
            target.rootId === workspace.id
          ),
      );
      return {
        ...current,
        homeTargets: next.read || next.write || next.execute ? [...rest, next] : rest,
      };
    });
    setSaved(false);
  };

  const save = async () => {
    if (!window.confirm('Apply these workspace and device access changes?')) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const activeDeviceIds = new Set(availableDevices.map((device) => device.id));
      const policyToSave: Policy = {
        ...policy,
        homeTargets: policy.homeTargets.flatMap((target) => {
          if (!activeDeviceIds.has(target.targetDeviceId)) return [];
          if (mode === 'thread' && target.threadId !== threadId) return [target];
          if (mode === 'thread' && !connectedDeviceIds.includes(target.targetDeviceId))
            return [target];
          const remote = remoteWorkspaces[target.targetDeviceId];
          if (!remote || remote.loading || remote.error) return [target];
          const workspace = remote.workspaces.find((item) => item.id === target.rootId);
          if (!workspace) return [];
          const next = {
            ...target,
            deviceName:
              availableDevices.find((device) => device.id === target.targetDeviceId)?.name ??
              target.deviceName,
            workspaceName: workspace.name,
            read: target.read && workspace.read,
            write: target.write && workspace.write,
            execute: target.execute && workspace.execute,
          };
          return next.read || next.write || next.execute ? [next] : [];
        }),
      };
      const result = await requestJson<{ policy: Policy }>(
        '/api/device-mesh/cross-device-assistant',
        { method: 'PUT', body: JSON.stringify(policyToSave) },
      );
      const next = normalizedPolicy(result.policy);
      setPolicy(next);
      setSavedPolicy(next);
      setSaved(true);
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <section className="rounded-lg border border-[var(--border-subtle)] p-4 text-[12px] text-[var(--muted)]">
        Loading workspaces…
      </section>
    );

  return (
    <section className={mode === 'thread' ? 'min-h-full bg-[var(--panel-alt)]' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-[var(--yellow)]">
            {mode === 'thread' ? 'Thread access' : 'Workspace sharing'}
          </div>
          <h2 className="mt-1 text-[16px] font-semibold text-[var(--fg)]">
            {mode === 'thread'
              ? threadTitle || 'Remote workspaces'
              : 'Folders available to trusted devices'}
          </h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[var(--muted)]">
            {mode === 'thread'
              ? 'Choose which workspaces this thread may use on your connected devices.'
              : 'Add folders on this Hub, then choose what each trusted device may do.'}
          </p>
        </div>
        {mode === 'sharing' ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={choosing}
              onClick={() => void chooseRoot()}
              className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-3 py-2 text-[11px] font-semibold text-[var(--fg)] disabled:opacity-50"
            >
              {choosing ? 'Opening…' : 'Choose folder'}
            </button>
            <button
              type="button"
              onClick={() => addRoot()}
              className="px-2 py-2 text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--fg)]"
            >
              Add path manually
            </button>
          </div>
        ) : onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--fg)]"
          >
            Close
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 p-4">
        {mode === 'sharing' ? (
          <>
            {policy.roots.map((root) => (
              <div
                key={root.id}
                className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)]"
              >
                <div className="grid gap-2 border-b border-[var(--border-subtle)] p-3 sm:grid-cols-[1fr_2fr_auto_auto]">
                  <input
                    aria-label="Workspace name"
                    className={fieldClass}
                    placeholder="Workspace name"
                    value={root.label}
                    onChange={(event) =>
                      setPolicy((current) => ({
                        ...current,
                        roots: current.roots.map((item) =>
                          item.id === root.id ? { ...item, label: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                  <input
                    aria-label="Workspace folder"
                    className={`${fieldClass} font-mono`}
                    placeholder="/absolute/workspace/path"
                    value={root.path}
                    onChange={(event) =>
                      setPolicy((current) => ({
                        ...current,
                        roots: current.roots.map((item) =>
                          item.id === root.id ? { ...item, path: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                  <button
                    type="button"
                    disabled={choosing}
                    onClick={() => void chooseRoot(root.id)}
                    className="rounded border border-[var(--border-subtle)] px-3 text-[10px] font-semibold text-[var(--fg)] disabled:opacity-50"
                  >
                    Browse
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPolicy((current) => ({
                        ...current,
                        roots: current.roots.filter((item) => item.id !== root.id),
                        deviceGrants: current.deviceGrants.filter(
                          (grant) => grant.rootId !== root.id,
                        ),
                      }))
                    }
                    className="rounded px-2 text-[10px] font-semibold text-[var(--red)]"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid gap-2 p-3">
                  {availableDevices.map((device) => {
                    const grant = policy.deviceGrants.find(
                      (item) => item.deviceId === device.id && item.rootId === root.id,
                    );
                    const previous = savedGrants.get(grantKey(device.id, root.id));
                    const changed = JSON.stringify(grant) !== JSON.stringify(previous);
                    return (
                      <div
                        key={device.id}
                        className={`flex flex-wrap items-center gap-3 rounded border px-3 py-2 ${changed ? 'border-[var(--yellow)] bg-[var(--yellow-subtle)]' : 'border-[var(--border-subtle)]'}`}
                      >
                        <div className="min-w-36 flex-1">
                          <div className="text-[12px] font-semibold text-[var(--fg)]">
                            {device.name}
                          </div>
                          <div className="mt-0.5 text-[9px] text-[var(--muted)]">
                            {permissionSummary(grant)}
                            {changed ? ' · changed' : ''}
                          </div>
                        </div>
                        {(['read', 'write', 'execute'] as const).map((permission) => (
                          <label
                            key={permission}
                            className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]"
                          >
                            <input
                              type="checkbox"
                              checked={grant?.[permission] === true}
                              onChange={(event) =>
                                setGrant(device.id, root.id, (current) => {
                                  if (permission === 'read')
                                    return { ...current, read: event.target.checked };
                                  if (permission === 'write')
                                    return {
                                      ...current,
                                      write: event.target.checked,
                                    };
                                  return { ...current, execute: event.target.checked };
                                })
                              }
                            />
                            {permission === 'execute'
                              ? 'Run commands'
                              : permission[0].toUpperCase() + permission.slice(1)}
                          </label>
                        ))}
                      </div>
                    );
                  })}
                  {availableDevices.length === 0 ? (
                    <div className="text-[11px] text-[var(--muted)]">
                      Pair another device to grant access.
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {policy.roots.length === 0 ? (
              <div className="rounded border border-dashed border-[var(--border)] px-4 py-8 text-center text-[11px] text-[var(--muted)]">
                No workspace folders are exposed by this Hub.
              </div>
            ) : null}
          </>
        ) : threadId ? (
          <div className="grid gap-3 p-3">
            {availableDevices.map((device) => {
              const remote = remoteWorkspaces[device.id];
              const connected = connectedDeviceIds.includes(device.id);
              const selectedCount = policy.homeTargets.filter(
                (target) => target.threadId === threadId && target.targetDeviceId === device.id,
              ).length;
              return (
                <div
                  key={device.id}
                  className="border-b border-[var(--border-subtle)] pb-3 last:border-b-0"
                >
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--fg)]">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-[var(--green)]' : 'bg-[var(--muted-dim)]'}`}
                    />
                    {device.name}
                    <span className="text-[9px] font-normal uppercase tracking-wide text-[var(--muted-dim)]">
                      {connected ? 'Connected' : 'Offline'}
                    </span>
                  </div>
                  {!connected ? (
                    <div className="mt-2 text-[10px] text-[var(--muted)]">
                      {selectedCount > 0
                        ? `${selectedCount} saved workspace ${selectedCount === 1 ? 'selection is' : 'selections are'} preserved. Access resumes when this device reconnects.`
                        : 'Workspace access will become available when this device reconnects.'}
                    </div>
                  ) : remote?.loading ? (
                    <div className="mt-2 text-[10px] text-[var(--muted)]">Loading workspaces…</div>
                  ) : remote?.error ? (
                    <div className="mt-2 text-[10px] text-[var(--yellow)]">
                      Connection changed while loading. Retrying automatically…
                    </div>
                  ) : remote &&
                    (remote.workspaces.length > 0 ||
                      policy.homeTargets.some(
                        (target) =>
                          target.threadId === threadId && target.targetDeviceId === device.id,
                      )) ? (
                    <div className="mt-2 grid gap-2">
                      {remote.workspaces.map((workspace) => {
                        const selected = policy.homeTargets.find(
                          (target) =>
                            target.threadId === threadId &&
                            target.targetDeviceId === device.id &&
                            target.rootId === workspace.id,
                        );
                        const previous = savedPolicy.homeTargets.find(
                          (target) =>
                            target.threadId === threadId &&
                            target.targetDeviceId === device.id &&
                            target.rootId === workspace.id,
                        );
                        const changed = JSON.stringify(selected) !== JSON.stringify(previous);
                        return (
                          <div
                            key={workspace.id}
                            className={`flex flex-wrap items-center gap-3 rounded border px-3 py-2 ${changed ? 'border-[var(--yellow)] bg-[var(--yellow-subtle)]' : 'border-transparent bg-[var(--surface-softest)]'}`}
                          >
                            <div className="min-w-36 flex-1">
                              <div className="text-[11px] font-semibold text-[var(--fg)]">
                                {workspace.name}
                              </div>
                              {changed ? (
                                <div className="mt-0.5 text-[9px] text-[var(--yellow)]">
                                  changed
                                </div>
                              ) : null}
                            </div>
                            {(['read', 'write', 'execute'] as const).map((permission) => {
                              const allowed = workspace[permission];
                              return (
                                <label
                                  key={permission}
                                  className={`flex items-center gap-1.5 text-[10px] ${allowed ? 'text-[var(--muted)]' : 'text-[var(--muted-dim)] opacity-40'}`}
                                >
                                  <input
                                    type="checkbox"
                                    disabled={!allowed}
                                    checked={selected?.[permission] === true}
                                    onChange={() =>
                                      setHomePermission(threadId, device.id, workspace, permission)
                                    }
                                  />
                                  {permission === 'execute'
                                    ? 'Run'
                                    : permission[0].toUpperCase() + permission.slice(1)}
                                </label>
                              );
                            })}
                          </div>
                        );
                      })}
                      {policy.homeTargets
                        .filter(
                          (target) =>
                            target.threadId === threadId &&
                            target.targetDeviceId === device.id &&
                            !remote.workspaces.some((workspace) => workspace.id === target.rootId),
                        )
                        .map((target) => (
                          <div
                            key={targetKey(target)}
                            className="flex items-center gap-3 rounded border border-[var(--yellow)] bg-[var(--yellow-subtle)] px-3 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[11px] font-semibold text-[var(--fg)]">
                                {target.workspaceName}
                              </div>
                              <div className="mt-0.5 text-[9px] text-[var(--yellow)]">
                                No longer granted by the destination
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setPolicy((current) => ({
                                  ...current,
                                  homeTargets: current.homeTargets.filter(
                                    (item) => targetKey(item) !== targetKey(target),
                                  ),
                                }))
                              }
                              className="text-[10px] font-semibold text-[var(--red)]"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-[10px] text-[var(--muted)]">
                      This destination has not granted a workspace to this Hub.
                    </div>
                  )}
                </div>
              );
            })}
            {availableDevices.length === 0 ? (
              <div className="py-8 text-center text-[11px] text-[var(--muted)]">
                Pair another device from Devices before assigning a remote workspace.
              </div>
            ) : null}
            {policy.homeTargets.some((target) => target.threadId === threadId) ? (
              <button
                type="button"
                onClick={() =>
                  setPolicy((current) => ({
                    ...current,
                    homeTargets: current.homeTargets.filter(
                      (target) => target.threadId !== threadId,
                    ),
                  }))
                }
                className="justify-self-start text-[10px] font-semibold text-[var(--red)]"
              >
                Clear this thread’s workspace access
              </button>
            ) : null}
          </div>
        ) : (
          <div className="p-4 text-[11px] text-[var(--muted)]">
            Start a Built-in chat to configure its workspace access.
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] p-4">
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={() => void save()}
          className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-4 py-2 text-[11px] font-semibold text-[var(--fg)] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Apply changes'}
        </button>
        {dirty ? (
          <>
            <span className="text-[11px] font-semibold text-[var(--yellow)]">Unsaved changes</span>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm('Discard unsaved workspace changes?')) return;
                setPolicy(savedPolicy);
                setError(null);
              }}
              className="text-[10px] font-semibold text-[var(--muted)]"
            >
              Discard
            </button>
          </>
        ) : saved ? (
          <span className="text-[11px] text-[var(--green)]">Saved</span>
        ) : null}
        {error ? <span className="text-[11px] text-[var(--red)]">{error}</span> : null}
      </div>
    </section>
  );
}
