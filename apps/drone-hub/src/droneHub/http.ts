function buildUnexpectedHtmlError(url: string): string {
  const path = String(url ?? '').trim();
  if (path.startsWith('/api/')) {
    return `Expected JSON from ${path}, but received HTML. The Hub API is likely unreachable. Start via 'drone hub' or set DRONE_HUB_API_PORT for the Vite dev server.`;
  }
  return `Expected JSON from ${path || 'request'}, but received HTML.`;
}

let remoteCsrfToken: string | null = null;

export function setRequestJsonRemoteCsrf(token: string | null): void {
  const normalized = String(token ?? '').trim();
  remoteCsrfToken = normalized || null;
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const method = String(init?.method ?? 'GET').toUpperCase();
  if (remoteCsrfToken && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    headers.set('x-drone-remote-csrf', remoteCsrfToken);
  }
  const r = await fetch(url, { ...init, headers });
  const text = await r.text();
  const contentType = String(r.headers.get('content-type') ?? '').toLowerCase();
  const looksHtml = contentType.includes('text/html') || /^\s*</.test(text);
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (looksHtml) {
        const err = new Error(buildUnexpectedHtmlError(url)) as Error & { status?: number; data?: any };
        err.status = r.status;
        throw err;
      }
      const err = new Error(`Expected JSON from ${url}, but response was not valid JSON.`) as Error & {
        status?: number;
        data?: any;
      };
      err.status = r.status;
      throw err;
    }
  }
  if (!r.ok) {
    const msg =
      data?.error ??
      (Array.isArray(data?.errors) && data.errors.length > 0
        ? `${r.status} ${r.statusText}: ${data.errors
            .map((e: any) => `${e?.name ?? 'unknown'}: ${e?.error ?? 'failed'}`)
            .join(', ')}`
        : `${r.status} ${r.statusText}`);
    const err = new Error(msg) as Error & { status?: number; data?: any };
    err.status = r.status;
    err.data = data;
    throw err;
  }
  if (data == null) {
    const err = new Error(`Expected JSON from ${url}, but response body was empty.`) as Error & {
      status?: number;
      data?: any;
    };
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

export async function requestJsonWithTimeout<T>(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<T> {
  const ms = Number.isFinite(timeoutMs) ? Math.max(1, Math.floor(timeoutMs)) : 0;
  if (ms <= 0) return requestJson<T>(url, init);

  let timedOut = false;
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) controller.abort();
  upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);

  try {
    return await requestJson<T>(url, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (timedOut && e?.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${Math.round(ms / 1000)}s.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
}
