import { toByteArray } from 'base64-js';

const JWT_CLAIM_PATH = 'https://api.openai.com/auth';

export type LocalCodexAuth = {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  expiresAt: number | null;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const encoded = String(parts[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const bytes = toByteArray(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function codexAccountId(accessToken: string): string {
  return text(decodeJwtPayload(accessToken)?.[JWT_CLAIM_PATH]?.chatgpt_account_id);
}

export function codexAccessTokenExpiresAt(accessToken: string): number | null {
  const expiresAt = Number(decodeJwtPayload(accessToken)?.exp);
  return Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt * 1_000 : null;
}

export function parseCodexAuthJson(raw: string): LocalCodexAuth {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Codex credential file is not valid JSON');
  }
  const accessToken = text(parsed?.tokens?.access_token);
  const refreshToken = text(parsed?.tokens?.refresh_token);
  const accountId = text(parsed?.tokens?.account_id) || codexAccountId(accessToken);
  if (!accessToken || !refreshToken || !accountId)
    throw new Error('Codex credential file does not contain a usable login');
  return {
    accessToken,
    refreshToken,
    accountId,
    expiresAt: codexAccessTokenExpiresAt(accessToken),
  };
}

export function parseStoredCodexAuth(raw: string): LocalCodexAuth {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Saved Codex login is invalid');
  }
  const accessToken = text(parsed?.accessToken);
  const refreshToken = text(parsed?.refreshToken);
  const accountId = text(parsed?.accountId) || codexAccountId(accessToken);
  const expiresAt = Number(parsed?.expiresAt);
  if (!accessToken || !refreshToken || !accountId)
    throw new Error('Saved Codex login is incomplete');
  return {
    accessToken,
    refreshToken,
    accountId,
    expiresAt:
      Number.isFinite(expiresAt) && expiresAt > 0
        ? expiresAt
        : codexAccessTokenExpiresAt(accessToken),
  };
}
