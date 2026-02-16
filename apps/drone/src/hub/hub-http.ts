import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';

export async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
    req.on('end', () => resolve());
    req.on('error', reject);
  });
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid JSON body');
  }
}

function appendVaryHeader(res: ServerResponse, value: string) {
  const current = String(res.getHeader('vary') ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (!current.includes(value.toLowerCase())) {
    const next = [...current, value.toLowerCase()];
    res.setHeader('vary', next.join(', '));
  }
}

function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(String(raw));
    const proto = String(u.protocol || '').toLowerCase();
    if (proto !== 'http:' && proto !== 'https:') return null;
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export function withCors(req: IncomingMessage, res: ServerResponse, allowedOrigins: Set<string>): boolean {
  const originRaw = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (!originRaw) return true;

  appendVaryHeader(res, 'origin');
  const origin = normalizeOrigin(originRaw);
  if (!origin || !allowedOrigins.has(origin)) return false;

  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,authorization');
  return true;
}

