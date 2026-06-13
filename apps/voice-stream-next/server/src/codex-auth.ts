const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_SCOPE = 'openid profile email offline_access';
const CODEX_JWT_AUTH_CLAIM = 'https://api.openai.com/auth';
const DEFAULT_CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';

export type CodexAuthorizationFlow = {
  state: string;
  verifier: string;
  redirectUri: string;
  authorizationUrl: string;
  expiresAt: string;
};

export type CodexTokenSet = {
  accessToken: string;
  refreshToken: string;
  accountId: string | null;
  expiresAt: string;
};

export async function createCodexAuthorizationFlow(): Promise<CodexAuthorizationFlow> {
  const { verifier, challenge } = await generatePKCE();
  const state = randomState();
  const redirectUri = process.env.VOICE_STREAM_NEXT_CODEX_REDIRECT_URI?.trim() || DEFAULT_CODEX_REDIRECT_URI;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const url = new URL(CODEX_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CODEX_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', CODEX_SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'voice-stream-next');
  return { state, verifier, redirectUri, authorizationUrl: url.toString(), expiresAt };
}

export function parseCodexAuthorizationInput(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    };
  } catch {
    // Not a URL.
  }
  if (value.includes('#')) {
    const [code, state] = value.split('#', 2);
    return { code, state };
  }
  if (value.includes('code=')) {
    const params = new URLSearchParams(value);
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    };
  }
  return { code: value };
}

export async function exchangeCodexAuthorizationCode(input: {
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<CodexTokenSet> {
  return exchangeCodexToken({
    grant_type: 'authorization_code',
    client_id: CODEX_CLIENT_ID,
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
  }, 'exchange');
}

export async function refreshCodexAccessToken(refreshToken: string): Promise<CodexTokenSet> {
  return exchangeCodexToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CODEX_CLIENT_ID,
  }, 'refresh');
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = base64Url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

async function exchangeCodexToken(params: Record<string, string>, action: string): Promise<CodexTokenSet> {
  const response = await fetch(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI Codex token ${action} failed (${response.status}): ${text || response.statusText}`);
  }
  const json = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error(`OpenAI Codex token ${action} response missing fields`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    accountId: extractCodexAccountId(json.access_token),
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}

function extractCodexAccountId(token: string): string | null {
  try {
    const payload = decodeJwtPayload(token) as Record<string, any>;
    const auth = payload?.[CODEX_JWT_AUTH_CLAIM];
    return typeof auth?.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): unknown {
  const payload = token.split('.')[1];
  if (!payload) return null;
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
  return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
