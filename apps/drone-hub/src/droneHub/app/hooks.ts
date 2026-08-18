import React from 'react';
import { observeChatLoadRequest, responseTextBytes } from './chat-load-telemetry';

function buildUnexpectedHtmlError(url: string): string {
  const path = String(url ?? '').trim();
  if (path.startsWith('/api/')) {
    return `Expected JSON from ${path}, but received HTML. The Hub API is likely unreachable. Start via 'drone hub' or set DRONE_HUB_API_PORT for the Vite dev server.`;
  }
  return `Expected JSON from ${path || 'request'}, but received HTML.`;
}

export function usePoll<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  deps: React.DependencyList = [],
  opts?: { enabled?: boolean; isEqual?: (prev: T, next: T) => boolean },
) {
  const [value, setValue] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const enabled = opts?.enabled ?? true;

  React.useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;

    setValue(null);
    setError(null);
    setLoading(true);

    const clearTimer = () => {
      if (timer == null) return;
      clearTimeout(timer);
      timer = null;
    };

    const scheduleNext = (delayMs?: number) => {
      clearTimer();
      timer = setTimeout(() => {
        void tick();
      }, Math.max(0, delayMs ?? resolvePollIntervalMs(intervalMs)));
    };

    const tick = async () => {
      if (busy) {
        scheduleNext();
        return;
      }
      busy = true;
      try {
        const v = await fn();
        if (!mounted) return;
        setValue((prev) => (prev && opts?.isEqual?.(prev, v) ? prev : v));
        setError(null);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message ?? String(e));
      } finally {
        if (mounted) setLoading(false);
        busy = false;
        if (mounted) scheduleNext();
      }
    };

    const onVisibilityChange = () => {
      if (!mounted || typeof document === 'undefined') return;
      if (document.visibilityState === 'visible') scheduleNext(0);
    };

    void tick();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mounted = false;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return { value, error, loading };
}

export type TimedRequestState<T> = {
  data: T | null;
  error: unknown;
  loading: boolean;
};

export function useTimedRequest<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: React.DependencyList = [],
  opts?: { enabled?: boolean; keepPreviousData?: boolean },
): TimedRequestState<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [loading, setLoading] = React.useState(false);
  const enabled = opts?.enabled ?? true;
  const keepPreviousData = opts?.keepPreviousData ?? false;

  React.useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      if (!keepPreviousData) setData(null);
      return;
    }

    let mounted = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    if (!keepPreviousData) setData(null);

    void load(controller.signal)
      .then((next) => {
        if (!mounted) return;
        setData(next);
        setError(null);
      })
      .catch((e: any) => {
        if (!mounted || e?.name === 'AbortError') return;
        setError(e);
        if (!keepPreviousData) setData(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, keepPreviousData, ...deps]);

  return { data, error, loading };
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

export function resolvePollIntervalMs(intervalMs: number, hiddenMinMs: number = Math.max(intervalMs * 4, 15_000)): number {
  const baseMs = Math.max(250, Math.floor(intervalMs || 1000));
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return baseMs;
  return Math.max(baseMs, hiddenMinMs);
}

export async function fetchJson<T>(url: string): Promise<T> {
  const observation = observeChatLoadRequest(url);
  let r: Response;
  let text = '';
  let parseMs = 0;
  try {
    r = await fetch(url);
    observation?.response(r);
    text = await r.text();
  } catch (error) {
    observation?.fail(error);
    throw error;
  }
  const contentType = String(r.headers.get('content-type') ?? '').toLowerCase();
  const looksHtml = contentType.includes('text/html') || /^\s*</.test(text);
  let data: any = null;
  if (text) {
    const parseStartedAt = performance.now();
    try {
      data = JSON.parse(text);
    } catch {
      parseMs = performance.now() - parseStartedAt;
      observation?.fail(new Error('invalid JSON'));
      if (looksHtml) throw new Error(buildUnexpectedHtmlError(url));
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      throw new Error(`Expected JSON from ${url}, but response was not valid JSON.`);
    }
    parseMs = performance.now() - parseStartedAt;
  }
  if (!r.ok) {
    observation?.finish({ responseBytes: responseTextBytes(text), parseMs });
    const message = data?.error ? String(data.error) : `${r.status} ${r.statusText}`;
    throw new Error(message);
  }
  if (data == null) {
    observation?.fail(new Error('empty response'));
    throw new Error(`Expected JSON from ${url}, but response body was empty.`);
  }
  observation?.finish({ responseBytes: responseTextBytes(text), parseMs });
  return data as T;
}

export function isNotFoundError(err: any): boolean {
  const status = Number(err?.status ?? 0);
  if (status === 404) return true;
  const msg = String(err?.message ?? err ?? '').trim();
  return /^404\b/.test(msg) || /unknown (?:chat|drone)\b/i.test(msg);
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
