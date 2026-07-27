import {
  completeSimple,
  type Model,
  type SimpleStreamOptions,
} from '@mariozechner/pi-ai/agent-core';
import type { AgentMessage, StreamFn } from '@mariozechner/pi-agent-core';
import type { BlipSessionState, TranscriptEntry } from './types.js';
import { createPortableId } from './platform.js';

const DEFAULT_TOOL_RESULT_CHARS = 2_000;
const DEFAULT_MESSAGE_CHARS = 12_000;
const DEFAULT_SUMMARY_INPUT_CHARS = 120_000;

export interface CompactionSettings {
  auto: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
  keepRecentTurns: number;
  /** Per-message cap when constructing the summarizer request. */
  maxSummaryMessageChars?: number;
  /** Total transcript cap when constructing the summarizer request. */
  maxSummaryInputChars?: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  auto: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
  keepRecentTurns: 2,
  maxSummaryMessageChars: DEFAULT_MESSAGE_CHARS,
  maxSummaryInputChars: DEFAULT_SUMMARY_INPUT_CHARS,
};

type MessageEntry = Extract<TranscriptEntry, { type: 'message' }>;
type CompactionEntry = Extract<TranscriptEntry, { type: 'compaction' }>;

export interface CompactionPlan {
  previousSummary?: string;
  firstKeptEntryId?: string;
  firstKeptEntryIndex?: number;
  entriesToSummarize: MessageEntry[];
  entriesToKeep: MessageEntry[];
  tokensBefore: number;
  tokensAfterEstimate: number;
  details: { readFiles: string[]; modifiedFiles: string[] };
  settings: CompactionSettings;
}

function textContent(content: AgentMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map((item) => (item.type === 'text' ? item.text : `[${item.type}]`)).join('\n');
}

export function messageText(message: AgentMessage, maxChars = Number.POSITIVE_INFINITY): string {
  let text = '';
  if (message.role === 'user') {
    text = textContent(message.content);
  } else if (message.role === 'assistant') {
    text = message.content
      .map((item) =>
        item.type === 'text'
          ? item.text
          : item.type === 'toolCall'
            ? `[tool:${item.name} ${JSON.stringify(item.arguments)}]`
            : `[${item.type}]`,
      )
      .join('\n');
  } else if (message.role === 'toolResult') {
    text = [
      `[tool result:${message.toolName}${message.isError ? ' error' : ''}]`,
      textContent(message.content),
    ].join('\n');
  }
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated ${text.length - maxChars} chars]`;
}

export function estimateMessageTokens(message: AgentMessage): number {
  return Math.ceil(JSON.stringify(message).length / 4);
}

function assistantUsageTokens(message: AgentMessage): number | undefined {
  if (
    message.role !== 'assistant' ||
    !message.usage ||
    message.stopReason === 'aborted' ||
    message.stopReason === 'error'
  )
    return undefined;
  const tokens =
    message.usage.totalTokens ||
    message.usage.input + message.usage.output + message.usage.cacheRead + message.usage.cacheWrite;
  return tokens > 0 ? tokens : undefined;
}

export function estimateEntriesTokens(entries: TranscriptEntry[]): number {
  let lastUsageIndex = -1;
  let usageTokens = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== 'message') continue;
    const usage = assistantUsageTokens(entry.message);
    if (usage === undefined) continue;
    lastUsageIndex = index;
    usageTokens = usage;
    break;
  }
  if (lastUsageIndex < 0) {
    return entries.reduce(
      (sum, entry) => (entry.type === 'message' ? sum + estimateMessageTokens(entry.message) : sum),
      0,
    );
  }
  return entries
    .slice(lastUsageIndex + 1)
    .reduce(
      (sum, entry) => (entry.type === 'message' ? sum + estimateMessageTokens(entry.message) : sum),
      usageTokens,
    );
}

export function estimateModelContextTokens(entries: TranscriptEntry[]): number {
  const latest = latestCompaction(entries);
  if (!latest) return estimateEntriesTokens(entries);

  let tokens = Math.ceil(latest.entry.summary.length / 4);
  let foundFirstKept = false;
  for (let index = 0; index < latest.index; index += 1) {
    const entry = entries[index];
    if (entry.id === latest.entry.firstKeptEntryId) foundFirstKept = true;
    if (foundFirstKept && entry.type === 'message') tokens += estimateMessageTokens(entry.message);
  }
  if (!foundFirstKept) return estimateEntriesTokens(entries);
  for (let index = latest.index + 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.type === 'message') tokens += estimateMessageTokens(entry.message);
  }
  return tokens;
}

export function shouldAutoCompact(input: {
  entries: TranscriptEntry[];
  contextWindow?: number;
  settings?: CompactionSettings;
}): boolean {
  const settings = input.settings ?? DEFAULT_COMPACTION_SETTINGS;
  if (!settings.auto || !input.contextWindow) return false;
  return estimateModelContextTokens(input.entries) > input.contextWindow - settings.reserveTokens;
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

function chooseFirstKeptIndex(
  messages: Array<MessageEntry & { transcriptIndex: number }>,
  settings: CompactionSettings,
): number {
  const userIndexes = messages.flatMap((entry, index) =>
    entry.message.role === 'user' ? [index] : [],
  );
  const keepRecentTurns = Math.max(1, settings.keepRecentTurns);
  if (settings.keepRecentTurns <= 0) return messages.length;
  let selected = userIndexes.length
    ? userIndexes[Math.max(0, userIndexes.length - keepRecentTurns)]
    : Math.max(0, messages.length - 1);
  let accumulatedTokens = messages
    .slice(selected)
    .reduce((sum, entry) => sum + estimateMessageTokens(entry.message), 0);

  while (selected > 0 && accumulatedTokens < settings.keepRecentTokens) {
    let previousUserIndex = -1;
    for (let index = selected - 1; index >= 0; index -= 1) {
      if (messages[index].message.role === 'user') {
        previousUserIndex = index;
        break;
      }
    }
    if (previousUserIndex < 0) break;
    const candidateTokens = messages
      .slice(previousUserIndex, selected)
      .reduce((sum, entry) => sum + estimateMessageTokens(entry.message), 0);
    if (accumulatedTokens + candidateTokens > settings.keepRecentTokens) break;
    selected = previousUserIndex;
    accumulatedTokens += candidateTokens;
  }

  return selected;
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

export function prepareCompaction(input: {
  session: BlipSessionState;
  entries: TranscriptEntry[];
  settings?: CompactionSettings;
}): CompactionPlan | undefined {
  const settings = input.settings ?? DEFAULT_COMPACTION_SETTINGS;
  const previous = latestCompaction(input.entries);
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
  if (messages.length < 2) return undefined;

  const firstKeptMessageIndex = chooseFirstKeptIndex(messages, settings);
  const entriesToSummarize = messages.slice(0, firstKeptMessageIndex);
  if (entriesToSummarize.length === 0) return undefined;

  const entriesToKeep = messages.slice(firstKeptMessageIndex);
  const firstKept = messages[firstKeptMessageIndex];
  const summaryTokenEstimate = previous?.entry.summary
    ? Math.ceil(previous.entry.summary.length / 4)
    : 0;
  const tokensAfterEstimate =
    summaryTokenEstimate +
    entriesToKeep.reduce((sum, entry) => sum + estimateMessageTokens(entry.message), 0);
  return {
    previousSummary: previous?.entry.summary,
    ...(firstKept
      ? {
          firstKeptEntryId: firstKept.id,
          firstKeptEntryIndex: firstKept.transcriptIndex,
        }
      : {}),
    entriesToSummarize,
    entriesToKeep,
    tokensBefore: estimateEntriesTokens(input.entries),
    tokensAfterEstimate,
    details: collectFileDetails(input.session, previous?.entry),
    settings,
  };
}

function serializeForSummary(entries: MessageEntry[], settings: CompactionSettings): string {
  const maxTotal = Math.max(1_000, settings.maxSummaryInputChars ?? DEFAULT_SUMMARY_INPUT_CHARS);
  const maxMessage = Math.max(500, settings.maxSummaryMessageChars ?? DEFAULT_MESSAGE_CHARS);
  let remaining = maxTotal;
  const serialized: string[] = [];
  for (let index = entries.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const entry = entries[index]!;
    const role = entry.message.role;
    const text = messageText(
      entry.message,
      Math.min(role === 'toolResult' ? DEFAULT_TOOL_RESULT_CHARS : maxMessage, remaining),
    );
    const block = `<message index="${index + 1}" id="${entry.id}" role="${role}">\n${text}\n</message>`;
    serialized.unshift(block);
    remaining -= block.length + 2;
  }
  if (serialized.length < entries.length) {
    serialized.unshift(
      `[summary input truncated: omitted ${entries.length - serialized.length} older message(s)]`,
    );
  }
  return serialized.join('\n\n');
}

function deterministicSummary(input: { session: BlipSessionState; plan: CompactionPlan }): string {
  const userGoals = input.plan.entriesToSummarize
    .filter((entry) => entry.message.role === 'user')
    .slice(-5)
    .map((entry) => `- ${messageText(entry.message, 300)}`);
  const toolResults = input.plan.entriesToSummarize
    .filter((entry) => entry.message.role === 'toolResult')
    .slice(-5)
    .map((entry) => `- ${messageText(entry.message, 250)}`);
  return [
    '## Goal',
    userGoals.length ? userGoals.join('\n') : '- (none recorded)',
    '',
    '## Constraints & Preferences',
    '- Follow repository instructions and the latest user prompt.',
    '',
    '## Progress',
    '### Done',
    '- Older conversation was compacted locally.',
    '',
    '### In Progress',
    '- Continue from the latest verbatim turn.',
    '',
    '### Blocked',
    '- (none recorded)',
    '',
    '## Key Decisions',
    input.plan.previousSummary
      ? '- Preserve still-valid details from the previous compaction summary.'
      : '- (none recorded)',
    '',
    '## Next Steps',
    '1. Continue from the latest verbatim turn.',
    '',
    '## Critical Context',
    toolResults.length ? toolResults.join('\n') : '- (none recorded)',
    '',
    '## Relevant Files',
    ...(input.plan.details.readFiles.length
      ? input.plan.details.readFiles.map((file) => `- ${file}: read`)
      : ['- (none read)']),
    ...(input.plan.details.modifiedFiles.length
      ? input.plan.details.modifiedFiles.map((file) => `- ${file}: modified`)
      : ['- (none modified)']),
    '',
    '## Risks Or Unknowns',
    '- This summary was produced by deterministic fallback and may omit nuance from older turns.',
  ].join('\n');
}

const SUMMARY_SYSTEM_PROMPT = `You are performing context compaction for a coding agent.

Only write the structured summary. Do not continue the conversation.`;

function summaryPrompt(plan: CompactionPlan): string {
  const previous = plan.previousSummary
    ? `<previous-summary>\n${plan.previousSummary}\n</previous-summary>\n\nUpdate the previous summary using the newer transcript. Preserve still-valid facts and remove stale ones.`
    : 'Create a new summary from the transcript.';
  return `${previous}

<conversation>
${serializeForSummary(plan.entriesToSummarize, plan.settings)}
</conversation>

Use this exact Markdown structure:

## Goal
- [what the user is trying to accomplish]

## Constraints & Preferences
- [user constraints, repo requirements, style preferences, or "(none)"]

## Progress
### Done
- [completed work]

### In Progress
- [current work]

### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision and rationale, or "(none)"]

## Next Steps
1. [next action]

## Critical Context
- [facts, commands, errors, identifiers, and exact paths needed to continue]

## Relevant Files
- [path: why it matters, or "(none)"]

Rules:
- Keep every section.
- Preserve exact file paths, commands, symbols, and error strings.
- Do not mention the summary process.`;
}

async function modelSummary(input: {
  model: Model<any>;
  plan: CompactionPlan;
  reasoning?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  apiKey?: string;
  streamFn?: StreamFn;
  signal?: AbortSignal;
}): Promise<string> {
  const maxTokens = Math.min(
    Math.floor(input.plan.settings.reserveTokens * 0.8),
    input.model.maxTokens > 0 ? input.model.maxTokens : Number.POSITIVE_INFINITY,
  );
  const context = {
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    messages: [
      { role: 'user' as const, content: summaryPrompt(input.plan), timestamp: Date.now() },
    ],
  };
  const options: SimpleStreamOptions =
    input.model.reasoning && input.reasoning && input.reasoning !== 'off'
      ? { maxTokens, reasoning: input.reasoning, apiKey: input.apiKey, signal: input.signal }
      : { maxTokens, apiKey: input.apiKey, signal: input.signal };
  const response = input.streamFn
    ? await (await input.streamFn(input.model, context, options)).result()
    : await completeSimple(input.model, context, options);
  if (response.stopReason === 'error' || response.stopReason === 'aborted') {
    throw new Error(response.errorMessage || `summary generation ${response.stopReason}`);
  }
  const summary = messageText(response).trim();
  if (!summary) throw new Error('summary generation returned empty text');
  return summary;
}

function appendFileMetadata(summary: string, details: CompactionPlan['details']): string {
  return [
    summary.trim(),
    '',
    '## File Metadata',
    '- Read:',
    ...(details.readFiles.length ? details.readFiles.map((file) => `  - ${file}`) : ['  - (none)']),
    '- Modified:',
    ...(details.modifiedFiles.length
      ? details.modifiedFiles.map((file) => `  - ${file}`)
      : ['  - (none)']),
  ].join('\n');
}

export async function createCompaction(input: {
  session: BlipSessionState;
  entries: TranscriptEntry[];
  trigger: 'manual' | 'auto';
  settings?: CompactionSettings;
  model?: Model<any>;
  reasoning?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  apiKey?: string;
  streamFn?: StreamFn;
  signal?: AbortSignal;
}): Promise<CompactionEntry | undefined> {
  const plan = prepareCompaction({
    session: input.session,
    entries: input.entries,
    settings: input.settings,
  });
  if (!plan) return undefined;

  let summary: string;
  let fallbackUsed = !input.model;
  let fallbackReason: string | undefined = input.model ? undefined : 'no summary model configured';
  try {
    summary = input.model
      ? await modelSummary({
          model: input.model,
          plan,
          reasoning: input.reasoning,
          apiKey: input.apiKey,
          streamFn: input.streamFn,
          signal: input.signal,
        })
      : deterministicSummary({ session: input.session, plan });
  } catch (error) {
    if (input.signal?.aborted) throw error;
    fallbackUsed = true;
    fallbackReason = error instanceof Error ? error.message : String(error);
    summary = deterministicSummary({ session: input.session, plan });
  }
  summary = appendFileMetadata(summary, plan.details);

  return {
    type: 'compaction',
    id: `cmp_${createPortableId()}`,
    createdAt: new Date().toISOString(),
    trigger: input.trigger,
    tokensBefore: plan.tokensBefore,
    tokensAfterEstimate:
      Math.ceil(summary.length / 4) +
      plan.entriesToKeep.reduce((sum, entry) => sum + estimateMessageTokens(entry.message), 0),
    fallbackUsed,
    ...(fallbackReason ? { fallbackReason: fallbackReason.slice(0, 500) } : {}),
    ...(plan.firstKeptEntryId ? { firstKeptEntryId: plan.firstKeptEntryId } : {}),
    summary,
    details: plan.details,
  };
}

export function createLocalCompaction(input: {
  session: BlipSessionState;
  entries: TranscriptEntry[];
  trigger: 'manual' | 'auto';
  settings?: CompactionSettings;
}): CompactionEntry | undefined {
  const plan = prepareCompaction({
    session: input.session,
    entries: input.entries,
    settings: input.settings,
  });
  if (!plan) return undefined;
  const summary = appendFileMetadata(
    deterministicSummary({ session: input.session, plan }),
    plan.details,
  );
  return {
    type: 'compaction',
    id: `cmp_${createPortableId()}`,
    createdAt: new Date().toISOString(),
    trigger: input.trigger,
    tokensBefore: plan.tokensBefore,
    tokensAfterEstimate:
      Math.ceil(summary.length / 4) +
      plan.entriesToKeep.reduce((sum, entry) => sum + estimateMessageTokens(entry.message), 0),
    fallbackUsed: true,
    fallbackReason: 'local deterministic compaction',
    ...(plan.firstKeptEntryId ? { firstKeptEntryId: plan.firstKeptEntryId } : {}),
    summary,
    details: plan.details,
  };
}
