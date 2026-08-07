import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import dotenv from 'dotenv';

import {
  getHubSettingsRepository,
  HubSettingVersionConflictError,
  type HubSettingRecord,
} from '../host/hub-settings-repository';
import { loadRegistry, updateRegistry, type DroneRegistry } from '../host/registry';
import { createCodexLoginManager } from './codex-login-manager';
import { GROQ_SPEECH_VOICES, type GroqSpeechVoice } from './groq-speech';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

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

export type LlmProviderId = 'openai' | 'gemini' | 'codex';
export type StoredApiKeyProviderId = 'openai' | 'gemini' | 'groq' | 'exa';
export type ApiKeySettingsSource = 'settings' | 'environment' | 'codex-cli' | null;
export type EffectiveProviderApiKeySettings = {
  apiKey: string | null;
  source: ApiKeySettingsSource;
  updatedAt: string | null;
};
export type SecretValueDiagnostics = {
  present: boolean;
  hasValue: boolean;
  rawLength: number | null;
  trimmedLength: number | null;
  fingerprint: string | null;
};
export type ProviderApiKeyResolutionDiagnostics = {
  provider: LlmProviderId;
  envVar: 'OPENAI_API_KEY' | 'GEMINI_API_KEY' | 'DRONE_HUB_CODEX_AUTH_FILE';
  env: SecretValueDiagnostics;
  stored: {
    hasValue: boolean;
    updatedAt: string | null;
    fingerprint: string | null;
  };
  effective: {
    source: ApiKeySettingsSource;
    hasValue: boolean;
    updatedAt: string | null;
    fingerprint: string | null;
  };
};
export type LlmProviderSource = 'settings' | 'environment' | 'default';
export type EffectiveLlmProvider = {
  provider: LlmProviderId;
  source: LlmProviderSource;
};
export type DroneDeleteMode = 'permanent' | 'archive';
export type ArchiveRetentionId = '1h' | '8h' | '1d' | '1w';
export type ArchiveRuntimePolicy = 'keep-running' | 'stop';
export type SidebarGroupingMode = 'groups' | 'repos';
export type DeleteActionSettingsSource = 'settings' | 'default';
export type EffectiveDeleteActionSettings = {
  mode: DroneDeleteMode;
  modeSource: DeleteActionSettingsSource;
  archiveRetention: ArchiveRetentionId;
  archiveRetentionSource: DeleteActionSettingsSource;
  archiveRuntimePolicy: ArchiveRuntimePolicy;
  archiveRuntimePolicySource: DeleteActionSettingsSource;
};
export type FilesystemSettingsSource = 'settings' | 'default';
export type EffectiveFilesystemSettings = {
  uploadMaxBytes: number;
  uploadMaxBytesSource: FilesystemSettingsSource;
};
export type SpeechSettings = {
  enabled: boolean;
  muted: boolean;
  volume: number;
  voice: GroqSpeechVoice;
};
export type VoiceInputEndThoughtPreset = 'quick' | 'balanced' | 'patient' | 'custom';
export type VoiceInputNoiseHandling = 'auto' | 'quiet' | 'noisy';
export type VoiceInputTranscriptionQuality = 'fast' | 'accurate';
export type VoiceInputSettings = {
  endThoughtPreset: VoiceInputEndThoughtPreset;
  customSilenceMillis: number;
  noiseHandling: VoiceInputNoiseHandling;
  language: string | null;
  quality: VoiceInputTranscriptionQuality;
  confirmationFeedback: boolean;
};
export type UiPreferencesSettings = {
  sidebarGroupingMode: SidebarGroupingMode;
  sidebarDensityMode: 'compact' | 'default' | 'comfortable';
  sidebarGroupOrder: string[];
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  pinnedDroneIds: string[];
  hiddenSidebarGroups: string[];
  autoDelete: boolean;
  spawnAgentKey: string;
  spawnModel: string;
  repoBranchSource: 'host' | 'remote';
  repoCreateRemoteBranch: string;
};
export type UserContextSettings = {
  timeZone: string | null;
};

const ARCHIVE_RETENTION_MS_MAP: Record<ArchiveRetentionId, number> = {
  '1h': 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
};
const DEFAULT_DRONE_DELETE_MODE: DroneDeleteMode = 'permanent';
const DEFAULT_ARCHIVE_RETENTION: ArchiveRetentionId = '1d';
const DEFAULT_ARCHIVE_RUNTIME_POLICY: ArchiveRuntimePolicy = 'keep-running';
const DEFAULT_SIDEBAR_GROUPING_MODE: SidebarGroupingMode = 'groups';
const DEFAULT_SIDEBAR_DENSITY_MODE: UiPreferencesSettings['sidebarDensityMode'] = 'default';
const DEFAULT_SPAWN_AGENT_KEY = 'builtin:cursor';
const DEFAULT_REPO_BRANCH_SOURCE: UiPreferencesSettings['repoBranchSource'] = 'host';
export const FILESYSTEM_UPLOAD_MAX_BYTES_MIN = 1 * 1024 * 1024;
export const FILESYSTEM_UPLOAD_MAX_BYTES_MAX = 8 * 1024 * 1024 * 1024;
export const FILESYSTEM_UPLOAD_MAX_BYTES_DEFAULT = 2 * 1024 * 1024 * 1024;
export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  enabled: true,
  muted: false,
  volume: 1,
  voice: 'troy',
};
export const DEFAULT_VOICE_INPUT_SETTINGS: VoiceInputSettings = {
  endThoughtPreset: 'balanced',
  customSilenceMillis: 2_500,
  noiseHandling: 'auto',
  language: null,
  quality: 'fast',
  confirmationFeedback: false,
};

export const VOICE_INPUT_SILENCE_MILLIS_BY_PRESET: Record<
  Exclude<VoiceInputEndThoughtPreset, 'custom'>,
  number
> = {
  quick: 1_500,
  balanced: 2_500,
  patient: 4_000,
};

export function resolveVoiceInputSilenceMillis(settings: VoiceInputSettings): number {
  return settings.endThoughtPreset === 'custom'
    ? settings.customSilenceMillis
    : VOICE_INPUT_SILENCE_MILLIS_BY_PRESET[settings.endThoughtPreset];
}

export function parseLlmProvider(raw: unknown): LlmProviderId | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'openai' || s === 'gemini' || s === 'codex') return s;
  if (s === 'openai-codex' || s === 'chatgpt' || s === 'chatgpt-codex') return 'codex';
  return null;
}

export function parseDroneDeleteMode(raw: unknown): DroneDeleteMode | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'permanent' || s === 'archive') return s;
  return null;
}

export function parseArchiveRetentionId(raw: unknown): ArchiveRetentionId | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === '1h' || s === '8h' || s === '1d' || s === '1w') return s;
  return null;
}

export function parseArchiveRuntimePolicy(raw: unknown): ArchiveRuntimePolicy | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'keep-running' || s === 'stop') return s;
  return null;
}

export function parseSidebarGroupingMode(raw: unknown): SidebarGroupingMode | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'groups' || s === 'repos') return s;
  return null;
}

function parseSidebarDensityMode(raw: unknown): UiPreferencesSettings['sidebarDensityMode'] | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  return s === 'compact' || s === 'comfortable' || s === 'default' ? s : null;
}

function parseRepoBranchSource(raw: unknown): UiPreferencesSettings['repoBranchSource'] | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  return s === 'host' || s === 'remote' ? s : null;
}

export function archiveRetentionMs(retention: ArchiveRetentionId): number {
  return ARCHIVE_RETENTION_MS_MAP[retention];
}

export function parseFilesystemUploadMaxBytes(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < FILESYSTEM_UPLOAD_MAX_BYTES_MIN || i > FILESYSTEM_UPLOAD_MAX_BYTES_MAX) return null;
  return i;
}

export function parseSpeechVolume(raw: unknown): number | null {
  const volume = Number(raw);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) return null;
  return volume;
}

export function parseSpeechVoice(raw: unknown): GroqSpeechVoice | null {
  const voice = String(raw ?? '').trim().toLowerCase();
  return (GROQ_SPEECH_VOICES as readonly string[]).includes(voice)
    ? (voice as GroqSpeechVoice)
    : null;
}

function normalizeApiKey(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function apiKeyFingerprint(apiKeyRaw: unknown): string | null {
  const apiKey = normalizeApiKey(apiKeyRaw);
  if (!apiKey) return null;
  return crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex').slice(0, 12);
}

export function describeSecretValue(raw: unknown): SecretValueDiagnostics {
  const present = raw !== undefined;
  const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  const trimmed = text.trim();
  return {
    present,
    hasValue: trimmed.length > 0,
    rawLength: present ? text.length : null,
    trimmedLength: present ? trimmed.length : null,
    fingerprint: apiKeyFingerprint(trimmed),
  };
}

function normalizeOrderedStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const entry = String(item ?? '').trim();
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

function normalizeOrderedStringMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [keyRaw, listRaw] of Object.entries(value as Record<string, unknown>)) {
    const key = String(keyRaw ?? '').trim();
    if (!key) continue;
    const list = normalizeOrderedStringList(listRaw);
    if (list.length === 0) continue;
    out[key] = list;
  }
  return out;
}

function normalizeUiPreferenceText(value: unknown, maxChars: number): string {
  return String(value ?? '').trim().slice(0, maxChars);
}

function sanitizeUiPreferencesSettings(value: unknown): UiPreferencesSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    sidebarGroupingMode: parseSidebarGroupingMode(raw.sidebarGroupingMode) ?? DEFAULT_SIDEBAR_GROUPING_MODE,
    sidebarDensityMode: parseSidebarDensityMode(raw.sidebarDensityMode) ?? DEFAULT_SIDEBAR_DENSITY_MODE,
    sidebarGroupOrder: normalizeOrderedStringList(raw.sidebarGroupOrder),
    sidebarDroneOrderByGroup: normalizeOrderedStringMap(raw.sidebarDroneOrderByGroup),
    sidebarNodeOrderByParent: normalizeOrderedStringMap(raw.sidebarNodeOrderByParent),
    sidebarChatOrderByDrone: normalizeOrderedStringMap(raw.sidebarChatOrderByDrone),
    pinnedDroneIds: normalizeOrderedStringList(raw.pinnedDroneIds),
    hiddenSidebarGroups: normalizeOrderedStringList(raw.hiddenSidebarGroups),
    autoDelete: raw.autoDelete === true,
    spawnAgentKey: normalizeUiPreferenceText(raw.spawnAgentKey, 200) || DEFAULT_SPAWN_AGENT_KEY,
    spawnModel: normalizeUiPreferenceText(raw.spawnModel, 200),
    repoBranchSource: parseRepoBranchSource(raw.repoBranchSource) ?? DEFAULT_REPO_BRANCH_SOURCE,
    repoCreateRemoteBranch: normalizeUiPreferenceText(raw.repoCreateRemoteBranch, 400),
  };
}


function apiKeyHint(apiKey: string | null): string | null {
  const key = normalizeApiKey(apiKey);
  if (!key) return null;
  if (key.length <= 8) return `${key.slice(0, 2)}...${key.slice(-2)}`;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

const SETTING_KEYS = {
  providerApiKey: (provider: StoredApiKeyProviderId) => `api-key.${provider}`,
  llmProvider: 'llm.provider',
  deleteAction: 'delete-action',
  filesystem: 'filesystem',
  speech: 'speech',
  voiceInput: 'voice-input',
  userContext: 'user-context',
} as const;

type LegacySetting<T> = { value: T; updatedAt: string | null };

function legacyUpdatedAt(raw: any): string | null {
  return typeof raw?.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt.trim() : null;
}

async function getCanonicalSetting<T>(
  key: string,
  legacy: (registry: DroneRegistry) => LegacySetting<T> | null,
): Promise<HubSettingRecord<T | null> | null> {
  const repository = await getHubSettingsRepository();
  const canonical = repository.get<T | null>(key);
  if (canonical) return canonical;
  const candidate = legacy(await loadRegistry());
  if (candidate) {
    return await repository.backfillIfAbsent<T | null>(key, candidate.value, candidate.updatedAt);
  }
  return repository.get<T | null>(key);
}

async function putCanonicalSetting<T>(key: string, value: T | null): Promise<void> {
  await (await getHubSettingsRepository()).put<T | null>(key, value);
}

function providerApiKeyEnvVar(provider: LlmProviderId): 'OPENAI_API_KEY' | 'GEMINI_API_KEY' | 'DRONE_HUB_CODEX_AUTH_FILE' {
  if (provider === 'codex') return 'DRONE_HUB_CODEX_AUTH_FILE';
  return provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
}

export function providerDisplayName(provider: LlmProviderId): string {
  if (provider === 'codex') return 'Codex';
  return provider === 'openai' ? 'OpenAI' : 'Gemini';
}

async function getStoredProviderApiKey(provider: StoredApiKeyProviderId): Promise<{ apiKey: string; updatedAt: string | null } | null> {
  const record = await getCanonicalSetting<{ apiKey: string }>(SETTING_KEYS.providerApiKey(provider), (reg) => {
    const block = provider === 'openai'
      ? reg.settings?.openai
      : provider === 'gemini'
        ? reg.settings?.gemini
        : provider === 'groq'
          ? reg.settings?.groq
          : reg.settings?.exa;
    const apiKey = normalizeApiKey(block?.apiKey);
    return apiKey ? { value: { apiKey }, updatedAt: legacyUpdatedAt(block) } : null;
  });
  const apiKey = normalizeApiKey(record?.value?.apiKey);
  if (!apiKey) return null;
  return { apiKey, updatedAt: record?.updatedAt ?? null };
}

export async function upsertStoredProviderApiKey(provider: StoredApiKeyProviderId, apiKeyRaw: string): Promise<void> {
  const apiKey = normalizeApiKey(apiKeyRaw);
  if (!apiKey) throw new Error('API key is required.');
  await putCanonicalSetting(SETTING_KEYS.providerApiKey(provider), { apiKey });
}

export async function clearStoredProviderApiKey(provider: StoredApiKeyProviderId): Promise<void> {
  await putCanonicalSetting(SETTING_KEYS.providerApiKey(provider), null);
}

function codexAuthFilePath(): string {
  const configured = normalizeApiKey(process.env.DRONE_HUB_CODEX_AUTH_FILE);
  if (configured) return configured;
  return path.join(os.homedir(), '.codex', 'auth.json');
}

const CODEX_AUTH_TRANSFER_MAX_BYTES = 128 * 1024;

function decodeJwtPayload(token: string): any | null {
  try {
    const parts = String(token ?? '').split('.');
    if (parts.length !== 3) return null;
    const raw = parts[1] ?? '';
    const padded = `${raw}${'='.repeat((4 - (raw.length % 4)) % 4)}`;
    return JSON.parse(Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function codexAccessTokenExpiresAt(accessToken: string): number | null {
  const exp = Number(decodeJwtPayload(accessToken)?.exp);
  if (!Number.isFinite(exp) || exp <= 0) return null;
  return exp * 1000;
}

function codexCredentialsFromAuthJson(parsed: any): {
  access: string;
  refresh: string;
  accountId: string | null;
  lastRefresh: string | null;
  expires: number | null;
} | null {
  const tokens = parsed?.tokens && typeof parsed.tokens === 'object' ? parsed.tokens : {};
  const access = normalizeApiKey(tokens.access_token);
  const refresh = normalizeApiKey(tokens.refresh_token);
  if (!access || !refresh) return null;
  const accountId = normalizeApiKey(tokens.account_id) || null;
  const lastRefresh = normalizeApiKey(parsed?.last_refresh) || null;
  return {
    access,
    refresh,
    accountId,
    lastRefresh,
    expires: codexAccessTokenExpiresAt(access),
  };
}

export async function readCodexCliAuthJsonForTransfer(): Promise<string | null> {
  try {
    const authJson = await fs.readFile(codexAuthFilePath(), 'utf8');
    if (Buffer.byteLength(authJson) > CODEX_AUTH_TRANSFER_MAX_BYTES) return null;
    if (!codexCredentialsFromAuthJson(JSON.parse(authJson))) return null;
    return authJson;
  } catch {
    return null;
  }
}

export async function installCodexCliAuthJsonFromTransfer(authJson: string): Promise<void> {
  if (Buffer.byteLength(authJson) > CODEX_AUTH_TRANSFER_MAX_BYTES)
    throw new Error('Codex credential file is too large.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(authJson);
  } catch {
    throw new Error('Codex credential file is not valid JSON.');
  }
  if (!codexCredentialsFromAuthJson(parsed))
    throw new Error('Codex credential file does not contain a usable login.');
  const authPath = codexAuthFilePath();
  await fs.mkdir(path.dirname(authPath), { recursive: true });
  const temporaryPath = `${authPath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, authPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
  await fs.chmod(authPath, 0o600).catch(() => {});
}

const codexLoginManager = createCodexLoginManager({
  login: async (options) => {
    const { loginOpenAICodex } = await dynamicImport('@mariozechner/pi-ai/oauth');
    return await loginOpenAICodex(options);
  },
  installAuthJson: installCodexCliAuthJsonFromTransfer,
});

export const startCodexLogin = () => codexLoginManager.start();
export const codexLoginStatus = () => codexLoginManager.status();
export const cancelCodexLogin = () => codexLoginManager.cancel();

async function refreshCodexCliAuthFile(authPath: string, parsed: any, refreshToken: string): Promise<{ apiKey: string; updatedAt: string | null }> {
  const { refreshOpenAICodexToken } = await dynamicImport('@mariozechner/pi-ai/oauth');
  const refreshed = await refreshOpenAICodexToken(refreshToken);
  const updatedAt = new Date().toISOString();
  const next = {
    ...parsed,
    auth_mode: typeof parsed?.auth_mode === 'string' && parsed.auth_mode.trim() ? parsed.auth_mode : 'chatgpt',
    tokens: {
      ...(parsed?.tokens && typeof parsed.tokens === 'object' ? parsed.tokens : {}),
      access_token: refreshed.access,
      refresh_token: refreshed.refresh,
      account_id: typeof refreshed.accountId === 'string' ? refreshed.accountId : (parsed?.tokens?.account_id ?? undefined),
      ...(typeof refreshed.idToken === 'string' ? { id_token: refreshed.idToken } : {}),
    },
    last_refresh: updatedAt,
  };
  await fs.writeFile(authPath, JSON.stringify(next, null, 2), 'utf8');
  await fs.chmod(authPath, 0o600).catch(() => {});
  return { apiKey: refreshed.access, updatedAt };
}

async function resolveCodexCliAuthSettings(): Promise<EffectiveProviderApiKeySettings> {
  const authPath = codexAuthFilePath();
  try {
    const parsed = JSON.parse(await fs.readFile(authPath, 'utf8'));
    const credentials = codexCredentialsFromAuthJson(parsed);
    if (!credentials) return { apiKey: null, source: null, updatedAt: null };

    const refreshAt = credentials.expires ? credentials.expires - 5 * 60 * 1000 : null;
    if (refreshAt && Date.now() >= refreshAt) {
      try {
        const refreshed = await refreshCodexCliAuthFile(authPath, parsed, credentials.refresh);
        return { apiKey: refreshed.apiKey, source: 'codex-cli', updatedAt: refreshed.updatedAt };
      } catch {
        if (credentials.expires && Date.now() >= credentials.expires) {
          return { apiKey: null, source: null, updatedAt: credentials.lastRefresh };
        }
      }
    }

    return { apiKey: credentials.access, source: 'codex-cli', updatedAt: credentials.lastRefresh };
  } catch {
    return { apiKey: null, source: null, updatedAt: null };
  }
}

export async function resolveEffectiveProviderApiKeySettings(provider: LlmProviderId): Promise<EffectiveProviderApiKeySettings> {
  if (provider === 'codex') return await resolveCodexCliAuthSettings();

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

export async function resolveGroqApiKeySettings(): Promise<EffectiveProviderApiKeySettings> {
  const stored = await getStoredProviderApiKey('groq');
  if (!stored) return { apiKey: null, source: null, updatedAt: null };
  return {
    apiKey: stored.apiKey,
    source: 'settings',
    updatedAt: stored.updatedAt,
  };
}

export async function resolveExaApiKeySettings(): Promise<EffectiveProviderApiKeySettings> {
  const stored = await getStoredProviderApiKey('exa');
  if (!stored) return { apiKey: null, source: null, updatedAt: null };
  return {
    apiKey: stored.apiKey,
    source: 'settings',
    updatedAt: stored.updatedAt,
  };
}

export async function collectProviderApiKeyDiagnostics(provider: LlmProviderId): Promise<ProviderApiKeyResolutionDiagnostics> {
  const envVar = providerApiKeyEnvVar(provider);
  const stored = provider === 'codex' ? null : await getStoredProviderApiKey(provider);
  const effective = await resolveEffectiveProviderApiKeySettings(provider);
  return {
    provider,
    envVar,
    env: describeSecretValue(process.env[envVar]),
    stored: {
      hasValue: Boolean(stored?.apiKey),
      updatedAt: stored?.updatedAt ?? null,
      fingerprint: apiKeyFingerprint(stored?.apiKey),
    },
    effective: {
      source: effective.source,
      hasValue: Boolean(effective.apiKey),
      updatedAt: effective.updatedAt,
      fingerprint: apiKeyFingerprint(effective.apiKey),
    },
  };
}

async function getStoredLlmProvider(): Promise<LlmProviderId | null> {
  const record = await getCanonicalSetting<{ provider: LlmProviderId }>(SETTING_KEYS.llmProvider, (reg) => {
    const raw = reg.settings?.llm;
    const provider = parseLlmProvider(raw?.provider);
    return provider ? { value: { provider }, updatedAt: legacyUpdatedAt(raw) } : null;
  });
  return parseLlmProvider(record?.value?.provider);
}

export async function upsertStoredLlmProvider(provider: LlmProviderId): Promise<void> {
  await putCanonicalSetting(SETTING_KEYS.llmProvider, { provider });
}

export async function resolveEffectiveLlmProvider(): Promise<EffectiveLlmProvider> {
  const stored = await getStoredLlmProvider();
  if (stored) return { provider: stored, source: 'settings' };
  const env = parseLlmProvider(process.env.DRONE_HUB_LLM_PROVIDER);
  if (env) return { provider: env, source: 'environment' };
  return { provider: 'openai', source: 'default' };
}

export async function resolveNameSuggestionLlmSettings(): Promise<{
  provider: 'codex' | 'openai';
  apiKey: string | null;
  source: ApiKeySettingsSource;
  updatedAt: string | null;
}> {
  const codex = await resolveEffectiveProviderApiKeySettings('codex');
  if (codex.apiKey) return { provider: 'codex', ...codex };

  const openai = await resolveEffectiveProviderApiKeySettings('openai');
  return { provider: 'openai', ...openai };
}

export function providerKeySettingsResponse(
  settings: EffectiveProviderApiKeySettings,
  options?: { includeApiKey?: boolean },
): {
  hasKey: boolean;
  source: ApiKeySettingsSource;
  keyHint: string | null;
  updatedAt: string | null;
  apiKey?: string | null;
} {
  return {
    hasKey: Boolean(settings.apiKey),
    source: settings.source,
    keyHint: apiKeyHint(settings.apiKey),
    updatedAt: settings.source === 'settings' ? settings.updatedAt : null,
    ...(options?.includeApiKey ? { apiKey: settings.apiKey } : {}),
  };
}

export async function resolveLlmSettingsResponse(): Promise<{
  ok: true;
  provider: { selected: LlmProviderId; source: LlmProviderSource };
  openai: { hasKey: boolean; source: ApiKeySettingsSource; keyHint: string | null; updatedAt: string | null };
  gemini: { hasKey: boolean; source: ApiKeySettingsSource; keyHint: string | null; updatedAt: string | null };
  codex: { hasKey: boolean; source: ApiKeySettingsSource; keyHint: string | null; updatedAt: string | null };
  groq: { hasKey: boolean; source: ApiKeySettingsSource; keyHint: string | null; updatedAt: string | null };
}> {
  const [provider, openai, gemini, codex, groq] = await Promise.all([
    resolveEffectiveLlmProvider(),
    resolveEffectiveProviderApiKeySettings('openai'),
    resolveEffectiveProviderApiKeySettings('gemini'),
    resolveEffectiveProviderApiKeySettings('codex'),
    resolveGroqApiKeySettings(),
  ]);
  return {
    ok: true,
    provider: { selected: provider.provider, source: provider.source },
    openai: providerKeySettingsResponse(openai),
    gemini: providerKeySettingsResponse(gemini),
    codex: providerKeySettingsResponse(codex),
    groq: providerKeySettingsResponse(groq),
  };
}

async function getStoredDeleteActionSettings(): Promise<{
  mode: DroneDeleteMode | null;
  archiveRetention: ArchiveRetentionId | null;
  archiveRuntimePolicy: ArchiveRuntimePolicy | null;
}> {
  const record = await getCanonicalSetting<{
    mode: DroneDeleteMode | null;
    archiveRetention: ArchiveRetentionId | null;
    archiveRuntimePolicy: ArchiveRuntimePolicy | null;
  }>(SETTING_KEYS.deleteAction, (reg) => {
    const raw = reg.settings?.deleteAction;
    if (raw === undefined) return null;
    return {
      value: {
        mode: parseDroneDeleteMode(raw.mode),
        archiveRetention: parseArchiveRetentionId(raw.archiveRetention),
        archiveRuntimePolicy: parseArchiveRuntimePolicy(raw.archiveRuntimePolicy),
      },
      updatedAt: legacyUpdatedAt(raw),
    };
  });
  return {
    mode: parseDroneDeleteMode(record?.value?.mode),
    archiveRetention: parseArchiveRetentionId(record?.value?.archiveRetention),
    archiveRuntimePolicy: parseArchiveRuntimePolicy(record?.value?.archiveRuntimePolicy),
  };
}

export async function upsertStoredDeleteActionSettings(opts: {
  mode?: DroneDeleteMode;
  archiveRetention?: ArchiveRetentionId;
  archiveRuntimePolicy?: ArchiveRuntimePolicy;
}): Promise<void> {
  const mode = opts.mode ? parseDroneDeleteMode(opts.mode) : null;
  const archiveRetention = opts.archiveRetention ? parseArchiveRetentionId(opts.archiveRetention) : null;
  const archiveRuntimePolicy = opts.archiveRuntimePolicy ? parseArchiveRuntimePolicy(opts.archiveRuntimePolicy) : null;
  if (opts.mode != null && !mode) throw new Error('invalid delete mode');
  if (opts.archiveRetention != null && !archiveRetention) throw new Error('invalid archive retention');
  if (opts.archiveRuntimePolicy != null && !archiveRuntimePolicy) throw new Error('invalid archive runtime policy');

  await getStoredDeleteActionSettings();
  await (await getHubSettingsRepository()).update<{
    mode: DroneDeleteMode;
    archiveRetention: ArchiveRetentionId;
    archiveRuntimePolicy: ArchiveRuntimePolicy;
  }>(SETTING_KEYS.deleteAction, (current) => ({
    mode: mode ?? parseDroneDeleteMode(current?.value?.mode) ?? DEFAULT_DRONE_DELETE_MODE,
    archiveRetention:
      archiveRetention ?? parseArchiveRetentionId(current?.value?.archiveRetention) ?? DEFAULT_ARCHIVE_RETENTION,
    archiveRuntimePolicy:
      archiveRuntimePolicy ??
      parseArchiveRuntimePolicy(current?.value?.archiveRuntimePolicy) ??
      DEFAULT_ARCHIVE_RUNTIME_POLICY,
  }));
}

export async function resolveEffectiveDeleteActionSettings(): Promise<EffectiveDeleteActionSettings> {
  const stored = await getStoredDeleteActionSettings();
  return {
    mode: stored.mode ?? DEFAULT_DRONE_DELETE_MODE,
    modeSource: stored.mode ? 'settings' : 'default',
    archiveRetention: stored.archiveRetention ?? DEFAULT_ARCHIVE_RETENTION,
    archiveRetentionSource: stored.archiveRetention ? 'settings' : 'default',
    archiveRuntimePolicy: stored.archiveRuntimePolicy ?? DEFAULT_ARCHIVE_RUNTIME_POLICY,
    archiveRuntimePolicySource: stored.archiveRuntimePolicy ? 'settings' : 'default',
  };
}

export async function resolveDeleteActionSettingsResponse(): Promise<{
  ok: true;
  deleteAction: {
    mode: DroneDeleteMode;
    modeSource: DeleteActionSettingsSource;
    archiveRetention: ArchiveRetentionId;
    archiveRetentionSource: DeleteActionSettingsSource;
    archiveRetentionMs: number;
    archiveRuntimePolicy: ArchiveRuntimePolicy;
    archiveRuntimePolicySource: DeleteActionSettingsSource;
  };
}> {
  const settings = await resolveEffectiveDeleteActionSettings();
  return {
    ok: true,
    deleteAction: {
      mode: settings.mode,
      modeSource: settings.modeSource,
      archiveRetention: settings.archiveRetention,
      archiveRetentionSource: settings.archiveRetentionSource,
      archiveRetentionMs: archiveRetentionMs(settings.archiveRetention),
      archiveRuntimePolicy: settings.archiveRuntimePolicy,
      archiveRuntimePolicySource: settings.archiveRuntimePolicySource,
    },
  };
}

async function getStoredFilesystemSettings(): Promise<{ uploadMaxBytes: number | null }> {
  const record = await getCanonicalSetting<{ uploadMaxBytes: number } | null>(SETTING_KEYS.filesystem, (reg) => {
    const raw = reg.settings?.filesystem;
    if (raw === undefined) return null;
    const uploadMaxBytes = parseFilesystemUploadMaxBytes(raw.uploadMaxBytes);
    return { value: uploadMaxBytes ? { uploadMaxBytes } : null, updatedAt: legacyUpdatedAt(raw) };
  });
  return { uploadMaxBytes: parseFilesystemUploadMaxBytes(record?.value?.uploadMaxBytes) };
}

export async function upsertStoredFilesystemSettings(opts: {
  uploadMaxBytes?: number;
}): Promise<void> {
  const uploadMaxBytes = opts.uploadMaxBytes != null ? parseFilesystemUploadMaxBytes(opts.uploadMaxBytes) : null;
  if (opts.uploadMaxBytes != null && !uploadMaxBytes) {
    throw new Error(
      `uploadMaxBytes must be between ${FILESYSTEM_UPLOAD_MAX_BYTES_MIN} and ${FILESYSTEM_UPLOAD_MAX_BYTES_MAX}`,
    );
  }
  const repository = await getHubSettingsRepository();
  await getStoredFilesystemSettings();
  const current = repository.get<{ uploadMaxBytes: number } | null>(SETTING_KEYS.filesystem);
  const nextUploadMaxBytes =
    uploadMaxBytes ??
    parseFilesystemUploadMaxBytes(current?.value?.uploadMaxBytes) ??
    FILESYSTEM_UPLOAD_MAX_BYTES_DEFAULT;
  await repository.put(
    SETTING_KEYS.filesystem,
    nextUploadMaxBytes === FILESYSTEM_UPLOAD_MAX_BYTES_DEFAULT
      ? null
      : { uploadMaxBytes: nextUploadMaxBytes },
  );
}

export async function resolveEffectiveFilesystemSettings(): Promise<EffectiveFilesystemSettings> {
  const stored = await getStoredFilesystemSettings();
  return {
    uploadMaxBytes: stored.uploadMaxBytes ?? FILESYSTEM_UPLOAD_MAX_BYTES_DEFAULT,
    uploadMaxBytesSource: stored.uploadMaxBytes ? 'settings' : 'default',
  };
}

export async function resolveFilesystemSettingsResponse(): Promise<{
  ok: true;
  filesystem: {
    uploadMaxBytes: number;
    uploadMaxBytesSource: FilesystemSettingsSource;
    minUploadMaxBytes: number;
    maxUploadMaxBytes: number;
    defaultUploadMaxBytes: number;
  };
}> {
  const settings = await resolveEffectiveFilesystemSettings();
  return {
    ok: true,
    filesystem: {
      uploadMaxBytes: settings.uploadMaxBytes,
      uploadMaxBytesSource: settings.uploadMaxBytesSource,
      minUploadMaxBytes: FILESYSTEM_UPLOAD_MAX_BYTES_MIN,
      maxUploadMaxBytes: FILESYSTEM_UPLOAD_MAX_BYTES_MAX,
      defaultUploadMaxBytes: FILESYSTEM_UPLOAD_MAX_BYTES_DEFAULT,
    },
  };
}

export async function resolveEffectiveSpeechSettings(): Promise<SpeechSettings> {
  const record = await getCanonicalSetting<Partial<SpeechSettings>>(SETTING_KEYS.speech, () => null);
  const stored = record?.value;
  return {
    enabled: typeof stored?.enabled === 'boolean' ? stored.enabled : DEFAULT_SPEECH_SETTINGS.enabled,
    muted: typeof stored?.muted === 'boolean' ? stored.muted : DEFAULT_SPEECH_SETTINGS.muted,
    volume: parseSpeechVolume(stored?.volume) ?? DEFAULT_SPEECH_SETTINGS.volume,
    voice: parseSpeechVoice(stored?.voice) ?? DEFAULT_SPEECH_SETTINGS.voice,
  };
}

export async function upsertStoredSpeechSettings(input: Partial<SpeechSettings>): Promise<void> {
  if (input.enabled != null && typeof input.enabled !== 'boolean') {
    throw new Error('enabled must be a boolean');
  }
  if (input.muted != null && typeof input.muted !== 'boolean') {
    throw new Error('muted must be a boolean');
  }
  const volume = input.volume == null ? null : parseSpeechVolume(input.volume);
  if (input.volume != null && volume == null) throw new Error('volume must be between 0 and 1');
  const voice = input.voice == null ? null : parseSpeechVoice(input.voice);
  if (input.voice != null && !voice) throw new Error('voice is not supported');

  const current = await resolveEffectiveSpeechSettings();
  await putCanonicalSetting(SETTING_KEYS.speech, {
    enabled: input.enabled ?? current.enabled,
    muted: input.muted ?? current.muted,
    volume: volume ?? current.volume,
    voice: voice ?? current.voice,
  });
}

export async function resolveSpeechSettingsResponse(): Promise<{
  ok: true;
  speech: SpeechSettings & { voices: readonly GroqSpeechVoice[] };
}> {
  return {
    ok: true,
    speech: {
      ...(await resolveEffectiveSpeechSettings()),
      voices: GROQ_SPEECH_VOICES,
    },
  };
}

function parseVoiceInputPreset(raw: unknown): VoiceInputEndThoughtPreset | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'quick' || value === 'balanced' || value === 'patient' || value === 'custom'
    ? value
    : null;
}

function parseVoiceInputNoiseHandling(raw: unknown): VoiceInputNoiseHandling | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'auto' || value === 'quiet' || value === 'noisy' ? value : null;
}

function parseVoiceInputQuality(raw: unknown): VoiceInputTranscriptionQuality | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'fast' || value === 'accurate' ? value : null;
}

function parseVoiceInputLanguage(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  if (!value || value.toLowerCase() === 'auto') return null;
  if (value.length > 35 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) return null;
  return value;
}

function parseVoiceInputCustomSilenceMillis(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 1_000 && rounded <= 10_000 ? rounded : null;
}

export async function resolveEffectiveVoiceInputSettings(): Promise<VoiceInputSettings> {
  const record = await getCanonicalSetting<Partial<VoiceInputSettings>>(
    SETTING_KEYS.voiceInput,
    () => null,
  );
  const stored = record?.value;
  return {
    endThoughtPreset:
      parseVoiceInputPreset(stored?.endThoughtPreset) ?? DEFAULT_VOICE_INPUT_SETTINGS.endThoughtPreset,
    customSilenceMillis:
      parseVoiceInputCustomSilenceMillis(stored?.customSilenceMillis) ??
      DEFAULT_VOICE_INPUT_SETTINGS.customSilenceMillis,
    noiseHandling:
      parseVoiceInputNoiseHandling(stored?.noiseHandling) ?? DEFAULT_VOICE_INPUT_SETTINGS.noiseHandling,
    language: parseVoiceInputLanguage(stored?.language),
    quality: parseVoiceInputQuality(stored?.quality) ?? DEFAULT_VOICE_INPUT_SETTINGS.quality,
    confirmationFeedback:
      typeof stored?.confirmationFeedback === 'boolean'
        ? stored.confirmationFeedback
        : DEFAULT_VOICE_INPUT_SETTINGS.confirmationFeedback,
  };
}

export async function upsertStoredVoiceInputSettings(
  input: Partial<VoiceInputSettings>,
): Promise<void> {
  const preset = input.endThoughtPreset == null ? null : parseVoiceInputPreset(input.endThoughtPreset);
  if (input.endThoughtPreset != null && !preset) throw new Error('endThoughtPreset is not supported');
  const silence =
    input.customSilenceMillis == null
      ? null
      : parseVoiceInputCustomSilenceMillis(input.customSilenceMillis);
  if (input.customSilenceMillis != null && silence == null) {
    throw new Error('customSilenceMillis must be between 1000 and 10000');
  }
  const noise = input.noiseHandling == null ? null : parseVoiceInputNoiseHandling(input.noiseHandling);
  if (input.noiseHandling != null && !noise) throw new Error('noiseHandling is not supported');
  const quality = input.quality == null ? null : parseVoiceInputQuality(input.quality);
  if (input.quality != null && !quality) throw new Error('quality is not supported');
  const languageInput = String(input.language ?? '').trim();
  const language = input.language == null ? null : parseVoiceInputLanguage(input.language);
  if (
    input.language != null &&
    languageInput &&
    languageInput.toLowerCase() !== 'auto' &&
    !language
  ) {
    throw new Error('language must be Auto or a valid language tag');
  }
  if (input.confirmationFeedback != null && typeof input.confirmationFeedback !== 'boolean') {
    throw new Error('confirmationFeedback must be a boolean');
  }
  const current = await resolveEffectiveVoiceInputSettings();
  await putCanonicalSetting(SETTING_KEYS.voiceInput, {
    endThoughtPreset: preset ?? current.endThoughtPreset,
    customSilenceMillis: silence ?? current.customSilenceMillis,
    noiseHandling: noise ?? current.noiseHandling,
    language:
      input.language === undefined
        ? current.language
        : !languageInput || languageInput.toLowerCase() === 'auto'
          ? null
          : language,
    quality: quality ?? current.quality,
    confirmationFeedback: input.confirmationFeedback ?? current.confirmationFeedback,
  });
}

export async function resolveVoiceInputSettingsResponse(): Promise<{
  ok: true;
  voiceInput: VoiceInputSettings & { silenceMillis: number };
}> {
  const settings = await resolveEffectiveVoiceInputSettings();
  return {
    ok: true,
    voiceInput: {
      ...settings,
      silenceMillis: resolveVoiceInputSilenceMillis(settings),
    },
  };
}

export function parseIanaTimeZone(raw: unknown): string | null {
  const requested = String(raw ?? '').trim();
  if (!requested) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: requested }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export async function resolveUserContextSettings(): Promise<UserContextSettings> {
  const record = await getCanonicalSetting<Partial<UserContextSettings>>(
    SETTING_KEYS.userContext,
    () => null,
  );
  return { timeZone: parseIanaTimeZone(record?.value?.timeZone) };
}

export async function updateStoredUserTimeZone(raw: unknown): Promise<UserContextSettings> {
  const timeZone = parseIanaTimeZone(raw);
  if (!timeZone) throw new Error('timeZone must be a valid IANA time zone');
  const current = await resolveUserContextSettings();
  if (current.timeZone === timeZone) return current;
  await putCanonicalSetting(SETTING_KEYS.userContext, { timeZone });
  return { timeZone };
}

export async function resolveUserContextSettingsResponse(): Promise<{
  ok: true;
  userContext: UserContextSettings;
}> {
  return { ok: true, userContext: await resolveUserContextSettings() };
}

const UI_PREFERENCES_SETTING_KEY = 'ui-preferences';

type StoredUiPreferencesSettings = {
  uiPreferences: UiPreferencesSettings;
  updatedAt: string | null;
  version: number | null;
};

function storedUiPreferencesFromRecord(record: HubSettingRecord<unknown>): StoredUiPreferencesSettings {
  return {
    uiPreferences: sanitizeUiPreferencesSettings(record.value),
    updatedAt: record.updatedAt,
    version: record.version,
  };
}

async function getStoredUiPreferencesSettings(): Promise<StoredUiPreferencesSettings> {
  const repository = await getHubSettingsRepository();
  const canonical = repository.get<unknown>(UI_PREFERENCES_SETTING_KEY);
  if (canonical) return storedUiPreferencesFromRecord(canonical);

  const reg = await loadRegistry();
  const legacyRaw = reg.settings?.uiPreferences;
  if (legacyRaw !== undefined) {
    const updatedAtRaw = legacyRaw?.updatedAt;
    const updatedAt = typeof updatedAtRaw === 'string' && updatedAtRaw.trim() ? updatedAtRaw.trim() : null;
    const winner = await repository.backfillIfAbsent(
      UI_PREFERENCES_SETTING_KEY,
      sanitizeUiPreferencesSettings(legacyRaw),
      updatedAt,
    );
    return storedUiPreferencesFromRecord(winner);
  }

  // A concurrent writer may have inserted the row while the registry was read.
  const concurrent = repository.get<unknown>(UI_PREFERENCES_SETTING_KEY);
  if (concurrent) return storedUiPreferencesFromRecord(concurrent);
  return {
    uiPreferences: sanitizeUiPreferencesSettings(undefined),
    updatedAt: null,
    version: null,
  };
}

export class UiPreferencesSettingsConflictError extends Error {
  readonly uiPreferences: UiPreferencesSettings;
  readonly updatedAt: string | null;
  readonly version: number | null;

  constructor(current: HubSettingRecord<unknown> | null) {
    super('UI preferences changed on the server');
    this.name = 'UiPreferencesSettingsConflictError';
    this.uiPreferences = sanitizeUiPreferencesSettings(current?.value);
    this.updatedAt = current?.updatedAt ?? null;
    this.version = current?.version ?? null;
  }
}

export class UiPreferencesSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UiPreferencesSettingsValidationError';
  }
}

function parseExpectedUiPreferencesVersion(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null) return raw;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new UiPreferencesSettingsValidationError('expectedVersion must be a positive integer or null');
  }
  return value;
}

export async function upsertStoredUiPreferencesSettings(
  valueRaw: unknown,
  expectedVersionRaw?: unknown,
): Promise<void> {
  const uiPreferences = sanitizeUiPreferencesSettings(valueRaw);
  const expectedVersion = parseExpectedUiPreferencesVersion(expectedVersionRaw);
  const repository = await getHubSettingsRepository();
  try {
    await repository.put(UI_PREFERENCES_SETTING_KEY, uiPreferences, { expectedVersion });
  } catch (error) {
    if (error instanceof HubSettingVersionConflictError) {
      throw new UiPreferencesSettingsConflictError(error.current);
    }
    throw error;
  }
}

export async function resolveUiPreferencesSettingsResponse(): Promise<{
  ok: true;
  uiPreferences: UiPreferencesSettings;
  updatedAt: string | null;
  version: number | null;
}> {
  const stored = await getStoredUiPreferencesSettings();
  return {
    ok: true,
    uiPreferences: stored.uiPreferences,
    updatedAt: stored.updatedAt,
    version: stored.version,
  };
}
