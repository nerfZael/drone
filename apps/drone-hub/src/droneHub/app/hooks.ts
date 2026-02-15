import React from 'react';

export function usePoll<T>(fn: () => Promise<T>, intervalMs: number, deps: any[] = []) {
  const [value, setValue] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;
    let timer: any = null;

    setValue(null);
    setError(null);
    setLoading(true);

    const tick = async () => {
      try {
        const v = await fn();
        if (!mounted) return;
        setValue(v);
        setError(null);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message ?? String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void tick();
    timer = setInterval(() => {
      void tick();
    }, intervalMs);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { value, error, loading };
}

export function useNowMs(intervalMs: number, enabled: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!enabled) return;
    const ms = Math.max(250, Math.floor(intervalMs || 1000));
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [enabled, intervalMs]);

  return now;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

export function isNotFoundError(err: any): boolean {
  const msg = String(err?.message ?? err ?? '').trim();
  return /^404\b/.test(msg);
}

export async function probeLocalhostPort(hostPort: number, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `http://localhost:${hostPort}`;

  try {
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function writeLocalStorageItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function readLocalStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function usePersistedLocalStorageItem(key: string, value: string): void {
  React.useEffect(() => {
    writeLocalStorageItem(key, value);
  }, [key, value]);
}
