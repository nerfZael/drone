import crypto from 'node:crypto';
import path from 'node:path';
import {
  completedTurnIds as createCompletedTurnIds,
  isAgentTransportInterruption,
  isSendInNewChatQueueAction,
  normalizeChangeRequestPermissions,
  normalizePendingPromptState,
} from '@drone/assistant-chat';
import type {
  AgentApprovalPolicy,
  AgentPermissionMode,
  NativeAgentDefaultModel,
  NativeAgentDefaultSettings,
  NativeAgentWorkspaceSummary,
  NativeChatAccessScope,
  NativeChatApproval,
  NativeChatSnapshot,
  NativeChatStatus,
  NativeChatThread,
  NativePromptDeliveryMode,
  NativeQueuedPrompt,
} from '@drone/assistant-chat';

import { loadAssistantState, saveAssistantState } from '../host/assistant-store';
import {
  getPromptQueueRepository,
  type PromptQueueRepository,
  type PromptQueueRecord,
  type PromptSubmissionSource,
} from '../host/prompt-queue-repository';
import { loadRegistry } from '../host/registry';
import {
  hubLog,
  parseLlmProvider,
  resolveEffectiveProviderApiKeySettings,
  toBlipModelProvider,
  type LlmProviderId,
} from './hub-settings';
import {
  deleteAssistantArtifactsForThread,
  listAssistantArtifactFiles,
  readAssistantArtifactFile,
  runAssistantArtifactAction,
  saveAssistantArtifactUploads,
  type AssistantArtifactActionInput,
} from './assistant-artifacts';
import {
  ASSISTANT_SYSTEM_PROMPT_MAX_CHARS,
  CHAT_MESSAGE_DEFAULT_LIMIT,
  CHAT_MESSAGE_MAX_LIMIT,
  CHAT_MESSAGE_RESPONSE_MAX_BYTES,
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
  ASSISTANT_MULTI_TARGET_PROMPT_LINE,
  ASSISTANT_SINGLE_TARGET_PROMPT_LINE,
  ASSISTANT_NO_TARGET_PROMPT_LINE,
  ASSISTANT_SYSTEM_PROMPT_DEFAULT,
  ASSISTANT_TOOL_SUMMARIES,
  ASSISTANT_ALL_TOOL_NAMES,
  ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_PRE_MCP_OPT_IN_DEFAULT_ENABLED_TOOL_NAMES,
  ASSISTANT_DRONE_HUB_MCP_TOOL_NAMES,
  ASSISTANT_READ_ONLY_DENIED_TOOL_NAMES,
  ASSISTANT_WORKSPACE_TOOL_CAPABILITIES,
  ASSISTANT_MODEL_OPTIONS,
} from './assistant/assistant-config';
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
import { isAssistantTransferTemporaryName } from './assistant/is-assistant-transfer-temporary-name';
import { getChatQuestionRequestService } from './chat-question-requests';
import type {
  AssistantChangeEvent,
  AssistantChatIdleStatus,
  AssistantChatIdleTarget,
  AssistantCreateChatResult,
  AssistantCreateDroneResult,
  AssistantCreateGroupResult,
  AssistantDroneSummary,
  AssistantMessageDroneResult,
  AssistantModelOption,
  AssistantRenameDronesResult,
  AssistantReorderDronesResult,
  AssistantSetDroneGroupResult,
  AssistantSetDroneGroupsResult,
  AssistantSystemPromptSettings,
  AssistantThinkingLevel,
  AssistantThreadSystemPromptSettings,
  AssistantToolSummary,
  AssistantUiAction,
} from './assistant/assistant-contracts';
export type {
  AssistantChangeEvent,
  AssistantChatIdleStatus,
  AssistantChatIdleTarget,
  AssistantCreateChatResult,
  AssistantCreateDroneResult,
  AssistantCreateGroupResult,
  AssistantDroneSummary,
  AssistantMessageDroneResult,
  AssistantModelOption,
  AssistantRenameDronesResult,
  AssistantReorderDronesResult,
  AssistantSetDroneGroupResult,
  AssistantSetDroneGroupsResult,
  AssistantSystemPromptSettings,
  AssistantThinkingLevel,
  AssistantThreadSystemPromptSettings,
  AssistantToolSummary,
  AssistantUiAction,
} from './assistant/assistant-contracts';

type AssistantThreadStatus = NativeChatStatus;
type AssistantThread = Omit<NativeChatThread, 'queuedPrompts' | 'thinkingLevel'> & {
  thinkingLevel: AssistantThinkingLevel;
};

type AssistantThreadSnapshot = AssistantThread & {
  queuedPrompts: AssistantQueuedPrompt[];
};

export type AssistantQueuedPrompt = NativeQueuedPrompt;

type AssistantPromptDeliveryMode = NativePromptDeliveryMode;
type AssistantDefaultModel = NativeAgentDefaultModel & { thinkingLevel: AssistantThinkingLevel };
const ASSISTANT_QUEUED_PROMPT_LIMIT = 32;

type AssistantApproval = NativeChatApproval;

type StoredAssistantState = {
  defaultModel?: { provider?: string; model?: string; thinkingLevel?: string };
  defaultEnabledTools?: string[];
  threads?: AssistantThread[];
  webSearchToolMigrationApplied?: boolean;
  fetchContentToolMigrationApplied?: boolean;
  droneHubMcpDefaultOptInMigrationApplied?: boolean;
  askQuestionsDefaultMigrationApplied?: boolean;
  systemPrompt?: string;
  systemPromptUpdatedAt?: string;
  updatedAt?: string;
};

type AssistantRuntime = {
  getModel: (provider: string, model: string) => any;
};

type AssistantPromptEvent =
  | { type: 'snapshot'; snapshot: AssistantSnapshot }
  | { type: 'agent_event'; threadId: string; event: any }
  | { type: 'approval_pending'; approval: AssistantApproval; snapshot: AssistantSnapshot }
  | { type: 'error'; threadId?: string; error: string };

type AssistantAccessScope = NativeChatAccessScope;

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

export type AssistantSnapshot = NativeChatSnapshot;

export type AssistantDefaultSettings = NativeAgentDefaultSettings;

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<any>;

function nowIso(): string {
  return new Date().toISOString();
}

function makeAssistantId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeProvider(raw: unknown): LlmProviderId {
  return parseLlmProvider(raw) ?? 'openai';
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
  return ASSISTANT_MODEL_OPTIONS.some(
    (option) => option.provider === provider && option.id === model,
  )
    ? model
    : defaultModelForProvider(provider);
}

function allowedThinkingLevelForModel(
  provider: LlmProviderId,
  model: string,
  raw: unknown,
): AssistantThinkingLevel {
  const requested = normalizeThinkingLevel(raw);
  if (
    ASSISTANT_MODEL_OPTIONS.some(
      (option) =>
        option.provider === provider && option.id === model && option.thinkingLevel === requested,
    )
  ) {
    return requested;
  }
  return (
    ASSISTANT_MODEL_OPTIONS.find((option) => option.provider === provider && option.id === model)
      ?.thinkingLevel ?? 'off'
  );
}

function supportedThinkingLevelsForModel(
  provider: LlmProviderId,
  model: string,
): AssistantThinkingLevel[] {
  const seen = new Set<AssistantThinkingLevel>();
  const levels: AssistantThinkingLevel[] = [];
  for (const option of ASSISTANT_MODEL_OPTIONS) {
    if (option.provider !== provider || option.id !== model || seen.has(option.thinkingLevel))
      continue;
    seen.add(option.thinkingLevel);
    levels.push(option.thinkingLevel);
  }
  return levels.length > 0 ? levels : ['off'];
}

function normalizeThinkingLevel(raw: unknown): AssistantThinkingLevel {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (value === 'instant' || value === 'none') return 'off';
  if (
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  )
    return value;
  return 'off';
}

function parseThinkingLevelForTool(raw: unknown): AssistantThinkingLevel {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!value) throw new Error('missing thinking level');
  if (value === 'instant' || value === 'none') return 'off';
  if (
    value === 'off' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  )
    return value;
  throw new Error(`invalid thinking level: ${String(raw ?? '')}`);
}

function normalizeAssistantPromptDeliveryMode(raw: unknown): AssistantPromptDeliveryMode {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return value === 'asap' || value === 'steer' || value === 'steering' ? 'asap' : 'queue';
}

function normalizeAssistantAutoApprove(raw: unknown): boolean {
  return (
    raw === true ||
    raw === 1 ||
    String(raw ?? '')
      .trim()
      .toLowerCase() === 'true' ||
    String(raw ?? '').trim() === '1'
  );
}

function normalizeAssistantAgentPermissionMode(raw: unknown): AgentPermissionMode {
  const value = String(raw ?? '').trim();
  return value === 'read' || value === 'write' ? value : 'execute';
}

function normalizeAssistantApprovalPolicy(raw: unknown): AgentApprovalPolicy {
  const value = String(raw ?? '').trim();
  return value === 'none' ? 'none' : 'ask';
}

function parseAssistantAgentPermissionMode(raw: unknown): AgentPermissionMode {
  const value = String(raw ?? '').trim();
  if (value === 'read' || value === 'write' || value === 'execute') return value;
  throw new Error('agentPermissionMode must be read, write, or execute');
}

function parseAssistantApprovalPolicy(raw: unknown): AgentApprovalPolicy {
  const value = String(raw ?? '').trim();
  if (value === 'ask' || value === 'none') return value;
  if (value === 'auto') throw new Error('auto approval policy is only available for Codex chats');
  throw new Error('approvalPolicy must be ask or none for native chats');
}

function makeAssistantUserMessage(
  prompt: string,
  images: Array<{ data: string; mimeType: string }> = [],
): any {
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

function normalizeWebSearchRecencyFilter(
  raw: unknown,
): 'day' | 'week' | 'month' | 'year' | undefined {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return value === 'day' || value === 'week' || value === 'month' || value === 'year'
    ? value
    : undefined;
}

function normalizeFetchContentLivecrawl(
  raw: unknown,
): 'never' | 'fallback' | 'preferred' | 'always' | undefined {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return value === 'never' || value === 'fallback' || value === 'preferred' || value === 'always'
    ? value
    : undefined;
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
    timeout = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      Math.max(0, ms),
    );
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function droneEntryInAssistantCollection(
  collection: any,
  droneIdRaw: unknown,
): { id: string; key: string; drone: any } | null {
  const droneId = String(droneIdRaw ?? '').trim();
  const drones = collection && typeof collection === 'object' ? collection : {};
  const direct = drones[droneId];
  if (direct)
    return {
      id: String((direct as any)?.id ?? droneId).trim() || droneId,
      key: droneId,
      drone: direct,
    };
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

function realDroneEntryByAssistantId(
  regAny: any,
  droneIdRaw: unknown,
): { id: string; drone: any } | null {
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
  const value = String(raw ?? fallbackRaw ?? '')
    .trim()
    .toLowerCase();
  return value === 'host' ? 'host' : 'container';
}

function cleanOptionalString(raw: unknown): string {
  return String(raw ?? '').trim();
}

function normalizeAssistantWorkspaceIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return Array.from(new Set(raw.map((item) => cleanOptionalString(item)).filter(Boolean))).slice(
    0,
    100,
  );
}

function normalizeAssistantRenameRequests(
  raw: unknown,
): Array<{ droneId: string; newName: string }> {
  const input = raw && typeof raw === 'object' ? (raw as any) : {};
  const rawRenames = Array.isArray(input.renames) ? input.renames : [];
  const fallbackDrone = cleanOptionalString(input.droneId ?? input.drone ?? input.id);
  const fallbackNewName = cleanOptionalString(input.newName ?? input.nextName ?? input.name);
  const source =
    rawRenames.length > 0
      ? rawRenames
      : fallbackDrone && fallbackNewName
        ? [{ droneId: fallbackDrone, newName: fallbackNewName }]
        : [];
  const seen = new Set<string>();
  const result: Array<{ droneId: string; newName: string }> = [];
  for (const item of source) {
    const entry = item && typeof item === 'object' ? (item as any) : {};
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

function normalizeAssistantSetDroneGroupAssignments(
  raw: unknown,
): Array<{ droneRefs: string[]; group: string | null }> {
  const input = raw && typeof raw === 'object' ? (raw as any) : {};
  const rawAssignments = Array.isArray(input.assignments) ? input.assignments : [];
  const source =
    rawAssignments.length > 0
      ? rawAssignments
      : Array.isArray(input.droneIds) ||
          Array.isArray(input.drones) ||
          cleanOptionalString(input.droneId ?? input.drone ?? input.id)
        ? [
            {
              droneIds: input.droneIds ?? input.drones,
              droneId: input.droneId ?? input.drone ?? input.id,
              group: input.group,
            },
          ]
        : [];
  const result: Array<{ droneRefs: string[]; group: string | null }> = [];
  for (const item of source) {
    const entry = item && typeof item === 'object' ? (item as any) : {};
    const rawRefs = Array.isArray(entry.droneIds)
      ? entry.droneIds
      : Array.isArray(entry.drones)
        ? entry.drones
        : [];
    const fallbackRef = cleanOptionalString(entry.droneId ?? entry.drone ?? entry.id);
    const droneRefs = Array.from(
      new Set(
        [...rawRefs.map((ref: any) => cleanOptionalString(ref)), fallbackRef].filter(Boolean),
      ),
    );
    if (droneRefs.length === 0) continue;
    const clearGroup = entry.clearGroup === true || String(entry.clearGroup ?? '').trim() === '1';
    if (!clearGroup && !hasAssistantGroupValue(entry.group))
      throw new Error('group is required unless clearGroup is true');
    result.push({
      droneRefs,
      group: clearGroup ? null : normalizeAssistantGroupValue(entry.group),
    });
  }
  if (result.length === 0) throw new Error('missing drone group assignments');
  return result;
}

function normalizeAssistantDroneFilePath(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error('missing file path');
  if (value.includes('\0') || value.includes('\r') || value.includes('\n'))
    throw new Error(`invalid file path: ${value}`);
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (!normalized || normalized === '.') throw new Error('missing file path');
  const withoutLeading = normalized.replace(/^\/+/, '');
  if (withoutLeading === '..' || withoutLeading.startsWith('../'))
    throw new Error(`invalid file path: ${value}`);
  return value.startsWith('/') ? `/${withoutLeading}` : withoutLeading;
}

function replaceTextOnce(
  content: string,
  oldText: string,
  newText: string,
  filePath: string,
): string {
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

function normalizeAssistantEnabledTools(
  raw: unknown,
  fallback: string[] = ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES,
): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const allowed = new Set(ASSISTANT_ALL_TOOL_NAMES);
  const seen = new Set<string>();
  const tools: string[] = [];
  for (const item of raw) {
    const rawName = String(item ?? '').trim();
    const names =
      rawName === 'assistant_files'
        ? ['list_targets', 'set_target']
        : rawName === 'list_changed_files'
          ? ['get_working_tree_status']
          : rawName === 'message_drone'
            ? ['send_message']
            : rawName === 'read_chat_messages'
              ? ['list_chats', 'read_chat']
              : rawName === 'get_chat_overview'
                ? ['list_chats']
                : rawName === 'inspect_drone'
                  ? ['list_drones']
                  : rawName === 'set_drone_groups'
                    ? ['set_drone_group']
                    : [rawName];
    for (const name of names) {
      if (!allowed.has(name) || seen.has(name)) continue;
      seen.add(name);
      tools.push(name);
    }
  }
  return tools;
}

function sameToolSet(rawNames: Set<string>, names: string[]): boolean {
  return rawNames.size === names.length && names.every((name) => rawNames.has(name));
}

function normalizeStoredAssistantEnabledTools(
  raw: unknown,
  _migrations: { webSearchDefaultTool: boolean; fetchContentDefaultTool: boolean },
  fallback?: string[],
): string[] {
  return normalizeAssistantEnabledTools(raw, fallback);
}

function normalizeAssistantSystemPromptPatches(
  raw: unknown,
): Array<{ oldText: string; newText: string }> {
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
    const completedAt =
      typeof turn?.completedAt === 'string' && turn.completedAt.trim()
        ? turn.completedAt.trim()
        : undefined;
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
  const completedTurnIds = createCompletedTurnIds(turns);
  for (const item of pending as any[]) {
    const id = String(item?.id ?? '').trim();
    if (!id || completedTurnIds.has(id)) continue;
    const status: ChatTimelineMessage['status'] = normalizePendingPromptState(
      item?.state,
      'queued',
    );
    out.push({
      id: `user:${id}`,
      role: 'user',
      status,
      text: String(item?.prompt ?? ''),
      at: safeMessageAt(item?.at, nowIso()),
      ...(typeof item?.updatedAt === 'string' && item.updatedAt.trim()
        ? { updatedAt: item.updatedAt.trim() }
        : {}),
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
    (message) =>
      message.role === 'user' &&
      (message.status === 'queued' || message.status === 'sending' || message.status === 'sent'),
  ).length;
  const queuedUserMessages = messages.filter(
    (message) => message.role === 'user' && message.status === 'queued',
  ).length;
  const failedUserMessages = messages.filter(
    (message) => message.role === 'user' && message.status === 'failed',
  ).length;
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
  const idle =
    activeUserMessages === 0 &&
    (reason === 'no_messages' ||
      reason === 'latest_agent_message' ||
      reason === 'latest_user_failed');
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

function makeAssistantAccessScope(input?: {
  readMode?: unknown;
  writeMode?: unknown;
  executeMode?: unknown;
  changeRequestCreate?: unknown;
  changeRequestMerge?: unknown;
  droneIds?: unknown;
  updatedAt?: unknown;
}): AssistantAccessScope {
  const readMode =
    String(input?.readMode ?? '')
      .trim()
      .toLowerCase() === 'selected'
      ? 'selected'
      : 'all';
  const writeMode =
    String(input?.writeMode ?? '')
      .trim()
      .toLowerCase() === 'selected'
      ? 'selected'
      : 'all';
  const executeMode =
    String(input?.executeMode ?? input?.writeMode ?? '')
      .trim()
      .toLowerCase() === 'selected'
      ? 'selected'
      : 'all';
  const rawIds = Array.isArray(input?.droneIds) ? input.droneIds : [];
  const droneIds = Array.from(
    new Set(rawIds.map((item) => cleanOptionalString(item)).filter(Boolean)),
  ).slice(0, 100);
  return {
    readMode,
    writeMode,
    executeMode,
    ...normalizeChangeRequestPermissions(input),
    droneIds:
      readMode === 'selected' || writeMode === 'selected' || executeMode === 'selected'
        ? droneIds
        : [],
    updatedAt: String(input?.updatedAt ?? '').trim() || nowIso(),
  };
}

function makeDefaultAssistantAccessScope(droneIds: string[] = []): AssistantAccessScope {
  return makeAssistantAccessScope({
    writeMode: 'selected',
    executeMode: 'selected',
    droneIds,
  });
}

function describeAssistantAccessMode(
  mode: AssistantAccessScope['readMode'],
  droneIds: string[],
): string {
  if (mode === 'all') return 'all drones';
  if (droneIds.length === 0) return 'no selected drones';
  return `selected drones (${droneIds.join(', ')})`;
}

function sanitizeQueuedPrompt(
  prompt: AssistantQueuedPrompt,
  includeImageData: boolean,
): AssistantQueuedPrompt {
  const promptImages = Array.isArray(prompt.promptImages)
    ? prompt.promptImages.map((image) => ({
        type: 'image' as const,
        data: includeImageData ? String(image?.data ?? '') : '',
        mimeType: String(image?.mimeType ?? 'image/png'),
      }))
    : [];
  return {
    id: cleanOptionalString(prompt.id) || makeAssistantId('queued'),
    prompt: String(prompt.prompt ?? ''),
    promptImages,
    imageCount: promptImages.length,
    createdAt: cleanOptionalString(prompt.createdAt) || nowIso(),
    ...(prompt.deliveryMode ? { deliveryMode: prompt.deliveryMode } : {}),
    status:
      prompt.status === 'failed' ? 'failed' : prompt.status === 'running' ? 'running' : 'queued',
    error: cleanOptionalString(prompt.error) || null,
    ...(isSendInNewChatQueueAction(prompt.action) ? { action: prompt.action } : {}),
  };
}

function sanitizeThread(thread: AssistantThread): AssistantThread {
  return {
    ...thread,
    systemPrompt:
      normalizeAssistantSystemPrompt(thread.systemPrompt) || ASSISTANT_SYSTEM_PROMPT_DEFAULT,
    systemPromptUpdatedAt: cleanOptionalString(thread.systemPromptUpdatedAt) || null,
    enabledTools: normalizeAssistantEnabledTools(thread.enabledTools),
    ...(Array.isArray(thread.enabledWorkspaceIds)
      ? { enabledWorkspaceIds: normalizeAssistantWorkspaceIds(thread.enabledWorkspaceIds) ?? [] }
      : {}),
    status:
      thread.status === 'running' || thread.status === 'waiting_for_approval'
        ? 'idle'
        : thread.status,
  };
}

function normalizeThread(
  raw: any,
  fallback: { provider: LlmProviderId; model: string; systemPrompt?: string },
  options?: {
    migrateWebSearchDefaultTool?: boolean;
    migrateFetchContentDefaultTool?: boolean;
    preserveLegacyImplicitMcpTools?: boolean;
  },
): AssistantThread | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim();
  if (!id) return null;
  const provider = normalizeProvider(raw.provider ?? fallback.provider);
  const model = allowedModelForProvider(provider, raw.model ?? fallback.model);
  const createdAt = String(raw.createdAt ?? '').trim() || nowIso();
  const updatedAt = String(raw.updatedAt ?? '').trim() || createdAt;
  const thinkingLevel = allowedThinkingLevelForModel(provider, model, raw.thinkingLevel);
  const approvalPolicy = normalizeAssistantApprovalPolicy(
    raw.approvalPolicy ?? (normalizeAssistantAutoApprove(raw.autoApprove) ? 'none' : 'ask'),
  );
  return {
    id,
    ...(cleanOptionalString(raw.ownerDroneId)
      ? { ownerDroneId: cleanOptionalString(raw.ownerDroneId) }
      : {}),
    ...(cleanOptionalString(raw.ownerChatName)
      ? { ownerChatName: cleanOptionalString(raw.ownerChatName) }
      : {}),
    title: String(raw.title ?? '').trim() || DEFAULT_THREAD_TITLE,
    createdAt,
    updatedAt,
    model,
    provider,
    thinkingLevel,
    systemPrompt:
      normalizeAssistantSystemPrompt(raw.systemPrompt) ||
      fallback.systemPrompt ||
      ASSISTANT_SYSTEM_PROMPT_DEFAULT,
    systemPromptUpdatedAt: cleanOptionalString(raw.systemPromptUpdatedAt) || null,
    enabledTools: normalizeStoredAssistantEnabledTools(
      raw.enabledTools,
      {
        webSearchDefaultTool: options?.migrateWebSearchDefaultTool === true,
        fetchContentDefaultTool: options?.migrateFetchContentDefaultTool === true,
      },
      options?.preserveLegacyImplicitMcpTools === true
        ? [...ASSISTANT_PRE_MCP_OPT_IN_DEFAULT_ENABLED_TOOL_NAMES]
        : undefined,
    ),
    ...(Array.isArray(raw.enabledWorkspaceIds)
      ? { enabledWorkspaceIds: normalizeAssistantWorkspaceIds(raw.enabledWorkspaceIds) ?? [] }
      : {}),
    accessScope: makeAssistantAccessScope(raw.accessScope),
    agentPermissionMode: normalizeAssistantAgentPermissionMode(raw.agentPermissionMode),
    approvalPolicy,
    autoApprove: approvalPolicy === 'none',
    promptDeliveryMode: normalizeAssistantPromptDeliveryMode(raw.promptDeliveryMode),
    status: raw.status === 'error' ? 'error' : 'idle',
    error: typeof raw.error === 'string' && raw.error.trim() ? raw.error : null,
  };
}

function serializeState(input: {
  defaultModel: AssistantDefaultModel;
  defaultEnabledTools: string[];
  threads: AssistantThread[];
  systemPrompt: string;
  systemPromptUpdatedAt: string | null;
}): StoredAssistantState {
  const systemPrompt =
    normalizeAssistantSystemPrompt(input.systemPrompt) || ASSISTANT_SYSTEM_PROMPT_DEFAULT;
  return {
    defaultModel: input.defaultModel,
    defaultEnabledTools: normalizeAssistantEnabledTools(input.defaultEnabledTools),
    threads: input.threads.map((thread) => sanitizeThread(thread)),
    webSearchToolMigrationApplied: true,
    fetchContentToolMigrationApplied: true,
    droneHubMcpDefaultOptInMigrationApplied: true,
    askQuestionsDefaultMigrationApplied: true,
    ...(systemPrompt !== ASSISTANT_SYSTEM_PROMPT_DEFAULT
      ? {
          systemPrompt,
          systemPromptUpdatedAt: input.systemPromptUpdatedAt ?? nowIso(),
        }
      : {}),
    updatedAt: nowIso(),
  };
}

export class HubAssistantService {
  private threads: AssistantThread[] = [];
  private loaded = false;
  private runtimePromise: Promise<AssistantRuntime> | null = null;
  private runningThreadIds = new Set<string>();
  private defaultSystemPrompt = ASSISTANT_SYSTEM_PROMPT_DEFAULT;
  private defaultSystemPromptUpdatedAt: string | null = null;
  private defaultModelSelection: AssistantDefaultModel = {
    provider: 'openai',
    model: DEFAULT_OPENAI_MODEL,
    thinkingLevel: 'off',
  };
  private defaultEnabledTools = [...ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES];
  private speechToolEnabled = true;
  private changeSequence = 0;
  private readonly changeListeners = new Set<(event: AssistantChangeEvent) => void>();
  private readonly approvals = new Map<string, AssistantApproval>();
  private textPromptDelegate: ((threadId: string, prompt: string) => Promise<void>) | null = null;
  private runtimeStopDelegate: ((threadId: string) => void) | null = null;
  private approvalDecisionDelegate:
    | ((threadId: string, approvalId: string, approved: boolean) => Promise<void>)
    | null = null;

  constructor(private readonly tools: AssistantToolCallbacks) {}

  setTextPromptDelegate(delegate: (threadId: string, prompt: string) => Promise<void>): void {
    this.textPromptDelegate = delegate;
  }

  setRuntimeStopDelegate(delegate: (threadId: string) => void): void {
    this.runtimeStopDelegate = delegate;
  }

  setApprovalDecisionDelegate(
    delegate: (threadId: string, approvalId: string, approved: boolean) => Promise<void>,
  ): void {
    this.approvalDecisionDelegate = delegate;
  }

  setSpeechToolEnabled(enabled: boolean): void {
    if (this.speechToolEnabled === enabled) return;
    this.speechToolEnabled = enabled;
    this.emitChange('speech_settings_changed');
  }

  async notifyCanonicalHistoryChanged(threadId: string): Promise<void> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    thread.updatedAt = nowIso();
    this.emitChange('canonical_history_changed', thread.id);
  }

  async notifyQuestionRequestResolved(threadId: string): Promise<void> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    thread.updatedAt = nowIso();
    await this.persist();
    this.emitChange('question_input_resolved', thread.id);
  }

  async notifyRuntimeEvent(threadId: string, event: any): Promise<void> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const type = String(event?.type ?? '');
    const emit = (reason: string) => this.emitChange(reason, thread.id);

    if (type === 'session_started' || type === 'turn_started') {
      this.runningThreadIds.add(thread.id);
      thread.status = 'running';
      thread.error = null;
      thread.updatedAt = nowIso();
      emit('runtime_started');
      return;
    }
    if (type === 'assistant_delta') {
      // Native chats expose completed assistant messages rather than partial token streams.
      return;
    }
    if (type === 'transcript_changed') {
      this.runningThreadIds.add(thread.id);
      thread.updatedAt = nowIso();
      emit('canonical_history_changed');
      return;
    }
    if (
      type === 'tool_call_started' ||
      type === 'tool_call_progress' ||
      type === 'tool_call_completed' ||
      type === 'tool_call_failed'
    ) {
      this.runningThreadIds.add(thread.id);
      thread.updatedAt = nowIso();
      emit(`runtime_${type}`);
      return;
    }
    if (type === 'tool_call_suspended') {
      const details = event?.details && typeof event.details === 'object' ? event.details : {};
      const questionRequest =
        details?.questionRequest && typeof details.questionRequest === 'object'
          ? details.questionRequest
          : null;
      const approval =
        details?.approval && typeof details.approval === 'object' ? details.approval : {};
      const id = cleanOptionalString(event?.suspensionId);
      if (id && !questionRequest) {
        this.approvals.set(id, {
          id,
          threadId: thread.id,
          toolCallId: cleanOptionalString(event?.callId),
          toolName: cleanOptionalString(event?.tool) || 'tool',
          label:
            cleanOptionalString(approval?.label) || cleanOptionalString(event?.tool) || 'Run tool',
          args: sanitizeMessage(approval?.args ?? {}),
          createdAt: cleanOptionalString(event?.timestamp) || nowIso(),
          status: 'pending',
        });
      }
      this.runningThreadIds.delete(thread.id);
      thread.status = questionRequest ? 'waiting_for_input' : 'waiting_for_approval';
      thread.error = cleanOptionalString(event?.reason) || null;
      thread.updatedAt = nowIso();
      await this.persist();
      emit(
        questionRequest
          ? 'question_input_pending'
          : event?.recoveryRequired
            ? 'approval_recovery_required'
            : 'approval_pending',
      );
      return;
    }
    if (type === 'tool_call_resolved') {
      this.approvals.delete(cleanOptionalString(event?.suspensionId));
      thread.status = 'running';
      thread.error = null;
      thread.updatedAt = nowIso();
      emit('approval_resolved');
      return;
    }
    if (type === 'session_finished') {
      this.runningThreadIds.delete(thread.id);
      const failed = String(event?.status ?? '').trim() === 'error';
      const suspended = String(event?.status ?? '').trim() === 'suspended';
      const waitingForInput =
        getChatQuestionRequestService().listPending(
          thread.ownerDroneId ?? '',
          thread.ownerChatName ?? 'default',
        ).length > 0;
      thread.status = failed
        ? 'error'
        : suspended
          ? waitingForInput
            ? 'waiting_for_input'
            : 'waiting_for_approval'
          : 'idle';
      thread.error = failed
        ? cleanOptionalString(event?.error) || thread.error || 'Built-in agent prompt failed'
        : null;
      thread.updatedAt = nowIso();
      await this.persist();
      emit('runtime_finished');
      return;
    }
    if (type === 'session_error') {
      this.runningThreadIds.delete(thread.id);
      thread.status = 'error';
      thread.error = cleanOptionalString(event?.error) || 'Built-in agent prompt failed';
      thread.updatedAt = nowIso();
      await this.persist();
      emit('runtime_error');
    }
  }

  subscribeChanges(listener: (event: AssistantChangeEvent) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  threadRequiresApproval(threadIdRaw: string): boolean {
    const threadId = cleanOptionalString(threadIdRaw);
    if (!threadId) return false;
    return [...this.approvals.values()].some(
      (approval) => approval.threadId === threadId && approval.status === 'pending',
    );
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

  emitExternalUiAction(
    uiAction: AssistantUiAction,
    threadId?: string,
  ): { ok: true; uiAction: AssistantUiAction } {
    this.emitUiAction(uiAction, threadId);
    return { ok: true, uiAction };
  }

  async updateAccessScope(input: {
    threadId?: unknown;
    mode?: unknown;
    readMode?: unknown;
    writeMode?: unknown;
    executeMode?: unknown;
    changeRequestCreate?: unknown;
    changeRequestMerge?: unknown;
    droneIds?: unknown;
    addDroneIds?: unknown;
  }): Promise<AssistantAccessScope> {
    await this.ensureLoaded();
    const threadId = cleanOptionalString(input.threadId);
    if (!threadId) throw new Error('native chat id is required');
    const thread = this.threads.find((item) => item.id === threadId);
    if (!thread) throw new Error(`unknown assistant thread: ${threadId}`);
    const requestedDroneIds = Array.isArray(input.droneIds)
      ? input.droneIds
      : thread.accessScope.droneIds;
    const addedDroneIds = Array.isArray(input.addDroneIds) ? input.addDroneIds : [];
    thread.accessScope = makeAssistantAccessScope({
      readMode:
        (input as any).readMode ??
        input.mode ??
        thread.accessScope.readMode,
      writeMode:
        (input as any).writeMode ??
        input.mode ??
        thread.accessScope.writeMode,
      executeMode:
        (input as any).executeMode ??
        (input as any).writeMode ??
        input.mode ??
        thread.accessScope.executeMode,
      changeRequestCreate:
        input.changeRequestCreate ?? thread.accessScope.changeRequestCreate,
      changeRequestMerge: input.changeRequestMerge ?? thread.accessScope.changeRequestMerge,
      droneIds: thread.ownerDroneId
        ? [thread.ownerDroneId, ...requestedDroneIds, ...addedDroneIds]
        : [...requestedDroneIds, ...addedDroneIds],
      updatedAt: nowIso(),
    });
    thread.updatedAt = nowIso();
    await this.persist();
    return thread.accessScope;
  }

  private activeAccessScope(threadId: string): AssistantAccessScope {
    const id = cleanOptionalString(threadId);
    const thread = this.threads.find((item) => item.id === id);
    if (!thread) throw new Error(`unknown assistant thread: ${id}`);
    return thread.accessScope;
  }

  private allowedDroneIdSet(
    kind: 'read' | 'write' | 'execute' = 'read',
    threadId?: string,
  ): Set<string> | null {
    if (!threadId) throw new Error('native chat id is required');
    const thread = this.getThread(threadId);
    if (kind === 'write' && thread.agentPermissionMode === 'read') return new Set();
    if (kind === 'execute' && thread.agentPermissionMode !== 'execute') return new Set();
    const accessScope = thread.accessScope;
    const mode =
      kind === 'write'
        ? accessScope.writeMode
        : kind === 'execute'
          ? accessScope.executeMode
          : accessScope.readMode;
    if (mode !== 'selected') return null;
    return new Set(accessScope.droneIds);
  }

  private async requireDroneInScope(
    droneRef: unknown,
    kind: 'read' | 'write' | 'execute' = 'read',
    threadId?: string,
  ): Promise<string> {
    const regAny: any = await loadRegistry();
    const droneId = droneIdByAssistantRef(regAny, droneRef);
    const allowed = this.allowedDroneIdSet(kind, threadId);
    if (allowed && !allowed.has(droneId))
      throw new Error(`assistant ${kind} scope does not include drone: ${droneRef}`);
    return droneId;
  }

  private filterDronesForScope(
    drones: AssistantDroneSummary[],
    threadId?: string,
  ): AssistantDroneSummary[] {
    const allowed = this.allowedDroneIdSet('read', threadId);
    if (!allowed) return drones;
    return drones.filter((drone) => allowed.has(drone.id));
  }

  private requireFileCallback<K extends keyof AssistantToolCallbacks>(
    name: K,
  ): NonNullable<AssistantToolCallbacks[K]> {
    const callback = this.tools[name];
    if (typeof callback !== 'function')
      throw new Error(`assistant file tool unavailable: ${String(name)}`);
    return callback as NonNullable<AssistantToolCallbacks[K]>;
  }

  private async applyDronePatch(threadId: string, params: any): Promise<AssistantApplyPatchResult> {
    const droneId = await this.requireDroneInScope(params?.droneId, 'write', threadId);
    const operations = Array.isArray(params?.operations) ? params.operations : [];
    if (operations.length === 0) throw new Error('patch has no operations');
    const applyHunks = params?.applyHunks;
    if (typeof applyHunks !== 'function') throw new Error('patch hunk engine unavailable');
    const readFile = this.requireFileCallback('readDroneFile');
    const statPath = this.requireFileCallback('statDronePath');
    const batchFiles = this.tools.batchDroneFiles;
    const individualFiles = batchFiles
      ? null
      : {
          write: this.requireFileCallback('writeDroneFile'),
          delete: this.requireFileCallback('deleteDroneFile'),
          move: this.requireFileCallback('moveDroneFile'),
        };
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
      if (existing)
        return !existing.deleted && (existing.content != null || Boolean(existing.moveFrom));
      const stat = await statPath({ droneId, path: filePath });
      return Boolean(stat.exists);
    };

    for (const operation of operations) {
      if (operation.type === 'add') {
        const content = operation.lines.join('\n');
        if (await pathExists(operation.path))
          throw new Error(`file already exists: ${operation.path}`);
        staged.set(operation.path, {
          path: operation.path,
          existsBefore: false,
          content,
          deleted: false,
        });
        applied.push({
          kind: 'add',
          path: operation.path,
          size: Buffer.byteLength(content, 'utf8'),
        });
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
        if (operation.moveTo === operation.path)
          throw new Error(`move target matches source: ${operation.path}`);
        if (await pathExists(operation.moveTo))
          throw new Error(`move target already exists: ${operation.moveTo}`);
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
      applied.push({
        kind: 'update',
        path: operation.path,
        size: Buffer.byteLength(content, 'utf8'),
      });
    }

    const movedSources = new Set<string>();
    if (batchFiles) {
      const mutations: Parameters<typeof batchFiles>[0]['operations'] = [];
      for (const file of staged.values()) {
        if (!file.deleted && file.moveFrom) {
          mutations.push({ type: 'move', fromPath: file.moveFrom, toPath: file.path });
          movedSources.add(file.moveFrom);
        }
      }
      for (const file of staged.values()) {
        if (!file.deleted && file.content != null) {
          mutations.push({ type: 'write', path: file.path, content: file.content });
        }
      }
      for (const file of staged.values()) {
        if (!file.deleted || !file.existsBefore || movedSources.has(file.path)) continue;
        mutations.push({ type: 'delete', path: file.path });
      }
      if (mutations.length > 0) await batchFiles({ droneId, operations: mutations });
    } else {
      if (!individualFiles) throw new Error('assistant file mutation tools unavailable');
      for (const file of staged.values()) {
        if (!file.deleted && file.moveFrom) {
          await individualFiles.move({ droneId, fromPath: file.moveFrom, toPath: file.path });
          movedSources.add(file.moveFrom);
        }
      }
      for (const file of staged.values()) {
        if (!file.deleted && file.content != null) {
          await individualFiles.write({ droneId, path: file.path, content: file.content });
        }
      }
      for (const file of staged.values()) {
        if (!file.deleted || !file.existsBefore || movedSources.has(file.path)) continue;
        await individualFiles.delete({ droneId, path: file.path });
      }
    }

    return { ok: true, droneId, operations: applied };
  }

  async threadSnapshot(threadId: string): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const id = cleanOptionalString(threadId);
    const targetThread = this.threads.find((thread) => thread.id === id);
    if (!targetThread) throw new Error(`unknown assistant thread: ${threadId}`);
    const availableWorkspaces = await this.availableWorkspacesForThread(id);
    const enabledWorkspaces = availableWorkspaces.filter((workspace) =>
      this.workspaceEnabled(targetThread, workspace.id),
    );
    const availableTools = this.availableToolsForWorkspaces(enabledWorkspaces);
    const queuedPrompts = this.queuedPromptsForThread(targetThread, false);
    const snapshotThread = { ...sanitizeThread(targetThread), queuedPrompts };
    return {
      ok: true,
      chatId: id,
      threads: [
        this.runningThreadIds.has(id) ? { ...snapshotThread, status: 'running' } : snapshotThread,
      ],
      pendingApprovals: this.pendingApprovals(id),
      pendingQuestionRequests: getChatQuestionRequestService().listPending(
        targetThread.ownerDroneId ?? '',
        targetThread.ownerChatName ?? 'default',
      ),
      models: await this.modelOptions(),
      defaultModel: { ...this.defaultModelSelection },
      defaultEnabledTools: [...this.defaultEnabledTools],
      availableTools,
      availableWorkspaces,
      accessScope: sanitizeMessage(targetThread.accessScope ?? makeAssistantAccessScope()),
    };
  }

  async ensureNativeThread(input: {
    id: unknown;
    droneId: unknown;
    chatName: unknown;
    title?: unknown;
    provider?: unknown;
    model?: unknown;
    thinkingLevel?: unknown;
    agentPermissionMode?: unknown;
    approvalPolicy?: unknown;
  }): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const id = cleanOptionalString(input.id);
    const ownerDroneId = cleanOptionalString(input.droneId);
    const ownerChatName = cleanOptionalString(input.chatName) || 'default';
    if (!id) throw new Error('native chat id is required');
    if (!ownerDroneId) throw new Error('native chat owner drone is required');
    const existing = this.threads.find((thread) => thread.id === id);
    if (existing) {
      if (existing.ownerDroneId && existing.ownerDroneId !== ownerDroneId)
        throw new Error('native chat is already owned by another drone');
      let metadataChanged = false;
      if (existing.ownerDroneId !== ownerDroneId) {
        existing.ownerDroneId = ownerDroneId;
        metadataChanged = true;
      }
      if (existing.ownerChatName !== ownerChatName) {
        const previousChatName = cleanOptionalString(existing.ownerChatName) || 'default';
        await this.promptQueue()?.renameChat({
          droneId: ownerDroneId,
          chatName: previousChatName,
          newChatName: ownerChatName,
        });
        existing.ownerChatName = ownerChatName;
        metadataChanged = true;
      }
      const requestedTitle = cleanOptionalString(input.title);
      if (requestedTitle && existing.title !== requestedTitle) {
        existing.title = requestedTitle;
        metadataChanged = true;
      }
      if (input.agentPermissionMode != null) {
        const requestedPermissionMode = normalizeAssistantAgentPermissionMode(
          input.agentPermissionMode,
        );
        if (existing.agentPermissionMode !== requestedPermissionMode) {
          existing.agentPermissionMode = requestedPermissionMode;
          metadataChanged = true;
        }
      }
      if (input.approvalPolicy != null) {
        const requestedApprovalPolicy = normalizeAssistantApprovalPolicy(input.approvalPolicy);
        if (existing.approvalPolicy !== requestedApprovalPolicy) {
          existing.approvalPolicy = requestedApprovalPolicy;
          existing.autoApprove = requestedApprovalPolicy === 'none';
          metadataChanged = true;
        }
      }
      if (!existing.accessScope.droneIds.includes(ownerDroneId)) {
        existing.accessScope = makeAssistantAccessScope({
          ...existing.accessScope,
          droneIds: [...existing.accessScope.droneIds, ownerDroneId],
          updatedAt: nowIso(),
        });
        metadataChanged = true;
      }
      if (metadataChanged) existing.updatedAt = nowIso();
      await this.persist();
      return await this.threadSnapshot(id);
    }
    const requestedModel = cleanOptionalString(input.model);
    const requestedProvider = cleanOptionalString(input.provider);
    const catalogModel = requestedModel
      ? ASSISTANT_MODEL_OPTIONS.find((option) => option.id === requestedModel)
      : null;
    const provider = requestedProvider
      ? normalizeProvider(requestedProvider)
      : (catalogModel?.provider ?? this.defaultModelSelection.provider);
    const model = requestedModel || this.defaultModelSelection.model;
    const thread = this.makeThread({
      id,
      ownerDroneId,
      ownerChatName,
      title: cleanOptionalString(input.title) || ownerChatName,
      provider,
      model,
      thinkingLevel: allowedThinkingLevelForModel(
        provider,
        model,
        cleanOptionalString(input.thinkingLevel) || this.defaultModelSelection.thinkingLevel,
      ),
      agentPermissionMode: normalizeAssistantAgentPermissionMode(input.agentPermissionMode),
      approvalPolicy: normalizeAssistantApprovalPolicy(input.approvalPolicy),
      accessScope: makeAssistantAccessScope({
        readMode: 'selected',
        writeMode: 'selected',
        executeMode: 'selected',
        droneIds: [ownerDroneId],
      }),
      enabledWorkspaceIds: [`drone:${ownerDroneId}`],
    });
    this.threads = [thread, ...this.threads];
    await this.persist();
    return await this.threadSnapshot(id);
  }

  async nativeThreadHasHistory(threadIdRaw: unknown): Promise<boolean> {
    await this.ensureLoaded();
    const threadId = cleanOptionalString(threadIdRaw);
    const thread = this.threads.find((item) => item.id === threadId);
    if (!thread) return false;
    return (
      this.queuedPromptsForThread(thread, false).length > 0 ||
      this.runningThreadIds.has(threadId) ||
      getChatQuestionRequestService().listPending(
        thread.ownerDroneId ?? '',
        thread.ownerChatName ?? 'default',
      ).length > 0 ||
      Array.from(this.approvals.values()).some(
        (approval) => approval.threadId === threadId && approval.status === 'pending',
      )
    );
  }

  async nativeThreadIsBusy(threadIdRaw: unknown): Promise<boolean> {
    await this.ensureLoaded();
    const threadId = cleanOptionalString(threadIdRaw);
    const thread = this.threads.find((item) => item.id === threadId);
    if (!thread) return false;
    return (
      this.queuedPromptsForThread(thread, false).some(
        (prompt) => prompt.status === 'queued' || prompt.status === 'running',
      ) ||
      this.runningThreadIds.has(threadId) ||
      getChatQuestionRequestService().listPending(
        thread.ownerDroneId ?? '',
        thread.ownerChatName ?? 'default',
      ).length > 0 ||
      Array.from(this.approvals.values()).some(
        (approval) => approval.threadId === threadId && approval.status === 'pending',
      )
    );
  }

  async nativeThreadHasActiveRun(threadIdRaw: unknown): Promise<boolean> {
    await this.ensureLoaded();
    const threadId = cleanOptionalString(threadIdRaw);
    const thread = this.threads.find((item) => item.id === threadId);
    if (!thread) return false;
    return (
      this.runningThreadIds.has(threadId) ||
      thread.status === 'running' ||
      thread.status === 'waiting_for_approval' ||
      thread.status === 'waiting_for_input' ||
      getChatQuestionRequestService().listPending(
        thread.ownerDroneId ?? '',
        thread.ownerChatName ?? 'default',
      ).length > 0 ||
      Array.from(this.approvals.values()).some(
        (approval) => approval.threadId === threadId && approval.status === 'pending',
      )
    );
  }

  async nativeThreadError(threadIdRaw: unknown): Promise<string> {
    await this.ensureLoaded();
    const threadId = cleanOptionalString(threadIdRaw);
    const thread = this.threads.find((item) => item.id === threadId);
    return cleanOptionalString(thread?.error);
  }

  async beginNativeThreadPrompt(threadIdRaw: unknown): Promise<void> {
    await this.ensureLoaded();
    const threadId = cleanOptionalString(threadIdRaw);
    const thread = this.getThread(threadId);
    if (!thread.error && thread.status !== 'error') return;
    thread.status = 'idle';
    thread.error = null;
    thread.updatedAt = nowIso();
    await this.persist();
  }

  async failNativeThreadPrompt(threadIdRaw: unknown, error: unknown): Promise<void> {
    await this.ensureLoaded();
    const threadId = cleanOptionalString(threadIdRaw);
    const thread = this.getThread(threadId);
    this.runningThreadIds.delete(threadId);
    thread.status = 'error';
    thread.error =
      cleanOptionalString((error as any)?.message ?? error) || 'Built-in agent prompt failed';
    thread.updatedAt = nowIso();
    await this.persist();
    this.emitChange('runtime_error', thread.id);
  }

  async nativeThreadOwner(
    threadIdRaw: unknown,
  ): Promise<{ droneId: string; chatName: string } | null> {
    await this.ensureLoaded();
    const threadId = cleanOptionalString(threadIdRaw);
    const thread = this.threads.find((item) => item.id === threadId);
    const droneId = cleanOptionalString(thread?.ownerDroneId);
    if (!thread || !droneId) return null;
    return {
      droneId,
      chatName: cleanOptionalString(thread.ownerChatName) || 'default',
    };
  }

  async cloneNativeThread(input: {
    sourceId: unknown;
    id: unknown;
    droneId: unknown;
    chatName: unknown;
  }): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const source = this.getThread(cleanOptionalString(input.sourceId));
    const id = cleanOptionalString(input.id);
    const ownerDroneId = cleanOptionalString(input.droneId);
    const ownerChatName = cleanOptionalString(input.chatName) || 'default';
    if (!id || !ownerDroneId) throw new Error('native chat clone identity is required');
    if (this.threads.some((thread) => thread.id === id)) return await this.threadSnapshot(id);
    const clonedEnabledWorkspaceIds = Array.isArray(source.enabledWorkspaceIds)
      ? Array.from(
          new Set([
            ...source.enabledWorkspaceIds.filter(
              (workspaceId) => !workspaceId.startsWith('artifacts:'),
            ),
            `drone:${ownerDroneId}`,
            ...(source.enabledWorkspaceIds.some((workspaceId) =>
              workspaceId.startsWith('artifacts:'),
            )
              ? [`artifacts:${id}`]
              : []),
          ]),
        )
      : undefined;
    const thread = this.makeThread({
      id,
      ownerDroneId,
      ownerChatName,
      title: ownerChatName,
      provider: source.provider,
      model: source.model,
      thinkingLevel: source.thinkingLevel,
      accessScope: makeAssistantAccessScope({
        ...structuredClone(source.accessScope),
        droneIds: Array.from(new Set([...source.accessScope.droneIds, ownerDroneId])),
        updatedAt: nowIso(),
      }),
      systemPrompt: source.systemPrompt,
      agentPermissionMode: source.agentPermissionMode,
      approvalPolicy: source.approvalPolicy,
      ...(clonedEnabledWorkspaceIds ? { enabledWorkspaceIds: clonedEnabledWorkspaceIds } : {}),
    });
    thread.systemPromptUpdatedAt = source.systemPromptUpdatedAt;
    thread.enabledTools = [...source.enabledTools];
    thread.autoApprove = source.autoApprove;
    thread.promptDeliveryMode = source.promptDeliveryMode;
    this.threads = [thread, ...this.threads];
    await this.persist();
    return await this.threadSnapshot(id);
  }

  async systemPromptSettings(): Promise<AssistantSystemPromptSettings> {
    await this.ensureLoaded();
    return this.systemPromptSettingsSync();
  }

  async updateSystemPrompt(input: { prompt?: unknown }): Promise<AssistantSystemPromptSettings> {
    await this.ensureLoaded();
    const prompt = normalizeAssistantSystemPrompt(input.prompt);
    if (!prompt) throw new Error('missing system prompt');
    this.defaultSystemPrompt = prompt;
    this.defaultSystemPromptUpdatedAt =
      prompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? null : nowIso();
    await this.persist();
    return this.systemPromptSettingsSync();
  }

  async threadSystemPromptSettings(threadId: string): Promise<AssistantThreadSystemPromptSettings> {
    await this.ensureLoaded();
    return this.threadSystemPromptSettingsSync(threadId);
  }

  async updateThreadSystemPrompt(
    threadId: string,
    input: { prompt?: unknown; patches?: unknown },
  ): Promise<AssistantThreadSystemPromptSettings> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const hasPrompt = typeof input.prompt === 'string' && input.prompt.trim();
    const prompt = hasPrompt
      ? normalizeAssistantSystemPrompt(input.prompt)
      : applyAssistantSystemPromptPatches(thread.systemPrompt, input.patches);
    if (!prompt) throw new Error('missing system prompt');
    thread.systemPrompt = prompt;
    thread.systemPromptUpdatedAt =
      prompt === this.defaultSystemPromptForThread(thread) ? null : nowIso();
    thread.updatedAt = nowIso();
    await this.persist();
    return this.threadSystemPromptSettingsSync(thread.id);
  }

  async promoteThreadSystemPrompt(
    threadId: string,
    input?: { prompt?: unknown },
  ): Promise<AssistantSystemPromptSettings> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const prompt =
      normalizeAssistantSystemPrompt(input?.prompt) ||
      normalizeAssistantSystemPrompt(thread.systemPrompt);
    if (!prompt) throw new Error('missing thread system prompt');
    thread.systemPrompt = prompt;
    this.defaultSystemPrompt = prompt;
    this.defaultSystemPromptUpdatedAt =
      prompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? null : nowIso();
    thread.systemPromptUpdatedAt = null;
    thread.updatedAt = nowIso();
    await this.persist();
    return this.systemPromptSettingsSync();
  }

  async updateThread(
    threadId: string,
    patch: {
      title?: unknown;
      model?: unknown;
      provider?: unknown;
      thinkingLevel?: unknown;
      autoApprove?: unknown;
      agentPermissionMode?: unknown;
      approvalPolicy?: unknown;
      promptDeliveryMode?: unknown;
      enabledTools?: unknown;
      enabledWorkspaceIds?: unknown;
    },
  ): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const requestedAgentPermissionMode =
      patch.agentPermissionMode != null
        ? parseAssistantAgentPermissionMode(patch.agentPermissionMode)
        : null;
    const requestedApprovalPolicy =
      patch.approvalPolicy != null ? parseAssistantApprovalPolicy(patch.approvalPolicy) : null;
    const title = typeof patch.title === 'string' ? patch.title.trim() : '';
    if (title) thread.title = title.slice(0, 80);
    if (patch.provider != null) thread.provider = normalizeProvider(patch.provider);
    if (patch.model != null || patch.provider != null)
      thread.model = allowedModelForProvider(thread.provider, patch.model ?? thread.model);
    if (patch.thinkingLevel != null || patch.model != null || patch.provider != null) {
      thread.thinkingLevel = allowedThinkingLevelForModel(
        thread.provider,
        thread.model,
        patch.thinkingLevel ?? thread.thinkingLevel,
      );
    }
    if (patch.autoApprove != null) {
      thread.autoApprove = normalizeAssistantAutoApprove(patch.autoApprove);
      thread.approvalPolicy = thread.autoApprove ? 'none' : 'ask';
    }
    if (requestedAgentPermissionMode != null) {
      thread.agentPermissionMode = requestedAgentPermissionMode;
    }
    if (requestedApprovalPolicy != null) {
      thread.approvalPolicy = requestedApprovalPolicy;
      thread.autoApprove = requestedApprovalPolicy === 'none';
    }
    if (patch.promptDeliveryMode != null)
      thread.promptDeliveryMode = normalizeAssistantPromptDeliveryMode(patch.promptDeliveryMode);
    if (patch.enabledTools != null)
      thread.enabledTools = normalizeAssistantEnabledTools(patch.enabledTools, thread.enabledTools);
    if (patch.enabledWorkspaceIds != null) {
      if (!Array.isArray(patch.enabledWorkspaceIds))
        throw new Error('enabledWorkspaceIds must be an array');
      thread.enabledWorkspaceIds = normalizeAssistantWorkspaceIds(patch.enabledWorkspaceIds) ?? [];
    }
    thread.updatedAt = nowIso();
    await this.persist();
    return await this.threadSnapshot(thread.id);
  }

  async updateDefaultModel(input?: {
    provider?: unknown;
    model?: unknown;
    thinkingLevel?: unknown;
  }): Promise<AssistantDefaultSettings> {
    await this.ensureLoaded();
    const provider = normalizeProvider(input?.provider);
    const model = String(input?.model ?? '').trim();
    if (
      !ASSISTANT_MODEL_OPTIONS.some((option) => option.provider === provider && option.id === model)
    ) {
      throw new Error(`unknown assistant model: ${provider}/${model}`);
    }
    const thinkingLevel = allowedThinkingLevelForModel(provider, model, input?.thinkingLevel);
    if (
      this.defaultModelSelection.provider !== provider ||
      this.defaultModelSelection.model !== model ||
      this.defaultModelSelection.thinkingLevel !== thinkingLevel
    ) {
      this.defaultModelSelection = { provider, model, thinkingLevel };
      await this.persist();
    }
    return await this.defaultSettings();
  }

  async updateDefaultEnabledTools(input?: {
    enabledTools?: unknown;
  }): Promise<AssistantDefaultSettings> {
    await this.ensureLoaded();
    if (!Array.isArray(input?.enabledTools)) throw new Error('enabledTools must be an array');
    const enabledTools = normalizeAssistantEnabledTools(
      input.enabledTools,
      this.defaultEnabledTools,
    );
    if (!sameToolSet(new Set(this.defaultEnabledTools), enabledTools)) {
      this.defaultEnabledTools = enabledTools;
      await this.persist();
    }
    return await this.defaultSettings();
  }

  async defaultSettings(): Promise<AssistantDefaultSettings> {
    await this.ensureLoaded();
    return {
      ok: true,
      models: await this.modelOptions(),
      defaultModel: { ...this.defaultModelSelection },
      defaultEnabledTools: [...this.defaultEnabledTools],
    };
  }

  async threadIdsWithQueuedPrompts(): Promise<string[]> {
    await this.ensureLoaded();
    const queue = this.promptQueue();
    if (!queue) return [];
    // Native executions live in this Hub process. Any row it left as `sending` cannot still be
    // running after startup, even when its old lease has not expired yet.
    for (const thread of this.threads) {
      await queue.recoverSendingForChat(this.promptQueueIdentity(thread));
    }
    return this.threads
      .filter((thread) => queue.nextQueued(this.promptQueueIdentity(thread)))
      .map((thread) => thread.id);
  }

  async deleteThread(threadId: string): Promise<{ ok: true; deleted: boolean; threadId: string }> {
    await this.ensureLoaded();
    const existing = this.threads.find((thread) => thread.id === threadId);
    if (existing) {
      await getChatQuestionRequestService().skipPendingForChat(
        existing.ownerDroneId ?? '',
        existing.ownerChatName ?? 'default',
        'chat_stopped',
      );
      this.runtimeStopDelegate?.(threadId);
    }
    this.runningThreadIds.delete(threadId);
    await deleteAssistantArtifactsForThread(threadId);
    if (existing) {
      await this.promptQueue()?.deleteChat(this.promptQueueIdentity(existing));
    }
    const deleted = Boolean(existing);
    this.threads = this.threads.filter((thread) => thread.id !== threadId);
    await this.persist();
    return { ok: true, deleted, threadId };
  }

  async stopThread(threadId: string): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    await getChatQuestionRequestService().skipPendingForChat(
      thread.ownerDroneId ?? '',
      thread.ownerChatName ?? 'default',
      'chat_stopped',
    );
    this.runtimeStopDelegate?.(threadId);
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

  async workspaceDrones(
    threadId: string,
  ): Promise<
    Array<AssistantDroneSummary & { canRead: boolean; canWrite: boolean; canExecute: boolean }>
  > {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const readScope = this.allowedDroneIdSet('read', threadId);
    const writeScope = this.allowedDroneIdSet('write', threadId);
    const executeScope = this.allowedDroneIdSet('execute', threadId);
    return (await this.tools.listDrones()).flatMap((drone) => {
      const canRead = readScope === null || readScope.has(drone.id);
      const canWrite =
        thread.agentPermissionMode !== 'read' && (writeScope === null || writeScope.has(drone.id));
      const canExecute =
        thread.agentPermissionMode === 'execute' &&
        (executeScope === null || executeScope.has(drone.id));
      return canRead || canWrite || canExecute ? [{ ...drone, canRead, canWrite, canExecute }] : [];
    });
  }

  private async availableWorkspacesForThread(
    threadId: string,
  ): Promise<NativeAgentWorkspaceSummary[]> {
    const thread = this.getThread(threadId);
    let drones: Awaited<ReturnType<HubAssistantService['workspaceDrones']>> = [];
    try {
      drones = await this.workspaceDrones(threadId);
    } catch (error: any) {
      hubLog('warn', 'assistant target catalog unavailable while building tool summary', {
        threadId,
        error: error?.message ?? String(error),
      });
    }
    return [
      ...drones.map((drone) => ({
        id: `drone:${drone.id}`,
        label: drone.name || drone.id,
        kind: 'drone' as const,
        description: 'Drone workspace',
        capabilities: [
          ...(drone.canRead ? (['read'] as const) : []),
          ...(drone.canWrite ? (['write'] as const) : []),
          ...(drone.canExecute ? (['execute'] as const) : []),
        ],
      })),
      {
        id: `artifacts:${thread.id}`,
        label: 'Artifacts',
        kind: 'artifacts' as const,
        description: 'Private files for this chat',
        capabilities: [
          'read',
          ...(thread.agentPermissionMode === 'read' ? [] : (['write'] as const)),
        ] as Array<'read' | 'write'>,
      },
    ];
  }

  private workspaceEnabled(thread: AssistantThread, workspaceId: string): boolean {
    // Chats created before workspace toggles existed retain their previous access.
    return (
      !Array.isArray(thread.enabledWorkspaceIds) || thread.enabledWorkspaceIds.includes(workspaceId)
    );
  }

  workspaceIsEnabled(threadId: string, workspaceId: string): boolean {
    return this.workspaceEnabled(this.getThread(threadId), workspaceId);
  }

  async ensureArtifactsWorkspaceEnabled(threadId: string): Promise<boolean> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    if (!Array.isArray(thread.enabledWorkspaceIds)) return false;
    const workspaceId = `artifacts:${thread.id}`;
    if (thread.enabledWorkspaceIds.includes(workspaceId)) return false;
    thread.enabledWorkspaceIds = [...thread.enabledWorkspaceIds, workspaceId];
    thread.updatedAt = nowIso();
    await this.persist();
    return true;
  }

  private availableToolsForWorkspaces(
    workspaces: NativeAgentWorkspaceSummary[],
  ): AssistantToolSummary[] {
    const supportedCapabilities = new Set<string>();
    for (const workspace of workspaces) {
      const capabilities = new Set(workspace.capabilities);
      if (capabilities.has('read')) {
        supportedCapabilities.add('files.list');
        supportedCapabilities.add('files.read');
        supportedCapabilities.add('files.search');
        if (workspace.kind === 'drone') supportedCapabilities.add('git.status');
      }
      if (capabilities.has('write')) {
        supportedCapabilities.add('files.write');
        supportedCapabilities.add('files.delete');
        supportedCapabilities.add('files.move');
        supportedCapabilities.add('directories.create');
        supportedCapabilities.add('directories.delete');
        supportedCapabilities.add('patch.apply');
      }
      if (capabilities.has('execute')) supportedCapabilities.add('shell.execute');
    }

    const workspaceCount = workspaces.length;
    const multiTargetTools = new Set(['list_targets', 'set_target', 'transfer_files']);
    const canTransfer =
      workspaceCount > 1 &&
      workspaces.some((workspace) => workspace.capabilities.includes('read')) &&
      workspaces.some((workspace) => workspace.capabilities.includes('write'));
    return ASSISTANT_TOOL_SUMMARIES.filter((tool) => {
      if (tool.name === 'speak' && !this.speechToolEnabled) return false;
      if (tool.name === 'transfer_files') return canTransfer;
      if (multiTargetTools.has(tool.name)) return workspaceCount > 1;
      const capability =
        ASSISTANT_WORKSPACE_TOOL_CAPABILITIES[
          tool.name as keyof typeof ASSISTANT_WORKSPACE_TOOL_CAPABILITIES
        ];
      return !capability || supportedCapabilities.has(capability);
    });
  }

  private promptQueue(): PromptQueueRepository | null {
    return getPromptQueueRepository();
  }

  private requirePromptQueue(): PromptQueueRepository {
    const queue = this.promptQueue();
    if (!queue) throw new Error('native prompt queue is unavailable');
    return queue;
  }

  private promptQueueIdentity(thread: AssistantThread): { droneId: string; chatName: string } {
    const droneId = cleanOptionalString(thread.ownerDroneId);
    if (!droneId) throw new Error(`native chat has no owner: ${thread.id}`);
    return {
      droneId,
      chatName: cleanOptionalString(thread.ownerChatName) || 'default',
    };
  }

  private queuedPromptFromRecord(
    record: PromptQueueRecord,
    includeImageData: boolean,
  ): AssistantQueuedPrompt {
    const attachments =
      record.attachments && typeof record.attachments === 'object'
        ? (record.attachments as any)
        : {};
    const promptImages = Array.isArray(attachments.promptImages) ? attachments.promptImages : [];
    return sanitizeQueuedPrompt(
      {
        id: record.id,
        prompt: record.prompt,
        promptImages,
        imageCount: promptImages.length,
        createdAt: record.at,
        deliveryMode: record.deliveryMode === 'asap' ? 'asap' : 'queue',
        status:
          record.state === 'failed' ? 'failed' : record.state === 'sending' ? 'running' : 'queued',
        error: cleanOptionalString(record.error ?? record.lastError) || null,
        ...(record.queueInterruption ? { queueInterruption: record.queueInterruption } : {}),
        ...(isSendInNewChatQueueAction(record.action) ? { action: record.action } : {}),
      },
      includeImageData,
    );
  }

  private queuedPromptsForThread(
    thread: AssistantThread,
    includeImageData: boolean,
  ): AssistantQueuedPrompt[] {
    const identity = this.promptQueueIdentity(thread);
    const queue = this.promptQueue();
    if (!queue) return [];
    return queue
      .listPending(identity)
      .map((record) => this.queuedPromptFromRecord(record, includeImageData));
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
    const write = [
      'write_file',
      'delete_file',
      'move_path',
      'create_directory',
      'delete_directory',
      'apply_patch',
      'transfer_mkdir',
      'transfer_prepare',
      'transfer_write',
      'transfer_commit',
      'transfer_abort',
    ].includes(call.tool);
    const permission = call.tool === 'bash' ? 'execute' : write ? 'write' : 'read';
    const droneId = await this.requireDroneInScope(droneRef, permission, threadId);
    const params: any = call.args ?? {};
    if (call.tool === 'transfer_stat') {
      const result = await this.requireFileCallback('statDronePath')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
      });
      if (!result.exists || (result.kind !== 'file' && result.kind !== 'directory'))
        throw new Error(`transfer source was not found: ${String(params.path ?? '')}`);
      return {
        type: result.kind,
        size: result.kind === 'file' ? (result.size ?? 0) : 0,
        mtimeMs: result.mtimeMs,
      };
    }
    if (call.tool === 'transfer_list') {
      const result = await this.requireFileCallback('listDroneFiles')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
      });
      return {
        entries: result.entries.flatMap((entry) =>
          (entry.kind === 'file' || entry.kind === 'directory') &&
          !isAssistantTransferTemporaryName(entry.name)
            ? [
                {
                  name: entry.name,
                  type: entry.kind,
                  size: entry.kind === 'file' ? (entry.size ?? 0) : 0,
                  mtimeMs: entry.mtimeMs,
                },
              ]
            : [],
        ),
      };
    }
    if (call.tool === 'transfer_read') {
      return await this.requireFileCallback('readDroneFileChunk')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
        offset: Number(params.offset),
        length: Number(params.length),
      });
    }
    if (call.tool === 'transfer_mkdir') {
      await this.requireFileCallback('createDroneTransferDirectory')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
      });
      return { ok: true };
    }
    if (call.tool === 'transfer_prepare') {
      return await this.requireFileCallback('prepareDroneTransferFile')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
        transferId: String(params.transferId ?? ''),
        size: Number(params.size),
        overwrite: params.overwrite === true,
      });
    }
    if (call.tool === 'transfer_write') {
      return await this.requireFileCallback('writeDroneTransferChunk')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
        transferId: String(params.transferId ?? ''),
        offset: Number(params.offset),
        dataBase64: String(params.dataBase64 ?? ''),
      });
    }
    if (call.tool === 'transfer_commit') {
      await this.requireFileCallback('commitDroneTransferFile')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
        transferId: String(params.transferId ?? ''),
        size: Number(params.size),
        overwrite: params.overwrite === true,
      });
      return { ok: true };
    }
    if (call.tool === 'transfer_abort') {
      await this.requireFileCallback('abortDroneTransferFile')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
        transferId: String(params.transferId ?? ''),
      });
      return { ok: true };
    }
    if (call.tool === 'list_files') {
      const rawPath = cleanOptionalString(params.path);
      const result = await this.requireFileCallback('listDroneFiles')({
        droneId,
        path: rawPath ? normalizeAssistantDroneFilePath(rawPath) : undefined,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    }
    if (call.tool === 'read_file') {
      const startLine = normalizeOptionalPositiveLine(params.startLine, 'startLine');
      const endLine = normalizeOptionalPositiveLine(params.endLine, 'endLine');
      if (startLine != null && endLine != null && startLine > endLine)
        throw new Error('startLine must be less than or equal to endLine');
      const result = await this.requireFileCallback('readDroneFile')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
        startLine,
        endLine,
      });
      return {
        content: [{ type: 'text', text: formatAssistantReadFileToolText(result) }],
        details: result,
      };
    }
    if (call.tool === 'search_files') {
      const query = cleanOptionalString(params.query);
      if (!query) throw new Error('missing query');
      const rawPath = cleanOptionalString(params.path);
      const result = await this.requireFileCallback('searchDroneFiles')({
        droneId,
        query,
        path: rawPath ? normalizeAssistantDroneFilePath(rawPath) : undefined,
        limit: Number.isFinite(Number(params.limit))
          ? Math.max(1, Math.min(100, Math.floor(Number(params.limit))))
          : 20,
        contextBefore: normalizeSearchContextLines(params.contextBefore, 'contextBefore'),
        contextAfter: normalizeSearchContextLines(params.contextAfter, 'contextAfter'),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    }
    if (call.tool === 'write_file') {
      const result = await this.requireFileCallback('writeDroneFile')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
        content: String(params.content ?? ''),
      });
      return {
        content: [{ type: 'text', text: `Wrote ${result.path} (${result.size ?? 0} bytes).` }],
        details: result,
      };
    }
    if (call.tool === 'delete_file') {
      const result = await this.requireFileCallback('deleteDroneFile')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
      });
      return { content: [{ type: 'text', text: `Deleted ${result.path}.` }], details: result };
    }
    if (call.tool === 'move_path') {
      const result = await this.requireFileCallback('moveDronePath')({
        droneId,
        fromPath: normalizeAssistantDroneFilePath(params.from),
        toPath: normalizeAssistantDroneFilePath(params.to),
        overwrite: params.overwrite === true,
      });
      return {
        content: [{ type: 'text', text: `Moved ${result.path} to ${result.movedTo}.` }],
        details: result,
      };
    }
    if (call.tool === 'create_directory') {
      const result = await this.requireFileCallback('createDroneDirectory')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
        recursive: params.recursive === true,
      });
      return {
        content: [{ type: 'text', text: `Created directory ${result.path}.` }],
        details: result,
      };
    }
    if (call.tool === 'delete_directory') {
      const result = await this.requireFileCallback('deleteDroneDirectory')({
        droneId,
        path: normalizeAssistantDroneFilePath(params.path),
        recursive: params.recursive === true,
      });
      return {
        content: [{ type: 'text', text: `Deleted directory ${result.path}.` }],
        details: result,
      };
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
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    }
    if (call.tool === 'get_working_tree_status') {
      const result = await this.requireFileCallback('listDroneChangedFiles')({ droneId });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    }
    if (call.tool === 'apply_patch') {
      if (!patchEngine) throw new Error('patch engine unavailable');
      const result = await this.applyDronePatch(threadId, {
        droneId,
        operations: patchEngine.parse(String(params.patch ?? '')),
        applyHunks: patchEngine.applyHunks,
      });
      return {
        content: [
          {
            type: 'text',
            text: `Applied ${result.operations.length} patch operation${result.operations.length === 1 ? '' : 's'} to ${result.droneId}.`,
          },
        ],
        details: result,
      };
    }
    throw new Error(`unsupported drone workspace tool: ${call.tool}`);
  }

  resolvedSystemPrompt(
    threadId: string,
    options?: { multipleWorkspaceTargets?: boolean; workspaceTargetCount?: number },
  ): string {
    const prompt = this.systemPrompt(threadId);
    if (options?.workspaceTargetCount === 0) {
      return prompt.includes(ASSISTANT_MULTI_TARGET_PROMPT_LINE)
        ? prompt.replace(ASSISTANT_MULTI_TARGET_PROMPT_LINE, ASSISTANT_NO_TARGET_PROMPT_LINE)
        : `${prompt}\n\n${ASSISTANT_NO_TARGET_PROMPT_LINE}`;
    }
    if (options?.workspaceTargetCount != null && options.workspaceTargetCount > 1) return prompt;
    if (options?.workspaceTargetCount == null && options?.multipleWorkspaceTargets !== false)
      return prompt;
    return prompt.includes(ASSISTANT_MULTI_TARGET_PROMPT_LINE)
      ? prompt.replace(ASSISTANT_MULTI_TARGET_PROMPT_LINE, ASSISTANT_SINGLE_TARGET_PROMPT_LINE)
      : `${prompt}\n\n${ASSISTANT_SINGLE_TARGET_PROMPT_LINE}`;
  }

  async preflightBlipTool(
    threadId: string,
    toolName: string,
    callId: string,
    args: any,
    signal?: AbortSignal,
    phase: 'initial' | 'resume' = 'initial',
  ): Promise<
    | { status: 'allow' }
    | { status: 'deny'; reason: string }
    | { status: 'suspend'; reason: string; details: unknown }
  > {
    return this.beforeToolCall(
      threadId,
      { toolCall: { id: callId, name: toolName }, args, phase },
      undefined,
      signal,
    );
  }

  async approve(
    approvalId: string,
    approved: boolean,
    expectedThreadId?: string,
  ): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error(`unknown approval: ${approvalId}`);
    if (expectedThreadId && approval.threadId !== expectedThreadId)
      throw new Error(`approval does not belong to thread: ${expectedThreadId}`);
    if (!this.approvalDecisionDelegate) throw new Error('approval runtime is unavailable');
    await this.approvalDecisionDelegate(approval.threadId, approvalId, approved);
    approval.status = approved ? 'approved' : 'denied';
    this.approvals.delete(approvalId);
    this.runningThreadIds.add(approval.threadId);
    const thread = this.getThread(approval.threadId);
    thread.status = 'running';
    thread.error = null;
    thread.updatedAt = nowIso();
    this.emitChange('approval_resolved', approval.threadId);
    return await this.threadSnapshot(approval.threadId);
  }

  async enqueueThreadPrompt(
    threadId: string,
    input: {
      id?: unknown;
      prompt?: unknown;
      promptImages?: unknown;
      deliveryMode?: unknown;
      submissionSource?: PromptSubmissionSource;
    },
  ): Promise<AssistantQueuedPrompt> {
    return (await this.enqueueThreadPromptWithResult(threadId, input)).prompt;
  }

  async enqueueThreadPromptWithResult(
    threadId: string,
    input: {
      id?: unknown;
      prompt?: unknown;
      promptImages?: unknown;
      deliveryMode?: unknown;
      submissionSource?: PromptSubmissionSource;
    },
  ): Promise<{
    inserted: boolean;
    prompt: AssistantQueuedPrompt;
    interruptedPromptId?: string;
  }> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const prompt = String(input.prompt ?? '').trim();
    const promptImages = Array.isArray(input.promptImages)
      ? input.promptImages
          .map((image: any) => ({
            type: 'image' as const,
            data: String(image?.data ?? ''),
            mimeType: String(image?.mimeType ?? 'image/png'),
          }))
          .filter((image) => image.data)
      : [];
    if (!prompt && promptImages.length === 0) throw new Error('missing prompt');
    const identity = this.promptQueueIdentity(thread);
    const id = cleanOptionalString(input.id) || makeAssistantId('prompt');
    const existing = this.requirePromptQueue().get({ ...identity, promptId: id });
    if (existing) {
      return { inserted: false, prompt: this.queuedPromptFromRecord(existing, false) };
    }
    if (this.queuedPromptsForThread(thread, false).length >= ASSISTANT_QUEUED_PROMPT_LIMIT) {
      throw new Error(`assistant prompt queue is full (max ${ASSISTANT_QUEUED_PROMPT_LIMIT})`);
    }
    const queued = await this.requirePromptQueue().enqueue({
      ...identity,
      submissionSource: input.submissionSource,
      prompt: {
        id,
        at: nowIso(),
        prompt,
        attachments: { promptImages },
        deliveryMode: input.deliveryMode === 'asap' ? 'asap' : 'queue',
        state: 'queued',
      },
    });
    thread.updatedAt = nowIso();
    await this.persist();
    return {
      inserted: queued.inserted,
      prompt: this.queuedPromptFromRecord(queued.prompt, false),
      ...(queued.interruptedPromptId ? { interruptedPromptId: queued.interruptedPromptId } : {}),
    };
  }

  async claimNextQueuedPrompt(threadId: string): Promise<AssistantQueuedPrompt | null> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const identity = this.promptQueueIdentity(thread);
    const queued = this.requirePromptQueue().nextQueued(identity);
    if (!queued || isSendInNewChatQueueAction(queued.action)) return null;
    return await this.claimQueuedPrompt(threadId, queued.id);
  }

  async claimQueuedPrompt(
    threadId: string,
    promptId: string,
    options?: { allowConcurrent?: boolean },
  ): Promise<AssistantQueuedPrompt | null> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const identity = this.promptQueueIdentity(thread);
    const queue = this.requirePromptQueue();
    const queued = queue.get({ ...identity, promptId });
    if (!queued || isSendInNewChatQueueAction(queued.action)) return null;
    const claim = options?.allowConcurrent
      ? queue.claimForSteering.bind(queue)
      : queue.claim.bind(queue);
    const claimed = await claim({
      ...identity,
      promptId,
      leaseOwner: `native:${process.pid}`,
      leaseMs: 30 * 60_000,
    });
    if (!claimed) return null;
    thread.updatedAt = nowIso();
    await this.persist();
    return this.queuedPromptFromRecord(claimed, true);
  }

  async completeQueuedPrompt(threadId: string, promptId: string): Promise<void> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const queue = this.requirePromptQueue();
    const identity = this.promptQueueIdentity(thread);
    await queue.update({
      ...identity,
      promptId,
      patch: { state: 'sent', error: undefined },
    });
    await queue.completeRecovery({ ...identity, recoveryPromptId: promptId });
    thread.updatedAt = nowIso();
    await this.persist();
  }

  async failQueuedPrompt(threadId: string, promptId: string, error: unknown): Promise<void> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const message = String((error as any)?.message ?? error ?? 'Assistant prompt failed');
    const queue = this.requirePromptQueue();
    const identity = this.promptQueueIdentity(thread);
    const current = queue.get({ ...identity, promptId });
    await queue.update({
      ...identity,
      promptId,
      patch: { state: 'failed', error: message },
    });
    if (!current?.action && isAgentTransportInterruption(message)) {
      await queue.pauseAfterInterruption({ ...identity, promptId });
    }
    thread.status = 'error';
    thread.error = message;
    thread.updatedAt = nowIso();
    await this.persist();
  }

  async cancelQueuedPrompt(threadId: string, promptId: string): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const identity = this.promptQueueIdentity(thread);
    const queue = this.requirePromptQueue();
    const queued = queue.get({ ...identity, promptId });
    if (!queued) throw new Error(`unknown queued assistant prompt: ${promptId}`);
    if (queued.state === 'sending') throw new Error('assistant prompt is already running');
    const cancelled = await queue.cancelQueued({ ...identity, promptId });
    if (!cancelled.cancelled) throw new Error(`assistant prompt cannot be cancelled: ${promptId}`);
    thread.updatedAt = nowIso();
    await this.persist();
    return await this.threadSnapshot(threadId);
  }

  async hasQueuedPrompts(threadId: string): Promise<boolean> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    return Boolean(this.requirePromptQueue().nextQueued(this.promptQueueIdentity(thread)));
  }

  async promptDeliveryMode(threadId: string): Promise<AssistantPromptDeliveryMode> {
    await this.ensureLoaded();
    return this.getThread(threadId).promptDeliveryMode;
  }

  async promptThread(
    threadId: string,
    input: { prompt?: unknown },
    onEvent?: (event: AssistantPromptEvent) => void | Promise<void>,
  ): Promise<void> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt) throw new Error('missing prompt');
    if (!this.textPromptDelegate) throw new Error('Blip assistant host is not ready');
    thread.error = null;
    thread.updatedAt = nowIso();
    await this.persist();
    await this.textPromptDelegate(thread.id, prompt);
    await onEvent?.({ type: 'snapshot', snapshot: await this.threadSnapshot(thread.id) });
  }
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const stored = (await loadAssistantState()) ?? undefined;
    const storedSystemPrompt = normalizeAssistantSystemPrompt(stored?.systemPrompt);
    this.defaultSystemPrompt = storedSystemPrompt || ASSISTANT_SYSTEM_PROMPT_DEFAULT;
    this.defaultSystemPromptUpdatedAt =
      storedSystemPrompt &&
      typeof stored?.systemPromptUpdatedAt === 'string' &&
      stored.systemPromptUpdatedAt.trim()
        ? stored.systemPromptUpdatedAt.trim()
        : null;
    const fallbackDefaultProvider = await defaultAssistantProvider();
    const storedDefaultProvider = normalizeProvider(
      stored?.defaultModel?.provider ?? fallbackDefaultProvider,
    );
    this.defaultModelSelection = {
      provider: storedDefaultProvider,
      model: allowedModelForProvider(storedDefaultProvider, stored?.defaultModel?.model),
      thinkingLevel: allowedThinkingLevelForModel(
        storedDefaultProvider,
        allowedModelForProvider(storedDefaultProvider, stored?.defaultModel?.model),
        stored?.defaultModel?.thinkingLevel,
      ),
    };
    const storedDefaultEnabledTools = normalizeAssistantEnabledTools(
      stored?.defaultEnabledTools,
      ASSISTANT_DEFAULT_ENABLED_TOOL_NAMES,
    );
    const droneHubMcpToolNames = new Set(ASSISTANT_DRONE_HUB_MCP_TOOL_NAMES);
    this.defaultEnabledTools =
      stored?.droneHubMcpDefaultOptInMigrationApplied === true
        ? storedDefaultEnabledTools
        : storedDefaultEnabledTools.filter(
            (name) => name === 'ask_questions' || !droneHubMcpToolNames.has(name),
          );
    const migrateAskQuestionsDefault = stored?.askQuestionsDefaultMigrationApplied !== true;
    if (migrateAskQuestionsDefault && !this.defaultEnabledTools.includes('ask_questions')) {
      this.defaultEnabledTools.push('ask_questions');
    }
    const storedThreads = Array.isArray(stored?.threads) ? stored.threads : [];
    const storedFallbackProvider = normalizeProvider(
      storedThreads.find((thread: any) => thread && typeof thread === 'object')?.provider,
    );
    const storedFallback = {
      provider: storedFallbackProvider,
      model: defaultModelForProvider(storedFallbackProvider),
      systemPrompt: ASSISTANT_SYSTEM_PROMPT_DEFAULT,
    };
    const migrateWebSearchDefaultTool = stored?.webSearchToolMigrationApplied !== true;
    const migrateFetchContentDefaultTool = stored?.fetchContentToolMigrationApplied !== true;
    const preserveLegacyImplicitMcpTools = stored?.droneHubMcpDefaultOptInMigrationApplied !== true;
    const threads = storedThreads
      .map((thread) =>
        normalizeThread(thread, storedFallback, {
          migrateWebSearchDefaultTool,
          migrateFetchContentDefaultTool,
          preserveLegacyImplicitMcpTools,
        }),
      )
      .filter(Boolean) as AssistantThread[];
    this.threads = threads.filter((thread) => Boolean(thread.ownerDroneId));
    if (migrateAskQuestionsDefault) {
      for (const thread of this.threads) {
        if (!thread.enabledTools.includes('ask_questions')) {
          thread.enabledTools.push('ask_questions');
        }
      }
    }
    this.loaded = true;
  }

  private defaultAccessScopeForNewThread(): AssistantAccessScope {
    return makeDefaultAssistantAccessScope();
  }

  private makeThread(input?: {
    id?: string;
    ownerDroneId?: string;
    ownerChatName?: string;
    provider?: LlmProviderId;
    model?: string;
    thinkingLevel?: AssistantThinkingLevel;
    title?: string;
    accessScope?: AssistantAccessScope;
    agentPermissionMode?: AgentPermissionMode;
    approvalPolicy?: AgentApprovalPolicy;
    enabledWorkspaceIds?: string[];
    systemPrompt?: string;
  }): AssistantThread {
    const provider = normalizeProvider(input?.provider);
    const at = nowIso();
    return {
      id: cleanOptionalString(input?.id) || makeAssistantId('thread'),
      ...(cleanOptionalString(input?.ownerDroneId)
        ? { ownerDroneId: cleanOptionalString(input?.ownerDroneId) }
        : {}),
      ...(cleanOptionalString(input?.ownerChatName)
        ? { ownerChatName: cleanOptionalString(input?.ownerChatName) }
        : {}),
      title: input?.title?.trim() || DEFAULT_THREAD_TITLE,
      createdAt: at,
      updatedAt: at,
      provider,
      model: allowedModelForProvider(provider, input?.model),
      thinkingLevel: allowedThinkingLevelForModel(
        provider,
        allowedModelForProvider(provider, input?.model),
        input?.thinkingLevel,
      ),
      systemPrompt: normalizeAssistantSystemPrompt(input?.systemPrompt) || this.defaultSystemPrompt,
      systemPromptUpdatedAt: null,
      enabledTools: normalizeAssistantEnabledTools(this.defaultEnabledTools),
      accessScope: input?.accessScope ?? this.defaultAccessScopeForNewThread(),
      agentPermissionMode: normalizeAssistantAgentPermissionMode(input?.agentPermissionMode),
      approvalPolicy: normalizeAssistantApprovalPolicy(input?.approvalPolicy),
      ...(Array.isArray(input?.enabledWorkspaceIds)
        ? { enabledWorkspaceIds: normalizeAssistantWorkspaceIds(input.enabledWorkspaceIds) ?? [] }
        : {}),
      autoApprove: normalizeAssistantApprovalPolicy(input?.approvalPolicy) === 'none',
      promptDeliveryMode: 'queue',
      status: 'idle',
      error: null,
    };
  }

  private defaultSystemPromptForThread(_thread: AssistantThread): string {
    return (
      normalizeAssistantSystemPrompt(this.defaultSystemPrompt) || ASSISTANT_SYSTEM_PROMPT_DEFAULT
    );
  }

  private getThread(threadId: string): AssistantThread {
    const id = String(threadId ?? '').trim();
    const thread = this.threads.find((item) => item.id === id);
    if (!thread) throw new Error(`unknown assistant thread: ${threadId}`);
    return thread;
  }

  private async persist(): Promise<void> {
    const state = serializeState({
      defaultModel: this.defaultModelSelection,
      defaultEnabledTools: this.defaultEnabledTools,
      threads: this.threads,
      systemPrompt: this.defaultSystemPrompt,
      systemPromptUpdatedAt: this.defaultSystemPromptUpdatedAt,
    });
    await saveAssistantState(state);
    this.emitChange('persisted');
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
    let runtime: AssistantRuntime | null = null;
    try {
      runtime = await this.runtime();
    } catch {}
    return ASSISTANT_MODEL_OPTIONS.map((option) => {
      let reasoning = option.thinkingLevel !== 'off';
      if (runtime) {
        try {
          const model = runtime.getModel(toBlipModelProvider(option.provider), option.id);
          reasoning = Boolean(model?.reasoning);
        } catch {}
      }
      return {
        provider: option.provider,
        id: option.id,
        name: option.name,
        reasoning,
        thinkingLevel: option.thinkingLevel,
      };
    });
  }

  private async beforeToolCall(
    threadId: string,
    ctx: any,
    _onEvent?: (event: AssistantPromptEvent) => void | Promise<void>,
    _signal?: AbortSignal,
  ): Promise<
    | { status: 'allow' }
    | { status: 'deny'; reason: string }
    | { status: 'suspend'; reason: string; details: unknown }
  > {
    const toolName = String(ctx?.toolCall?.name ?? '')
      .trim()
      .replace(/^drone_hub__/, '');
    const permissionMode = this.getThread(threadId).agentPermissionMode;
    if (permissionMode === 'read' && ASSISTANT_READ_ONLY_DENIED_TOOL_NAMES.has(toolName)) {
      return {
        status: 'deny',
        reason: `${toolName} is unavailable while this chat is read only.`,
      };
    }
    if (permissionMode !== 'execute' && toolName === 'bash') {
      return {
        status: 'deny',
        reason: 'Command execution is unavailable for this chat.',
      };
    }
    if (
      toolName !== 'message_drone' &&
      toolName !== 'set_drone_group' &&
      toolName !== 'set_drone_groups' &&
      toolName !== 'rename_drones' &&
      toolName !== 'bash'
    )
      return { status: 'allow' };
    const label =
      toolName === 'set_drone_group'
        ? 'Set drone group'
        : toolName === 'set_drone_groups'
          ? 'Set drone groups'
          : toolName === 'rename_drones'
            ? 'Rename drones'
            : toolName === 'bash'
              ? 'Execute Bash command'
              : 'Send message to drone';
    let approvalArgs = ctx?.args ?? {};
    if (toolName === 'bash') {
      const drones = await this.tools.listDrones();
      const rawDroneId = cleanOptionalString(ctx?.args?.droneId);
      const workspaceTarget =
        ctx?.args?.workspaceTarget && typeof ctx.args.workspaceTarget === 'object'
          ? ctx.args.workspaceTarget
          : null;
      if (workspaceTarget) {
        approvalArgs = {
          requested: ctx?.args ?? {},
          resolved: {
            targetId: cleanOptionalString(workspaceTarget.id),
            targetLabel:
              cleanOptionalString(workspaceTarget.label) ||
              cleanOptionalString(workspaceTarget.rootLabel) ||
              'Remote workspace',
            targetKind: cleanOptionalString(workspaceTarget.kind) || 'remote-device',
            command: String(ctx?.args?.command ?? ''),
            timeoutMs: clampAssistantBashTimeout(ctx?.args?.timeoutMs),
          },
        };
      } else {
        const scopedDroneId = await this.requireDroneInScope(rawDroneId, 'execute', threadId);
        const drone =
          drones.find((item) => item.id === scopedDroneId) ??
          drones.find((item) => item.name === rawDroneId) ??
          null;
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
      }
    } else {
      try {
        if (toolName === 'set_drone_group') {
          const regAny: any = await loadRegistry();
          const rawList = [
            ...(Array.isArray(ctx?.args?.droneIds) ? ctx.args.droneIds : []),
            ...(Array.isArray(ctx?.args?.drones) ? ctx.args.drones : []),
            ...(cleanOptionalString(ctx?.args?.drone) ? [ctx.args.drone] : []),
          ];
          const drones = await this.tools.listDrones();
          const droneNameById = new Map(drones.map((drone) => [drone.id, drone.name]));
          const droneIds: string[] = Array.from(
            new Set(rawList.map((item: any) => droneIdByAssistantRef(regAny, item))),
          );
          const allowed = this.allowedDroneIdSet('write', threadId);
          if (allowed) {
            const denied = droneIds.filter((id) => !allowed.has(id));
            if (denied.length > 0)
              throw new Error(`assistant scope does not include drone: ${denied.join(', ')}`);
          }
          const groupId = cleanOptionalString(ctx?.args?.groupId);
          const canonicalGroup = groupId
            ? Object.values(regAny?.groups ?? {}).find(
                (group: any) => cleanOptionalString(group?.id) === groupId,
              )
            : null;
          approvalArgs = {
            requested: ctx?.args ?? {},
            resolved: {
              drones: droneIds.map((id) => ({ id, name: droneNameById.get(id) ?? id })),
              group: canonicalGroup
                ? normalizeAssistantGroupValue((canonicalGroup as any).name)
                : normalizeAssistantGroupValue(ctx?.args?.group),
              ...(groupId ? { groupId } : {}),
              ...(canonicalGroup
                ? { repoPath: cleanOptionalString((canonicalGroup as any).repoPath) }
                : {}),
            },
          };
        } else if (toolName === 'set_drone_groups') {
          const regAny: any = await loadRegistry();
          const normalized = normalizeAssistantSetDroneGroupAssignments(ctx?.args ?? {});
          const drones = await this.tools.listDrones();
          const droneNameById = new Map(drones.map((drone) => [drone.id, drone.name]));
          const assignments = normalized.map((assignment) => ({
            group: assignment.group,
            drones: Array.from(
              new Set(assignment.droneRefs.map((ref) => droneIdByAssistantRef(regAny, ref))),
            ).map((id) => ({ id, name: droneNameById.get(id) ?? id })),
          }));
          const allowed = this.allowedDroneIdSet('write', threadId);
          if (allowed) {
            const denied = assignments
              .flatMap((assignment) => assignment.drones.map((drone) => drone.id))
              .filter((id) => !allowed.has(id));
            if (denied.length > 0)
              throw new Error(
                `assistant scope does not include drone: ${Array.from(new Set(denied)).join(', ')}`,
              );
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
            if (denied.length > 0)
              throw new Error(`assistant scope does not include drone: ${denied.join(', ')}`);
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
        return {
          status: 'deny',
          reason: cleanOptionalString(error?.message ?? error) || `Denied ${toolName}.`,
        };
      }
    }
    if (ctx?.phase === 'resume' || this.getThread(threadId).autoApprove) {
      return { status: 'allow' };
    }
    return {
      status: 'suspend',
      reason: `Approval required for ${label}.`,
      details: {
        approval: {
          label,
          args: sanitizeMessage(approvalArgs),
        },
      },
    };
  }

  private snapshotSyncFallback(threadId: string): AssistantSnapshot {
    const id = cleanOptionalString(threadId);
    const targetThread = this.threads.find((thread) => thread.id === id);
    if (!targetThread) throw new Error(`unknown assistant thread: ${threadId}`);
    const snapshotThreadId = targetThread.id;
    const fallbackDroneIds = Array.from(
      new Set([
        ...targetThread.accessScope.droneIds,
        ...(targetThread.enabledWorkspaceIds ?? []).flatMap((workspaceId) =>
          workspaceId.startsWith('drone:') ? [workspaceId.slice('drone:'.length)] : [],
        ),
      ]),
    );
    const availableWorkspaces: NativeAgentWorkspaceSummary[] = [
      ...fallbackDroneIds.map((droneId) => ({
        id: `drone:${droneId}`,
        label: droneId,
        kind: 'drone' as const,
        description: 'Drone workspace',
        capabilities: ['read', 'write', 'execute'] as Array<'read' | 'write' | 'execute'>,
      })),
      {
        id: `artifacts:${snapshotThreadId}`,
        label: 'Artifacts',
        kind: 'artifacts' as const,
        description: 'Private files for this chat',
        capabilities: ['read', 'write'] as Array<'read' | 'write'>,
      },
    ];
    const enabledWorkspaces = availableWorkspaces.filter((workspace) =>
      this.workspaceEnabled(targetThread, workspace.id),
    );
    return {
      ok: true,
      chatId: snapshotThreadId,
      threads: [
        this.runningThreadIds.has(id)
          ? {
              ...sanitizeThread(targetThread),
              queuedPrompts: this.queuedPromptsForThread(targetThread, false),
              status: 'running',
            }
          : {
              ...sanitizeThread(targetThread),
              queuedPrompts: this.queuedPromptsForThread(targetThread, false),
            },
      ],
      pendingApprovals: this.pendingApprovals(id),
      pendingQuestionRequests: getChatQuestionRequestService().listPending(
        targetThread.ownerDroneId ?? '',
        targetThread.ownerChatName ?? 'default',
      ),
      models: [],
      defaultModel: { ...this.defaultModelSelection },
      defaultEnabledTools: [...this.defaultEnabledTools],
      availableTools: this.availableToolsForWorkspaces(enabledWorkspaces),
      availableWorkspaces,
      accessScope: sanitizeMessage(targetThread.accessScope ?? makeAssistantAccessScope()),
    };
  }

  private pendingApprovals(threadId: string): AssistantApproval[] {
    return [...this.approvals.values()]
      .filter((approval) => approval.threadId === threadId)
      .map((approval) => ({
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

  private systemPromptSettingsSync(): AssistantSystemPromptSettings {
    const prompt =
      normalizeAssistantSystemPrompt(this.defaultSystemPrompt) || ASSISTANT_SYSTEM_PROMPT_DEFAULT;
    return {
      ok: true,
      assistantSystemPrompt: {
        prompt,
        promptSource: prompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? 'default' : 'settings',
        updatedAt:
          prompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? null : this.defaultSystemPromptUpdatedAt,
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
    const globalPromptSource =
      globalPrompt === ASSISTANT_SYSTEM_PROMPT_DEFAULT ? 'default' : 'settings';
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

  private systemPrompt(threadId: string): string {
    const thread = this.threads.find((item) => item.id === threadId) ?? null;
    const accessScope = this.activeAccessScope(threadId);
    const readScope = describeAssistantAccessMode(accessScope.readMode, accessScope.droneIds);
    const writeScope =
      thread?.agentPermissionMode === 'read'
        ? 'none (chat is read only)'
        : describeAssistantAccessMode(accessScope.writeMode, accessScope.droneIds);
    const executeScope =
      thread?.agentPermissionMode === 'execute'
        ? describeAssistantAccessMode(accessScope.executeMode, accessScope.droneIds)
        : 'none (command execution is disabled)';
    const scopeText = `Current existing-drone access scope: read=${readScope}; write=${writeScope}; execute=${executeScope}. Do not claim access to existing drones outside those scopes. create_drone and clone_drone create independent container drones by default and automatically grant this chat access. Pass parent only when the user explicitly wants a child drone; the parent must be in read scope. clone_drone also requires read access to its source. create_group creates an independent group in the supplied repository scope; omit repoPath only for drones without a repository.`;
    const basePrompt =
      normalizeAssistantSystemPrompt(thread?.systemPrompt) ||
      (thread ? this.defaultSystemPromptForThread(thread) : this.defaultSystemPrompt);
    return [basePrompt, scopeText].join('\n\n');
  }
}
