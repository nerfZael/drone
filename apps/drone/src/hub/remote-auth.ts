import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { droneRootPath } from '../host/paths';

export type RemoteSession = {
  id: string;
  csrf: string;
  createdAtMs: number;
  lastSeenAtMs: number;
  userAgent: string | null;
};

export type RemotePairing = {
  token: string;
  createdAtMs: number;
  expiresAtMs: number;
};

const SESSION_COOKIE = 'drone_remote_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const PAIRING_TTL_MS = 2 * 60 * 1000;
const SESSION_STORE_VERSION = 1;

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const raw = String(req.headers.cookie ?? '');
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function cookieSecureFlag(req: IncomingMessage): string {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase();
  if (proto === 'https') return '; Secure';
  return '';
}

function remoteSessionStorePath(): string {
  return path.join(droneRootPath(), 'remote-hub-sessions.json');
}

export class RemoteAuthStore {
  private readonly sessions = new Map<string, RemoteSession>();
  private readonly pairings = new Map<string, RemotePairing>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSessionTouchPersistMs = 0;

  constructor() {
    this.loadPersistedSessions();
  }

  createPairing(nowMs = Date.now()): RemotePairing {
    this.prune(nowMs);
    const token = randomToken(24);
    const pairing = { token, createdAtMs: nowMs, expiresAtMs: nowMs + PAIRING_TTL_MS };
    this.pairings.set(token, pairing);
    return pairing;
  }

  pairingStatus(tokenRaw: string, nowMs = Date.now()): { active: boolean; expiresAtMs: number | null } {
    this.prune(nowMs);
    const token = String(tokenRaw ?? '').trim();
    if (!token) return { active: false, expiresAtMs: null };
    const pairing = this.pairings.get(token);
    if (!pairing || pairing.expiresAtMs < nowMs) return { active: false, expiresAtMs: null };
    return { active: true, expiresAtMs: pairing.expiresAtMs };
  }

  consumePairing(
    tokenRaw: string,
    req: IncomingMessage,
    res: ServerResponse,
    nowMs = Date.now(),
  ): RemoteSession | null {
    this.prune(nowMs);
    const token = String(tokenRaw ?? '').trim();
    const pairing = this.pairings.get(token);
    if (!pairing || pairing.expiresAtMs < nowMs) return null;
    this.pairings.delete(token);
    const session: RemoteSession = {
      id: randomToken(32),
      csrf: randomToken(24),
      createdAtMs: nowMs,
      lastSeenAtMs: nowMs,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    };
    this.sessions.set(session.id, session);
    this.lastSessionTouchPersistMs = nowMs;
    this.persistSessions();
    res.setHeader(
      'set-cookie',
      `${SESSION_COOKIE}=${encodeURIComponent(session.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${cookieSecureFlag(req)}`,
    );
    return session;
  }

  resolveSession(req: IncomingMessage, nowMs = Date.now()): RemoteSession | null {
    this.prune(nowMs);
    const id = parseCookies(req)[SESSION_COOKIE];
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    session.lastSeenAtMs = nowMs;
    if (nowMs - this.lastSessionTouchPersistMs > 5 * 60 * 1000) {
      this.lastSessionTouchPersistMs = nowMs;
      this.persistSessionsSoon();
    }
    return session;
  }

  requireCsrf(req: IncomingMessage, session: RemoteSession): boolean {
    const method = String(req.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
    const header = String(req.headers['x-drone-remote-csrf'] ?? '').trim();
    if (!header) return false;
    const a = Buffer.from(header);
    const b = Buffer.from(session.csrf);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  clearSession(req: IncomingMessage, res: ServerResponse): void {
    const id = parseCookies(req)[SESSION_COOKIE];
    if (id) {
      this.sessions.delete(id);
      this.persistSessions();
    }
    res.setHeader(
      'set-cookie',
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecureFlag(req)}`,
    );
  }

  private loadPersistedSessions(nowMs = Date.now()): void {
    try {
      const raw = fs.readFileSync(remoteSessionStorePath(), 'utf8');
      const parsed = JSON.parse(raw) as { version?: number; sessions?: RemoteSession[] };
      if (parsed?.version !== SESSION_STORE_VERSION || !Array.isArray(parsed.sessions)) return;
      for (const session of parsed.sessions) {
        const id = String(session?.id ?? '').trim();
        const csrf = String(session?.csrf ?? '').trim();
        const createdAtMs = Number(session?.createdAtMs);
        const lastSeenAtMs = Number(session?.lastSeenAtMs);
        if (!id || !csrf || !Number.isFinite(createdAtMs) || !Number.isFinite(lastSeenAtMs))
          continue;
        if (lastSeenAtMs + SESSION_TTL_MS < nowMs) continue;
        this.sessions.set(id, {
          id,
          csrf,
          createdAtMs,
          lastSeenAtMs,
          userAgent: typeof session.userAgent === 'string' ? session.userAgent : null,
        });
      }
    } catch {
      // ignore missing or unreadable session store
    }
  }

  private persistSessionsSoon(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistSessions();
    }, 250);
    this.persistTimer.unref?.();
  }

  private persistSessions(): void {
    try {
      const filePath = remoteSessionStorePath();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          { version: SESSION_STORE_VERSION, sessions: Array.from(this.sessions.values()) },
          null,
          2,
        ),
        'utf8',
      );
      if (process.platform !== 'win32') fs.chmodSync(filePath, 0o600);
    } catch {
      // ignore; losing persisted sessions only requires re-pairing
    }
  }

  private prune(nowMs: number): void {
    let changed = false;
    for (const [token, pairing] of this.pairings) {
      if (pairing.expiresAtMs < nowMs) this.pairings.delete(token);
    }
    for (const [id, session] of this.sessions) {
      if (session.lastSeenAtMs + SESSION_TTL_MS < nowMs) {
        this.sessions.delete(id);
        changed = true;
      }
    }
    if (changed) this.persistSessionsSoon();
  }
}
