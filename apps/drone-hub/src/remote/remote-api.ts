import type { DroneSummary, PendingPrompt, TranscriptItem } from '../droneHub/types';

export type RemoteSession = {
  ok: true;
  authenticated: boolean;
  csrf: string | null;
  activeSessions: number;
};

export type DroneListResponse = { ok: true; drones: DroneSummary[] };
export type ChatListResponse = { ok: true; id: string; name: string; chats: Array<{ chat: string; name?: string }> };
export type TranscriptResponse = { ok: true; transcripts: TranscriptItem[] };
export type PendingResponse = { ok: true; pending: PendingPrompt[] };

let csrfToken: string | null = null;

export function setRemoteCsrf(token: string | null): void {
  csrfToken = token && token.trim() ? token.trim() : null;
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
