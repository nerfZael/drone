import {
  isBackgroundTaskNotificationPrompt,
  isEventNotificationPrompt,
} from '@drone/assistant-chat';

import type { HubGenerationAttribution } from '../usage/trackHubGeneration';
import {
  applyBackfillResult,
  applyCheckResult,
  applyRecordResult,
  askViews,
  BACKFILL_MAX_MESSAGES,
  buildBackfillPrompt,
  buildCheckPrompt,
  buildRecordPrompt,
  isCheckable,
  newChatAskRecord,
  overrideAsk,
  type AskChatExchanges,
  type AskModelSelection,
  type AskSourceMessage,
  type AskView,
  type BackfillResult,
  type ChatAskRecord,
  type ChatAsksSettings,
  type CheckResult,
  type RecordResult,
} from './chat-asks-model';

export type AskChatIdentity = { chatId: string; droneId: string; chatName: string };
export type AskCallKind = 'record' | 'check' | 'backfill';
export type AskCost = { cost: number; calls: number; unpriced: number };

export type ChatAskTrackerDeps = {
  settings: () => Promise<ChatAsksSettings>;
  /** The chat's stable identity, or null when it does not exist. */
  resolveChat: (droneId: string, chatName: string) => AskChatIdentity | null;
  /** Where a tracked chat is now (renames keep its id), or null when it is gone. */
  locateChat: (record: AskChatIdentity) => AskChatIdentity | null;
  readExchanges: (chat: AskChatIdentity) => AskChatExchanges | null;
  /**
   * A cheap fingerprint of the chat's stored messages, or null when it cannot tell (such as Built-in chats). A chat
   * whose fingerprint has not changed since it was last fully processed is skipped.
   */
  version?: (chat: AskChatIdentity) => string | null;
  /** Chats with agent work running now, for automatic tracking. */
  runningChats: () => Array<{ droneId: string; chatName: string }>;
  generate: (opts: {
    kind: AskCallKind;
    selection: AskModelSelection;
    system: string;
    prompt: string;
    attribution: HubGenerationAttribution;
  }) => Promise<unknown>;
  cost: (chatId?: string) => AskCost;
  load?: () => ChatAskRecord[];
  save?: (records: ChatAskRecord[]) => void;
  onChange?: (chat: AskChatIdentity) => void;
  onError?: (message: string) => void;
  now?: () => number;
};

export const ASK_RETRY_AFTER_MS = 60_000;
/** A tracked chat that cannot be found (deleted, or its drone gone) is looked for again this rarely. */
export const ASK_MISSING_CHAT_RETRY_MS = 5 * 60_000;
const MAX_PARALLEL_CHATS = 3;
const MAX_REMEMBERED_IDS = 4_000;

/**
 * Event notifications and background-task wake-ups arrive as user messages but
 * were not written by the user, so they ask for nothing.
 */
function isFromUser(message: AskSourceMessage): boolean {
  return (
    !isEventNotificationPrompt(message.text) && !isBackgroundTaskNotificationPrompt(message.text)
  );
}

export type ChatAsksView = {
  tracking: boolean;
  asks: AskView[];
  /** Messages or runs still waiting for the model. */
  processing: boolean;
  error: string | null;
  cost: AskCost;
};

export class ChatAskTracker {
  private readonly records = new Map<string, ChatAskRecord>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly retryAt = new Map<string, number>();
  private ticking = false;
  /** Where the next tick starts in the records, so every tracked chat gets a turn. */
  private cursor = 0;
  /** Fingerprints of chats with nothing left to do, from their last full pass. */
  private readonly versions = new Map<string, string>();
  /** Asks were off in Settings: what tracked chats did meanwhile is skipped, not caught up. */
  private pausedBySettings = false;

  constructor(private readonly deps: ChatAskTrackerDeps) {
    for (const record of deps.load?.() ?? []) {
      if (record?.chatId) this.records.set(record.chatId, record);
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private persist(record: ChatAskRecord): void {
    record.processedMessageIds = record.processedMessageIds.slice(-MAX_REMEMBERED_IDS);
    record.checkedRunIds = record.checkedRunIds.slice(-MAX_REMEMBERED_IDS);
    this.deps.save?.([...this.records.values()]);
    this.deps.onChange?.(record);
  }

  /** Marks everything the chat already finished as seen, so tracking starts from its next message. */
  private skipHistory(record: ChatAskRecord, exchanges: AskChatExchanges | null): void {
    const finished = new Set((exchanges?.runs ?? []).filter((run) => run.finished).map((run) => run.runId));
    for (const message of exchanges?.messages ?? []) {
      if (finished.has(message.runId) && !record.processedMessageIds.includes(message.id)) record.processedMessageIds.push(message.id);
    }
    for (const runId of finished) if (!record.checkedRunIds.includes(runId)) record.checkedRunIds.push(runId);
  }

  setTracking(droneId: string, chatName: string, enabled: boolean): ChatAskRecord {
    const chat = this.deps.resolveChat(droneId, chatName);
    if (!chat) throw new Error(`Unknown chat: ${droneId}/${chatName}`);
    let record = this.records.get(chat.chatId);
    if (enabled) {
      if (!record) {
        record = newChatAskRecord(chat, this.iso());
        this.records.set(chat.chatId, record);
      } else if (!record.enabled) {
        // Messages sent while tracking was off are not caught up one by one.
        Object.assign(record, chat, { enabled: true, optedOut: false, enabledAt: this.iso() });
        this.skipHistory(record, this.deps.readExchanges(chat));
      }
    } else {
      if (!record) {
        record = { ...newChatAskRecord(chat, this.iso()), enabled: false, backfilled: true };
        this.records.set(chat.chatId, record);
      }
      Object.assign(record, chat, { enabled: false, optedOut: true });
    }
    this.retryAt.delete(chat.chatId);
    this.persist(record);
    return record;
  }

  override(droneId: string, chatName: string, askId: string, status: 'open' | 'done' | 'dismissed'): void {
    const chat = this.deps.resolveChat(droneId, chatName);
    const record = chat && this.records.get(chat.chatId);
    if (!record) throw new Error('Asks are not tracked in this chat');
    overrideAsk(record, askId, status, this.iso());
    this.persist(record);
  }

  view(droneId: string, chatName: string): ChatAsksView {
    const chat = this.deps.resolveChat(droneId, chatName);
    const record = chat ? this.records.get(chat.chatId) : undefined;
    if (!chat || !record) return { tracking: false, asks: [], processing: false, error: null, cost: chat ? this.deps.cost(chat.chatId) : { cost: 0, calls: 0, unpriced: 0 } };
    const exchanges = record.enabled ? this.deps.readExchanges(chat) : null;
    // Only work the agent has started is in progress; a message queued behind it is still open.
    const unfinished = new Set((exchanges?.runs ?? []).filter((run) => !run.finished && run.active !== false).map((run) => run.runId));
    const runOfMessage = new Map((exchanges?.messages ?? []).map((message) => [message.id, message.runId]));
    return {
      tracking: record.enabled,
      asks: askViews(record, unfinished, runOfMessage),
      processing: Boolean(record.enabled && (this.inFlight.has(record.chatId) || (exchanges && this.pendingWork(record, exchanges)))),
      error: record.enabled ? record.error?.message ?? null : null,
      cost: this.deps.cost(chat.chatId),
    };
  }

  totalCost(): AskCost {
    return this.deps.cost();
  }

  private pendingWork(record: ChatAskRecord, exchanges: AskChatExchanges): boolean {
    if (!record.backfilled) return true;
    if (exchanges.messages.some((message) => !record.processedMessageIds.includes(message.id))) return true;
    return exchanges.runs.some((run) => run.finished && !record.checkedRunIds.includes(run.runId));
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const settings = await this.deps.settings();
      if (!settings.enabled) {
        this.pausedBySettings = true;
        return;
      }
      if (this.pausedBySettings) {
        this.pausedBySettings = false;
        this.skipMissedWhileOff();
      }
      if (settings.autoTrack) this.trackRunningChats();
      // Work started here settles only after this loop, so each tick starts where the last one stopped; otherwise the
      // first few chats would take every slot and later chats would never be processed.
      const records = [...this.records.values()];
      const start = records.length ? this.cursor % records.length : 0;
      for (let offset = 0; offset < records.length; offset += 1) {
        if (this.inFlight.size >= MAX_PARALLEL_CHATS) break;
        const record = records[(start + offset) % records.length]!;
        this.cursor = start + offset + 1;
        if (!record.enabled || this.inFlight.has(record.chatId) || (this.retryAt.get(record.chatId) ?? 0) > this.now()) continue;
        const work = this.process(record, settings)
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            record.error = { message, at: this.iso() };
            this.retryAt.set(record.chatId, this.now() + ASK_RETRY_AFTER_MS);
            this.persist(record);
            this.deps.onError?.(`${record.droneId}/${record.chatName}: ${message}`);
          })
          .finally(() => this.inFlight.delete(record.chatId));
        this.inFlight.set(record.chatId, work);
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Waits for the work the last tick started; for tests and shutdown. */
  async idle(): Promise<void> {
    await Promise.all([...this.inFlight.values()]);
  }

  private skipMissedWhileOff(): void {
    for (const record of this.records.values()) {
      if (!record.enabled || !record.backfilled) continue;
      const located = this.deps.locateChat(record);
      if (!located) continue;
      this.skipHistory(record, this.deps.readExchanges(located));
      this.persist(record);
    }
  }

  private trackRunningChats(): void {
    for (const running of this.deps.runningChats()) {
      const chat = this.deps.resolveChat(running.droneId, running.chatName);
      if (!chat || this.records.has(chat.chatId)) continue;
      const record = { ...newChatAskRecord(chat, this.iso()), backfilled: true };
      this.skipHistory(record, this.deps.readExchanges(chat));
      this.records.set(chat.chatId, record);
      this.persist(record);
    }
  }

  private async process(record: ChatAskRecord, settings: ChatAsksSettings): Promise<void> {
    const located = this.deps.locateChat(record);
    if (!located) {
      this.retryAt.set(record.chatId, this.now() + ASK_MISSING_CHAT_RETRY_MS);
      return;
    }
    if (located.droneId !== record.droneId || located.chatName !== record.chatName) {
      Object.assign(record, located);
      this.versions.delete(record.chatId);
      this.persist(record);
    }
    const version = this.deps.version?.(located) ?? null;
    if (version && record.backfilled && !record.error && this.versions.get(record.chatId) === version) return;
    const exchanges = this.deps.readExchanges(located);
    if (!exchanges) return;
    const attribution: HubGenerationAttribution = { purpose: 'asks', chatId: record.chatId, droneId: record.droneId, chatName: record.chatName };
    const runs = new Map(exchanges.runs.map((run) => [run.runId, run]));
    const call = <T>(kind: AskCallKind, selection: AskModelSelection, system: string, prompt: string) =>
      this.deps.generate({ kind, selection, system, prompt, attribution }) as Promise<T>;

    if (!record.backfilled) {
      const finished = exchanges.messages.filter((message) => runs.get(message.runId)?.finished && isFromUser(message));
      const history = finished.slice(-BACKFILL_MAX_MESSAGES);
      if (history.length) {
        const result = await call<BackfillResult>('backfill', settings.check, settings.prompts.backfill, buildBackfillPrompt(history, exchanges.runs));
        if (!record.enabled) return;
        applyBackfillResult(record, history, result, this.iso());
      }
      this.skipHistory(record, exchanges);
      record.backfilled = true;
      record.error = undefined;
      this.persist(record);
    }

    let previousReply = '';
    let previousRunId = '';
    for (const message of exchanges.messages) {
      if (message.runId !== previousRunId && previousRunId) previousReply = runs.get(previousRunId)?.reply ?? previousReply;
      previousRunId = message.runId;
      if (record.processedMessageIds.includes(message.id)) continue;
      if (!isFromUser(message)) {
        record.processedMessageIds.push(message.id);
        this.persist(record);
        continue;
      }
      const result = await call<RecordResult>('record', settings.record, settings.prompts.record, buildRecordPrompt(record, message, previousReply));
      if (!record.enabled) return;
      applyRecordResult(record, message, result);
      record.processedMessageIds.push(message.id);
      record.error = undefined;
      this.persist(record);
    }

    const position = new Map(exchanges.messages.map((message, index) => [message.id, index]));
    for (const run of exchanges.runs) {
      if (!run.finished || record.checkedRunIds.includes(run.runId)) continue;
      const runMessageIds = exchanges.messages.filter((message) => message.runId === run.runId).map((message) => message.id);
      if (!runMessageIds.every((id) => record.processedMessageIds.includes(id))) continue;
      // A run is judged only on asks raised by the time it ran: when several runs wait to be checked, a later run's
      // asks (or repeats) are not the earlier run's to settle.
      const runEnd = Math.max(...runMessageIds.map((id) => position.get(id) ?? -1));
      const asks = record.asks.filter((ask) => {
        if (!isCheckable(ask)) return false;
        const latest = position.get(ask.messageIds[ask.messageIds.length - 1]!);
        return latest === undefined || latest <= runEnd;
      });
      // A run with nothing to show (a note added to the chat without a reply) leaves its asks alone.
      const hasEvidence = Boolean(run.reply.trim() || run.error);
      if (hasEvidence && asks.length) {
        const result = await call<CheckResult>('check', settings.check, settings.prompts.check, buildCheckPrompt(asks, run));
        if (!record.enabled) return;
        applyCheckResult(record, run, runMessageIds, result, this.iso(), new Set(asks.map((ask) => ask.id)));
      }
      record.checkedRunIds.push(run.runId);
      record.error = undefined;
      this.persist(record);
    }
    if (version && !this.pendingWork(record, exchanges)) this.versions.set(record.chatId, version);
  }
}
