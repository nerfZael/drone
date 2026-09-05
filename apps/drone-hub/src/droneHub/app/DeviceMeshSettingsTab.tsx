import React from 'react';
import { copyText } from './clipboard';
import { IconSpinner } from './icons';
import { CrossDeviceAssistantPolicyPanel } from './CrossDeviceAssistantPolicyPanel';
import {
  deviceMeshInvitationCheckDelay,
  deviceMeshInvitationNeedsRotation,
  INVITATION_STATUS_POLL_MS,
} from './device-mesh-invitation';
import { DeviceMeshIngressPanel, type DeviceMeshIngressStatus } from './DeviceMeshIngressPanel';
import { ProviderCredentialTransferPanel } from './ProviderCredentialTransferPanel';
import { deviceEditorSourceKey } from './device-editor-state';
import {
  type MeshCapability,
  type MeshDevice,
  type MeshGrant,
  useDeviceMesh,
} from './use-device-mesh';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

function grantsFromOperations(capabilities: MeshCapability[], selected: Set<string>): MeshGrant[] {
  return capabilities
    .map((capability) => ({
      capability: capability.id,
      version: capability.version,
      operations: capability.operations.filter((operation) =>
        selected.has(`${capability.id}:${operation}`),
      ),
    }))
    .filter((grant) => grant.operations.length > 0);
}

function operationsFromGrants(grants: MeshGrant[]): Set<string> {
  return new Set(
    grants.flatMap((grant) =>
      grant.operations.map((operation) => `${grant.capability}:${operation}`),
    ),
  );
}

function PermissionGrid({
  capabilities,
  selected,
  onChange,
}: {
  capabilities: MeshCapability[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {capabilities
        .filter((capability) => capability.id !== 'device-core' && capability.id !== 'workspace')
        .map((capability) => (
          <div key={capability.id} className="border-l border-[var(--border-subtle)] py-1 pl-3">
            <div className="font-mono text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--accent)]">
              {capability.id}@{capability.version}
            </div>
            <div className="mt-2 grid gap-1.5">
              {capability.operations.map((operation) => {
                const key = `${capability.id}:${operation}`;
                return (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-[var(--text-12)] text-[var(--fg-secondary)]"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(key);
                        else next.delete(key);
                        onChange(next);
                      }}
                    />
                    <span className="font-mono">{operation}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

export function DeviceCard({
  device,
  selfDeviceId,
  connected,
  connectionError,
  capabilities,
  busy,
  onSave,
  onRevoke,
}: {
  device: MeshDevice;
  selfDeviceId: string;
  connected: boolean;
  connectionError?: string;
  capabilities: MeshCapability[];
  busy: boolean;
  onSave: (update: Partial<MeshDevice>) => void;
  onRevoke: () => void;
}) {
  const isSelf = device.id === selfDeviceId;
  const [name, setName] = React.useState(device.name);
  const [endpoint, setEndpoint] = React.useState(device.endpoints[0] ?? '');
  const [administrator, setAdministrator] = React.useState(device.administrator);
  const [selected, setSelected] = React.useState(() => operationsFromGrants(device.grants));
  const sourceKey = deviceEditorSourceKey(device);

  React.useEffect(() => {
    setName(device.name);
    setEndpoint(device.endpoints[0] ?? '');
    setAdministrator(device.administrator);
    setSelected(operationsFromGrants(device.grants));
  }, [sourceKey]);

  return (
    <article className="py-5 first:pt-2 last:pb-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${connected || isSelf ? 'bg-[var(--green)] shadow-[var(--glow-green)]' : 'bg-[var(--muted-dim)]'}`}
            />
            <h3 className="text-[var(--text-14)] font-[var(--weight-semibold)] text-[var(--fg)]">
              {device.name}
            </h3>
            {isSelf ? (
              <span className="rounded bg-[var(--accent-subtle)] px-1.5 py-0.5 text-[var(--text-9)] font-[var(--weight-bold)] uppercase tracking-wider text-[var(--accent)]">
                This device
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-[var(--text-10)] text-[var(--muted-dim)]">
            {device.platform}
          </div>
        </div>
        <div className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wider text-[var(--muted)]">
          {connected || isSelf ? 'Reachable' : (connectionError ?? 'Offline')}
        </div>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-[var(--text-11)] text-[var(--muted)]">
          {isSelf ? 'Edit this device' : 'Permissions & settings'}
        </summary>
        <div className={`mt-4 grid gap-3 ${isSelf ? '' : 'sm:grid-cols-2'}`}>
          <label className="grid gap-1">
            <span className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wider text-[var(--muted-dim)]">
              Device name
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[var(--text-12)] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
            />
          </label>
          {!isSelf ? (
            <label className="grid gap-1">
              <span className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wider text-[var(--muted-dim)]">
                Public endpoint
              </span>
              <input
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="https://hub.example.com"
                className="rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-mono text-[var(--text-12)] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
              />
            </label>
          ) : null}
        </div>

        {!isSelf ? (
          <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[var(--text-11)] font-[var(--weight-semibold)] uppercase tracking-wider text-[var(--fg-secondary)]">
                  Allowed on this Hub
                </div>
                <div className="mt-0.5 text-[var(--text-11)] text-[var(--muted)]">
                  Unselected operations are denied. Discovery is always available to members.
                </div>
              </div>
              <label className="flex items-center gap-2 text-[var(--text-11)] text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={administrator}
                  onChange={(event) => setAdministrator(event.target.checked)}
                />
                Administrator
              </label>
            </div>
            <PermissionGrid
              capabilities={capabilities}
              selected={selected}
              onChange={setSelected}
            />
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => {
              const update: Partial<MeshDevice> = {
                name,
                administrator,
                grants: grantsFromOperations(capabilities, selected),
              };
              if (!isSelf) update.endpoints = endpoint.trim() ? [endpoint.trim()] : [];
              onSave(update);
            }}
            className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-3 py-2 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)] hover:bg-[var(--selected)] disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save device'}
          </button>
          {!isSelf ? (
            <button
              type="button"
              disabled={busy}
              onClick={onRevoke}
              className="rounded border border-[var(--red-border)] px-3 py-2 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--red)] hover:bg-[var(--red-subtle)] disabled:opacity-50"
            >
              Revoke
            </button>
          ) : null}
        </div>
      </details>
    </article>
  );
}

export function DeviceMeshSettingsTab({ requestJson }: { requestJson: RequestJson }) {
  const mesh = useDeviceMesh(requestJson);
  const [ingressStatus, setIngressStatus] = React.useState<DeviceMeshIngressStatus | null>(null);
  const [joinCode, setJoinCode] = React.useState('');
  const [showInvitation, setShowInvitation] = React.useState(false);
  const [copyNotice, setCopyNotice] = React.useState('');
  const [activeSection, setActiveSection] = React.useState<
    'network' | 'devices' | 'sharing' | 'credentials'
  >('devices');
  const [pendingSelections, setPendingSelections] = React.useState<Record<string, Set<string>>>({});
  const [pendingAdmins, setPendingAdmins] = React.useState<Record<string, boolean>>({});
  const [invitationRefreshTick, setInvitationRefreshTick] = React.useState(0);
  const invitationAttemptAt = React.useRef(0);
  const handleIngressStatus = React.useCallback(
    (status: DeviceMeshIngressStatus | null) => setIngressStatus(status),
    [],
  );
  const advertisedEndpoint = mesh.status
    ? (mesh.status.devices.find((device) => device.id === mesh.status?.selfDeviceId)
        ?.endpoints[0] ?? '')
    : (ingressStatus?.publicEndpoint ?? '');
  const visibleMeshError = mesh.error ?? mesh.invitationError;

  React.useEffect(() => {
    if (
      activeSection !== 'network' ||
      !showInvitation ||
      !ingressStatus?.running ||
      !advertisedEndpoint ||
      mesh.invitationBusy
    )
      return;

    let cancelled = false;
    let timer: number | null = null;
    const schedule = (delay: number) => {
      timer = window.setTimeout(() => {
        if (!cancelled && document.visibilityState === 'visible')
          setInvitationRefreshTick((value) => value + 1);
      }, delay);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') setInvitationRefreshTick((value) => value + 1);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    if (document.visibilityState === 'visible') {
      const requestRotation = () => {
        const sinceAttempt = Date.now() - invitationAttemptAt.current;
        if (sinceAttempt < INVITATION_STATUS_POLL_MS) {
          schedule(INVITATION_STATUS_POLL_MS - sinceAttempt);
          return;
        }
        invitationAttemptAt.current = Date.now();
        void mesh.createInvitation();
      };
      const rotate = (status: Awaited<ReturnType<typeof mesh.readInvitationStatus>> | null) => {
        if (!deviceMeshInvitationNeedsRotation(mesh.invitation, status, advertisedEndpoint)) {
          schedule(deviceMeshInvitationCheckDelay(mesh.invitation!.expiresAt));
          return;
        }
        requestRotation();
      };

      if (deviceMeshInvitationNeedsRotation(mesh.invitation, null, advertisedEndpoint)) {
        rotate(null);
      } else {
        void mesh
          .readInvitationStatus(mesh.invitation!.invitationId)
          .then((status) => {
            if (!cancelled) rotate(status);
          })
          .catch((nextError: any) => {
            if (cancelled) return;
            if (Number(nextError?.status) === 404) requestRotation();
            else schedule(INVITATION_STATUS_POLL_MS);
          });
      }
    }

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    activeSection,
    showInvitation,
    advertisedEndpoint,
    ingressStatus?.running,
    invitationRefreshTick,
    mesh.createInvitation,
    mesh.invitation,
    mesh.invitationBusy,
    mesh.readInvitationStatus,
  ]);

  if (mesh.loading && !mesh.status) {
    return (
      <div className="flex min-h-48 items-center justify-center gap-2 text-[var(--text-12)] text-[var(--muted)]">
        <IconSpinner className="h-4 w-4" /> Loading device network…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[20px] font-[var(--weight-semibold)] text-[var(--fg-strong)]">
          Devices
        </h1>
        {!!mesh.status?.pending.length && activeSection !== 'network' && (
          <button
            onClick={() => setActiveSection('network')}
            className="rounded-lg bg-[var(--accent-subtle)] border border-[var(--accent-muted)] px-4 py-2 text-[var(--text-12)] font-medium text-[var(--fg)]"
          >
            {mesh.status.pending.length} pairing request(s)
          </button>
        )}
      </div>

      <nav
        className="flex flex-wrap gap-5 border-b border-[var(--border-subtle)]"
        aria-label="Device settings"
      >
        {(
          [
            ['devices', 'Your devices'],
            ['network', 'Add device'],
            ['sharing', 'Workspace sharing'],
            ['credentials', 'Credentials'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={activeSection === id ? 'page' : undefined}
            onClick={() => setActiveSection(id)}
            className={`border-b-2 px-0.5 pb-2 text-[var(--text-11)] font-[var(--weight-semibold)] transition-colors ${
              activeSection === id
                ? 'border-[var(--accent)] text-[var(--fg)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg-secondary)]'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {visibleMeshError ? (
        <div className="border-l-2 border-[var(--red)] px-3 py-1 text-[var(--text-12)] text-[var(--red)]">
          {visibleMeshError}
        </div>
      ) : null}

      {activeSection === 'network' ? (
        <div className="flex flex-col gap-4">
          <section className="order-1">
            <div className="grid gap-3">
              <DeviceMeshIngressPanel requestJson={requestJson} onStatus={handleIngressStatus} />
            </div>
            <details
              open={showInvitation}
              className="rounded-lg border border-[var(--border-subtle)] p-4 mt-4"
              onToggle={(event) => setShowInvitation(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-[var(--text-12)] font-medium">
                Use a QR code
              </summary>
              {showInvitation && (
                <>
                  {!advertisedEndpoint ? (
                    <span className="text-[var(--text-10)] text-[var(--muted)]">
                      Enable Tailscale access first.
                    </span>
                  ) : !mesh.invitation ? (
                    <span className="flex items-center gap-2 text-[var(--text-10)] text-[var(--muted)]">
                      <IconSpinner className="h-3.5 w-3.5" /> Preparing a secure pairing code…
                    </span>
                  ) : null}
                  {mesh.invitation ? (
                    <div className="grid gap-4 border-t border-[var(--border-subtle)] py-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
                      <div
                        className="rounded bg-white p-2"
                        dangerouslySetInnerHTML={{ __html: mesh.invitation.qrSvg }}
                      />
                      <div>
                        <div className="text-[var(--text-13)] font-[var(--weight-semibold)] text-[var(--fg)]">
                          Scan from the phone’s Add device screen
                          {mesh.invitationBusy ? (
                            <span className="ml-2 text-[var(--text-10)] font-normal text-[var(--muted)]">
                              Refreshing…
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[var(--text-12)] text-[var(--muted)]">
                          Expires at {new Date(mesh.invitation.expiresAt).toLocaleTimeString()}. New
                          devices need your approval.
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            void copyText(JSON.stringify(mesh.invitation!.payload)).then((copied) =>
                              setCopyNotice(
                                copied ? 'Copied' : 'Could not copy. Use the QR code instead.',
                              ),
                            )
                          }
                          className="mt-2 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wider text-[var(--accent)]"
                        >
                          Copy pairing code
                        </button>
                        {copyNotice && (
                          <p role="status" className="text-[var(--text-11)] text-[var(--muted)]">
                            {copyNotice}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </details>
            <details className="rounded-lg border border-[var(--border-subtle)] p-4 mt-2">
              <summary className="cursor-pointer text-[var(--text-12)] font-medium">
                Enter a pairing code
              </summary>
              <div className="grid gap-3 border-t border-[var(--border-subtle)] py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <label className="grid gap-1">
                  <span className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wider text-[var(--muted-dim)]">
                    Pairing code
                  </span>
                  <textarea
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value)}
                    rows={3}
                    placeholder="Paste a code from the other Hub"
                    className="resize-y rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-mono text-[var(--text-11)] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
                  />
                </label>
                <button
                  type="button"
                  disabled={mesh.busyId === 'join' || !joinCode.trim()}
                  onClick={() => void mesh.join(joinCode)}
                  className="h-9 rounded border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-4 text-[var(--text-11)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--fg)] hover:bg-[var(--hover)] disabled:opacity-50"
                >
                  {mesh.busyId === 'join' ? 'Waiting for approval…' : 'Request to join'}
                </button>
              </div>
            </details>
          </section>

          <details className="order-2 text-[var(--text-11)] text-[var(--muted)]">
            <summary className="cursor-pointer">Security & network details</summary>
            <p className="mt-1 max-w-3xl text-[var(--text-11)] leading-relaxed text-[var(--muted)]">
              Device signatures protect identity and destination permissions. A bridge Hub can still
              read ordinary payloads it forwards because this milestone uses TLS between devices.
              Provider credential transfers are separately encrypted for the receiving device.
            </p>
            <p className="mt-2 font-mono break-all">{mesh.status?.networkId}</p>
          </details>

          {mesh.status?.pending.map((pending) => {
            const existing = mesh.status?.devices.find(
              (device) => device.id === pending.device.id && !device.revokedAt,
            );
            const selected =
              pendingSelections[pending.id] ?? operationsFromGrants(existing?.grants ?? []);
            const administrator = pendingAdmins[pending.id] ?? existing?.administrator ?? false;
            return (
              <section
                key={pending.id}
                className="order-first rounded-lg border border-[var(--yellow-border)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wider text-[var(--yellow)]">
                      {existing ? 'Connection recovery' : 'Approval requested'}
                    </div>
                    <h3 className="mt-1 text-[15px] font-[var(--weight-semibold)] text-[var(--fg)]">
                      {pending.device.name}
                    </h3>
                    <div className="text-[var(--text-10)] text-[var(--muted-dim)]">
                      {pending.device.platform}
                    </div>
                  </div>
                  <div className="text-[var(--text-11)] text-[var(--muted)]">
                    {existing ? 'Existing permissions are preserved' : 'Default: deny all controls'}
                  </div>
                </div>
                {existing ? (
                  <p className="mt-4 text-[var(--text-11)] leading-relaxed text-[var(--muted)]">
                    This request only repairs connectivity. Change this device's permissions later
                    from Trusted devices.
                  </p>
                ) : (
                  <>
                    <details className="mt-4">
                      <summary className="cursor-pointer text-[var(--text-12)]">
                        Permissions · {selected.size} selected
                        {administrator ? ' · Administrator' : ''}
                      </summary>
                      <div className="mt-3">
                        <PermissionGrid
                          capabilities={mesh.status!.capabilities}
                          selected={selected}
                          onChange={(next) =>
                            setPendingSelections((current) => ({ ...current, [pending.id]: next }))
                          }
                        />
                      </div>
                      <label className="mt-3 flex items-center gap-2 text-[var(--text-11)] text-[var(--muted)]">
                        <input
                          type="checkbox"
                          checked={administrator}
                          onChange={(event) =>
                            setPendingAdmins((current) => ({
                              ...current,
                              [pending.id]: event.target.checked,
                            }))
                          }
                        />
                        Make this device an administrator. Administrators can invite devices and
                        receive separately granted provider credential copies.
                      </label>
                    </details>
                  </>
                )}
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    disabled={mesh.busyId === pending.id}
                    onClick={() =>
                      void mesh.approve(
                        pending.id,
                        grantsFromOperations(mesh.status!.capabilities, selected),
                        administrator,
                      )
                    }
                    className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-3 py-2 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)] disabled:opacity-50"
                  >
                    Approve device
                  </button>
                  <button
                    type="button"
                    disabled={mesh.busyId === pending.id}
                    onClick={() => void mesh.reject(pending.id)}
                    className="rounded border border-[var(--border-subtle)] px-3 py-2 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--muted)] disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {activeSection === 'devices' ? (
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[var(--text-11)] text-[var(--muted)]">
                {mesh.status?.devices.filter((device) => !device.revokedAt).length ?? 0} devices
              </p>
            </div>
            <div className="text-[var(--text-10)] uppercase tracking-wider text-[var(--muted-dim)]">
              Live status
            </div>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {mesh.status?.devices
              .filter((device) => !device.revokedAt)
              .map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  selfDeviceId={mesh.status!.selfDeviceId}
                  connected={mesh.status!.connectedDeviceIds.includes(device.id)}
                  connectionError={mesh.status!.connectionErrors?.[device.id]}
                  capabilities={mesh.status!.capabilities}
                  busy={mesh.busyId === device.id}
                  onSave={(update) => void mesh.saveDevice(device.id, update)}
                  onRevoke={() => {
                    if (window.confirm(`Revoke ${device.name}? It will lose access immediately.`))
                      void mesh.revoke(device.id);
                  }}
                />
              ))}
          </div>
        </section>
      ) : null}

      {activeSection === 'credentials' ? (
        <ProviderCredentialTransferPanel
          requestJson={requestJson}
          devices={mesh.status?.devices ?? []}
          selfDeviceId={mesh.status?.selfDeviceId ?? ''}
        />
      ) : null}

      {activeSection === 'sharing' ? (
        <CrossDeviceAssistantPolicyPanel
          requestJson={requestJson}
          devices={mesh.status?.devices ?? []}
          selfDeviceId={mesh.status?.selfDeviceId ?? ''}
          connectedDeviceIds={mesh.status?.connectedDeviceIds ?? []}
          mode="sharing"
        />
      ) : null}
    </div>
  );
}
