function directApiBase(): string {
  const runtimeConfig =
    typeof window === 'undefined' ? undefined : window.__DRONE_HUB_RUNTIME_CONFIG__;
  if (runtimeConfig) {
    return String(runtimeConfig.directApiBase ?? '')
      .trim()
      .replace(/\/+$/, '');
  }
  try {
    return String(import.meta.env.VITE_DRONE_HUB_DIRECT_API_BASE ?? '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function directApiToken(): string {
  const runtimeConfig =
    typeof window === 'undefined' ? undefined : window.__DRONE_HUB_RUNTIME_CONFIG__;
  if (runtimeConfig) return String(runtimeConfig.directApiToken ?? '').trim();
  try {
    return String(import.meta.env.VITE_DRONE_HUB_DIRECT_API_TOKEN ?? '').trim();
  } catch {
    return '';
  }
}

function isPriorityChatApiPath(pathname: string): boolean {
  return /^\/api\/drones\/[^/]+\/chats\/[^/]+(?:\/|$)/.test(pathname);
}

function rewriteApiUrl(raw: string): string | null {
  const base = directApiBase();
  if (!base) return null;
  try {
    const current = new URL(window.location.href);
    const url = new URL(raw, current);
    if (url.origin !== current.origin) return null;
    // Keep this pool reserved for interactive chat traffic. Large fleet reads
    // and long-lived fetch streams must stay on the UI origin or they can use
    // every direct-origin HTTP/1.1 socket and queue the chat state request.
    if (!isPriorityChatApiPath(url.pathname)) return null;
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

export function buildDirectApiWebSocketUrl(pathname: string): string {
  const configuredBase = directApiBase();
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const url = new URL(
    configuredBase ? `${configuredBase}${path}` : path,
    window.location.origin,
  );
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = directApiToken();
  if (token) url.searchParams.set('token', token);
  return url.toString();
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
  // Vite sends interactive chat traffic straight to the authenticated Hub API.
  // Packaged/static desktop mode instead points at a second loopback hostname
  // on its token-injecting proxy, so no browser-visible token is required there.
  const currentFetch = ((window.fetch as any).__droneHubDirectApiOriginal ?? window.fetch).bind(window) as typeof window.fetch;

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
  (patchedFetch as any).__droneHubDirectApiOriginal = currentFetch;
  window.fetch = patchedFetch;
}

if (import.meta.hot) {
  import.meta.hot.accept(() => installDirectApiFetch());
}
