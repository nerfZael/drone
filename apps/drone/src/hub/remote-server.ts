import crypto from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { URL } from 'node:url';

import QRCode from 'qrcode';

import { GROQ_TRANSCRIPTION_MAX_BYTES } from './groq-transcription';
import { resolveDroneOrPendingForReadRef } from './drone-lifecycle-service';
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
const REMOTE_SLOW_REQUEST_MS = 250;
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
const DRONE_VALIDATION_IN_FLIGHT = new Map<string, Promise<any | null>>();

type RemoteRequestTimer = ReturnType<typeof createRemoteRequestTimer>;

function remoteLog(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
  const at = new Date().toISOString();
  const payload = meta && Object.keys(meta).length > 0 ? { at, ...meta } : { at };
  if (level === 'error') {
    console.error(`[RemoteHub] ${message}`, payload);
    return;
  }
  if (level === 'warn') {
    console.warn(`[RemoteHub] ${message}`, payload);
    return;
  }
  console.log(`[RemoteHub] ${message}`, payload);
}

function createRemoteRequestTimer() {
  const start = process.hrtime.bigint();
  let last = start;
  const items: Array<{ name: string; dur: number }> = [];
  return {
    mark(name: string) {
      const now = process.hrtime.bigint();
      items.push({ name, dur: Number(now - last) / 1_000_000 });
      last = now;
    },
    total(): number {
      return Number(process.hrtime.bigint() - start) / 1_000_000;
    },
    timings(): Record<string, number> {
      const out: Record<string, number> = {};
      for (const item of items) out[item.name] = Math.round(item.dur);
      out.total = Math.round(this.total());
      return out;
    },
    serverTimingValue(): string {
      const total = this.total();
      return [
        ...items.map((item) => `remote-${item.name};dur=${Math.max(0, item.dur).toFixed(1)}`),
        `remote-total;dur=${Math.max(0, total).toFixed(1)}`,
      ].join(', ');
    },
  };
}

function appendServerTiming(res: http.ServerResponse, timer: RemoteRequestTimer): void {
  if (res.headersSent) return;
  const current = res.getHeader('server-timing');
  const remoteTiming = timer.serverTimingValue();
  if (!current) {
    res.setHeader('server-timing', remoteTiming);
    return;
  }
  const values = Array.isArray(current) ? current.map(String).join(', ') : String(current);
  res.setHeader('server-timing', `${values}, ${remoteTiming}`);
}

function remoteRouteLabel(method: string, pathname: string): { label: string; chatLoad: boolean } | null {
  const parts = splitPathname(pathname);
  if (method === 'GET' && pathname === '/api/drones') return { label: 'drone list', chatLoad: true };
  if (parts.length < 4 || parts[0] !== 'api' || parts[1] !== 'drones') return null;
  if (method === 'GET' && parts.length === 4 && parts[3] === 'chats') return { label: 'chat list', chatLoad: true };
  if (method === 'GET' && parts.length === 5 && parts[3] === 'chats') return { label: 'chat metadata', chatLoad: true };
  if (method === 'GET' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'models') return { label: 'chat models', chatLoad: true };
  if (method === 'GET' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'state') return { label: 'chat state', chatLoad: true };
  if (method === 'GET' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'pending') return { label: 'chat pending', chatLoad: true };
  if (method === 'GET' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'transcript') return { label: 'chat transcript', chatLoad: true };
  if (method === 'POST' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'prompt') return { label: 'chat prompt', chatLoad: false };
  if (method === 'POST' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'stop') return { label: 'chat stop', chatLoad: false };
  return null;
}

function logRemoteProxyRequest(opts: {
  method: string;
  pathname: string;
  status: number;
  timer: RemoteRequestTimer;
  requestId: string;
  upstreamStatus?: number | null;
  upstreamServerTiming?: string | null;
  bodyBytes?: number | null;
  error?: string | null;
}): void {
  const route = remoteRouteLabel(opts.method, opts.pathname);
  const durationMs = Math.round(opts.timer.total());
  if (
    (opts.pathname === '/api/drones/events' || opts.pathname === '/api/drones/chat-events') &&
    opts.status < 500 &&
    opts.error &&
    /premature close|aborted/i.test(opts.error)
  ) {
    return;
  }
  const shouldLog = Boolean(route?.chatLoad) || durationMs >= REMOTE_SLOW_REQUEST_MS || opts.status >= 500;
  if (!shouldLog) return;
  remoteLog(durationMs >= REMOTE_SLOW_REQUEST_MS || opts.status >= 500 ? 'warn' : 'info', `proxy ${route?.label ?? 'api'} request`, {
    requestId: opts.requestId,
    method: opts.method,
    path: opts.pathname,
    status: opts.status,
    upstreamStatus: opts.upstreamStatus ?? null,
    upstreamServerTiming: opts.upstreamServerTiming ?? null,
    durationMs,
    timings: opts.timer.timings(),
    bodyBytes: opts.bodyBytes ?? null,
    ...(opts.error ? { error: opts.error } : {}),
  });
}

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
  const runtime = String(raw?.runtime ?? 'container') === 'host' ? 'host' : 'container';
  const repoPath = String(raw?.repoPath ?? '').trim();
  const repoAttached = raw?.repoAttached === true || repoPath.length > 0;
  const statusOk = raw?.statusOk === true;
  const statusChecking = raw?.statusChecking === true;
  const rawStatusError = typeof raw?.statusError === 'string' && raw.statusError.trim() ? raw.statusError.trim() : null;
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
    fleetParentId:
      typeof raw?.fleetParentId === 'string' && raw.fleetParentId.trim()
        ? raw.fleetParentId.trim()
        : null,
    fleetAssignedIds: [],
    runtime,
    persistVolume: runtime === 'container' ? false : undefined,
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
    statusOk,
    statusError: statusOk ? null : rawStatusError ?? (statusChecking ? 'checking status' : 'unavailable'),
    statusChecking,
    chats: Array.isArray(raw?.chats) ? raw.chats.map(String) : [],
    busyChats: Array.isArray(raw?.busyChats) ? raw.busyChats.map(String) : [],
    hubPhase: raw?.hubPhase ?? null,
    hubMessage: raw?.hubMessage ?? null,
    busy: raw?.busy === true,
  };
}

export function sanitizeRemoteDroneSummaries(raw: unknown): any[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeDroneSummary);
}

export function sanitizeRemoteGroupSummaries(raw: unknown): Array<{ name: string; createdAt: string | null }> {
  if (!Array.isArray(raw)) return [];
  const groups: Array<{ name: string; createdAt: string | null }> = [];
  for (const item of raw) {
    const name = String((item as any)?.name ?? '').trim();
    if (!name) continue;
    const createdAt = String((item as any)?.createdAt ?? '').trim();
    groups.push({ name, createdAt: createdAt || null });
  }
  return groups;
}

export function sanitizeRemoteDroneRegistryEvent(eventNameRaw: unknown, dataRaw: unknown): unknown | null {
  const eventName = String(eventNameRaw ?? '').trim();
  const data = (() => {
    if (typeof dataRaw !== 'string') return dataRaw;
    try {
      return JSON.parse(dataRaw || '{}');
    } catch {
      return null;
    }
  })() as any;
  if (!data || typeof data !== 'object') return null;

  if (eventName === 'connected') {
    return { ok: data.ok === true, at: typeof data.at === 'string' ? data.at : null };
  }
  if (eventName === 'snapshot') {
    return { ok: data.ok === true, drones: sanitizeRemoteDroneSummaries(data.drones) };
  }
  if (eventName === 'delta') {
    return {
      ok: data.ok === true,
      upserts: sanitizeRemoteDroneSummaries(data.upserts),
      removedIds: Array.isArray(data.removedIds) ? data.removedIds.map(String) : [],
      order: Array.isArray(data.order) ? data.order.map(String) : [],
    };
  }
  if (eventName === 'stream-error') {
    return { ok: false, error: String(data.error ?? 'Drone registry event stream failed.') };
  }
  return null;
}

function sanitizeRemoteDroneRegistrySseBlock(blockRaw: string): string {
  const block = String(blockRaw ?? '').trimEnd();
  if (!block) return '';
  if (block.startsWith(':')) return `${block}\n\n`;
  let eventName = '';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
  }
  if (!eventName || dataLines.length === 0) return '';
  const sanitized = sanitizeRemoteDroneRegistryEvent(eventName, dataLines.join('\n'));
  return sanitized ? `event: ${eventName}\ndata: ${JSON.stringify(sanitized)}\n\n` : '';
}

export function createRemoteDroneRegistrySseTransform(): Transform {
  let buffered = '';
  return new Transform({
    transform(chunk, _encoding, callback) {
      buffered += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      buffered = buffered.replace(/\r\n/g, '\n');
      let boundary = buffered.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        const sanitized = sanitizeRemoteDroneRegistrySseBlock(block);
        if (sanitized) this.push(sanitized);
        boundary = buffered.indexOf('\n\n');
      }
      callback();
    },
    flush(callback) {
      const sanitized = sanitizeRemoteDroneRegistrySseBlock(buffered);
      if (sanitized) this.push(sanitized);
      callback();
    },
  });
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

function whiteboardRouteAllowed(method: string, parts: string[]): boolean {
  if (parts[0] !== 'api' || parts[1] !== 'whiteboards') return false;
  if (method === 'GET' && parts.length === 3 && parts[2] === 'events') return true;
  if ((method === 'GET' || method === 'POST') && parts.length === 2) return true;
  if ((method === 'GET' || method === 'PATCH' || method === 'DELETE') && parts.length === 3) return true;
  if (method === 'GET' && parts.length === 4 && parts[2] !== 'events' && parts[3] === 'image') return true;
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

export async function resolveContainerDroneForRemoteRequest(opts: { hubBaseUrl: string }, droneId: string): Promise<any | null> {
  const normalizedDroneId = String(droneId ?? '').trim();
  if (!normalizedDroneId) return null;
  const cacheKey = `${String(opts.hubBaseUrl ?? '').trim()}\u0000${normalizedDroneId}`;
  const cached = DRONE_VALIDATION_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.drone;
  const inFlight = DRONE_VALIDATION_IN_FLIGHT.get(cacheKey);
  if (inFlight) return await inFlight;

  const promise = (async () => {
    const resolved = await resolveDroneOrPendingForReadRef(normalizedDroneId);
    const entry = resolved?.kind === 'real' ? resolved.drone : resolved?.kind === 'pending' ? resolved.pending : null;
    const stableId = String(entry?.id ?? resolved?.id ?? '').trim();
    if (!resolved || stableId !== normalizedDroneId) {
      DRONE_VALIDATION_CACHE.set(cacheKey, { expiresAt: Date.now() + DRONE_VALIDATION_CACHE_TTL_MS, drone: null });
      return null;
    }
    const drone = entry && isContainerDrone(entry) ? entry : null;
    DRONE_VALIDATION_CACHE.set(cacheKey, { expiresAt: Date.now() + DRONE_VALIDATION_CACHE_TTL_MS, drone });
    return drone;
  })();
  DRONE_VALIDATION_IN_FLIGHT.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    DRONE_VALIDATION_IN_FLIGHT.delete(cacheKey);
  }
}

export function routeAllowed(method: string, pathname: string): boolean {
  const parts = splitPathname(pathname);
  if (whiteboardRouteAllowed(method, parts)) return true;
  if (method === 'POST' && pathname === '/api/audio/transcriptions') return true;
  if (method === 'GET' && pathname === '/api/drones') return true;
  if (method === 'POST' && pathname === '/api/drones') return true;
  if (method === 'POST' && pathname === '/api/drones/name-from-message') return true;
  if (method === 'GET' && pathname === '/api/drones/events') return true;
  if (method === 'GET' && pathname === '/api/drones/chat-events') return true;
  if (method === 'GET' && pathname === '/api/groups') return true;
  if (method === 'GET' && pathname === '/api/repos') return true;
  if (method === 'GET' && pathname === '/api/repos/branches') return true;
  if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'drones') return false;
  if (method === 'GET' && parts.length === 4 && parts[3] === 'chats') return true;
  if (method === 'POST' && parts.length === 4 && parts[3] === 'chats') return true;
  if (method === 'POST' && parts.length === 4 && parts[3] === 'rename') return true;
  if (method === 'GET' && parts.length === 5 && parts[3] === 'chats') return true;
  if (method === 'GET' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'models') return true;
  if (method === 'POST' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'prompt') return true;
  if (method === 'POST' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'stop') return true;
  if (method === 'GET' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'state') return true;
  if (method === 'GET' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'pending') return true;
  if (method === 'GET' && parts.length === 6 && parts[3] === 'chats' && parts[5] === 'transcript') return true;
  if (method === 'GET' && repoReadRouteAllowed(parts)) return true;
  return false;
}

async function proxyAllowedRequest(
  opts: StartRemoteHubServerOptions,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  timer: RemoteRequestTimer,
  requestId: string,
): Promise<void> {
  const method = String(req.method ?? 'GET').toUpperCase();
  if (!routeAllowed(method, pathname)) {
    timer.mark('allow');
    appendServerTiming(res, timer);
    logRemoteProxyRequest({ method, pathname, status: 404, timer, requestId, error: 'route not allowed' });
    json(res, 404, { ok: false, error: 'not available in remote Hub' });
    return;
  }
  timer.mark('allow');

  const parts = splitPathname(pathname);
  if (
    parts[0] === 'api' &&
    parts[1] === 'drones' &&
    parts[2] &&
    pathname !== '/api/drones/events' &&
    pathname !== '/api/drones/chat-events' &&
    pathname !== '/api/drones/name-from-message'
  ) {
    const drone = await resolveContainerDroneForRemoteRequest(opts, parts[2]);
    timer.mark('validate-drone');
    if (!drone) {
      appendServerTiming(res, timer);
      logRemoteProxyRequest({ method, pathname, status: 404, timer, requestId, error: 'unknown container drone' });
      json(res, 404, { ok: false, error: 'unknown container drone' });
      return;
    }
  }

  if (method === 'GET' && pathname === '/api/drones') {
    const data = await fetchJsonFromHub<{ ok: true; drones: any[] }>(opts, '/api/drones');
    timer.mark('upstream');
    appendServerTiming(res, timer);
    logRemoteProxyRequest({ method, pathname, status: 200, upstreamStatus: 200, timer, requestId });
    json(res, 200, { ok: true, drones: sanitizeRemoteDroneSummaries(data.drones) });
    return;
  }

  if (method === 'GET' && pathname === '/api/groups') {
    const data = await fetchJsonFromHub<{ ok: true; groups: unknown[] }>(opts, '/api/groups');
    timer.mark('upstream');
    appendServerTiming(res, timer);
    logRemoteProxyRequest({ method, pathname, status: 200, upstreamStatus: 200, timer, requestId });
    json(res, 200, { ok: true, groups: sanitizeRemoteGroupSummaries(data.groups) });
    return;
  }

  const body =
    method === 'GET' || method === 'HEAD'
      ? undefined
      : await readRawBody(
          req,
          pathname === '/api/audio/transcriptions' ? GROQ_TRANSCRIPTION_MAX_BYTES : 1024 * 1024,
        );
  if (body) timer.mark('body');
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
  timer.mark('upstream');

  res.statusCode = response.status;
  const upstreamServerTiming = response.headers.get('server-timing');
  response.headers.forEach((value, key) => {
    if (!PROXY_RESPONSE_HEADER_BLOCKLIST.has(key.toLowerCase())) res.setHeader(key, value);
  });
  timer.mark('headers');
  appendServerTiming(res, timer);
  if (!response.body) {
    logRemoteProxyRequest({
      method,
      pathname,
      status: response.status,
      upstreamStatus: response.status,
      upstreamServerTiming,
      timer,
      requestId,
      bodyBytes: body?.byteLength ?? null,
    });
    res.end();
    return;
  }
  try {
    const readable = Readable.fromWeb(response.body as any);
    if (method === 'GET' && pathname === '/api/drones/events') {
      await pipeline(readable, createRemoteDroneRegistrySseTransform(), res);
    } else {
      await pipeline(readable, res);
    }
    timer.mark('stream');
    logRemoteProxyRequest({
      method,
      pathname,
      status: response.status,
      upstreamStatus: response.status,
      upstreamServerTiming,
      timer,
      requestId,
      bodyBytes: body?.byteLength ?? null,
    });
  } catch (error: any) {
    timer.mark('stream');
    logRemoteProxyRequest({
      method,
      pathname,
      status: response.status || 500,
      upstreamStatus: response.status,
      upstreamServerTiming,
      timer,
      requestId,
      bodyBytes: body?.byteLength ?? null,
      error: error?.message ?? String(error),
    });
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
    const requestId = crypto.randomBytes(4).toString('hex');
    const timer = createRemoteRequestTimer();
    res.setHeader('x-request-id', requestId);
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
          timer.mark('auth');
          appendServerTiming(res, timer);
          logRemoteProxyRequest({ method, pathname, status: 401, timer, requestId, error: 'pairing required' });
          json(res, 401, { ok: false, error: 'pairing required' });
          return;
        }
        if (!auth.requireCsrf(req, session)) {
          timer.mark('auth');
          appendServerTiming(res, timer);
          logRemoteProxyRequest({ method, pathname, status: 403, timer, requestId, error: 'invalid csrf token' });
          json(res, 403, { ok: false, error: 'invalid csrf token' });
          return;
        }
        timer.mark('auth');
        await proxyAllowedRequest({ ...opts, hubBaseUrl }, req, res, pathname, timer, requestId);
        return;
      }

      await serveStatic(opts, res, pathname);
    } catch (error: any) {
      timer.mark('error');
      remoteLog('error', 'request failed', { requestId, durationMs: Math.round(timer.total()), error: error?.message ?? String(error) });
      if (res.headersSent) {
        if (!res.destroyed) res.destroy(error);
        return;
      }
      appendServerTiming(res, timer);
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
