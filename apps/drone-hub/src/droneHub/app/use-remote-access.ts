import React from 'react';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type RemoteAccessStatus = {
  ok: true;
  running: boolean;
  desired?: boolean;
  ensuring?: boolean;
  error?: string | null;
  state: null | {
    pid: number;
    host: string;
    port: number;
    publicUrl: string | null;
    startedAt: string;
    logPath: string;
    url: string;
  };
};

export type RemoteAccessPairing = {
  ok: true;
  url: string;
  qrSvg: string;
  expiresAt: string;
};

type RemoteAccessNgrokUrl = {
  ok: true;
  url: string | null;
  error?: string | null;
};

type RemoteAccessNgrokStart = {
  ok: true;
  logPath: string;
};

type RemoteAccessPairingStatus = {
  ok: true;
  active: boolean;
  expiresAt: string | null;
};

type NgrokCheckState = {
  checking: boolean;
  url: string | null;
  error: string | null;
  checkedAt: number | null;
};

const AUTO_PAIR_MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function looksLikeNgrokUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'ngrok.io' || hostname.endsWith('.ngrok.io') || hostname.endsWith('.ngrok-free.app');
  } catch {
    return /ngrok/i.test(value);
  }
}

function pairingTokenFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl, window.location.href);
    const prefix = '/pair/';
    if (!url.pathname.startsWith(prefix)) return null;
    const token = decodeURIComponent(url.pathname.slice(prefix.length)).trim();
    return token || null;
  } catch {
    return null;
  }
}

export function useRemoteAccess(requestJson: RequestJsonFn) {
  const [status, setStatus] = React.useState<RemoteAccessStatus | null>(null);
  const [pairing, setPairing] = React.useState<RemoteAccessPairing | null>(null);
  const [port, setPort] = React.useState('8790');
  const [publicUrl, setPublicUrl] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [starting, setStarting] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  const [creatingPairing, setCreatingPairing] = React.useState(false);
  const [detectingNgrok, setDetectingNgrok] = React.useState(false);
  const [startingNgrok, setStartingNgrok] = React.useState(false);
  const [ngrokCheck, setNgrokCheck] = React.useState<NgrokCheckState>({
    checking: false,
    url: null,
    error: null,
    checkedAt: null,
  });
  const [error, setError] = React.useState<string | null>(null);
  const autoDetectedNgrokPortRef = React.useRef<string | null>(null);
  const autoPairStateRef = React.useRef<{ runKey: string; attempts: number } | null>(null);
  const refreshingConsumedPairingTokenRef = React.useRef<string | null>(null);
  const publicUrlRef = React.useRef('');
  const publicUrlDirtyRef = React.useRef(false);
  const parsedPort = Number(port);
  const portValid = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535;

  const updatePublicUrl = React.useCallback((next: string) => {
    publicUrlDirtyRef.current = true;
    setPublicUrl(next);
  }, []);

  React.useEffect(() => {
    publicUrlRef.current = publicUrl;
  }, [publicUrl]);

  const loadStatus = React.useCallback(async () => {
    setLoading(true);
    try {
      const next = await requestJson<RemoteAccessStatus>('/api/remote-access/status');
      setStatus(next);
      if (next.state) {
        setPort(String(next.state.port));
        const nextPublicUrl = next.state.publicUrl ?? '';
        if (!publicUrlDirtyRef.current || !publicUrlRef.current.trim()) {
          setPublicUrl(nextPublicUrl);
          publicUrlDirtyRef.current = false;
        }
      }
      setError(next.error ?? null);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [requestJson]);

  const detectNgrokPublicUrl = React.useCallback(
    async (silent = false, options: { validateOnly?: boolean } = {}) => {
      if (!portValid) {
        if (!silent) setError('Enter a valid local port before detecting ngrok.');
        return;
      }
      setDetectingNgrok(true);
      setNgrokCheck((current) => ({ ...current, checking: true }));
      try {
        const next = await requestJson<RemoteAccessNgrokUrl>(
          `/api/remote-access/ngrok-url?port=${encodeURIComponent(String(parsedPort))}`,
        );
        setNgrokCheck({
          checking: false,
          url: next.url ?? null,
          error: next.url ? null : next.error ?? `No ngrok tunnel found for local port ${parsedPort}.`,
          checkedAt: Date.now(),
        });
        if (next.url) {
          if (!options.validateOnly) {
            setPublicUrl(next.url);
            publicUrlDirtyRef.current = false;
          }
          setError(null);
        } else if (!silent) {
          setError(next.error ?? `No ngrok tunnel found for local port ${parsedPort}.`);
        }
      } catch (err: any) {
        setNgrokCheck({
          checking: false,
          url: null,
          error: err?.message ?? String(err),
          checkedAt: Date.now(),
        });
        if (!silent) setError(err?.message ?? String(err));
      } finally {
        setDetectingNgrok(false);
      }
    },
    [parsedPort, portValid, requestJson],
  );

  const startNgrok = React.useCallback(async () => {
    if (!portValid) {
      setError('Enter a valid local port before starting ngrok.');
      return;
    }
    setStartingNgrok(true);
    try {
      await requestJson<RemoteAccessNgrokStart>('/api/remote-access/ngrok/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ port: parsedPort }),
      });
      let lastError = `No ngrok tunnel found for local port ${parsedPort}.`;
      for (let i = 0; i < 12; i++) {
        await sleep(i === 0 ? 250 : 500);
        const next = await requestJson<RemoteAccessNgrokUrl>(
          `/api/remote-access/ngrok-url?port=${encodeURIComponent(String(parsedPort))}`,
        );
        setNgrokCheck({
          checking: false,
          url: next.url ?? null,
          error: next.url ? null : next.error ?? `No ngrok tunnel found for local port ${parsedPort}.`,
          checkedAt: Date.now(),
        });
        if (next.url) {
          setPublicUrl(next.url);
          publicUrlDirtyRef.current = false;
          setError(null);
          return;
        }
        lastError = next.error ?? lastError;
      }
      setError(lastError);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setStartingNgrok(false);
    }
  }, [parsedPort, portValid, requestJson]);

  const createPairing = React.useCallback(async () => {
    setCreatingPairing(true);
    try {
      const next = await requestJson<RemoteAccessPairing>('/api/remote-access/pairing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      setPairing(next);
      setError(null);
      return true;
    } catch (err: any) {
      setError(err?.message ?? String(err));
      return false;
    } finally {
      setCreatingPairing(false);
    }
  }, [requestJson]);

  const retryPairing = React.useCallback(async () => {
    autoPairStateRef.current = null;
    await createPairing();
  }, [createPairing]);

  const startRemote = React.useCallback(
    async (force = false) => {
      if (!portValid) {
        setError('Enter a valid local port.');
        return;
      }
      setStarting(true);
      try {
        const next = await requestJson<{
          ok: true;
          state: RemoteAccessStatus['state'];
          alreadyRunning: boolean;
        }>('/api/remote-access/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ port: parsedPort, publicUrl: publicUrl.trim() || null, force }),
        });
        setStatus({ ok: true, running: true, state: next.state });
        setPairing(null);
        setError(null);
      } catch (err: any) {
        setError(err?.message ?? String(err));
      } finally {
        setStarting(false);
      }
    },
    [parsedPort, portValid, publicUrl, requestJson],
  );

  const stopRemote = React.useCallback(async () => {
    setStopping(true);
    try {
      await requestJson('/api/remote-access/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      setPairing(null);
      await loadStatus();
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setStopping(false);
    }
  }, [loadStatus, requestJson]);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  React.useEffect(() => {
    if (loading || !portValid) return;
    const currentPublicUrl = publicUrl.trim();
    const shouldValidateExistingNgrokUrl = Boolean(currentPublicUrl && looksLikeNgrokUrl(currentPublicUrl));
    const shouldAutoDetectMissingUrl = !currentPublicUrl && !publicUrlDirtyRef.current;
    if (!shouldValidateExistingNgrokUrl && !shouldAutoDetectMissingUrl) return;
    const checkKey = `${port}:${currentPublicUrl || '<empty>'}`;
    if (autoDetectedNgrokPortRef.current === checkKey) return;
    autoDetectedNgrokPortRef.current = checkKey;
    void detectNgrokPublicUrl(true, { validateOnly: shouldValidateExistingNgrokUrl });
  }, [detectNgrokPublicUrl, loading, port, portValid, publicUrl]);

  React.useEffect(() => {
    if (!status?.running) {
      autoPairStateRef.current = null;
      return;
    }
    if (pairing || creatingPairing) return;
    const runKey = status.state ? `${status.state.pid}:${status.state.startedAt}` : 'running';
    const current =
      autoPairStateRef.current?.runKey === runKey
        ? autoPairStateRef.current
        : { runKey, attempts: 0 };
    if (current.attempts >= AUTO_PAIR_MAX_ATTEMPTS) {
      autoPairStateRef.current = current;
      return;
    }
    const attempts = current.attempts + 1;
    autoPairStateRef.current = { runKey, attempts };
    const delayMs = attempts === 1 ? 0 : Math.min(30_000, 2 ** (attempts - 2) * 2_000);
    const timeout = window.setTimeout(() => {
      void createPairing();
    }, delayMs);
    return () => window.clearTimeout(timeout);
  }, [createPairing, creatingPairing, pairing, status]);

  React.useEffect(() => {
    if (!status?.running || !pairing) return;
    const expiresAtMs = new Date(pairing.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) return;
    const delayMs = Math.max(0, expiresAtMs - Date.now() - 30_000);
    const timeout = window.setTimeout(() => {
      void createPairing();
    }, delayMs);
    return () => window.clearTimeout(timeout);
  }, [createPairing, pairing, status?.running]);

  React.useEffect(() => {
    if (!status?.running || !pairing || creatingPairing) return;
    const token = pairingTokenFromUrl(pairing.url);
    if (!token) return;
    let cancelled = false;
    const check = async () => {
      try {
        const next = await requestJson<RemoteAccessPairingStatus>('/api/remote-access/pairing-status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (cancelled || next.active) return;
        if (refreshingConsumedPairingTokenRef.current === token) return;
        refreshingConsumedPairingTokenRef.current = token;
        const refreshed = await createPairing();
        if (!refreshed && !cancelled) refreshingConsumedPairingTokenRef.current = null;
      } catch {
        // Keep the currently displayed QR. Expiry refresh still covers stale tokens.
      }
    };
    const interval = window.setInterval(() => {
      void check();
    }, 2_000);
    void check();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [createPairing, creatingPairing, pairing, requestJson, status?.running]);

  return {
    status,
    pairing,
    port,
    setPort,
    publicUrl,
    setPublicUrl: updatePublicUrl,
    portValid,
    loading,
    starting,
    stopping,
    creatingPairing,
    detectingNgrok,
    startingNgrok,
    ngrokCheck,
    error,
    loadStatus,
    detectNgrokPublicUrl,
    startNgrok,
    startRemote,
    stopRemote,
    createPairing,
    retryPairing,
  };
}
