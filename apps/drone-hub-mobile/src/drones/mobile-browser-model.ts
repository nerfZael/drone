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
