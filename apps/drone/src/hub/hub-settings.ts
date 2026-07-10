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
import { readActiveProfileName } from '../host/profiles';
import {
  normalizeTaskTypeId,
  persistTaskBoardState,
  sanitizeTaskBoardState,
  type TaskBoardCard as KanbanBoardCard,
  type TaskBoardLane as KanbanBoardLane,
  type TaskBoardState as KanbanBoardSettings,
  type TaskBoardTaskType as KanbanBoardTaskType,
} from './task-board';

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
export type EffectiveVoiceStreamPairingPasswordSettings = {
  password: string | null;
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
export type VoiceApprovalSettingsSource = 'settings' | 'default';
export type VoiceTranscriptionFinalMode = 'full-recording' | 'segments';
export type VoiceTranscriptionSettingsSource = 'settings' | 'default';
export type VoiceActivationSettingsSource = 'settings' | 'default';
export type VoiceRealtimeSettingsSource = 'settings' | 'default';
export type VoiceApprovalSettings = {
  triggerPhrase: string;
  unlockCode: string;
  lockCode: string;
  lockedOffCode: string;
  minDigits: number;
  maxDigits: number;
  stableMs: number;
  collectTimeoutMs: number;
  duplicateCooldownMs: number;
  finalizeCheckIntervalMs: number;
  postPromptCommandSuppressionMs: number;
};
export type EffectiveVoiceApprovalSettings = VoiceApprovalSettings & {
  source: VoiceApprovalSettingsSource;
  updatedAt: string | null;
};
export type VoiceTranscriptionSettings = {
  finalMode: VoiceTranscriptionFinalMode;
};
export type EffectiveVoiceTranscriptionSettings = VoiceTranscriptionSettings & {
  source: VoiceTranscriptionSettingsSource;
  updatedAt: string | null;
};
export type VoiceActivationSettings = {
  normalAliases: string[];
  realTimeAliases: string[];
};
export type EffectiveVoiceActivationSettings = VoiceActivationSettings & {
  source: VoiceActivationSettingsSource;
  updatedAt: string | null;
};
export type VoiceRealtimeSettings = {
  enabled: boolean;
};
export type EffectiveVoiceRealtimeSettings = VoiceRealtimeSettings & {
  source: VoiceRealtimeSettingsSource;
  updatedAt: string | null;
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
  spawnAgentKey: string;
  spawnModel: string;
  repoBranchSource: 'host' | 'remote';
  repoCreateRemoteBranch: string;
  pullHostBranchBeforeCreate: boolean;
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
const DEFAULT_PULL_HOST_BRANCH_BEFORE_CREATE = true;
export const FILESYSTEM_UPLOAD_MAX_BYTES_MIN = 1 * 1024 * 1024;
export const FILESYSTEM_UPLOAD_MAX_BYTES_MAX = 8 * 1024 * 1024 * 1024;
export const FILESYSTEM_UPLOAD_MAX_BYTES_DEFAULT = 2 * 1024 * 1024 * 1024;
export const AGENT_MESSAGE_AUTO_CONTINUE_PROMPT_DEFAULT = 'continue';
export const AGENT_MESSAGE_AUTO_CONTINUE_PROMPT_MAX_CHARS = 200;
export const AGENT_SUGGESTION_ENABLED_BY_DEFAULT = false;
export const AGENT_SUGGESTION_POLICY_MAX_CHARS = 20_000;
export const VOICE_APPROVAL_SETTINGS_DEFAULT: VoiceApprovalSettings = {
  triggerPhrase: 'approval code',
  unlockCode: '1234',
  lockCode: '4321',
  lockedOffCode: '0000',
  minDigits: 4,
  maxDigits: 8,
  stableMs: 900,
  collectTimeoutMs: 5_000,
  duplicateCooldownMs: 4_000,
  finalizeCheckIntervalMs: 250,
  postPromptCommandSuppressionMs: 1_800,
};
export const VOICE_TRANSCRIPTION_SETTINGS_DEFAULT: VoiceTranscriptionSettings = {
  finalMode: 'full-recording',
};
export const VOICE_ACTIVATION_SETTINGS_DEFAULT: VoiceActivationSettings = {
  normalAliases: ['hey Sebastian', 'hay Sebastian'],
  realTimeAliases: ['Sebastian enter real-time mode', 'Sebastian enter realtime mode'],
};
export const VOICE_REALTIME_SETTINGS_DEFAULT: VoiceRealtimeSettings = {
  enabled: false,
};
export const VOICE_APPROVAL_SETTINGS_LIMITS = {
  triggerPhraseMaxChars: 64,
  codeMaxDigits: 8,
  minDigitsMin: 1,
  minDigitsMax: 8,
  maxDigitsMin: 1,
  maxDigitsMax: 12,
  stableMsMin: 250,
  stableMsMax: 3_000,
  collectTimeoutMsMin: 1_000,
  collectTimeoutMsMax: 15_000,
  duplicateCooldownMsMin: 0,
  duplicateCooldownMsMax: 15_000,
  finalizeCheckIntervalMsMin: 100,
  finalizeCheckIntervalMsMax: 1_000,
  postPromptCommandSuppressionMsMin: 0,
  postPromptCommandSuppressionMsMax: 5_000,
  activationAliasMaxChars: 80,
  activationAliasMaxCount: 12,
} as const;
export const AGENT_SUGGESTION_POLICY_DEFAULT = `# Assistant Suggestion Policy

Suggest the most likely next user reply in this developer chat after an assistant message.

## Core Style
- Prefer short, direct replies.
- Default to moving the work forward.
- It is valid to return no suggestion when silence is more useful than a reply.
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
- If the agent turn is complete and the only plausible reply is a low-value acknowledgement like \`ok\`, \`sounds good\`, or \`thanks\`, return no suggestion.
- If the agent already reported that an action is completed, do not suggest repeating that same action.
- Example: if the agent says it already committed or merged the work, return no suggestion instead of \`commit\`.
- If you are uncertain and would rather have the user decide what to say next, return no suggestion instead of guessing.
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

function normalizeVoiceApprovalTriggerPhrase(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!text) return '';
  return text.length > VOICE_APPROVAL_SETTINGS_LIMITS.triggerPhraseMaxChars
    ? text.slice(0, VOICE_APPROVAL_SETTINGS_LIMITS.triggerPhraseMaxChars).trim()
    : text;
}

function normalizeVoiceApprovalCode(raw: unknown): string {
  const text = typeof raw === 'string' || typeof raw === 'number' ? String(raw).replace(/\D/g, '') : '';
  if (!text) return '';
  return text.slice(0, VOICE_APPROVAL_SETTINGS_LIMITS.codeMaxDigits);
}

function parseIntegerInRange(raw: unknown, min: number, max: number): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < min || i > max) return null;
  return i;
}

function parseVoiceApprovalSettings(raw: unknown): VoiceApprovalSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const triggerPhrase = normalizeVoiceApprovalTriggerPhrase(value.triggerPhrase);
  const unlockCode = normalizeVoiceApprovalCode(value.unlockCode);
  const lockCode = normalizeVoiceApprovalCode(value.lockCode);
  const lockedOffCode = normalizeVoiceApprovalCode(value.lockedOffCode);
  const minDigits = parseIntegerInRange(value.minDigits, VOICE_APPROVAL_SETTINGS_LIMITS.minDigitsMin, VOICE_APPROVAL_SETTINGS_LIMITS.minDigitsMax);
  const maxDigits = parseIntegerInRange(value.maxDigits, VOICE_APPROVAL_SETTINGS_LIMITS.maxDigitsMin, VOICE_APPROVAL_SETTINGS_LIMITS.maxDigitsMax);
  const stableMs = parseIntegerInRange(value.stableMs, VOICE_APPROVAL_SETTINGS_LIMITS.stableMsMin, VOICE_APPROVAL_SETTINGS_LIMITS.stableMsMax);
  const collectTimeoutMs = parseIntegerInRange(
    value.collectTimeoutMs,
    VOICE_APPROVAL_SETTINGS_LIMITS.collectTimeoutMsMin,
    VOICE_APPROVAL_SETTINGS_LIMITS.collectTimeoutMsMax,
  );
  const duplicateCooldownMs = parseIntegerInRange(
    value.duplicateCooldownMs,
    VOICE_APPROVAL_SETTINGS_LIMITS.duplicateCooldownMsMin,
    VOICE_APPROVAL_SETTINGS_LIMITS.duplicateCooldownMsMax,
  );
  const finalizeCheckIntervalMs = parseIntegerInRange(
    value.finalizeCheckIntervalMs,
    VOICE_APPROVAL_SETTINGS_LIMITS.finalizeCheckIntervalMsMin,
    VOICE_APPROVAL_SETTINGS_LIMITS.finalizeCheckIntervalMsMax,
  );
  const postPromptCommandSuppressionMs = parseIntegerInRange(
    value.postPromptCommandSuppressionMs ?? VOICE_APPROVAL_SETTINGS_DEFAULT.postPromptCommandSuppressionMs,
    VOICE_APPROVAL_SETTINGS_LIMITS.postPromptCommandSuppressionMsMin,
    VOICE_APPROVAL_SETTINGS_LIMITS.postPromptCommandSuppressionMsMax,
  );
  if (
    !triggerPhrase ||
    !unlockCode ||
    !lockCode ||
    !lockedOffCode ||
    minDigits == null ||
    maxDigits == null ||
    stableMs == null ||
    collectTimeoutMs == null ||
    duplicateCooldownMs == null ||
    finalizeCheckIntervalMs == null ||
    postPromptCommandSuppressionMs == null
  ) return null;
  if (maxDigits < minDigits) return null;
  const codeSet = new Set([unlockCode, lockCode, lockedOffCode]);
  if (codeSet.size !== 3) return null;
  const codeLengths = [unlockCode, lockCode, lockedOffCode].map((code) => code.length);
  const effectiveMinDigits = Math.min(minDigits, ...codeLengths);
  const effectiveMaxDigits = Math.max(maxDigits, ...codeLengths);
  if (effectiveMaxDigits > VOICE_APPROVAL_SETTINGS_LIMITS.maxDigitsMax) return null;
  return {
    triggerPhrase,
    unlockCode,
    lockCode,
    lockedOffCode,
    minDigits: effectiveMinDigits,
    maxDigits: effectiveMaxDigits,
    stableMs,
    collectTimeoutMs,
    duplicateCooldownMs,
    finalizeCheckIntervalMs,
    postPromptCommandSuppressionMs,
  };
}

function parseVoiceTranscriptionFinalMode(raw: unknown): VoiceTranscriptionFinalMode | null {
  const text = String(raw ?? '').trim().toLowerCase();
  if (text === 'full-recording' || text === 'full_clip' || text === 'full-clip' || text === 'full') return 'full-recording';
  if (text === 'segments' || text === 'chunks' || text === 'chunked') return 'segments';
  return null;
}

function parseVoiceTranscriptionSettings(raw: unknown): VoiceTranscriptionSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const finalMode = parseVoiceTranscriptionFinalMode(value.finalMode);
  if (!finalMode) return null;
  return { finalMode };
}

function normalizeVoiceActivationAlias(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!text) return '';
  return text.length > VOICE_APPROVAL_SETTINGS_LIMITS.activationAliasMaxChars
    ? text.slice(0, VOICE_APPROVAL_SETTINGS_LIMITS.activationAliasMaxChars).trim()
    : text;
}

function normalizeVoiceActivationAliases(raw: unknown, fallback: string[], opts?: { fallbackEmpty?: boolean }): string[] {
  const values = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of values) {
    const alias = normalizeVoiceActivationAlias(item);
    const key = alias.toLowerCase();
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
    if (out.length >= VOICE_APPROVAL_SETTINGS_LIMITS.activationAliasMaxCount) break;
  }
  return out.length > 0 ? out : opts?.fallbackEmpty === false ? [] : fallback;
}

function parseVoiceActivationSettings(raw: unknown, opts?: { fallbackEmpty?: boolean }): VoiceActivationSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const normalAliases = normalizeVoiceActivationAliases(value.normalAliases, VOICE_ACTIVATION_SETTINGS_DEFAULT.normalAliases, opts);
  const realTimeAliases = normalizeVoiceActivationAliases(value.realTimeAliases, VOICE_ACTIVATION_SETTINGS_DEFAULT.realTimeAliases, opts);
  if (normalAliases.length === 0 || realTimeAliases.length === 0) return null;
  return { normalAliases, realTimeAliases };
}

function parseVoiceRealtimeSettings(raw: unknown): VoiceRealtimeSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.enabled !== 'boolean') return null;
  return { enabled: value.enabled };
}

function voiceApprovalSettingsEqual(a: VoiceApprovalSettings, b: VoiceApprovalSettings): boolean {
  return (
    a.triggerPhrase === b.triggerPhrase &&
    a.unlockCode === b.unlockCode &&
    a.lockCode === b.lockCode &&
    a.lockedOffCode === b.lockedOffCode &&
    a.minDigits === b.minDigits &&
    a.maxDigits === b.maxDigits &&
    a.stableMs === b.stableMs &&
    a.collectTimeoutMs === b.collectTimeoutMs &&
    a.duplicateCooldownMs === b.duplicateCooldownMs &&
    a.finalizeCheckIntervalMs === b.finalizeCheckIntervalMs &&
    a.postPromptCommandSuppressionMs === b.postPromptCommandSuppressionMs
  );
}

function voiceTranscriptionSettingsEqual(a: VoiceTranscriptionSettings, b: VoiceTranscriptionSettings): boolean {
  return a.finalMode === b.finalMode;
}

function stringArraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function voiceActivationSettingsEqual(a: VoiceActivationSettings, b: VoiceActivationSettings): boolean {
  return stringArraysEqual(a.normalAliases, b.normalAliases) && stringArraysEqual(a.realTimeAliases, b.realTimeAliases);
}

function voiceRealtimeSettingsEqual(a: VoiceRealtimeSettings, b: VoiceRealtimeSettings): boolean {
  return a.enabled === b.enabled;
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
    hiddenSidebarGroups: normalizeOrderedStringList(raw.hiddenSidebarGroups),
    autoDelete: raw.autoDelete === true,
    automations: normalizeUiAutomationConfigs(raw.automations),
    spawnAgentKey: normalizeUiPreferenceText(raw.spawnAgentKey, 200) || DEFAULT_SPAWN_AGENT_KEY,
    spawnModel: normalizeUiPreferenceText(raw.spawnModel, 200),
    repoBranchSource: parseRepoBranchSource(raw.repoBranchSource) ?? DEFAULT_REPO_BRANCH_SOURCE,
    repoCreateRemoteBranch: normalizeUiPreferenceText(raw.repoCreateRemoteBranch, 400),
    pullHostBranchBeforeCreate:
      typeof raw.pullHostBranchBeforeCreate === 'boolean'
        ? raw.pullHostBranchBeforeCreate
        : DEFAULT_PULL_HOST_BRANCH_BEFORE_CREATE,
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

const SETTING_KEYS = {
  providerApiKey: (provider: StoredApiKeyProviderId) => `api-key.${provider}`,
  voiceStreamPairingPassword: 'voice-stream.pairing-password',
  llmProvider: 'llm.provider',
  deleteAction: 'delete-action',
  filesystem: 'filesystem',
  voiceApproval: 'voice-approval',
  voiceTranscription: 'voice-transcription',
  voiceActivation: 'voice-activation',
  voiceRealtime: 'voice-realtime',
  agentMessageAutoContinue: 'agent-message-auto-continue',
  agentSuggestion: 'agent-suggestion',
  kanbanBoard: 'kanban-board',
  taskPlaybookButtons: 'task-playbook-buttons',
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

async function getStoredVoiceStreamPairingPassword(): Promise<{ password: string; updatedAt: string | null } | null> {
  const record = await getCanonicalSetting<{ password: string }>(SETTING_KEYS.voiceStreamPairingPassword, (reg) => {
    const raw = reg.settings?.voiceStream;
    const password = normalizeApiKey(raw?.pairingPassword);
    return password ? { value: { password }, updatedAt: legacyUpdatedAt(raw) } : null;
  });
  const password = normalizeApiKey(record?.value?.password);
  if (!password) return null;
  return { password, updatedAt: record?.updatedAt ?? null };
}

export async function upsertVoiceStreamPairingPassword(passwordRaw: string): Promise<void> {
  const pairingPassword = normalizeApiKey(passwordRaw);
  if (!pairingPassword) throw new Error('Pairing password is required.');
  await putCanonicalSetting(SETTING_KEYS.voiceStreamPairingPassword, { password: pairingPassword });
}

export async function clearVoiceStreamPairingPassword(): Promise<void> {
  await putCanonicalSetting(SETTING_KEYS.voiceStreamPairingPassword, null);
}

function codexAuthFilePath(): string {
  const configured = normalizeApiKey(process.env.DRONE_HUB_CODEX_AUTH_FILE);
  if (configured) return configured;
  return path.join(os.homedir(), '.codex', 'auth.json');
}

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

export async function resolveVoiceStreamPairingPasswordSettings(): Promise<EffectiveVoiceStreamPairingPasswordSettings> {
  const stored = await getStoredVoiceStreamPairingPassword();
  if (stored) {
    return {
      password: stored.password,
      source: 'settings',
      updatedAt: stored.updatedAt,
    };
  }
  const envPassword = normalizeApiKey(process.env.DRONE_PAIR_PASSWORD);
  if (envPassword) {
    return {
      password: envPassword,
      source: 'environment',
      updatedAt: null,
    };
  }
  return {
    password: null,
    source: null,
    updatedAt: null,
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

export function voiceStreamPairingPasswordSettingsResponse(
  settings: EffectiveVoiceStreamPairingPasswordSettings,
  options?: { includePassword?: boolean },
): {
  hasPassword: boolean;
  source: ApiKeySettingsSource;
  passwordHint: string | null;
  updatedAt: string | null;
  password?: string | null;
} {
  return {
    hasPassword: Boolean(settings.password),
    source: settings.source,
    passwordHint: apiKeyHint(settings.password),
    updatedAt: settings.source === 'settings' ? settings.updatedAt : null,
    ...(options?.includePassword ? { password: settings.password } : {}),
  };
}

export async function resolveLlmSettingsResponse(): Promise<{
  ok: true;
  provider: { selected: LlmProviderId; source: LlmProviderSource };
  openai: { hasKey: boolean; source: ApiKeySettingsSource; keyHint: string | null; updatedAt: string | null };
  gemini: { hasKey: boolean; source: ApiKeySettingsSource; keyHint: string | null; updatedAt: string | null };
  codex: { hasKey: boolean; source: ApiKeySettingsSource; keyHint: string | null; updatedAt: string | null };
  groq: { hasKey: boolean; source: ApiKeySettingsSource; keyHint: string | null; updatedAt: string | null };
  voiceStreamPairingPassword: { hasPassword: boolean; source: ApiKeySettingsSource; passwordHint: string | null; updatedAt: string | null };
}> {
  const [provider, openai, gemini, codex, groq, voiceStreamPairingPassword] = await Promise.all([
    resolveEffectiveLlmProvider(),
    resolveEffectiveProviderApiKeySettings('openai'),
    resolveEffectiveProviderApiKeySettings('gemini'),
    resolveEffectiveProviderApiKeySettings('codex'),
    resolveGroqApiKeySettings(),
    resolveVoiceStreamPairingPasswordSettings(),
  ]);
  return {
    ok: true,
    provider: { selected: provider.provider, source: provider.source },
    openai: providerKeySettingsResponse(openai),
    gemini: providerKeySettingsResponse(gemini),
    codex: providerKeySettingsResponse(codex),
    groq: providerKeySettingsResponse(groq),
    voiceStreamPairingPassword: voiceStreamPairingPasswordSettingsResponse(voiceStreamPairingPassword),
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

async function getStoredVoiceApprovalSettings(): Promise<{
  settings: VoiceApprovalSettings | null;
  updatedAt: string | null;
}> {
  const record = await getCanonicalSetting<VoiceApprovalSettings | null>(SETTING_KEYS.voiceApproval, (reg) => {
    const raw = reg.settings?.voiceApproval;
    return raw === undefined
      ? null
      : { value: parseVoiceApprovalSettings(raw), updatedAt: legacyUpdatedAt(raw) };
  });
  const settings = parseVoiceApprovalSettings(record?.value);
  return {
    settings,
    updatedAt: settings ? record?.updatedAt ?? null : null,
  };
}

export async function upsertStoredVoiceApprovalSettings(settingsRaw: unknown): Promise<void> {
  const settings = parseVoiceApprovalSettings(settingsRaw);
  if (!settings) {
    throw new Error('Invalid voice approval settings.');
  }
  await putCanonicalSetting(
    SETTING_KEYS.voiceApproval,
    voiceApprovalSettingsEqual(settings, VOICE_APPROVAL_SETTINGS_DEFAULT) ? null : settings,
  );
}

export async function resolveEffectiveVoiceApprovalSettings(): Promise<EffectiveVoiceApprovalSettings> {
  const stored = await getStoredVoiceApprovalSettings();
  return {
    ...(stored.settings ?? VOICE_APPROVAL_SETTINGS_DEFAULT),
    source: stored.settings ? 'settings' : 'default',
    updatedAt: stored.settings ? stored.updatedAt : null,
  };
}

export async function resolveVoiceApprovalSettingsResponse(): Promise<{
  ok: true;
  profile: {
    activeProfile: string | null;
    scoped: true;
  };
  voiceApproval: EffectiveVoiceApprovalSettings;
  voiceTranscription: EffectiveVoiceTranscriptionSettings;
  voiceActivation: EffectiveVoiceActivationSettings;
  voiceRealtime: EffectiveVoiceRealtimeSettings;
  defaults: VoiceApprovalSettings;
  transcriptionDefaults: VoiceTranscriptionSettings;
  activationDefaults: VoiceActivationSettings;
  realtimeDefaults: VoiceRealtimeSettings;
  limits: typeof VOICE_APPROVAL_SETTINGS_LIMITS;
}> {
  return {
    ok: true,
    profile: {
      activeProfile: await readActiveProfileName(),
      scoped: true,
    },
    voiceApproval: await resolveEffectiveVoiceApprovalSettings(),
    voiceTranscription: await resolveEffectiveVoiceTranscriptionSettings(),
    voiceActivation: await resolveEffectiveVoiceActivationSettings(),
    voiceRealtime: await resolveEffectiveVoiceRealtimeSettings(),
    defaults: VOICE_APPROVAL_SETTINGS_DEFAULT,
    transcriptionDefaults: VOICE_TRANSCRIPTION_SETTINGS_DEFAULT,
    activationDefaults: VOICE_ACTIVATION_SETTINGS_DEFAULT,
    realtimeDefaults: VOICE_REALTIME_SETTINGS_DEFAULT,
    limits: VOICE_APPROVAL_SETTINGS_LIMITS,
  };
}

async function getStoredVoiceTranscriptionSettings(): Promise<{
  settings: VoiceTranscriptionSettings | null;
  updatedAt: string | null;
}> {
  const record = await getCanonicalSetting<VoiceTranscriptionSettings | null>(SETTING_KEYS.voiceTranscription, (reg) => {
    const raw = reg.settings?.voiceTranscription;
    return raw === undefined
      ? null
      : { value: parseVoiceTranscriptionSettings(raw), updatedAt: legacyUpdatedAt(raw) };
  });
  const settings = parseVoiceTranscriptionSettings(record?.value);
  return {
    settings,
    updatedAt: settings ? record?.updatedAt ?? null : null,
  };
}

export async function upsertStoredVoiceTranscriptionSettings(settingsRaw: unknown): Promise<void> {
  const settings = parseVoiceTranscriptionSettings(settingsRaw);
  if (!settings) {
    throw new Error('Invalid voice transcription settings.');
  }
  await putCanonicalSetting(
    SETTING_KEYS.voiceTranscription,
    voiceTranscriptionSettingsEqual(settings, VOICE_TRANSCRIPTION_SETTINGS_DEFAULT) ? null : settings,
  );
}

export async function resolveEffectiveVoiceTranscriptionSettings(): Promise<EffectiveVoiceTranscriptionSettings> {
  const stored = await getStoredVoiceTranscriptionSettings();
  return {
    ...(stored.settings ?? VOICE_TRANSCRIPTION_SETTINGS_DEFAULT),
    source: stored.settings ? 'settings' : 'default',
    updatedAt: stored.settings ? stored.updatedAt : null,
  };
}

async function getStoredVoiceActivationSettings(): Promise<{
  settings: VoiceActivationSettings | null;
  updatedAt: string | null;
}> {
  const record = await getCanonicalSetting<VoiceActivationSettings | null>(SETTING_KEYS.voiceActivation, (reg) => {
    const raw = reg.settings?.voiceActivation;
    return raw === undefined
      ? null
      : { value: parseVoiceActivationSettings(raw), updatedAt: legacyUpdatedAt(raw) };
  });
  const settings = parseVoiceActivationSettings(record?.value);
  return {
    settings,
    updatedAt: settings ? record?.updatedAt ?? null : null,
  };
}

export async function upsertStoredVoiceActivationSettings(settingsRaw: unknown): Promise<void> {
  const settings = parseVoiceActivationSettings(settingsRaw, { fallbackEmpty: false });
  if (!settings) {
    throw new Error('Voice activation settings require at least one normal alias and one real-time alias.');
  }
  await putCanonicalSetting(
    SETTING_KEYS.voiceActivation,
    voiceActivationSettingsEqual(settings, VOICE_ACTIVATION_SETTINGS_DEFAULT) ? null : settings,
  );
}

export async function resolveEffectiveVoiceActivationSettings(): Promise<EffectiveVoiceActivationSettings> {
  const stored = await getStoredVoiceActivationSettings();
  return {
    ...(stored.settings ?? VOICE_ACTIVATION_SETTINGS_DEFAULT),
    source: stored.settings ? 'settings' : 'default',
    updatedAt: stored.settings ? stored.updatedAt : null,
  };
}

async function getStoredVoiceRealtimeSettings(): Promise<{
  settings: VoiceRealtimeSettings | null;
  updatedAt: string | null;
}> {
  const record = await getCanonicalSetting<VoiceRealtimeSettings | null>(SETTING_KEYS.voiceRealtime, (reg) => {
    const raw = reg.settings?.voiceRealtime;
    return raw === undefined
      ? null
      : { value: parseVoiceRealtimeSettings(raw), updatedAt: legacyUpdatedAt(raw) };
  });
  const settings = parseVoiceRealtimeSettings(record?.value);
  return {
    settings,
    updatedAt: settings ? record?.updatedAt ?? null : null,
  };
}

export async function upsertStoredVoiceRealtimeSettings(settingsRaw: unknown): Promise<void> {
  const settings = parseVoiceRealtimeSettings(settingsRaw);
  if (!settings) {
    throw new Error('Invalid voice realtime settings.');
  }
  await putCanonicalSetting(
    SETTING_KEYS.voiceRealtime,
    voiceRealtimeSettingsEqual(settings, VOICE_REALTIME_SETTINGS_DEFAULT) ? null : settings,
  );
}

export async function resolveEffectiveVoiceRealtimeSettings(): Promise<EffectiveVoiceRealtimeSettings> {
  const stored = await getStoredVoiceRealtimeSettings();
  return {
    ...(stored.settings ?? VOICE_REALTIME_SETTINGS_DEFAULT),
    source: stored.settings ? 'settings' : 'default',
    updatedAt: stored.settings ? stored.updatedAt : null,
  };
}

async function getStoredAgentMessageAutoContinueSettings(): Promise<{
  prompt: string | null;
  enabledByDefault: boolean | null;
  updatedAt: string | null;
}> {
  const record = await getCanonicalSetting<{
    prompt?: string;
    enabledByDefault?: boolean;
  } | null>(SETTING_KEYS.agentMessageAutoContinue, (reg) => {
    const raw = reg.settings?.agentMessageAutoContinue;
    if (raw === undefined) return null;
    const prompt = normalizeAgentMessageAutoContinuePrompt(raw.prompt);
    return {
      value: {
        ...(prompt ? { prompt } : {}),
        ...(typeof raw.enabledByDefault === 'boolean' ? { enabledByDefault: raw.enabledByDefault } : {}),
      },
      updatedAt: legacyUpdatedAt(raw),
    };
  });
  const prompt = normalizeAgentMessageAutoContinuePrompt(record?.value?.prompt);
  const enabledByDefault =
    record?.value?.enabledByDefault === true
      ? true
      : record?.value?.enabledByDefault === false
        ? false
        : null;
  return {
    prompt: prompt || null,
    enabledByDefault,
    updatedAt: record?.value ? record.updatedAt : null,
  };
}

export async function upsertStoredAgentMessageAutoContinueSettings(opts: {
  prompt?: string | null;
  enabledByDefault?: boolean | null;
}): Promise<void> {
  const nextPrompt =
    opts.prompt === undefined ? undefined : normalizeAgentMessageAutoContinuePrompt(opts.prompt);
  const enabledByDefault = opts.enabledByDefault === true;
  await getStoredAgentMessageAutoContinueSettings();
  await (await getHubSettingsRepository()).update<{
    prompt?: string;
    enabledByDefault?: boolean;
  } | null>(SETTING_KEYS.agentMessageAutoContinue, (current) => {
    const prompt = nextPrompt === undefined
      ? normalizeAgentMessageAutoContinuePrompt(current?.value?.prompt)
      : nextPrompt;
    const effectiveEnabledByDefault =
      opts.enabledByDefault === undefined ? current?.value?.enabledByDefault === true : enabledByDefault;
    if ((!prompt || prompt === AGENT_MESSAGE_AUTO_CONTINUE_PROMPT_DEFAULT) && !effectiveEnabledByDefault) {
      return null;
    }
    return {
      ...(prompt && prompt !== AGENT_MESSAGE_AUTO_CONTINUE_PROMPT_DEFAULT ? { prompt } : {}),
      ...(effectiveEnabledByDefault ? { enabledByDefault: true } : {}),
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
  const record = await getCanonicalSetting<{
    policyMarkdown?: string;
    enabledByDefault?: boolean;
  } | null>(SETTING_KEYS.agentSuggestion, (reg) => {
    const raw = reg.settings?.agentSuggestion;
    if (raw === undefined) return null;
    const policyMarkdown = normalizeAgentSuggestionPolicyMarkdown(raw.policyMarkdown);
    return {
      value: {
        ...(policyMarkdown ? { policyMarkdown } : {}),
        ...(typeof raw.enabledByDefault === 'boolean' ? { enabledByDefault: raw.enabledByDefault } : {}),
      },
      updatedAt: legacyUpdatedAt(raw),
    };
  });
  const policyMarkdown = normalizeAgentSuggestionPolicyMarkdown(record?.value?.policyMarkdown);
  const enabledByDefault =
    record?.value?.enabledByDefault === true
      ? true
      : record?.value?.enabledByDefault === false
        ? false
        : null;
  return {
    policyMarkdown: policyMarkdown || null,
    enabledByDefault,
    updatedAt: record?.value ? record.updatedAt : null,
  };
}

export async function upsertStoredAgentSuggestionSettings(opts: {
  policyMarkdown?: string | null;
  enabledByDefault?: boolean | null;
}): Promise<void> {
  const nextPolicyMarkdown =
    opts.policyMarkdown === undefined ? undefined : normalizeAgentSuggestionPolicyMarkdown(opts.policyMarkdown);
  const enabledByDefault = opts.enabledByDefault === true;
  await getStoredAgentSuggestionSettings();
  await (await getHubSettingsRepository()).update<{
    policyMarkdown?: string;
    enabledByDefault?: boolean;
  } | null>(SETTING_KEYS.agentSuggestion, (current) => {
    const policyMarkdown =
      nextPolicyMarkdown === undefined
        ? normalizeAgentSuggestionPolicyMarkdown(current?.value?.policyMarkdown)
        : nextPolicyMarkdown;
    const effectiveEnabledByDefault =
      opts.enabledByDefault === undefined ? current?.value?.enabledByDefault === true : enabledByDefault;
    if ((!policyMarkdown || policyMarkdown === AGENT_SUGGESTION_POLICY_DEFAULT) && !effectiveEnabledByDefault) {
      return null;
    }
    return {
      ...(policyMarkdown && policyMarkdown !== AGENT_SUGGESTION_POLICY_DEFAULT ? { policyMarkdown } : {}),
      ...(effectiveEnabledByDefault ? { enabledByDefault: true } : {}),
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
  const record = await getCanonicalSetting<KanbanBoardSettings>(SETTING_KEYS.kanbanBoard, (reg) => {
    const raw = reg.settings?.kanbanBoard;
    return raw === undefined
      ? null
      : { value: sanitizeTaskBoardState(raw), updatedAt: legacyUpdatedAt(raw) };
  });
  return {
    board: sanitizeTaskBoardState(record?.value),
    updatedAt: record?.updatedAt ?? null,
  };
}

/**
 * Atomically transforms the canonical Kanban board.
 *
 * Reading first completes the one-time legacy registry backfill. The repository
 * update then creates a canonical row even when no legacy value exists, so a
 * later stale registry projection cannot resurrect old board state.
 */
export async function transformStoredKanbanBoardSettings(
  transform: (board: KanbanBoardSettings) => KanbanBoardSettings,
): Promise<{ board: KanbanBoardSettings; updatedAt: string | null }> {
  await getStoredKanbanBoardSettings();
  const record = await (await getHubSettingsRepository()).update<KanbanBoardSettings>(SETTING_KEYS.kanbanBoard, (current) => {
    const board = sanitizeTaskBoardState(current?.value);
    return sanitizeTaskBoardState(transform(board));
  });
  // Bun does not have the native SQLite projection yet. Keep its legacy read
  // model synchronized explicitly; production Node writes only the canonical row.
  if ((globalThis as any).Bun) {
    await updateRegistry((registry) => {
      persistTaskBoardState(registry, record.value);
    });
  }
  return {
    board: sanitizeTaskBoardState(record.value),
    updatedAt: record.updatedAt,
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
    expectedUpdatedAtRaw === undefined
      ? undefined
      : typeof expectedUpdatedAtRaw === 'string' && expectedUpdatedAtRaw.trim()
        ? expectedUpdatedAtRaw.trim()
        : null;
  await getStoredKanbanBoardSettings();
  await (await getHubSettingsRepository()).update<KanbanBoardSettings>(SETTING_KEYS.kanbanBoard, (current) => {
    const currentUpdatedAt = current?.updatedAt ?? null;
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== currentUpdatedAt) {
      throw new KanbanBoardSettingsConflictError(sanitizeTaskBoardState(current?.value), currentUpdatedAt);
    }
    return board;
  }, { updatedAt });
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
  const record = await getCanonicalSetting<TaskPlaybookButtonSettings>(SETTING_KEYS.taskPlaybookButtons, (reg) => {
    const raw = reg.settings?.taskPlaybookButtons;
    return raw === undefined
      ? null
      : { value: sanitizeTaskPlaybookButtonSettings(raw.items), updatedAt: legacyUpdatedAt(raw) };
  });
  return {
    taskPlaybookButtons: sanitizeTaskPlaybookButtonSettings(record?.value),
    updatedAt: record?.updatedAt ?? null,
  };
}

export async function upsertStoredTaskPlaybookButtonSettings(valueRaw: unknown): Promise<void> {
  const taskPlaybookButtons = sanitizeTaskPlaybookButtonSettings(valueRaw);
  await putCanonicalSetting(
    SETTING_KEYS.taskPlaybookButtons,
    taskPlaybookButtons.map((item) => ({
      id: item.id,
      label: item.label,
      playbookId: item.playbookId,
      taskTypeIds: item.taskTypeIds.slice(),
    })),
  );
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
