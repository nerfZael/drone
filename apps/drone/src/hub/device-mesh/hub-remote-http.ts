import type http from 'node:http';

// Connection-level headers never cross a proxy hop.
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'http2-settings',
]);

export const HUB_REMOTE_SESSION_HEADER = 'x-drone-hub-remote';
export const HUB_REMOTE_SESSION_INVALID = 'session-invalid';
/** Nothing listens on the requested port; viewers turn this into a failed connection. */
export const HUB_REMOTE_PORT_UNREACHABLE = 'port-unreachable';

/** Request or response headers without hop-by-hop fields and without `omit`. */
export function forwardableHeaders(
  headers: http.IncomingHttpHeaders,
  omit: Iterable<string> = [],
): Record<string, string | string[]> {
  const skipped = new Set([...HOP_BY_HOP_HEADERS, ...omit]);
  const connectionTokens = String(headers.connection ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  for (const token of connectionTokens) skipped.add(token);
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null || skipped.has(key.toLowerCase())) continue;
    result[key] = value;
  }
  return result;
}

/** The raw head of an HTTP/1.1 upgrade request, for writing to an upstream socket. */
export function upgradeRequestHead(
  method: string,
  path: string,
  headers: Record<string, string | string[]>,
): string {
  const lines = [`${method} ${path} HTTP/1.1`];
  for (const [key, value] of Object.entries(headers)) {
    for (const item of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${item}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

/** The raw head of a response received by an http client, for replaying to a client socket. */
export function rawResponseHead(response: http.IncomingMessage): string {
  const lines = [`HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? ''}`.trimEnd()];
  for (let index = 0; index + 1 < response.rawHeaders.length; index += 2) {
    lines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

export function rejectUpgrade(socket: { destroyed: boolean; end(data: string, callback?: () => void): unknown; destroy(): unknown }, status: number, reason: string): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () =>
    socket.destroy(),
  );
}

export function portNumber(value: unknown): number | null {
  const text = String(value ?? '');
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}
