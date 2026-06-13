import type { ApiClient, DevUser } from './dashboardTypes.js';

const devUserStorageKey = 'voiceStreamNext.devUser';

export function defaultDevUser(): DevUser {
  return { email: 'developer@example.local', name: 'Local Developer', admin: false };
}

export function readDevUser(): DevUser {
  try {
    const parsed = JSON.parse(localStorage.getItem(devUserStorageKey) || 'null');
    return {
      email: String(parsed?.email ?? defaultDevUser().email),
      name: String(parsed?.name ?? defaultDevUser().name),
      admin: Boolean(parsed?.admin ?? false),
    };
  } catch {
    return defaultDevUser();
  }
}

export function createDevClient(user: DevUser): ApiClient {
  const withHeaders = (init?: RequestInit): RequestInit => {
    const headers = new Headers(init?.headers);
    if (init?.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json');
    headers.set('x-voice-dev-user-email', user.email);
    headers.set('x-voice-dev-user-name', user.name);
    headers.set('x-voice-dev-admin', '0');
    return { ...init, headers };
  };
  return {
    async request<T>(path: string, init?: RequestInit) {
      return requestJson<T>(path, withHeaders(init));
    },
    async stream(path: string, init?: RequestInit) {
      return fetch(path, withHeaders(init));
    },
    async upload(path: string, init: RequestInit, onProgress) {
      return uploadWithProgress(path, withHeaders(init), onProgress);
    },
  };
}

export function createClerkClient(getToken: () => Promise<string | null>): ApiClient {
  const withHeaders = async (init?: RequestInit): Promise<RequestInit> => {
    const headers = new Headers(init?.headers);
    if (init?.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const token = await getToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
    return { ...init, headers };
  };
  return {
    async request<T>(path: string, init?: RequestInit) {
      return requestJson<T>(path, await withHeaders(init));
    },
    async stream(path: string, init?: RequestInit) {
      return fetch(path, await withHeaders(init));
    },
    async upload(path: string, init: RequestInit, onProgress) {
      return uploadWithProgress(path, await withHeaders(init), onProgress);
    },
  };
}

export function createCookieClient(): ApiClient {
  return {
    async request<T>(path: string, init?: RequestInit) {
      return requestJson<T>(path, withCookieHeaders(init));
    },
    async stream(path: string, init?: RequestInit) {
      return fetch(path, withCookieHeaders(init));
    },
    async upload(path: string, init: RequestInit, onProgress) {
      return uploadWithProgress(path, withCookieHeaders(init), onProgress);
    },
  };
}

function withCookieHeaders(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return { ...init, headers, credentials: 'same-origin' };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Expected JSON from ${path}`);
    }
  }
  if (!response.ok) throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
  return data as T;
}

function uploadWithProgress(
  path: string,
  init: RequestInit,
  onProgress?: (progress: { loaded: number; total: number | null }) => void,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method || 'POST', path, true);
    xhr.withCredentials = init.credentials === 'include';

    const headers = new Headers(init.headers);
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));

    xhr.upload.onprogress = (event) => {
      onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : null,
      });
    };
    xhr.onerror = () => reject(new Error(`Upload failed for ${path}`));
    xhr.ontimeout = () => reject(new Error(`Upload timed out for ${path}`));
    xhr.onabort = () => reject(new Error(`Upload aborted for ${path}`));
    xhr.onload = () => {
      const responseHeaders = parseResponseHeaders(xhr.getAllResponseHeaders());
      resolve(new Response(xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: responseHeaders,
      }));
    };

    xhr.send(init.body as XMLHttpRequestBodyInit | null | undefined);
  });
}

function parseResponseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/\r?\n/)) {
    if (!line) continue;
    const index = line.indexOf(':');
    if (index <= 0) continue;
    headers.append(line.slice(0, index).trim(), line.slice(index + 1).trim());
  }
  return headers;
}
