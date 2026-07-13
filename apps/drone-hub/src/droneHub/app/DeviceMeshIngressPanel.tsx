import React from 'react';
import { IconSpinner } from './icons';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

export type DeviceMeshIngressStatus = {
  host: '127.0.0.1';
  port: number;
  running: boolean;
  publicEndpoint: string | null;
  endpointSource: 'manual' | 'ngrok' | null;
  error: string | null;
  ngrok: { url: string | null; error: string | null };
};

type IngressResponse = { ok: true; status: DeviceMeshIngressStatus };

export function DeviceMeshIngressPanel({
  requestJson,
  onStatus,
}: {
  requestJson: RequestJson;
  onStatus: (status: DeviceMeshIngressStatus | null) => void;
}) {
  const [status, setStatus] = React.useState<DeviceMeshIngressStatus | null>(null);
  const [port, setPort] = React.useState('8791');
  const [publicEndpoint, setPublicEndpoint] = React.useState('');
  const [busy, setBusy] = React.useState<'save' | 'detect' | 'start' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const applyStatus = React.useCallback(
    (next: DeviceMeshIngressStatus) => {
      setStatus(next);
      setPort(String(next.port));
      setPublicEndpoint(next.publicEndpoint ?? '');
      onStatus(next);
    },
    [onStatus],
  );

  const readStatus = React.useCallback(async () => {
    const response = await requestJson<IngressResponse>('/api/device-mesh/ingress');
    applyStatus(response.status);
    return response.status;
  }, [applyStatus, requestJson]);

  React.useEffect(() => {
    let cancelled = false;
    void readStatus()
      .then(async (initial) => {
        if (cancelled || initial.endpointSource === 'manual') return;
        try {
          const detected = await requestJson<IngressResponse>(
            '/api/device-mesh/ingress/ngrok/detect',
            { method: 'POST' },
          );
          if (!cancelled) applyStatus(detected.status);
        } catch {
          // Not having ngrok running is a normal state; explicit actions show errors.
        }
      })
      .catch((nextError: any) => {
        if (!cancelled) setError(nextError?.message ?? String(nextError));
      });
    return () => {
      cancelled = true;
    };
  }, [applyStatus, onStatus, readStatus, requestJson]);

  const run = React.useCallback(
    async (kind: 'save' | 'detect' | 'start', action: () => Promise<void>) => {
      setBusy(kind);
      setError(null);
      try {
        await action();
      } catch (nextError: any) {
        setError(nextError?.message ?? String(nextError));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const configurePortForNgrok = React.useCallback(async () => {
    if (Number(port) === status?.port) return;
    const response = await requestJson<IngressResponse>('/api/device-mesh/ingress', {
      method: 'PUT',
      body: JSON.stringify({ port: Number(port), publicEndpoint: '' }),
    });
    applyStatus(response.status);
  }, [applyStatus, port, requestJson, status?.port]);

  const waitForNgrokUrl = React.useCallback(async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const next = await readStatus();
      if (next.publicEndpoint && next.endpointSource === 'ngrok') return;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error('ngrok started, but no tunnel URL appeared. Check the mesh ngrok log.');
  }, [readStatus]);

  if (!status) {
    return (
      <div className="flex min-h-24 flex-col items-center justify-center gap-2 rounded border border-[var(--border-subtle)] px-3 text-center text-[11px] text-[var(--muted)]">
        {error ? (
          <>
            <span className="text-[var(--red)]">{error}</span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                void readStatus().catch((nextError: any) =>
                  setError(nextError?.message ?? String(nextError)),
                );
              }}
              className="font-semibold uppercase tracking-wider text-[var(--accent)]"
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <IconSpinner className="h-3.5 w-3.5" /> Loading secure mesh ingress…
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold text-[var(--fg-secondary)]">
            Secure mesh ingress
          </div>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[var(--muted)]">
            Only pairing, health, and authenticated device WebSockets are exposed on this port. The
            Drone Hub UI and local administration API stay private.
          </p>
        </div>
        <span
          className={`rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${status.running ? 'bg-[rgba(34,197,94,.1)] text-[var(--green)]' : 'bg-[rgba(248,113,113,.1)] text-[var(--red)]'}`}
        >
          {status.running ? `Localhost:${status.port}` : 'Not running'}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
        <label className="grid gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-dim)]">
            Local port
          </span>
          <input
            inputMode="numeric"
            value={port}
            onChange={(event) => setPort(event.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--input)] px-3 py-2 font-mono text-[12px] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
          />
        </label>
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
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run('save', async () => {
              const response = await requestJson<IngressResponse>('/api/device-mesh/ingress', {
                method: 'PUT',
                body: JSON.stringify({ port: Number(port), publicEndpoint }),
              });
              applyStatus(response.status);
            })
          }
          className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg)] disabled:opacity-50"
        >
          {busy === 'save' ? 'Saving…' : 'Save endpoint'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run('detect', async () => {
              await configurePortForNgrok();
              const response = await requestJson<IngressResponse>(
                '/api/device-mesh/ingress/ngrok/detect',
                { method: 'POST' },
              );
              applyStatus(response.status);
            })
          }
          className="rounded border border-[var(--border-subtle)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-secondary)] disabled:opacity-50"
        >
          {busy === 'detect' ? 'Detecting…' : 'Detect ngrok'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run('start', async () => {
              await configurePortForNgrok();
              const response = await requestJson<IngressResponse & { process: unknown }>(
                '/api/device-mesh/ingress/ngrok/start',
                { method: 'POST' },
              );
              applyStatus(response.status);
              if (!response.status.publicEndpoint) await waitForNgrokUrl();
            })
          }
          className="rounded border border-[var(--border-subtle)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-secondary)] disabled:opacity-50"
        >
          {busy === 'start' ? 'Starting…' : 'Start ngrok'}
        </button>
      </div>

      <div className="mt-2 text-[10px] text-[var(--muted)]">
        {status.endpointSource === 'ngrok'
          ? 'ngrok-managed: URL changes are detected and signed route updates are sent to peers.'
          : status.publicEndpoint
            ? 'Manual endpoint: Drone Hub will keep using this URL until you change it.'
            : 'Set a manual HTTPS URL, detect an existing ngrok tunnel, or start one here.'}
      </div>
      {error || status.error ? (
        <div className="mt-2 text-[11px] text-[var(--red)]">{error ?? status.error}</div>
      ) : null}
    </div>
  );
}
