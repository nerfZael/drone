function directApiBase(): string {
  try {
    return String(import.meta.env.VITE_DRONE_HUB_DIRECT_API_BASE ?? '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function directApiToken(): string {
  try {
    return String(import.meta.env.VITE_DRONE_HUB_DIRECT_API_TOKEN ?? '').trim();
  } catch {
    return '';
  }
}

function rewriteApiUrl(raw: string): string | null {
  const base = directApiBase();
  if (!base) return null;
  try {
    const current = new URL(window.location.href);
    const url = new URL(raw, current);
    if (url.origin !== current.origin) return null;
    if (!url.pathname.startsWith('/api/')) return null;
    return `${base}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function headersWithAuth(raw: HeadersInit | undefined): Headers {
  const headers = new Headers(raw);
  const token = directApiToken();
  if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

function requestWithDirectApiUrl(request: Request, url: string): Request {
  return new Request(url, {
    method: request.method,
    headers: headersWithAuth(request.headers),
    body: request.body,
    mode: 'cors',
    credentials: 'omit',
    cache: request.cache,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive,
    signal: request.signal,
  });
}

export function installDirectApiFetch(): void {
  if (typeof window === 'undefined') return;
  const base = directApiBase();
  if (!base) return;
  const token = directApiToken();
  if (!token) return;
  const currentFetch = window.fetch.bind(window);
  if ((window.fetch as any).__droneHubDirectApiInstalled) return;

  const patchedFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (input instanceof Request) {
      const rewritten = rewriteApiUrl(input.url);
      if (!rewritten) return currentFetch(input, init);
      const request = requestWithDirectApiUrl(input, rewritten);
      if (!init) return currentFetch(request);
      return currentFetch(request, {
        ...init,
        headers: headersWithAuth(init.headers ?? request.headers),
        mode: 'cors',
        credentials: 'omit',
      });
    }

    const raw = typeof input === 'string' ? input : input.toString();
    const rewritten = rewriteApiUrl(raw);
    if (!rewritten) return currentFetch(input as any, init);
    return currentFetch(rewritten, {
      ...init,
      headers: headersWithAuth(init?.headers),
      mode: 'cors',
      credentials: 'omit',
    });
  }) as typeof window.fetch;
  (patchedFetch as any).__droneHubDirectApiInstalled = true;
  window.fetch = patchedFetch;
}
