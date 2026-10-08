/**
 * Full use of another desktop Hub. The local Hub opens a loopback origin that serves
 * this UI with every API, stream and preview request forwarded to the other machine;
 * the page then runs there exactly as it does at home. These helpers tell the two
 * apart and translate the few addresses that name the viewing machine.
 */

export type RemoteHubRuntime = {
  deviceId: string;
  deviceName: string;
  homeDeviceId: string;
  homeOrigin: string;
};

const DEVICE_QUERY_PARAM = 'device';

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function runtimeConfig(): Window['__DRONE_HUB_RUNTIME_CONFIG__'] {
  return typeof window === 'undefined' ? undefined : window.__DRONE_HUB_RUNTIME_CONFIG__;
}

/** The remote Hub this page shows, or null when it is the local Hub. */
export function remoteHubRuntime(): RemoteHubRuntime | null {
  const remote = runtimeConfig()?.remoteHub;
  if (!remote) return null;
  const runtime = {
    deviceId: text(remote.deviceId),
    deviceName: text(remote.deviceName),
    homeDeviceId: text(remote.homeDeviceId),
    homeOrigin: text(remote.homeOrigin),
  };
  return runtime.deviceId && runtime.homeDeviceId && runtime.homeOrigin ? runtime : null;
}

/** Desktop Hubs can be used in full; phones keep the chat view. */
export function supportsFullRemoteHub(device: { platform?: string } | null | undefined): boolean {
  return device?.platform === 'desktop' || device?.platform === 'server';
}

/** The home Hub page, asked to select `deviceId` once it loads. */
export function homeUrlForDevice(runtime: RemoteHubRuntime, deviceId: string): string {
  const url = new URL('/', runtime.homeOrigin);
  url.searchParams.set(DEVICE_QUERY_PARAM, deviceId);
  return url.toString();
}

let requestedDeviceId: string | null = null;

/**
 * A device selection handed over by a remote Hub page. It is read once per page load and
 * removed from the address, so a reload keeps the user's later choices.
 */
export function takeRequestedDeviceId(): string {
  if (requestedDeviceId === null) requestedDeviceId = readRequestedDeviceId();
  return requestedDeviceId;
}

function readRequestedDeviceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const url = new URL(window.location.href);
    const deviceId = text(url.searchParams.get(DEVICE_QUERY_PARAM));
    if (!url.searchParams.has(DEVICE_QUERY_PARAM)) return '';
    url.searchParams.delete(DEVICE_QUERY_PARAM);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    return deviceId;
  } catch {
    return '';
  }
}

export class RemoteHubOpenError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Asks the local Hub for a page showing `targetDeviceId`, returning its address. */
export async function openRemoteHub(targetDeviceId: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch('/api/device-mesh/remote-hub/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetDeviceId, homeOrigin: window.location.origin }),
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.url) {
    throw new RemoteHubOpenError(
      text(body?.error) || `Could not open the device (${response.status})`,
      text(body?.code) || 'HUB_REMOTE_UNAVAILABLE',
    );
  }
  return String(body.url);
}

/**
 * A remote drone's `localhost:<port>` service as this page can reach it. On a remote Hub
 * page it is served by the viewer origin under `p<port>.localhost`; locally it is unchanged.
 */
export function viewerUrlForServiceUrl(rawUrl: string): string;
export function viewerUrlForServiceUrl(rawUrl: string | null): string | null;
export function viewerUrlForServiceUrl(rawUrl: string | null): string | null {
  if (!rawUrl || !remoteHubRuntime()) return rawUrl;
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(host)) return rawUrl;
    const port = Number(url.port || 80);
    const viewerPort = window.location.port;
    // The viewer's own origin is this page, not a service on the remote machine.
    if (!Number.isInteger(port) || port <= 0 || !viewerPort || String(port) === viewerPort) return rawUrl;
    return `http://p${port}.localhost:${viewerPort}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return rawUrl;
  }
}

/**
 * On a remote Hub page, links to `localhost` services (in chats, files or previews) open
 * the remote machine's service instead of one on this machine.
 */
export function installRemoteServiceLinkRewriting(): void {
  if (!remoteHubRuntime() || typeof document === 'undefined') return;
  const rewrite = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(target instanceof HTMLAnchorElement)) return;
    const mapped = viewerUrlForServiceUrl(target.href);
    if (mapped !== target.href) target.href = mapped;
  };
  document.addEventListener('click', rewrite, true);
  document.addEventListener('auxclick', rewrite, true);
}
