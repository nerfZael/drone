import type { DroneSummary, PendingPrompt, TranscriptItem } from '../droneHub/types';
import type { ChatAgentConfig } from '../domain';
import type { ChatModelOption } from '../droneHub/app/app-types';
import { setRequestJsonRemoteCsrf } from '../droneHub/http';

export type RemoteSession = {
  ok: true;
  authenticated: boolean;
  csrf: string | null;
};

export type DroneListResponse = { ok: true; drones: DroneSummary[] };
export type ChatListResponse = {
  ok: true;
  id: string;
  name: string;
  chats: Array<string | { chat?: string; name?: string; draft?: boolean }>;
  chatDetails?: Array<{ chat?: string; name?: string; draft?: boolean }>;
  draftChats?: Record<string, boolean>;
};
export type TranscriptResponse = { ok: true; transcripts: TranscriptItem[] };
export type PendingResponse = { ok: true; pending: PendingPrompt[] };
export type ChatStateResponse = { ok: true; transcripts: TranscriptItem[]; pending: PendingPrompt[] };
export type ChatRuntimeResponse = {
  ok: true;
  id: string;
  name: string;
  chat: string;
  agent: ChatAgentConfig;
  model: string | null;
  models: ChatModelOption[];
  source: 'live' | 'cache' | 'none';
  discoveredAt: string;
  error?: string;
};

let csrfToken: string | null = null;

export function setRemoteCsrf(token: string | null): void {
  csrfToken = token && token.trim() ? token.trim() : null;
  setRequestJsonRemoteCsrf(csrfToken);
}

function sameOriginApiUrl(raw: RequestInfo | URL): boolean {
  try {
    const url = raw instanceof Request ? raw.url : raw.toString();
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function methodRequiresCsrf(methodRaw: unknown): boolean {
  const method = String(methodRaw ?? 'GET').toUpperCase();
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

function withRemoteCsrfHeader(headersRaw: HeadersInit | undefined): Headers {
  const headers = new Headers(headersRaw);
  if (csrfToken && !headers.has('x-drone-remote-csrf')) {
    headers.set('x-drone-remote-csrf', csrfToken);
  }
  return headers;
}

export function installRemoteCsrfFetch(): void {
  if (typeof window === 'undefined') return;
  const currentFetch = window.fetch.bind(window);
  if ((window.fetch as any).__droneRemoteCsrfInstalled) return;

  const patchedFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!sameOriginApiUrl(input)) return currentFetch(input as any, init);

    const requestMethod = input instanceof Request ? input.method : undefined;
    const method = init?.method ?? requestMethod ?? 'GET';
    if (!methodRequiresCsrf(method)) return currentFetch(input as any, init);

    const inputHeaders = input instanceof Request ? input.headers : undefined;
    return currentFetch(input as any, {
      ...init,
      headers: withRemoteCsrfHeader(init?.headers ?? inputHeaders),
    });
  }) as typeof window.fetch;
  (patchedFetch as any).__droneRemoteCsrfInstalled = true;
  window.fetch = patchedFetch;
}

export async function remoteRequestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const method = String(init?.method ?? 'GET').toUpperCase();
  if (csrfToken && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    headers.set('x-drone-remote-csrf', csrfToken);
  }
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Expected JSON from ${url}.`);
    }
  }
  if (!response.ok) {
    const error = new Error(data?.error ?? `${response.status} ${response.statusText}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data as T;
}
