import crypto from 'node:crypto';

import { loadRegistry, updateRegistry } from '../host/registry';
import {
  providerDisplayName,
  resolveEffectiveLlmProvider,
  resolveEffectiveProviderApiKeySettings,
  type LlmProviderId,
} from './hub-settings';

type AssistantThreadStatus = 'idle' | 'running' | 'waiting_for_approval' | 'error';
type AssistantThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type AssistantDroneSummary = {
  id: string;
  name: string;
  group: string | null;
  runtime: string;
  repoPath: string;
  status: string;
  chats: string[];
};

export type AssistantMessageDroneResult = {
  promptId: string;
  pendingState?: string | null;
  blockedByAutomation?: boolean;
};

export type AssistantCreateDroneResult = {
  id: string;
  name: string;
  runtime: string;
  phase: string;
  request: any;
};

export type AssistantSetDroneGroupResult = {
  group: string | null;
  moved: Array<{ id: string; name: string; previousGroup: string | null; group: string | null }>;
  rejected: Array<{ id: string; error: string }>;
  total: number;
};

type AssistantThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  provider: LlmProviderId;
  thinkingLevel: AssistantThinkingLevel;
  accessScope: AssistantAccessScope;
  messages: any[];
  queuedPrompts: AssistantQueuedPrompt[];
  status: AssistantThreadStatus;
  error: string | null;
};

type AssistantQueuedPrompt = {
  id: string;
  prompt: string;
  createdAt: string;
  provider: LlmProviderId;
  model: string;
  thinkingLevel: AssistantThinkingLevel;
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
  threads?: AssistantThread[];
  updatedAt?: string;
};

type AssistantRuntime = {
  Agent: any;
  Type: any;
  getModel: (provider: string, model: string) => any;
  getModels: (provider: string) => any[];
  getSupportedThinkingLevels: (model: any) => AssistantThinkingLevel[];
};

type AssistantPromptEvent =
  | { type: 'snapshot'; snapshot: AssistantSnapshot }
  | { type: 'agent_event'; threadId: string; event: any }
  | { type: 'approval_pending'; approval: AssistantApproval; snapshot: AssistantSnapshot }
  | { type: 'error'; threadId?: string; error: string };

type AssistantToolCallbacks = {
  listDrones: () => Promise<AssistantDroneSummary[]>;
  createDrone: (opts: any) => Promise<AssistantCreateDroneResult>;
  setDroneGroup: (opts: { droneIds: string[]; group: string | null }) => Promise<AssistantSetDroneGroupResult>;
  messageDrone: (opts: {
    droneId: string;
    chatName: string;
    prompt: string;
  }) => Promise<AssistantMessageDroneResult>;
};

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

export type AssistantChatIdleTarget = {
  droneId: string;
  chatName: string;
};

export type AssistantChatIdleStatus = {
  droneId: string;
  chatName: string;
  idle: boolean;
  reason: 'no_messages' | 'active_user_messages' | 'latest_agent_message' | 'latest_user_failed' | 'latest_user_message';
  activeUserMessages: number;
  queuedUserMessages: number;
  failedUserMessages: number;
  latest: null | Pick<ChatTimelineMessage, 'id' | 'role' | 'status' | 'at' | 'text' | 'turnId'>;
};

export type AssistantChatIdleWaitResult = {
  ok: boolean;
  timedOut: boolean;
  elapsedMs: number;
  timeoutMs: number;
  idleForMs: number;
  targets: AssistantChatIdleStatus[];
};

export type AssistantSnapshot = {
  ok: true;
  activeThreadId: string;
  threads: AssistantThread[];
  pendingApprovals: AssistantApproval[];
  models: AssistantModelOption[];
  accessScope: AssistantAccessScope;
  streamingMessage?: any;
};

export type AssistantModelOption = {
  provider: LlmProviderId;
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevel: AssistantThinkingLevel;
};

const ASSISTANT_THREAD_MESSAGE_LIMIT = 80;
const ASSISTANT_REGISTRY_MAX_THREADS = 24;
const CHAT_MESSAGE_DEFAULT_LIMIT = 10;
const CHAT_MESSAGE_MAX_LIMIT = 50;
const CHAT_MESSAGE_RESPONSE_MAX_BYTES = 500_000;
const CHAT_IDLE_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const CHAT_IDLE_MAX_TIMEOUT_MS = 30 * 60 * 1000;
const CHAT_IDLE_DEFAULT_POLL_INTERVAL_MS = 1000;
const CHAT_IDLE_DEFAULT_IDLE_FOR_MS = 1000;
const CHAT_IDLE_MAX_TARGETS = 20;
const DEFAULT_OPENAI_MODEL = 'gpt-5.5';
const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
const DEFAULT_THREAD_TITLE = 'New thread';
const ASSISTANT_MODEL_OPTIONS: Array<{
  provider: LlmProviderId;
  id: string;
  name: string;
  thinkingLevel: AssistantThinkingLevel;
}> = [
  { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 Instant', thinkingLevel: 'off' },
  { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 Medium', thinkingLevel: 'medium' },
  { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 High', thinkingLevel: 'high' },
  { provider: 'gemini', id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', thinkingLevel: 'medium' },
];

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

function nowIso(): string {
  return new Date().toISOString();
}

function makeAssistantId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeProvider(raw: unknown): LlmProviderId {
  return String(raw ?? '').trim().toLowerCase() === 'gemini' ? 'gemini' : 'openai';
}

function providerToPiProvider(provider: LlmProviderId): 'openai' | 'google' {
  return provider === 'gemini' ? 'google' : 'openai';
}

function defaultModelForProvider(provider: LlmProviderId): string {
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
  if (provider === 'openai' && model === DEFAULT_OPENAI_MODEL && (requested === 'off' || requested === 'medium' || requested === 'high')) {
    return requested;
  }
  if (provider === 'gemini' && model === DEFAULT_GEMINI_MODEL) return 'medium';
  return ASSISTANT_MODEL_OPTIONS.find((option) => option.provider === provider && option.id === model)?.thinkingLevel ?? 'off';
}

function normalizeThinkingLevel(raw: unknown): AssistantThinkingLevel {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value;
  return 'off';
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

function stripAssistantReplayState(message: any): any {
  if (!message || typeof message !== 'object') return message;
  if (message.role !== 'assistant') return sanitizeMessage(message);
  const content = Array.isArray(message.content) ? message.content : [];
  return {
    ...sanitizeMessage(message),
    content: content.flatMap((block: any) => {
      if (!block || typeof block !== 'object') return [];
      if (block.type === 'thinking') return [];
      if (block.type === 'text') {
        const { textSignature: _textSignature, ...rest } = block;
        return [rest];
      }
      if (block.type === 'toolCall') {
        const { thoughtSignature: _thoughtSignature, ...rest } = block;
        return [rest];
      }
      return [block];
    }),
  };
}

function convertMessagesForOpenAi(messages: any[]): any[] {
  return messages
    .filter((message) => message?.role === 'user' || message?.role === 'assistant' || message?.role === 'toolResult')
    .map(stripAssistantReplayState)
    .filter((message) => message?.role !== 'assistant' || (Array.isArray(message.content) && message.content.length > 0));
}

function clampChatMessageLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return CHAT_MESSAGE_DEFAULT_LIMIT;
  return Math.min(CHAT_MESSAGE_MAX_LIMIT, Math.max(1, Math.floor(n)));
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

function droneEntryByAssistantId(regAny: any, droneIdRaw: unknown): { id: string; drone: any } {
  const droneId = String(droneIdRaw ?? '').trim();
  const drones = regAny?.drones && typeof regAny.drones === 'object' ? regAny.drones : {};
  const direct = drones[droneId];
  if (direct) return { id: droneId, drone: direct };
  for (const [id, drone] of Object.entries(drones) as any[]) {
    const stableId = String((drone as any)?.id ?? id).trim();
    const name = String((drone as any)?.name ?? '').trim();
    if (stableId === droneId || name === droneId) return { id: stableId || id, drone };
  }
  throw new Error(`unknown drone: ${droneId}`);
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

function normalizeAssistantRepoBranchSource(raw: unknown): 'host' | 'remote' {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'remote' || value === 'remote-branch' ? 'remote' : 'host';
}

function cleanOptionalString(raw: unknown): string {
  return String(raw ?? '').trim();
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
  if (!chat) {
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

export async function waitForAssistantChatIdle(opts: {
  targets: AssistantChatIdleTarget[];
  timeoutMs?: unknown;
  pollIntervalMs?: unknown;
  idleForMs?: unknown;
  signal?: AbortSignal;
}): Promise<AssistantChatIdleWaitResult> {
  const targets = opts.targets
    .map((target) => ({
      droneId: String(target?.droneId ?? '').trim(),
      chatName: normalizeChatNameForAssistant(target?.chatName),
    }))
    .filter((target) => target.droneId)
    .slice(0, CHAT_IDLE_MAX_TARGETS);
  if (targets.length === 0) throw new Error('missing chat targets');
  const timeoutMs = clampChatIdleTimeoutMs(opts.timeoutMs);
  const pollIntervalMs = clampChatIdlePollIntervalMs(opts.pollIntervalMs);
  const idleForMs = clampChatIdleForMs(opts.idleForMs);
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let idleSince: number | null = null;
  let lastStatuses: AssistantChatIdleStatus[] = [];

  while (true) {
    throwIfAborted(opts.signal);
    const now = Date.now();
    const regAny: any = await loadRegistry();
    lastStatuses = targets.map((target) => summarizeAssistantChatIdle(regAny, target, { requireChat: true }));
    const allIdle = lastStatuses.every((status) => status.idle);
    if (allIdle) {
      idleSince ??= now;
      if (now - idleSince >= idleForMs) {
        return {
          ok: true,
          timedOut: false,
          elapsedMs: now - startedAt,
          timeoutMs,
          idleForMs,
          targets: lastStatuses,
        };
      }
    } else {
      idleSince = null;
    }

    if (now >= deadline) {
      return {
        ok: false,
        timedOut: true,
        elapsedMs: now - startedAt,
        timeoutMs,
        idleForMs,
        targets: lastStatuses,
      };
    }
    const idleRemainingMs = allIdle && idleSince != null ? Math.max(0, idleForMs - (now - idleSince)) : pollIntervalMs;
    await sleep(Math.max(1, Math.min(pollIntervalMs, idleRemainingMs || pollIntervalMs, deadline - now)), opts.signal);
  }
}

async function readChatMessagePage(opts: {
  droneId: string;
  chatName: string;
  cursor?: unknown;
  direction?: unknown;
  limit?: unknown;
}): Promise<ChatMessagePage> {
  const regAny: any = await loadRegistry();
  const messages = buildChatTimelineMessages(regAny, {
    droneId: String(opts.droneId ?? '').trim(),
    chatName: normalizeChatNameForAssistant(opts.chatName),
  });
  const limit = clampChatMessageLimit(opts.limit);
  const total = messages.length;
  const cursorRaw = Number(opts.cursor);
  const cursor = Number.isFinite(cursorRaw) ? Math.min(total, Math.max(0, Math.floor(cursorRaw))) : null;
  const direction = String(opts.direction ?? '').trim().toLowerCase();

  let start = Math.max(0, total - limit);
  let end = total;
  if (cursor != null && direction === 'older') {
    end = cursor;
    start = Math.max(0, end - limit);
  } else if (cursor != null && direction === 'newer') {
    start = cursor;
    end = Math.min(total, start + limit);
  } else if (cursor != null) {
    start = cursor;
    end = Math.min(total, start + limit);
  }

  const page: ChatMessagePage = {
    droneId: String(opts.droneId ?? '').trim(),
    chatName: normalizeChatNameForAssistant(opts.chatName),
    messages: messages.slice(start, end),
    total,
    limit,
    pageStart: start,
    pageEnd: end,
    olderCursor: start > 0 ? String(start) : null,
    newerCursor: end < total ? String(end) : null,
  };
  ensureMessageResponseFits(page);
  return page;
}

async function getChatOverview(opts: { droneId?: unknown; chatName?: unknown }): Promise<any> {
  const regAny: any = await loadRegistry();
  const drones = regAny?.drones && typeof regAny.drones === 'object' ? regAny.drones : {};
  const requestedDroneId = String(opts.droneId ?? '').trim();
  const rows: any[] = [];

  for (const [idRaw, drone] of Object.entries(drones) as any[]) {
    const droneId = String((drone as any)?.id ?? idRaw).trim() || String(idRaw);
    const droneName = String((drone as any)?.name ?? droneId).trim() || droneId;
    if (requestedDroneId && droneId !== requestedDroneId && droneName !== requestedDroneId) continue;
    const chats = (drone as any)?.chats && typeof (drone as any).chats === 'object' ? (drone as any).chats : {};
    for (const chatNameRaw of Object.keys(chats)) {
      const chatName = normalizeChatNameForAssistant(chatNameRaw);
      if (opts.chatName != null && normalizeChatNameForAssistant(opts.chatName) !== chatName) continue;
      const messages = buildChatTimelineMessages(regAny, { droneId, chatName });
      const latest = messages[messages.length - 1] ?? null;
      rows.push({
        droneId,
        droneName,
        chatName,
        messageCount: messages.length,
        queuedUserMessages: messages.filter((message) => message.role === 'user' && message.status === 'queued').length,
        activeUserMessages: messages.filter((message) => message.role === 'user' && (message.status === 'sending' || message.status === 'sent')).length,
        failedMessages: messages.filter((message) => message.status === 'failed').length,
        latest: latest
          ? {
              id: latest.id,
              role: latest.role,
              status: latest.status,
              at: latest.at,
              text: latest.text,
            }
          : null,
      });
    }
  }

  const overview = { chats: rows };
  ensureMessageResponseFits(overview);
  return overview;
}

async function searchChatMessages(opts: { droneId?: unknown; chatName?: unknown; query: unknown; limit?: unknown; allowedDroneIds?: Set<string> | null }): Promise<any> {
  const query = String(opts.query ?? '').trim().toLowerCase();
  if (!query) throw new Error('missing query');
  const regAny: any = await loadRegistry();
  const drones = regAny?.drones && typeof regAny.drones === 'object' ? regAny.drones : {};
  const limit = clampChatMessageLimit(opts.limit);
  const requestedDroneId = String(opts.droneId ?? '').trim();
  const requestedChatName = opts.chatName == null ? '' : normalizeChatNameForAssistant(opts.chatName);
  const matches: ChatTimelineMessage[] = [];

  for (const [idRaw, drone] of Object.entries(drones) as any[]) {
    const droneId = String((drone as any)?.id ?? idRaw).trim() || String(idRaw);
    const droneName = String((drone as any)?.name ?? droneId).trim() || droneId;
    if (opts.allowedDroneIds && !opts.allowedDroneIds.has(droneId)) continue;
    if (requestedDroneId && droneId !== requestedDroneId && droneName !== requestedDroneId) continue;
    const chats = (drone as any)?.chats && typeof (drone as any).chats === 'object' ? (drone as any).chats : {};
    for (const chatNameRaw of Object.keys(chats)) {
      const chatName = normalizeChatNameForAssistant(chatNameRaw);
      if (requestedChatName && requestedChatName !== chatName) continue;
      for (const message of buildChatTimelineMessages(regAny, { droneId, chatName })) {
        if (!message.text.toLowerCase().includes(query)) continue;
        matches.push(message);
        if (matches.length >= limit) break;
      }
      if (matches.length >= limit) break;
    }
    if (matches.length >= limit) break;
  }

  const result = { query, matches, limit };
  ensureMessageResponseFits(result);
  return result;
}

async function getChatOverviewScoped(opts: { droneId?: unknown; chatName?: unknown; allowedDroneIds?: Set<string> | null }): Promise<any> {
  const overview = await getChatOverview(opts);
  const allowed = opts.allowedDroneIds ?? null;
  if (!allowed) return overview;
  return { chats: (overview.chats ?? []).filter((chat: any) => allowed.has(String(chat?.droneId ?? '').trim())) };
}

async function searchChatMessagesScoped(opts: { droneId?: unknown; chatName?: unknown; query: unknown; limit?: unknown; allowedDroneIds?: Set<string> | null }): Promise<any> {
  const allowed = opts.allowedDroneIds ?? null;
  if (allowed && opts.droneId != null) {
    const regAny: any = await loadRegistry();
    const resolved = droneIdByAssistantRef(regAny, opts.droneId);
    if (!allowed.has(resolved)) throw new Error(`assistant scope does not include drone: ${opts.droneId}`);
  }
  const result = await searchChatMessages(opts);
  return result;
}

async function recentChatActivity(limit: number = 8, allowedDroneIds?: Set<string> | null): Promise<any[]> {
  const regAny: any = await loadRegistry();
  const drones = regAny?.drones && typeof regAny.drones === 'object' ? regAny.drones : {};
  const rows: any[] = [];
  for (const [idRaw, drone] of Object.entries(drones) as any[]) {
    const droneId = String((drone as any)?.id ?? idRaw).trim() || String(idRaw);
    if (allowedDroneIds && !allowedDroneIds.has(droneId)) continue;
    const droneName = String((drone as any)?.name ?? droneId).trim() || droneId;
    const chats = (drone as any)?.chats && typeof (drone as any).chats === 'object' ? (drone as any).chats : {};
    for (const chatNameRaw of Object.keys(chats)) {
      const chatName = normalizeChatNameForAssistant(chatNameRaw);
      const messages = buildChatTimelineMessages(regAny, { droneId, chatName });
      const latest = messages[messages.length - 1] ?? null;
      if (!latest) continue;
      rows.push({
        droneId,
        droneName,
        chatName,
        latestAt: latest.at,
        latestRole: latest.role,
        latestStatus: latest.status,
        latestText: latest.text,
      });
    }
  }
  return rows
    .sort((a, b) => {
      const aMs = Date.parse(a.latestAt);
      const bMs = Date.parse(b.latestAt);
      return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
    })
    .slice(0, Math.max(1, Math.min(20, Math.floor(limit))));
}

function sanitizeMessage(message: any): any {
  if (!message || typeof message !== 'object') return message;
  return JSON.parse(JSON.stringify(message));
}

function makeAssistantAccessScope(input?: { readMode?: unknown; writeMode?: unknown; droneIds?: unknown; updatedAt?: unknown }): AssistantAccessScope {
  const readMode = String(input?.readMode ?? '').trim().toLowerCase() === 'selected' ? 'selected' : 'all';
  const writeMode = String(input?.writeMode ?? '').trim().toLowerCase() === 'selected' ? 'selected' : 'all';
  const rawIds = Array.isArray(input?.droneIds) ? input.droneIds : [];
  const droneIds = Array.from(new Set(rawIds.map((item) => cleanOptionalString(item)).filter(Boolean))).slice(0, 100);
  const selected = droneIds.length > 0;
  return {
    readMode: readMode === 'selected' && selected ? 'selected' : 'all',
    writeMode: writeMode === 'selected' && selected ? 'selected' : 'all',
    droneIds: selected && (readMode === 'selected' || writeMode === 'selected') ? droneIds : [],
    updatedAt: String(input?.updatedAt ?? '').trim() || nowIso(),
  };
}

function normalizeQueuedPrompt(raw: any, fallback: { provider: LlmProviderId; model: string; thinkingLevel?: AssistantThinkingLevel }): AssistantQueuedPrompt | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanOptionalString(raw.id);
  const prompt = cleanOptionalString(raw.prompt);
  if (!id || !prompt) return null;
  const provider = normalizeProvider(raw.provider ?? fallback.provider);
  const model = allowedModelForProvider(provider, raw.model ?? fallback.model);
  return {
    id,
    prompt,
    createdAt: cleanOptionalString(raw.createdAt) || nowIso(),
    provider,
    model,
    thinkingLevel: allowedThinkingLevelForModel(provider, model, raw.thinkingLevel ?? fallback.thinkingLevel ?? 'off'),
  };
}

function sanitizeThread(thread: AssistantThread): AssistantThread {
  return {
    ...thread,
    messages: thread.messages.slice(-ASSISTANT_THREAD_MESSAGE_LIMIT).map(sanitizeMessage),
    queuedPrompts: thread.queuedPrompts.map(sanitizeMessage),
    status: thread.status === 'running' || thread.status === 'waiting_for_approval' ? 'idle' : thread.status,
  };
}

function normalizeThread(raw: any, fallback: { provider: LlmProviderId; model: string }): AssistantThread | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim();
  if (!id) return null;
  const provider = normalizeProvider(raw.provider ?? fallback.provider);
  const model = allowedModelForProvider(provider, raw.model ?? fallback.model);
  const createdAt = String(raw.createdAt ?? '').trim() || nowIso();
  const updatedAt = String(raw.updatedAt ?? '').trim() || createdAt;
  const messages = Array.isArray(raw.messages) ? raw.messages.map(sanitizeMessage).slice(-ASSISTANT_THREAD_MESSAGE_LIMIT) : [];
  const thinkingLevel = allowedThinkingLevelForModel(provider, model, raw.thinkingLevel);
  const queuedPrompts = Array.isArray(raw.queuedPrompts)
    ? raw.queuedPrompts
        .map((item: any) => normalizeQueuedPrompt(item, { provider, model, thinkingLevel }))
        .filter(Boolean) as AssistantQueuedPrompt[]
    : [];
  return {
    id,
    title: String(raw.title ?? '').trim() || DEFAULT_THREAD_TITLE,
    createdAt,
    updatedAt,
    model,
    provider,
    thinkingLevel,
    accessScope: makeAssistantAccessScope(raw.accessScope),
    messages,
    queuedPrompts,
    status: raw.status === 'error' ? 'error' : 'idle',
    error: typeof raw.error === 'string' && raw.error.trim() ? raw.error : null,
  };
}

function serializeState(activeThreadId: string, threads: AssistantThread[]): StoredAssistantState {
  return {
    activeThreadId,
    threads: threads.slice(0, ASSISTANT_REGISTRY_MAX_THREADS).map(sanitizeThread),
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
  private activeAgents = new Map<string, any>();
  private queuePumpPromises = new Map<string, Promise<void>>();
  private streamingMessages = new Map<string, any>();
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

  constructor(private readonly tools: AssistantToolCallbacks) {}

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

  async updateAccessScope(input: { threadId?: unknown; mode?: unknown; readMode?: unknown; writeMode?: unknown; droneIds?: unknown }): Promise<void> {
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
    if (allowed && !allowed.has(droneId)) throw new Error(`assistant scope does not include drone: ${droneRef}`);
    return droneId;
  }

  private filterDronesForScope(drones: AssistantDroneSummary[], threadId?: string): AssistantDroneSummary[] {
    const allowed = this.allowedDroneIdSet('read', threadId);
    if (!allowed) return drones;
    return drones.filter((drone) => allowed.has(drone.id));
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

  private async buildCreateDroneRequest(params: any, threadId?: string): Promise<any> {
    const regAny: any = await loadRegistry();
    const hasParam = (key: string) => Object.prototype.hasOwnProperty.call(params ?? {}, key);
    const explicitSourceRef = cleanOptionalString(params?.sourceDroneId);
    const sourceRef =
      explicitSourceRef ||
      cleanOptionalString(this.appContext.activeDroneId) ||
      cleanOptionalString(this.appContext.activeDroneName);
    let source: { id: string; drone: any } | null = null;
    if (sourceRef) {
      try {
        const id = droneIdByAssistantRef(regAny, sourceRef);
        const allowed = this.allowedDroneIdSet('read', threadId);
        if (allowed && !allowed.has(id)) throw new Error(`assistant scope does not include source drone: ${sourceRef}`);
        source = droneEntryByAssistantId(regAny, id);
      } catch (e) {
        if (explicitSourceRef) throw e;
        source = null;
      }
    }

    const name = cleanOptionalString(params?.name);
    if (!name) throw new Error('missing name');
    const runtime = normalizeAssistantRuntime(params?.runtime, source?.drone?.runtime);
    const sourceGroup = cleanOptionalString(source?.drone?.group);
    const group = hasParam('group') ? cleanOptionalString(params?.group) : sourceGroup;
    const sourceRepoPath = cleanOptionalString(source?.drone?.repoPath);
    const repoPath = hasParam('repoPath') ? cleanOptionalString(params?.repoPath) : sourceRepoPath;
    const activeChatName = normalizeChatNameForAssistant(this.appContext.activeChatName);
    const sourceChats = source?.drone?.chats && typeof source.drone.chats === 'object' ? source.drone.chats : {};
    const sourceChat = sourceChats[activeChatName] ?? sourceChats.default ?? null;
    const seedAgent = sourceChat?.agent && typeof sourceChat.agent === 'object' ? sourceChat.agent : null;
    const seedModel = cleanOptionalString(sourceChat?.model);
    const repoBranchSource = normalizeAssistantRepoBranchSource(params?.repoBranchSource);
    const remoteBranch = cleanOptionalString(params?.remoteBranch);
    const initialMessage = cleanOptionalString(params?.initialMessage ?? params?.seedPrompt ?? params?.message);
    const request = {
      name,
      runtime,
      ...(group ? { group } : {}),
      ...(repoPath ? { repoPath } : {}),
      ...(repoPath ? { repoBranchSource } : {}),
      ...(repoPath && repoBranchSource === 'remote' && remoteBranch ? { remoteBranch } : {}),
      ...(params?.pullHostBranchBeforeCreate != null ? { pullHostBranchBeforeCreate: Boolean(params.pullHostBranchBeforeCreate) } : {}),
      seedChat: 'default',
      ...(seedAgent ? { seedAgent } : {}),
      ...(seedModel ? { seedModel } : {}),
      ...(initialMessage ? { seedPrompt: initialMessage } : {}),
    };
    return request;
  }

  async snapshot(): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const streamingMessage = this.streamingMessages.get(this.activeThreadId);
    return {
      ok: true,
      activeThreadId: this.activeThreadId,
      threads: this.threads.map((thread) => ({ ...thread, messages: thread.messages.map(sanitizeMessage) })),
      pendingApprovals: this.pendingApprovals(),
      models: await this.modelOptions(),
      accessScope: sanitizeMessage(this.activeAccessScope()),
      ...(streamingMessage ? { streamingMessage: sanitizeMessage(streamingMessage) } : {}),
    };
  }

  async createThread(input?: { title?: unknown; model?: unknown; provider?: unknown; activeDroneId?: unknown; activeChatName?: unknown }): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const provider = normalizeProvider(input?.provider ?? (await resolveEffectiveLlmProvider()).provider);
    const thread = this.makeThread({
      provider,
      model: String(input?.model ?? '').trim() || defaultModelForProvider(provider),
      title: String(input?.title ?? '').trim() || DEFAULT_THREAD_TITLE,
      accessScope: this.defaultAccessScopeForNewThread(input),
    });
    this.threads = [thread, ...this.threads].slice(0, ASSISTANT_REGISTRY_MAX_THREADS);
    this.activeThreadId = thread.id;
    await this.persist();
    return await this.snapshot();
  }

  async updateThread(threadId: string, patch: { title?: unknown; model?: unknown; provider?: unknown; thinkingLevel?: unknown }): Promise<AssistantSnapshot> {
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
    thread.updatedAt = nowIso();
    await this.persist();
    return await this.snapshot();
  }

  async deleteThread(threadId: string): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    this.activeAgents.get(threadId)?.abort?.();
    this.activeAgents.delete(threadId);
    this.queuePumpPromises.delete(threadId);
    this.streamingMessages.delete(threadId);
    this.threads = this.threads.filter((thread) => thread.id !== threadId);
    if (this.threads.length === 0) {
      this.threads = [this.makeThread()];
    }
    if (!this.threads.some((thread) => thread.id === this.activeThreadId)) {
      this.activeThreadId = this.threads[0].id;
    }
    await this.persist();
    return await this.snapshot();
  }

  async stopThread(threadId: string): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    this.activeAgents.get(threadId)?.abort?.();
    return await this.snapshot();
  }

  async cancelQueuedPrompt(threadId: string, queuedPromptId: string): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const thread = this.threads.find((item) => item.id === String(threadId ?? '').trim());
    if (!thread) throw new Error(`unknown assistant thread: ${threadId}`);
    const id = String(queuedPromptId ?? '').trim();
    const next = thread.queuedPrompts.filter((item) => item.id !== id);
    if (next.length === thread.queuedPrompts.length) throw new Error(`unknown queued assistant message: ${queuedPromptId}`);
    thread.queuedPrompts = next;
    thread.updatedAt = nowIso();
    await this.persist();
    return await this.snapshot();
  }

  async approve(approvalId: string, approved: boolean): Promise<AssistantSnapshot> {
    await this.ensureLoaded();
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error(`unknown approval: ${approvalId}`);
    approval.status = approved ? 'approved' : 'denied';
    this.approvals.delete(approvalId);
    approval.resolve(approved);
    return await this.snapshot();
  }

  async promptThread(
    threadId: string,
    input: { prompt?: unknown; model?: unknown; provider?: unknown; thinkingLevel?: unknown },
    onEvent?: (event: AssistantPromptEvent) => void | Promise<void>,
  ): Promise<void> {
    await this.ensureLoaded();
    const thread = this.getThread(threadId);
    this.activeThreadId = thread.id;
    const queuedPrompt = this.makeQueuedPrompt(thread, input);
    if (this.activeAgents.has(thread.id) || this.queuePumpPromises.has(thread.id) || this.hasQueuedPrompts(thread.id)) {
      thread.queuedPrompts.push(queuedPrompt);
      thread.updatedAt = nowIso();
      await this.persist();
      await onEvent?.({ type: 'snapshot', snapshot: await this.snapshot() });
      if (!this.activeAgents.has(thread.id) && !this.queuePumpPromises.has(thread.id)) {
        const pump = this.drainQueuedPrompts(thread.id, onEvent).finally(() => {
          this.queuePumpPromises.delete(thread.id);
        });
        this.queuePumpPromises.set(thread.id, pump);
        await pump;
      }
      return;
    }

    const pump = (async () => {
      await this.runQueuedPrompt(thread, queuedPrompt, onEvent);
      await this.drainQueuedPrompts(thread.id, onEvent);
    })().finally(() => {
      this.queuePumpPromises.delete(thread.id);
    });
    this.queuePumpPromises.set(thread.id, pump);
    await pump;
  }

  private hasQueuedPrompts(threadId: string): boolean {
    return this.threads.some((thread) => thread.id === threadId && thread.queuedPrompts.length > 0);
  }

  private makeQueuedPrompt(thread: AssistantThread, input: { prompt?: unknown; model?: unknown; provider?: unknown; thinkingLevel?: unknown }): AssistantQueuedPrompt {
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt) throw new Error('missing prompt');
    const provider = normalizeProvider(input.provider ?? thread.provider);
    const model = allowedModelForProvider(provider, input.model ?? thread.model);
    return {
      id: makeAssistantId('queued'),
      prompt,
      createdAt: nowIso(),
      provider,
      model,
      thinkingLevel: allowedThinkingLevelForModel(provider, model, input.thinkingLevel ?? thread.thinkingLevel),
    };
  }

  private shiftNextQueuedPrompt(threadId: string): { thread: AssistantThread; queuedPrompt: AssistantQueuedPrompt } | null {
    let selected: { thread: AssistantThread; queuedPrompt: AssistantQueuedPrompt; index: number; ms: number } | null = null;
    for (const thread of this.threads) {
      if (thread.id !== threadId) continue;
      for (let index = 0; index < thread.queuedPrompts.length; index += 1) {
        const queuedPrompt = thread.queuedPrompts[index];
        const ms = Date.parse(queuedPrompt.createdAt);
        const normalizedMs = Number.isFinite(ms) ? ms : 0;
        if (!selected || normalizedMs < selected.ms) selected = { thread, queuedPrompt, index, ms: normalizedMs };
      }
    }
    if (!selected) return null;
    selected.thread.queuedPrompts.splice(selected.index, 1);
    selected.thread.updatedAt = nowIso();
    return { thread: selected.thread, queuedPrompt: selected.queuedPrompt };
  }

  private async drainQueuedPrompts(threadId: string, onEvent?: (event: AssistantPromptEvent) => void | Promise<void>): Promise<void> {
    while (!this.activeAgents.has(threadId)) {
      const next = this.shiftNextQueuedPrompt(threadId);
      if (!next) return;
      await this.persist();
      await onEvent?.({ type: 'snapshot', snapshot: await this.snapshot() });
      await this.runQueuedPrompt(next.thread, next.queuedPrompt, onEvent);
    }
  }

  private async runQueuedPrompt(
    thread: AssistantThread,
    queuedPrompt: AssistantQueuedPrompt,
    onEvent?: (event: AssistantPromptEvent) => void | Promise<void>,
  ): Promise<void> {
    thread.provider = queuedPrompt.provider;
    thread.model = queuedPrompt.model;
    thread.thinkingLevel = queuedPrompt.thinkingLevel;
    let agent: any = null;

    try {
      const runtime = await this.runtime();
      const model = this.resolveModel(runtime, thread.provider, thread.model);
      const tools = this.buildTools(runtime, thread.id, onEvent);
      const providerSettings = await resolveEffectiveProviderApiKeySettings(thread.provider);
      if (!providerSettings.apiKey) {
        throw new Error(`Missing ${providerDisplayName(thread.provider)} API key. Configure it in Settings.`);
      }

      agent = new runtime.Agent({
        initialState: {
          systemPrompt: this.systemPrompt(thread.id),
          model,
          thinkingLevel: thread.thinkingLevel,
          tools,
          messages: thread.messages.map(sanitizeMessage),
        },
        ...(thread.provider === 'openai' ? { convertToLlm: convertMessagesForOpenAi } : {}),
        getApiKey: async (provider: string) => {
          if (provider === 'google') {
            const resolved = await resolveEffectiveProviderApiKeySettings('gemini');
            return resolved.apiKey;
          }
          if (provider === 'openai') {
            const resolved = await resolveEffectiveProviderApiKeySettings('openai');
            return resolved.apiKey;
          }
          return providerSettings.apiKey;
        },
        beforeToolCall: async (ctx: any, signal?: AbortSignal) => await this.beforeToolCall(thread.id, ctx, onEvent, signal),
        toolExecution: 'sequential',
      });

      this.activeAgents.set(thread.id, agent);
      thread.status = 'running';
      thread.error = null;
      thread.updatedAt = nowIso();
      await onEvent?.({ type: 'snapshot', snapshot: await this.snapshot() });

      agent.subscribe(async (event: any) => {
        if (event.type === 'message_update') {
          this.streamingMessages.set(thread.id, sanitizeMessage(event.message));
        }
        if (event.type === 'message_end' || event.type === 'agent_end' || event.type === 'turn_end') {
          thread.messages = agent.state.messages.map(sanitizeMessage).slice(-ASSISTANT_THREAD_MESSAGE_LIMIT);
          if (agent.state.streamingMessage) {
            this.streamingMessages.set(thread.id, sanitizeMessage(agent.state.streamingMessage));
          } else {
            this.streamingMessages.delete(thread.id);
          }
          const firstUser = thread.messages.find((message) => message?.role === 'user');
          if (thread.title === DEFAULT_THREAD_TITLE && firstUser) thread.title = titleFromPrompt(textFromMessage(firstUser));
          thread.updatedAt = nowIso();
        }
        if (event.type === 'turn_end' && event.message?.role === 'assistant' && event.message?.errorMessage) {
          thread.error = String(event.message.errorMessage);
          thread.status = 'error';
        }
        await onEvent?.({ type: 'agent_event', threadId: thread.id, event });
        await onEvent?.({ type: 'snapshot', snapshot: await this.snapshot() });
      });

      await agent.prompt(queuedPrompt.prompt);
      if ((thread.status as AssistantThreadStatus) !== 'error') thread.status = 'idle';
    } catch (e: any) {
      thread.status = 'error';
      thread.error = e?.message ?? String(e);
      await onEvent?.({ type: 'error', threadId: thread.id, error: thread.error ?? 'Assistant failed.' });
    } finally {
      if (agent) thread.messages = agent.state.messages.map(sanitizeMessage).slice(-ASSISTANT_THREAD_MESSAGE_LIMIT);
      thread.updatedAt = nowIso();
      this.streamingMessages.delete(thread.id);
      if (this.activeAgents.get(thread.id) === agent) this.activeAgents.delete(thread.id);
      for (const [id, approval] of [...this.approvals]) {
        if (approval.threadId !== thread.id) continue;
        this.approvals.delete(id);
        approval.resolve(false);
      }
      await this.persist();
      await onEvent?.({ type: 'snapshot', snapshot: await this.snapshot() });
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const { provider } = await resolveEffectiveLlmProvider();
    const fallback = { provider, model: defaultModelForProvider(provider) };
    const regAny: any = await loadRegistry();
    const stored = regAny?.settings?.assistant as StoredAssistantState | undefined;
    const threads = Array.isArray(stored?.threads)
      ? stored.threads.map((thread) => normalizeThread(thread, fallback)).filter(Boolean) as AssistantThread[]
      : [];
    this.threads = threads.length > 0 ? threads : [this.makeThread(fallback)];
    const activeThreadId = String(stored?.activeThreadId ?? '').trim();
    this.activeThreadId = this.threads.some((thread) => thread.id === activeThreadId) ? activeThreadId : this.threads[0].id;
    this.loaded = true;
  }

  private defaultAccessScopeForNewThread(input?: { activeDroneId?: unknown; activeChatName?: unknown }): AssistantAccessScope {
    const hasInputDrone = Object.prototype.hasOwnProperty.call(input ?? {}, 'activeDroneId');
    const hasInputChat = Object.prototype.hasOwnProperty.call(input ?? {}, 'activeChatName');
    const activeDroneId = hasInputDrone ? cleanOptionalString(input?.activeDroneId) : cleanOptionalString(this.appContext.activeDroneId);
    const activeChatName = hasInputChat ? cleanOptionalString(input?.activeChatName) : cleanOptionalString(this.appContext.activeChatName);
    if (!activeDroneId || !activeChatName) return makeAssistantAccessScope();
    return makeAssistantAccessScope({ readMode: 'all', writeMode: 'selected', droneIds: [activeDroneId] });
  }

  private makeThread(input?: { provider?: LlmProviderId; model?: string; title?: string; accessScope?: AssistantAccessScope }): AssistantThread {
    const provider = normalizeProvider(input?.provider);
    const at = nowIso();
    return {
      id: makeAssistantId('thread'),
      title: input?.title?.trim() || DEFAULT_THREAD_TITLE,
      createdAt: at,
      updatedAt: at,
      provider,
      model: allowedModelForProvider(provider, input?.model),
      thinkingLevel: allowedThinkingLevelForModel(provider, allowedModelForProvider(provider, input?.model), 'off'),
      accessScope: input?.accessScope ?? makeAssistantAccessScope(),
      messages: [],
      queuedPrompts: [],
      status: 'idle',
      error: null,
    };
  }

  private getThread(threadId: string): AssistantThread {
    const id = String(threadId ?? '').trim();
    const thread = this.threads.find((item) => item.id === id);
    if (!thread) throw new Error(`unknown assistant thread: ${threadId}`);
    return thread;
  }

  private async persist(): Promise<void> {
    const activeThread = firstThread(this.threads, this.activeThreadId);
    const state = serializeState(activeThread.id, this.threads);
    await updateRegistry((regAny: any) => {
      regAny.settings = regAny.settings ?? {};
      regAny.settings.assistant = state;
    });
  }

  private async runtime(): Promise<AssistantRuntime> {
    if (!this.runtimePromise) {
      this.runtimePromise = Promise.all([
        dynamicImport('@mariozechner/pi-agent-core'),
        dynamicImport('@mariozechner/pi-ai'),
      ]).then(([agentCore, ai]) => ({
        Agent: agentCore.Agent,
        Type: ai.Type,
        getModel: ai.getModel,
        getModels: ai.getModels,
        getSupportedThinkingLevels: ai.getSupportedThinkingLevels,
      }));
    }
    return await this.runtimePromise;
  }

  private resolveModel(runtime: AssistantRuntime, provider: LlmProviderId, modelId: string): any {
    const piProvider = providerToPiProvider(provider);
    const model = runtime.getModel(piProvider, modelId) ?? runtime.getModel(piProvider, defaultModelForProvider(provider));
    if (!model) throw new Error(`Unknown assistant model: ${provider}/${modelId}`);
    return model;
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
      const { provider } = await resolveEffectiveLlmProvider();
      return [
        {
          provider,
          id: defaultModelForProvider(provider),
          name: defaultModelForProvider(provider),
          reasoning: false,
          thinkingLevel: provider === 'gemini' ? 'medium' : 'off',
        },
      ];
    }
  }

  private buildTools(runtime: AssistantRuntime, threadId: string, onEvent?: (event: AssistantPromptEvent) => void | Promise<void>): any[] {
    const Type = runtime.Type;
    return [
      {
        name: 'list_drones',
        label: 'List drones',
        description: 'List all drones visible to the hub, including their ids, names, groups, status, repos, and chats.',
        parameters: Type.Object({}),
        execute: async () => {
          const drones = this.filterDronesForScope(await this.tools.listDrones(), threadId);
          return {
            content: [{ type: 'text', text: JSON.stringify({ drones }, null, 2) }],
            details: { drones },
          };
        },
      },
      {
        name: 'get_current_context',
        label: 'Get current context',
        description:
          'Read current Drone Hub UI context, including the active/open drone and chat plus recently active drone chats.',
        parameters: Type.Object({}),
        execute: async () => {
          const context = {
            app: this.scopedAppContext(threadId),
            accessScope: this.activeAccessScope(threadId),
            recentChats: await recentChatActivity(8, this.allowedDroneIdSet('read', threadId)),
          };
          return {
            content: [{ type: 'text', text: JSON.stringify(context, null, 2) }],
            details: context,
          };
        },
      },
      {
        name: 'inspect_drone',
        label: 'Inspect drone',
        description: 'Inspect one drone by id or name from the hub drone list.',
        parameters: Type.Object({
          drone: Type.String({ description: 'Drone id or visible name.' }),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const needle = String(params?.drone ?? '').trim().toLowerCase();
          const drones = this.filterDronesForScope(await this.tools.listDrones(), threadId);
          const drone =
            drones.find((item) => item.id.toLowerCase() === needle) ??
            drones.find((item) => item.name.toLowerCase() === needle);
          if (!drone) throw new Error(`Unknown drone: ${params?.drone ?? ''}`);
          return {
            content: [{ type: 'text', text: JSON.stringify({ drone }, null, 2) }],
            details: { drone },
          };
        },
      },
      {
        name: 'get_chat_overview',
        label: 'Get chat overview',
        description:
          'Read a lightweight overview of drone chats, including message counts, queued/running user messages, failed messages, and latest message text.',
        parameters: Type.Object({
          droneId: Type.Optional(Type.String({ description: 'Optional drone id or visible name.' })),
          chatName: Type.Optional(Type.String({ description: 'Optional chat name.' })),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const overview = await getChatOverviewScoped({ ...(params ?? {}), allowedDroneIds: this.allowedDroneIdSet('read', threadId) });
          return {
            content: [{ type: 'text', text: JSON.stringify(overview, null, 2) }],
            details: overview,
          };
        },
      },
      {
        name: 'read_chat_messages',
        label: 'Read chat messages',
        description:
          'Read a paginated unified timeline of user and agent messages for a drone chat. Pending or queued user messages are included in the same timeline with their status.',
        parameters: Type.Object({
          droneId: Type.String({ description: 'Drone id or visible name.' }),
          chatName: Type.Optional(Type.String({ description: 'Chat name. Defaults to default.' })),
          cursor: Type.Optional(Type.String({ description: 'Cursor returned by an earlier page.' })),
          direction: Type.Optional(Type.String({ description: 'older or newer. Defaults to latest page when cursor is omitted.' })),
          limit: Type.Optional(Type.Number({ description: `Messages to read. Defaults to ${CHAT_MESSAGE_DEFAULT_LIMIT}, max ${CHAT_MESSAGE_MAX_LIMIT}.` })),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const droneId = await this.requireDroneInScope(params?.droneId, 'read', threadId);
          const page = await readChatMessagePage({
            droneId,
            chatName: normalizeChatNameForAssistant(params?.chatName),
            cursor: params?.cursor,
            direction: params?.direction,
            limit: params?.limit,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(page, null, 2) }],
            details: page,
          };
        },
      },
      {
        name: 'search_chat_messages',
        label: 'Search chat messages',
        description: 'Search user and agent messages across drone chats without reading full chat histories.',
        parameters: Type.Object({
          query: Type.String({ description: 'Text to search for.' }),
          droneId: Type.Optional(Type.String({ description: 'Optional drone id or visible name.' })),
          chatName: Type.Optional(Type.String({ description: 'Optional chat name.' })),
          limit: Type.Optional(Type.Number({ description: `Maximum matches. Defaults to ${CHAT_MESSAGE_DEFAULT_LIMIT}, max ${CHAT_MESSAGE_MAX_LIMIT}.` })),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const result = await searchChatMessagesScoped({ ...(params ?? {}), allowedDroneIds: this.allowedDroneIdSet('read', threadId) });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        },
      },
      {
        name: 'wait_for_agent_chats_idle',
        label: 'Wait for agent chats to go idle',
        description:
          'Block until one or more drone chats stop processing queued or running user messages. A chat is idle when there are no queued/sending/sent user messages and the latest timeline item is either an agent message or a failed user message.',
        parameters: Type.Object({
          targets: Type.Array(
            Type.Object({
              droneId: Type.String({ description: 'Drone id or visible name.' }),
              chatName: Type.Optional(Type.String({ description: 'Chat name. Defaults to default.' })),
            }),
            { minItems: 1, maxItems: CHAT_IDLE_MAX_TARGETS },
          ),
          timeoutMs: Type.Optional(Type.Number({ description: `Maximum wait time in milliseconds. Defaults to ${CHAT_IDLE_DEFAULT_TIMEOUT_MS}.` })),
          pollIntervalMs: Type.Optional(Type.Number({ description: `Registry polling interval in milliseconds. Defaults to ${CHAT_IDLE_DEFAULT_POLL_INTERVAL_MS}.` })),
          idleForMs: Type.Optional(Type.Number({ description: `Require all targets to remain idle for this long before returning. Defaults to ${CHAT_IDLE_DEFAULT_IDLE_FOR_MS}.` })),
        }),
        execute: async (_toolCallId: string, params: any, signal?: AbortSignal) => {
          const rawTargets = Array.isArray(params?.targets) ? params.targets : [];
          if (rawTargets.length === 0) throw new Error('missing targets');
          const targets: AssistantChatIdleTarget[] = [];
          const seen = new Set<string>();
          for (const rawTarget of rawTargets.slice(0, CHAT_IDLE_MAX_TARGETS)) {
            const droneId = await this.requireDroneInScope(rawTarget?.droneId, 'read', threadId);
            const chatName = normalizeChatNameForAssistant(rawTarget?.chatName);
            const key = `${droneId}\u0000${chatName}`;
            if (seen.has(key)) continue;
            seen.add(key);
            targets.push({ droneId, chatName });
          }
          if (targets.length === 0) throw new Error('missing targets');
          const result = await waitForAssistantChatIdle({
            targets,
            timeoutMs: params?.timeoutMs,
            pollIntervalMs: params?.pollIntervalMs,
            idleForMs: params?.idleForMs,
            signal,
          });
          const idleCount = result.targets.filter((target) => target.idle).length;
          return {
            content: [
              {
                type: 'text',
                text: result.ok
                  ? `All ${idleCount} target chat${idleCount === 1 ? '' : 's'} are idle after ${result.elapsedMs}ms.`
                  : `Timed out after ${result.elapsedMs}ms waiting for ${result.targets.length - idleCount} of ${result.targets.length} target chat${result.targets.length === 1 ? '' : 's'} to go idle.`,
              },
            ],
            details: result,
          };
        },
      },
      {
        name: 'create_drone',
        label: 'Create drone',
        description:
          'Create a new drone. This requires user approval. By default it inherits runtime, repo path, group, agent, and model from the current/open drone and chat; repoBranchSource and remoteBranch can override branch seeding.',
        parameters: Type.Object({
          name: Type.String({ description: 'Display name for the new drone.' }),
          sourceDroneId: Type.Optional(Type.String({ description: 'Optional source drone id or name for inherited defaults. Defaults to the currently open drone.' })),
          group: Type.Optional(Type.String({ description: 'Optional group override. Omit to inherit the source drone group; pass an empty string for no group.' })),
          runtime: Type.Optional(Type.String({ description: 'Optional runtime override: container or host. Omit to inherit from the source drone.' })),
          repoPath: Type.Optional(Type.String({ description: 'Optional repo path override. Omit to inherit source repo path; pass an empty string for a non-repo drone.' })),
          repoBranchSource: Type.Optional(Type.String({ description: 'host or remote. Defaults to host when repoPath is set.' })),
          remoteBranch: Type.Optional(Type.String({ description: 'Remote branch name when repoBranchSource is remote.' })),
          pullHostBranchBeforeCreate: Type.Optional(Type.Boolean({ description: 'Whether to pull the host branch before creating from host branch. Defaults to hub behavior.' })),
          initialMessage: Type.Optional(Type.String({ description: 'Optional first user message to seed into the new drone default chat.' })),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const request = await this.buildCreateDroneRequest(params ?? {}, threadId);
          const result = await this.tools.createDrone(request);
          return {
            content: [
              {
                type: 'text',
                text: `Approved and queued drone ${result.name} (${result.id}) with ${result.runtime} runtime.`,
              },
            ],
            details: result,
          };
        },
      },
      {
        name: 'set_drone_group',
        label: 'Set drone group',
        description: 'Move one or more existing drones to a group, or clear their group. This requires user approval.',
        parameters: Type.Object({
          droneIds: Type.Array(Type.String({ description: 'Drone id or visible name.' }), { minItems: 1 }),
          group: Type.Optional(Type.String({ description: 'Group name. Omit or pass an empty string to clear group.' })),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const regAny: any = await loadRegistry();
          const rawList = Array.isArray(params?.droneIds) ? params.droneIds : [];
          if (rawList.length === 0) throw new Error('missing droneIds');
          const droneIds: string[] = Array.from(new Set(rawList.map((item: any) => droneIdByAssistantRef(regAny, item))));
          const allowed = this.allowedDroneIdSet('write', threadId);
          if (allowed) {
            const denied = droneIds.filter((id) => !allowed.has(id));
            if (denied.length > 0) throw new Error(`assistant scope does not include drone: ${denied.join(', ')}`);
          }
          const group = cleanOptionalString(params?.group) || null;
          const result = await this.tools.setDroneGroup({ droneIds, group });
          return {
            content: [
              {
                type: 'text',
                text: `Approved and updated group for ${result.moved.length} drone${result.moved.length === 1 ? '' : 's'}.`,
              },
            ],
            details: result,
          };
        },
      },
      {
        name: 'message_drone',
        label: 'Send user message to drone',
        description: 'Send a user message to a drone chat. This requires user approval before it runs.',
        parameters: Type.Object({
          droneId: Type.String({ description: 'Target drone id.' }),
          chatName: Type.Optional(Type.String({ description: 'Target chat name. Defaults to default.' })),
          message: Type.String({ description: 'User message to send to the target drone chat.' }),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const droneId = await this.requireDroneInScope(params?.droneId, 'write', threadId);
          const chatName = String(params?.chatName ?? '').trim() || 'default';
          const prompt = String(params?.message ?? params?.prompt ?? '').trim();
          if (!droneId) throw new Error('missing droneId');
          if (!prompt) throw new Error('missing message');
          const result = await this.tools.messageDrone({ droneId, chatName, prompt });
          return {
            content: [
              {
                type: 'text',
                text: `Approved and sent user message to ${droneId}/${chatName}. Message id: ${result.promptId}`,
              },
            ],
            details: { droneId, chatName, messageId: result.promptId, ...result },
          };
        },
      },
    ];
  }

  private async beforeToolCall(
    threadId: string,
    ctx: any,
    onEvent?: (event: AssistantPromptEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<{ block?: boolean; reason?: string } | undefined> {
    const toolName = String(ctx?.toolCall?.name ?? '').trim();
    if (toolName !== 'message_drone' && toolName !== 'create_drone' && toolName !== 'set_drone_group') return undefined;
    const label =
      toolName === 'create_drone'
        ? 'Create drone'
        : toolName === 'set_drone_group'
          ? 'Set drone group'
          : 'Send message to drone';
    let approvalArgs = ctx?.args ?? {};
    try {
      if (toolName === 'create_drone') {
        approvalArgs = {
          requested: ctx?.args ?? {},
          resolvedRequest: await this.buildCreateDroneRequest(ctx?.args ?? {}, threadId),
        };
      } else if (toolName === 'set_drone_group') {
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
            group: cleanOptionalString(ctx?.args?.group) || null,
          },
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
    } catch {
      approvalArgs = ctx?.args ?? {};
    }
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
          resolve();
        },
      };
      this.approvals.set(approvalId, entry);
      void input.onEvent?.({ type: 'approval_pending', approval, snapshot: this.snapshotSyncFallback() });
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

  private snapshotSyncFallback(): AssistantSnapshot {
    const streamingMessage = this.streamingMessages.get(this.activeThreadId);
    return {
      ok: true,
      activeThreadId: this.activeThreadId,
      threads: this.threads.map((thread) => ({ ...thread, messages: thread.messages.map(sanitizeMessage) })),
      pendingApprovals: this.pendingApprovals(),
      models: [],
      accessScope: sanitizeMessage(this.activeAccessScope()),
      ...(streamingMessage ? { streamingMessage: sanitizeMessage(streamingMessage) } : {}),
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

  private systemPrompt(threadId?: string): string {
    const accessScope = this.activeAccessScope(threadId);
    const readScope = accessScope.readMode === 'selected' ? `selected drones (${accessScope.droneIds.join(', ')})` : 'all drones';
    const writeScope = accessScope.writeMode === 'selected' ? `selected drones (${accessScope.droneIds.join(', ')})` : 'all drones';
    const scopeText = `Current access scope: read=${readScope}; write=${writeScope}. Do not claim read or write access outside those scopes.`;
    return [
      'You are Drone Hub Assistant, a concise operator assistant embedded in the Drone Hub app.',
      'You help the user understand available drones and coordinate work across drone chats.',
      scopeText,
      'Use get_current_context when the user asks about the current, active, selected, or open drone/chat, or before acting on phrases like "this drone".',
      'Use list_drones before referring to specific drones unless the user already provided an exact drone id.',
      'Use get_chat_overview before reading chat details, then read_chat_messages in pages when you need conversation context.',
      'Chat timelines contain user messages and agent messages. Queued or pending user messages appear in the same timeline with a non-completed status.',
      'When you send a drone chat message and need the result, call wait_for_agent_chats_idle on the target chat before reading the transcript again. This blocks server-side and avoids repeated LLM polling.',
      'Do not load more chat pages than needed. Start with the latest page.',
      'Creating drones, changing drone groups, and sending a user message to a drone are actions that require user approval; explain briefly what you intend to do.',
      'If one of those write tools returns successfully, the user already approved that action. Do not ask for the same approval again.',
      'When creating a drone, omit fields you want inherited from the current open drone. Only set repoBranchSource=remote when the user asked for a remote branch and you have a remoteBranch value.',
      'Do not claim a drone completed work unless the drone transcript or user says so.',
      'Keep responses practical and short.',
    ].join('\n');
  }
}
