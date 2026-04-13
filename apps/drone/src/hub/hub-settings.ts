import crypto from 'node:crypto';
import path from 'node:path';

import dotenv from 'dotenv';

import { loadRegistry, updateRegistry } from '../host/registry';
import {
  persistTaskBoardState,
  normalizeTaskTypeId,
  sanitizeTaskBoardState,
  type TaskBoardCard as KanbanBoardCard,
  type TaskBoardLane as KanbanBoardLane,
  type TaskBoardState as KanbanBoardSettings,
  type TaskBoardTaskType as KanbanBoardTaskType,
} from './task-board';

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
export type SecretValueDiagnostics = {
  present: boolean;
  hasValue: boolean;
  rawLength: number | null;
  trimmedLength: number | null;
  fingerprint: string | null;
};
export type ProviderApiKeyResolutionDiagnostics = {
  provider: LlmProviderId;
  envVar: 'OPENAI_API_KEY' | 'GEMINI_API_KEY';
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
export type AgentMessageAutoContinueSettingsSource = 'settings' | 'default';
export type EffectiveAgentMessageAutoContinueSettings = {
  prompt: string;
  promptSource: AgentMessageAutoContinueSettingsSource;
  enabledByDefault: boolean;
  enabledByDefaultSource: AgentMessageAutoContinueSettingsSource;
  updatedAt: string | null;
};
export type AgentSuggestionSettingsSource = 'settings' | 'default';
export type EffectiveAgentSuggestionSettings = {
  policyMarkdown: string;
  policyMarkdownSource: AgentSuggestionSettingsSource;
  enabledByDefault: boolean;
  enabledByDefaultSource: AgentSuggestionSettingsSource;
  updatedAt: string | null;
  policyFingerprint: string;
};
export type { KanbanBoardTaskType, KanbanBoardCard, KanbanBoardLane, KanbanBoardSettings };
export type TaskPlaybookButtonSettings = Array<{
  id: string;
  label: string;
  playbookId: string;
  taskTypeIds: string[];
}>;
export type UiAutomationSleepUnit = 'seconds' | 'minutes' | 'hours' | 'days';
export type UiAutomationConfig = {
  id: string;
  label: string;
  prompt: string;
  onFailurePrompt: string;
  runs: number;
  sleepAmount: number;
  sleepUnit: UiAutomationSleepUnit;
  stopPhrase: string;
  stopPhraseCaseSensitive: boolean;
};
export type UiPreferencesSettings = {
  sidebarGroupingMode: SidebarGroupingMode;
  sidebarDensityMode: 'compact' | 'default' | 'comfortable';
  sidebarGroupOrder: string[];
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  hiddenSidebarGroups: string[];
  autoDelete: boolean;
  automations: UiAutomationConfig[];
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
export const FILESYSTEM_UPLOAD_MAX_BYTES_MIN = 1 * 1024 * 1024;
export const FILESYSTEM_UPLOAD_MAX_BYTES_MAX = 8 * 1024 * 1024 * 1024;
export const FILESYSTEM_UPLOAD_MAX_BYTES_DEFAULT = 2 * 1024 * 1024 * 1024;
export const AGENT_MESSAGE_AUTO_CONTINUE_PROMPT_DEFAULT = 'continue';
export const AGENT_MESSAGE_AUTO_CONTINUE_PROMPT_MAX_CHARS = 200;
export const AGENT_SUGGESTION_ENABLED_BY_DEFAULT = false;
export const AGENT_SUGGESTION_POLICY_MAX_CHARS = 20_000;
export const AGENT_SUGGESTION_POLICY_DEFAULT = `# Assistant Suggestion Policy

Suggest the most likely next user reply in this developer chat after an assistant message.

## Core Style
- Prefer short, direct replies.
- Default to moving the work forward.
- Prefer concrete code-backed follow-ups over abstract discussion.
- Prefer simple solutions over extra abstraction.
- Match existing naming and UX patterns unless there is a clear reason not to.

## Likely Reply Types
- Approve the next step when the assistant's recommendation looks sound.
- Ask for explanation when naming, architecture, or behavior feels unclear.
- Push back when the solution seems overcomplicated or introduces hidden behavior.
- Ask for review when implementation likely needs a regression pass.
- Ask for commit only when the work sounds stable enough to checkpoint.

## Tone
- Be pragmatic and concise.
- It is fine to use terse messages like:
  - \`Ok, do it\`
  - \`Continue\`
  - \`review\`
  - \`commit\`
- When asking for explanation, keep it in simple technical terms.

## Preferences
- Surface regressions, UX inconsistency, naming drift, unnecessary complexity, and hidden behavior.
- Defer non-essential work rather than expanding scope.
- If the assistant is clearly still mid-task, the likely response is usually a short continuation.
- If the assistant introduced a questionable abstraction or naming choice, the likely response is usually a challenge or clarification question.
`;
const UI_AUTOMATION_RUNS_MIN = 1;
const UI_AUTOMATION_RUNS_MAX = 20;
const UI_AUTOMATION_RUNS_DEFAULT = 5;
const UI_AUTOMATION_SLEEP_AMOUNT_MIN = 0;
const UI_AUTOMATION_SLEEP_AMOUNT_MAX = 1_000_000;
const UI_AUTOMATION_SLEEP_AMOUNT_DEFAULT = 0;
const UI_AUTOMATION_STOP_PHRASE_MAX_CHARS = 320;
const UI_AUTOMATION_LABEL_MAX_CHARS = 72;
const UI_AUTOMATION_PROMPT_MAX_CHARS = 8_000;
const UI_AUTOMATION_ON_FAILURE_PROMPT_MAX_CHARS = 8_000;
const UI_AUTOMATION_MAX_ITEMS = 40;
const TASK_PLAYBOOK_BUTTON_LABEL_MAX_CHARS = 48;
const TASK_PLAYBOOK_BUTTON_MAX_ITEMS = 60;

export function parseLlmProvider(raw: unknown): LlmProviderId | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'openai' || s === 'gemini') return s;
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

export function normalizeAgentMessageAutoContinuePrompt(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return '';
  return text.length > AGENT_MESSAGE_AUTO_CONTINUE_PROMPT_MAX_CHARS
    ? text.slice(0, AGENT_MESSAGE_AUTO_CONTINUE_PROMPT_MAX_CHARS).trim()
    : text;
}

export function normalizeAgentSuggestionPolicyMarkdown(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return '';
  return text.length > AGENT_SUGGESTION_POLICY_MAX_CHARS
    ? text.slice(0, AGENT_SUGGESTION_POLICY_MAX_CHARS).trim()
    : text;
}

export function agentSuggestionPolicyFingerprint(policyMarkdownRaw: unknown): string {
  const policyMarkdown = normalizeAgentSuggestionPolicyMarkdown(policyMarkdownRaw) || AGENT_SUGGESTION_POLICY_DEFAULT;
  return crypto.createHash('sha256').update(policyMarkdown, 'utf8').digest('hex').slice(0, 12);
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

function createUiAutomationId(): string {
  return crypto.randomUUID();
}

function normalizeUiAutomationLabel(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, UI_AUTOMATION_LABEL_MAX_CHARS);
}

function normalizeUiAutomationPrompt(value: unknown): string {
  return String(value ?? '').slice(0, UI_AUTOMATION_PROMPT_MAX_CHARS);
}

function normalizeUiAutomationOnFailurePrompt(value: unknown): string {
  return String(value ?? '').slice(0, UI_AUTOMATION_ON_FAILURE_PROMPT_MAX_CHARS);
}

function normalizeUiAutomationRuns(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return UI_AUTOMATION_RUNS_DEFAULT;
  return Math.max(UI_AUTOMATION_RUNS_MIN, Math.min(UI_AUTOMATION_RUNS_MAX, Math.round(n)));
}

function normalizeUiAutomationSleepAmount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return UI_AUTOMATION_SLEEP_AMOUNT_DEFAULT;
  return Math.max(UI_AUTOMATION_SLEEP_AMOUNT_MIN, Math.min(UI_AUTOMATION_SLEEP_AMOUNT_MAX, Math.round(n)));
}

function normalizeUiAutomationSleepUnit(value: unknown): UiAutomationSleepUnit {
  const s = String(value ?? '').trim().toLowerCase();
  if (s === 'minutes' || s === 'hours' || s === 'days') return s;
  return 'seconds';
}

function normalizeUiAutomationStopPhrase(value: unknown): string {
  return String(value ?? '').trim().slice(0, UI_AUTOMATION_STOP_PHRASE_MAX_CHARS);
}

function normalizeUiAutomationStopPhraseCaseSensitive(value: unknown): boolean {
  return value === true;
}

function normalizeUiAutomationConfigs(value: unknown): UiAutomationConfig[] {
  const list = Array.isArray(value) ? value : [];
  const out: UiAutomationConfig[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const raw = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
    const id = String(raw.id ?? '').trim() || createUiAutomationId();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: normalizeUiAutomationLabel(raw.label),
      prompt: normalizeUiAutomationPrompt(raw.prompt),
      onFailurePrompt: normalizeUiAutomationOnFailurePrompt(raw.onFailurePrompt),
      runs: normalizeUiAutomationRuns(raw.runs),
      sleepAmount: normalizeUiAutomationSleepAmount(raw.sleepAmount),
      sleepUnit: normalizeUiAutomationSleepUnit(raw.sleepUnit),
      stopPhrase: normalizeUiAutomationStopPhrase(raw.stopPhrase),
      stopPhraseCaseSensitive: normalizeUiAutomationStopPhraseCaseSensitive(raw.stopPhraseCaseSensitive),
    });
    if (out.length >= UI_AUTOMATION_MAX_ITEMS) break;
  }
  return out;
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
    hiddenSidebarGroups: normalizeOrderedStringList(raw.hiddenSidebarGroups),
    autoDelete: raw.autoDelete === true,
    automations: normalizeUiAutomationConfigs(raw.automations),
  };
}

function normalizeTaskPlaybookButtonLabel(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, TASK_PLAYBOOK_BUTTON_LABEL_MAX_CHARS);
}

function sanitizeTaskPlaybookButtonSettings(value: unknown): TaskPlaybookButtonSettings {
  const list = Array.isArray(value) ? value : [];
  const out: TaskPlaybookButtonSettings = [];
  const seen = new Set<string>();
  for (const item of list) {
    const raw = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
    const id = String(raw.id ?? '').trim() || crypto.randomUUID();
    if (!id || seen.has(id)) continue;
    const label = normalizeTaskPlaybookButtonLabel(raw.label);
    const playbookId = String(raw.playbookId ?? '').trim();
    const taskTypeIds = Array.isArray(raw.taskTypeIds)
      ? Array.from(new Set(raw.taskTypeIds.map((entry) => normalizeTaskTypeId(entry)).filter(Boolean)))
      : [];
    if (!label || !playbookId || taskTypeIds.length === 0) continue;
    seen.add(id);
    out.push({
      id,
      label,
      playbookId,
      taskTypeIds,
    });
    if (out.length >= TASK_PLAYBOOK_BUTTON_MAX_ITEMS) break;
  }
  return out;
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

export async function collectProviderApiKeyDiagnostics(provider: LlmProviderId): Promise<ProviderApiKeyResolutionDiagnostics> {
  const envVar = providerApiKeyEnvVar(provider);
  const stored = await getStoredProviderApiKey(provider);
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

async function getStoredDeleteActionSettings(): Promise<{
  mode: DroneDeleteMode | null;
  archiveRetention: ArchiveRetentionId | null;
  archiveRuntimePolicy: ArchiveRuntimePolicy | null;
}> {
  const reg = await loadRegistry();
  const mode = parseDroneDeleteMode(reg.settings?.deleteAction?.mode);
  const archiveRetention = parseArchiveRetentionId(reg.settings?.deleteAction?.archiveRetention);
  const archiveRuntimePolicy = parseArchiveRuntimePolicy(reg.settings?.deleteAction?.archiveRuntimePolicy);
  return { mode, archiveRetention, archiveRuntimePolicy };
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

  const updatedAt = new Date().toISOString();
  await updateRegistry((reg) => {
    reg.settings ??= {};
    const prev = reg.settings.deleteAction ?? {};
    reg.settings.deleteAction = {
      mode: mode ?? parseDroneDeleteMode(prev.mode) ?? DEFAULT_DRONE_DELETE_MODE,
      archiveRetention: archiveRetention ?? parseArchiveRetentionId(prev.archiveRetention) ?? DEFAULT_ARCHIVE_RETENTION,
      archiveRuntimePolicy:
        archiveRuntimePolicy ?? parseArchiveRuntimePolicy(prev.archiveRuntimePolicy) ?? DEFAULT_ARCHIVE_RUNTIME_POLICY,
      updatedAt,
    };
  });
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
  const reg = await loadRegistry();
  const uploadMaxBytes = parseFilesystemUploadMaxBytes(reg.settings?.filesystem?.uploadMaxBytes);
  return { uploadMaxBytes };
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
  const updatedAt = new Date().toISOString();
  await updateRegistry((reg) => {
    reg.settings ??= {};
    const prev = reg.settings.filesystem ?? {};
    const nextUploadMaxBytes =
      uploadMaxBytes ??
      parseFilesystemUploadMaxBytes(prev.uploadMaxBytes) ??
      FILESYSTEM_UPLOAD_MAX_BYTES_DEFAULT;
    if (nextUploadMaxBytes === FILESYSTEM_UPLOAD_MAX_BYTES_DEFAULT) {
      delete reg.settings.filesystem;
      if (Object.keys(reg.settings).length === 0) delete reg.settings;
      return;
    }
    reg.settings.filesystem = {
      uploadMaxBytes: nextUploadMaxBytes,
      updatedAt,
    };
  });
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

async function getStoredAgentMessageAutoContinueSettings(): Promise<{
  prompt: string | null;
  enabledByDefault: boolean | null;
  updatedAt: string | null;
}> {
  const reg = await loadRegistry();
  const raw = reg.settings?.agentMessageAutoContinue;
  const prompt = normalizeAgentMessageAutoContinuePrompt(raw?.prompt);
  const updatedAtRaw = raw?.updatedAt;
  const enabledByDefault = raw?.enabledByDefault === true ? true : raw?.enabledByDefault === false ? false : null;
  return {
    prompt: prompt || null,
    enabledByDefault,
    updatedAt: typeof updatedAtRaw === 'string' && updatedAtRaw.trim() ? updatedAtRaw.trim() : null,
  };
}

export async function upsertStoredAgentMessageAutoContinueSettings(opts: {
  prompt?: string | null;
  enabledByDefault?: boolean | null;
}): Promise<void> {
  const nextPrompt =
    opts.prompt === undefined ? undefined : normalizeAgentMessageAutoContinuePrompt(opts.prompt);
  const enabledByDefault = opts.enabledByDefault === true;
  const updatedAt = new Date().toISOString();
  await updateRegistry((reg) => {
    reg.settings ??= {};
    const current = reg.settings?.agentMessageAutoContinue;
    const prompt = nextPrompt === undefined ? normalizeAgentMessageAutoContinuePrompt(current?.prompt) : nextPrompt;
    const effectiveEnabledByDefault =
      opts.enabledByDefault === undefined ? current?.enabledByDefault === true : enabledByDefault;
    if ((!prompt || prompt === AGENT_MESSAGE_AUTO_CONTINUE_PROMPT_DEFAULT) && !effectiveEnabledByDefault) {
      delete reg.settings.agentMessageAutoContinue;
      if (Object.keys(reg.settings).length === 0) delete reg.settings;
      return;
    }
    reg.settings.agentMessageAutoContinue = {
      ...(prompt && prompt !== AGENT_MESSAGE_AUTO_CONTINUE_PROMPT_DEFAULT ? { prompt } : {}),
      ...(effectiveEnabledByDefault ? { enabledByDefault: true } : {}),
      updatedAt,
    };
  });
}

export async function resolveEffectiveAgentMessageAutoContinueSettings(): Promise<EffectiveAgentMessageAutoContinueSettings> {
  const stored = await getStoredAgentMessageAutoContinueSettings();
  return {
    prompt: stored.prompt ?? AGENT_MESSAGE_AUTO_CONTINUE_PROMPT_DEFAULT,
    promptSource: stored.prompt ? 'settings' : 'default',
    enabledByDefault: stored.enabledByDefault === true,
    enabledByDefaultSource: stored.enabledByDefault === null ? 'default' : 'settings',
    updatedAt: stored.prompt || stored.enabledByDefault !== null ? stored.updatedAt : null,
  };
}

export async function resolveAgentMessageAutoContinueSettingsResponse(): Promise<{
  ok: true;
  agentMessageAutoContinue: {
    prompt: string;
    promptSource: AgentMessageAutoContinueSettingsSource;
    enabledByDefault: boolean;
    enabledByDefaultSource: AgentMessageAutoContinueSettingsSource;
    updatedAt: string | null;
    defaultPrompt: string;
    defaultEnabledByDefault: boolean;
    maxPromptChars: number;
  };
}> {
  const settings = await resolveEffectiveAgentMessageAutoContinueSettings();
  return {
    ok: true,
    agentMessageAutoContinue: {
      prompt: settings.prompt,
      promptSource: settings.promptSource,
      enabledByDefault: settings.enabledByDefault,
      enabledByDefaultSource: settings.enabledByDefaultSource,
      updatedAt: settings.updatedAt,
      defaultPrompt: AGENT_MESSAGE_AUTO_CONTINUE_PROMPT_DEFAULT,
      defaultEnabledByDefault: false,
      maxPromptChars: AGENT_MESSAGE_AUTO_CONTINUE_PROMPT_MAX_CHARS,
    },
  };
}

async function getStoredAgentSuggestionSettings(): Promise<{
  policyMarkdown: string | null;
  enabledByDefault: boolean | null;
  updatedAt: string | null;
}> {
  const reg = await loadRegistry();
  const raw = reg.settings?.agentSuggestion;
  const policyMarkdown = normalizeAgentSuggestionPolicyMarkdown(raw?.policyMarkdown);
  const updatedAtRaw = raw?.updatedAt;
  const enabledByDefault = raw?.enabledByDefault === true ? true : raw?.enabledByDefault === false ? false : null;
  return {
    policyMarkdown: policyMarkdown || null,
    enabledByDefault,
    updatedAt: typeof updatedAtRaw === 'string' && updatedAtRaw.trim() ? updatedAtRaw.trim() : null,
  };
}

export async function upsertStoredAgentSuggestionSettings(opts: {
  policyMarkdown?: string | null;
  enabledByDefault?: boolean | null;
}): Promise<void> {
  const nextPolicyMarkdown =
    opts.policyMarkdown === undefined ? undefined : normalizeAgentSuggestionPolicyMarkdown(opts.policyMarkdown);
  const enabledByDefault = opts.enabledByDefault === true;
  const updatedAt = new Date().toISOString();
  await updateRegistry((reg) => {
    reg.settings ??= {};
    const current = reg.settings?.agentSuggestion;
    const policyMarkdown =
      nextPolicyMarkdown === undefined ? normalizeAgentSuggestionPolicyMarkdown(current?.policyMarkdown) : nextPolicyMarkdown;
    const effectiveEnabledByDefault =
      opts.enabledByDefault === undefined ? current?.enabledByDefault === true : enabledByDefault;
    if ((!policyMarkdown || policyMarkdown === AGENT_SUGGESTION_POLICY_DEFAULT) && !effectiveEnabledByDefault) {
      delete reg.settings.agentSuggestion;
      if (Object.keys(reg.settings).length === 0) delete reg.settings;
      return;
    }
    reg.settings.agentSuggestion = {
      ...(policyMarkdown && policyMarkdown !== AGENT_SUGGESTION_POLICY_DEFAULT ? { policyMarkdown } : {}),
      ...(effectiveEnabledByDefault ? { enabledByDefault: true } : {}),
      updatedAt,
    };
  });
}

export async function resolveEffectiveAgentSuggestionSettings(): Promise<EffectiveAgentSuggestionSettings> {
  const stored = await getStoredAgentSuggestionSettings();
  const policyMarkdown = stored.policyMarkdown ?? AGENT_SUGGESTION_POLICY_DEFAULT;
  return {
    policyMarkdown,
    policyMarkdownSource: stored.policyMarkdown ? 'settings' : 'default',
    enabledByDefault: stored.enabledByDefault === true,
    enabledByDefaultSource: stored.enabledByDefault === null ? 'default' : 'settings',
    updatedAt: stored.policyMarkdown || stored.enabledByDefault !== null ? stored.updatedAt : null,
    policyFingerprint: agentSuggestionPolicyFingerprint(policyMarkdown),
  };
}

export async function resolveAgentSuggestionSettingsResponse(): Promise<{
  ok: true;
  agentSuggestion: {
    policyMarkdown: string;
    policyMarkdownSource: AgentSuggestionSettingsSource;
    enabledByDefault: boolean;
    enabledByDefaultSource: AgentSuggestionSettingsSource;
    updatedAt: string | null;
    defaultPolicyMarkdown: string;
    defaultEnabledByDefault: boolean;
    maxPolicyChars: number;
    policyFingerprint: string;
  };
}> {
  const settings = await resolveEffectiveAgentSuggestionSettings();
  return {
    ok: true,
    agentSuggestion: {
      policyMarkdown: settings.policyMarkdown,
      policyMarkdownSource: settings.policyMarkdownSource,
      enabledByDefault: settings.enabledByDefault,
      enabledByDefaultSource: settings.enabledByDefaultSource,
      updatedAt: settings.updatedAt,
      defaultPolicyMarkdown: AGENT_SUGGESTION_POLICY_DEFAULT,
      defaultEnabledByDefault: AGENT_SUGGESTION_ENABLED_BY_DEFAULT,
      maxPolicyChars: AGENT_SUGGESTION_POLICY_MAX_CHARS,
      policyFingerprint: settings.policyFingerprint,
    },
  };
}

async function getStoredKanbanBoardSettings(): Promise<{ board: KanbanBoardSettings; updatedAt: string | null }> {
  const reg = await loadRegistry();
  const raw = reg.settings?.kanbanBoard;
  const updatedAtRaw = raw?.updatedAt;
  return {
    board: sanitizeTaskBoardState(raw),
    updatedAt: typeof updatedAtRaw === 'string' && updatedAtRaw.trim() ? updatedAtRaw : null,
  };
}

export class KanbanBoardSettingsConflictError extends Error {
  readonly board: KanbanBoardSettings;
  readonly updatedAt: string | null;

  constructor(board: KanbanBoardSettings, updatedAt: string | null) {
    super('kanban board changed on the server');
    this.name = 'KanbanBoardSettingsConflictError';
    this.board = board;
    this.updatedAt = updatedAt;
  }
}

export async function upsertStoredKanbanBoardSettings(boardRaw: unknown, expectedUpdatedAtRaw?: unknown): Promise<void> {
  const board = sanitizeTaskBoardState(boardRaw);
  const updatedAt = new Date().toISOString();
  const expectedUpdatedAt =
    typeof expectedUpdatedAtRaw === 'string' && expectedUpdatedAtRaw.trim() ? expectedUpdatedAtRaw.trim() : null;
  await updateRegistry((reg) => {
    const currentRaw = reg.settings?.kanbanBoard;
    const currentUpdatedAt =
      typeof currentRaw?.updatedAt === 'string' && currentRaw.updatedAt.trim() ? currentRaw.updatedAt.trim() : null;
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== currentUpdatedAt) {
      throw new KanbanBoardSettingsConflictError(sanitizeTaskBoardState(currentRaw), currentUpdatedAt);
    }
    persistTaskBoardState(reg, board, updatedAt);
  });
}

export async function resolveKanbanBoardSettingsResponse(): Promise<{
  ok: true;
  kanbanBoard: KanbanBoardSettings;
  updatedAt: string | null;
}> {
  const stored = await getStoredKanbanBoardSettings();
  return {
    ok: true,
    kanbanBoard: stored.board,
    updatedAt: stored.updatedAt,
  };
}

async function getStoredTaskPlaybookButtonSettings(): Promise<{ taskPlaybookButtons: TaskPlaybookButtonSettings; updatedAt: string | null }> {
  const reg = await loadRegistry();
  const raw = reg.settings?.taskPlaybookButtons;
  const updatedAtRaw = raw?.updatedAt;
  return {
    taskPlaybookButtons: sanitizeTaskPlaybookButtonSettings(raw?.items),
    updatedAt: typeof updatedAtRaw === 'string' && updatedAtRaw.trim() ? updatedAtRaw : null,
  };
}

export async function upsertStoredTaskPlaybookButtonSettings(valueRaw: unknown): Promise<void> {
  const taskPlaybookButtons = sanitizeTaskPlaybookButtonSettings(valueRaw);
  const updatedAt = new Date().toISOString();
  await updateRegistry((reg) => {
    reg.settings ??= {};
    reg.settings.taskPlaybookButtons = {
      items: taskPlaybookButtons.map((item) => ({
        id: item.id,
        label: item.label,
        playbookId: item.playbookId,
        taskTypeIds: item.taskTypeIds.slice(),
      })),
      updatedAt,
    };
  });
}

export async function resolveTaskPlaybookButtonSettingsResponse(): Promise<{
  ok: true;
  taskPlaybookButtons: TaskPlaybookButtonSettings;
  updatedAt: string | null;
}> {
  const stored = await getStoredTaskPlaybookButtonSettings();
  return {
    ok: true,
    taskPlaybookButtons: stored.taskPlaybookButtons,
    updatedAt: stored.updatedAt,
  };
}

async function getStoredUiPreferencesSettings(): Promise<{ uiPreferences: UiPreferencesSettings; updatedAt: string | null }> {
  const reg = await loadRegistry();
  const raw = reg.settings?.uiPreferences;
  const updatedAtRaw = raw?.updatedAt;
  return {
    uiPreferences: sanitizeUiPreferencesSettings(raw),
    updatedAt: typeof updatedAtRaw === 'string' && updatedAtRaw.trim() ? updatedAtRaw : null,
  };
}

export async function upsertStoredUiPreferencesSettings(valueRaw: unknown): Promise<void> {
  const uiPreferences = sanitizeUiPreferencesSettings(valueRaw);
  const updatedAt = new Date().toISOString();
  await updateRegistry((reg) => {
    reg.settings ??= {};
    reg.settings.uiPreferences = {
      sidebarGroupingMode: uiPreferences.sidebarGroupingMode,
      sidebarDensityMode: uiPreferences.sidebarDensityMode,
      sidebarGroupOrder: uiPreferences.sidebarGroupOrder.slice(),
      sidebarDroneOrderByGroup: Object.fromEntries(
        Object.entries(uiPreferences.sidebarDroneOrderByGroup).map(([key, value]) => [key, value.slice()]),
      ),
      sidebarNodeOrderByParent: Object.fromEntries(
        Object.entries(uiPreferences.sidebarNodeOrderByParent).map(([key, value]) => [key, value.slice()]),
      ),
      sidebarChatOrderByDrone: Object.fromEntries(
        Object.entries(uiPreferences.sidebarChatOrderByDrone).map(([key, value]) => [key, value.slice()]),
      ),
      hiddenSidebarGroups: uiPreferences.hiddenSidebarGroups.slice(),
      autoDelete: uiPreferences.autoDelete,
      automations: uiPreferences.automations.map((automation) => ({
        id: automation.id,
        label: automation.label,
        prompt: automation.prompt,
        onFailurePrompt: automation.onFailurePrompt,
        runs: automation.runs,
        sleepAmount: automation.sleepAmount,
        sleepUnit: automation.sleepUnit,
        stopPhrase: automation.stopPhrase,
        stopPhraseCaseSensitive: automation.stopPhraseCaseSensitive,
      })),
      updatedAt,
    };
  });
}

export async function resolveUiPreferencesSettingsResponse(): Promise<{
  ok: true;
  uiPreferences: UiPreferencesSettings;
  updatedAt: string | null;
}> {
  const stored = await getStoredUiPreferencesSettings();
  return {
    ok: true,
    uiPreferences: stored.uiPreferences,
    updatedAt: stored.updatedAt,
  };
}
