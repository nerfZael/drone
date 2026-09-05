import React from 'react';
import { copyText } from './clipboard';
import { PhoneDiscoveryPanel } from './PhoneDiscoveryPanel';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;
export type DeviceMeshIngressStatus = {
  host: '127.0.0.1';
  port: number;
  running: boolean;
  publicEndpoint: string | null;
  endpointSource: 'manual' | 'tailscale' | null;
  error: string | null;
  tailscale: { connected: boolean; dnsName: string; error: string | null };
};
type DiscoveredHub = {
  deviceId: string;
  name: string;
  endpoint: string;
  paired: boolean;
  machineName: string;
};
type IngressResponse = { ok: true; status: DeviceMeshIngressStatus };
type DiscoveryState =
  | { phase: 'idle' }
  | { phase: 'scanning' }
  | { phase: 'done'; count: number }
  | { phase: 'failed'; message: string };
const button =
  'rounded border border-[var(--border)] px-3 py-2 text-[var(--text-11)] disabled:opacity-50';
const input =
  'rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[var(--text-12)]';

export function DeviceMeshIngressPanel({
  requestJson,
  onStatus,
}: {
  requestJson: RequestJson;
  onStatus: (status: DeviceMeshIngressStatus | null) => void;
}) {
  const [status, setStatus] = React.useState<DeviceMeshIngressStatus | null>(null);
  const [port, setPort] = React.useState('8791');
  const [endpoint, setEndpoint] = React.useState('');
  const [devices, setDevices] = React.useState<DiscoveredHub[]>([]);
  const [discovery, setDiscovery] = React.useState<DiscoveryState>({ phase: 'idle' });
  const scanSequence = React.useRef(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [setupError, setSetupError] = React.useState<{
    message: string;
    code: string;
    details: string;
  } | null>(null);
  const [notice, setNotice] = React.useState('');
  const alive = React.useRef(true);
  const apply = React.useCallback(
    (next: DeviceMeshIngressStatus) => {
      if (!alive.current) return;
      setStatus(next);
      setPort(String(next.port));
      setEndpoint(next.publicEndpoint ?? '');
      onStatus(next);
    },
    [onStatus],
  );
  const scan = React.useCallback(async () => {
    const sequence = ++scanSequence.current;
    setDiscovery({ phase: 'scanning' });
    try {
      const result = await requestJson<{ devices: DiscoveredHub[] }>('/api/device-mesh/discovery');
      if (!alive.current || sequence !== scanSequence.current) return;
      setDevices(result.devices);
      setDiscovery({ phase: 'done', count: result.devices.length });
    } catch (error: any) {
      if (alive.current && sequence === scanSequence.current)
        setDiscovery({ phase: 'failed', message: error?.message ?? String(error) });
      throw error;
    }
    // Status refresh failure must not turn a successful scan into an empty/error result.
    const ingress = await requestJson<IngressResponse>('/api/device-mesh/ingress');
    if (sequence === scanSequence.current) apply(ingress.status);
  }, [requestJson, apply]);
  React.useEffect(() => {
    alive.current = true;
    void requestJson<IngressResponse>('/api/device-mesh/ingress')
      .then((value) => apply(value.status))
      .catch((error) => {
        if (alive.current) setError(String(error.message ?? error));
      });
    void scan().catch(() => undefined);
    return () => {
      alive.current = false;
    };
  }, [requestJson, apply, scan]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setSetupError(null);
    try {
      await action();
    } catch (error: any) {
      if (alive.current) setError(error?.message ?? String(error));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const enableTailscale = () =>
    run(async () => {
      try {
        const result = await requestJson<IngressResponse>('/api/device-mesh/ingress/tailscale', {
          method: 'POST',
        });
        apply(result.status);
      } catch (error: any) {
        if (alive.current)
          setSetupError({
            message: error?.message ?? String(error),
            code: typeof error?.data?.code === 'string' ? error.data.code : '',
            details: typeof error?.data?.details === 'string' ? error.data.details : '',
          });
        return;
      }
      await scan();
    });
  return (
    <div className="grid gap-3 py-2 text-[var(--fg)]">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] px-4 py-3">
        <span className="text-[var(--text-12)]">
          {status?.publicEndpoint && status.running ? 'Ready to pair' : 'Set up private access'}
        </span>
        {!(status?.publicEndpoint && status.running) && (
          <button
            className={button}
            disabled={busy || !status?.running}
            onClick={() => void enableTailscale()}
          >
            Enable Tailscale access
          </button>
        )}
      </div>
      <p className="text-[var(--text-12)] text-[var(--muted)]">
        Open Devices → Add device on the other device.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-lg border border-[var(--border-subtle)] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[var(--text-12)] font-medium">Computers</h3>
            <button
              className={button}
              disabled={busy || discovery.phase === 'scanning'}
              onClick={() => void run(scan)}
            >
              {discovery.phase === 'scanning' ? 'Searching…' : 'Refresh'}
            </button>
          </div>
          <DroneHubDiscoveryStatus state={discovery} />
          {devices.map((device) => (
            <div key={device.deviceId} className="flex items-center justify-between gap-2">
              <span>{device.name}</span>
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (device.paired) {
                      await scan();
                      setNotice(
                        'Route refreshed. Your paired device will reconnect automatically.',
                      );
                      return;
                    }
                    const result = await requestJson<{ joinId: string }>(
                      '/api/device-mesh/joins-discovered',
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          endpoint: device.endpoint,
                          deviceId: device.deviceId,
                        }),
                      },
                    );
                    setNotice('Approve this pairing request on ' + device.name + '.');
                    const deadline = Date.now() + 6 * 60_000;
                    while (alive.current && Date.now() < deadline) {
                      await new Promise((resolve) => setTimeout(resolve, 2_000));
                      if (!alive.current) return;
                      const state = await requestJson<{ status: string; error?: string }>(
                        '/api/device-mesh/joins/' + encodeURIComponent(result.joinId),
                      );
                      if (state.status === 'failed')
                        throw new Error(state.error ?? 'Pairing failed');
                      if (state.status === 'approved') {
                        setNotice('Paired with ' + device.name);
                        await scan();
                        return;
                      }
                    }
                    if (alive.current) throw new Error('Pairing approval timed out');
                  })
                }
              >
                {device.paired ? 'Connect' : 'Pair'}
              </button>
            </div>
          ))}
        </section>
        <PhoneDiscoveryPanel requestJson={requestJson} />
      </div>
      <details>
        <summary className="cursor-pointer text-[var(--text-11)]">Connection settings</summary>
        <div className="mt-2 grid gap-2">
          <p className="text-[var(--text-11)] text-[var(--muted)]">
            {status?.tailscale?.connected
              ? status.tailscale.dnsName
              : (status?.tailscale?.error ?? 'Tailscale is not connected.')}
          </p>
          {status?.publicEndpoint && (
            <button
              className={button}
              onClick={() =>
                void copyText(status.publicEndpoint!).then((copied) => {
                  if (copied) setNotice('Address copied');
                  else setError('Could not copy the address.');
                })
              }
            >
              Copy Hub address
            </button>
          )}
          {status?.publicEndpoint && (
            <button
              className={button}
              disabled={busy || !status.running}
              onClick={() => void enableTailscale()}
            >
              Reconfigure Tailscale access
            </button>
          )}
          <label>
            Local port{' '}
            <input
              className={input}
              value={port}
              onChange={(event) => setPort(event.target.value)}
            />
          </label>
          <label>
            HTTPS endpoint{' '}
            <input
              className={input}
              value={endpoint}
              placeholder="https://your-hub.example.ts.net:8791"
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </label>
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await requestJson<IngressResponse>('/api/device-mesh/ingress', {
                  method: 'PUT',
                  body: JSON.stringify({ port: Number(port), publicEndpoint: endpoint }),
                });
                apply(result.status);
              })
            }
          >
            Save endpoint
          </button>
        </div>
      </details>
      {notice && <p className="text-[var(--text-11)]">{notice}</p>}
      {setupError && (
        <TailscaleSetupAlert
          error={setupError}
          busy={busy}
          onRetry={() => void enableTailscale()}
        />
      )}
      {(error || status?.error) && (
        <p role="alert" className="text-[var(--red)]">
          {error ?? status?.error}
        </p>
      )}
    </div>
  );
}

export function DroneHubDiscoveryStatus({ state }: { state: DiscoveryState }) {
  if (state.phase === 'idle') return null;
  const message =
    state.phase === 'scanning'
      ? 'Looking for DroneHubs on your Tailscale network…'
      : state.phase === 'failed'
        ? `Could not find DroneHubs: ${state.message}`
        : state.count === 0
          ? 'No computers found. Check Tailscale access on the other Hub.'
          : `Found ${state.count} DroneHub${state.count === 1 ? '' : 's'}.`;
  return (
    <p role="status" aria-live="polite" className="text-[var(--text-11)] text-[var(--muted)]">
      {message}
    </p>
  );
}

export function TailscaleSetupAlert({
  error,
  busy,
  onRetry,
}: {
  error: { message: string; code: string; details: string };
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="grid gap-2">
      <p className="text-[var(--red)]">{error.message}</p>
      <div className="flex gap-2">
        {error.code === 'TAILSCALE_HTTPS_REQUIRED' && (
          <a
            className={button}
            href="https://login.tailscale.com/admin/dns"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Tailscale DNS settings
          </a>
        )}
        <button className={button} disabled={busy} onClick={onRetry}>
          Retry
        </button>
      </div>
      {error.details && (
        <details>
          <summary>Technical details</summary>
          <pre className="whitespace-pre-wrap break-words text-[var(--text-11)]">
            {error.details}
          </pre>
        </details>
      )}
    </div>
  );
}
