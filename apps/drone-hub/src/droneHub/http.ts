import {
  observeChatLoadRequest,
  responseTextBytes,
} from './app/chat-load-telemetry';

function buildUnexpectedHtmlError(url: string): string {
  const path = String(url ?? '').trim();
  if (path.startsWith('/api/')) {
    return `Expected JSON from ${path}, but received HTML. The Hub API is likely unreachable. Start via 'drone hub' or set DRONE_HUB_API_PORT for the Vite dev server.`;
  }
  return `Expected JSON from ${path || 'request'}, but received HTML.`;
}

type JsonResponse<T> =
  | { data: T; response: Response; notModified: false }
  | { data: null; response: Response; notModified: true };

export type ConditionalJsonResponse<T> =
  | { data: T; etag: string | null; notModified: false }
  | { data: null; etag: string | null; notModified: true };

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const result = await requestJsonResponse<T>(url, init, false);
  if (result.notModified) {
    throw new Error(`Unexpected 304 response from ${url}.`);
  }
  return result.data;
}

export async function requestJsonConditional<T>(
  url: string,
  init?: RequestInit,
): Promise<ConditionalJsonResponse<T>> {
  const requestHeaders = new Headers(init?.headers);
  const result = await requestJsonResponse<T>(url, { ...init, headers: requestHeaders }, true);
  return result.notModified
    ? {
        data: null,
        etag: result.response.headers.get('etag') ?? requestHeaders.get('if-none-match'),
        notModified: true,
      }
    : {
        data: result.data,
        etag: result.response.headers.get('etag'),
        notModified: false,
      };
}

async function requestJsonResponse<T>(
  url: string,
  init: RequestInit | undefined,
  allowNotModified: boolean,
): Promise<JsonResponse<T>> {
  const headers = new Headers(init?.headers);
  const observation = observeChatLoadRequest(url);
  let r: Response;
  let text = '';
  let parseMs = 0;
  try {
    r = await fetch(url, { ...init, headers });
    observation?.response(r);
    text = await r.text();
  } catch (error) {
    observation?.fail(error);
    throw error;
  }
  if (allowNotModified && r.status === 304) {
    observation?.finish({ responseBytes: responseTextBytes(text), parseMs: 0 });
    return { data: null, response: r, notModified: true };
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
    parseMs = performance.now() - parseStartedAt;
  }
  if (!r.ok) {
    observation?.finish({ responseBytes: responseTextBytes(text), parseMs });
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
    observation?.fail(new Error('empty response'));
    const err = new Error(`Expected JSON from ${url}, but response body was empty.`) as Error & {
      status?: number;
      data?: any;
    };
    err.status = r.status;
    err.data = data;
    throw err;
  }
  observation?.finish({ responseBytes: responseTextBytes(text), parseMs });
  return { data: data as T, response: r, notModified: false };
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
