import * as SecureStore from 'expo-secure-store';
import {
  codexAccountId,
  parseCodexAuthJson,
  parseStoredCodexAuth,
  type LocalCodexAuth,
} from './codex-auth-format';

const CODEX_AUTH_NAME = 'droneHub.localAssistant.codexAuth.v1';
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const REFRESH_WINDOW_MS = 5 * 60_000;

export async function saveLocalAssistantCodexAuth(auth: LocalCodexAuth): Promise<void> {
  await SecureStore.setItemAsync(CODEX_AUTH_NAME, JSON.stringify(auth), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function loadCodexAuth(): Promise<LocalCodexAuth | null> {
  const raw = await SecureStore.getItemAsync(CODEX_AUTH_NAME);
  if (!raw) return null;
  return parseStoredCodexAuth(raw);
}

async function refreshCodexAuth(current: LocalCodexAuth): Promise<LocalCodexAuth> {
  const response = await fetch(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: CODEX_CLIENT_ID,
    }).toString(),
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      String(body?.error_description ?? body?.error ?? `Codex login refresh failed (${response.status})`),
    );
  const accessToken = String(body?.access_token ?? '').trim();
  const refreshToken = String(body?.refresh_token ?? current.refreshToken).trim();
  const accountId = codexAccountId(accessToken) || current.accountId;
  const expiresIn = Number(body?.expires_in);
  if (!accessToken || !refreshToken || !accountId)
    throw new Error('Codex login refresh returned incomplete credentials');
  const next: LocalCodexAuth = {
    accessToken,
    refreshToken,
    accountId,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1_000 : null,
  };
  await saveLocalAssistantCodexAuth(next);
  return next;
}

export async function hasLocalAssistantCodexAuth(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(CODEX_AUTH_NAME);
  if (!raw) return false;
  try {
    parseStoredCodexAuth(raw);
    return true;
  } catch {
    return false;
  }
}

export async function saveImportedCodexAuthJson(authJson: string): Promise<void> {
  await saveLocalAssistantCodexAuth(parseCodexAuthJson(authJson));
}

export async function readLocalAssistantCodexAuth(): Promise<LocalCodexAuth> {
  const current = await loadCodexAuth();
  if (!current) throw new Error('Sign in to Codex in Settings before sending a prompt');
  if (current.expiresAt === null || current.expiresAt > Date.now() + REFRESH_WINDOW_MS)
    return current;
  return await refreshCodexAuth(current);
}

export async function clearLocalAssistantCodexAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(CODEX_AUTH_NAME);
}
