export function browserPreferenceKey(deviceId: string, droneId: string): string {
  return `drone.browser:${JSON.stringify([deviceId, droneId])}`;
}

export function defaultBrowserPort(ports: Array<{ port: number }>): number | null {
  for (const port of [3000, 3001, 4173, 4174, 5173, 5174, 8000, 8001, 8080, 8081, 80]) {
    if (ports.some((target) => target.port === port)) return port;
  }
  return (
    ports.find((target) => ![22, 3389, 6080, 7777].includes(target.port))?.port ??
    ports[0]?.port ??
    null
  );
}

export function browserPath(value: string): string {
  const path = value.trim() || '/';
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(path))
    throw new Error('Enter a path starting with /, such as /dashboard.');
  // The native bootstrap writes this into an HTTP Location header. Encode Unicode and
  // spaces here so the page receives the same URL the user entered, without mojibake.
  const url = new URL(path, 'http://browser.invalid');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function allowBrowserNavigation(url: string, origin: string): boolean {
  try {
    const target = new URL(url);
    return target.origin === origin && !target.username && !target.password;
  } catch {
    return false;
  }
}

export function browserPort(value: string): number {
  if (!/^\d+$/.test(value.trim())) throw new Error('Enter a port between 1 and 65535.');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Enter a port between 1 and 65535.');
  return port;
}

export function browserAccessDialog(
  error: unknown,
  targetName: string,
  phoneName: string,
): { title: string; message: string } | null {
  const code = String((error as { code?: unknown } | null)?.code ?? '');
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (code === 'PERMISSION_DENIED' || /browser access is not permitted/i.test(message)) {
    return {
      title: 'Browser access needed',
      message: `On ${targetName}, open Drone Hub → Settings → Devices. Select ${phoneName}, enable browser.targets, browser.open, and browser.close under Drone control, then Save. These permissions must be changed on ${targetName}, the target device. Return here and tap Try again.`,
    };
  }
  if (
    code === 'UNSUPPORTED_OPERATION' ||
    code === 'CAPABILITY_NOT_FOUND' ||
    code === 'OPERATION_NOT_FOUND'
  ) {
    return {
      title: 'Browser unavailable',
      message: `Update Drone Hub on ${targetName} to a version that supports remote Browser, then try again.`,
    };
  }
  return null;
}

export function browserAddress(port: number | string, path: string): string {
  return `:${port}${path}`;
}

/**
 * Parse what was typed into the address bar. Accepts `3000`, `:3000/dashboard`, `/dashboard`
 * (reusing the current port), `localhost:3000/x`, and full `http://host:3000/x` URLs.
 */
export function parseBrowserAddress(
  value: string,
  currentPort: number | null,
): { port: number; path: string } {
  const text = value.trim();
  if (!text) throw new Error('Enter a port, such as 3000.');
  if (text.startsWith('/')) {
    if (currentPort === null) throw new Error('Enter a port before the path, such as 3000/.');
    return { port: currentPort, path: browserPath(text) };
  }
  const short = /^:?(\d+)(\/.*)?$/.exec(text);
  if (short) return { port: browserPort(short[1]), path: browserPath(short[2] ?? '/') };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    throw new Error('Enter a port, such as 3000 or 3000/dashboard.');
  }
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return { port: browserPort(port), path: browserPath(url.pathname + url.search + url.hash) };
}
