import React from 'react';
import { IconSpinner } from './icons';
import { CrossDeviceAssistantPolicyPanel } from './CrossDeviceAssistantPolicyPanel';
import { ProviderCredentialTransferPanel } from './ProviderCredentialTransferPanel';
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
        .filter((capability) => capability.id !== 'device-core')
        .map((capability) => (
          <div
            key={capability.id}
            className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-3"
          >
            <div className="font-mono text-[11px] font-semibold text-[var(--accent)]">
              {capability.id}@{capability.version}
            </div>
            <div className="mt-2 grid gap-1.5">
              {capability.operations.map((operation) => {
                const key = `${capability.id}:${operation}`;
                return (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-[12px] text-[var(--fg-secondary)]"
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

function DeviceCard({
  device,
  selfDeviceId,
  connected,
  capabilities,
  busy,
  onSave,
  onRevoke,
}: {
  device: MeshDevice;
  selfDeviceId: string;
  connected: boolean;
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

  React.useEffect(() => {
    setName(device.name);
    setEndpoint(device.endpoints[0] ?? '');
    setAdministrator(device.administrator);
    setSelected(operationsFromGrants(device.grants));
  }, [device]);

  return (
    <article
      className={`rounded-lg border p-4 ${connected ? 'border-[rgba(34,197,94,.35)] bg-[rgba(34,197,94,.035)]' : 'border-[var(--border-subtle)] bg-[var(--panel-alt)]'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${connected || isSelf ? 'bg-[var(--green)] shadow-[0_0_10px_rgba(34,197,94,.55)]' : 'bg-[var(--muted-dim)]'}`}
            />
            <h3 className="text-[14px] font-semibold text-[var(--fg)]">{device.name}</h3>
            {isSelf ? (
              <span className="rounded bg-[var(--accent-subtle)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--accent)]">
                This device
              </span>
            ) : null}
          </div>
          <div className="mt-1 font-mono text-[10px] text-[var(--muted-dim)]">
            {device.id} · {device.platform}
          </div>
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          {connected || isSelf ? 'Reachable' : 'Offline'}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-dim)]">
            Device name
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-[12px] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-dim)]">
            Public endpoint
          </span>
          <input
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder="https://hub.example.com"
            className="rounded border border-[var(--border)] bg-[var(--input)] px-3 py-2 font-mono text-[12px] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
          />
        </label>
      </div>

      {!isSelf ? (
        <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">
                Allowed on this Hub
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                Unselected operations are denied. Discovery is always available to members.
              </div>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <input
                type="checkbox"
                checked={administrator}
                onChange={(event) => setAdministrator(event.target.checked)}
              />
              Administrator
            </label>
          </div>
          <PermissionGrid capabilities={capabilities} selected={selected} onChange={setSelected} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() =>
            onSave({
              name,
              endpoints: endpoint.trim() ? [endpoint.trim()] : [],
              administrator,
              grants: grantsFromOperations(capabilities, selected),
            })
          }
          className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-3 py-2 text-[11px] font-semibold text-[var(--fg)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save device'}
        </button>
        {!isSelf ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRevoke}
            className="rounded border border-[rgba(248,113,113,.35)] px-3 py-2 text-[11px] font-semibold text-[var(--red)] hover:bg-[rgba(248,113,113,.08)] disabled:opacity-50"
          >
            Revoke
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function DeviceMeshSettingsTab({ requestJson }: { requestJson: RequestJson }) {
  const mesh = useDeviceMesh(requestJson);
  const [publicEndpoint, setPublicEndpoint] = React.useState(() => window.location.origin);
  const [joinCode, setJoinCode] = React.useState('');
  const [pendingSelections, setPendingSelections] = React.useState<Record<string, Set<string>>>({});
  const [pendingAdmins, setPendingAdmins] = React.useState<Record<string, boolean>>({});

  if (mesh.loading && !mesh.status) {
    return (
      <div className="flex min-h-48 items-center justify-center gap-2 text-[12px] text-[var(--muted)]">
        <IconSpinner className="h-4 w-4" /> Loading device network…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-[var(--accent-muted)] bg-[var(--panel-alt)]">
        <div className="border-b border-[var(--border-subtle)] bg-[linear-gradient(110deg,rgba(56,189,248,.09),transparent_55%)] p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-[var(--accent)]">
            Device mesh
          </div>
          <h2 className="mt-1 text-[18px] font-semibold text-[var(--fg)]">
            A private route between your Hubs
          </h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[var(--muted)]">
            Pair with a one-time QR code, then grant only the operations each device needs. There is
            no account or coordination service.
          </p>
          {mesh.status ? (
            <div className="mt-3 font-mono text-[10px] text-[var(--muted-dim)]">
              {mesh.status.networkId}
            </div>
          ) : null}
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-dim)]">
              Reachable HTTPS endpoint
            </span>
            <input
              value={publicEndpoint}
              onChange={(event) => setPublicEndpoint(event.target.value)}
              placeholder="https://your-hub.ngrok.app"
              className="rounded border border-[var(--border)] bg-[var(--input)] px-3 py-2 font-mono text-[12px] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
            />
            <span className="text-[10px] text-[var(--muted)]">
              This address is embedded in the invitation; it is never treated as proof of identity.
            </span>
          </label>
          <button
            type="button"
            disabled={mesh.busyId === 'invite' || !publicEndpoint.trim()}
            onClick={() => void mesh.createInvitation(publicEndpoint)}
            className="h-9 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
          >
            {mesh.busyId === 'invite' ? 'Creating…' : 'Create pairing QR'}
          </button>
        </div>
        {mesh.invitation ? (
          <div className="grid gap-4 border-t border-[var(--border-subtle)] p-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
            <div
              className="rounded bg-white p-2"
              dangerouslySetInnerHTML={{ __html: mesh.invitation.qrSvg }}
            />
            <div>
              <div className="text-[13px] font-semibold text-[var(--fg)]">
                Scan or copy to another Hub
              </div>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                The request still has to be approved below. This code expires at{' '}
                {new Date(mesh.invitation.expiresAt).toLocaleTimeString()}.
              </p>
              <textarea
                readOnly
                rows={4}
                value={JSON.stringify(mesh.invitation.payload)}
                className="mt-3 w-full resize-none rounded border border-[var(--border)] bg-[var(--input)] p-2 font-mono text-[10px] text-[var(--muted)]"
              />
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(JSON.stringify(mesh.invitation!.payload))
                }
                className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]"
              >
                Copy pairing code
              </button>
            </div>
          </div>
        ) : null}
        <div className="grid gap-3 border-t border-[var(--border-subtle)] p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-dim)]">
              Join from another Hub
            </span>
            <textarea
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value)}
              rows={3}
              placeholder="Paste the pairing JSON shown on the other computer"
              className="resize-y rounded border border-[var(--border)] bg-[var(--input)] px-3 py-2 font-mono text-[11px] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
            />
          </label>
          <button
            type="button"
            disabled={mesh.busyId === 'join' || !joinCode.trim()}
            onClick={() => void mesh.join(joinCode)}
            className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg)] hover:bg-[var(--hover)] disabled:opacity-50"
          >
            {mesh.busyId === 'join' ? 'Waiting for approval…' : 'Request to join'}
          </button>
        </div>
      </section>

      {mesh.error ? (
        <div className="rounded border border-[rgba(248,113,113,.35)] bg-[rgba(248,113,113,.08)] px-3 py-2 text-[12px] text-[var(--red)]">
          {mesh.error}
        </div>
      ) : null}

      <section className="rounded-lg border border-[rgba(250,204,21,.34)] bg-[rgba(250,204,21,.045)] p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--yellow)]">
          Prototype forwarding trust
        </div>
        <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[var(--muted)]">
          Device signatures protect identity and destination permissions. A bridge Hub can still
          read ordinary payloads it forwards because this milestone uses TLS between devices.
          Provider credential transfers are separately encrypted for the receiving device.
        </p>
      </section>

      {mesh.status?.pending.map((pending) => {
        const selected = pendingSelections[pending.id] ?? new Set<string>();
        return (
          <section
            key={pending.id}
            className="rounded-lg border border-[rgba(250,204,21,.38)] bg-[rgba(250,204,21,.045)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--yellow)]">
                  Approval requested
                </div>
                <h3 className="mt-1 text-[15px] font-semibold text-[var(--fg)]">
                  {pending.device.name}
                </h3>
                <div className="font-mono text-[10px] text-[var(--muted-dim)]">
                  {pending.device.id} · {pending.device.platform}
                </div>
              </div>
              <div className="text-[11px] text-[var(--muted)]">Default: deny all controls</div>
            </div>
            <div className="mt-4">
              <PermissionGrid
                capabilities={mesh.status!.capabilities}
                selected={selected}
                onChange={(next) =>
                  setPendingSelections((current) => ({ ...current, [pending.id]: next }))
                }
              />
            </div>
            <label className="mt-3 flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <input
                type="checkbox"
                checked={pendingAdmins[pending.id] === true}
                onChange={(event) =>
                  setPendingAdmins((current) => ({
                    ...current,
                    [pending.id]: event.target.checked,
                  }))
                }
              />
              Make this device an administrator. Administrators can invite devices and receive
              separately granted provider credential copies.
            </label>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={mesh.busyId === pending.id}
                onClick={() =>
                  void mesh.approve(
                    pending.id,
                    grantsFromOperations(mesh.status!.capabilities, selected),
                    pendingAdmins[pending.id] === true,
                  )
                }
                className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-3 py-2 text-[11px] font-semibold text-[var(--fg)] disabled:opacity-50"
              >
                Approve device
              </button>
              <button
                type="button"
                disabled={mesh.busyId === pending.id}
                onClick={() => void mesh.reject(pending.id)}
                className="rounded border border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold text-[var(--muted)] disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </section>
        );
      })}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--fg)]">Known devices</h2>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Permissions shown here apply only to actions targeting this Hub.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void mesh.load()}
            disabled={mesh.loading}
            className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)] disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
        <div className="grid gap-3">
          {mesh.status?.devices
            .filter((device) => !device.revokedAt)
            .map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                selfDeviceId={mesh.status!.selfDeviceId}
                connected={mesh.status!.connectedDeviceIds.includes(device.id)}
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
      <ProviderCredentialTransferPanel
        requestJson={requestJson}
        devices={mesh.status?.devices ?? []}
        selfDeviceId={mesh.status?.selfDeviceId ?? ''}
      />
      <CrossDeviceAssistantPolicyPanel
        requestJson={requestJson}
        devices={mesh.status?.devices ?? []}
        selfDeviceId={mesh.status?.selfDeviceId ?? ''}
      />
    </div>
  );
}
