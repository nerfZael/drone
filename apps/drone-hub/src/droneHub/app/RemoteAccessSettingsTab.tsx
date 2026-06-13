import React from 'react';
import { useRemoteAccess } from './use-remote-access';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type RemoteAccessSettingsTabProps = {
  requestJson: RequestJsonFn;
};

export function RemoteAccessSettingsTab({ requestJson }: RemoteAccessSettingsTabProps) {
  const remote = useRemoteAccess(requestJson);
  const url = remote.status?.state?.url ?? '';
  const running = remote.status?.running === true;
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
              Remote mini Hub
            </h3>
            <div className="mt-1 text-[12px] text-[var(--muted)]">
              Exposes a trimmed container-drone surface. The full Hub token stays server-side.
            </div>
          </div>
          <div className={`rounded border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${remote.status?.running ? 'border-[rgba(34,197,94,.35)] text-[var(--green)] bg-[rgba(34,197,94,.08)]' : 'border-[var(--border-subtle)] text-[var(--muted)] bg-[rgba(255,255,255,.02)]'}`}>
            {remote.loading ? 'Checking' : remote.status?.running ? 'Running' : 'Stopped'}
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide text-[var(--muted-dim)] font-semibold">ngrok public URL</span>
              <button
                type="button"
                onClick={() => void remote.detectNgrokPublicUrl()}
                disabled={remote.detectingNgrok || !remote.portValid}
                className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-50"
              >
                {remote.detectingNgrok ? 'Detecting...' : 'Detect ngrok'}
              </button>
            </span>
            <input
              value={remote.publicUrl}
              onChange={(event) => remote.setPublicUrl(event.target.value)}
              placeholder="https://example.ngrok-free.app"
              className="rounded border border-[var(--border)] bg-[var(--input)] px-3 py-2 font-mono text-[12px] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
            />
          </label>
          <label className="grid gap-1 sm:max-w-[180px]">
            <span className="text-[10px] uppercase tracking-wide text-[var(--muted-dim)] font-semibold">Local port</span>
            <input
              value={remote.port}
              onChange={(event) => remote.setPort(event.target.value.replace(/[^\d]/g, '').slice(0, 5))}
              inputMode="numeric"
              className="rounded border border-[var(--border)] bg-[var(--input)] px-3 py-2 font-mono text-[12px] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
            />
          </label>
          <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-[var(--muted-dim)] font-semibold">Remote URL</div>
            <div className="mt-1 break-all font-mono text-[12px] text-[var(--fg)]">{url || 'Start remote Hub after pasting your ngrok URL.'}</div>
          </div>
          {remote.status?.state?.logPath ? (
            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--muted-dim)] font-semibold">Log</div>
              <div className="mt-1 break-all font-mono text-[12px] text-[var(--muted)]">{remote.status.state.logPath}</div>
            </div>
          ) : null}
        </div>

        {remote.error ? (
          <div className="mt-3 rounded border border-[rgba(248,113,113,.35)] bg-[rgba(248,113,113,.08)] px-3 py-2 text-[12px] text-[var(--red)]">
            {remote.error}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-3 py-2 text-[12px] font-semibold text-[var(--fg)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
            onClick={() => void remote.startRemote(running)}
            disabled={remote.starting || !remote.portValid}
          >
            {remote.starting ? 'Starting...' : running ? 'Restart with settings' : 'Start remote Hub'}
          </button>
          <button
            type="button"
            className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 py-2 text-[12px] font-semibold text-[var(--fg)] hover:bg-[var(--hover)] disabled:opacity-50"
            onClick={() => void remote.stopRemote()}
            disabled={!running || remote.stopping}
          >
            {remote.stopping ? 'Stopping...' : 'Stop'}
          </button>
          <button
            type="button"
            className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 py-2 text-[12px] font-semibold text-[var(--fg)] hover:bg-[var(--hover)] disabled:opacity-50"
            onClick={() => void remote.loadStatus()}
            disabled={remote.loading}
          >
            Refresh
          </button>
          <button
            type="button"
            className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-3 py-2 text-[12px] font-semibold text-[var(--fg)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
            onClick={() => void remote.createPairing()}
            disabled={!remote.status?.running || remote.creatingPairing}
          >
            {remote.creatingPairing ? 'Creating...' : 'Create pairing QR'}
          </button>
        </div>
      </section>

      {remote.pairing ? (
        <section className="rounded-lg border border-[var(--accent-muted)] bg-[var(--panel-alt)] p-4">
          <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
            <div className="rounded bg-white p-3" dangerouslySetInnerHTML={{ __html: remote.pairing.qrSvg }} />
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
                Pair remote device
              </h3>
              <div className="mt-2 break-all rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-3 font-mono text-[12px] text-[var(--fg)]">
                {remote.pairing.url}
              </div>
              <div className="mt-2 text-[12px] text-[var(--muted)]">
                Link expires {new Date(remote.pairing.expiresAt).toLocaleTimeString()} and can be used once.
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
