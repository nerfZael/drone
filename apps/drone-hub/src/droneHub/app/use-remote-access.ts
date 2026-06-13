import React from 'react';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type RemoteAccessStatus = {
  ok: true;
  running: boolean;
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
  const [error, setError] = React.useState<string | null>(null);
  const autoDetectedNgrokPortRef = React.useRef<string | null>(null);
  const parsedPort = Number(port);
  const portValid = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535;

  const loadStatus = React.useCallback(async () => {
    setLoading(true);
    try {
      const next = await requestJson<RemoteAccessStatus>('/api/remote-access/status');
      setStatus(next);
      if (next.state) {
        setPort(String(next.state.port));
        setPublicUrl(next.state.publicUrl ?? '');
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [requestJson]);

  const detectNgrokPublicUrl = React.useCallback(async (silent = false) => {
    if (!portValid) {
      if (!silent) setError('Enter a valid local port before detecting ngrok.');
      return;
    }
    setDetectingNgrok(true);
    try {
      const next = await requestJson<RemoteAccessNgrokUrl>(`/api/remote-access/ngrok-url?port=${encodeURIComponent(String(parsedPort))}`);
      if (next.url) {
        setPublicUrl(next.url);
        setError(null);
      } else if (!silent) {
        setError(next.error ?? `No ngrok tunnel found for local port ${parsedPort}.`);
      }
    } catch (err: any) {
      if (!silent) setError(err?.message ?? String(err));
    } finally {
      setDetectingNgrok(false);
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
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setCreatingPairing(false);
    }
  }, [requestJson]);

  const startRemote = React.useCallback(async (force = false) => {
    if (!portValid) {
      setError('Enter a valid local port.');
      return;
    }
    setStarting(true);
    try {
      const next = await requestJson<{ ok: true; state: RemoteAccessStatus['state']; alreadyRunning: boolean }>('/api/remote-access/start', {
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
  }, [parsedPort, portValid, publicUrl, requestJson]);

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
    if (loading || !portValid || publicUrl.trim()) return;
    if (autoDetectedNgrokPortRef.current === port) return;
    autoDetectedNgrokPortRef.current = port;
    void detectNgrokPublicUrl(true);
  }, [detectNgrokPublicUrl, loading, port, portValid, publicUrl]);

  return {
    status,
    pairing,
    port,
    setPort,
    publicUrl,
    setPublicUrl,
    portValid,
    loading,
    starting,
    stopping,
    creatingPairing,
    detectingNgrok,
    error,
    loadStatus,
    detectNgrokPublicUrl,
    startRemote,
    stopRemote,
    createPairing,
  };
}
