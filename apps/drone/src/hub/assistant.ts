import crypto from 'node:crypto';
import path from 'node:path';

import { loadAssistantState, saveAssistantState } from '../host/assistant-store';
import { loadRegistry } from '../host/registry';
import { hubLog, resolveEffectiveProviderApiKeySettings, type LlmProviderId } from './hub-settings';
import {
  deleteAssistantArtifactsForThread,
  listAssistantArtifactFiles,
  readAssistantArtifactFile,
  runAssistantArtifactAction,
  saveAssistantArtifactUploads,
  type AssistantArtifactActionInput,
} from './assistant-artifacts';
import {
  ASSISTANT_THREAD_MESSAGE_LIMIT,
  ASSISTANT_REGISTRY_MAX_THREADS,
  ASSISTANT_SYSTEM_PROMPT_MAX_CHARS,
  ASSISTANT_OVERVIEW_PROMPT_MAX_CHARS,
  ASSISTANT_OVERVIEW_INPUT_MAX_CHARS,
  CHAT_MESSAGE_DEFAULT_LIMIT,
  CHAT_MESSAGE_MAX_LIMIT,
  CHAT_MESSAGE_RESPONSE_MAX_BYTES,
  CHAT_IDLE_DEFAULT_TIMEOUT_MS,
  CHAT_IDLE_MAX_TIMEOUT_MS,
  CHAT_IDLE_DEFAULT_POLL_INTERVAL_MS,
  CHAT_IDLE_DEFAULT_IDLE_FOR_MS,
  CHAT_IDLE_SUBSCRIPTION_EXPIRES_AFTER_MS,
  CHAT_IDLE_MAX_SUBSCRIPTIONS,
  CHAT_IDLE_MAX_TARGETS,
  ASSISTANT_VOICE_AUTO_SPEAK_MAX_CHARS,
  DRONE_READY_DEFAULT_TIMEOUT_MS,
  DRONE_READY_POLL_INTERVAL_MS,
  ASSISTANT_BASH_DEFAULT_TIMEOUT_MS,
  ASSISTANT_BASH_MAX_TIMEOUT_MS,
  ASSISTANT_SEARCH_MAX_CONTEXT_LINES,
  ASSISTANT_CHANGED_FILES_LIMIT,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_CODEX_MODEL,
  DEFAULT_THREAD_TITLE,
  ASSISTANT_SYSTEM_PROMPT_RUNTIME_APPENDIX,
  ASSISTANT_CHAT_IDLE_PROMPT_LINE_LEGACY,
  ASSISTANT_CHAT_IDLE_PROMPT_LINE,
  ASSISTANT_SYSTEM_PROMPT_DEFAULT,
  ASSISTANT_TOOL_SUMMARIES,
  ASSISTANT_ALL_TOOL_NAMES,
  ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_DEFAULT_TOOL_MIGRATION_NAMES,
  ASSISTANT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_PRE_FETCH_CONTENT_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_PRE_FETCH_CONTENT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_PRE_FETCH_CONTENT_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_PRE_WEB_SEARCH_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_PRE_WEB_SEARCH_LEGACY_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_PRE_WEB_SEARCH_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_VOICE_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_PRE_FETCH_CONTENT_VOICE_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_PRE_FETCH_CONTENT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_PRE_FETCH_CONTENT_PRE_CHAT_IDLE_SPLIT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_PRE_WEB_SEARCH_VOICE_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_PRE_WEB_SEARCH_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_PRE_WEB_SEARCH_PRE_CHAT_IDLE_SPLIT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_OVERVIEW_PROMPT_DEFAULT,
  ASSISTANT_MODEL_OPTIONS,
} from './assistant/assistant-config';
import { generateAssistantOverview } from './assistant/assistant-overview-generator';
import {
  formatAssistantReadFileToolText,
  type AssistantApplyPatchResult,
  type AssistantDroneBashResult,
  type AssistantDroneFileListResult,
  type AssistantDroneFileMutationResult,
  type AssistantDroneFileReadResult,
  type AssistantDroneFileSearchResult,
  type AssistantDroneFileWriteResult,
  type AssistantDronePathStatResult,
  type AssistantPatchStagedFile,
  type AssistantToolCallbacks,
} from './assistant/assistant-workspace-contracts';
import type {
  AssistantChangeEvent,
  AssistantChatIdleStatus,
  AssistantChatIdleTarget,
  AssistantChatIdleWaitMode,
  AssistantChatIdleWaitResult,
  AssistantCreateChatResult,
  AssistantCreateDroneResult,
  AssistantCreateGroupResult,
  AssistantDroneSummary,
  AssistantMessageDroneResult,
  AssistantModelOption,
  AssistantOverviewPromptSettings,
  AssistantRealtimeFunctionTool,
  AssistantRealtimeMessageRole,
  AssistantRealtimeSessionConfig,
  AssistantRealtimeToolExecutionResult,
  AssistantRenameDronesResult,
  AssistantReorderDronesResult,
  AssistantSetDroneGroupResult,
  AssistantSetDroneGroupsResult,
  AssistantSnapshotMode,
  AssistantSystemPromptSettings,
  AssistantThinkingLevel,
  AssistantThreadOverviewResult,
  AssistantThreadSystemPromptSettings,
  AssistantToolSummary,
  AssistantUiAction,
  AssistantVoiceSource,
} from './assistant/assistant-contracts';
export type {
  AssistantChangeEvent,
  AssistantChatIdleStatus,
  AssistantChatIdleTarget,
  AssistantChatIdleWaitResult,
  AssistantCreateChatResult,
  AssistantCreateDroneResult,
  AssistantCreateGroupResult,
  AssistantDroneSummary,
  AssistantMessageDroneResult,
  AssistantModelOption,
  AssistantOverviewPromptSettings,
  AssistantRealtimeFunctionTool,
  AssistantRealtimeMessageRole,
  AssistantRealtimeSessionConfig,
  AssistantRealtimeToolExecutionResult,
  AssistantRenameDronesResult,
  AssistantReorderDronesResult,
  AssistantSetDroneGroupResult,
  AssistantSetDroneGroupsResult,
  AssistantSnapshotMode,
  AssistantSystemPromptSettings,
  AssistantThinkingLevel,
  AssistantThreadOverviewResult,
  AssistantThreadSystemPromptSettings,
  AssistantToolSummary,
  AssistantUiAction,
  AssistantVoiceSource,
} from './assistant/assistant-contracts';

type AssistantThreadStatus = 'idle' | 'running' | 'waiting_for_approval' | 'waiting_for_chats_idle' | 'error';
type AssistantThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  voiceEnabled: boolean;
  voiceEnabledAt: string | null;
  model: string;
  provider: LlmProviderId;
  thinkingLevel: AssistantThinkingLevel;
  systemPrompt: string;
  systemPromptUpdatedAt: string | null;
  enabledTools: string[];
  accessScope: AssistantAccessScope;
  autoApprove: boolean;
  promptDeliveryMode: AssistantPromptDeliveryMode;
  messageCount?: number;
  messages: any[];
  status: AssistantThreadStatus;
  error: string | null;
};

type AssistantPromptDeliveryMode = 'queue' | 'asap';

type AssistantChatIdleSubscriptionStatus = 'active' | 'fired' | 'cancelled' | 'expired';
export type AssistantChatIdleSubscription = {
  id: string;
  threadId: string;
  toolCallId: string | null;
  voiceSource: AssistantVoiceSource | null;
  mode: AssistantChatIdleWaitMode;
  targets: AssistantChatIdleTarget[];
  createdAt: string;
  expiresAt: string;
  idleForMs: number;
  status: AssistantChatIdleSubscriptionStatus;
  idleSince: string | null;
  firedAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
  lastResult: AssistantChatIdleWaitResult | null;
};

type AssistantRunModel = {
  provider: LlmProviderId;
  model: string;
  thinkingLevel: AssistantThinkingLevel;
  promptId: string;
  voiceSource?: AssistantVoiceSource | null;
  startedAt: string;
};

type AssistantDefaultModel = {
  provider: LlmProviderId;
  model: string;
};

type AssistantApproval = {
  id: string;
  threadId: string;
  toolCallId: string;
  toolName: string;
  label: string;
  args: any;
  createdAt: string;
  status: 'pending' | 'approved' | 'denied';
};

type StoredAssistantState = {
  activeThreadId?: string | null;
  defaultModel?: { provider?: string; model?: string };
  threads?: AssistantThread[];
  chatIdleSubscriptions?: AssistantChatIdleSubscription[];
  webSearchToolMigrationApplied?: boolean;
  fetchContentToolMigrationApplied?: boolean;
  systemPrompt?: string;
  systemPromptUpdatedAt?: string;
  voiceSystemPrompt?: string;
  voiceSystemPromptUpdatedAt?: string;
  overviewPrompt?: string;
  overviewPromptUpdatedAt?: string;
  updatedAt?: string;
};

type AssistantThreadOverviewCacheEntry = {
  inputText: string;
  inputFingerprint: string;
  promptFingerprint: string;
  markdown: string;
  generatedAt: string;
  provider: LlmProviderId;
  model: string;
};

type AssistantRuntime = {
  getModel: (provider: string, model: string) => any;
};

type AssistantPromptEvent =
  | { type: 'snapshot'; snapshot: AssistantSnapshot }
  | { type: 'agent_event'; threadId: string; event: any }
  | { type: 'approval_pending'; approval: AssistantApproval; snapshot: AssistantSnapshot }
  | { type: 'error'; threadId?: string; error: string };

type AssistantAppContext = {
  activeDroneId: string | null;
  activeDroneName: string | null;
  activeChatName: string | null;
  appView: string | null;
  updatedAt: string;
};

type AssistantAccessScope = {
  readMode: 'all' | 'selected';
  writeMode: 'all' | 'selected';
  droneIds: string[];
  updatedAt: string;
};

type ChatTimelineMessage = {
  id: string;
  role: 'user' | 'agent';
  status: 'queued' | 'sending' | 'sent' | 'completed' | 'failed';
  text: string;
  at: string;
  updatedAt?: string;
  completedAt?: string;
  error?: string;
  droneId: string;
  chatName: string;
  turnId?: string;
  userMessageId?: string;
};

type ChatMessagePage = {
  droneId: string;
  chatName: string;
  messages: ChatTimelineMessage[];
  total: number;
  limit: number;
  pageStart: number;
  pageEnd: number;
  olderCursor: string | null;
  newerCursor: string | null;
};

export type AssistantSnapshot = {
  ok: true;
  activeThreadId: string;
  threads: AssistantThread[];
  chatIdleSubscriptions: AssistantChatIdleSubscription[];
  pendingApprovals: AssistantApproval[];
  models: AssistantModelOption[];
  availableTools: AssistantToolSummary[];
  accessScope: AssistantAccessScope;
  runningModels: Record<string, AssistantRunModel>;
  streamingMessage?: any;
  streamingMessages?: any[];
};

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

function nowIso(): string {
  return new Date().toISOString();
}

function makeAssistantId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeProvider(raw: unknown): LlmProviderId {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'gemini') return 'gemini';
  if (value === 'codex' || value === 'openai-codex' || value === 'chatgpt-codex') return 'codex';
  return 'openai';
}

function providerToPiProvider(provider: LlmProviderId): 'openai' | 'google' | 'openai-codex' {
  if (provider === 'codex') return 'openai-codex';
  return provider === 'gemini' ? 'google' : 'openai';
}

async function defaultAssistantProvider(): Promise<LlmProviderId> {
  const codex = await resolveEffectiveProviderApiKeySettings('codex');
  return codex.apiKey ? 'codex' : 'openai';
}

function defaultModelForProvider(provider: LlmProviderId): string {
  if (provider === 'codex') return DEFAULT_CODEX_MODEL;
  return provider === 'gemini' ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL;
}

function allowedModelForProvider(provider: LlmProviderId, raw: unknown): string {
  const model = String(raw ?? '').trim();
  return ASSISTANT_MODEL_OPTIONS.some((option) => option.provider === provider && option.id === model)
    ? model
    : defaultModelForProvider(provider);
}

function allowedThinkingLevelForModel(provider: LlmProviderId, model: string, raw: unknown): AssistantThinkingLevel {
  const requested = normalizeThinkingLevel(raw);
  if (ASSISTANT_MODEL_OPTIONS.some((option) => option.provider === provider && option.id === model && option.thinkingLevel === requested)) {
    return requested;
  }
  return ASSISTANT_MODEL_OPTIONS.find((option) => option.provider === provider && option.id === model)?.thinkingLevel ?? 'off';
}

function supportedThinkingLevelsForModel(provider: LlmProviderId, model: string): AssistantThinkingLevel[] {
  const seen = new Set<AssistantThinkingLevel>();
  const levels: AssistantThinkingLevel[] = [];
  for (const option of ASSISTANT_MODEL_OPTIONS) {
    if (option.provider !== provider || option.id !== model || seen.has(option.thinkingLevel)) continue;
    seen.add(option.thinkingLevel);
    levels.push(option.thinkingLevel);
  }
  return levels.length > 0 ? levels : ['off'];
}

function normalizeThinkingLevel(raw: unknown): AssistantThinkingLevel {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'instant' || value === 'none') return 'off';
  if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value;
  return 'off';
}

function parseThinkingLevelForTool(raw: unknown): AssistantThinkingLevel {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) throw new Error('missing thinking level');
  if (value === 'instant' || value === 'none') return 'off';
  if (value === 'off' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value;
  throw new Error(`invalid thinking level: ${String(raw ?? '')}`);
}

function normalizeAssistantPromptDeliveryMode(raw: unknown): AssistantPromptDeliveryMode {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'asap' || value === 'steer' || value === 'steering' ? 'asap' : 'queue';
}

function normalizeAssistantAutoApprove(raw: unknown): boolean {
  return raw === true || raw === 1 || String(raw ?? '').trim().toLowerCase() === 'true' || String(raw ?? '').trim() === '1';
}

function makeAssistantUserMessage(prompt: string, images: Array<{ data: string; mimeType: string }> = []): any {
  const content: any[] = [{ type: 'text', text: prompt }];
  for (const image of images) {
    if (!image.data || !image.mimeType) continue;
    content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
  }
  return {
    role: 'user',
    content,
    timestamp: Date.now(),
  };
}

function makeAssistantTextMessage(role: AssistantRealtimeMessageRole, text: string): any {
  return {
    role,
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  };
}

function makeAssistantToolCallMessage(toolCallId: string, toolName: string, args: unknown): any {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id: toolCallId, name: toolName, arguments: sanitizeMessage(args) }],
    timestamp: Date.now(),
  };
}

function assistantToolResultContentBlocks(result: unknown, error?: unknown): any[] {
  const errorText = cleanOptionalString(error);
  if (errorText) return [{ type: 'text', text: errorText }];
  const rawContent = result && typeof result === 'object' && Array.isArray((result as any).content)
    ? (result as any).content
    : [];
  const content = rawContent.flatMap((part: any) => {
    if (!part || typeof part !== 'object') return [];
    if (part.type === 'text') {
      const text = cleanOptionalString(part.text);
      return text ? [{ type: 'text', text }] : [];
    }
    if (part.type === 'image') {
      const data = cleanOptionalString(part.data);
      const mimeType = cleanOptionalString(part.mimeType);
      if (!data || !mimeType) return [];
      return [{
        type: 'image',
        data,
        mimeType,
        ...(part.annotations && typeof part.annotations === 'object' ? { annotations: sanitizeMessage(part.annotations) } : {}),
        ...(part._meta && typeof part._meta === 'object' ? { _meta: sanitizeMessage(part._meta) } : {}),
      }];
    }
    return [];
  });
  return content.length > 0 ? content : [{ type: 'text', text: assistantRealtimeToolOutput(result) }];
}

function makeAssistantToolResultMessage(toolCallId: string, toolName: string, result: unknown, error?: unknown): any {
  const errorText = cleanOptionalString(error);
  return {
    role: 'toolResult',
    content: assistantToolResultContentBlocks(result, errorText),
    toolName,
    toolCallId,
    ...(errorText ? { isError: true, errorMessage: errorText } : {}),
    timestamp: Date.now(),
  };
}

function titleFromPrompt(prompt: string): string {
  const cleaned = String(prompt ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return DEFAULT_THREAD_TITLE;
  return cleaned.length > 48 ? `${cleaned.slice(0, 48).trimEnd()}...` : cleaned;
}

function textFromMessage(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part?.type === 'text' ? String(part.text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

function clampChatMessageLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return CHAT_MESSAGE_DEFAULT_LIMIT;
  return Math.min(CHAT_MESSAGE_MAX_LIMIT, Math.max(1, Math.floor(n)));
}

function clampAssistantBashTimeout(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return ASSISTANT_BASH_DEFAULT_TIMEOUT_MS;
  return Math.min(ASSISTANT_BASH_MAX_TIMEOUT_MS, Math.max(1000, Math.floor(n)));
}

function normalizeOptionalPositiveLine(raw: unknown, label: string): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${label} must be a positive integer`);
  return n;
}

function normalizeSearchContextLines(raw: unknown, label: string): number {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a non-negative integer`);
  return Math.min(ASSISTANT_SEARCH_MAX_CONTEXT_LINES, n);
}

function normalizeWebSearchRecencyFilter(raw: unknown): 'day' | 'week' | 'month' | 'year' | undefined {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'day' || value === 'week' || value === 'month' || value === 'year' ? value : undefined;
}

function normalizeFetchContentLivecrawl(raw: unknown): 'never' | 'fallback' | 'preferred' | 'always' | undefined {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'never' || value === 'fallback' || value === 'preferred' || value === 'always' ? value : undefined;
}

function normalizeChatNameForAssistant(raw: unknown): string {
  const value = String(raw ?? '').trim();
  return value || 'default';
}

function safeMessageAt(raw: unknown, fallback: string): string {
  const value = String(raw ?? '').trim();
  return value || fallback;
}

function messageResponseSizeBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function ensureMessageResponseFits(value: unknown): void {
  const bytes = messageResponseSizeBytes(value);
  if (bytes > CHAT_MESSAGE_RESPONSE_MAX_BYTES) {
    throw new Error(`message page too large (${bytes} bytes); retry with a smaller limit`);
  }
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (timeout) clearTimeout(timeout);
      reject(abortError());
    };
    timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function droneEntryInAssistantCollection(collection: any, droneIdRaw: unknown): { id: string; key: string; drone: any } | null {
  const droneId = String(droneIdRaw ?? '').trim();
  const drones = collection && typeof collection === 'object' ? collection : {};
  const direct = drones[droneId];
  if (direct) return { id: String((direct as any)?.id ?? droneId).trim() || droneId, key: droneId, drone: direct };
  for (const [id, drone] of Object.entries(drones) as any[]) {
    const stableId = String((drone as any)?.id ?? id).trim();
    const name = String((drone as any)?.name ?? '').trim();
    if (stableId === droneId || name === droneId) return { id: stableId || id, key: id, drone };
  }
  return null;
}

function droneEntryByAssistantId(regAny: any, droneIdRaw: unknown): { id: string; drone: any } {
  for (const collection of [regAny?.drones, regAny?.pending]) {
    const found = droneEntryInAssistantCollection(collection, droneIdRaw);
    if (found) return { id: found.id, drone: found.drone };
  }
  throw new Error(`unknown drone: ${String(droneIdRaw ?? '').trim()}`);
}

function realDroneEntryByAssistantId(regAny: any, droneIdRaw: unknown): { id: string; drone: any } | null {
  const found = droneEntryInAssistantCollection(regAny?.drones, droneIdRaw);
  return found ? { id: found.id, drone: found.drone } : null;
}

function droneIdByAssistantRef(regAny: any, droneIdRaw: unknown): string {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) throw new Error('missing drone id');
  for (const collection of [regAny?.drones, regAny?.pending]) {
    const drones = collection && typeof collection === 'object' ? collection : {};
    const direct = drones[droneId];
    if (direct) return String((direct as any)?.id ?? droneId).trim() || droneId;
    for (const [id, drone] of Object.entries(drones) as any[]) {
      const stableId = String((drone as any)?.id ?? id).trim();
      const name = String((drone as any)?.name ?? '').trim();
      if (stableId === droneId || name === droneId) return stableId || id;
    }
  }
  throw new Error(`unknown drone: ${droneId}`);
}

function normalizeAssistantRuntime(raw: unknown, fallbackRaw: unknown): 'container' | 'host' {
  const value = String(raw ?? fallbackRaw ?? '').trim().toLowerCase();
  return value === 'host' ? 'host' : 'container';
}

function cleanOptionalString(raw: unknown): string {
  return String(raw ?? '').trim();
}

function normalizeAssistantRenameRequests(raw: unknown): Array<{ droneId: string; newName: string }> {
  const input = raw && typeof raw === 'object' ? raw as any : {};
  const rawRenames = Array.isArray(input.renames) ? input.renames : [];
  const fallbackDrone = cleanOptionalString(input.droneId ?? input.drone ?? input.id);
  const fallbackNewName = cleanOptionalString(input.newName ?? input.nextName ?? input.name);
  const source = rawRenames.length > 0
    ? rawRenames
    : fallbackDrone && fallbackNewName
      ? [{ droneId: fallbackDrone, newName: fallbackNewName }]
      : [];
  const seen = new Set<string>();
  const result: Array<{ droneId: string; newName: string }> = [];
  for (const item of source) {
    const entry = item && typeof item === 'object' ? item as any : {};
    const explicitDrone = cleanOptionalString(entry.droneId ?? entry.drone ?? entry.id);
    const explicitNewName = cleanOptionalString(entry.newName ?? entry.nextName);
    const name = cleanOptionalString(entry.name);
    const droneId = explicitDrone || (explicitNewName ? name : '');
    const newName = explicitNewName || (explicitDrone ? name : '');
    if (!droneId || !newName || seen.has(droneId)) continue;
    seen.add(droneId);
    result.push({ droneId, newName });
  }
  if (result.length === 0) throw new Error('missing drone rename requests');
  return result;
}

function normalizeAssistantGroupValue(raw: unknown): string | null {
  const group = cleanOptionalString(raw);
  return group && group.toLowerCase() !== 'ungrouped' ? group : null;
}

function hasAssistantGroupValue(raw: unknown): boolean {
  return typeof raw === 'string';
}

function normalizeAssistantSetDroneGroupAssignments(raw: unknown): Array<{ droneRefs: string[]; group: string | null }> {
  const input = raw && typeof raw === 'object' ? raw as any : {};
  const rawAssignments = Array.isArray(input.assignments) ? input.assignments : [];
  const source =
    rawAssignments.length > 0
      ? rawAssignments
      : Array.isArray(input.droneIds) || Array.isArray(input.drones) || cleanOptionalString(input.droneId ?? input.drone ?? input.id)
        ? [{ droneIds: input.droneIds ?? input.drones, droneId: input.droneId ?? input.drone ?? input.id, group: input.group }]
        : [];
  const result: Array<{ droneRefs: string[]; group: string | null }> = [];
  for (const item of source) {
    const entry = item && typeof item === 'object' ? item as any : {};
    const rawRefs = Array.isArray(entry.droneIds)
      ? entry.droneIds
      : Array.isArray(entry.drones)
        ? entry.drones
        : [];
    const fallbackRef = cleanOptionalString(entry.droneId ?? entry.drone ?? entry.id);
    const droneRefs = Array.from(
      new Set([...rawRefs.map((ref: any) => cleanOptionalString(ref)), fallbackRef].filter(Boolean)),
    );
    if (droneRefs.length === 0) continue;
    const clearGroup = entry.clearGroup === true || String(entry.clearGroup ?? '').trim() === '1';
    if (!clearGroup && !hasAssistantGroupValue(entry.group)) throw new Error('group is required unless clearGroup is true');
    result.push({ droneRefs, group: clearGroup ? null : normalizeAssistantGroupValue(entry.group) });
  }
  if (result.length === 0) throw new Error('missing drone group assignments');
  return result;
}

function normalizeAssistantDroneFilePath(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error('missing file path');
  if (value.includes('\0') || value.includes('\r') || value.includes('\n')) throw new Error(`invalid file path: ${value}`);
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (!normalized || normalized === '.') throw new Error('missing file path');
  const withoutLeading = normalized.replace(/^\/+/, '');
  if (withoutLeading === '..' || withoutLeading.startsWith('../')) throw new Error(`invalid file path: ${value}`);
  return value.startsWith('/') ? `/${withoutLeading}` : withoutLeading;
}

function replaceTextOnce(content: string, oldText: string, newText: string, filePath: string): string {
  if (!oldText) throw new Error(`empty patch hunk for ${filePath}`);
  const first = content.indexOf(oldText);
  if (first < 0) throw new Error(`patch context not found in ${filePath}`);
  const second = content.indexOf(oldText, first + oldText.length);
  if (second >= 0) throw new Error(`patch context is ambiguous in ${filePath}`);
  return `${content.slice(0, first)}${newText}${content.slice(first + oldText.length)}`;
}

function normalizeAssistantSystemPrompt(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return '';
  return text.length > ASSISTANT_SYSTEM_PROMPT_MAX_CHARS
    ? text.slice(0, ASSISTANT_SYSTEM_PROMPT_MAX_CHARS).trim()
    : text;
}

function migrateAssistantSystemPrompt(raw: unknown): string {
  const prompt = normalizeAssistantSystemPrompt(raw);
  if (!prompt.includes(ASSISTANT_CHAT_IDLE_PROMPT_LINE_LEGACY)) return prompt;
  return normalizeAssistantSystemPrompt(prompt.replace(ASSISTANT_CHAT_IDLE_PROMPT_LINE_LEGACY, ASSISTANT_CHAT_IDLE_PROMPT_LINE));
}

function normalizeAssistantOverviewPrompt(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return '';
  return text.length > ASSISTANT_OVERVIEW_PROMPT_MAX_CHARS
    ? text.slice(0, ASSISTANT_OVERVIEW_PROMPT_MAX_CHARS).trim()
    : text;
}

function normalizeAssistantEnabledTools(raw: unknown, fallback: string[] = ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const allowed = new Set(ASSISTANT_ALL_TOOL_NAMES);
  const seen = new Set<string>();
  const tools: string[] = [];
  for (const item of raw) {
    const rawName = String(item ?? '').trim();
    const names =
      rawName === 'subscribe_to_chats_idle'
        ? ['subscribe_to_all_chats_idle']
        : [rawName];
    for (const name of names) {
      if (!allowed.has(name) || seen.has(name)) continue;
      seen.add(name);
      tools.push(name);
    }
  }
  return tools;
}

function normalizeAssistantChatIdleWaitMode(raw: unknown, fallback: AssistantChatIdleWaitMode = 'all'): AssistantChatIdleWaitMode {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'any') return 'any';
  if (value === 'all') return 'all';
  return fallback;
}

function chatIdleStatusesMatchMode(statuses: AssistantChatIdleStatus[], mode: AssistantChatIdleWaitMode): boolean {
  return mode === 'any' ? statuses.some((status) => status.idle) : statuses.every((status) => status.idle);
}

function chatIdleModeLabel(mode: AssistantChatIdleWaitMode): string {
  return mode === 'any' ? 'any subscribed chat is idle' : 'all subscribed chats are idle';
}

function chatIdleModeActionText(mode: AssistantChatIdleWaitMode): string {
  return mode === 'any' ? 'any chat becoming idle' : 'all chats becoming idle';
}

function makeSubscribeToChatsIdleParameters(Type: any) {
  return Type.Object({
    targets: Type.Array(
      Type.Object({
        droneId: Type.String({ description: 'Drone id or visible name.' }),
        chatName: Type.Optional(Type.String({ description: 'Chat name. Defaults to default.' })),
      }),
      { minItems: 1, maxItems: CHAT_IDLE_MAX_TARGETS },
    ),
    idleForMs: Type.Optional(Type.Number({ description: `Require the idle condition to remain true for this long before returning. Defaults to ${CHAT_IDLE_DEFAULT_IDLE_FOR_MS}.` })),
  });
}

function appendUniqueEnabledTool(tools: string[], name: string): void {
  if (!tools.includes(name)) tools.push(name);
}

function sameToolSet(rawNames: Set<string>, names: string[]): boolean {
  return rawNames.size === names.length && names.every((name) => rawNames.has(name));
}

function sameToolSetWithout(rawNames: Set<string>, names: string[], omittedName: string): boolean {
  return sameToolSet(rawNames, names.filter((name) => name !== omittedName));
}

function normalizeStoredAssistantEnabledTools(
  raw: unknown,
  voiceEnabled: boolean,
  migrations: { webSearchDefaultTool: boolean; fetchContentDefaultTool: boolean },
): string[] {
  const base = normalizeAssistantEnabledTools(raw);
  const rawNames = new Set(Array.isArray(raw) ? raw.map((name) => String(name ?? '').trim()).filter(Boolean) : []);
  const rawNamesForDefaultComparison = new Set(rawNames);
  for (const name of ASSISTANT_DEFAULT_TOOL_MIGRATION_NAMES) {
    if (!rawNamesForDefaultComparison.has(name)) rawNamesForDefaultComparison.add(name);
  }
  const hadLegacyDefaultTools =
    rawNames.size > 0 && (
      ASSISTANT_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES.every((name) => rawNamesForDefaultComparison.has(name))
      || ASSISTANT_PRE_FETCH_CONTENT_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES.every((name) => rawNamesForDefaultComparison.has(name))
      || ASSISTANT_PRE_WEB_SEARCH_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES.every((name) => rawNamesForDefaultComparison.has(name))
    );
  if (hadLegacyDefaultTools) {
    appendUniqueEnabledTool(base, 'create_chat');
    appendUniqueEnabledTool(base, 'subscribe_to_any_chat_idle');
    appendUniqueEnabledTool(base, 'subscribe_to_all_chats_idle');
  }
  const hadPreWebSearchDefaultTools = migrations.webSearchDefaultTool && (
    sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_LEGACY_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES)
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_PRE_CHAT_IDLE_SPLIT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
  );
  if (hadPreWebSearchDefaultTools) {
    appendUniqueEnabledTool(base, 'web_search');
  }
  const hadPreFetchContentDefaultTools = migrations.fetchContentDefaultTool && (
    sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_FETCH_CONTENT_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_FETCH_CONTENT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_FETCH_CONTENT_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_LEGACY_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES)
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_FETCH_CONTENT_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_FETCH_CONTENT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_FETCH_CONTENT_PRE_CHAT_IDLE_SPLIT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_PRE_CHAT_IDLE_SPLIT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
  );
  if (hadPreFetchContentDefaultTools) {
    appendUniqueEnabledTool(base, 'fetch_content');
  }
  const missingDefaultMigrationTools = ASSISTANT_DEFAULT_TOOL_MIGRATION_NAMES.filter((name) => !rawNames.has(name));
  const hadPreCurrentDefaultTools = missingDefaultMigrationTools.length > 0 && (
    sameToolSet(rawNamesForDefaultComparison, ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_FETCH_CONTENT_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_FETCH_CONTENT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_FETCH_CONTENT_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_LEGACY_DEFAULT_ENABLED_TOOL_NAMES)
    || sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES)
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_FETCH_CONTENT_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_FETCH_CONTENT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_FETCH_CONTENT_PRE_CHAT_IDLE_SPLIT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
    || (voiceEnabled && sameToolSet(rawNamesForDefaultComparison, ASSISTANT_PRE_WEB_SEARCH_PRE_CHAT_IDLE_SPLIT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES))
  );
  if (hadPreCurrentDefaultTools) {
    for (const name of missingDefaultMigrationTools) appendUniqueEnabledTool(base, name);
  }
  const hadPreRenameDefaultTools = !rawNames.has('rename_drones') && (
    sameToolSetWithout(rawNames, ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones')
    || sameToolSetWithout(rawNames, ASSISTANT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones')
    || sameToolSetWithout(rawNames, ASSISTANT_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones')
    || sameToolSetWithout(rawNames, ASSISTANT_PRE_FETCH_CONTENT_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones')
    || sameToolSetWithout(rawNames, ASSISTANT_PRE_FETCH_CONTENT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones')
    || sameToolSetWithout(rawNames, ASSISTANT_PRE_FETCH_CONTENT_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones')
    || sameToolSetWithout(rawNames, ASSISTANT_PRE_WEB_SEARCH_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones')
    || sameToolSetWithout(rawNames, ASSISTANT_PRE_WEB_SEARCH_LEGACY_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones')
    || sameToolSetWithout(rawNames, ASSISTANT_PRE_WEB_SEARCH_PRE_CHAT_IDLE_SPLIT_LEGACY_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones')
    || (voiceEnabled && sameToolSetWithout(rawNames, ASSISTANT_VOICE_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones'))
    || (voiceEnabled && sameToolSetWithout(rawNames, ASSISTANT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones'))
    || (voiceEnabled && sameToolSetWithout(rawNames, ASSISTANT_PRE_FETCH_CONTENT_VOICE_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones'))
    || (voiceEnabled && sameToolSetWithout(rawNames, ASSISTANT_PRE_FETCH_CONTENT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones'))
    || (voiceEnabled && sameToolSetWithout(rawNames, ASSISTANT_PRE_FETCH_CONTENT_PRE_CHAT_IDLE_SPLIT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones'))
    || (voiceEnabled && sameToolSetWithout(rawNames, ASSISTANT_PRE_WEB_SEARCH_VOICE_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones'))
    || (voiceEnabled && sameToolSetWithout(rawNames, ASSISTANT_PRE_WEB_SEARCH_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones'))
    || (voiceEnabled && sameToolSetWithout(rawNames, ASSISTANT_PRE_WEB_SEARCH_PRE_CHAT_IDLE_SPLIT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES, 'rename_drones'))
  );
  if (hadPreRenameDefaultTools) {
    appendUniqueEnabledTool(base, 'rename_drones');
  }
  const hadLegacyVoiceDefaultTools =
    voiceEnabled && rawNames.size > 0 && ASSISTANT_LEGACY_VOICE_DEFAULT_ENABLED_TOOL_NAMES.every((name) => rawNamesForDefaultComparison.has(name));
  if (hadLegacyVoiceDefaultTools) {
    appendUniqueEnabledTool(base, 'create_new_thread');
  }
  return enabledToolsForVoiceMode(base, voiceEnabled);
}

function normalizeAssistantSystemPromptKind(raw: unknown): 'normal' | 'voice' {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'voice' ? 'voice' : 'normal';
}

function normalizeAssistantVoiceEnabled(raw: unknown): boolean {
  return raw === true || String(raw ?? '').trim() === 'true';
}

function normalizeAssistantVoiceSource(raw: unknown): AssistantVoiceSource | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'android' || value === 'desktop' ? value : null;
}

function enabledToolsForVoiceMode(enabledTools: string[], voiceEnabled: boolean): string[] {
  const base = normalizeAssistantEnabledTools(enabledTools);
  if (!voiceEnabled) return base.filter((name) => name !== 'speak');
  return normalizeAssistantEnabledTools([...base, 'speak'], ASSISTANT_VOICE_DEFAULT_ENABLED_TOOL_NAMES);
}

function normalizeAssistantSystemPromptPatches(raw: unknown): Array<{ oldText: string; newText: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).map((item, index) => {
    const oldText = typeof item?.oldText === 'string' ? item.oldText : '';
    const newText = typeof item?.newText === 'string' ? item.newText : '';
    if (!oldText) throw new Error(`system prompt patch ${index + 1} missing oldText`);
    return { oldText, newText };
  });
}

function applyAssistantSystemPromptPatches(prompt: string, rawPatches: unknown): string {
  const patches = normalizeAssistantSystemPromptPatches(rawPatches);
  if (patches.length === 0) throw new Error('missing system prompt patch');
  let next = prompt;
  for (const patch of patches) {
    next = replaceTextOnce(next, patch.oldText, patch.newText, 'thread system prompt');
  }
  return normalizeAssistantSystemPrompt(next);
}

function assistantTextFingerprint(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function clipAssistantOverviewText(raw: unknown, maxChars: number): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}...` : text;
}

function assistantOverviewContentText(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return clipAssistantOverviewText(content, 5000);
  if (!Array.isArray(content)) return '';
  return content
    .map((part: any) => {
      if (!part || typeof part !== 'object') return '';
      if (part.type === 'text') return clipAssistantOverviewText(part.text, 5000);
      if (part.type === 'thinking') return `[thinking] ${clipAssistantOverviewText(part.thinking ?? part.text, 1200)}`;
      if (part.type === 'toolCall') {
        const name = cleanOptionalString(part.name) || 'tool';
        const id = cleanOptionalString(part.id);
        const args = clipAssistantOverviewText(JSON.stringify(part.arguments ?? {}, null, 2), 2400);
        return [`[tool call] ${name}${id ? ` (${id})` : ''}`, args].filter(Boolean).join('\n');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function assistantOverviewMessageText(message: any, index: number): string {
  const role = cleanOptionalString(message?.role) || 'message';
  const at = typeof message?.timestamp === 'number' ? new Date(message.timestamp).toISOString() : cleanOptionalString(message?.at);
  const toolName = cleanOptionalString(message?.toolName);
  const toolCallId = cleanOptionalString(message?.toolCallId);
  const isError = message?.isError ? 'yes' : 'no';
  const body = assistantOverviewContentText(message) || '(no text content)';
  return [
    `## Message ${index + 1}`,
    `Role: ${role}`,
    at ? `At: ${at}` : null,
    toolName ? `Tool: ${toolName}` : null,
    toolCallId ? `Tool call id: ${toolCallId}` : null,
    message?.isError != null ? `Error: ${isError}` : null,
    '',
    body,
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n');
}

function clampChatIdleTimeoutMs(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return CHAT_IDLE_DEFAULT_TIMEOUT_MS;
  return Math.max(1000, Math.min(CHAT_IDLE_MAX_TIMEOUT_MS, Math.floor(value)));
}

function clampChatIdlePollIntervalMs(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return CHAT_IDLE_DEFAULT_POLL_INTERVAL_MS;
  return Math.max(250, Math.min(5000, Math.floor(value)));
}

function clampChatIdleForMs(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return CHAT_IDLE_DEFAULT_IDLE_FOR_MS;
  return Math.max(0, Math.min(10_000, Math.floor(value)));
}

function buildChatTimelineMessages(
  regAny: any,
  opts: { droneId: string; chatName: string },
  options?: { requireChat?: boolean },
): ChatTimelineMessage[] {
  const { id: droneId, drone } = droneEntryByAssistantId(regAny, opts.droneId);
  const chatName = normalizeChatNameForAssistant(opts.chatName);
  const chat = drone?.chats?.[chatName] ?? (chatName === 'default' ? drone?.chats?.default : null);
  const pendingSeedPrompt = chatName === 'default' ? cleanOptionalString(drone?.seed?.prompt) : '';
  if (!chat) {
    if (pendingSeedPrompt) {
      return [
        {
          id: 'user:startup-seed',
          role: 'user',
          status: 'queued',
          text: pendingSeedPrompt,
          at: safeMessageAt(drone?.updatedAt ?? drone?.createdAt, nowIso()),
          droneId,
          chatName,
          turnId: 'startup-seed',
        },
      ];
    }
    if (options?.requireChat) throw new Error(`unknown chat: ${droneId}/${chatName}`);
    return [];
  }

  const out: ChatTimelineMessage[] = [];
  const turns = Array.isArray(chat.turns) ? chat.turns : [];
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i] as any;
    const turnId = String(turn?.id ?? `turn-${i + 1}`).trim() || `turn-${i + 1}`;
    const promptAt = safeMessageAt(turn?.promptAt ?? turn?.at, nowIso());
    const completedAt = typeof turn?.completedAt === 'string' && turn.completedAt.trim() ? turn.completedAt.trim() : undefined;
    const ok = turn?.ok !== false;
    const userMessageId = `user:${turnId}`;
    out.push({
      id: userMessageId,
      role: 'user',
      status: 'completed',
      text: String(turn?.prompt ?? ''),
      at: promptAt,
      ...(completedAt ? { completedAt } : {}),
      droneId,
      chatName,
      turnId,
    });
    out.push({
      id: `agent:${turnId}`,
      role: 'agent',
      status: ok ? 'completed' : 'failed',
      text: String(turn?.output ?? ''),
      at: safeMessageAt(completedAt ?? turn?.at ?? promptAt, promptAt),
      ...(completedAt ? { completedAt } : {}),
      ...(turn?.error ? { error: String(turn.error) } : {}),
      droneId,
      chatName,
      turnId,
      userMessageId,
    });
  }

  const pending = Array.isArray(chat.pendingPrompts) ? chat.pendingPrompts : [];
  const completedTurnIds = new Set(turns.map((turn: any) => String(turn?.id ?? '').trim()).filter(Boolean));
  for (const item of pending as any[]) {
    const id = String(item?.id ?? '').trim();
    if (!id || completedTurnIds.has(id)) continue;
    const state = String(item?.state ?? '').trim();
    const status: ChatTimelineMessage['status'] =
      state === 'queued' || state === 'sending' || state === 'sent' || state === 'failed' ? state : 'queued';
    out.push({
      id: `user:${id}`,
      role: 'user',
      status,
      text: String(item?.prompt ?? ''),
      at: safeMessageAt(item?.at, nowIso()),
      ...(typeof item?.updatedAt === 'string' && item.updatedAt.trim() ? { updatedAt: item.updatedAt.trim() } : {}),
      ...(item?.error ? { error: String(item.error) } : {}),
      droneId,
      chatName,
      turnId: id,
    });
  }

  return out.sort((a, b) => {
    const aMs = Date.parse(a.at);
    const bMs = Date.parse(b.at);
    if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) return aMs - bMs;
    if (a.turnId && a.turnId === b.turnId && a.role !== b.role) return a.role === 'user' ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

export function summarizeAssistantChatIdle(
  regAny: any,
  target: AssistantChatIdleTarget,
  options?: { requireChat?: boolean },
): AssistantChatIdleStatus {
  const messages = buildChatTimelineMessages(regAny, target, options);
  const activeUserMessages = messages.filter(
    (message) => message.role === 'user' && (message.status === 'queued' || message.status === 'sending' || message.status === 'sent'),
  ).length;
  const queuedUserMessages = messages.filter((message) => message.role === 'user' && message.status === 'queued').length;
  const failedUserMessages = messages.filter((message) => message.role === 'user' && message.status === 'failed').length;
  const latest = messages[messages.length - 1] ?? null;
  const reason: AssistantChatIdleStatus['reason'] =
    activeUserMessages > 0
      ? 'active_user_messages'
      : !latest
        ? 'no_messages'
        : latest.role === 'agent'
          ? 'latest_agent_message'
          : latest.status === 'failed'
            ? 'latest_user_failed'
            : 'latest_user_message';
  const idle = activeUserMessages === 0 && (reason === 'no_messages' || reason === 'latest_agent_message' || reason === 'latest_user_failed');
  return {
    droneId: target.droneId,
    chatName: normalizeChatNameForAssistant(target.chatName),
    idle,
    reason,
    activeUserMessages,
    queuedUserMessages,
    failedUserMessages,
    latest: latest
      ? {
          id: latest.id,
          role: latest.role,
          status: latest.status,
          at: latest.at,
          text: latest.text,
          ...(latest.turnId ? { turnId: latest.turnId } : {}),
        }
      : null,
  };
}

function sanitizeMessage(message: any): any {
  if (!message || typeof message !== 'object') return message;
  return JSON.parse(JSON.stringify(message));
}

function jsonCloneObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { type: 'object', properties: {}, required: [] };
  try {
    const cloned = JSON.parse(JSON.stringify(raw));
    return cloned && typeof cloned === 'object' && !Array.isArray(cloned)
      ? cloned
      : { type: 'object', properties: {}, required: [] };
  } catch {
    return { type: 'object', properties: {}, required: [] };
  }
}

function assistantRealtimeToolDefinition(tool: any): AssistantRealtimeFunctionTool {
  return {
    type: 'function',
    name: String(tool?.name ?? '').trim(),
    ...(String(tool?.description ?? '').trim() ? { description: String(tool.description).trim() } : {}),
    parameters: jsonCloneObject(tool?.parameters),
  };
}

function parseAssistantRealtimeToolArguments(raw: unknown): unknown {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? raw : {};
}

function assistantRealtimeToolOutput(value: unknown): string {
  const result = value && typeof value === 'object' ? value as any : {};
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((part: any) => (part?.type === 'text' ? String(part.text ?? '') : ''))
    .filter(Boolean)
    .join('\n\n');
  const images = content
    .filter((part: any) => part?.type === 'image' && part?.mimeType)
    .map((part: any) => ({
      type: 'image',
      mimeType: String(part.mimeType),
      byteLength: Number(part.byteLength ?? part._meta?.byteLength ?? 0) || undefined,
      width: Number(part.width ?? part._meta?.width ?? 0) || undefined,
      height: Number(part.height ?? part._meta?.height ?? 0) || undefined,
    }));
  const payload = {
    ...(text ? { text } : {}),
    ...(images.length > 0 ? { images } : {}),
    result: result.details ?? value,
  };
  try {
    return JSON.stringify(sanitizeMessage(payload)).slice(0, 30_000);
  } catch {
    return String(text || value || '').slice(0, 30_000);
  }
}

function makeAssistantAccessScope(input?: { readMode?: unknown; writeMode?: unknown; droneIds?: unknown; updatedAt?: unknown }): AssistantAccessScope {
  const readMode = String(input?.readMode ?? '').trim().toLowerCase() === 'selected' ? 'selected' : 'all';
  const writeMode = String(input?.writeMode ?? '').trim().toLowerCase() === 'selected' ? 'selected' : 'all';
  const rawIds = Array.isArray(input?.droneIds) ? input.droneIds : [];
  const droneIds = Array.from(new Set(rawIds.map((item) => cleanOptionalString(item)).filter(Boolean))).slice(0, 100);
  return {
    readMode,
    writeMode,
    droneIds: readMode === 'selected' || writeMode === 'selected' ? droneIds : [],
    updatedAt: String(input?.updatedAt ?? '').trim() || nowIso(),
  };
}

function describeAssistantAccessMode(mode: AssistantAccessScope['readMode'], droneIds: string[]): string {
  if (mode === 'all') return 'all drones';
  if (droneIds.length === 0) return 'no selected drones';
  return `selected drones (${droneIds.join(', ')})`;
}

function normalizeChatIdleSubscriptionStatus(raw: unknown): AssistantChatIdleSubscriptionStatus {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'fired' || value === 'cancelled' || value === 'expired') return value;
  return 'active';
}

function normalizeChatIdleSubscription(raw: any): AssistantChatIdleSubscription | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanOptionalString(raw.id);
  const threadId = cleanOptionalString(raw.threadId);
  if (!id || !threadId) return null;
  const targets = Array.isArray(raw.targets)
    ? raw.targets
        .map((target: any) => ({
          droneId: cleanOptionalString(target?.droneId),
          chatName: normalizeChatNameForAssistant(target?.chatName),
        }))
        .filter((target: AssistantChatIdleTarget) => target.droneId)
        .slice(0, CHAT_IDLE_MAX_TARGETS)
    : [];
  if (targets.length === 0) return null;
  const createdAt = cleanOptionalString(raw.createdAt) || nowIso();
  const createdMs = Date.parse(createdAt);
  const expiresAt =
    cleanOptionalString(raw.expiresAt) ||
    new Date((Number.isFinite(createdMs) ? createdMs : Date.now()) + CHAT_IDLE_SUBSCRIPTION_EXPIRES_AFTER_MS).toISOString();
  const idleForMs = clampChatIdleForMs(raw.idleForMs);
  const lastResult = raw.lastResult && typeof raw.lastResult === 'object' ? sanitizeMessage(raw.lastResult) as AssistantChatIdleWaitResult : null;
  return {
    id,
    threadId,
    toolCallId: cleanOptionalString(raw.toolCallId) || null,
    voiceSource: normalizeAssistantVoiceSource(raw.voiceSource),
    mode: normalizeAssistantChatIdleWaitMode(raw.mode, 'all'),
    targets,
    createdAt,
    expiresAt,
    idleForMs,
    status: normalizeChatIdleSubscriptionStatus(raw.status),
    idleSince: cleanOptionalString(raw.idleSince) || null,
    firedAt: cleanOptionalString(raw.firedAt) || null,
    cancelledAt: cleanOptionalString(raw.cancelledAt) || null,
    expiredAt: cleanOptionalString(raw.expiredAt) || null,
    lastResult,
  };
}

function sanitizeChatIdleSubscription(subscription: AssistantChatIdleSubscription): AssistantChatIdleSubscription {
  return {
    ...subscription,
    voiceSource: normalizeAssistantVoiceSource(subscription.voiceSource),
    mode: normalizeAssistantChatIdleWaitMode(subscription.mode, 'all'),
    targets: subscription.targets.map((target) => ({ droneId: target.droneId, chatName: normalizeChatNameForAssistant(target.chatName) })),
    lastResult: subscription.lastResult ? sanitizeMessage(subscription.lastResult) : null,
  };
}

function activeChatIdleSubscriptionSummaries(subscriptions: AssistantChatIdleSubscription[]): AssistantChatIdleSubscription[] {
  return subscriptions
    .filter((subscription) => subscription.status === 'active')
    .map((subscription) => ({ ...sanitizeChatIdleSubscription(subscription), lastResult: null }));
}

function sanitizeThread(thread: AssistantThread): AssistantThread {
  const voiceEnabled = normalizeAssistantVoiceEnabled(thread.voiceEnabled);
  return {
    ...thread,
    voiceEnabled,
    voiceEnabledAt: voiceEnabled ? cleanOptionalString(thread.voiceEnabledAt) || thread.updatedAt || thread.createdAt || null : null,
    systemPrompt: migrateAssistantSystemPrompt(thread.systemPrompt) || ASSISTANT_SYSTEM_PROMPT_DEFAULT,
    systemPromptUpdatedAt: cleanOptionalString(thread.systemPromptUpdatedAt) || null,
    enabledTools: enabledToolsForVoiceMode(thread.enabledTools, voiceEnabled),
    messageCount: thread.messages.length,
    messages: thread.messages.slice(-ASSISTANT_THREAD_MESSAGE_LIMIT).map(sanitizeMessage),
    status: thread.status === 'running' || thread.status === 'waiting_for_approval' ? 'idle' : thread.status,
  };
}

function sanitizeThreadSummary(thread: AssistantThread): AssistantThread {
  const sanitized = sanitizeThread(thread);
  return {
    ...sanitized,
    messages: [],
  };
}

function normalizeThread(
  raw: any,
  fallback: { provider: LlmProviderId; model: string; systemPrompt?: string },
  options?: { migrateWebSearchDefaultTool?: boolean; migrateFetchContentDefaultTool?: boolean },
): AssistantThread | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim();
  if (!id) return null;
  const provider = normalizeProvider(raw.provider ?? fallback.provider);
  const model = allowedModelForProvider(provider, raw.model ?? fallback.model);
  const createdAt = String(raw.createdAt ?? '').trim() || nowIso();
  const updatedAt = String(raw.updatedAt ?? '').trim() || createdAt;
  const messages = Array.isArray(raw.messages) ? raw.messages.map(sanitizeMessage).slice(-ASSISTANT_THREAD_MESSAGE_LIMIT) : [];
  const thinkingLevel = allowedThinkingLevelForModel(provider, model, raw.thinkingLevel);
  return {
    id,
    title: String(raw.title ?? '').trim() || DEFAULT_THREAD_TITLE,
    createdAt,
    updatedAt,
    voiceEnabled: normalizeAssistantVoiceEnabled(raw.voiceEnabled),
    voiceEnabledAt: normalizeAssistantVoiceEnabled(raw.voiceEnabled) ? cleanOptionalString(raw.voiceEnabledAt) || updatedAt : null,
    model,
    provider,
    thinkingLevel,
    systemPrompt: migrateAssistantSystemPrompt(raw.systemPrompt) || fallback.systemPrompt || ASSISTANT_SYSTEM_PROMPT_DEFAULT,
    systemPromptUpdatedAt: cleanOptionalString(raw.systemPromptUpdatedAt) || null,
    enabledTools: normalizeStoredAssistantEnabledTools(
      raw.enabledTools,
      normalizeAssistantVoiceEnabled(raw.voiceEnabled),
      {
        webSearchDefaultTool: options?.migrateWebSearchDefaultTool === true,
        fetchContentDefaultTool: options?.migrateFetchContentDefaultTool === true,
      },
    ),
    accessScope: makeAssistantAccessScope(raw.accessScope),
    autoApprove: normalizeAssistantAutoApprove(raw.autoApprove),
    promptDeliveryMode: normalizeAssistantPromptDeliveryMode(raw.promptDeliveryMode),
    messages,
    status: raw.status === 'error' ? 'error' : 'idle',
    error: typeof raw.error === 'string' && raw.error.trim() ? raw.error : null,
  };
}

function serializeState(input: {
  activeThreadId: string;
  defaultModel: AssistantDefaultModel;
  threads: AssistantThread[];
  chatIdleSubscriptions: AssistantChatIdleSubscription[];
  systemPrompt: string;
  systemPromptUpdatedAt: string | null;
  voiceSystemPrompt: string;
  voiceSystemPromptUpdatedAt: string | null;
  overviewPrompt: string;
  overviewPromptUpdatedAt: string | null;
}): StoredAssistantState {
  const systemPrompt = normalizeAssistantSystemPrompt(input.systemPrompt) || ASSISTANT_SYSTEM_PROMPT_DEFAULT;
  const voiceSystemPrompt = normalizeAssistantSystemPrompt(input.voiceSystemPrompt) || ASSISTANT_SYSTEM_PROMPT_DEFAULT;
  const overviewPrompt = normalizeAssistantOverviewPrompt(input.overviewPrompt) || ASSISTANT_OVERVIEW_PROMPT_DEFAULT;
  const chatIdleSubscriptions = input.chatIdleSubscriptions
    .slice(-CHAT_IDLE_MAX_SUBSCRIPTIONS)
    .map(sanitizeChatIdleSubscription);
  return {
    activeThreadId: input.activeThreadId,
    defaultModel: input.defaultModel,
    threads: input.threads.slice(0, ASSISTANT_REGISTRY_MAX_THREADS).map(sanitizeThread),
    ...(chatIdleSubscriptions.length > 0 ? { chatIdleSubscriptions } : {}),
    webSearchToolMigrationApplied: true,
    fetchContentToolMigrationApplied: true,
    ...(systemPrompt !== ASSISTANT_SYSTEM_PROMPT_DEFAULT
      ? {
          systemPrompt,
          systemPromptUpdatedAt: input.systemPromptUpdatedAt ?? nowIso(),
        }
      : {}),
    ...(voiceSystemPrompt !== ASSISTANT_SYSTEM_PROMPT_DEFAULT || systemPrompt !== ASSISTANT_SYSTEM_PROMPT_DEFAULT
      ? {
          voiceSystemPrompt,
          ...(voiceSystemPrompt !== ASSISTANT_SYSTEM_PROMPT_DEFAULT
            ? { voiceSystemPromptUpdatedAt: input.voiceSystemPromptUpdatedAt ?? nowIso() }
            : {}),
        }
      : {}),
    ...(overviewPrompt !== ASSISTANT_OVERVIEW_PROMPT_DEFAULT
      ? {
          overviewPrompt,
          overviewPromptUpdatedAt: input.overviewPromptUpdatedAt ?? nowIso(),
        }
      : {}),
    updatedAt: nowIso(),
  };
}

function firstThread(threads: AssistantThread[], id: string): AssistantThread {
  const found = threads.find((thread) => thread.id === id) ?? threads[0];
  if (!found) throw new Error('assistant has no threads');
  return found;
}

export class HubAssistantService {
  private threads: AssistantThread[] = [];
  private activeThreadId = '';
  private loaded = false;
  private runtimePromise: Promise<AssistantRuntime> | null = null;
  private streamingMessages = new Map<string, Map<AssistantRealtimeMessageRole, any>>();
  private defaultSystemPrompt = ASSISTANT_SYSTEM_PROMPT_DEFAULT;
  private defaultSystemPromptUpdatedAt: string | null = null;
  private defaultVoiceSystemPrompt = ASSISTANT_SYSTEM_PROMPT_DEFAULT;
  private defaultVoiceSystemPromptUpdatedAt: string | null = null;
  private defaultOverviewPrompt = ASSISTANT_OVERVIEW_PROMPT_DEFAULT;
  private defaultOverviewPromptUpdatedAt: string | null = null;
  private defaultModelSelection: AssistantDefaultModel = { provider: 'openai', model: DEFAULT_OPENAI_MODEL };
  private overviewCache = new Map<string, AssistantThreadOverviewCacheEntry>();
  private overviewInFlight = new Map<string, Promise<AssistantThreadOverviewResult>>();
  private changeSequence = 0;
  private readonly changeListeners = new Set<(event: AssistantChangeEvent) => void>();
  private appContext: AssistantAppContext = {
    activeDroneId: null,
    activeDroneName: null,
    activeChatName: null,
    appView: null,
    updatedAt: nowIso(),
  };
  private readonly approvals = new Map<
    string,
    AssistantApproval & {
      resolve: (approved: boolean) => void;
    }
  >();
  private textPromptDelegate: ((threadId: string, prompt: string, source: AssistantVoiceSource | null) => Promise<void>) | null = null;
  private realtimeToolCatalogDelegate: ((threadId: string) => Promise<any[]>) | null = null;
  private realtimeToolExecuteDelegate: ((threadId: string, callId: string, toolName: string, args: any, signal?: AbortSignal) => Promise<any>) | null = null;

  constructor(private readonly tools: AssistantToolCallbacks) {}

  setTextPromptDelegate(delegate: (threadId: string, prompt: string, source: AssistantVoiceSource | null) => Promise<void>): void {
    this.textPromptDelegate = delegate;
  }

  setRealtimeToolDelegate(input: {
    catalog: (threadId: string) => Promise<any[]>;
    execute: (threadId: string, callId: string, toolName: string, args: any, signal?: AbortSignal) => Promise<any>;
  }): void {
    this.realtimeToolCatalogDelegate = input.catalog;
    this.realtimeToolExecuteDelegate = input.execute;
  }

  subscribeChanges(listener: (event: AssistantChangeEvent) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private emitChange(reason: string, threadId?: string): void {
    const event: AssistantChangeEvent = {
      type: 'assistant_changed',
      sequence: ++this.changeSequence,
      reason,
      ...(threadId ? { threadId } : {}),
      at: nowIso(),
    };
    for (const listener of this.changeListeners) {
      try {
        listener(event);
      } catch {
        // Ignore a broken listener so one stale SSE client cannot block assistant work.
      }
    }
  }

  private setThreadStreamingMessage(threadId: string, message: any): void {
    const role: AssistantRealtimeMessageRole = message?.role === 'user' ? 'user' : 'assistant';
    let messages = this.streamingMessages.get(threadId);
    if (!messages) {
      messages = new Map<AssistantRealtimeMessageRole, any>();
      this.streamingMessages.set(threadId, messages);
    }
    messages.set(role, sanitizeMessage(message));
  }

  private clearThreadStreamingMessages(threadId: string, role?: AssistantRealtimeMessageRole): boolean {
    if (!role) return this.streamingMessages.delete(threadId);
    const messages = this.streamingMessages.get(threadId);
    if (!messages) return false;
    const cleared = messages.delete(role);
    if (messages.size === 0) this.streamingMessages.delete(threadId);
    return cleared;
  }

  private threadStreamingMessages(threadId: string): any[] {
    const messages = this.streamingMessages.get(threadId);
    if (!messages) return [];
    return (['user', 'assistant'] as const).map((role) => messages.get(role)).filter(Boolean).map(sanitizeMessage);
  }

  private primaryThreadStreamingMessage(threadId: string): any | null {
    const messages = this.threadStreamingMessages(threadId);
    return messages[messages.length - 1] ?? null;
  }

  private emitUiAction(uiAction: AssistantUiAction, threadId?: string): void {
    const event: AssistantChangeEvent = {
      type: 'assistant_changed',
      sequence: ++this.changeSequence,
      reason: 'ui_action',
      ...(threadId ? { threadId } : {}),
      uiAction,
      at: nowIso(),
    };
    for (const listener of this.changeListeners) {
      try {
        listener(event);
      } catch {
        // Ignore stale SSE clients.
      }
    }
  }

  emitExternalUiAction(uiAction: AssistantUiAction, threadId?: string): { ok: true; uiAction: AssistantUiAction } {
    this.emitUiAction(uiAction, threadId);
    return { ok: true, uiAction };
  }

  updateAppContext(input: {
    activeDroneId?: unknown;
    activeDroneName?: unknown;
    activeChatName?: unknown;
    appView?: unknown;
  }): void {
    this.appContext = {
      activeDroneId: String(input.activeDroneId ?? '').trim() || null,
      activeDroneName: String(input.activeDroneName ?? '').trim() || null,
      activeChatName: String(input.activeChatName ?? '').trim() || null,
      appView: String(input.appView ?? '').trim() || null,
      updatedAt: nowIso(),
    };
  }

  async updateAccessScope(input: { threadId?: unknown; mode?: unknown; readMode?: unknown; writeMode?: unknown; droneIds?: unknown }): Promise<AssistantAccessScope> {
    await this.ensureLoaded();
    const threadId = cleanOptionalString(input.threadId) || this.activeThreadId;
    const thread = this.threads.find((item) => item.id === threadId);
    if (!thread) throw new Error(`unknown assistant thread: ${threadId}`);
    thread.accessScope = makeAssistantAccessScope({
      readMode: (input as any).readMode ?? input.mode,
      writeMode: (input as any).writeMode ?? input.mode,
      droneIds: input.droneIds,
      updatedAt: nowIso(),
    });
    thread.updatedAt = nowIso();
    await this.persist();
    return thread.accessScope;
  }

  private activeAccessScope(threadId?: string): AssistantAccessScope {
    const id = cleanOptionalString(threadId);
    if (id) {
      const thread = this.threads.find((item) => item.id === id);
      if (!thread) throw new Error(`unknown assistant thread: ${id}`);
      return thread.accessScope;
    }
    return firstThread(this.threads, this.activeThreadId).accessScope;
  }

  private allowedDroneIdSet(kind: 'read' | 'write' = 'read', threadId?: string): Set<string> | null {
    const accessScope = this.activeAccessScope(threadId);
    const mode = kind === 'write' ? accessScope.writeMode : accessScope.readMode;
    if (mode !== 'selected') return null;
    return new Set(accessScope.droneIds);
  }

  private async requireDroneInScope(droneRef: unknown, kind: 'read' | 'write' = 'read', threadId?: string): Promise<string> {
    const regAny: any = await loadRegistry();
    const droneId = droneIdByAssistantRef(regAny, droneRef);
    const allowed = this.allowedDroneIdSet(kind, threadId);
    if (allowed && !allowed.has(droneId)) throw new Error(`assistant ${kind} scope does not include drone: ${droneRef}`);
    return droneId;
  }

  private filterDronesForScope(drones: AssistantDroneSummary[], threadId?: string): AssistantDroneSummary[] {
    const allowed = this.allowedDroneIdSet('read', threadId);
    if (!allowed) return drones;
    return drones.filter((drone) => allowed.has(drone.id));
  }

  private requireFileCallback<K extends keyof AssistantToolCallbacks>(name: K): NonNullable<AssistantToolCallbacks[K]> {
    const callback = this.tools[name];
    if (typeof callback !== 'function') throw new Error(`assistant file tool unavailable: ${String(name)}`);
    return callback as NonNullable<AssistantToolCallbacks[K]>;
  }

  private async applyDronePatch(threadId: string, params: any): Promise<AssistantApplyPatchResult> {
    const droneId = await this.requireDroneInScope(params?.droneId, 'write', threadId);
    const operations = Array.isArray(params?.operations) ? params.operations : [];
    if (operations.length === 0) throw new Error('patch has no operations');
    const applyHunks = params?.applyHunks;
    if (typeof applyHunks !== 'function') throw new Error('patch hunk engine unavailable');
    const readFile = this.requireFileCallback('readDroneFile');
    const writeFile = this.requireFileCallback('writeDroneFile');
    const deleteFile = this.requireFileCallback('deleteDroneFile');
    const moveFile = this.requireFileCallback('moveDroneFile');
    const statPath = this.requireFileCallback('statDronePath');
    const staged = new Map<string, AssistantPatchStagedFile>();
    const applied: AssistantApplyPatchResult['operations'] = [];

    const getStaged = async (filePath: string): Promise<AssistantPatchStagedFile> => {
      const existing = staged.get(filePath);
      if (existing) return existing;
      const read = await readFile({ droneId, path: filePath });
      const next: AssistantPatchStagedFile = {
        path: filePath,
        existsBefore: true,
        content: read.content,
        deleted: false,
      };
      staged.set(filePath, next);
      return next;
    };

    const pathExists = async (filePath: string): Promise<boolean> => {
      const existing = staged.get(filePath);
      if (existing) return !existing.deleted && (existing.content != null || Boolean(existing.moveFrom));
      const stat = await statPath({ droneId, path: filePath });
      return Boolean(stat.exists);
    };

    for (const operation of operations) {
      if (operation.type === 'add') {
        const content = operation.lines.join('\n');
        if (await pathExists(operation.path)) throw new Error(`file already exists: ${operation.path}`);
        staged.set(operation.path, {
          path: operation.path,
          existsBefore: false,
          content,
          deleted: false,
        });
        applied.push({ kind: 'add', path: operation.path, size: Buffer.byteLength(content, 'utf8') });
        continue;
      }

      if (operation.type === 'delete') {
        const current = staged.get(operation.path);
        if (current) {
          current.content = null;
          current.deleted = true;
          delete current.moveFrom;
        } else {
          const stat = await statPath({ droneId, path: operation.path });
          if (!stat.exists) throw new Error(`file not found: ${operation.path}`);
          if (stat.kind === 'directory') throw new Error(`path is a directory: ${operation.path}`);
          staged.set(operation.path, {
            path: operation.path,
            existsBefore: true,
            content: null,
            deleted: true,
          });
        }
        applied.push({ kind: 'delete', path: operation.path });
        continue;
      }

      let current = staged.get(operation.path);
      if (operation.moveTo && operation.hunks.length === 0 && !current) {
        const stat = await statPath({ droneId, path: operation.path });
        if (!stat.exists) throw new Error(`file not found: ${operation.path}`);
        if (stat.kind === 'directory') throw new Error(`path is a directory: ${operation.path}`);
        current = {
          path: operation.path,
          existsBefore: true,
          content: null,
          deleted: false,
        };
        staged.set(operation.path, current);
      } else {
        current = await getStaged(operation.path);
      }
      if (current.deleted) throw new Error(`file not found: ${operation.path}`);
      let content = current.content;
      if (current.moveFrom && content == null && operation.hunks.length > 0) {
        const read = await readFile({ droneId, path: current.moveFrom });
        content = read.content;
        current.content = content;
        delete current.moveFrom;
      }
      if (operation.hunks.length > 0) {
        if (content == null) throw new Error(`file not found: ${operation.path}`);
        content = applyHunks(content, operation.hunks, operation.path);
      }
      if (operation.moveTo) {
        if (operation.moveTo === operation.path) throw new Error(`move target matches source: ${operation.path}`);
        if (await pathExists(operation.moveTo)) throw new Error(`move target already exists: ${operation.moveTo}`);
        current.content = null;
        current.deleted = true;
        delete current.moveFrom;
        staged.set(operation.moveTo, {
          path: operation.moveTo,
          existsBefore: false,
          content,
          deleted: false,
          ...(content == null ? { moveFrom: operation.path } : {}),
        });
        applied.push({ kind: 'update', path: operation.path, movedTo: operation.moveTo });
        continue;
      }
      if (content == null) throw new Error(`file not found: ${operation.path}`);
      current.content = content;
      current.deleted = false;
      delete current.moveFrom;
      applied.push({ kind: 'update', path: operation.path, size: Buffer.byteLength(content, 'utf8') });
    }

    const movedSources = new Set<string>();
    for (const file of staged.values()) {
      if (!file.deleted && file.moveFrom) {
        await moveFile({ droneId, fromPath: file.moveFrom, toPath: file.path });
        movedSources.add(file.moveFrom);
      }
    }
    for (const file of staged.values()) {
      if (!file.deleted && file.content != null) {
        await writeFile({ droneId, path: file.path, content: file.content });
      }
    }
    for (const file of staged.values()) {
      if (!file.deleted || !file.existsBefore) continue;
      if (movedSources.has(file.path)) continue;
      await deleteFile({ droneId, path: file.path });
    }

    return { ok: true, droneId, operations: applied };
  }

  private scopedAppContext(threadId: string): AssistantAppContext {
    const allowed = this.allowedDroneIdSet('read', threadId);
    if (!allowed) return { ...this.appContext };
    const activeDroneId = cleanOptionalString(this.appContext.activeDroneId);
    if (activeDroneId && allowed.has(activeDroneId)) return { ...this.appContext };
    return {
      ...this.appContext,
      activeDroneId: null,
      activeDroneName: null,
      activeChatName: null,
    };
  }

  async snapshot(mode: AssistantSnapshotMode = 'full'): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const streamingMessages = this.threadStreamingMessages(this.activeThreadId);
    const streamingMessage = this.primaryThreadStreamingMessage(this.activeThreadId);
    const compact = mode === 'compact';
    return {
      ok: true,
      activeThreadId: this.activeThreadId,
      threads: this.threads.map((thread) => (compact ? sanitizeThreadSummary(thread) : { ...sanitizeThread(thread), messages: thread.messages.map(sanitizeMessage) })),
      chatIdleSubscriptions: [],
      pendingApprovals: this.pendingApprovals(),
      models: await this.modelOptions(),
      availableTools: ASSISTANT_TOOL_SUMMARIES,
      accessScope: sanitizeMessage(this.activeAccessScope()),
      runningModels: {},
      ...(streamingMessage ? { streamingMessage: sanitizeMessage(streamingMessage), streamingMessages } : {}),
    };
  }

  async threadSnapshot(threadId: string, options?: { activate?: boolean }): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const id = cleanOptionalString(threadId);
    const targetThread = this.threads.find((thread) => thread.id === id);
    if (!targetThread) throw new Error(`unknown assistant thread: ${threadId}`);
    if (options?.activate) this.activeThreadId = id;
    const streamingMessages = this.threadStreamingMessages(id);
    const streamingMessage = this.primaryThreadStreamingMessage(id);
    return {
      ok: true,
      activeThreadId: id,
      threads: this.threads.map((thread) =>
        thread.id === id ? { ...sanitizeThread(thread), messages: thread.messages.map(sanitizeMessage) } : sanitizeThreadSummary(thread),
      ),
      chatIdleSubscriptions: [],
      pendingApprovals: this.pendingApprovals(),
      models: await this.modelOptions(),
      availableTools: ASSISTANT_TOOL_SUMMARIES,
      accessScope: sanitizeMessage(targetThread.accessScope ?? makeAssistantAccessScope()),
      runningModels: {},
      ...(streamingMessage ? { streamingMessage: sanitizeMessage(streamingMessage), streamingMessages } : {}),
    };
  }

  async activateThread(threadId: string): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    this.activeThreadId = thread.id;
    await this.persist();
    return await this.threadSnapshot(thread.id);
  }

  async createThread(input?: { title?: unknown; model?: unknown; provider?: unknown; activeDroneId?: unknown; activeChatName?: unknown; voiceEnabled?: unknown }): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const explicitProvider = String(input?.provider ?? '').trim();
    const provider = explicitProvider ? normalizeProvider(explicitProvider) : this.defaultModelSelection.provider;
    const voiceEnabled = normalizeAssistantVoiceEnabled(input?.voiceEnabled);
    const thread = this.makeThread({
      provider,
      model: String(input?.model ?? '').trim() || (explicitProvider ? defaultModelForProvider(provider) : this.defaultModelSelection.model),
      title: String(input?.title ?? '').trim() || DEFAULT_THREAD_TITLE,
      accessScope: this.defaultAccessScopeForNewThread({ ...input, voiceEnabled }),
      voiceEnabled,
    });
    this.threads = [thread, ...this.threads].slice(0, ASSISTANT_REGISTRY_MAX_THREADS);
    this.activeThreadId = thread.id;
    await this.persist();
    return await this.threadSnapshot(thread.id);
  }

  async ensureLatestVoiceThread(input?: { title?: unknown }): Promise<{ ok: true; threadId: string; created: boolean; thread: AssistantThread }> {
    await this.ensureLoaded();
    const existing = this.latestVoiceThread();
    if (existing) {
      this.activeThreadId = existing.id;
      await this.persist();
      return { ok: true, threadId: existing.id, created: false, thread: sanitizeThread(existing) };
    }

    const provider = this.defaultModelSelection.provider;
    const thread = this.makeThread({
      provider,
      model: this.defaultModelSelection.model,
      title: String(input?.title ?? '').trim() || 'Realtime thread',
      voiceEnabled: true,
      accessScope: this.defaultAccessScopeForNewThread({ voiceEnabled: true }),
    });
    this.threads = [thread, ...this.threads].slice(0, ASSISTANT_REGISTRY_MAX_THREADS);
    this.activeThreadId = thread.id;
    await this.persist();
    return { ok: true, threadId: thread.id, created: true, thread: sanitizeThread(thread) };
  }

  private async createNewThreadFromThread(threadId: string, input?: { title?: unknown }): Promise<{ ok: true; previousThreadId: string; threadId: string; thread: AssistantThread }> {
    await this.ensureLoaded();
    const previousThread = this.getThread(threadId);
    const voiceEnabled = normalizeAssistantVoiceEnabled(previousThread.voiceEnabled);
    const title = cleanOptionalString(input?.title) || (voiceEnabled ? 'Realtime thread' : DEFAULT_THREAD_TITLE);
    const thread = this.makeThread({
      provider: previousThread.provider,
      model: previousThread.model,
      title,
      voiceEnabled,
      accessScope: this.defaultAccessScopeForNewThread({ voiceEnabled }),
    });
    thread.thinkingLevel = allowedThinkingLevelForModel(thread.provider, thread.model, previousThread.thinkingLevel);
    this.threads = [thread, ...this.threads].slice(0, ASSISTANT_REGISTRY_MAX_THREADS);
    this.activeThreadId = thread.id;
    await this.persist();
    return { ok: true, previousThreadId: previousThread.id, threadId: thread.id, thread: sanitizeThread(thread) };
  }

  async submitVoicePrompt(input: { prompt?: unknown; title?: unknown; source?: AssistantVoiceSource; deliveryMode?: unknown }): Promise<{ ok: true; threadId: string; created: boolean; accepted: boolean }> {
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt) throw new Error('missing prompt');
    const voiceThread = await this.ensureLatestVoiceThread({ title: input.title });
    if (!this.textPromptDelegate) throw new Error('Blip assistant host is not ready');
    void this.textPromptDelegate(voiceThread.threadId, prompt, input.source ?? null).catch((error: any) => {
      console.warn('[assistant] voice prompt failed', {
        threadId: voiceThread.threadId,
        error: String(error?.message ?? error ?? ''),
      });
    });
    return { ok: true, threadId: voiceThread.threadId, created: voiceThread.created, accepted: true };
  }

  async systemPromptSettings(): Promise<AssistantSystemPromptSettings> {
    await this.ensureLoaded();
    return this.systemPromptSettingsSync();
  }

  async updateSystemPrompt(input: { prompt?: unknown; promptType?: unknown; assistantType?: unknown; type?: unknown }): Promise<AssistantSystemPromptSettings> {
    await this.ensureLoaded();
    const prompt = normalizeAssistantSystemPrompt(input.prompt);
    if (!prompt) throw new Error('missing system prompt');
    const promptKind = normalizeAssistantSystemPromptKind(input.promptType ?? input.assistantType ?? input.type);
    if (promptKind === 'voice') {
      this.defaultVoiceSystemPrompt = prompt;
      this.defaultVoiceSystemPromptUpdatedAt = prompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? null : nowIso();
    } else {
      this.defaultSystemPrompt = prompt;
      this.defaultSystemPromptUpdatedAt = prompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? null : nowIso();
    }
    await this.persist();
    return this.systemPromptSettingsSync();
  }

  async threadSystemPromptSettings(threadId: string): Promise<AssistantThreadSystemPromptSettings> {
    await this.ensureLoaded();
    return this.threadSystemPromptSettingsSync(threadId);
  }

  async updateThreadSystemPrompt(threadId: string, input: { prompt?: unknown; patches?: unknown }): Promise<AssistantThreadSystemPromptSettings> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const hasPrompt = typeof input.prompt === 'string' && input.prompt.trim();
    const prompt = hasPrompt
      ? normalizeAssistantSystemPrompt(input.prompt)
      : applyAssistantSystemPromptPatches(thread.systemPrompt, input.patches);
    if (!prompt) throw new Error('missing system prompt');
    thread.systemPrompt = prompt;
    thread.systemPromptUpdatedAt = prompt === this.defaultSystemPromptForThread(thread) ? null : nowIso();
    thread.updatedAt = nowIso();
    await this.persist();
    return this.threadSystemPromptSettingsSync(thread.id);
  }

  async promoteThreadSystemPrompt(threadId: string, input?: { prompt?: unknown }): Promise<AssistantSystemPromptSettings> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const prompt = normalizeAssistantSystemPrompt(input?.prompt) || normalizeAssistantSystemPrompt(thread.systemPrompt);
    if (!prompt) throw new Error('missing thread system prompt');
    thread.systemPrompt = prompt;
    if (thread.voiceEnabled) {
      this.defaultVoiceSystemPrompt = prompt;
      this.defaultVoiceSystemPromptUpdatedAt = prompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? null : nowIso();
    } else {
      this.defaultSystemPrompt = prompt;
      this.defaultSystemPromptUpdatedAt = prompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? null : nowIso();
    }
    thread.systemPromptUpdatedAt = null;
    thread.updatedAt = nowIso();
    await this.persist();
    return this.systemPromptSettingsSync();
  }

  async overviewPromptSettings(): Promise<AssistantOverviewPromptSettings> {
    await this.ensureLoaded();
    return this.overviewPromptSettingsSync();
  }

  async updateOverviewPrompt(input: { prompt?: unknown }): Promise<AssistantOverviewPromptSettings> {
    await this.ensureLoaded();
    const prompt = normalizeAssistantOverviewPrompt(input.prompt);
    if (!prompt) throw new Error('missing overview prompt');
    this.defaultOverviewPrompt = prompt;
    this.defaultOverviewPromptUpdatedAt = prompt === ASSISTANT_OVERVIEW_PROMPT_DEFAULT ? null : nowIso();
    await this.persist();
    return this.overviewPromptSettingsSync();
  }

  async generateThreadOverview(
    threadId: string,
    input?: { force?: unknown; reuseLastInput?: unknown; messages?: any[] },
  ): Promise<AssistantThreadOverviewResult> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const prompt = normalizeAssistantOverviewPrompt(this.defaultOverviewPrompt) || ASSISTANT_OVERVIEW_PROMPT_DEFAULT;
    const promptFingerprint = assistantTextFingerprint(prompt);
    const prior = this.overviewCache.get(thread.id) ?? null;
    const reuseLastInput = input?.reuseLastInput === true || String(input?.reuseLastInput ?? '').trim() === '1';
    const inputText = reuseLastInput ? prior?.inputText : this.buildOverviewInput(thread, input?.messages);
    if (!inputText) throw new Error(reuseLastInput ? 'no previous overview input is available' : 'assistant thread has no overview input');
    const inputFingerprint = assistantTextFingerprint(inputText);
    const force = input?.force === true || String(input?.force ?? '').trim() === '1';
    const cached =
      prior &&
      !force &&
      !reuseLastInput &&
      prior.inputFingerprint === inputFingerprint &&
      prior.promptFingerprint === promptFingerprint;
    if (cached) {
      return {
        ok: true,
        threadId: thread.id,
        markdown: prior.markdown,
        generatedAt: prior.generatedAt,
        inputFingerprint: prior.inputFingerprint,
        promptFingerprint: prior.promptFingerprint,
        provider: prior.provider,
        model: prior.model,
        cached: true,
        inputReused: false,
      };
    }

    const inFlightKey = `${thread.id}\u0000${inputFingerprint}\u0000${promptFingerprint}`;
    if (!force) {
      const inFlight = this.overviewInFlight.get(inFlightKey);
      if (inFlight) return await inFlight;
    }

    const generated = (async (): Promise<AssistantThreadOverviewResult> => {
      const provider = await defaultAssistantProvider();
      const generatedOverview = await generateAssistantOverview({
        provider,
        instructions: prompt,
        threadInput: inputText,
      });
      const markdown = clipAssistantOverviewText(generatedOverview.markdown, 12_000);
      const next: AssistantThreadOverviewCacheEntry = {
        inputText,
        inputFingerprint,
        promptFingerprint,
        markdown,
        generatedAt: nowIso(),
        provider: generatedOverview.provider,
        model: generatedOverview.model,
      };
      this.overviewCache.set(thread.id, next);
      return {
        ok: true,
        threadId: thread.id,
        markdown: next.markdown,
        generatedAt: next.generatedAt,
        inputFingerprint: next.inputFingerprint,
        promptFingerprint: next.promptFingerprint,
        provider: next.provider,
        model: next.model,
        cached: false,
        inputReused: reuseLastInput,
      };
    })();

    if (!force) this.overviewInFlight.set(inFlightKey, generated);
    try {
      return await generated;
    } finally {
      if (this.overviewInFlight.get(inFlightKey) === generated) this.overviewInFlight.delete(inFlightKey);
    }
  }

  async updateThread(
    threadId: string,
    patch: {
      title?: unknown;
      model?: unknown;
      provider?: unknown;
      thinkingLevel?: unknown;
      autoApprove?: unknown;
      promptDeliveryMode?: unknown;
      enabledTools?: unknown;
      voiceEnabled?: unknown;
    },
  ): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    this.activeThreadId = thread.id;
    const title = typeof patch.title === 'string' ? patch.title.trim() : '';
    if (title) thread.title = title.slice(0, 80);
    if (patch.provider != null) thread.provider = normalizeProvider(patch.provider);
    if (patch.model != null || patch.provider != null) thread.model = allowedModelForProvider(thread.provider, patch.model ?? thread.model);
    if (patch.thinkingLevel != null || patch.model != null || patch.provider != null) {
      thread.thinkingLevel = allowedThinkingLevelForModel(thread.provider, thread.model, patch.thinkingLevel ?? thread.thinkingLevel);
    }
    if (patch.autoApprove != null) {
      thread.autoApprove = normalizeAssistantAutoApprove(patch.autoApprove);
      if (thread.autoApprove) this.resolvePendingApprovalsForThread(thread.id, true);
    }
    if (patch.promptDeliveryMode != null) thread.promptDeliveryMode = normalizeAssistantPromptDeliveryMode(patch.promptDeliveryMode);
    if (patch.enabledTools != null) thread.enabledTools = normalizeAssistantEnabledTools(patch.enabledTools, thread.enabledTools);
    if (patch.voiceEnabled != null) {
      const wasVoiceEnabled = thread.voiceEnabled;
      thread.voiceEnabled = normalizeAssistantVoiceEnabled(patch.voiceEnabled);
      thread.voiceEnabledAt = thread.voiceEnabled ? nowIso() : null;
      thread.enabledTools =
        thread.voiceEnabled && !wasVoiceEnabled
          ? normalizeAssistantEnabledTools([...thread.enabledTools, 'set_thinking_level', 'create_new_thread', 'speak'], ASSISTANT_VOICE_DEFAULT_ENABLED_TOOL_NAMES)
          : enabledToolsForVoiceMode(thread.enabledTools, thread.voiceEnabled);
    }
    thread.updatedAt = nowIso();
    await this.persist();
    return await this.threadSnapshot(thread.id);
  }

  async updateDefaultModel(input?: { provider?: unknown; model?: unknown }): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const provider = normalizeProvider(input?.provider);
    const model = String(input?.model ?? '').trim();
    if (!ASSISTANT_MODEL_OPTIONS.some((option) => option.provider === provider && option.id === model)) {
      throw new Error(`unknown assistant model: ${provider}/${model}`);
    }
    if (this.defaultModelSelection.provider !== provider || this.defaultModelSelection.model !== model) {
      this.defaultModelSelection = { provider, model };
      await this.persist();
    }
    return await this.threadSnapshot(this.activeThreadId);
  }

  async deleteThread(threadId: string): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    this.clearThreadStreamingMessages(threadId);
    this.overviewCache.delete(threadId);
    for (const key of [...this.overviewInFlight.keys()]) {
      if (key.startsWith(`${threadId}\u0000`)) this.overviewInFlight.delete(key);
    }
    await deleteAssistantArtifactsForThread(threadId);
    this.threads = this.threads.filter((thread) => thread.id !== threadId);
    if (this.threads.length === 0) {
      this.threads = [this.makeThread(this.defaultModelSelection)];
    }
    if (!this.threads.some((thread) => thread.id === this.activeThreadId)) {
      this.activeThreadId = this.threads[0].id;
    }
    await this.persist();
    return await this.threadSnapshot(this.activeThreadId);
  }

  async stopThread(threadId: string): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    await this.persist();
    return await this.threadSnapshot(threadId);
  }

  async listArtifactFiles(threadId: string) {
    await this.ensureLoaded();
    this.getThread(threadId);
    return await listAssistantArtifactFiles(threadId);
  }

  async readArtifactFile(threadId: string, artifactPath: unknown) {
    await this.ensureLoaded();
    this.getThread(threadId);
    return await readAssistantArtifactFile(threadId, artifactPath);
  }

  async runArtifactAction(threadId: string, input: AssistantArtifactActionInput) {
    await this.ensureLoaded();
    this.getThread(threadId);
    return await runAssistantArtifactAction(threadId, input);
  }

  async visibleDrones(threadId: string): Promise<AssistantDroneSummary[]> {
    await this.ensureLoaded();
    this.getThread(threadId);
    return this.filterDronesForScope(await this.tools.listDrones(), threadId);
  }

  async executeDroneWorkspaceTool(
    threadId: string,
    droneRef: string,
    call: { tool: string; args: Record<string, unknown>; signal?: AbortSignal },
    patchEngine?: {
      parse: (patch: string) => any[];
      applyHunks: (content: string, hunks: any[], filePath: string) => string;
    },
  ): Promise<any> {
    await this.ensureLoaded();
    const write = ['write_file', 'delete_file', 'move_path', 'create_directory', 'delete_directory', 'apply_patch', 'bash'].includes(call.tool);
    const droneId = await this.requireDroneInScope(droneRef, write ? 'write' : 'read', threadId);
    const params: any = call.args ?? {};
    if (call.tool === 'list_files') {
      const rawPath = cleanOptionalString(params.path);
      const result = await this.requireFileCallback('listDroneFiles')({ droneId, path: rawPath ? normalizeAssistantDroneFilePath(rawPath) : undefined });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], details: result };
    }
    if (call.tool === 'read_file') {
      const startLine = normalizeOptionalPositiveLine(params.startLine, 'startLine');
      const endLine = normalizeOptionalPositiveLine(params.endLine, 'endLine');
      if (startLine != null && endLine != null && startLine > endLine) throw new Error('startLine must be less than or equal to endLine');
      const result = await this.requireFileCallback('readDroneFile')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
        startLine,
        endLine,
      });
      return { content: [{ type: 'text', text: formatAssistantReadFileToolText(result) }], details: result };
    }
    if (call.tool === 'search_files') {
      const query = cleanOptionalString(params.query);
      if (!query) throw new Error('missing query');
      const rawPath = cleanOptionalString(params.path);
      const result = await this.requireFileCallback('searchDroneFiles')({
        droneId,
        query,
        path: rawPath ? normalizeAssistantDroneFilePath(rawPath) : undefined,
        limit: Number.isFinite(Number(params.limit)) ? Math.max(1, Math.min(100, Math.floor(Number(params.limit)))) : 20,
        contextBefore: normalizeSearchContextLines(params.contextBefore, 'contextBefore'),
        contextAfter: normalizeSearchContextLines(params.contextAfter, 'contextAfter'),
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], details: result };
    }
    if (call.tool === 'write_file') {
      const result = await this.requireFileCallback('writeDroneFile')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
        content: String(params.content ?? ''),
      });
      return { content: [{ type: 'text', text: `Wrote ${result.path} (${result.size ?? 0} bytes).` }], details: result };
    }
    if (call.tool === 'delete_file') {
      const result = await this.requireFileCallback('deleteDroneFile')({ droneId, path: normalizeAssistantDroneFilePath(params.path) });
      return { content: [{ type: 'text', text: `Deleted ${result.path}.` }], details: result };
    }
    if (call.tool === 'move_path') {
      const result = await this.requireFileCallback('moveDronePath')({
        droneId,
        fromPath: normalizeAssistantDroneFilePath(params.from),
        toPath: normalizeAssistantDroneFilePath(params.to),
        overwrite: params.overwrite === true,
      });
      return { content: [{ type: 'text', text: `Moved ${result.path} to ${result.movedTo}.` }], details: result };
    }
    if (call.tool === 'create_directory') {
      const result = await this.requireFileCallback('createDroneDirectory')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
        recursive: params.recursive === true,
      });
      return { content: [{ type: 'text', text: `Created directory ${result.path}.` }], details: result };
    }
    if (call.tool === 'delete_directory') {
      const result = await this.requireFileCallback('deleteDroneDirectory')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
        recursive: params.recursive === true,
      });
      return { content: [{ type: 'text', text: `Deleted directory ${result.path}.` }], details: result };
    }
    if (call.tool === 'bash') {
      const command = String(params.command ?? '');
      if (!command.trim()) throw new Error('missing command');
      const rawCwd = cleanOptionalString(params.cwd);
      const result = await this.requireFileCallback('runDroneBash')({
        droneId,
        command,
        cwd: rawCwd ? normalizeAssistantDroneFilePath(rawCwd) : undefined,
        timeoutMs: clampAssistantBashTimeout(params.timeoutMs),
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], details: result };
    }
    if (call.tool === 'get_working_tree_status') {
      const result = await this.requireFileCallback('listDroneChangedFiles')({ droneId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], details: result };
    }
    if (call.tool === 'apply_patch') {
      if (!patchEngine) throw new Error('patch engine unavailable');
      const result = await this.applyDronePatch(threadId, {
        droneId,
        operations: patchEngine.parse(String(params.patch ?? '')),
        applyHunks: patchEngine.applyHunks,
      });
      return {
        content: [{ type: 'text', text: `Applied ${result.operations.length} patch operation${result.operations.length === 1 ? '' : 's'} to ${result.droneId}.` }],
        details: result,
      };
    }
    throw new Error(`unsupported drone workspace tool: ${call.tool}`);
  }

  currentContext(threadId: string): any {
    this.getThread(threadId);
    return {
      app: this.scopedAppContext(threadId),
      accessScope: this.activeAccessScope(threadId),
    };
  }

  resolvedSystemPrompt(threadId: string): string {
    return this.systemPrompt(threadId);
  }

  async preflightBlipTool(threadId: string, toolName: string, callId: string, args: any, signal?: AbortSignal): Promise<{ block?: boolean; reason?: string } | undefined> {
    return this.beforeToolCall(threadId, { toolCall: { id: callId, name: toolName }, args }, undefined, signal);
  }

  async approve(approvalId: string, approved: boolean): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error(`unknown approval: ${approvalId}`);
    approval.status = approved ? 'approved' : 'denied';
    this.approvals.delete(approvalId);
    approval.resolve(approved);
    return await this.threadSnapshot(approval.threadId);
  }

  private resolvePendingApprovalsForThread(threadId: string, approved: boolean): void {
    for (const [id, approval] of [...this.approvals]) {
      if (approval.threadId !== threadId || approval.status !== 'pending') continue;
      approval.status = approved ? 'approved' : 'denied';
      this.approvals.delete(id);
      approval.resolve(approved);
    }
  }

  async promptThread(
    threadId: string,
    input: { prompt?: unknown; voiceSource?: unknown },
    onEvent?: (event: AssistantPromptEvent) => void | Promise<void>,
  ): Promise<void> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt) throw new Error('missing prompt');
    if (!this.textPromptDelegate) throw new Error('Blip assistant host is not ready');
    this.activeThreadId = thread.id;
    thread.error = null;
    thread.updatedAt = nowIso();
    await this.persist();
    await this.textPromptDelegate(thread.id, prompt, normalizeAssistantVoiceSource(input.voiceSource));
    await onEvent?.({ type: 'snapshot', snapshot: await this.threadSnapshot(thread.id) });
  }
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const stored = (await loadAssistantState()) ?? undefined;
    const storedSystemPrompt = migrateAssistantSystemPrompt(stored?.systemPrompt);
    const storedVoiceSystemPrompt = migrateAssistantSystemPrompt(stored?.voiceSystemPrompt);
    const storedOverviewPrompt = normalizeAssistantOverviewPrompt(stored?.overviewPrompt);
    this.defaultSystemPrompt = storedSystemPrompt || ASSISTANT_SYSTEM_PROMPT_DEFAULT;
    this.defaultSystemPromptUpdatedAt =
      storedSystemPrompt && typeof stored?.systemPromptUpdatedAt === 'string' && stored.systemPromptUpdatedAt.trim()
        ? stored.systemPromptUpdatedAt.trim()
        : null;
    this.defaultVoiceSystemPrompt = storedVoiceSystemPrompt || storedSystemPrompt || ASSISTANT_SYSTEM_PROMPT_DEFAULT;
    this.defaultVoiceSystemPromptUpdatedAt =
      storedVoiceSystemPrompt && typeof stored?.voiceSystemPromptUpdatedAt === 'string' && stored.voiceSystemPromptUpdatedAt.trim()
        ? stored.voiceSystemPromptUpdatedAt.trim()
        : storedVoiceSystemPrompt
          ? nowIso()
          : storedSystemPrompt && typeof stored?.systemPromptUpdatedAt === 'string' && stored.systemPromptUpdatedAt.trim()
            ? stored.systemPromptUpdatedAt.trim()
            : null;
    this.defaultOverviewPrompt = storedOverviewPrompt || ASSISTANT_OVERVIEW_PROMPT_DEFAULT;
    this.defaultOverviewPromptUpdatedAt =
      storedOverviewPrompt && typeof stored?.overviewPromptUpdatedAt === 'string' && stored.overviewPromptUpdatedAt.trim()
        ? stored.overviewPromptUpdatedAt.trim()
        : null;
    const fallbackDefaultProvider = await defaultAssistantProvider();
    const storedDefaultProvider = normalizeProvider(stored?.defaultModel?.provider ?? fallbackDefaultProvider);
    this.defaultModelSelection = {
      provider: storedDefaultProvider,
      model: allowedModelForProvider(storedDefaultProvider, stored?.defaultModel?.model),
    };
    const storedThreads = Array.isArray(stored?.threads) ? stored.threads : [];
    const storedFallbackProvider = normalizeProvider(storedThreads.find((thread: any) => thread && typeof thread === 'object')?.provider);
    const storedFallback = {
      provider: storedFallbackProvider,
      model: defaultModelForProvider(storedFallbackProvider),
      systemPrompt: ASSISTANT_SYSTEM_PROMPT_DEFAULT,
    };
    const migrateWebSearchDefaultTool = stored?.webSearchToolMigrationApplied !== true;
    const migrateFetchContentDefaultTool = stored?.fetchContentToolMigrationApplied !== true;
    const threads = storedThreads
      .map((thread) => normalizeThread(thread, storedFallback, { migrateWebSearchDefaultTool, migrateFetchContentDefaultTool }))
      .filter(Boolean) as AssistantThread[];
    if (threads.length > 0) {
      this.threads = threads;
    } else {
      this.threads = [
        this.makeThread({
          ...this.defaultModelSelection,
          systemPrompt: this.defaultSystemPrompt,
        }),
      ];
    }
    const activeThreadId = String(stored?.activeThreadId ?? '').trim();
    this.activeThreadId = this.threads.some((thread) => thread.id === activeThreadId) ? activeThreadId : this.threads[0].id;
    this.loaded = true;
  }

  private defaultAccessScopeForNewThread(input?: { activeDroneId?: unknown; activeChatName?: unknown; voiceEnabled?: unknown }): AssistantAccessScope {
    if (normalizeAssistantVoiceEnabled(input?.voiceEnabled)) {
      return makeAssistantAccessScope({ readMode: 'all', writeMode: 'selected', droneIds: [] });
    }
    const hasInputDrone = Object.prototype.hasOwnProperty.call(input ?? {}, 'activeDroneId');
    const hasInputChat = Object.prototype.hasOwnProperty.call(input ?? {}, 'activeChatName');
    const activeDroneId = hasInputDrone ? cleanOptionalString(input?.activeDroneId) : cleanOptionalString(this.appContext.activeDroneId);
    const activeChatName = hasInputChat ? cleanOptionalString(input?.activeChatName) : cleanOptionalString(this.appContext.activeChatName);
    if (!activeDroneId || !activeChatName) return makeAssistantAccessScope({ readMode: 'all', writeMode: 'selected', droneIds: [] });
    return makeAssistantAccessScope({ readMode: 'all', writeMode: 'selected', droneIds: [activeDroneId] });
  }

  private makeThread(input?: { provider?: LlmProviderId; model?: string; title?: string; accessScope?: AssistantAccessScope; systemPrompt?: string; voiceEnabled?: boolean }): AssistantThread {
    const provider = normalizeProvider(input?.provider);
    const at = nowIso();
    const voiceEnabled = input?.voiceEnabled === true;
    return {
      id: makeAssistantId('thread'),
      title: input?.title?.trim() || DEFAULT_THREAD_TITLE,
      createdAt: at,
      updatedAt: at,
      voiceEnabled,
      voiceEnabledAt: voiceEnabled ? at : null,
      provider,
      model: allowedModelForProvider(provider, input?.model),
      thinkingLevel: allowedThinkingLevelForModel(provider, allowedModelForProvider(provider, input?.model), 'off'),
      systemPrompt: normalizeAssistantSystemPrompt(input?.systemPrompt) || this.defaultSystemPromptForVoiceMode(voiceEnabled),
      systemPromptUpdatedAt: null,
      enabledTools: [...(voiceEnabled ? ASSISTANT_VOICE_DEFAULT_ENABLED_TOOL_NAMES : ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES)],
      accessScope: input?.accessScope ?? this.defaultAccessScopeForNewThread({ voiceEnabled }),
      autoApprove: false,
      promptDeliveryMode: 'queue',
      messages: [],
      status: 'idle',
      error: null,
    };
  }

  private defaultSystemPromptForVoiceMode(voiceEnabled: boolean): string {
    return normalizeAssistantSystemPrompt(voiceEnabled ? this.defaultVoiceSystemPrompt : this.defaultSystemPrompt) || ASSISTANT_SYSTEM_PROMPT_DEFAULT;
  }

  private defaultSystemPromptForThread(thread: AssistantThread): string {
    return this.defaultSystemPromptForVoiceMode(normalizeAssistantVoiceEnabled(thread.voiceEnabled));
  }

  private getThread(threadId: string): AssistantThread {
    const id = String(threadId ?? '').trim();
    const thread = this.threads.find((item) => item.id === id);
    if (!thread) throw new Error(`unknown assistant thread: ${threadId}`);
    return thread;
  }

  private latestVoiceThread(): AssistantThread | null {
    let latest: AssistantThread | null = null;
    let latestMs = -1;
    for (const thread of this.threads) {
      if (!normalizeAssistantVoiceEnabled(thread.voiceEnabled)) continue;
      const updatedMs = Date.parse(thread.voiceEnabledAt || thread.createdAt);
      const normalizedMs = Number.isFinite(updatedMs) ? updatedMs : 0;
      if (!latest || normalizedMs > latestMs) {
        latest = thread;
        latestMs = normalizedMs;
      }
    }
    return latest;
  }

  private async persist(): Promise<void> {
    const activeThread = firstThread(this.threads, this.activeThreadId);
    const state = serializeState({
      activeThreadId: activeThread.id,
      defaultModel: this.defaultModelSelection,
      threads: this.threads,
      chatIdleSubscriptions: [],
      systemPrompt: this.defaultSystemPrompt,
      systemPromptUpdatedAt: this.defaultSystemPromptUpdatedAt,
      voiceSystemPrompt: this.defaultVoiceSystemPrompt,
      voiceSystemPromptUpdatedAt: this.defaultVoiceSystemPromptUpdatedAt,
      overviewPrompt: this.defaultOverviewPrompt,
      overviewPromptUpdatedAt: this.defaultOverviewPromptUpdatedAt,
    });
    await saveAssistantState(state);
    this.emitChange('persisted', activeThread.id);
  }

  private async runtime(): Promise<AssistantRuntime> {
    if (!this.runtimePromise) {
      this.runtimePromise = dynamicImport('@mariozechner/pi-ai').then((ai) => ({
        getModel: ai.getModel,
      }));
    }
    return await this.runtimePromise;
  }

  private async modelOptions(): Promise<AssistantModelOption[]> {
    try {
      const runtime = await this.runtime();
      return ASSISTANT_MODEL_OPTIONS.map((option) => {
        const model = runtime.getModel(providerToPiProvider(option.provider), option.id);
        return {
          provider: option.provider,
          id: option.id,
          name: option.name,
          reasoning: Boolean(model?.reasoning),
          thinkingLevel: option.thinkingLevel,
        };
      });
    } catch {
      const provider = await defaultAssistantProvider();
      return [
        {
          provider,
          id: defaultModelForProvider(provider),
          name: defaultModelForProvider(provider),
          reasoning: false,
          thinkingLevel: ASSISTANT_MODEL_OPTIONS.find((option) => option.provider === provider && option.id === defaultModelForProvider(provider))?.thinkingLevel ?? 'off',
        },
      ];
    }
  }

  async realtimeSessionConfig(input?: { source?: AssistantVoiceSource | null; title?: unknown }): Promise<AssistantRealtimeSessionConfig> {
    const voiceThread = await this.ensureLatestVoiceThread({ title: input?.title ?? 'Desktop realtime thread' });
    if (!this.realtimeToolCatalogDelegate) throw new Error('Blip assistant tool catalog is not ready');
    const tools = (await this.realtimeToolCatalogDelegate(voiceThread.threadId))
      .filter((tool: any) => String(tool?.name ?? '') !== 'speak')
      .map(assistantRealtimeToolDefinition)
      .filter((tool) => tool.name);
    const instructions = [
      this.systemPrompt(voiceThread.threadId),
      'You are speaking directly through OpenAI Realtime audio. Keep spoken replies short and natural.',
      'Use the available Drone Hub tools directly when they are needed. Do not say you are sending the request to another assistant unless a tool result explicitly says it queued work.',
      'Do not call a speak tool; audio output is already handled by the Realtime session.',
    ].join('\n\n');
    return {
      ok: true,
      threadId: voiceThread.threadId,
      created: voiceThread.created,
      instructions,
      tools,
    };
  }

  async appendRealtimeMessage(input: {
    threadId?: unknown;
    role?: unknown;
    text?: unknown;
  }): Promise<{ ok: true; threadId: string; accepted: boolean }> {
    await this.ensureLoaded();
    const threadId = cleanOptionalString(input.threadId) || (await this.ensureLatestVoiceThread({ title: 'Desktop realtime thread' })).threadId;
    const thread = this.getThread(threadId);
    const roleRaw = cleanOptionalString(input.role).toLowerCase();
    const role: AssistantRealtimeMessageRole = roleRaw === 'assistant' ? 'assistant' : 'user';
    const text = cleanOptionalString(input.text);
    if (!text) return { ok: true, threadId: thread.id, accepted: false };

    this.clearThreadStreamingMessages(thread.id, role);
    thread.messages.push(sanitizeMessage(makeAssistantTextMessage(role, text)));
    thread.messages = thread.messages.slice(-ASSISTANT_THREAD_MESSAGE_LIMIT);
    if (thread.title === DEFAULT_THREAD_TITLE || thread.title === 'Voice thread' || thread.title === 'Realtime thread' || thread.title === 'Desktop realtime voice thread' || thread.title === 'Desktop realtime thread') {
      const firstUser = thread.messages.find((message) => message?.role === 'user');
      if (firstUser) thread.title = titleFromPrompt(textFromMessage(firstUser));
    }
    thread.updatedAt = nowIso();
    this.activeThreadId = thread.id;
    this.emitChange('realtime_message_appended', thread.id);
    await this.persist();
    return { ok: true, threadId: thread.id, accepted: true };
  }

  async updateRealtimeStreamingMessage(input: {
    threadId?: unknown;
    role?: unknown;
    text?: unknown;
  }): Promise<{ ok: true; threadId: string; accepted: boolean }> {
    await this.ensureLoaded();
    const threadId = cleanOptionalString(input.threadId) || (await this.ensureLatestVoiceThread({ title: 'Desktop realtime thread' })).threadId;
    const thread = this.getThread(threadId);
    const roleRaw = cleanOptionalString(input.role).toLowerCase();
    const role: AssistantRealtimeMessageRole = roleRaw === 'assistant' ? 'assistant' : 'user';
    const text = cleanOptionalString(input.text);
    if (!text) return { ok: true, threadId: thread.id, accepted: false };

    this.setThreadStreamingMessage(thread.id, makeAssistantTextMessage(role, text));
    thread.updatedAt = nowIso();
    this.activeThreadId = thread.id;
    this.emitChange('realtime_streaming_message', thread.id);
    return { ok: true, threadId: thread.id, accepted: true };
  }

  async clearRealtimeStreamingMessage(input?: { threadId?: unknown }): Promise<{ ok: true; threadId: string; cleared: boolean }> {
    await this.ensureLoaded();
    const threadId = cleanOptionalString(input?.threadId) || (await this.ensureLatestVoiceThread({ title: 'Desktop realtime thread' })).threadId;
    const thread = this.getThread(threadId);
    const cleared = this.clearThreadStreamingMessages(thread.id);
    if (cleared) this.emitChange('realtime_streaming_message_cleared', thread.id);
    return { ok: true, threadId: thread.id, cleared };
  }

  async executeRealtimeTool(input: {
    threadId?: unknown;
    toolCallId?: unknown;
    toolName?: unknown;
    arguments?: unknown;
    source?: AssistantVoiceSource | null;
    signal?: AbortSignal;
  }): Promise<AssistantRealtimeToolExecutionResult> {
    await this.ensureLoaded();
    const threadId = cleanOptionalString(input.threadId) || (await this.ensureLatestVoiceThread({ title: 'Desktop realtime thread' })).threadId;
    const thread = this.getThread(threadId);
    const toolName = cleanOptionalString(input.toolName);
    if (!toolName) throw new Error('missing realtime tool name');
    if (!this.realtimeToolExecuteDelegate || toolName === 'speak') throw new Error(`assistant realtime tool unavailable: ${toolName}`);

    const toolCallId = cleanOptionalString(input.toolCallId) || makeAssistantId('realtime-tool');
    const args = parseAssistantRealtimeToolArguments(input.arguments);
    const alreadyHasToolCall = thread.messages.some((message) =>
      message?.role === 'assistant' &&
      Array.isArray(message?.content) &&
      message.content.some((part: any) => part?.type === 'toolCall' && String(part?.id ?? '') === toolCallId),
    );
    if (!alreadyHasToolCall) {
      thread.messages.push(sanitizeMessage(makeAssistantToolCallMessage(toolCallId, toolName, args)));
      thread.messages = thread.messages.slice(-ASSISTANT_THREAD_MESSAGE_LIMIT);
      thread.updatedAt = nowIso();
      await this.persist();
    }

    try {
      const result = await this.realtimeToolExecuteDelegate(thread.id, toolCallId, toolName, args, input.signal);
      thread.messages.push(sanitizeMessage(makeAssistantToolResultMessage(toolCallId, toolName, result)));
      thread.messages = thread.messages.slice(-ASSISTANT_THREAD_MESSAGE_LIMIT);
      thread.updatedAt = nowIso();
      await this.persist();
      return {
        ok: true,
        threadId: thread.id,
        toolCallId,
        toolName,
        output: assistantRealtimeToolOutput(result),
        result: sanitizeMessage(result?.details ?? result),
      };
    } catch (error: any) {
      const message = cleanOptionalString(error?.message ?? error) || `${toolName} failed.`;
      thread.messages.push(sanitizeMessage(makeAssistantToolResultMessage(toolCallId, toolName, { ok: false, error: message }, message)));
      thread.messages = thread.messages.slice(-ASSISTANT_THREAD_MESSAGE_LIMIT);
      thread.updatedAt = nowIso();
      thread.error = message;
      await this.persist();
      throw error;
    }
  }

  private async beforeToolCall(
    threadId: string,
    ctx: any,
    onEvent?: (event: AssistantPromptEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<{ block?: boolean; reason?: string } | undefined> {
    const toolName = String(ctx?.toolCall?.name ?? '').trim();
    if (toolName !== 'message_drone' && toolName !== 'set_drone_group' && toolName !== 'set_drone_groups' && toolName !== 'rename_drones' && toolName !== 'bash') return undefined;
    const label =
      toolName === 'set_drone_group'
        ? 'Set drone group'
        : toolName === 'set_drone_groups'
          ? 'Set drone groups'
        : toolName === 'rename_drones'
          ? 'Rename drones'
          : toolName === 'bash'
            ? 'Run bash in drone'
            : 'Send message to drone';
    let approvalArgs = ctx?.args ?? {};
    if (toolName === 'bash') {
      const drones = await this.tools.listDrones();
      const rawDroneId = cleanOptionalString(ctx?.args?.droneId);
      const scopedDroneId = await this.requireDroneInScope(rawDroneId, 'write', threadId);
      const drone =
        drones.find((item) => item.id === scopedDroneId) ??
        drones.find((item) => item.name === rawDroneId) ??
        null;
      if (drone && String(drone.runtime ?? '').trim() !== 'container') {
        return { block: true, reason: `bash is only supported for container drones: ${drone.name}` };
      }
      const cwd = cleanOptionalString(ctx?.args?.cwd);
      approvalArgs = {
        requested: ctx?.args ?? {},
        resolved: {
          droneId: drone?.id ?? scopedDroneId,
          droneName: drone?.name ?? scopedDroneId,
          command: String(ctx?.args?.command ?? ''),
          ...(cwd ? { cwd: normalizeAssistantDroneFilePath(cwd) } : {}),
          timeoutMs: clampAssistantBashTimeout(ctx?.args?.timeoutMs),
        },
      };
    } else {
      try {
        if (toolName === 'set_drone_group') {
          const regAny: any = await loadRegistry();
          const rawList = Array.isArray(ctx?.args?.droneIds) ? ctx.args.droneIds : [];
          const drones = await this.tools.listDrones();
          const droneNameById = new Map(drones.map((drone) => [drone.id, drone.name]));
          const droneIds: string[] = Array.from(new Set(rawList.map((item: any) => droneIdByAssistantRef(regAny, item))));
          const allowed = this.allowedDroneIdSet('write', threadId);
          if (allowed) {
            const denied = droneIds.filter((id) => !allowed.has(id));
            if (denied.length > 0) throw new Error(`assistant scope does not include drone: ${denied.join(', ')}`);
          }
          approvalArgs = {
            requested: ctx?.args ?? {},
            resolved: {
              drones: droneIds.map((id) => ({ id, name: droneNameById.get(id) ?? id })),
              group: normalizeAssistantGroupValue(ctx?.args?.group),
            },
          };
        } else if (toolName === 'set_drone_groups') {
          const regAny: any = await loadRegistry();
          const normalized = normalizeAssistantSetDroneGroupAssignments(ctx?.args ?? {});
          const drones = await this.tools.listDrones();
          const droneNameById = new Map(drones.map((drone) => [drone.id, drone.name]));
          const assignments = normalized.map((assignment) => ({
            group: assignment.group,
            drones: Array.from(new Set(assignment.droneRefs.map((ref) => droneIdByAssistantRef(regAny, ref))))
              .map((id) => ({ id, name: droneNameById.get(id) ?? id })),
          }));
          const allowed = this.allowedDroneIdSet('write', threadId);
          if (allowed) {
            const denied = assignments.flatMap((assignment) => assignment.drones.map((drone) => drone.id)).filter((id) => !allowed.has(id));
            if (denied.length > 0) throw new Error(`assistant scope does not include drone: ${Array.from(new Set(denied)).join(', ')}`);
          }
          approvalArgs = {
            requested: ctx?.args ?? {},
            resolved: { assignments },
          };
        } else if (toolName === 'rename_drones') {
          const regAny: any = await loadRegistry();
          const requests = normalizeAssistantRenameRequests(ctx?.args ?? {});
          const drones = await this.tools.listDrones();
          const droneNameById = new Map(drones.map((drone) => [drone.id, drone.name]));
          const renames = requests.map((request) => {
            const id = droneIdByAssistantRef(regAny, request.droneId);
            return { id, oldName: droneNameById.get(id) ?? id, newName: request.newName };
          });
          const allowed = this.allowedDroneIdSet('write', threadId);
          if (allowed) {
            const denied = renames.map((item) => item.id).filter((id) => !allowed.has(id));
            if (denied.length > 0) throw new Error(`assistant scope does not include drone: ${denied.join(', ')}`);
          }
          approvalArgs = {
            requested: ctx?.args ?? {},
            resolved: { renames },
          };
        } else if (toolName === 'message_drone') {
          const drones = await this.tools.listDrones();
          const rawDroneId = cleanOptionalString(ctx?.args?.droneId);
          const scopedDroneId = await this.requireDroneInScope(rawDroneId, 'write', threadId);
          const drone =
            drones.find((item) => item.id === scopedDroneId) ??
            drones.find((item) => item.name === rawDroneId) ??
            null;
          const droneId = drone?.id ?? scopedDroneId;
          approvalArgs = {
            requested: ctx?.args ?? {},
            resolved: {
              droneId,
              droneName: drone?.name ?? droneId,
              chatName: normalizeChatNameForAssistant(ctx?.args?.chatName),
              message: cleanOptionalString(ctx?.args?.message ?? ctx?.args?.prompt),
            },
          };
        }
      } catch (error: any) {
        return { block: true, reason: cleanOptionalString(error?.message ?? error) || `Denied ${toolName}.` };
      }
    }
    if (this.getThread(threadId).autoApprove) return undefined;
    const approval = await this.requestApproval({
      threadId,
      toolCallId: String(ctx?.toolCall?.id ?? '').trim(),
      toolName,
      label,
      args: approvalArgs,
      onEvent,
      signal,
    });
    if (approval) return undefined;
    return { block: true, reason: `User denied ${toolName}.` };
  }

  private async requestApproval(input: {
    threadId: string;
    toolCallId: string;
    toolName: string;
    label: string;
    args: any;
    onEvent?: (event: AssistantPromptEvent) => void | Promise<void>;
    signal?: AbortSignal;
  }): Promise<boolean> {
    const approvalId = makeAssistantId('approval');
    const approval: AssistantApproval = {
      id: approvalId,
      threadId: input.threadId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      label: input.label,
      args: sanitizeMessage(input.args),
      createdAt: nowIso(),
      status: 'pending',
    };
    const thread = this.getThread(input.threadId);
    thread.status = 'waiting_for_approval';
    await new Promise<void>((resolve) => {
      const entry = {
        ...approval,
        resolve: (approved: boolean) => {
          approval.status = approved ? 'approved' : 'denied';
          thread.status = 'running';
          this.emitChange('approval_resolved', input.threadId);
          resolve();
        },
      };
      this.approvals.set(approvalId, entry);
      void input.onEvent?.({ type: 'approval_pending', approval, snapshot: this.snapshotSyncFallback(input.threadId) });
      this.emitChange('approval_pending', input.threadId);
      if (input.signal) {
        input.signal.addEventListener(
          'abort',
          () => {
            if (!this.approvals.has(approvalId)) return;
            this.approvals.delete(approvalId);
            entry.resolve(false);
          },
          { once: true },
        );
      }
    });
    return approval.status === 'approved';
  }

  private snapshotSyncFallback(threadId?: string): AssistantSnapshot {
    const id = cleanOptionalString(threadId) || this.activeThreadId;
    const targetThread = this.threads.find((thread) => thread.id === id) ?? firstThread(this.threads, this.activeThreadId);
    const snapshotThreadId = targetThread.id;
    const streamingMessages = this.threadStreamingMessages(snapshotThreadId);
    const streamingMessage = this.primaryThreadStreamingMessage(snapshotThreadId);
    return {
      ok: true,
      activeThreadId: snapshotThreadId,
      threads: this.threads.map((thread) =>
        thread.id === snapshotThreadId ? { ...sanitizeThread(thread), messages: thread.messages.map(sanitizeMessage) } : sanitizeThreadSummary(thread),
      ),
      chatIdleSubscriptions: [],
      pendingApprovals: this.pendingApprovals(),
      models: [],
      availableTools: ASSISTANT_TOOL_SUMMARIES,
      accessScope: sanitizeMessage(targetThread.accessScope ?? makeAssistantAccessScope()),
      runningModels: {},
      ...(streamingMessage ? { streamingMessage: sanitizeMessage(streamingMessage), streamingMessages } : {}),
    };
  }

  private pendingApprovals(): AssistantApproval[] {
    return [...this.approvals.values()].map((approval) => ({
      id: approval.id,
      threadId: approval.threadId,
      toolCallId: approval.toolCallId,
      toolName: approval.toolName,
      label: approval.label,
      args: sanitizeMessage(approval.args),
      createdAt: approval.createdAt,
      status: approval.status,
    }));
  }

  private buildOverviewInput(thread: AssistantThread, messageOverride?: any[]): string {
    const streamingMessages = this.activeThreadId === thread.id ? this.threadStreamingMessages(thread.id) : [];
    const storedMessages = Array.isArray(messageOverride) ? messageOverride : thread.messages;
    const messages = streamingMessages.length > 0 ? [...storedMessages, ...streamingMessages] : storedMessages;
    const approvals = this.pendingApprovals().filter((approval) => approval.threadId === thread.id && approval.status === 'pending');
    const activeSubscriptions: AssistantChatIdleSubscription[] = [];
    const accessScope = thread.accessScope ?? makeAssistantAccessScope();

    const header = [
      `# Assistant Thread`,
      `Thread id: ${thread.id}`,
      `Title: ${thread.title}`,
      `Status: ${thread.status}`,
      thread.error ? `Error: ${thread.error}` : null,
      `Updated at: ${thread.updatedAt}`,
      `Model: ${thread.provider}/${thread.model} (${thread.thinkingLevel})`,
      `Access: read=${describeAssistantAccessMode(accessScope.readMode, accessScope.droneIds)}; write=${describeAssistantAccessMode(accessScope.writeMode, accessScope.droneIds)}`,
      approvals.length > 0
        ? `Pending approvals:\n${approvals
            .map((approval, index) => `${index + 1}. ${approval.label || approval.toolName} (${approval.toolName}, ${approval.createdAt})`)
            .join('\n')}`
        : `Pending approvals: none`,
      activeSubscriptions.length > 0
        ? `Waiting for chats idle:\n${activeSubscriptions
            .map((subscription, index) => `${index + 1}. ${subscription.targets.map((target) => `${target.droneId}/${target.chatName}`).join(', ')}`)
            .join('\n')}`
        : `Waiting for chats idle: no`,
      '',
      'Messages below are chronological. Older messages may be omitted to fit the input budget; the latest messages are retained.',
    ]
      .filter((line): line is string => typeof line === 'string')
      .join('\n');

    const budget = Math.max(4000, ASSISTANT_OVERVIEW_INPUT_MAX_CHARS - header.length - 2);
    const blocks = messages.map((message, index) => assistantOverviewMessageText(message, index));
    const selected: string[] = [];
    let used = 0;
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const block = blocks[i];
      const nextUsed = used + block.length + (selected.length > 0 ? 2 : 0);
      if (nextUsed > budget && selected.length > 0) break;
      if (nextUsed > budget) {
        selected.unshift(clipAssistantOverviewText(block, budget));
        break;
      }
      selected.unshift(block);
      used = nextUsed;
    }
    return [header, selected.length > 0 ? selected.join('\n\n') : '(no messages yet)'].join('\n\n');
  }

  private systemPromptSettingsSync(): AssistantSystemPromptSettings {
    const prompt = normalizeAssistantSystemPrompt(this.defaultSystemPrompt) || ASSISTANT_SYSTEM_PROMPT_DEFAULT;
    const voicePrompt = normalizeAssistantSystemPrompt(this.defaultVoiceSystemPrompt) || ASSISTANT_SYSTEM_PROMPT_DEFAULT;
    return {
      ok: true,
      assistantSystemPrompt: {
        prompt,
        promptSource: prompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? 'default' : 'settings',
        updatedAt: prompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? null : this.defaultSystemPromptUpdatedAt,
        defaultPrompt: ASSISTANT_SYSTEM_PROMPT_DEFAULT,
        maxPromptChars: ASSISTANT_SYSTEM_PROMPT_MAX_CHARS,
        runtimeAppendix: ASSISTANT_SYSTEM_PROMPT_RUNTIME_APPENDIX,
      },
      assistantVoiceSystemPrompt: {
        prompt: voicePrompt,
        promptSource: voicePrompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? 'default' : 'settings',
        updatedAt: voicePrompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? null : this.defaultVoiceSystemPromptUpdatedAt,
        defaultPrompt: ASSISTANT_SYSTEM_PROMPT_DEFAULT,
        maxPromptChars: ASSISTANT_SYSTEM_PROMPT_MAX_CHARS,
        runtimeAppendix: ASSISTANT_SYSTEM_PROMPT_RUNTIME_APPENDIX,
      },
    };
  }

  private threadSystemPromptSettingsSync(threadId: string): AssistantThreadSystemPromptSettings {
    const thread = this.getThread(threadId);
    const globalPrompt = this.defaultSystemPromptForThread(thread);
    const prompt = normalizeAssistantSystemPrompt(thread.systemPrompt) || globalPrompt;
    const globalPromptSource = globalPrompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? 'default' : 'settings';
    const promptSource =
      prompt === globalPrompt
        ? globalPromptSource === 'default'
          ? 'default'
          : 'global'
        : 'thread';
    return {
      ok: true,
      threadId: thread.id,
      threadSystemPrompt: {
        prompt,
        promptSource,
        updatedAt: promptSource === 'thread' ? thread.systemPromptUpdatedAt : null,
        globalPrompt,
        globalPromptSource,
        defaultPrompt: ASSISTANT_SYSTEM_PROMPT_DEFAULT,
        maxPromptChars: ASSISTANT_SYSTEM_PROMPT_MAX_CHARS,
        runtimeAppendix: ASSISTANT_SYSTEM_PROMPT_RUNTIME_APPENDIX,
      },
    };
  }

  private overviewPromptSettingsSync(): AssistantOverviewPromptSettings {
    const prompt = normalizeAssistantOverviewPrompt(this.defaultOverviewPrompt) || ASSISTANT_OVERVIEW_PROMPT_DEFAULT;
    return {
      ok: true,
      assistantOverviewPrompt: {
        prompt,
        promptSource: prompt === ASSISTANT_OVERVIEW_PROMPT_DEFAULT ? 'default' : 'settings',
        updatedAt: prompt === ASSISTANT_OVERVIEW_PROMPT_DEFAULT ? null : this.defaultOverviewPromptUpdatedAt,
        defaultPrompt: ASSISTANT_OVERVIEW_PROMPT_DEFAULT,
        maxPromptChars: ASSISTANT_OVERVIEW_PROMPT_MAX_CHARS,
      },
    };
  }

  private systemPrompt(threadId?: string): string {
    const thread = threadId ? this.threads.find((item) => item.id === threadId) : null;
    const accessScope = this.activeAccessScope(threadId);
    const readScope = describeAssistantAccessMode(accessScope.readMode, accessScope.droneIds);
    const writeScope = describeAssistantAccessMode(accessScope.writeMode, accessScope.droneIds);
    const scopeText = `Current access scope: read=${readScope}; write=${writeScope}. Do not claim read or write access outside those scopes.`;
    const basePrompt = normalizeAssistantSystemPrompt(thread?.systemPrompt) || (thread ? this.defaultSystemPromptForThread(thread) : this.defaultSystemPrompt);
    return [basePrompt, scopeText].join('\n\n');
  }
}
