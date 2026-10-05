import fs from 'node:fs';
import path from 'node:path';

import { droneRootPath } from '../../host/paths';
import { getHubSettingsRepository } from '../../host/hub-settings-repository';
import { resolveEffectiveProviderApiKeySettings } from '../hub-settings';
import { providerDisplayName, resolveHubLlmRuntime } from '../llm-runtime';
import { readNativeChatMessages } from '../native-chat-messages';
import {
  countTranscriptTurnsFromStore,
  listChatsFromStore,
  readChatMetadataFromStore,
  readChatRowsFromStore,
  readChatVersionFromStore,
  readTranscriptTurnsFromStore,
  type StoredTranscriptTurn,
} from '../transcript-store';
import { getUsageStore } from '../usage/UsageStore';
import {
  changedFilePaths,
  normalizeChatAsksSettings,
  parseChatAsksSettingsInput,
  type AskChatExchanges,
  type AskSourceMessage,
  type AskSourceRun,
  type ChatAskRecord,
  type ChatAsksSettings,
} from './chat-asks-model';
import { ChatAskTracker, type AskCallKind, type AskChatIdentity } from './ChatAskTracker';

const SETTING_KEY = 'chat-asks';
const TICK_MS = 4_000;
const SETTINGS_CACHE_MS = 10_000;
/** Enough recent turns to cover a backfill and anything sent since the last tick. */
const RECENT_TURNS = 80;
const NATIVE_MESSAGES = 40;
const TERMINAL_PENDING_STATES = new Set(['failed', 'error', 'cancelled', 'canceled']);

export async function readChatAsksSettings(): Promise<ChatAsksSettings> {
  return normalizeChatAsksSettings((await getHubSettingsRepository()).get<unknown>(SETTING_KEY)?.value);
}

export async function writeChatAsksSettings(value: unknown): Promise<ChatAsksSettings> {
  const settings = parseChatAsksSettingsInput(value);
  await (await getHubSettingsRepository()).put(SETTING_KEY, settings);
  cachedSettings = null;
  return settings;
}

function chatIdentity(droneId: string, chatName: string): AskChatIdentity | null {
  const chat = readChatMetadataFromStore({ droneId, chatName }).chat as { id?: unknown } | null;
  const chatId = String(chat?.id ?? '').trim();
  return chatId ? { chatId, droneId, chatName } : null;
}

function locateChat(record: AskChatIdentity): AskChatIdentity | null {
  const current = chatIdentity(record.droneId, record.chatName);
  if (current?.chatId === record.chatId) return current;
  for (const chatName of listChatsFromStore({ droneId: record.droneId }).chats) {
    if (chatIdentity(record.droneId, chatName)?.chatId === record.chatId) return { ...record, chatName };
  }
  return null;
}

/** An external agent chat's recent messages and runs, from the transcript store. */
export function exchangesFromStoredTurns(
  turns: readonly StoredTranscriptTurn[],
  pending: ReadonlyArray<{ id: string; at: string; prompt: string; state: string; runId?: string; executionState?: 'queued' | 'running' }>,
): AskChatExchanges {
  const turnIds = new Set(turns.map((turn) => turn.id).filter(Boolean));
  const waiting = pending.filter((prompt) => prompt.id && !turnIds.has(prompt.id) && !TERMINAL_PENDING_STATES.has(prompt.state));
  const messages: AskSourceMessage[] = [
    ...turns.map((turn) => {
      const id = String(turn.id ?? '').trim() || `turn:${turn.at}`;
      return { id, at: turn.promptAt || turn.at, text: String(turn.prompt ?? ''), runId: turn.runId || id };
    }),
    ...waiting.map((prompt) => ({ id: prompt.id, at: prompt.at, text: String(prompt.prompt ?? ''), runId: prompt.runId || prompt.id })),
  ];
  const runs = new Map<string, AskSourceRun>();
  for (const message of messages) {
    if (!runs.has(message.runId)) runs.set(message.runId, { runId: message.runId, finished: true, reply: '', files: [] });
  }
  turns.forEach((turn, index) => {
    const run = runs.get(messages[index]!.runId)!;
    if (turn.ok && !turn.silentCompletion && String(turn.output ?? '').trim()) run.reply = String(turn.output);
    // The run's last word counts: a later turn that succeeded clears an earlier turn's failure.
    if (!turn.ok && turn.error) run.error = String(turn.error);
    else if (turn.ok) delete run.error;
    for (const file of changedFilePaths(turn.fileChanges)) if (!run.files.includes(file)) run.files.push(file);
  });
  for (const prompt of waiting) {
    const run = runs.get(prompt.runId || prompt.id)!;
    run.finished = false;
    // A run is working once any of its prompts runs; prompts that only wait in the queue leave it inactive.
    const queued = prompt.executionState ? prompt.executionState === 'queued' : prompt.state === 'queued';
    run.active = Boolean(run.active) || !queued;
  }
  return { messages, runs: [...runs.values()] };
}

/** A Built-in chat's recent messages: each user message starts a run that its later assistant messages answer. */
export function exchangesFromNativeMessages(
  visible: ReadonlyArray<{ id: string; role: string; at: string; text: string }>,
  running: boolean,
): AskChatExchanges {
  const messages: AskSourceMessage[] = [];
  const runs: AskSourceRun[] = [];
  for (const message of visible) {
    if (message.role === 'user') {
      messages.push({ id: message.id, at: message.at, text: message.text, runId: message.id });
      runs.push({ runId: message.id, finished: true, reply: '', files: [] });
    } else if (runs.length && message.role === 'assistant' && message.text.trim()) runs[runs.length - 1]!.reply = message.text;
    else if (runs.length && message.role === 'error') runs[runs.length - 1]!.error = message.text;
  }
  if (running && runs.length) runs[runs.length - 1]!.finished = false;
  return { messages, runs };
}

function readExchanges(chat: AskChatIdentity): AskChatExchanges | null {
  const { count } = countTranscriptTurnsFromStore(chat);
  const indexes = Array.from({ length: Math.min(count, RECENT_TURNS) }, (_, index) => count - Math.min(count, RECENT_TURNS) + index);
  // 'summary' keeps each run's file changes; 'none' drops them.
  const turns = readTranscriptTurnsFromStore({ ...chat, indexes, activityMode: 'summary' }).turns.map((item) => item.turn);
  const pending = readChatRowsFromStore({ ...chat, indexes: [], includePending: true, activityMode: 'none' }).pending;
  if (turns.length || pending.length) return exchangesFromStoredTurns(turns, pending);
  const native = readNativeChatMessages(chat.chatId, NATIVE_MESSAGES, 8_000).messages;
  if (!native.length) return { messages: [], runs: [] };
  const running = getUsageStore().runningChats().some((item) => item.droneId === chat.droneId && item.chatName === chat.chatName);
  return exchangesFromNativeMessages(native, running);
}

/** Changes whenever an external chat's turns or pending prompts do; null for chats the store cannot describe. */
function chatVersion(chat: AskChatIdentity): string | null {
  const version = readChatVersionFromStore({ ...chat, includePending: true });
  if (!version.available || version.turnCount === 0) return null;
  return `${version.turnCount}|${version.transcriptSourceHash}|${version.pendingVersion}`;
}

function readSaved(file: string): ChatAskRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed?.chats) ? parsed.chats : [];
  } catch {
    return [];
  }
}

function writeSaved(file: string, chats: ChatAskRecord[]): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ version: 1, chats }));
    fs.renameSync(temp, file);
  } catch (error) {
    console.warn('Chat asks could not be saved:', error instanceof Error ? error.message : String(error));
  }
}

async function generate(opts: {
  kind: AskCallKind;
  selection: ChatAsksSettings['record'];
  system: string;
  prompt: string;
  attribution: { purpose: string; chatId?: string; droneId?: string; chatName?: string };
}): Promise<unknown> {
  const { provider, model, thinkingLevel } = opts.selection;
  const apiKey = (await resolveEffectiveProviderApiKeySettings(provider)).apiKey;
  if (!apiKey) throw new Error(`Configure ${providerDisplayName(provider)} credentials in General settings to track asks.`);
  const runtime = await resolveHubLlmRuntime({ provider, apiKey });
  const z = runtime.z;
  const kind = z.enum(['request', 'question', 'rule']);
  const schema = opts.kind === 'record'
    ? z.object({ asks: z.array(z.object({ kind, text: z.string() })), repeats: z.array(z.string()), replaces: z.array(z.string()) })
    : opts.kind === 'check'
      ? z.object({ results: z.array(z.object({ id: z.string(), status: z.enum(['done', 'partial', 'not_done']), note: z.string() })) })
      : z.object({ asks: z.array(z.object({ kind, text: z.string(), messageId: z.string(), status: z.enum(['open', 'done', 'partial', 'not_done', 'replaced']), note: z.string() })) });
  const effort = thinkingLevel === 'off' ? 'none' : thinkingLevel as 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  try {
    const { object } = await runtime.generateObject({
      model: runtime.modelFactory(model),
      schema,
      system: opts.system,
      prompt: opts.prompt,
      maxRetries: 1,
      reasoning: effort,
      attribution: opts.attribution,
      ...(runtime.provider === 'openai' ? { providerOptions: { openai: { reasoningEffort: effort } } } : {}),
    });
    return object;
  } catch (error) {
    throw new Error(`${providerDisplayName(provider)} ${opts.kind} failed (model: ${model}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

let cachedSettings: { value: ChatAsksSettings; at: number } | null = null;
let service: { tracker: ChatAskTracker; timer: ReturnType<typeof setInterval> } | null = null;

export function getChatAskTracker(): ChatAskTracker | null {
  return service?.tracker ?? null;
}

/** The Hub's ask tracker, started once: it does nothing while asks are off in Settings. */
export function startChatAskService(opts: { onChange?: (chat: AskChatIdentity) => void; log?: (message: string) => void } = {}): ChatAskTracker {
  if (service) return service.tracker;
  const file = droneRootPath('chat-asks.json');
  const tracker = new ChatAskTracker({
    settings: async () => {
      if (cachedSettings && Date.now() - cachedSettings.at < SETTINGS_CACHE_MS) return cachedSettings.value;
      const value = await readChatAsksSettings();
      cachedSettings = { value, at: Date.now() };
      return value;
    },
    resolveChat: chatIdentity,
    locateChat,
    readExchanges,
    version: chatVersion,
    runningChats: () => getUsageStore().runningChats(),
    generate,
    cost: (chatId) => getUsageStore().purposeCost('asks', chatId ? { chatId } : {}),
    load: () => readSaved(file),
    save: (chats) => writeSaved(file, chats),
    onChange: opts.onChange,
    onError: opts.log,
  });
  const timer = setInterval(() => void tracker.tick(), TICK_MS);
  timer.unref?.();
  service = { tracker, timer };
  return tracker;
}
