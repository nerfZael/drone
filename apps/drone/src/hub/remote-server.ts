import crypto from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { URL } from 'node:url';

import QRCode from 'qrcode';

import { GROQ_TRANSCRIPTION_MAX_BYTES } from './groq-transcription';
import { RemoteAuthStore } from './remote-auth';
import { normalizeRemotePublicUrl } from './remote-state';

type StartRemoteHubServerOptions = {
  port: number;
  host?: string;
  hubBaseUrl: string;
  hubApiToken: string;
  publicUrl?: string | null;
  controlToken: string;
  staticDir: string;
};

type RemoteHubServer = {
  host: string;
  port: number;
  close: () => Promise<void>;
};

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const DRONE_VALIDATION_CACHE_TTL_MS = 5_000;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const PROXY_RESPONSE_HEADER_BLOCKLIST = new Set([...HOP_BY_HOP_HEADERS, 'set-cookie']);
const DRONE_VALIDATION_CACHE = new Map<string, { expiresAt: number; drone: any | null }>();

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...JSON_HEADERS, 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readRawBody(req: http.IncomingMessage, maxBytes = 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buf.length;
    if (total > maxBytes) throw new Error(`request body too large (max ${maxBytes} bytes)`);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function sanitizeDroneSummary(raw: any): any {
  const repoPath = String(raw?.repoPath ?? '').trim();
  const repoAttached = raw?.repoAttached === true || repoPath.length > 0;
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? ''),
    group: raw?.group == null ? null : String(raw.group),
    kind: raw?.kind === 'playbook-run' ? 'playbook-run' : 'standard',
    visibility: raw?.visibility === 'hidden' ? 'hidden' : 'visible',
    playbook: null,
    createdAt: String(raw?.createdAt ?? ''),
    lastActivityAt: raw?.lastActivityAt ?? null,
    lastMessageAt: raw?.lastMessageAt ?? null,
    lastActivityChat: raw?.lastActivityChat ?? null,
    fleetParentId: null,
    fleetAssignedIds: [],
    runtime: 'container',
    persistVolume: false,
    repoAttached,
    repoPath: repoAttached ? repoPath : '',
    repoBranch: typeof raw?.repoBranch === 'string' && raw.repoBranch.trim() ? raw.repoBranch.trim() : null,
    repoSeedSource:
      raw?.repoSeedSource === 'remote' ? 'remote' : raw?.repoSeedSource === 'host' ? 'host' : undefined,
    repoSeedRemoteBranch:
      typeof raw?.repoSeedRemoteBranch === 'string' && raw.repoSeedRemoteBranch.trim()
        ? raw.repoSeedRemoteBranch.trim()
        : null,
    cwd: undefined,
    containerPort: Number(raw?.containerPort ?? 7777) || 7777,
    hostPort: null,
    statusOk: raw?.statusOk === true,
    statusError: raw?.statusOk === true ? null : 'unavailable',
    statusChecking: raw?.statusChecking === true,
    chats: Array.isArray(raw?.chats) ? raw.chats.map(String) : [],
    busyChats: Array.isArray(raw?.busyChats) ? raw.busyChats.map(String) : [],
    hubPhase: raw?.hubPhase ?? null,
    hubMessage: raw?.hubMessage ?? null,
    busy: raw?.busy === true,
  };
}

function isContainerDrone(raw: any): boolean {
  return String(raw?.runtime ?? 'container') === 'container';
}

function splitPathname(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
}

function repoReadRouteAllowed(parts: string[]): boolean {
  if (parts.length < 5 || parts[0] !== 'api' || parts[1] !== 'drones' || parts[3] !== 'repo') return false;
  if (parts.length === 5 && (parts[4] === 'changes' || parts[4] === 'source' || parts[4] === 'diff' || parts[4] === 'commits')) {
    return true;
  }
  if (parts.length === 6 && parts[4] === 'pull' && (parts[5] === 'changes' || parts[5] === 'diff')) {
    return true;
  }
  if (parts.length === 7 && parts[4] === 'commits' && (parts[6] === 'changes' || parts[6] === 'diff')) {
    return true;
  }
  return false;
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.webmanifest') return 'application/manifest+json; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

function safeStaticPath(staticDir: string, pathname: string): string | null {
  const clean = decodeURIComponent(pathname.split('?')[0] ?? '/');
  const rel = clean === '/' ? 'remote.html' : clean.replace(/^\/+/, '');
  const resolved = path.resolve(staticDir, rel);
  const root = path.resolve(staticDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

export function shouldServeRemoteHtmlFallback(pathname: string): boolean {
  const clean = decodeURIComponent(pathname.split('?')[0] ?? '/');
  if (clean === '/' || clean === '/remote.html') return true;
  return !path.posix.extname(clean);
}

async function fetchJsonFromHub<T>(opts: StartRemoteHubServerOptions, pathname: string): Promise<T> {
  const response = await fetch(new URL(pathname, opts.hubBaseUrl).toString(), {
    headers: { authorization: `Bearer ${opts.hubApiToken}` },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
  return data as T;
}

async function resolveContainerDrone(opts: StartRemoteHubServerOptions, droneId: string): Promise<any | null> {
  const cacheKey = `${opts.hubBaseUrl}\u0000${droneId}`;
  const cached = DRONE_VALIDATION_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.drone;
  const data = await fetchJsonFromHub<{ ok: true; drones: any[] }>(opts, '/api/drones');
  const drones = Array.isArray(data?.drones) ? data.drones : [];
  const drone = drones.find((item) => String(item?.id ?? '') === droneId && isContainerDrone(item)) ?? null;
  DRONE_VALIDATION_CACHE.set(cacheKey, { expiresAt: Date.now() + DRONE_VALIDATION_CACHE_TTL_MS, drone });
  return drone;
}

export function routeAllowed(method: string, pathname: string): boolean {
  const parts = splitPathname(pathname);
  if (method === 'POST' && pathname === '/api/audio/transcriptions') return true;
  if (method === 'GET' && pathname === '/api/drones') return true;
  if (method === 'POST' && pathname === '/api/drones') return true;
  if (method === 'POST' && pathname === '/api/drones/name-from-message') return true;
  if (method === 'GET' && pathname === '/api/drones/chat-events') return true;
  if (method === 'GET' && pathname === '/api/repos') return true;
  if (method === 'GET' && pathname === '/api/repos/branches') return true;
  if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'drones') return false;
  if (method === 'GET' && parts.length === 4 && parts[3] === 'chats') return true;
  if (method === 'POST' && parts.length === 4 && parts[3] === 'chats') return true;
  if (method === 'POST' && parts.length === 4 && parts[3] === 'rename') return true;
  if (method === 'GET' && parts.length === 5 && parts[3] === 'chats') return true;
  if (method === 'POST' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'prompt') return true;
  if (method === 'POST' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'stop') return true;
  if (method === 'GET' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'state') return true;
  if (method === 'GET' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'pending') return true;
  if (method === 'GET' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'transcript') return true;
  if (method === 'GET' && repoReadRouteAllowed(parts)) return true;
  return false;
}

async function proxyAllowedRequest(opts: StartRemoteHubServerOptions, req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
  const method = String(req.method ?? 'GET').toUpperCase();
  if (!routeAllowed(method, pathname)) {
    json(res, 404, { ok: false, error: 'not available in remote Hub' });
    return;
  }

  const parts = splitPathname(pathname);
  if (
    parts[0] === 'api' &&
    parts[1] === 'drones' &&
    parts[2] &&
    pathname !== '/api/drones/chat-events' &&
    pathname !== '/api/drones/name-from-message'
  ) {
    const drone = await resolveContainerDrone(opts, parts[2]);
    if (!drone) {
      json(res, 404, { ok: false, error: 'unknown container drone' });
      return;
    }
  }

  if (method === 'GET' && pathname === '/api/drones') {
    const data = await fetchJsonFromHub<{ ok: true; drones: any[] }>(opts, '/api/drones');
    json(res, 200, { ok: true, drones: (data.drones ?? []).filter(isContainerDrone).map(sanitizeDroneSummary) });
    return;
  }

  const body =
    method === 'GET' || method === 'HEAD'
      ? undefined
      : await readRawBody(
          req,
          pathname === '/api/audio/transcriptions' ? GROQ_TRANSCRIPTION_MAX_BYTES : 1024 * 1024,
        );
  const target = new URL(`${pathname}${new URL(req.url ?? '/', 'http://remote.local').search}`, opts.hubBaseUrl);
  const response = await fetch(target.toString(), {
    method,
    headers: {
      authorization: `Bearer ${opts.hubApiToken}`,
      'content-type': String(req.headers['content-type'] ?? 'application/json'),
      ...(req.headers['if-none-match'] ? { 'if-none-match': String(req.headers['if-none-match']) } : {}),
    },
    body: body as any,
  });

  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (!PROXY_RESPONSE_HEADER_BLOCKLIST.has(key.toLowerCase())) res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(response.body as any), res);
  } catch (error: any) {
    if (!res.destroyed) res.destroy(error);
  }
}

async function serveStatic(opts: StartRemoteHubServerOptions, res: http.ServerResponse, pathname: string): Promise<void> {
  const resolved = safeStaticPath(opts.staticDir, pathname);
  const fallback = path.join(opts.staticDir, 'remote.html');
  const filePath = resolved && existsSync(resolved) ? resolved : shouldServeRemoteHtmlFallback(pathname) ? fallback : null;
  if (!filePath) {
    json(res, 404, { ok: false, error: 'static asset not found' });
    return;
  }
  if (!existsSync(filePath)) {
    json(res, 503, {
      ok: false,
      error: 'remote Hub UI is not built yet; run `bun run --filter drone-hub build`',
    });
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', contentTypeFor(filePath));
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html' || path.basename(filePath) === 'pwa-sw.js' || path.basename(filePath) === 'version.json') {
    res.setHeader('cache-control', 'no-store');
  } else if (pathname.startsWith('/assets/')) {
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
  }
  createReadStream(filePath).pipe(res);
}

export async function startRemoteHubServer(opts: StartRemoteHubServerOptions): Promise<RemoteHubServer> {
  const auth = new RemoteAuthStore();
  const host = String(opts.host ?? '127.0.0.1').trim() || '127.0.0.1';
  const publicUrl = normalizeRemotePublicUrl(opts.publicUrl);
  const hubBaseUrl = String(opts.hubBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (!hubBaseUrl) throw new Error('missing Hub base URL');
  if (!String(opts.hubApiToken ?? '').trim()) throw new Error('missing Hub API token');
  if (!String(opts.controlToken ?? '').trim()) throw new Error('missing remote control token');

  const server = http.createServer(async (req, res) => {
    try {
      const method = String(req.method ?? 'GET').toUpperCase();
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'remote.local'}`);
      const pathname = url.pathname;

      if (method === 'GET' && pathname === '/api/remote/session') {
        const session = auth.resolveSession(req);
        json(res, 200, {
          ok: true,
          authenticated: Boolean(session),
          csrf: session?.csrf ?? null,
        });
        return;
      }

      if (method === 'POST' && pathname === '/api/remote/logout') {
        auth.clearSession(req, res);
        json(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && pathname === '/api/local/pairings') {
        const authHeader = String(req.headers.authorization ?? '');
        if (authHeader !== `Bearer ${opts.controlToken}`) {
          json(res, 401, { ok: false, error: 'unauthorized' });
          return;
        }
        const pairing = auth.createPairing();
        const base = publicUrl || `http://${host}:${opts.port}`;
        const pairingUrl = `${base}/pair/${encodeURIComponent(pairing.token)}`;
        const qrSvg = await QRCode.toString(pairingUrl, {
          type: 'svg',
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 256,
          color: { dark: '#111827', light: '#ffffff' },
        });
        json(res, 200, {
          ok: true,
          url: pairingUrl,
          qrSvg,
          expiresAt: new Date(pairing.expiresAtMs).toISOString(),
        });
        return;
      }

      if (method === 'GET' && pathname.startsWith('/api/local/pairings/')) {
        const authHeader = String(req.headers.authorization ?? '');
        if (authHeader !== `Bearer ${opts.controlToken}`) {
          json(res, 401, { ok: false, error: 'unauthorized' });
          return;
        }
        const suffix = pathname.slice('/api/local/pairings/'.length);
        if (!suffix.endsWith('/status')) {
          json(res, 404, { ok: false, error: 'not found' });
          return;
        }
        const token = decodeURIComponent(suffix.slice(0, -'/status'.length));
        const status = auth.pairingStatus(token);
        json(res, 200, {
          ok: true,
          active: status.active,
          expiresAt: status.expiresAtMs ? new Date(status.expiresAtMs).toISOString() : null,
        });
        return;
      }

      if (method === 'GET' && pathname.startsWith('/pair/')) {
        const token = decodeURIComponent(pathname.slice('/pair/'.length));
        const session = auth.consumePairing(token, req, res);
        if (!session) {
          res.statusCode = 401;
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end('<!doctype html><title>Pairing expired</title><p>Pairing link expired or was already used.</p>');
          return;
        }
        res.statusCode = 302;
        res.setHeader('location', '/');
        res.end();
        return;
      }

      if (pathname.startsWith('/api/')) {
        const session = auth.resolveSession(req);
        if (!session) {
          json(res, 401, { ok: false, error: 'pairing required' });
          return;
        }
        if (!auth.requireCsrf(req, session)) {
          json(res, 403, { ok: false, error: 'invalid csrf token' });
          return;
        }
        await proxyAllowedRequest({ ...opts, hubBaseUrl }, req, res, pathname);
        return;
      }

      await serveStatic(opts, res, pathname);
    } catch (error: any) {
      const requestId = crypto.randomBytes(4).toString('hex');
      console.warn('[RemoteHub] request failed', { requestId, error: error?.message ?? String(error) });
      json(res, 500, { ok: false, error: error?.message ?? String(error), requestId });
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port, host, resolve));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : opts.port;
  return {
    host,
    port: actualPort,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
