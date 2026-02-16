import path from 'node:path';

import dotenv from 'dotenv';

import { loadRegistry, updateRegistry } from '../host/registry';

let HUB_ENV_LOADED = false;
export function loadHubEnv() {
  if (HUB_ENV_LOADED) return;
  HUB_ENV_LOADED = true;

  // Load .env files if present. This makes local dev ergonomics nicer.
  // It does NOT override already-exported environment variables.
  //
  // Compiled layout:
  //   apps/drone/dist/hub/server.js -> __dirname = apps/drone/dist/hub
  const appRoot = path.resolve(__dirname, '..', '..'); // apps/drone/
  const repoRoot = path.resolve(appRoot, '..', '..'); // repo root

  const candidates = [
    path.join(appRoot, '.env.local'),
    path.join(appRoot, '.env'),
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, '.env'),
  ];

  for (const p of candidates) {
    try {
      dotenv.config({ path: p, override: false });
    } catch {
      // ignore
    }
  }
}

export function hubLog(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) {
  const at = new Date().toISOString();
  const payload = meta && Object.keys(meta).length > 0 ? { at, ...meta } : { at };
  if (level === 'error') {
    console.error(`[DroneHub] ${message}`, payload);
    return;
  }
  if (level === 'warn') {
    console.warn(`[DroneHub] ${message}`, payload);
    return;
  }
  console.log(`[DroneHub] ${message}`, payload);
}

export type LlmProviderId = 'openai' | 'gemini';
export type ApiKeySettingsSource = 'settings' | 'environment' | null;
export type EffectiveProviderApiKeySettings = {
  apiKey: string | null;
  source: ApiKeySettingsSource;
  updatedAt: string | null;
};
export type LlmProviderSource = 'settings' | 'environment' | 'default';
export type EffectiveLlmProvider = {
  provider: LlmProviderId;
  source: LlmProviderSource;
};

export function parseLlmProvider(raw: unknown): LlmProviderId | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'openai' || s === 'gemini') return s;
  return null;
}

function normalizeApiKey(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function apiKeyHint(apiKey: string | null): string | null {
  const key = normalizeApiKey(apiKey);
  if (!key) return null;
  if (key.length <= 8) return `${key.slice(0, 2)}...${key.slice(-2)}`;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function providerApiKeyEnvVar(provider: LlmProviderId): 'OPENAI_API_KEY' | 'GEMINI_API_KEY' {
  return provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
}

export function providerDisplayName(provider: LlmProviderId): string {
  return provider === 'openai' ? 'OpenAI' : 'Gemini';
}

async function getStoredProviderApiKey(provider: LlmProviderId): Promise<{ apiKey: string; updatedAt: string | null } | null> {
  const reg = await loadRegistry();
  const block = provider === 'openai' ? reg.settings?.openai : reg.settings?.gemini;
  const apiKey = normalizeApiKey(block?.apiKey);
  if (!apiKey) return null;
  const updatedAtRaw = block?.updatedAt;
  const updatedAt = typeof updatedAtRaw === 'string' && updatedAtRaw.trim() ? updatedAtRaw : null;
  return { apiKey, updatedAt };
}

export async function upsertStoredProviderApiKey(provider: LlmProviderId, apiKeyRaw: string): Promise<void> {
  const apiKey = normalizeApiKey(apiKeyRaw);
  if (!apiKey) throw new Error('API key is required.');
  const updatedAt = new Date().toISOString();
  await updateRegistry((reg) => {
    reg.settings ??= {};
    if (provider === 'openai') reg.settings.openai = { apiKey, updatedAt };
    else reg.settings.gemini = { apiKey, updatedAt };
  });
}

export async function clearStoredProviderApiKey(provider: LlmProviderId): Promise<void> {
  await updateRegistry((reg) => {
    if (!reg.settings) return;
    if (provider === 'openai') {
      if (!reg.settings.openai) return;
      delete reg.settings.openai;
    } else {
      if (!reg.settings.gemini) return;
      delete reg.settings.gemini;
    }
    if (Object.keys(reg.settings).length === 0) delete reg.settings;
  });
}

export async function resolveEffectiveProviderApiKeySettings(provider: LlmProviderId): Promise<EffectiveProviderApiKeySettings> {
  const stored = await getStoredProviderApiKey(provider);
  if (stored) {
    return {
      apiKey: stored.apiKey,
      source: 'settings',
      updatedAt: stored.updatedAt,
    };
  }
  const envVar = providerApiKeyEnvVar(provider);
  const envApiKey = normalizeApiKey(process.env[envVar]);
  if (envApiKey) {
    return {
      apiKey: envApiKey,
      source: 'environment',
      updatedAt: null,
    };
  }
  return {
    apiKey: null,
    source: null,
    updatedAt: null,
  };
}

async function getStoredLlmProvider(): Promise<LlmProviderId | null> {
  const reg = await loadRegistry();
  return parseLlmProvider(reg.settings?.llm?.provider);
}

export async function upsertStoredLlmProvider(provider: LlmProviderId): Promise<void> {
  const updatedAt = new Date().toISOString();
  await updateRegistry((reg) => {
    reg.settings ??= {};
    reg.settings.llm = { provider, updatedAt };
  });
}

export async function resolveEffectiveLlmProvider(): Promise<EffectiveLlmProvider> {
  const stored = await getStoredLlmProvider();
  if (stored) return { provider: stored, source: 'settings' };
  const env = parseLlmProvider(process.env.DRONE_HUB_LLM_PROVIDER);
  if (env) return { provider: env, source: 'environment' };
  return { provider: 'openai', source: 'default' };
}

export function providerKeySettingsResponse(settings: EffectiveProviderApiKeySettings): {
  hasKey: boolean;
  source: ApiKeySettingsSource;
  keyHint: string | null;
  updatedAt: string | null;
} {
  return {
    hasKey: Boolean(settings.apiKey),
    source: settings.source,
    keyHint: apiKeyHint(settings.apiKey),
    updatedAt: settings.source === 'settings' ? settings.updatedAt : null,
  };
}

export async function resolveLlmSettingsResponse(): Promise<{
  ok: true;
  provider: { selected: LlmProviderId; source: LlmProviderSource };
  openai: { hasKey: boolean; source: ApiKeySettingsSource; keyHint: string | null; updatedAt: string | null };
  gemini: { hasKey: boolean; source: ApiKeySettingsSource; keyHint: string | null; updatedAt: string | null };
}> {
  const [provider, openai, gemini] = await Promise.all([
    resolveEffectiveLlmProvider(),
    resolveEffectiveProviderApiKeySettings('openai'),
    resolveEffectiveProviderApiKeySettings('gemini'),
  ]);
  return {
    ok: true,
    provider: { selected: provider.provider, source: provider.source },
    openai: providerKeySettingsResponse(openai),
    gemini: providerKeySettingsResponse(gemini),
  };
}

