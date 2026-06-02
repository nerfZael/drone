import type { FastifyRequest } from 'fastify';
import { clerkClient, getAuth } from '@clerk/fastify';
import type { UserProfile, VoiceStreamNextDb } from './db.js';

export type AuthContext = {
  user: UserProfile;
  mode: 'clerk' | 'dev' | 'webview';
};

type ClerkUserLike = {
  id: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
  emailAddresses?: Array<{ emailAddress?: string | null }>;
};

function csv(raw: string | undefined): Set<string> {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function boolHeader(raw: unknown): boolean {
  const value = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function displayNameForClerkUser(user: ClerkUserLike): string {
  const fullName = String(user.fullName ?? '').trim();
  if (fullName) return fullName;
  const joined = [user.firstName, user.lastName].map((part) => String(part ?? '').trim()).filter(Boolean).join(' ');
  if (joined) return joined;
  const email = String(user.primaryEmailAddress?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? '').trim();
  return email || user.id;
}

function emailForClerkUser(user: ClerkUserLike): string {
  return String(user.primaryEmailAddress?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? '').trim();
}

function isAdmin(clerkUserId: string, email: string, explicitAdmin = false): boolean {
  const adminIds = csv(process.env.VOICE_STREAM_NEXT_ADMIN_CLERK_USER_IDS);
  const adminEmails = csv(process.env.VOICE_STREAM_NEXT_ADMIN_EMAILS);
  return explicitAdmin || adminIds.has(clerkUserId.toLowerCase()) || (email ? adminEmails.has(email.toLowerCase()) : false);
}

function cookieValue(rawCookie: unknown, name: string): string {
  const cookie = String(Array.isArray(rawCookie) ? rawCookie[0] : rawCookie ?? '');
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function hasAuthorizationHeader(req: FastifyRequest): boolean {
  return String(req.headers.authorization ?? '').trim().length > 0;
}

async function resolveClerkRequestUser(req: FastifyRequest, db: VoiceStreamNextDb): Promise<AuthContext> {
  const auth = getAuth(req);
  if (!auth.isAuthenticated || !auth.userId) {
    throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
  }
  const clerkUser = (await clerkClient.users.getUser(auth.userId)) as ClerkUserLike;
  const email = emailForClerkUser(clerkUser);
  const user = db.upsertUser({
    clerkUserId: clerkUser.id,
    displayName: displayNameForClerkUser(clerkUser),
    email,
    admin: isAdmin(clerkUser.id, email),
  });
  return { user, mode: 'clerk' };
}

export async function resolveRequestUser(req: FastifyRequest, db: VoiceStreamNextDb, clerkEnabled: boolean): Promise<AuthContext> {
  if (clerkEnabled && hasAuthorizationHeader(req)) {
    return resolveClerkRequestUser(req, db);
  }

  const webviewSession = cookieValue(req.headers.cookie, 'voice_stream_webview_session');
  if (webviewSession) {
    const user = db.userForWebViewSessionToken(webviewSession);
    if (user) return { user, mode: 'webview' };
  }

  if (clerkEnabled) {
    return resolveClerkRequestUser(req, db);
  }

  const headerId = String(req.headers['x-voice-dev-user-id'] ?? '').trim();
  const headerEmail = String(req.headers['x-voice-dev-user-email'] ?? '').trim();
  const headerName = String(req.headers['x-voice-dev-user-name'] ?? '').trim();
  const email = headerEmail || 'developer@example.local';
  const clerkUserId = headerId || `dev_${email.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  const user = db.upsertUser({
    clerkUserId,
    email,
    displayName: headerName || email,
    admin: isAdmin(clerkUserId, email, boolHeader(req.headers['x-voice-dev-admin'])),
  });
  return { user, mode: 'dev' };
}

export function requireAdmin(ctx: AuthContext): void {
  if (!ctx.user.admin) throw Object.assign(new Error('admin access required'), { statusCode: 403 });
}
