import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';

export type HubJsonResponder = (res: ServerResponse, status: number, body: unknown) => void;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return;
  const data = JSON.stringify(body, null, 2);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(data);
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (message != null) return String(message);
  }
  return String(error);
}

export function sendJsonError(
  res: ServerResponse,
  status: number,
  error: unknown,
  respond: HubJsonResponder = sendJson,
): void {
  if (res.writableEnded) return;
  if (res.headersSent) {
    res.end();
    return;
  }
  respond(res, status, { ok: false, error: errorMessage(error) });
}

export async function readRawBody(
  req: IncomingMessage,
  opts: { maxBytes?: number } = {},
): Promise<Buffer> {
  const maxBytes = Number.isFinite(Number(opts.maxBytes))
    ? Math.max(1, Math.floor(Number(opts.maxBytes)))
    : null;
  if (maxBytes != null) {
    const contentLengthRaw = Array.isArray(req.headers['content-length'])
      ? req.headers['content-length'][0]
      : req.headers['content-length'];
    const contentLength = Number(contentLengthRaw);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`request body too large (max ${maxBytes} bytes)`);
    }
  }
  const chunks: Buffer[] = [];
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    let rejected = false;
    req.on('data', (d) => {
      if (rejected) return;
      const chunk = Buffer.isBuffer(d) ? d : Buffer.from(String(d));
      total += chunk.length;
      if (maxBytes != null && total > maxBytes) {
        rejected = true;
        reject(new Error(`request body too large (max ${maxBytes} bytes)`));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) resolve();
    });
    req.on('error', reject);
  });
  return Buffer.concat(chunks);
}

export async function readJsonBody(req: IncomingMessage): Promise<any> {
  const raw = (await readRawBody(req)).toString('utf8').trim();
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

export function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(String(raw));
    const proto = String(u.protocol || '').toLowerCase();
    if (proto !== 'http:' && proto !== 'https:') return null;
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export function withCors(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: Set<string>,
): boolean {
  const originRaw = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (!originRaw) return true;

  appendVaryHeader(res, 'origin');
  const origin = normalizeOrigin(originRaw);
  if (!origin || !allowedOrigins.has(origin)) return false;

  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'access-control-allow-headers',
    [
      'content-type',
      'authorization',
      'if-none-match',
      'mcp-session-id',
      'x-drone-transcription-quality',
      'x-drone-transcription-language',
      'x-drone-transcription-prompt-base64',
    ].join(','),
  );
  res.setHeader('access-control-expose-headers', 'etag,mcp-session-id,server-timing');
  res.setHeader('access-control-max-age', '600');
  return true;
}
