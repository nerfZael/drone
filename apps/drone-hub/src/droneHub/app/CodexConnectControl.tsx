import React from 'react';
import { requestJson } from '../http';

type CodexLoginStatus = {
  ok: true;
  status: 'idle' | 'starting' | 'waiting' | 'finishing' | 'connected' | 'error';
  authorizationUrl: string | null;
  error: string | null;
};

type CodexSettingsStatus = {
  ok: true;
  hasKey: boolean;
};

function openAuthorizationWindow(url = 'about:blank'): Window | null {
  const browser = window.open(url, '_blank');
  if (browser) browser.opener = null;
  return browser;
}

export function CodexConnectControl({
  connected,
  compact = false,
  onConnected,
}: {
  connected?: boolean;
  compact?: boolean;
  onConnected?: () => void | Promise<void>;
}) {
  const [detectedConnected, setDetectedConnected] = React.useState(false);
  const [login, setLogin] = React.useState<CodexLoginStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const effectiveConnected = Boolean(connected || detectedConnected);
  const connectionCheckKey = connected === undefined ? 'auto' : connected ? 'connected' : 'disconnected';
  const [resolvedConnectionCheckKey, setResolvedConnectionCheckKey] = React.useState(
    connected === true ? connectionCheckKey : '',
  );

  const refreshConnection = React.useCallback(async () => {
    const status = await requestJson<CodexSettingsStatus>('/api/settings/codex');
    setDetectedConnected(status.hasKey);
    return status.hasKey;
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void Promise.all([
      requestJson<CodexLoginStatus>('/api/settings/codex/connect'),
      connected === undefined ? refreshConnection() : Promise.resolve(connected),
    ])
      .then(async ([status]) => {
        if (cancelled) return;
        setLogin(status);
        if (status.status === 'error') {
          setError(status.error ?? 'Codex sign-in failed.');
        } else if (status.status === 'connected' && !connected) {
          const hasConnection = await refreshConnection();
          if (!cancelled && hasConnection) await onConnected?.();
        }
        if (!cancelled) setResolvedConnectionCheckKey(connectionCheckKey);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError?.message ?? String(nextError));
      });
    return () => {
      cancelled = true;
    };
  }, [connected, connectionCheckKey, onConnected, refreshConnection]);

  React.useEffect(() => {
    if (
      login?.status !== 'starting' &&
      login?.status !== 'waiting' &&
      login?.status !== 'finishing'
    )
      return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      let keepPolling = false;
      try {
        const status = await requestJson<CodexLoginStatus>('/api/settings/codex/connect');
        if (cancelled) return;
        setLogin(status);
        if (status.status === 'connected') {
          const hasConnection = await refreshConnection();
          if (!cancelled && hasConnection) await onConnected?.();
        } else if (status.status === 'error') {
          setError(status.error ?? 'Codex sign-in failed.');
        } else {
          keepPolling =
            status.status === 'starting' ||
            status.status === 'waiting' ||
            status.status === 'finishing';
        }
      } catch (nextError: any) {
        if (!cancelled) setError(nextError?.message ?? String(nextError));
      } finally {
        if (!cancelled && keepPolling) timer = window.setTimeout(() => void poll(), 1_000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [login?.status, onConnected, refreshConnection]);

  const start = async () => {
    setBusy(true);
    setError(null);
    const browser = openAuthorizationWindow();
    try {
      const status = await requestJson<CodexLoginStatus>('/api/settings/codex/connect', {
        method: 'POST',
        body: '{}',
      });
      setLogin(status);
      if (status.status === 'connected') {
        const hasConnection = await refreshConnection();
        if (hasConnection) await onConnected?.();
      }
      if (status.authorizationUrl) {
        if (browser) browser.location.replace(status.authorizationUrl);
        else openAuthorizationWindow(status.authorizationUrl);
      } else {
        browser?.close();
      }
    } catch (nextError: any) {
      browser?.close();
      setError(nextError?.message ?? String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      setLogin(
        await requestJson<CodexLoginStatus>('/api/settings/codex/connect', {
          method: 'DELETE',
        }),
      );
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setBusy(false);
    }
  };

  if (effectiveConnected) return null;
  if (resolvedConnectionCheckKey !== connectionCheckKey) return null;

  const waiting =
    login?.status === 'starting' ||
    login?.status === 'waiting' ||
    login?.status === 'finishing';
  const finishing = login?.status === 'finishing';
  return (
    <div
      className={
        compact
          ? 'rounded border border-[var(--accent-border)] bg-[var(--selected)] px-3 py-2'
          : 'rounded border border-[var(--accent-border)] bg-[var(--selected)] p-3'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold text-[var(--fg)]">
            {finishing
              ? 'Finishing Codex sign-in'
              : waiting
                ? 'Waiting for Codex sign-in'
                : 'Codex sign-in required'}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--muted)]">
            {finishing
              ? 'Saving the shared Codex login securely…'
              : waiting
              ? 'Finish in the OpenAI browser window. Drone Hub will connect automatically.'
              : 'Connect your ChatGPT subscription without copying a redirect URL.'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!finishing && waiting && login?.authorizationUrl ? (
            <button
              type="button"
              onClick={() => openAuthorizationWindow(login.authorizationUrl!)}
              className="h-8 rounded border border-[var(--border)] px-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
            >
              Reopen OpenAI
            </button>
          ) : null}
          {!finishing ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void (waiting ? cancel() : start())}
              className={`h-8 rounded border px-2.5 text-[10px] font-semibold uppercase tracking-wide ${
                waiting
                  ? 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]'
                  : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
              } ${busy ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              {busy ? 'Working…' : waiting ? 'Cancel' : 'Connect Codex'}
            </button>
          ) : null}
        </div>
      </div>
      {error ? <div className="mt-2 text-[10px] text-[var(--red)]">{error}</div> : null}
    </div>
  );
}

export function CodexConnectComposerNotice({ resetKey }: { resetKey: string }) {
  return (
    <div className="px-5">
      <div className="mx-auto max-w-[1170px]">
        <CodexConnectControl key={resetKey} compact />
      </div>
    </div>
  );
}
