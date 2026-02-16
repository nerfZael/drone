import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { URL } from 'node:url';

export function isHubApiAuthorized(req: IncomingMessage, apiToken: string): boolean {
  const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const expected = `Bearer ${apiToken}`;
  const a = Buffer.from(auth, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function isHubApiToken(raw: string, apiToken: string): boolean {
  const a = Buffer.from(String(raw ?? ''), 'utf8');
  const b = Buffer.from(String(apiToken ?? ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function isHubApiAuthorizedForWebSocket(req: IncomingMessage, u: URL, apiToken: string): boolean {
  if (isHubApiAuthorized(req, apiToken)) return true;
  const token = String(u.searchParams.get('token') ?? '');
  if (!token) return false;
  return isHubApiToken(token, apiToken);
}

export function rejectWebSocketUpgrade(socket: any, statusCode: number, statusText: string): void {
  try {
    socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\n\r\n`);
  } catch {
    // ignore
  }
  try {
    socket.destroy();
  } catch {
    // ignore
  }
}

