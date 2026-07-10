import crypto from 'node:crypto';

import { loadRegistry, updateRegistry } from '../host/registry';
import { getCatalogStore, type CatalogStore } from '../host/catalog-store';

export type McpAccessTokenKind = 'host' | 'drone';

export type McpAccessTokenRecord = {
  id: string;
  name: string;
  kind: McpAccessTokenKind;
  droneId?: string;
  secretSeed: string;
  tokenPreview: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type McpAccessTokenSummary = Omit<McpAccessTokenRecord, 'secretSeed'>;

export type McpTokenIdentity =
  | { kind: 'legacy'; tokenId: 'legacy'; name: 'Legacy Drone Hub MCP token' }
  | { kind: McpAccessTokenKind; tokenId: string; name: string; droneId?: string };

const TOKEN_PREFIX = 'dhmcp';
const LAST_USED_WRITE_INTERVAL_MS = 60_000;
const lastUsedWrites = new Map<string, number>();

function randomSegment(bytes = 18): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTokenKind(raw: unknown): McpAccessTokenKind {
  return String(raw ?? '').trim() === 'drone' ? 'drone' : 'host';
}

function normalizeOptionalString(raw: unknown): string | undefined {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text || undefined;
}

function normalizeTokenName(raw: unknown): string {
  const text = normalizeOptionalString(raw);
  if (!text) throw new Error('missing token name');
  if (text.length > 120) throw new Error('token name is too long');
  return text;
}

function normalizeStoredToken(raw: unknown, fallbackId?: string): McpAccessTokenRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as any;
  const id = normalizeOptionalString(record.id) || normalizeOptionalString(fallbackId);
  const name = normalizeOptionalString(record.name);
  const secretSeed = normalizeOptionalString(record.secretSeed);
  if (!id || !name || !secretSeed) return null;
  const kind = normalizeTokenKind(record.kind);
  const token: McpAccessTokenRecord = {
    id,
    name,
    kind,
    ...(kind === 'drone' && normalizeOptionalString(record.droneId) ? { droneId: normalizeOptionalString(record.droneId) } : {}),
    secretSeed,
    tokenPreview: normalizeOptionalString(record.tokenPreview) || `${TOKEN_PREFIX}_${id}`,
    createdAt: normalizeOptionalString(record.createdAt) || nowIso(),
    updatedAt: normalizeOptionalString(record.updatedAt) || normalizeOptionalString(record.createdAt) || nowIso(),
    ...(normalizeOptionalString(record.lastUsedAt) ? { lastUsedAt: normalizeOptionalString(record.lastUsedAt) } : {}),
    ...(normalizeOptionalString(record.revokedAt) ? { revokedAt: normalizeOptionalString(record.revokedAt) } : {}),
  };
  return token;
}

function summarizeToken(record: McpAccessTokenRecord): McpAccessTokenSummary {
  const { secretSeed: _secretSeed, ...summary } = record;
  return summary;
}

function tokenSecret(signingSecret: string, record: McpAccessTokenRecord): string {
  return crypto
    .createHmac('sha256', signingSecret)
    .update(`${record.id}:${record.secretSeed}:${record.kind}:${record.droneId ?? ''}`)
    .digest('base64url');
}

export function mcpAccessTokenValue(signingSecret: string, record: McpAccessTokenRecord): string {
  return `${TOKEN_PREFIX}_${record.id}.${tokenSecret(signingSecret, record)}`;
}

function tokenPreview(value: string): string {
  return `${value.slice(0, 18)}...${value.slice(-6)}`;
}

function timingSafeStringEqual(aRaw: string, bRaw: string): boolean {
  const a = Buffer.from(String(aRaw ?? ''), 'utf8');
  const b = Buffer.from(String(bRaw ?? ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function listStoredTokensFromRegistry(reg: any): McpAccessTokenRecord[] {
  const rawTokens = (reg as any)?.mcpTokens;
  if (!rawTokens || typeof rawTokens !== 'object' || Array.isArray(rawTokens)) return [];
  const out: McpAccessTokenRecord[] = [];
  const seenIds = new Set<string>();
  for (const [id, value] of Object.entries(rawTokens)) {
    const token = normalizeStoredToken(value, id);
    if (!token || seenIds.has(token.id)) continue;
    seenIds.add(token.id);
    out.push(token);
  }
  out.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return out;
}

async function canonicalMcpTokenStore(): Promise<CatalogStore | null> {
  try {
    return await getCatalogStore();
  } catch (error) {
    if ((globalThis as any).Bun) return null;
    throw error;
  }
}

async function backfillLegacyMcpTokens(store: CatalogStore): Promise<void> {
  if (store.isBackfillComplete('mcp-tokens')) return;
  await store.backfillMcpTokens(listStoredTokensFromRegistry(await loadRegistry()));
}

async function listStoredTokens(): Promise<McpAccessTokenRecord[]> {
  const store = await canonicalMcpTokenStore();
  if (store) {
    await backfillLegacyMcpTokens(store);
    return store.listMcpTokens();
  }
  return listStoredTokensFromRegistry(await loadRegistry());
}

export async function listMcpAccessTokens(): Promise<McpAccessTokenSummary[]> {
  return (await listStoredTokens()).map(summarizeToken);
}

export async function getMcpAccessTokenById(idRaw: string): Promise<McpAccessTokenSummary | null> {
  const id = normalizeOptionalString(idRaw);
  if (!id) return null;
  const token = (await listStoredTokens()).find((entry) => entry.id === id);
  return token ? summarizeToken(token) : null;
}

export async function createMcpAccessToken(input: {
  name: string;
  kind?: McpAccessTokenKind;
  droneId?: string;
  signingSecret: string;
}): Promise<{ token: McpAccessTokenSummary; tokenValue: string }> {
  const signingSecret = String(input.signingSecret ?? '').trim();
  if (!signingSecret) throw new Error('missing MCP token signing secret');
  const kind = normalizeTokenKind(input.kind);
  const droneId = normalizeOptionalString(input.droneId);
  if (kind === 'drone' && !droneId) throw new Error('missing drone id for drone MCP token');
  const createdAt = nowIso();
  const record: McpAccessTokenRecord = {
    id: randomSegment(12),
    name: normalizeTokenName(input.name),
    kind,
    ...(kind === 'drone' ? { droneId } : {}),
    secretSeed: randomSegment(24),
    tokenPreview: '',
    createdAt,
    updatedAt: createdAt,
  };
  const value = mcpAccessTokenValue(signingSecret, record);
  record.tokenPreview = tokenPreview(value);
  const store = await canonicalMcpTokenStore();
  if (store) {
    await backfillLegacyMcpTokens(store);
    const stored = await store.putMcpToken(record);
    return { token: summarizeToken(stored), tokenValue: value };
  }
  await updateRegistry((reg: any) => {
    reg.mcpTokens = reg.mcpTokens ?? {};
    reg.mcpTokens[record.id] = record;
  });
  return { token: summarizeToken(record), tokenValue: value };
}

export async function ensureHostMcpAccessToken(opts: {
  name?: string;
  signingSecret: string;
}): Promise<{ token: McpAccessTokenSummary; tokenValue: string }> {
  const name = normalizeOptionalString(opts.name) || 'Drone Hub host token';
  const existing = (await listStoredTokens()).find((token) => token.kind === 'host' && token.name === name && !token.revokedAt);
  if (existing) return { token: summarizeToken(existing), tokenValue: mcpAccessTokenValue(opts.signingSecret, existing) };
  try {
    return await createMcpAccessToken({ name, kind: 'host', signingSecret: opts.signingSecret });
  } catch (error) {
    const winner = (await listStoredTokens()).find((token) => token.kind === 'host' && token.name === name && !token.revokedAt);
    if (!winner) throw error;
    return { token: summarizeToken(winner), tokenValue: mcpAccessTokenValue(opts.signingSecret, winner) };
  }
}

export async function ensureDroneMcpAccessToken(opts: {
  droneId: string;
  droneName?: string;
  signingSecret: string;
}): Promise<{ token: McpAccessTokenSummary; tokenValue: string }> {
  const droneId = normalizeOptionalString(opts.droneId);
  if (!droneId) throw new Error('missing drone id for drone MCP token');
  const existing = (await listStoredTokens()).find((token) => token.kind === 'drone' && token.droneId === droneId && !token.revokedAt);
  if (existing) return { token: summarizeToken(existing), tokenValue: mcpAccessTokenValue(opts.signingSecret, existing) };
  const droneName = normalizeOptionalString(opts.droneName) || droneId;
  try {
    return await createMcpAccessToken({ name: `${droneName} drone token`, kind: 'drone', droneId, signingSecret: opts.signingSecret });
  } catch (error) {
    const winner = (await listStoredTokens()).find((token) => token.kind === 'drone' && token.droneId === droneId && !token.revokedAt);
    if (!winner) throw error;
    return { token: summarizeToken(winner), tokenValue: mcpAccessTokenValue(opts.signingSecret, winner) };
  }
}

export async function regenerateMcpAccessToken(idRaw: string, signingSecret: string): Promise<{ token: McpAccessTokenSummary; tokenValue: string }> {
  const id = normalizeOptionalString(idRaw);
  if (!id) throw new Error('missing MCP token id');
  const store = await canonicalMcpTokenStore();
  if (store) {
    await backfillLegacyMcpTokens(store);
    const next = await store.updateMcpToken(id, (existing) => {
      const updated: McpAccessTokenRecord = { ...existing, secretSeed: randomSegment(24), updatedAt: nowIso() };
      delete updated.revokedAt;
      updated.tokenPreview = tokenPreview(mcpAccessTokenValue(signingSecret, updated));
      return updated;
    });
    if (!next) throw new Error(`unknown MCP token: ${id}`);
    return { token: summarizeToken(next), tokenValue: mcpAccessTokenValue(signingSecret, next) };
  }
  let updated: McpAccessTokenRecord | null = null;
  await updateRegistry((reg: any) => {
    const existing = normalizeStoredToken(reg?.mcpTokens?.[id], id);
    if (!existing) throw new Error(`unknown MCP token: ${id}`);
    const next: McpAccessTokenRecord = {
      ...existing,
      secretSeed: randomSegment(24),
      updatedAt: nowIso(),
    };
    delete next.revokedAt;
    const value = mcpAccessTokenValue(signingSecret, next);
    next.tokenPreview = tokenPreview(value);
    reg.mcpTokens = reg.mcpTokens ?? {};
    reg.mcpTokens[id] = next;
    updated = next;
  });
  if (!updated) throw new Error(`unknown MCP token: ${id}`);
  return { token: summarizeToken(updated), tokenValue: mcpAccessTokenValue(signingSecret, updated) };
}

export async function revokeMcpAccessToken(idRaw: string): Promise<McpAccessTokenSummary | null> {
  const id = normalizeOptionalString(idRaw);
  if (!id) return null;
  const store = await canonicalMcpTokenStore();
  if (store) {
    await backfillLegacyMcpTokens(store);
    const revoked = await store.updateMcpToken(id, (existing) => ({
      ...existing,
      revokedAt: existing.revokedAt || nowIso(),
      updatedAt: nowIso(),
    }));
    return revoked ? summarizeToken(revoked) : null;
  }
  let revoked: McpAccessTokenRecord | null = null;
  await updateRegistry((reg: any) => {
    const existing = normalizeStoredToken(reg?.mcpTokens?.[id], id);
    if (!existing) return false;
    revoked = {
      ...existing,
      revokedAt: existing.revokedAt || nowIso(),
      updatedAt: nowIso(),
    };
    reg.mcpTokens = reg.mcpTokens ?? {};
    reg.mcpTokens[id] = revoked;
    return true;
  });
  return revoked ? summarizeToken(revoked) : null;
}

export async function revokeMcpAccessTokensForDrone(droneIdRaw: string): Promise<McpAccessTokenSummary[]> {
  const droneId = normalizeOptionalString(droneIdRaw);
  if (!droneId) return [];
  const store = await canonicalMcpTokenStore();
  if (store) {
    await backfillLegacyMcpTokens(store);
    return (await store.revokeMcpTokensForDrone(droneId, nowIso())).map(summarizeToken);
  }
  const revoked: McpAccessTokenRecord[] = [];
  await updateRegistry((reg: any) => {
    const rawTokens = reg?.mcpTokens;
    if (!rawTokens || typeof rawTokens !== 'object' || Array.isArray(rawTokens)) return false;
    let changed = false;
    const at = nowIso();
    for (const [id, value] of Object.entries(rawTokens)) {
      const existing = normalizeStoredToken(value, id);
      if (!existing || existing.kind !== 'drone' || existing.droneId !== droneId || existing.revokedAt) continue;
      const next = {
        ...existing,
        revokedAt: at,
        updatedAt: at,
      };
      rawTokens[id] = next;
      revoked.push(next);
      changed = true;
    }
    return changed;
  });
  return revoked.map(summarizeToken);
}

export function bearerTokenFromAuthorizationHeader(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  const text = String(value ?? '').trim();
  const match = text.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export async function authenticateMcpBearerToken(bearerToken: string, signingSecret: string): Promise<McpTokenIdentity | null> {
  const token = String(bearerToken ?? '').trim();
  const secret = String(signingSecret ?? '').trim();
  if (!token || !secret) return null;
  if (timingSafeStringEqual(token, secret)) {
    return { kind: 'legacy', tokenId: 'legacy', name: 'Legacy Drone Hub MCP token' };
  }
  if (!token.startsWith(`${TOKEN_PREFIX}_`)) return null;
  const id = token.slice(TOKEN_PREFIX.length + 1).split('.', 1)[0]?.trim();
  if (!id) return null;
  const record = (await listStoredTokens()).find((entry) => entry.id === id);
  if (!record || record.revokedAt) return null;
  const expected = mcpAccessTokenValue(secret, record);
  if (!timingSafeStringEqual(token, expected)) return null;
  await markMcpAccessTokenUsed(record.id);
  return {
    kind: record.kind,
    tokenId: record.id,
    name: record.name,
    ...(record.droneId ? { droneId: record.droneId } : {}),
  };
}

async function markMcpAccessTokenUsed(id: string): Promise<void> {
  const now = Date.now();
  const previous = lastUsedWrites.get(id) ?? 0;
  if (now - previous < LAST_USED_WRITE_INTERVAL_MS) return;
  lastUsedWrites.set(id, now);
  const at = nowIso();
  const store = await canonicalMcpTokenStore();
  if (store) {
    await store.updateMcpToken(id, (existing) => ({ ...existing, lastUsedAt: at }));
    return;
  }
  await updateRegistry((reg: any) => {
    const existing = normalizeStoredToken(reg?.mcpTokens?.[id], id);
    if (!existing) return false;
    reg.mcpTokens = reg.mcpTokens ?? {};
    reg.mcpTokens[id] = { ...existing, lastUsedAt: at, updatedAt: existing.updatedAt };
    return true;
  }).catch(() => {});
}
