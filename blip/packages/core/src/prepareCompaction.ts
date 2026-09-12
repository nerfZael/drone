import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { estimateContextTokens, type Message } from '@mariozechner/pi-ai/agent-core';
import type { BlipSessionState, TranscriptEntry } from './types.js';
import { resolveCompactionSettings, type CompactionSettings } from './compaction-settings.js';

type MessageEntry = Extract<TranscriptEntry, { type: 'message' }>;
type CompactionEntry = Extract<TranscriptEntry, { type: 'compaction' }>;

export interface CompactionPlan {
  /** False only when the embedding session disables recoverable tool previews. */
  pruneToolOutputs?: boolean;
  previousSummary?: string;
  retainedUserEntryId?: string;
  firstKeptEntryId?: string;
  firstKeptEntryIndex?: number;
  entriesToSummarize: MessageEntry[];
  entriesToKeep: MessageEntry[];
  tokensBefore: number;
  tokensAfterEstimate: number;
  details: { readFiles: string[]; modifiedFiles: string[] };
  settings: CompactionSettings;
}

export function prepareCompaction(input: {
  session: BlipSessionState;
  entries: TranscriptEntry[];
  settings?: CompactionSettings;
  tailBudget?: number;
}): CompactionPlan | undefined {
  const settings = resolveCompactionSettings(input.settings);
  let previous = latestCompaction(input.entries);
  if (
    previous &&
    [previous.entry.firstKeptEntryId, previous.entry.retainedUserEntryId].some(
      (id) =>
        id &&
        !input.entries
          .slice(0, previous!.index)
          .some((entry) => entry.id === id && entry.type === 'message' &&
            (id !== previous!.entry.retainedUserEntryId || entry.message.role === 'user')),
    )
  )
    previous = undefined;
  const previousFirstKeptIndex = previous
    ? input.entries.findIndex((entry) => entry.id === previous.entry.firstKeptEntryId)
    : -1;
  const startIndex = previous
    ? previousFirstKeptIndex >= 0
      ? previousFirstKeptIndex
      : previous.index + 1
    : 0;
  const endIndex = input.entries.length;
  const messages = messageEntriesWithIndexes(input.entries, startIndex, endIndex);
  if (previous?.entry.retainedUserEntryId) {
    const pinnedIndex = input.entries.findIndex(
      (entry) => entry.id === previous.entry.retainedUserEntryId,
    );
    const pinned = input.entries[pinnedIndex];
    if (
      pinned?.type === 'message' &&
      pinned.message.role === 'user' &&
      !messages.some((entry) => entry.id === pinned.id)
    ) {
      messages.unshift({ ...pinned, transcriptIndex: pinnedIndex });
    }
  }
  if (messages.length < 2) return undefined;

  const firstKeptMessageIndex = chooseFirstKeptIndex(messages, settings, input.tailBudget);
  const latestUser = [...messages].reverse().find((entry) => entry.message.role === 'user');
  const pinned =
    latestUser && messages.indexOf(latestUser) < firstKeptMessageIndex ? latestUser : undefined;
  const entriesToSummarize = messages.slice(0, firstKeptMessageIndex);
  if (entriesToSummarize.length === 0) return undefined;

  const entriesToKeep = messages.slice(firstKeptMessageIndex);
  const firstKept = messages[firstKeptMessageIndex];
  const summaryTokenEstimate = previous?.entry.summary
    ? Math.ceil(previous.entry.summary.length / 4)
    : 0;
  const tokensAfterEstimate =
    summaryTokenEstimate +
    (pinned ? estimateMessageTokens(pinned.message) : 0) +
    entriesToKeep.reduce((sum, entry) => sum + estimateMessageTokens(entry.message), 0);
  return {
    previousSummary: previous?.entry.summary,
    ...(pinned ? { retainedUserEntryId: pinned.id } : {}),
    ...(firstKept
      ? {
          firstKeptEntryId: firstKept.id,
          firstKeptEntryIndex: firstKept.transcriptIndex,
        }
      : {}),
    entriesToSummarize,
    entriesToKeep,
    tokensBefore:
      summaryTokenEstimate +
      messages.reduce((sum, entry) => sum + estimateMessageTokens(entry.message), 0),
    tokensAfterEstimate,
    details: collectFileDetails(input.session, previous?.entry),
    settings,
  };
}

function latestCompaction(
  entries: TranscriptEntry[],
): { entry: CompactionEntry; index: number } | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === 'compaction') return { entry, index };
  }
  return undefined;
}

function messageEntriesWithIndexes(
  entries: TranscriptEntry[],
  startIndex: number,
  endIndex: number,
): Array<MessageEntry & { transcriptIndex: number }> {
  const messages: Array<MessageEntry & { transcriptIndex: number }> = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    const entry = entries[index];
    if (entry.type === 'message') messages.push({ ...entry, transcriptIndex: index });
  }
  return messages;
}

function collectFileDetails(
  session: BlipSessionState,
  previous?: CompactionEntry,
): { readFiles: string[]; modifiedFiles: string[] } {
  return {
    readFiles: Array.from(
      new Set([...(previous?.details.readFiles ?? []), ...session.readFiles]),
    ).sort(),
    modifiedFiles: Array.from(
      new Set([...(previous?.details.modifiedFiles ?? []), ...session.changedFiles]),
    ).sort(),
  };
}

function chooseFirstKeptIndex(
  messages: MessageEntry[],
  settings: CompactionSettings,
  tailBudget?: number,
): number {
  const budget = Math.max(
    0,
    Math.min(settings.keepRecentTokens, tailBudget ?? settings.keepRecentTokens),
  );
  const suffix = new Array<number>(messages.length + 1).fill(0);
  for (let i = messages.length - 1; i >= 0; i--)
    suffix[i] = suffix[i + 1] + estimateMessageTokens(messages[i].message);
  const users = messages.flatMap((entry, i) => (entry.message.role === 'user' ? [i] : []));
  const latestUser = users.at(-1);
  const pinnedTokens =
    latestUser === undefined ? 0 : estimateMessageTokens(messages[latestUser].message);
  const preferred =
    settings.keepRecentTurns <= 0
      ? messages.length
      : (users[Math.max(0, users.length - settings.keepRecentTurns)] ?? 0);
  const safe = [0];
  const pending = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i].message;
    if (message.role === 'assistant')
      for (const part of message.content) {
        if (part.type === 'toolCall') pending.add(part.id);
      }
    if (message.role === 'toolResult') pending.delete(message.toolCallId);
    if (!pending.size && messages[i + 1]?.message.role !== 'toolResult') safe.push(i + 1);
  }
  const fits = (i: number) =>
    suffix[i] + (latestUser !== undefined && latestUser < i ? pinnedTokens : 0) <= budget;
  // Prefer whole turns; when the latest turn is too large, retain complete tool
  // batches inside it. Never separate an assistant's parallel calls from results.
  const wholeTurn = safe.find((i) => i <= preferred && users.includes(i) && fits(i));
  if (wholeTurn !== undefined) return wholeTurn;
  const withinTurn = safe.find((i) => i >= preferred && fits(i));
  // Keeping the latest user is mandatory even if it exceeds the tail preference.
  // The caller validates the complete request before invoking the summarizer.
  return withinTurn ?? (safe.includes(messages.length) ? messages.length : 0);
}

function estimateMessageTokens(message: AgentMessage): number {
  return estimateContextTokens({} as never, { messages: [message as Message] }).inputTokens - 3;
}
