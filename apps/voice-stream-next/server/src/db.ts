import crypto from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Database } from 'bun:sqlite';

import {
  VOICE_APPROVAL_SETTINGS_DEFAULT,
  type VoiceApprovalSettings,
} from './voice-approval-settings.js';
import {
  cleanTargetKind,
  extensionToolName,
  parseAssistantExtensionManifest,
  type AssistantExtensionManifest,
  type AssistantExtensionToolRoute,
} from './assistant-extensions.js';

export type SpeechPlaybackTarget = 'auto' | 'web' | 'desktop' | 'android';

export type UserProfile = {
  id: string;
  clerkUserId: string;
  displayName: string;
  email: string;
  admin: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
};

export type VoiceSettings = VoiceApprovalSettings & {
  speechPlaybackTarget: SpeechPlaybackTarget;
  updatedAt: string;
};

export type DeviceRecord = {
  id: string;
  userId: string;
  deviceType: string;
  displayName: string;
  installationId: string | null;
  tokenHint: string;
  lastSeenAt: string;
  createdAt: string;
  revokedAt: string | null;
};

export type PairingSessionRecord = {
  id: string;
  userId: string;
  deviceId: string;
  expiresAt: string;
  claimedAt: string | null;
  createdAt: string;
};

export type AndroidSetupSessionRecord = {
  id: string;
  userId: string;
  expiresAt: string;
  claimedAt: string | null;
  deviceId: string | null;
  createdAt: string;
};

export type AndroidSetupSessionResult =
  | { ok: true; session: AndroidSetupSessionRecord }
  | { ok: false; reason: 'not_found' | 'invalid_secret' | 'expired' | 'claimed' };

export type AndroidSetupClaimResult =
  | { ok: true; session: AndroidSetupSessionRecord; device: DeviceRecord; token: string; pairingSession: PairingSessionRecord }
  | { ok: false; reason: 'not_found' | 'invalid_secret' | 'expired' | 'claimed' };

export type DesktopAuthRequestRecord = {
  id: string;
  displayName: string;
  deviceType: string;
  installationId: string | null;
  expiresAt: string;
  claimedAt: string | null;
  userId: string | null;
  deviceId: string | null;
  createdAt: string;
};

export type DesktopAuthClaimResult =
  | { ok: true; request: DesktopAuthRequestRecord; device: DeviceRecord }
  | { ok: false; reason: 'not_found' | 'invalid_secret' | 'expired' | 'claimed' };

export type DesktopAuthPollResult =
  | { ok: true; status: 'pending'; request: DesktopAuthRequestRecord }
  | { ok: true; status: 'claimed'; request: DesktopAuthRequestRecord; device: DeviceRecord }
  | { ok: false; reason: 'not_found' | 'invalid_secret' | 'expired' };

export type DeviceAuthFailureReason = 'not_found' | 'invalid_token' | 'revoked' | 'pairing_expired' | 'client_too_old';

export type DeviceAuthResult =
  | { ok: true; device: DeviceRecord }
  | { ok: false; reason: DeviceAuthFailureReason; minClientVersion?: number };

export type LogRecord = {
  id: string;
  userId: string;
  deviceId: string | null;
  source: string;
  level: string;
  message: string;
  detailsJson: string | null;
  createdAt: string;
};

export type AssistantThread = {
  id: string;
  userId: string;
  deviceId: string | null;
  title: string;
  source: string;
  provider: string;
  model: string;
  thinkingLevel: string;
  status: AssistantRunStatus;
  error: string | null;
  voiceEnabled: boolean;
  autoApprove: boolean;
  systemPrompt: string | null;
  enabledTools: string[];
  capabilities: AssistantThreadCapabilities;
  promptDeliveryMode: 'queue' | 'asap';
  createdAt: string;
  updatedAt: string;
};

export type AssistantMessage = {
  id: string;
  threadId: string;
  userId: string;
  role: AssistantMessageRole;
  content: string;
  contentJson: string | null;
  toolName: string | null;
  toolCallId: string | null;
  isError: boolean;
  spokenText: string | null;
  createdAt: string;
};

export type AssistantMessageRole = 'user' | 'assistant' | 'toolResult' | 'system';

export type AssistantRunStatus = 'idle' | 'running' | 'waiting_for_approval' | 'cancelled' | 'error';

export type AssistantThreadCapabilities = {
  artifacts: boolean;
  speech: boolean;
  approvals: boolean;
  externalCalls: boolean;
  futureIntegrations: boolean;
};

export type AssistantRunRecord = {
  id: string;
  userId: string;
  threadId: string;
  status: AssistantRunStatus;
  provider: string;
  model: string;
  thinkingLevel: string;
  prompt: string;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
};

export type AssistantQueuedPromptRecord = {
  id: string;
  userId: string;
  threadId: string;
  prompt: string;
  provider: string;
  model: string;
  thinkingLevel: string;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
};

export type AssistantToolCallRecord = {
  id: string;
  userId: string;
  threadId: string;
  runId: string | null;
  toolName: string;
  status: 'pending' | 'running' | 'waiting_for_approval' | 'approved' | 'denied' | 'completed' | 'failed';
  argsJson: string;
  resultJson: string | null;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AssistantApprovalRecord = {
  id: string;
  userId: string;
  threadId: string;
  runId: string | null;
  toolCallId: string;
  toolName: string;
  label: string;
  argsJson: string;
  status: 'pending' | 'approved' | 'denied';
  requestedBy: string;
  resolvedBy: string | null;
  resultJson: string | null;
  failureReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type AssistantArtifactRecord = {
  id: string;
  userId: string;
  threadId: string;
  path: string;
  content: string;
  size: number;
  revision: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantSettingsRecord = {
  userId: string;
  normalSystemPrompt: string;
  voiceSystemPrompt: string;
  defaultProvider: string;
  defaultModel: string;
  defaultThinkingLevel: string;
  defaultEnabledTools: string[];
  updatedAt: string;
};

export type AssistantApiKeyProvider = 'openai' | 'exa';

export type AssistantApiKeyView = {
  provider: AssistantApiKeyProvider;
  hasKey: boolean;
  keyHint: string | null;
  updatedAt: string | null;
};

export type AssistantCodexConnectionRecord = {
  userId: string;
  accessToken: string;
  refreshToken: string;
  accountId: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantCodexConnectionView = {
  connected: boolean;
  accountId: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
};

export type AssistantCodexOAuthStateRecord = {
  state: string;
  userId: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
};

export type VoiceSession = {
  id: string;
  userId: string;
  deviceId: string;
  assistantThreadId: string;
  mode: string;
  startedAt: string;
  endedAt: string | null;
};

export type TranscriptRecord = {
  id: string;
  voiceSessionId: string;
  assistantThreadId: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  mode: string;
  text: string;
  final: boolean;
  sessionStartedAt: string;
  sessionEndedAt: string | null;
  createdAt: string;
};

export type ApprovalCodeRecord = {
  id: string;
  voiceSessionId: string | null;
  userId: string;
  code: string;
  source: string;
  createdAt: string;
};

export type ClientStatusRecord = {
  deviceId: string;
  userId: string;
  deviceType: string;
  displayName: string;
  mode: string;
  status: string;
  microphone: string;
  protocolVersion: number | null;
  appVersion: string | null;
  lastError: string | null;
  reportedAt: string;
  updatedAt: string;
};

export type AssistantExtensionManifestRecord = {
  userId: string;
  extensionId: string;
  name: string;
  version: string;
  description: string | null;
  manifest: AssistantExtensionManifest;
  updatedAt: string;
};

type UpsertUserInput = {
  clerkUserId: string;
  displayName: string;
  email: string;
  admin: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function newSecret(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function cleanAssistantApiKeyProvider(raw: unknown): AssistantApiKeyProvider {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'openai' || value === 'exa') return value;
  throw Object.assign(new Error('unsupported assistant API key provider'), { statusCode: 400 });
}

function cleanApiKey(raw: unknown): string {
  return String(raw ?? '').trim();
}

function apiKeyHint(apiKey: string): string {
  const value = cleanApiKey(apiKey);
  if (value.length <= 8) return `${value.slice(0, 2)}...${value.slice(-2)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function assistantSecretKey(): Buffer {
  const raw = process.env.VOICE_STREAM_NEXT_SECRETS_KEY?.trim();
  if (!raw) {
    throw Object.assign(new Error('VOICE_STREAM_NEXT_SECRETS_KEY is required to store assistant API keys.'), { statusCode: 500 });
  }
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function encryptAssistantSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', assistantSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

function decryptAssistantSecret(value: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = String(value ?? '').split(':');
  if (version !== 'v1' || !ivRaw || !tagRaw || !encryptedRaw) throw new Error('assistant API key is not readable');
  const decipher = crypto.createDecipheriv('aes-256-gcm', assistantSecretKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64')), decipher.final()]).toString('utf8');
}

function dataDir(): string {
  return path.resolve(
    process.env.VOICE_STREAM_NEXT_DATA_DIR?.trim() ||
      process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() ||
      path.join(process.cwd(), 'server', 'data'),
  );
}

function dbPath(): string {
  return path.join(dataDir(), 'voice-stream-next.sqlite');
}

function migrationsDir(): string {
  return path.resolve(process.cwd(), 'server', 'migrations');
}

function asBool(value: unknown): boolean {
  return value === 1 || value === true;
}

function cleanSpeechPlaybackTarget(raw: unknown): SpeechPlaybackTarget {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'web' || value === 'desktop' || value === 'android' || value === 'auto' ? value : 'auto';
}

function cleanInstallationId(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  return value ? value.slice(0, 128) : null;
}

const ASSISTANT_DEFAULT_PROVIDER = 'openai';
const ASSISTANT_DEFAULT_MODEL = 'gpt-5.5';
const ASSISTANT_DEFAULT_THINKING_LEVEL = 'off';
const ASSISTANT_DEFAULT_ENABLED_TOOLS = [
  'assistant_artifacts',
  'speak',
  'get_system_prompt',
  'update_system_prompt',
  'set_thinking_level',
  'web_search',
  'fetch_content',
  'create_new_thread',
] as const;
const ASSISTANT_DEFAULT_CAPABILITIES: AssistantThreadCapabilities = {
  artifacts: true,
  speech: true,
  approvals: true,
  externalCalls: true,
  futureIntegrations: false,
};
const ASSISTANT_NORMAL_SYSTEM_PROMPT_DEFAULT = 'You are VoiceStream, a concise standalone assistant. Answer directly and keep useful context in the thread.';
const ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT = 'You are VoiceStream, a concise voice assistant. Keep spoken replies short and practical.';

function parseJsonArray(raw: unknown, fallback: string[]): string[] {
  if (Array.isArray(raw)) return raw.map((item) => String(item)).filter(Boolean);
  if (typeof raw !== 'string' || !raw.trim()) return [...fallback];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [...fallback];
  } catch {
    return [...fallback];
  }
}

function parseJsonObject<T extends Record<string, unknown>>(raw: unknown, fallback: T): T {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...fallback, ...(raw as T) };
  if (typeof raw !== 'string' || !raw.trim()) return { ...fallback };
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...fallback, ...(parsed as T) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function normalizeRunStatus(raw: unknown): AssistantRunStatus {
  const value = String(raw ?? '').trim();
  if (value === 'running' || value === 'waiting_for_approval' || value === 'cancelled' || value === 'error') return value;
  return 'idle';
}

function normalizePromptDeliveryMode(raw: unknown): 'queue' | 'asap' {
  return String(raw ?? '').trim() === 'asap' ? 'asap' : 'queue';
}

function rowUser(row: any): UserProfile {
  return {
    id: String(row.id),
    clerkUserId: String(row.clerk_user_id),
    displayName: String(row.display_name ?? ''),
    email: String(row.email ?? ''),
    admin: asBool(row.admin),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastSeenAt: String(row.last_seen_at),
  };
}

function rowVoiceSettings(row: any): VoiceSettings {
  return {
    triggerPhrase: String(row.trigger_phrase ?? VOICE_APPROVAL_SETTINGS_DEFAULT.triggerPhrase),
    unlockPhrase: String(row.unlock_phrase ?? VOICE_APPROVAL_SETTINGS_DEFAULT.unlockPhrase),
    shutdownPhrase: String(row.shutdown_phrase ?? VOICE_APPROVAL_SETTINGS_DEFAULT.shutdownPhrase),
    lockCode: String(row.lock_code ?? VOICE_APPROVAL_SETTINGS_DEFAULT.lockCode),
    minDigits: Number(row.min_digits ?? VOICE_APPROVAL_SETTINGS_DEFAULT.minDigits),
    maxDigits: Number(row.max_digits ?? VOICE_APPROVAL_SETTINGS_DEFAULT.maxDigits),
    stableMs: Number(row.stable_ms ?? VOICE_APPROVAL_SETTINGS_DEFAULT.stableMs),
    collectTimeoutMs: Number(row.collect_timeout_ms ?? VOICE_APPROVAL_SETTINGS_DEFAULT.collectTimeoutMs),
    duplicateCooldownMs: Number(row.duplicate_cooldown_ms ?? VOICE_APPROVAL_SETTINGS_DEFAULT.duplicateCooldownMs),
    finalizeCheckIntervalMs: Number(row.finalize_check_interval_ms ?? VOICE_APPROVAL_SETTINGS_DEFAULT.finalizeCheckIntervalMs),
    postPromptCommandSuppressionMs: Number(
      row.post_prompt_command_suppression_ms ?? VOICE_APPROVAL_SETTINGS_DEFAULT.postPromptCommandSuppressionMs,
    ),
    speechPlaybackTarget: cleanSpeechPlaybackTarget(row.speech_playback_target),
    updatedAt: String(row.updated_at),
  };
}

function rowDevice(row: any): DeviceRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceType: String(row.device_type),
    displayName: String(row.display_name),
    installationId: row.installation_id == null ? null : String(row.installation_id),
    tokenHint: String(row.token_hint ?? ''),
    lastSeenAt: String(row.last_seen_at),
    createdAt: String(row.created_at),
    revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
  };
}

function rowPairingSession(row: any): PairingSessionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    expiresAt: String(row.expires_at),
    claimedAt: row.claimed_at == null ? null : String(row.claimed_at),
    createdAt: String(row.created_at),
  };
}

function rowAndroidSetupSession(row: any): AndroidSetupSessionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    expiresAt: String(row.expires_at),
    claimedAt: row.claimed_at == null ? null : String(row.claimed_at),
    deviceId: row.device_id == null ? null : String(row.device_id),
    createdAt: String(row.created_at),
  };
}

function rowDesktopAuthRequest(row: any): DesktopAuthRequestRecord {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    deviceType: String(row.device_type ?? 'desktop'),
    installationId: row.installation_id == null ? null : String(row.installation_id),
    expiresAt: String(row.expires_at),
    claimedAt: row.claimed_at == null ? null : String(row.claimed_at),
    userId: row.user_id == null ? null : String(row.user_id),
    deviceId: row.device_id == null ? null : String(row.device_id),
    createdAt: String(row.created_at),
  };
}

function rowLog(row: any): LogRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: row.device_id == null ? null : String(row.device_id),
    source: String(row.source),
    level: String(row.level),
    message: String(row.message),
    detailsJson: row.details_json == null ? null : String(row.details_json),
    createdAt: String(row.created_at),
  };
}

function rowThread(row: any): AssistantThread {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: row.device_id == null ? null : String(row.device_id),
    title: String(row.title),
    source: String(row.source),
    provider: String(row.provider ?? ASSISTANT_DEFAULT_PROVIDER),
    model: String(row.model ?? ASSISTANT_DEFAULT_MODEL),
    thinkingLevel: String(row.thinking_level ?? ASSISTANT_DEFAULT_THINKING_LEVEL),
    status: normalizeRunStatus(row.status),
    error: row.error == null ? null : String(row.error),
    voiceEnabled: true,
    autoApprove: asBool(row.auto_approve),
    systemPrompt: row.system_prompt == null ? null : String(row.system_prompt),
    enabledTools: parseJsonArray(row.enabled_tools_json, [...ASSISTANT_DEFAULT_ENABLED_TOOLS]),
    capabilities: parseJsonObject(row.capabilities_json, ASSISTANT_DEFAULT_CAPABILITIES),
    promptDeliveryMode: normalizePromptDeliveryMode(row.prompt_delivery_mode),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowMessage(row: any): AssistantMessage {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    userId: String(row.user_id),
    role:
      String(row.role) === 'assistant'
        ? 'assistant'
        : String(row.role) === 'toolResult'
          ? 'toolResult'
          : String(row.role) === 'system'
            ? 'system'
            : 'user',
    content: String(row.content ?? ''),
    contentJson: row.content_json == null ? null : String(row.content_json),
    toolName: row.tool_name == null ? null : String(row.tool_name),
    toolCallId: row.tool_call_id == null ? null : String(row.tool_call_id),
    isError: asBool(row.is_error),
    spokenText: row.spoken_text == null ? null : String(row.spoken_text),
    createdAt: String(row.created_at),
  };
}

function rowAssistantRun(row: any): AssistantRunRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    threadId: String(row.thread_id),
    status: normalizeRunStatus(row.status),
    provider: String(row.provider ?? ASSISTANT_DEFAULT_PROVIDER),
    model: String(row.model ?? ASSISTANT_DEFAULT_MODEL),
    thinkingLevel: String(row.thinking_level ?? ASSISTANT_DEFAULT_THINKING_LEVEL),
    prompt: String(row.prompt ?? ''),
    error: row.error == null ? null : String(row.error),
    startedAt: String(row.started_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
    cancelledAt: row.cancelled_at == null ? null : String(row.cancelled_at),
  };
}

function rowAssistantQueuedPrompt(row: any): AssistantQueuedPromptRecord {
  const statusRaw = String(row.status ?? 'queued');
  const status = ['queued', 'running', 'completed', 'cancelled', 'failed'].includes(statusRaw)
    ? (statusRaw as AssistantQueuedPromptRecord['status'])
    : 'queued';
  return {
    id: String(row.id),
    userId: String(row.user_id),
    threadId: String(row.thread_id),
    prompt: String(row.prompt ?? ''),
    provider: String(row.provider ?? ASSISTANT_DEFAULT_PROVIDER),
    model: String(row.model ?? ASSISTANT_DEFAULT_MODEL),
    thinkingLevel: String(row.thinking_level ?? ASSISTANT_DEFAULT_THINKING_LEVEL),
    status,
    error: row.error == null ? null : String(row.error),
    createdAt: String(row.created_at),
    startedAt: row.started_at == null ? null : String(row.started_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
    cancelledAt: row.cancelled_at == null ? null : String(row.cancelled_at),
  };
}

function rowAssistantToolCall(row: any): AssistantToolCallRecord {
  const statusRaw = String(row.status ?? 'pending');
  const status = ['pending', 'running', 'waiting_for_approval', 'approved', 'denied', 'completed', 'failed'].includes(statusRaw)
    ? (statusRaw as AssistantToolCallRecord['status'])
    : 'pending';
  return {
    id: String(row.id),
    userId: String(row.user_id),
    threadId: String(row.thread_id),
    runId: row.run_id == null ? null : String(row.run_id),
    toolName: String(row.tool_name),
    status,
    argsJson: String(row.args_json ?? '{}'),
    resultJson: row.result_json == null ? null : String(row.result_json),
    approvalRequired: asBool(row.approval_required),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowAssistantApproval(row: any): AssistantApprovalRecord {
  const statusRaw = String(row.status ?? 'pending');
  const status = statusRaw === 'approved' || statusRaw === 'denied' ? statusRaw : 'pending';
  return {
    id: String(row.id),
    userId: String(row.user_id),
    threadId: String(row.thread_id),
    runId: row.run_id == null ? null : String(row.run_id),
    toolCallId: String(row.tool_call_id),
    toolName: String(row.tool_name),
    label: String(row.label ?? ''),
    argsJson: String(row.args_json ?? '{}'),
    status,
    requestedBy: String(row.requested_by ?? ''),
    resolvedBy: row.resolved_by == null ? null : String(row.resolved_by),
    resultJson: row.result_json == null ? null : String(row.result_json),
    failureReason: row.failure_reason == null ? null : String(row.failure_reason),
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at == null ? null : String(row.resolved_at),
  };
}

function rowAssistantArtifact(row: any): AssistantArtifactRecord {
  const content = String(row.content ?? '');
  return {
    id: String(row.id),
    userId: String(row.user_id),
    threadId: String(row.thread_id),
    path: String(row.path),
    content,
    size: Number(row.size ?? Buffer.byteLength(content, 'utf8')),
    revision: String(row.revision ?? ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowAssistantSettings(row: any): AssistantSettingsRecord {
  return {
    userId: String(row.user_id),
    normalSystemPrompt: String(row.normal_system_prompt ?? ASSISTANT_NORMAL_SYSTEM_PROMPT_DEFAULT),
    voiceSystemPrompt: String(row.voice_system_prompt ?? ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT),
    defaultProvider: String(row.default_provider ?? ASSISTANT_DEFAULT_PROVIDER),
    defaultModel: String(row.default_model ?? ASSISTANT_DEFAULT_MODEL),
    defaultThinkingLevel: String(row.default_thinking_level ?? ASSISTANT_DEFAULT_THINKING_LEVEL),
    defaultEnabledTools: parseJsonArray(row.default_enabled_tools_json, [...ASSISTANT_DEFAULT_ENABLED_TOOLS]),
    updatedAt: String(row.updated_at),
  };
}

function rowAssistantCodexConnection(row: any): AssistantCodexConnectionRecord {
  return {
    userId: String(row.user_id),
    accessToken: String(row.access_token ?? ''),
    refreshToken: String(row.refresh_token ?? ''),
    accountId: row.account_id == null ? null : String(row.account_id),
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowAssistantCodexOAuthState(row: any): AssistantCodexOAuthStateRecord {
  return {
    state: String(row.state),
    userId: String(row.user_id),
    codeVerifier: String(row.code_verifier ?? ''),
    redirectUri: String(row.redirect_uri ?? ''),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
  };
}

function rowVoiceSession(row: any): VoiceSession {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    assistantThreadId: String(row.assistant_thread_id),
    mode: String(row.mode),
    startedAt: String(row.started_at),
    endedAt: row.ended_at == null ? null : String(row.ended_at),
  };
}

function rowApprovalCode(row: any): ApprovalCodeRecord {
  return {
    id: String(row.id),
    voiceSessionId: row.voice_session_id == null ? null : String(row.voice_session_id),
    userId: String(row.user_id),
    code: String(row.code),
    source: String(row.source),
    createdAt: String(row.created_at),
  };
}

function rowTranscript(row: any): TranscriptRecord {
  return {
    id: String(row.id),
    voiceSessionId: String(row.voice_session_id),
    assistantThreadId: String(row.assistant_thread_id ?? ''),
    userId: String(row.user_id),
    deviceId: String(row.device_id ?? ''),
    deviceName: String(row.device_name ?? ''),
    mode: String(row.mode ?? ''),
    text: String(row.text ?? ''),
    final: asBool(row.final),
    sessionStartedAt: String(row.session_started_at ?? row.created_at),
    sessionEndedAt: row.session_ended_at == null ? null : String(row.session_ended_at),
    createdAt: String(row.created_at),
  };
}

function rowClientStatus(row: any): ClientStatusRecord {
  return {
    deviceId: String(row.device_id),
    userId: String(row.user_id),
    deviceType: String(row.device_type ?? ''),
    displayName: String(row.display_name ?? ''),
    mode: String(row.mode ?? 'off'),
    status: String(row.status ?? ''),
    microphone: String(row.microphone ?? ''),
    protocolVersion: row.protocol_version == null ? null : Number(row.protocol_version),
    appVersion: row.app_version == null ? null : String(row.app_version),
    lastError: row.last_error == null ? null : String(row.last_error),
    reportedAt: String(row.reported_at),
    updatedAt: String(row.updated_at),
  };
}

function rowAssistantExtensionManifest(row: any): AssistantExtensionManifestRecord {
  const manifest = parseAssistantExtensionManifest(safeJson(row.manifest_json, {}));
  return {
    userId: String(row.user_id),
    extensionId: String(row.extension_id),
    name: String(row.name ?? manifest.name),
    version: String(row.version ?? manifest.version),
    description: row.description == null ? null : String(row.description),
    manifest,
    updatedAt: String(row.updated_at),
  };
}

function rowAssistantExtensionToolRoute(row: any): AssistantExtensionToolRoute {
  return {
    userId: String(row.user_id),
    toolName: String(row.tool_name),
    enabled: asBool(row.enabled),
    targetKind: cleanTargetKind(row.target_kind),
    targetDeviceId: row.target_device_id == null ? null : String(row.target_device_id),
    updatedAt: String(row.updated_at),
  };
}

function safeJson(raw: unknown, fallback: unknown): unknown {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

type Migration = {
  version: string;
  name: string;
  fileName: string;
  sql: string;
  checksum: string;
};

type AppliedMigrationRow = {
  version: string;
  name: string;
  checksum: string;
};

export function loadMigrations(dir = migrationsDir()): Migration[] {
  if (!existsSync(dir)) throw new Error(`missing migrations directory: ${dir}`);
  const migrations = readdirSync(dir)
    .map((fileName) => {
      const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(fileName);
      if (!match && fileName.endsWith('.sql')) throw new Error(`invalid migration file name: ${fileName}`);
      if (!match) return null;
      const sql = readFileSync(path.join(dir, fileName), 'utf8');
      return {
        version: match[1]!,
        name: match[2]!,
        fileName,
        sql,
        checksum: sha256(sql),
      } satisfies Migration;
    })
    .filter((migration): migration is Migration => Boolean(migration))
    .sort((a, b) => a.version.localeCompare(b.version));

  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) throw new Error(`duplicate migration version ${migration.version}`);
    seen.add(migration.version);
  }
  if (migrations.length === 0) throw new Error(`no migrations found in ${dir}`);
  return migrations;
}

export class VoiceStreamNextDb {
  readonly db: Database;
  readonly path: string;

  constructor(filePath = dbPath()) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.path = filePath;
    this.db = new Database(filePath, { create: true });
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  migrate(): void {
    this.runMigrations(loadMigrations());
  }

  private runMigrations(migrations: Migration[]): void {
    const hasMigrationHistory = this.tableExists('schema_migrations');
    if (!hasMigrationHistory && this.hasNonMigrationTables()) {
      throw new Error(
        `existing Voice Stream database has tables but no migration history; delete ${this.path} or migrate it manually before starting`,
      );
    }
    this.ensureMigrationTable();
    const appliedRows = this.appliedMigrations();
    const appliedByVersion = new Map(appliedRows.map((row) => [row.version, row]));
    for (const row of appliedRows) {
      const migration = migrations.find((item) => item.version === row.version);
      if (!migration) throw new Error(`database has unknown migration ${row.version} (${row.name})`);
      if (migration.checksum !== row.checksum) {
        throw new Error(`migration checksum mismatch for ${migration.fileName}`);
      }
    }

    for (const migration of migrations) {
      if (appliedByVersion.has(migration.version)) continue;
      this.applyMigration(migration);
      appliedByVersion.set(migration.version, {
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
      });
    }
  }

  private ensureMigrationTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
  }

  private appliedMigrations(): AppliedMigrationRow[] {
    return this.db
      .query('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
      .all() as AppliedMigrationRow[];
  }

  private applyMigration(migration: Migration): void {
    this.db.run('BEGIN IMMEDIATE');
    try {
      this.db.exec(migration.sql);
      this.recordMigration(migration);
      this.db.run('COMMIT');
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  private recordMigration(migration: Migration): void {
    this.db
      .query(
        `
        INSERT INTO schema_migrations (version, name, checksum, applied_at)
        VALUES ($version, $name, $checksum, $appliedAt)
      `,
      )
      .run({
        $version: migration.version,
        $name: migration.name,
        $checksum: migration.checksum,
        $appliedAt: nowIso(),
      });
  }

  private tableExists(table: string): boolean {
    const row = this.db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = $table")
      .get({ $table: table });
    return Boolean(row);
  }

  private hasNonMigrationTables(): boolean {
    const row = this.db
      .query(
        `
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name != 'schema_migrations'
      `,
      )
      .get() as { count?: number } | undefined;
    return Number(row?.count ?? 0) > 0;
  }

  upsertUser(input: UpsertUserInput): UserProfile {
    const at = nowIso();
    const existing = this.db
      .query('SELECT * FROM users WHERE clerk_user_id = $clerkUserId')
      .get({ $clerkUserId: input.clerkUserId });
    if (existing) {
      const nextAdmin = input.admin || asBool((existing as any).admin);
      this.db
        .query(
          `
          UPDATE users
          SET display_name = $displayName,
              email = $email,
              admin = $admin,
              updated_at = $updatedAt,
              last_seen_at = $lastSeenAt
          WHERE clerk_user_id = $clerkUserId
        `,
        )
        .run({
          $displayName: input.displayName,
          $email: input.email,
          $admin: nextAdmin ? 1 : 0,
          $updatedAt: at,
          $lastSeenAt: at,
          $clerkUserId: input.clerkUserId,
        });
    } else {
      const shouldBootstrapAdmin = this.userCount() === 0;
      this.db
        .query(
          `
          INSERT INTO users (id, clerk_user_id, display_name, email, admin, created_at, updated_at, last_seen_at)
          VALUES ($id, $clerkUserId, $displayName, $email, $admin, $createdAt, $updatedAt, $lastSeenAt)
        `,
        )
        .run({
          $id: newId('usr'),
          $clerkUserId: input.clerkUserId,
          $displayName: input.displayName,
          $email: input.email,
          $admin: input.admin || shouldBootstrapAdmin ? 1 : 0,
          $createdAt: at,
          $updatedAt: at,
          $lastSeenAt: at,
        });
    }
    const user = this.userByClerkId(input.clerkUserId);
    if (!user) throw new Error('failed to upsert user');
    this.ensureVoiceSettings(user.id);
    return user;
  }

  private userCount(): number {
    const row = this.db.query('SELECT COUNT(*) AS count FROM users').get() as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  userByClerkId(clerkUserId: string): UserProfile | null {
    const row = this.db.query('SELECT * FROM users WHERE clerk_user_id = $clerkUserId').get({ $clerkUserId: clerkUserId });
    return row ? rowUser(row) : null;
  }

  ensureVoiceSettings(userId: string): VoiceSettings {
    const existing = this.db.query('SELECT * FROM voice_settings WHERE user_id = $userId').get({ $userId: userId });
    if (existing) return rowVoiceSettings(existing);
    const at = nowIso();
    const defaults = VOICE_APPROVAL_SETTINGS_DEFAULT;
    this.db
      .query(
        `
        INSERT INTO voice_settings (
          id,
          user_id,
          unlock_code,
          lock_code,
          off_code,
          unlock_phrase,
          shutdown_phrase,
          trigger_phrase,
          min_digits,
          max_digits,
          stable_ms,
          collect_timeout_ms,
          duplicate_cooldown_ms,
          finalize_check_interval_ms,
          post_prompt_command_suppression_ms,
          speech_playback_target,
          updated_at
        )
        VALUES (
          $id,
          $userId,
          $unlockCode,
          $lockCode,
          $offCode,
          $unlockPhrase,
          $shutdownPhrase,
          $triggerPhrase,
          $minDigits,
          $maxDigits,
          $stableMs,
          $collectTimeoutMs,
          $duplicateCooldownMs,
          $finalizeCheckIntervalMs,
          $postPromptCommandSuppressionMs,
          $speechPlaybackTarget,
          $updatedAt
        )
      `,
      )
      .run({
        $id: newId('vset'),
        $userId: userId,
        $unlockCode: '',
        $lockCode: defaults.lockCode,
        $offCode: '',
        $unlockPhrase: defaults.unlockPhrase,
        $shutdownPhrase: defaults.shutdownPhrase,
        $triggerPhrase: defaults.triggerPhrase,
        $minDigits: defaults.minDigits,
        $maxDigits: defaults.maxDigits,
        $stableMs: defaults.stableMs,
        $collectTimeoutMs: defaults.collectTimeoutMs,
        $duplicateCooldownMs: defaults.duplicateCooldownMs,
        $finalizeCheckIntervalMs: defaults.finalizeCheckIntervalMs,
        $postPromptCommandSuppressionMs: defaults.postPromptCommandSuppressionMs,
        $speechPlaybackTarget: 'auto',
        $updatedAt: at,
      });
    return this.ensureVoiceSettings(userId);
  }

  updateVoiceSettings(
    userId: string,
    input: { lockCode: string; unlockPhrase?: string; shutdownPhrase?: string },
  ): VoiceSettings {
    const current = this.ensureVoiceSettings(userId);
    return this.updateVoiceApprovalSettings(userId, {
      ...current,
      lockCode: input.lockCode,
      unlockPhrase: input.unlockPhrase ?? current.unlockPhrase,
      shutdownPhrase: input.shutdownPhrase ?? current.shutdownPhrase,
    });
  }

  updateVoiceApprovalSettings(userId: string, input: VoiceApprovalSettings): VoiceSettings {
    const at = nowIso();
    this.ensureVoiceSettings(userId);
    this.db
      .query(
        `
        UPDATE voice_settings
        SET lock_code = $lockCode,
            unlock_phrase = $unlockPhrase,
            shutdown_phrase = $shutdownPhrase,
            trigger_phrase = $triggerPhrase,
            min_digits = $minDigits,
            max_digits = $maxDigits,
            stable_ms = $stableMs,
            collect_timeout_ms = $collectTimeoutMs,
            duplicate_cooldown_ms = $duplicateCooldownMs,
            finalize_check_interval_ms = $finalizeCheckIntervalMs,
            post_prompt_command_suppression_ms = $postPromptCommandSuppressionMs,
            updated_at = $updatedAt
        WHERE user_id = $userId
      `,
      )
      .run({
        $lockCode: input.lockCode,
        $unlockPhrase: input.unlockPhrase,
        $shutdownPhrase: input.shutdownPhrase,
        $triggerPhrase: input.triggerPhrase,
        $minDigits: input.minDigits,
        $maxDigits: input.maxDigits,
        $stableMs: input.stableMs,
        $collectTimeoutMs: input.collectTimeoutMs,
        $duplicateCooldownMs: input.duplicateCooldownMs,
        $finalizeCheckIntervalMs: input.finalizeCheckIntervalMs,
        $postPromptCommandSuppressionMs: input.postPromptCommandSuppressionMs,
        $updatedAt: at,
        $userId: userId,
      });
    return this.ensureVoiceSettings(userId);
  }

  updateSpeechPlaybackTarget(userId: string, target: SpeechPlaybackTarget): VoiceSettings {
    const at = nowIso();
    this.ensureVoiceSettings(userId);
    this.db
      .query(
        `
        UPDATE voice_settings
        SET speech_playback_target = $target,
            updated_at = $updatedAt
        WHERE user_id = $userId
      `,
      )
      .run({
        $target: cleanSpeechPlaybackTarget(target),
        $updatedAt: at,
        $userId: userId,
      });
    return this.ensureVoiceSettings(userId);
  }

  createPairingSession(userId: string, deviceId: string, expiresAt: string): PairingSessionRecord {
    const at = nowIso();
    const id = newId('pair');
    this.db
      .query(
        `
        INSERT INTO pairing_sessions (id, user_id, device_id, expires_at, claimed_at, created_at)
        VALUES ($id, $userId, $deviceId, $expiresAt, NULL, $createdAt)
        ON CONFLICT(device_id) DO UPDATE SET
          expires_at = excluded.expires_at,
          claimed_at = NULL,
          created_at = excluded.created_at
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $deviceId: deviceId,
        $expiresAt: expiresAt,
        $createdAt: at,
      });
    const row = this.db.query('SELECT * FROM pairing_sessions WHERE device_id = $deviceId').get({ $deviceId: deviceId });
    return rowPairingSession(row);
  }

  pairingSessionForDevice(deviceId: string): PairingSessionRecord | null {
    const row = this.db.query('SELECT * FROM pairing_sessions WHERE device_id = $deviceId').get({ $deviceId: deviceId });
    return row ? rowPairingSession(row) : null;
  }

  claimPairingSession(deviceId: string): void {
    const at = nowIso();
    this.db
      .query(
        `
        UPDATE pairing_sessions
        SET claimed_at = COALESCE(claimed_at, $claimedAt)
        WHERE device_id = $deviceId
      `,
      )
      .run({ $deviceId: deviceId, $claimedAt: at });
  }

  createAndroidSetupSession(userId: string, expiresAt: string): { session: AndroidSetupSessionRecord; secret: string } {
    const at = nowIso();
    const id = newId('asetup');
    const secret = newSecret();
    this.db
      .query(
        `
        INSERT INTO android_setup_sessions (id, user_id, secret_hash, expires_at, claimed_at, device_id, created_at)
        VALUES ($id, $userId, $secretHash, $expiresAt, NULL, NULL, $createdAt)
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $secretHash: sha256(secret),
        $expiresAt: expiresAt,
        $createdAt: at,
      });
    const row = this.db.query('SELECT * FROM android_setup_sessions WHERE id = $id').get({ $id: id });
    return { session: rowAndroidSetupSession(row), secret };
  }

  androidSetupSession(setupId: string, secret: string): AndroidSetupSessionResult {
    const row = this.db.query('SELECT * FROM android_setup_sessions WHERE id = $id').get({ $id: setupId });
    if (!row) return { ok: false, reason: 'not_found' };
    if (String((row as any).secret_hash) !== sha256(secret)) return { ok: false, reason: 'invalid_secret' };
    const session = rowAndroidSetupSession(row);
    if (session.claimedAt) return { ok: false, reason: 'claimed' };
    if (Date.parse(session.expiresAt) < Date.now()) return { ok: false, reason: 'expired' };
    return { ok: true, session };
  }

  claimAndroidSetupSession(
    setupId: string,
    secret: string,
    input: { displayName: string; expiresAt: string; installationId?: string | null },
  ): AndroidSetupClaimResult {
    const checked = this.androidSetupSession(setupId, secret);
    if (!checked.ok) return checked;

    const registered = this.registerDevice(checked.session.userId, {
      deviceType: 'android',
      displayName: input.displayName,
      installationId: input.installationId,
    });
    const pairingSession = this.createPairingSession(checked.session.userId, registered.device.id, input.expiresAt);
    const claimedAt = nowIso();
    this.db
      .query(
        `
        UPDATE android_setup_sessions
        SET claimed_at = $claimedAt,
            device_id = $deviceId
        WHERE id = $id AND claimed_at IS NULL
      `,
      )
      .run({
        $claimedAt: claimedAt,
        $deviceId: registered.device.id,
        $id: checked.session.id,
      });
    const row = this.db.query('SELECT * FROM android_setup_sessions WHERE id = $id').get({ $id: checked.session.id });
    return {
      ok: true,
      session: rowAndroidSetupSession(row),
      device: registered.device,
      token: registered.token,
      pairingSession,
    };
  }

  createDesktopAuthRequest(input: { displayName: string; expiresAt: string; installationId?: string | null; deviceType?: string | null }): { request: DesktopAuthRequestRecord; secret: string; deviceToken: string } {
    const at = nowIso();
    const id = newId('dauth');
    const secret = newSecret();
    const deviceToken = newSecret();
    const installationId = cleanInstallationId(input.installationId);
    const deviceType = String(input.deviceType ?? 'desktop').trim() || 'desktop';
    this.db
      .query(
        `
        INSERT INTO desktop_auth_requests (
          id,
          secret_hash,
          display_name,
          expires_at,
          claimed_at,
          user_id,
          device_id,
          created_at,
          device_token_hash,
          device_token_hint,
          device_type,
          installation_id
        )
        VALUES ($id, $secretHash, $displayName, $expiresAt, NULL, NULL, NULL, $createdAt, $deviceTokenHash, $deviceTokenHint, $deviceType, $installationId)
      `,
      )
      .run({
        $id: id,
        $secretHash: sha256(secret),
        $displayName: input.displayName,
        $expiresAt: input.expiresAt,
        $createdAt: at,
        $deviceTokenHash: sha256(deviceToken),
        $deviceTokenHint: deviceToken.slice(0, 6),
        $deviceType: deviceType,
        $installationId: installationId,
      });
    const row = this.db.query('SELECT * FROM desktop_auth_requests WHERE id = $id').get({ $id: id });
    return { request: rowDesktopAuthRequest(row), secret, deviceToken };
  }

  claimDesktopAuthRequest(userId: string, requestId: string, secret: string): DesktopAuthClaimResult {
    const row = this.db.query('SELECT * FROM desktop_auth_requests WHERE id = $id').get({ $id: requestId });
    if (!row) return { ok: false, reason: 'not_found' };
    if (String((row as any).secret_hash) !== sha256(secret)) return { ok: false, reason: 'invalid_secret' };
    const request = rowDesktopAuthRequest(row);
    if (request.claimedAt) return { ok: false, reason: 'claimed' };
    if (Date.parse(request.expiresAt) < Date.now()) return { ok: false, reason: 'expired' };
    const tokenHash = String((row as any).device_token_hash ?? '');
    const tokenHint = String((row as any).device_token_hint ?? '');
    if (!tokenHash || !tokenHint) return { ok: false, reason: 'invalid_secret' };

    const registered = this.registerDeviceWithTokenHash(userId, {
      deviceType: request.deviceType,
      displayName: request.displayName,
      tokenHash,
      tokenHint,
      installationId: request.installationId,
    });
    const claimedAt = nowIso();
    this.db
      .query(
        `
        UPDATE desktop_auth_requests
        SET claimed_at = $claimedAt,
            user_id = $userId,
            device_id = $deviceId
        WHERE id = $id AND claimed_at IS NULL
      `,
      )
      .run({
        $claimedAt: claimedAt,
        $userId: userId,
        $deviceId: registered.id,
        $id: request.id,
      });
    const claimed = this.db.query('SELECT * FROM desktop_auth_requests WHERE id = $id').get({ $id: request.id });
    return { ok: true, request: rowDesktopAuthRequest(claimed), device: registered };
  }

  desktopAuthRequestResult(requestId: string, secret: string): DesktopAuthPollResult {
    const row = this.db.query('SELECT * FROM desktop_auth_requests WHERE id = $id').get({ $id: requestId });
    if (!row) return { ok: false, reason: 'not_found' };
    if (String((row as any).secret_hash) !== sha256(secret)) return { ok: false, reason: 'invalid_secret' };
    const request = rowDesktopAuthRequest(row);
    if (Date.parse(request.expiresAt) < Date.now() && !request.claimedAt) return { ok: false, reason: 'expired' };
    if (!request.deviceId) return { ok: true, status: 'pending', request };
    const deviceRow = this.db.query('SELECT * FROM devices WHERE id = $id').get({ $id: request.deviceId });
    if (!deviceRow) return { ok: true, status: 'pending', request };
    return { ok: true, status: 'claimed', request, device: rowDevice(deviceRow) };
  }

  registerDevice(userId: string, input: { deviceType: string; displayName: string; installationId?: string | null }): { device: DeviceRecord; token: string } {
    const at = nowIso();
    const id = newId('dev');
    const token = newSecret();
    const tokenHash = sha256(token);
    const tokenHint = token.slice(0, 6);
    const installationId = cleanInstallationId(input.installationId);
    if (installationId) {
      const existing = this.updateDeviceByInstallationId(userId, {
        deviceType: input.deviceType,
        displayName: input.displayName,
        installationId,
        tokenHash,
        tokenHint,
        lastSeenAt: at,
      });
      if (existing) return { device: existing, token };
    }
    this.db
      .query(
        `
        INSERT INTO devices (id, user_id, device_type, display_name, installation_id, token_hash, token_hint, last_seen_at, created_at)
        VALUES ($id, $userId, $deviceType, $displayName, $installationId, $tokenHash, $tokenHint, $lastSeenAt, $createdAt)
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $deviceType: input.deviceType,
        $displayName: input.displayName,
        $installationId: installationId,
        $tokenHash: tokenHash,
        $tokenHint: tokenHint,
        $lastSeenAt: at,
        $createdAt: at,
      });
    const row = this.db.query('SELECT * FROM devices WHERE id = $id').get({ $id: id });
    if (!row) {
      throw new Error('Registered device was not found');
    }
    const device = rowDevice(row);
    return { device, token };
  }

  registerDeviceWithTokenHash(
    userId: string,
    input: { deviceType: string; displayName: string; tokenHash: string; tokenHint: string; installationId?: string | null },
  ): DeviceRecord {
    const at = nowIso();
    const id = newId('dev');
    const installationId = cleanInstallationId(input.installationId);
    if (installationId) {
      const existing = this.updateDeviceByInstallationId(userId, {
        deviceType: input.deviceType,
        displayName: input.displayName,
        installationId,
        tokenHash: input.tokenHash,
        tokenHint: input.tokenHint,
        lastSeenAt: at,
      });
      if (existing) return existing;
    }
    this.db
      .query(
        `
        INSERT INTO devices (id, user_id, device_type, display_name, installation_id, token_hash, token_hint, last_seen_at, created_at)
        VALUES ($id, $userId, $deviceType, $displayName, $installationId, $tokenHash, $tokenHint, $lastSeenAt, $createdAt)
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $deviceType: input.deviceType,
        $displayName: input.displayName,
        $installationId: installationId,
        $tokenHash: input.tokenHash,
        $tokenHint: input.tokenHint,
        $lastSeenAt: at,
        $createdAt: at,
      });
    const row = this.db.query('SELECT * FROM devices WHERE id = $id').get({ $id: id });
    if (!row) {
      throw new Error('Registered device was not found');
    }
    return rowDevice(row);
  }

  private updateDeviceByInstallationId(
    userId: string,
    input: {
      deviceType: string;
      displayName: string;
      installationId: string;
      tokenHash: string;
      tokenHint: string;
      lastSeenAt: string;
    },
  ): DeviceRecord | null {
    const row = this.db
      .query(
        `
        SELECT * FROM devices
        WHERE user_id = $userId
          AND device_type = $deviceType
          AND installation_id = $installationId
        LIMIT 1
      `,
      )
      .get({
        $userId: userId,
        $deviceType: input.deviceType,
        $installationId: input.installationId,
      });
    if (!row) return null;

    this.db
      .query(
        `
        UPDATE devices
        SET display_name = $displayName,
            token_hash = $tokenHash,
            token_hint = $tokenHint,
            last_seen_at = $lastSeenAt,
            revoked_at = NULL
        WHERE id = $deviceId
      `,
      )
      .run({
        $displayName: input.displayName,
        $tokenHash: input.tokenHash,
        $tokenHint: input.tokenHint,
        $lastSeenAt: input.lastSeenAt,
        $deviceId: String((row as any).id),
      });
    const updated = this.db.query('SELECT * FROM devices WHERE id = $deviceId').get({ $deviceId: String((row as any).id) });
    return updated ? rowDevice(updated) : null;
  }

  listDevices(userId?: string, includeRevoked = false): DeviceRecord[] {
    this.pruneExpiredUnclaimedPairingDevices();
    const rows = userId
      ? this.db
          .query(
            `
            SELECT * FROM devices
            WHERE user_id = $userId ${includeRevoked ? '' : 'AND revoked_at IS NULL'}
            ORDER BY last_seen_at DESC, created_at DESC
          `,
          )
          .all({ $userId: userId })
      : this.db
          .query(
            `
            SELECT * FROM devices
            ${includeRevoked ? '' : 'WHERE revoked_at IS NULL'}
            ORDER BY last_seen_at DESC, created_at DESC
          `,
          )
          .all();
    return rows.map(rowDevice);
  }

  pruneExpiredUnclaimedPairingDevices(at = nowIso()): number {
    const update = this.db
      .query(
        `
        UPDATE devices
        SET revoked_at = $revokedAt
        WHERE revoked_at IS NULL
          AND id IN (
            SELECT device_id
            FROM pairing_sessions
            WHERE claimed_at IS NULL
              AND expires_at < $now
          )
      `,
      )
      .run({ $revokedAt: at, $now: at }) as { changes?: number };
    this.db
      .query(
        `
        DELETE FROM pairing_sessions
        WHERE claimed_at IS NULL
          AND expires_at < $now
      `,
      )
      .run({ $now: at });
    return Number(update.changes ?? 0);
  }

  deviceForUser(userId: string, deviceId: string): DeviceRecord | null {
    const row = this.db.query('SELECT * FROM devices WHERE user_id = $userId AND id = $deviceId').get({ $userId: userId, $deviceId: deviceId });
    return row ? rowDevice(row) : null;
  }

  updateDeviceName(userId: string, deviceId: string, displayName: string): DeviceRecord | null {
    const device = this.deviceForUser(userId, deviceId);
    if (!device || device.revokedAt) return null;
    this.db
      .query(
        `
        UPDATE devices
        SET display_name = $displayName
        WHERE user_id = $userId
          AND id = $deviceId
          AND revoked_at IS NULL
      `,
      )
      .run({ $displayName: displayName, $userId: userId, $deviceId: deviceId });
    return this.deviceForUser(userId, deviceId);
  }

  assignDeviceInstallationId(userId: string, deviceId: string, installationIdRaw: string | null | undefined, token?: string): DeviceRecord | null {
    const installationId = cleanInstallationId(installationIdRaw);
    const device = this.deviceForUser(userId, deviceId);
    if (!device || !installationId || device.installationId === installationId) return device;
    if (device.installationId) return device;

    const conflict = this.db
      .query(
        `
        SELECT id FROM devices
        WHERE user_id = $userId
          AND device_type = $deviceType
          AND installation_id = $installationId
          AND id != $deviceId
        LIMIT 1
      `,
      )
      .get({
        $userId: userId,
        $deviceType: device.deviceType,
        $installationId: installationId,
        $deviceId: deviceId,
      });
    if (conflict) {
      if (!token) return device;
      const at = nowIso();
      this.db
        .query(
          `
          UPDATE devices
          SET display_name = $displayName,
              token_hash = $tokenHash,
              token_hint = $tokenHint,
              last_seen_at = $lastSeenAt,
              revoked_at = NULL
          WHERE user_id = $userId
            AND id = $conflictDeviceId
        `,
        )
        .run({
          $displayName: device.displayName,
          $tokenHash: sha256(token),
          $tokenHint: token.slice(0, 6),
          $lastSeenAt: at,
          $userId: userId,
          $conflictDeviceId: String((conflict as any).id),
        });
      this.db.query('DELETE FROM pairing_sessions WHERE device_id = $deviceId').run({ $deviceId: deviceId });
      this.db
        .query(
          `
          UPDATE devices
          SET revoked_at = $revokedAt
          WHERE user_id = $userId
            AND id = $deviceId
            AND revoked_at IS NULL
        `,
        )
        .run({ $revokedAt: at, $userId: userId, $deviceId: deviceId });
      return this.deviceForUser(userId, String((conflict as any).id));
    }

    this.db
      .query(
        `
        UPDATE devices
        SET installation_id = $installationId
        WHERE user_id = $userId
          AND id = $deviceId
          AND installation_id IS NULL
      `,
      )
      .run({ $installationId: installationId, $userId: userId, $deviceId: deviceId });
    return this.deviceForUser(userId, deviceId);
  }

  verifyDeviceToken(deviceId: string, token: string, options: { clientVersion?: number | null; minClientVersion?: number } = {}): DeviceAuthResult {
    const row = this.db.query('SELECT * FROM devices WHERE id = $id').get({ $id: deviceId });
    if (!row) return { ok: false, reason: 'not_found' };
    if ((row as any).revoked_at != null) return { ok: false, reason: 'revoked' };
    const tokenHash = sha256(token);
    if (String((row as any).token_hash) !== tokenHash) return { ok: false, reason: 'invalid_token' };

    const pairing = this.pairingSessionForDevice(deviceId);
    if (pairing && !pairing.claimedAt && Date.parse(pairing.expiresAt) < Date.now()) {
      return { ok: false, reason: 'pairing_expired' };
    }

    const minClientVersion = options.minClientVersion ?? 1;
    if (options.clientVersion != null && options.clientVersion < minClientVersion) {
      return { ok: false, reason: 'client_too_old', minClientVersion };
    }

    const at = nowIso();
    this.db.query('UPDATE devices SET last_seen_at = $lastSeenAt WHERE id = $id').run({ $lastSeenAt: at, $id: deviceId });
    if (pairing && !pairing.claimedAt) this.claimPairingSession(deviceId);
    return { ok: true, device: rowDevice({ ...(row as any), last_seen_at: at }) };
  }

  revokeDevice(userId: string, deviceId: string): DeviceRecord | null {
    const device = this.deviceForUser(userId, deviceId);
    if (!device || device.revokedAt) return null;
    const at = nowIso();
    this.db.query('UPDATE devices SET revoked_at = $revokedAt WHERE id = $deviceId AND user_id = $userId').run({
      $revokedAt: at,
      $deviceId: deviceId,
      $userId: userId,
    });
    this.db.query('DELETE FROM pairing_sessions WHERE device_id = $deviceId').run({ $deviceId: deviceId });
    return { ...device, revokedAt: at };
  }

  rotateDeviceToken(userId: string, deviceId: string): { device: DeviceRecord; token: string } | null {
    const device = this.deviceForUser(userId, deviceId);
    if (!device || device.revokedAt) return null;
    const token = newSecret();
    const tokenHash = sha256(token);
    const tokenHint = token.slice(0, 6);
    const at = nowIso();
    this.db
      .query(
        `
        UPDATE devices
        SET token_hash = $tokenHash,
            token_hint = $tokenHint,
            last_seen_at = $lastSeenAt
        WHERE id = $deviceId AND user_id = $userId
      `,
      )
      .run({
        $tokenHash: tokenHash,
        $tokenHint: tokenHint,
        $lastSeenAt: at,
        $deviceId: deviceId,
        $userId: userId,
      });
    const row = this.db.query('SELECT * FROM devices WHERE id = $deviceId').get({ $deviceId: deviceId });
    return row ? { device: rowDevice(row), token } : null;
  }

  addLog(userId: string, input: { deviceId?: string | null; source: string; level: string; message: string; detailsJson?: string | null }): LogRecord {
    const id = newId('log');
    const at = nowIso();
    this.db
      .query(
        `
        INSERT INTO client_logs (id, user_id, device_id, source, level, message, details_json, created_at)
        VALUES ($id, $userId, $deviceId, $source, $level, $message, $detailsJson, $createdAt)
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $deviceId: input.deviceId ?? null,
        $source: input.source,
        $level: input.level,
        $message: input.message,
        $detailsJson: input.detailsJson ?? null,
        $createdAt: at,
      });
    const row = this.db.query('SELECT * FROM client_logs WHERE id = $id').get({ $id: id });
    return rowLog(row);
  }

  listLogs(userId: string, limit = 100): LogRecord[] {
    const rows = this.db
      .query('SELECT * FROM client_logs WHERE user_id = $userId ORDER BY created_at DESC LIMIT $limit')
      .all({ $userId: userId, $limit: limit });
    return rows.map(rowLog);
  }

  ensureAssistantSettings(userId: string): AssistantSettingsRecord {
    const existing = this.db.query('SELECT * FROM assistant_settings WHERE user_id = $userId').get({ $userId: userId });
    if (existing) return rowAssistantSettings(existing);
    const at = nowIso();
    this.db
      .query(
        `
        INSERT INTO assistant_settings (
          user_id,
          normal_system_prompt,
          voice_system_prompt,
          default_provider,
          default_model,
          default_thinking_level,
          default_enabled_tools_json,
          updated_at
        )
        VALUES (
          $userId,
          $normalSystemPrompt,
          $voiceSystemPrompt,
          $defaultProvider,
          $defaultModel,
          $defaultThinkingLevel,
          $defaultEnabledToolsJson,
          $updatedAt
        )
      `,
      )
      .run({
        $userId: userId,
        $normalSystemPrompt: ASSISTANT_NORMAL_SYSTEM_PROMPT_DEFAULT,
        $voiceSystemPrompt: ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT,
        $defaultProvider: ASSISTANT_DEFAULT_PROVIDER,
        $defaultModel: ASSISTANT_DEFAULT_MODEL,
        $defaultThinkingLevel: ASSISTANT_DEFAULT_THINKING_LEVEL,
        $defaultEnabledToolsJson: JSON.stringify([...ASSISTANT_DEFAULT_ENABLED_TOOLS]),
        $updatedAt: at,
      });
    return this.ensureAssistantSettings(userId);
  }

  updateAssistantSettings(
    userId: string,
    input: Partial<Pick<AssistantSettingsRecord, 'normalSystemPrompt' | 'voiceSystemPrompt' | 'defaultProvider' | 'defaultModel' | 'defaultThinkingLevel' | 'defaultEnabledTools'>>,
  ): AssistantSettingsRecord {
    const current = this.ensureAssistantSettings(userId);
    const at = nowIso();
    this.db
      .query(
        `
        UPDATE assistant_settings
        SET normal_system_prompt = $normalSystemPrompt,
            voice_system_prompt = $voiceSystemPrompt,
            default_provider = $defaultProvider,
            default_model = $defaultModel,
            default_thinking_level = $defaultThinkingLevel,
            default_enabled_tools_json = $defaultEnabledToolsJson,
            updated_at = $updatedAt
        WHERE user_id = $userId
      `,
      )
      .run({
        $normalSystemPrompt: input.normalSystemPrompt ?? current.normalSystemPrompt,
        $voiceSystemPrompt: input.voiceSystemPrompt ?? current.voiceSystemPrompt,
        $defaultProvider: input.defaultProvider ?? current.defaultProvider,
        $defaultModel: input.defaultModel ?? current.defaultModel,
        $defaultThinkingLevel: input.defaultThinkingLevel ?? current.defaultThinkingLevel,
        $defaultEnabledToolsJson: JSON.stringify(input.defaultEnabledTools ?? current.defaultEnabledTools),
        $updatedAt: at,
        $userId: userId,
      });
    return this.ensureAssistantSettings(userId);
  }

  assistantApiKeyView(userId: string, providerRaw: unknown): AssistantApiKeyView {
    const provider = cleanAssistantApiKeyProvider(providerRaw);
    const row = this.db
      .query('SELECT provider, key_hint, updated_at FROM assistant_api_keys WHERE user_id = $userId AND provider = $provider')
      .get({ $userId: userId, $provider: provider }) as any;
    return {
      provider,
      hasKey: Boolean(row),
      keyHint: row ? String(row.key_hint ?? '') || null : null,
      updatedAt: row ? String(row.updated_at ?? '') || null : null,
    };
  }

  assistantApiKeysView(userId: string): Record<AssistantApiKeyProvider, AssistantApiKeyView> {
    return {
      openai: this.assistantApiKeyView(userId, 'openai'),
      exa: this.assistantApiKeyView(userId, 'exa'),
    };
  }

  assistantApiKey(userId: string, providerRaw: unknown): string | null {
    const provider = cleanAssistantApiKeyProvider(providerRaw);
    const row = this.db
      .query('SELECT encrypted_key FROM assistant_api_keys WHERE user_id = $userId AND provider = $provider')
      .get({ $userId: userId, $provider: provider }) as any;
    if (!row) return null;
    const apiKey = decryptAssistantSecret(String(row.encrypted_key ?? ''));
    return cleanApiKey(apiKey) || null;
  }

  upsertAssistantApiKey(userId: string, providerRaw: unknown, apiKeyRaw: unknown): AssistantApiKeyView {
    const provider = cleanAssistantApiKeyProvider(providerRaw);
    const apiKey = cleanApiKey(apiKeyRaw);
    if (!apiKey) throw Object.assign(new Error('API key is required.'), { statusCode: 400 });

    const at = nowIso();
    this.db
      .query(
        `
        INSERT INTO assistant_api_keys (user_id, provider, encrypted_key, key_hint, updated_at)
        VALUES ($userId, $provider, $encryptedKey, $keyHint, $updatedAt)
        ON CONFLICT(user_id, provider) DO UPDATE SET
          encrypted_key = excluded.encrypted_key,
          key_hint = excluded.key_hint,
          updated_at = excluded.updated_at
      `,
      )
      .run({
        $userId: userId,
        $provider: provider,
        $encryptedKey: encryptAssistantSecret(apiKey),
        $keyHint: apiKeyHint(apiKey),
        $updatedAt: at,
      });
    return this.assistantApiKeyView(userId, provider);
  }

  deleteAssistantApiKey(userId: string, providerRaw: unknown): boolean {
    const provider = cleanAssistantApiKeyProvider(providerRaw);
    const result = this.db
      .query('DELETE FROM assistant_api_keys WHERE user_id = $userId AND provider = $provider')
      .run({ $userId: userId, $provider: provider });
    return Number(result.changes ?? 0) > 0;
  }

  upsertAssistantExtensionManifest(userId: string, manifest: AssistantExtensionManifest): AssistantExtensionManifestRecord {
    const at = nowIso();
    this.db
      .query(
        `
        INSERT INTO assistant_extension_manifests (
          user_id,
          extension_id,
          name,
          version,
          description,
          manifest_json,
          updated_at
        )
        VALUES (
          $userId,
          $extensionId,
          $name,
          $version,
          $description,
          $manifestJson,
          $updatedAt
        )
        ON CONFLICT(user_id, extension_id) DO UPDATE SET
          name = excluded.name,
          version = excluded.version,
          description = excluded.description,
          manifest_json = excluded.manifest_json,
          updated_at = excluded.updated_at
      `,
      )
      .run({
        $userId: userId,
        $extensionId: manifest.id,
        $name: manifest.name,
        $version: manifest.version,
        $description: manifest.description ?? null,
        $manifestJson: JSON.stringify(manifest),
        $updatedAt: at,
      });
    return this.assistantExtensionManifest(userId, manifest.id)!;
  }

  assistantExtensionManifest(userId: string, extensionId: string): AssistantExtensionManifestRecord | null {
    const row = this.db
      .query('SELECT * FROM assistant_extension_manifests WHERE user_id = $userId AND extension_id = $extensionId')
      .get({ $userId: userId, $extensionId: extensionId });
    return row ? rowAssistantExtensionManifest(row) : null;
  }

  listAssistantExtensionManifests(userId: string): AssistantExtensionManifestRecord[] {
    return this.db
      .query('SELECT * FROM assistant_extension_manifests WHERE user_id = $userId ORDER BY name ASC, extension_id ASC')
      .all({ $userId: userId })
      .map(rowAssistantExtensionManifest);
  }

  deleteAssistantExtensionManifest(userId: string, extensionId: string): void {
    this.db
      .query('DELETE FROM assistant_extension_manifests WHERE user_id = $userId AND extension_id = $extensionId')
      .run({ $userId: userId, $extensionId: extensionId });
  }

  clearAssistantExtensionManifests(): void {
    this.db.query('DELETE FROM assistant_extension_manifests').run();
  }

  assistantExtensionToolManifest(userId: string, toolName: string): { manifest: AssistantExtensionManifest; tool: AssistantExtensionManifest['tools'][number] } | null {
    for (const record of this.listAssistantExtensionManifests(userId)) {
      const tool = record.manifest.tools.find((item) => extensionToolName(record.manifest.id, item.name) === toolName);
      if (tool) return { manifest: record.manifest, tool };
    }
    return null;
  }

  listAssistantExtensionToolRoutes(userId: string): AssistantExtensionToolRoute[] {
    return this.db
      .query('SELECT * FROM assistant_extension_tool_routes WHERE user_id = $userId ORDER BY tool_name ASC')
      .all({ $userId: userId })
      .map(rowAssistantExtensionToolRoute);
  }

  assistantExtensionToolRoute(userId: string, toolName: string): AssistantExtensionToolRoute | null {
    const row = this.db
      .query('SELECT * FROM assistant_extension_tool_routes WHERE user_id = $userId AND tool_name = $toolName')
      .get({ $userId: userId, $toolName: toolName });
    return row ? rowAssistantExtensionToolRoute(row) : null;
  }

  upsertAssistantExtensionToolRoute(
    userId: string,
    input: { toolName: string; enabled?: boolean; targetKind?: AssistantExtensionToolRoute['targetKind']; targetDeviceId?: string | null },
  ): AssistantExtensionToolRoute {
    const current = this.assistantExtensionToolRoute(userId, input.toolName);
    const at = nowIso();
    const enabled = input.enabled ?? current?.enabled ?? false;
    const targetKind = input.targetKind ?? current?.targetKind ?? 'device';
    const targetDeviceId = targetKind === 'device' ? input.targetDeviceId ?? current?.targetDeviceId ?? null : null;
    this.db
      .query(
        `
        INSERT INTO assistant_extension_tool_routes (
          user_id,
          tool_name,
          enabled,
          target_kind,
          target_device_id,
          updated_at
        )
        VALUES (
          $userId,
          $toolName,
          $enabled,
          $targetKind,
          $targetDeviceId,
          $updatedAt
        )
        ON CONFLICT(user_id, tool_name) DO UPDATE SET
          enabled = excluded.enabled,
          target_kind = excluded.target_kind,
          target_device_id = excluded.target_device_id,
          updated_at = excluded.updated_at
      `,
      )
      .run({
        $userId: userId,
        $toolName: input.toolName,
        $enabled: enabled ? 1 : 0,
        $targetKind: targetKind,
        $targetDeviceId: targetDeviceId,
        $updatedAt: at,
      });
    return this.assistantExtensionToolRoute(userId, input.toolName)!;
  }

  codexConnection(userId: string): AssistantCodexConnectionRecord | null {
    const row = this.db.query('SELECT * FROM assistant_codex_connections WHERE user_id = $userId').get({ $userId: userId });
    return row ? rowAssistantCodexConnection(row) : null;
  }

  codexConnectionView(userId: string): AssistantCodexConnectionView {
    const connection = this.codexConnection(userId);
    return {
      connected: Boolean(connection),
      accountId: connection?.accountId ?? null,
      expiresAt: connection?.expiresAt ?? null,
      updatedAt: connection?.updatedAt ?? null,
    };
  }

  upsertCodexConnection(
    userId: string,
    input: { accessToken: string; refreshToken: string; accountId?: string | null; expiresAt: string },
  ): AssistantCodexConnectionRecord {
    const existing = this.codexConnection(userId);
    const at = nowIso();
    this.db
      .query(
        `
        INSERT INTO assistant_codex_connections (
          user_id,
          access_token,
          refresh_token,
          account_id,
          expires_at,
          created_at,
          updated_at
        )
        VALUES (
          $userId,
          $accessToken,
          $refreshToken,
          $accountId,
          $expiresAt,
          $createdAt,
          $updatedAt
        )
        ON CONFLICT(user_id) DO UPDATE SET
          access_token = excluded.access_token,
          refresh_token = excluded.refresh_token,
          account_id = excluded.account_id,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `,
      )
      .run({
        $userId: userId,
        $accessToken: input.accessToken,
        $refreshToken: input.refreshToken,
        $accountId: input.accountId ?? null,
        $expiresAt: input.expiresAt,
        $createdAt: existing?.createdAt ?? at,
        $updatedAt: at,
      });
    return this.codexConnection(userId)!;
  }

  deleteCodexConnection(userId: string): boolean {
    const result = this.db.query('DELETE FROM assistant_codex_connections WHERE user_id = $userId').run({ $userId: userId });
    return Number(result.changes ?? 0) > 0;
  }

  createCodexOAuthState(
    userId: string,
    input: { state: string; codeVerifier: string; redirectUri: string; expiresAt: string },
  ): AssistantCodexOAuthStateRecord {
    const at = nowIso();
    this.db
      .query(
        `
        INSERT INTO assistant_codex_oauth_states (
          state,
          user_id,
          code_verifier,
          redirect_uri,
          created_at,
          expires_at
        )
        VALUES (
          $state,
          $userId,
          $codeVerifier,
          $redirectUri,
          $createdAt,
          $expiresAt
        )
      `,
      )
      .run({
        $state: input.state,
        $userId: userId,
        $codeVerifier: input.codeVerifier,
        $redirectUri: input.redirectUri,
        $createdAt: at,
        $expiresAt: input.expiresAt,
      });
    return this.codexOAuthState(input.state)!;
  }

  codexOAuthState(state: string): AssistantCodexOAuthStateRecord | null {
    const row = this.db.query('SELECT * FROM assistant_codex_oauth_states WHERE state = $state').get({ $state: state });
    return row ? rowAssistantCodexOAuthState(row) : null;
  }

  deleteCodexOAuthState(state: string): boolean {
    const result = this.db.query('DELETE FROM assistant_codex_oauth_states WHERE state = $state').run({ $state: state });
    return Number(result.changes ?? 0) > 0;
  }

  createThread(
    userId: string,
    input: {
      title?: string;
      source?: string;
      deviceId?: string | null;
      voiceEnabled?: boolean;
      provider?: string;
      model?: string;
      thinkingLevel?: string;
      enabledTools?: string[];
      capabilities?: AssistantThreadCapabilities;
      promptDeliveryMode?: 'queue' | 'asap';
      autoApprove?: boolean;
    },
  ): AssistantThread {
    const id = newId('thr');
    const at = nowIso();
    const settings = this.ensureAssistantSettings(userId);
    this.db
      .query(
        `
        INSERT INTO assistant_threads (
          id,
          user_id,
          device_id,
          title,
          source,
          provider,
          model,
          thinking_level,
          status,
          error,
          voice_enabled,
          auto_approve,
          system_prompt,
          enabled_tools_json,
          capabilities_json,
          prompt_delivery_mode,
          created_at,
          updated_at
        )
        VALUES (
          $id,
          $userId,
          $deviceId,
          $title,
          $source,
          $provider,
          $model,
          $thinkingLevel,
          'idle',
          NULL,
          $voiceEnabled,
          $autoApprove,
          NULL,
          $enabledToolsJson,
          $capabilitiesJson,
          $promptDeliveryMode,
          $createdAt,
          $updatedAt
        )
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $deviceId: input.deviceId ?? null,
        $title: input.title?.trim() || 'New thread',
        $source: 'voice',
        $provider: input.provider?.trim() || settings.defaultProvider,
        $model: input.model?.trim() || settings.defaultModel,
        $thinkingLevel: input.thinkingLevel?.trim() || settings.defaultThinkingLevel,
        $voiceEnabled: 1,
        $autoApprove: input.autoApprove ? 1 : 0,
        $enabledToolsJson: JSON.stringify(input.enabledTools ?? settings.defaultEnabledTools),
        $capabilitiesJson: JSON.stringify(input.capabilities ?? ASSISTANT_DEFAULT_CAPABILITIES),
        $promptDeliveryMode: input.promptDeliveryMode === 'asap' ? 'asap' : 'queue',
        $createdAt: at,
        $updatedAt: at,
      });
    const row = this.db.query('SELECT * FROM assistant_threads WHERE id = $id').get({ $id: id });
    return rowThread(row);
  }

  listThreads(userId: string): AssistantThread[] {
    return this.db
      .query('SELECT * FROM assistant_threads WHERE user_id = $userId ORDER BY updated_at DESC, created_at DESC')
      .all({ $userId: userId })
      .map(rowThread);
  }

  thread(userId: string, threadId: string): AssistantThread | null {
    const row = this.db
      .query('SELECT * FROM assistant_threads WHERE user_id = $userId AND id = $threadId')
      .get({ $userId: userId, $threadId: threadId });
    return row ? rowThread(row) : null;
  }

  deleteThread(userId: string, threadId: string): boolean {
    const result = this.db.query('DELETE FROM assistant_threads WHERE user_id = $userId AND id = $threadId').run({
      $userId: userId,
      $threadId: threadId,
    });
    return Number(result.changes ?? 0) > 0;
  }

  updateThread(
    userId: string,
    threadId: string,
    input: Partial<Pick<AssistantThread, 'title' | 'provider' | 'model' | 'thinkingLevel' | 'status' | 'error' | 'voiceEnabled' | 'autoApprove' | 'systemPrompt' | 'enabledTools' | 'capabilities' | 'promptDeliveryMode'>>,
  ): AssistantThread | null {
    const current = this.thread(userId, threadId);
    if (!current) return null;
    const at = nowIso();
    this.db
      .query(
        `
        UPDATE assistant_threads
        SET title = $title,
            provider = $provider,
            model = $model,
            thinking_level = $thinkingLevel,
            status = $status,
            error = $error,
            voice_enabled = $voiceEnabled,
            auto_approve = $autoApprove,
            system_prompt = $systemPrompt,
            enabled_tools_json = $enabledToolsJson,
            capabilities_json = $capabilitiesJson,
            prompt_delivery_mode = $promptDeliveryMode,
            updated_at = $updatedAt
        WHERE user_id = $userId AND id = $threadId
      `,
      )
      .run({
        $title: input.title ?? current.title,
        $provider: input.provider ?? current.provider,
        $model: input.model ?? current.model,
        $thinkingLevel: input.thinkingLevel ?? current.thinkingLevel,
        $status: input.status ?? current.status,
        $error: input.error === undefined ? current.error : input.error,
        $voiceEnabled: 1,
        $autoApprove: (input.autoApprove ?? current.autoApprove) ? 1 : 0,
        $systemPrompt: input.systemPrompt === undefined ? current.systemPrompt : input.systemPrompt,
        $enabledToolsJson: JSON.stringify(input.enabledTools ?? current.enabledTools),
        $capabilitiesJson: JSON.stringify(input.capabilities ?? current.capabilities),
        $promptDeliveryMode: input.promptDeliveryMode ?? current.promptDeliveryMode,
        $updatedAt: at,
        $userId: userId,
        $threadId: threadId,
      });
    return this.thread(userId, threadId);
  }

  latestVoiceThread(userId: string, sourceDeviceId: string): AssistantThread {
    return this.latestVoiceThreadOrNull(userId) ?? this.createThread(userId, { deviceId: sourceDeviceId, source: 'voice', title: 'New thread' });
  }

  latestVoiceThreadOrNull(userId: string): AssistantThread | null {
    const row = this.db
      .query(
        `
        SELECT * FROM assistant_threads
        WHERE user_id = $userId
        ORDER BY created_at DESC, updated_at DESC
        LIMIT 1
      `,
      )
      .get({ $userId: userId });
    return row ? rowThread(row) : null;
  }

  addMessage(
    userId: string,
    threadId: string,
    input: {
      role: AssistantMessageRole;
      content: string;
      contentJson?: string | null;
      toolName?: string | null;
      toolCallId?: string | null;
      isError?: boolean;
      spokenText?: string | null;
    },
  ): AssistantMessage {
    const id = newId('msg');
    const at = nowIso();
    this.db
      .query(
        `
        INSERT INTO assistant_messages (
          id,
          thread_id,
          user_id,
          role,
          content,
          content_json,
          tool_name,
          tool_call_id,
          is_error,
          spoken_text,
          created_at
        )
        VALUES (
          $id,
          $threadId,
          $userId,
          $role,
          $content,
          $contentJson,
          $toolName,
          $toolCallId,
          $isError,
          $spokenText,
          $createdAt
        )
      `,
      )
      .run({
        $id: id,
        $threadId: threadId,
        $userId: userId,
        $role: input.role,
        $content: input.content,
        $contentJson: input.contentJson ?? null,
        $toolName: input.toolName ?? null,
        $toolCallId: input.toolCallId ?? null,
        $isError: input.isError ? 1 : 0,
        $spokenText: input.spokenText ?? null,
        $createdAt: at,
      });
    this.db.query('UPDATE assistant_threads SET updated_at = $updatedAt WHERE id = $threadId').run({
      $updatedAt: at,
      $threadId: threadId,
    });
    const row = this.db.query('SELECT * FROM assistant_messages WHERE id = $id').get({ $id: id });
    return rowMessage(row);
  }

  listMessages(userId: string, threadId: string): AssistantMessage[] {
    return this.db
      .query(
        `
        SELECT * FROM assistant_messages
        WHERE user_id = $userId AND thread_id = $threadId
        ORDER BY created_at ASC
      `,
      )
      .all({ $userId: userId, $threadId: threadId })
      .map(rowMessage);
  }

  createRun(
    userId: string,
    threadId: string,
    input: { prompt: string; provider: string; model: string; thinkingLevel: string },
  ): AssistantRunRecord {
    const id = newId('run');
    const at = nowIso();
    this.db
      .query(
        `
        INSERT INTO assistant_runs (
          id,
          user_id,
          thread_id,
          status,
          provider,
          model,
          thinking_level,
          prompt,
          error,
          started_at,
          completed_at,
          cancelled_at
        )
        VALUES ($id, $userId, $threadId, 'running', $provider, $model, $thinkingLevel, $prompt, NULL, $startedAt, NULL, NULL)
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $threadId: threadId,
        $provider: input.provider,
        $model: input.model,
        $thinkingLevel: input.thinkingLevel,
        $prompt: input.prompt,
        $startedAt: at,
      });
    this.updateThread(userId, threadId, { status: 'running', error: null });
    const row = this.db.query('SELECT * FROM assistant_runs WHERE id = $id').get({ $id: id });
    return rowAssistantRun(row);
  }

  updateRun(
    userId: string,
    runId: string,
    input: Partial<Pick<AssistantRunRecord, 'status' | 'error' | 'completedAt' | 'cancelledAt'>>,
  ): AssistantRunRecord | null {
    const current = this.db.query('SELECT * FROM assistant_runs WHERE user_id = $userId AND id = $runId').get({
      $userId: userId,
      $runId: runId,
    });
    if (!current) return null;
    const currentRun = rowAssistantRun(current);
    this.db
      .query(
        `
        UPDATE assistant_runs
        SET status = $status,
            error = $error,
            completed_at = $completedAt,
            cancelled_at = $cancelledAt
        WHERE user_id = $userId AND id = $runId
      `,
      )
      .run({
        $status: input.status ?? currentRun.status,
        $error: input.error === undefined ? currentRun.error : input.error,
        $completedAt: input.completedAt === undefined ? currentRun.completedAt : input.completedAt,
        $cancelledAt: input.cancelledAt === undefined ? currentRun.cancelledAt : input.cancelledAt,
        $userId: userId,
        $runId: runId,
      });
    const row = this.db.query('SELECT * FROM assistant_runs WHERE user_id = $userId AND id = $runId').get({
      $userId: userId,
      $runId: runId,
    });
    return row ? rowAssistantRun(row) : null;
  }

  activeRun(userId: string, threadId: string): AssistantRunRecord | null {
    const row = this.db
      .query(
        `
        SELECT * FROM assistant_runs
        WHERE user_id = $userId
          AND thread_id = $threadId
          AND status IN ('running', 'waiting_for_approval')
        ORDER BY started_at DESC
        LIMIT 1
      `,
      )
      .get({ $userId: userId, $threadId: threadId });
    return row ? rowAssistantRun(row) : null;
  }

  listRuns(userId: string, threadId: string, limit = 20): AssistantRunRecord[] {
    return this.db
      .query(
        `
        SELECT * FROM assistant_runs
        WHERE user_id = $userId AND thread_id = $threadId
        ORDER BY started_at DESC
        LIMIT $limit
      `,
      )
      .all({ $userId: userId, $threadId: threadId, $limit: limit })
      .map(rowAssistantRun);
  }

  enqueuePrompt(
    userId: string,
    threadId: string,
    input: { prompt: string; provider: string; model: string; thinkingLevel: string },
  ): AssistantQueuedPromptRecord {
    const id = newId('qpr');
    const at = nowIso();
    this.db
      .query(
        `
        INSERT INTO assistant_queued_prompts (
          id,
          user_id,
          thread_id,
          prompt,
          provider,
          model,
          thinking_level,
          status,
          error,
          created_at,
          started_at,
          completed_at,
          cancelled_at
        )
        VALUES ($id, $userId, $threadId, $prompt, $provider, $model, $thinkingLevel, 'queued', NULL, $createdAt, NULL, NULL, NULL)
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $threadId: threadId,
        $prompt: input.prompt,
        $provider: input.provider,
        $model: input.model,
        $thinkingLevel: input.thinkingLevel,
        $createdAt: at,
      });
    this.db.query('UPDATE assistant_threads SET updated_at = $updatedAt WHERE user_id = $userId AND id = $threadId').run({
      $updatedAt: at,
      $userId: userId,
      $threadId: threadId,
    });
    const row = this.db.query('SELECT * FROM assistant_queued_prompts WHERE id = $id').get({ $id: id });
    return rowAssistantQueuedPrompt(row);
  }

  updateQueuedPrompt(
    userId: string,
    queuedPromptId: string,
    input: Partial<Pick<AssistantQueuedPromptRecord, 'status' | 'error' | 'startedAt' | 'completedAt' | 'cancelledAt'>>,
  ): AssistantQueuedPromptRecord | null {
    const current = this.db.query('SELECT * FROM assistant_queued_prompts WHERE user_id = $userId AND id = $id').get({
      $userId: userId,
      $id: queuedPromptId,
    });
    if (!current) return null;
    const prompt = rowAssistantQueuedPrompt(current);
    this.db
      .query(
        `
        UPDATE assistant_queued_prompts
        SET status = $status,
            error = $error,
            started_at = $startedAt,
            completed_at = $completedAt,
            cancelled_at = $cancelledAt
        WHERE user_id = $userId AND id = $id
      `,
      )
      .run({
        $status: input.status ?? prompt.status,
        $error: input.error === undefined ? prompt.error : input.error,
        $startedAt: input.startedAt === undefined ? prompt.startedAt : input.startedAt,
        $completedAt: input.completedAt === undefined ? prompt.completedAt : input.completedAt,
        $cancelledAt: input.cancelledAt === undefined ? prompt.cancelledAt : input.cancelledAt,
        $userId: userId,
        $id: queuedPromptId,
      });
    const row = this.db.query('SELECT * FROM assistant_queued_prompts WHERE user_id = $userId AND id = $id').get({
      $userId: userId,
      $id: queuedPromptId,
    });
    return row ? rowAssistantQueuedPrompt(row) : null;
  }

  cancelQueuedPrompt(userId: string, threadId: string, queuedPromptId: string): AssistantQueuedPromptRecord | null {
    const current = this.db
      .query("SELECT * FROM assistant_queued_prompts WHERE user_id = $userId AND thread_id = $threadId AND id = $id AND status = 'queued'")
      .get({ $userId: userId, $threadId: threadId, $id: queuedPromptId });
    if (!current) return null;
    return this.updateQueuedPrompt(userId, queuedPromptId, {
      status: 'cancelled',
      cancelledAt: nowIso(),
      error: 'Cancelled by user',
    });
  }

  nextQueuedPrompt(userId: string, threadId: string): AssistantQueuedPromptRecord | null {
    const row = this.db
      .query(
        `
        SELECT * FROM assistant_queued_prompts
        WHERE user_id = $userId AND thread_id = $threadId AND status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
      `,
      )
      .get({ $userId: userId, $threadId: threadId });
    return row ? rowAssistantQueuedPrompt(row) : null;
  }

  listQueuedPrompts(userId: string, threadId: string): AssistantQueuedPromptRecord[] {
    return this.db
      .query(
        `
        SELECT * FROM assistant_queued_prompts
        WHERE user_id = $userId AND thread_id = $threadId AND status = 'queued'
        ORDER BY created_at ASC
      `,
      )
      .all({ $userId: userId, $threadId: threadId })
      .map(rowAssistantQueuedPrompt);
  }

  createToolCall(
    userId: string,
    threadId: string,
    input: { runId?: string | null; toolName: string; args: unknown; approvalRequired?: boolean; status?: AssistantToolCallRecord['status'] },
  ): AssistantToolCallRecord {
    const id = newId('tool');
    const at = nowIso();
    this.db
      .query(
        `
        INSERT INTO assistant_tool_calls (
          id,
          user_id,
          thread_id,
          run_id,
          tool_name,
          status,
          args_json,
          result_json,
          approval_required,
          created_at,
          updated_at
        )
        VALUES ($id, $userId, $threadId, $runId, $toolName, $status, $argsJson, NULL, $approvalRequired, $createdAt, $updatedAt)
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $threadId: threadId,
        $runId: input.runId ?? null,
        $toolName: input.toolName,
        $status: input.status ?? (input.approvalRequired ? 'waiting_for_approval' : 'running'),
        $argsJson: JSON.stringify(input.args ?? {}),
        $approvalRequired: input.approvalRequired ? 1 : 0,
        $createdAt: at,
        $updatedAt: at,
      });
    const row = this.db.query('SELECT * FROM assistant_tool_calls WHERE id = $id').get({ $id: id });
    return rowAssistantToolCall(row);
  }

  updateToolCall(
    userId: string,
    toolCallId: string,
    input: Partial<Pick<AssistantToolCallRecord, 'status' | 'resultJson'>>,
  ): AssistantToolCallRecord | null {
    const current = this.db.query('SELECT * FROM assistant_tool_calls WHERE user_id = $userId AND id = $id').get({
      $userId: userId,
      $id: toolCallId,
    });
    if (!current) return null;
    const toolCall = rowAssistantToolCall(current);
    this.db
      .query(
        `
        UPDATE assistant_tool_calls
        SET status = $status,
            result_json = $resultJson,
            updated_at = $updatedAt
        WHERE user_id = $userId AND id = $id
      `,
      )
      .run({
        $status: input.status ?? toolCall.status,
        $resultJson: input.resultJson === undefined ? toolCall.resultJson : input.resultJson,
        $updatedAt: nowIso(),
        $userId: userId,
        $id: toolCallId,
      });
    const row = this.db.query('SELECT * FROM assistant_tool_calls WHERE user_id = $userId AND id = $id').get({
      $userId: userId,
      $id: toolCallId,
    });
    return row ? rowAssistantToolCall(row) : null;
  }

  listToolCalls(userId: string, threadId: string): AssistantToolCallRecord[] {
    return this.db
      .query(
        `
        SELECT * FROM assistant_tool_calls
        WHERE user_id = $userId AND thread_id = $threadId
        ORDER BY created_at ASC
      `,
      )
      .all({ $userId: userId, $threadId: threadId })
      .map(rowAssistantToolCall);
  }

  createApproval(
    userId: string,
    threadId: string,
    input: { runId?: string | null; toolCallId: string; toolName: string; label: string; args: unknown; requestedBy?: string },
  ): AssistantApprovalRecord {
    const id = newId('apr');
    const at = nowIso();
    this.db
      .query(
        `
        INSERT INTO assistant_approvals (
          id,
          user_id,
          thread_id,
          run_id,
          tool_call_id,
          tool_name,
          label,
          args_json,
          status,
          requested_by,
          resolved_by,
          result_json,
          failure_reason,
          created_at,
          resolved_at
        )
        VALUES ($id, $userId, $threadId, $runId, $toolCallId, $toolName, $label, $argsJson, 'pending', $requestedBy, NULL, NULL, NULL, $createdAt, NULL)
      `,
      )
      .run({
        $id: id,
        $userId: userId,
        $threadId: threadId,
        $runId: input.runId ?? null,
        $toolCallId: input.toolCallId,
        $toolName: input.toolName,
        $label: input.label,
        $argsJson: JSON.stringify(input.args ?? {}),
        $requestedBy: input.requestedBy ?? 'assistant',
        $createdAt: at,
      });
    this.updateThread(userId, threadId, { status: 'waiting_for_approval' });
    if (input.runId) this.updateRun(userId, input.runId, { status: 'waiting_for_approval' });
    const row = this.db.query('SELECT * FROM assistant_approvals WHERE id = $id').get({ $id: id });
    return rowAssistantApproval(row);
  }

  resolveApproval(
    userId: string,
    approvalId: string,
    input: { approved: boolean; resolvedBy: string; result?: unknown; failureReason?: string | null },
  ): AssistantApprovalRecord | null {
    const current = this.db.query('SELECT * FROM assistant_approvals WHERE user_id = $userId AND id = $id').get({
      $userId: userId,
      $id: approvalId,
    });
    if (!current) return null;
    const approval = rowAssistantApproval(current);
    if (approval.status !== 'pending') return approval;
    const status = input.approved ? 'approved' : 'denied';
    this.db
      .query(
        `
        UPDATE assistant_approvals
        SET status = $status,
            resolved_by = $resolvedBy,
            result_json = $resultJson,
            failure_reason = $failureReason,
            resolved_at = $resolvedAt
        WHERE user_id = $userId AND id = $id
      `,
      )
      .run({
        $status: status,
        $resolvedBy: input.resolvedBy,
        $resultJson: input.result === undefined ? null : JSON.stringify(input.result),
        $failureReason: input.failureReason ?? null,
        $resolvedAt: nowIso(),
        $userId: userId,
        $id: approvalId,
      });
    this.updateToolCall(userId, approval.toolCallId, { status: input.approved ? 'approved' : 'denied' });
    const row = this.db.query('SELECT * FROM assistant_approvals WHERE user_id = $userId AND id = $id').get({
      $userId: userId,
      $id: approvalId,
    });
    return row ? rowAssistantApproval(row) : null;
  }

  listApprovals(userId: string, threadId?: string): AssistantApprovalRecord[] {
    const rows = threadId
      ? this.db
          .query(
            `
            SELECT * FROM assistant_approvals
            WHERE user_id = $userId AND thread_id = $threadId
            ORDER BY created_at DESC
          `,
          )
          .all({ $userId: userId, $threadId: threadId })
      : this.db
          .query(
            `
            SELECT * FROM assistant_approvals
            WHERE user_id = $userId
            ORDER BY created_at DESC
          `,
          )
          .all({ $userId: userId });
    return rows.map(rowAssistantApproval);
  }

  pendingApproval(userId: string, approvalId: string): AssistantApprovalRecord | null {
    const row = this.db
      .query("SELECT * FROM assistant_approvals WHERE user_id = $userId AND id = $id AND status = 'pending'")
      .get({ $userId: userId, $id: approvalId });
    return row ? rowAssistantApproval(row) : null;
  }

  upsertArtifact(userId: string, threadId: string, input: { path: string; content: string }): AssistantArtifactRecord {
    const at = nowIso();
    const existing = this.db
      .query('SELECT * FROM assistant_artifacts WHERE user_id = $userId AND thread_id = $threadId AND path = $path')
      .get({ $userId: userId, $threadId: threadId, $path: input.path });
    const revision = newId('rev');
    const size = Buffer.byteLength(input.content, 'utf8');
    if (existing) {
      this.db
        .query(
          `
          UPDATE assistant_artifacts
          SET content = $content,
              size = $size,
              revision = $revision,
              updated_at = $updatedAt
          WHERE user_id = $userId AND thread_id = $threadId AND path = $path
        `,
        )
        .run({
          $content: input.content,
          $size: size,
          $revision: revision,
          $updatedAt: at,
          $userId: userId,
          $threadId: threadId,
          $path: input.path,
        });
    } else {
      this.db
        .query(
          `
          INSERT INTO assistant_artifacts (id, user_id, thread_id, path, content, size, revision, created_at, updated_at)
          VALUES ($id, $userId, $threadId, $path, $content, $size, $revision, $createdAt, $updatedAt)
        `,
        )
        .run({
          $id: newId('art'),
          $userId: userId,
          $threadId: threadId,
          $path: input.path,
          $content: input.content,
          $size: size,
          $revision: revision,
          $createdAt: at,
          $updatedAt: at,
        });
    }
    const row = this.db
      .query('SELECT * FROM assistant_artifacts WHERE user_id = $userId AND thread_id = $threadId AND path = $path')
      .get({ $userId: userId, $threadId: threadId, $path: input.path });
    return rowAssistantArtifact(row);
  }

  readArtifact(userId: string, threadId: string, artifactPath: string): AssistantArtifactRecord | null {
    const row = this.db
      .query('SELECT * FROM assistant_artifacts WHERE user_id = $userId AND thread_id = $threadId AND path = $path')
      .get({ $userId: userId, $threadId: threadId, $path: artifactPath });
    return row ? rowAssistantArtifact(row) : null;
  }

  listArtifacts(userId: string, threadId: string): AssistantArtifactRecord[] {
    return this.db
      .query(
        `
        SELECT * FROM assistant_artifacts
        WHERE user_id = $userId AND thread_id = $threadId
        ORDER BY updated_at DESC, path ASC
      `,
      )
      .all({ $userId: userId, $threadId: threadId })
      .map(rowAssistantArtifact);
  }

  deleteArtifact(userId: string, threadId: string, artifactPath: string): boolean {
    const result = this.db
      .query('DELETE FROM assistant_artifacts WHERE user_id = $userId AND thread_id = $threadId AND path = $path')
      .run({ $userId: userId, $threadId: threadId, $path: artifactPath });
    return result.changes > 0;
  }

  createVoiceSession(userId: string, deviceId: string, mode = 'recording'): VoiceSession {
    const thread = this.latestVoiceThread(userId, deviceId);
    const id = newId('vsn');
    const at = nowIso();
    const cleanMode = mode.trim() || 'recording';
    this.db
      .query(
        `
        INSERT INTO voice_sessions (id, user_id, device_id, assistant_thread_id, mode, started_at)
        VALUES ($id, $userId, $deviceId, $assistantThreadId, $mode, $startedAt)
      `,
      )
      .run({ $id: id, $userId: userId, $deviceId: deviceId, $assistantThreadId: thread.id, $mode: cleanMode, $startedAt: at });
    const row = this.db.query('SELECT * FROM voice_sessions WHERE id = $id').get({ $id: id });
    return rowVoiceSession(row);
  }

  voiceSession(userId: string, sessionId: string): VoiceSession | null {
    const row = this.db
      .query('SELECT * FROM voice_sessions WHERE user_id = $userId AND id = $sessionId')
      .get({ $userId: userId, $sessionId: sessionId });
    return row ? rowVoiceSession(row) : null;
  }

  voiceSessionForDevice(userId: string, deviceId: string, sessionId: string): VoiceSession | null {
    const row = this.db
      .query('SELECT * FROM voice_sessions WHERE user_id = $userId AND device_id = $deviceId AND id = $sessionId')
      .get({ $userId: userId, $deviceId: deviceId, $sessionId: sessionId });
    return row ? rowVoiceSession(row) : null;
  }

  latestVoiceSessionForDevice(userId: string, deviceId: string): VoiceSession | null {
    const row = this.db
      .query(
        `
        SELECT * FROM voice_sessions
        WHERE user_id = $userId AND device_id = $deviceId
        ORDER BY started_at DESC
        LIMIT 1
      `,
      )
      .get({ $userId: userId, $deviceId: deviceId });
    return row ? rowVoiceSession(row) : null;
  }

  addTranscript(userId: string, voiceSessionId: string, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.db
      .query(
        `
        INSERT INTO transcripts (id, voice_session_id, user_id, text, final, created_at)
        VALUES ($id, $voiceSessionId, $userId, $text, 1, $createdAt)
      `,
      )
      .run({ $id: newId('trn'), $voiceSessionId: voiceSessionId, $userId: userId, $text: trimmed, $createdAt: nowIso() });
  }

  listTranscripts(userId: string, limit = 100, options: { deviceId?: string; voiceSessionId?: string } = {}): TranscriptRecord[] {
    const filters = ['transcripts.user_id = $userId'];
    const params: { $userId: string; $limit: number; $deviceId?: string; $voiceSessionId?: string } = {
      $userId: userId,
      $limit: limit,
    };
    if (options.deviceId) {
      filters.push('voice_sessions.device_id = $deviceId');
      params.$deviceId = options.deviceId;
    }
    if (options.voiceSessionId) {
      filters.push('transcripts.voice_session_id = $voiceSessionId');
      params.$voiceSessionId = options.voiceSessionId;
    }
    return this.db
      .query(
        `
        SELECT transcripts.*,
               voice_sessions.device_id,
               voice_sessions.mode,
               voice_sessions.assistant_thread_id,
               voice_sessions.started_at AS session_started_at,
               voice_sessions.ended_at AS session_ended_at,
               devices.display_name AS device_name
        FROM transcripts
        JOIN voice_sessions ON voice_sessions.id = transcripts.voice_session_id
        LEFT JOIN devices ON devices.id = voice_sessions.device_id
        WHERE ${filters.join(' AND ')}
        ORDER BY transcripts.created_at DESC
        LIMIT $limit
      `,
      )
      .all(params)
      .map(rowTranscript);
  }

  upsertClientStatus(
    userId: string,
    deviceId: string,
    input: {
      mode: string;
      status: string;
      microphone?: string;
      protocolVersion?: number | null;
      appVersion?: string | null;
      lastError?: string | null;
      reportedAt?: string | null;
    },
  ): ClientStatusRecord {
    const at = nowIso();
    const reportedAt = input.reportedAt?.trim() || at;
    this.db
      .query(
        `
        INSERT INTO client_status (device_id, user_id, mode, status, microphone, protocol_version, app_version, last_error, reported_at, updated_at)
        VALUES ($deviceId, $userId, $mode, $status, $microphone, $protocolVersion, $appVersion, $lastError, $reportedAt, $updatedAt)
        ON CONFLICT(device_id) DO UPDATE SET
          mode = excluded.mode,
          status = excluded.status,
          microphone = excluded.microphone,
          protocol_version = excluded.protocol_version,
          app_version = excluded.app_version,
          last_error = excluded.last_error,
          reported_at = excluded.reported_at,
          updated_at = excluded.updated_at
      `,
      )
      .run({
        $deviceId: deviceId,
        $userId: userId,
        $mode: input.mode.trim() || 'off',
        $status: input.status.trim() || 'No status',
        $microphone: input.microphone?.trim() || '',
        $protocolVersion: input.protocolVersion ?? null,
        $appVersion: input.appVersion?.trim() || null,
        $lastError: input.lastError?.trim() || null,
        $reportedAt: reportedAt,
        $updatedAt: at,
      });
    const row = this.db
      .query(
        `
        SELECT client_status.*, devices.device_type, devices.display_name
        FROM client_status
        JOIN devices ON devices.id = client_status.device_id
        WHERE client_status.device_id = $deviceId
      `,
      )
      .get({ $deviceId: deviceId });
    return rowClientStatus(row);
  }

  listClientStatuses(userId?: string): ClientStatusRecord[] {
    const filters = ['devices.revoked_at IS NULL'];
    if (userId) filters.push('client_status.user_id = $userId');
    const query = `
      SELECT client_status.*, devices.device_type, devices.display_name
      FROM client_status
      JOIN devices ON devices.id = client_status.device_id
      WHERE ${filters.join(' AND ')}
      ORDER BY client_status.updated_at DESC
    `;
    const rows = userId ? this.db.query(query).all({ $userId: userId }) : this.db.query(query).all();
    return rows.map(rowClientStatus);
  }

  addApprovalCode(userId: string, input: { voiceSessionId?: string | null; code: string; source: string }): ApprovalCodeRecord {
    const id = newId('apv');
    this.db
      .query(
        `
        INSERT INTO approval_codes (id, voice_session_id, user_id, code, source, created_at)
        VALUES ($id, $voiceSessionId, $userId, $code, $source, $createdAt)
      `,
      )
      .run({
        $id: id,
        $voiceSessionId: input.voiceSessionId ?? null,
        $userId: userId,
        $code: input.code,
        $source: input.source,
        $createdAt: nowIso(),
      });
    const row = this.db.query('SELECT * FROM approval_codes WHERE id = $id').get({ $id: id });
    return rowApprovalCode(row);
  }

  listApprovalCodes(userId: string, limit = 40): ApprovalCodeRecord[] {
    return this.db
      .query('SELECT * FROM approval_codes WHERE user_id = $userId ORDER BY created_at DESC LIMIT $limit')
      .all({ $userId: userId, $limit: limit })
      .map(rowApprovalCode);
  }

  endVoiceSession(userId: string, sessionId: string): void {
    this.db
      .query('UPDATE voice_sessions SET ended_at = $endedAt WHERE user_id = $userId AND id = $sessionId AND ended_at IS NULL')
      .run({ $endedAt: nowIso(), $userId: userId, $sessionId: sessionId });
  }

  dashboard(user: UserProfile): any {
    const settings = this.ensureVoiceSettings(user.id);
    const assistantSettings = this.ensureAssistantSettings(user.id);
    const threads = this.listThreads(user.id);
    const logs = this.listLogs(user.id, 60);
    const devices = this.listDevices(user.id);
    const pairingSessions = devices
      .map((device) => this.pairingSessionForDevice(device.id))
      .filter((session): session is PairingSessionRecord => session != null);
    return {
      user,
      settings,
      assistantSettings,
      threads,
      logs,
      approvalCodes: this.listApprovalCodes(user.id, 40),
      assistantApprovals: this.listApprovals(user.id).slice(0, 80),
      devices,
      pairingSessions,
      transcripts: this.listTranscripts(user.id, 40),
      clientStatuses: this.listClientStatuses(user.id),
      adminDevices: user.admin ? this.listDevices() : [],
      adminClientStatuses: user.admin ? this.listClientStatuses() : [],
      stats: {
        threadCount: threads.length,
        deviceCount: devices.length,
        logCount: logs.length,
        transcriptCount: this.listTranscripts(user.id, 200).length,
      },
      dbPath: this.path,
    };
  }
}
