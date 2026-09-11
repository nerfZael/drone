import { estimateContextTokens, type Message, type Model } from '@mariozechner/pi-ai/agent-core';
import type { AgentMessage, StreamFn } from '@mariozechner/pi-agent-core';
import type { BlipSessionState, TranscriptEntry } from './types.js';
import { createPortableId } from './platform.js';
import { prepareCompaction, type CompactionPlan } from './prepareCompaction.js';
import { compactionBudget, resolveCompactionSettings, type CompactionSettings } from './compaction-settings.js';
export { prepareCompaction, type CompactionPlan } from './prepareCompaction.js';
export { DEFAULT_COMPACTION_SETTINGS, type CompactionSettings } from './compaction-settings.js';
import { deterministicSummary } from './helpers/compaction-summary-input.js';
import { modelSummary } from './helpers/compaction-summary.js';
import { compactionFileMetadata } from './helpers/compaction-file-metadata.js';

type CompactionEntry = Extract<TranscriptEntry, { type: 'compaction' }>;
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
  return estimateContextTokens({} as never, { messages: [message as Message] }).inputTokens - 3;
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


export async function createCompaction(input: {
  session: BlipSessionState;
  entries: TranscriptEntry[];
  trigger: 'manual' | 'auto';
  settings?: CompactionSettings;
  plan?: CompactionPlan;
  model?: Model<any>;
  reasoning?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  apiKey?: string;
  streamFn?: StreamFn;
  onModelCall?: (phase: 'started' | 'finished') => void | Promise<void>;
  onModelActivity?: () => void | Promise<void>;
  onUsage?: (response: import('@mariozechner/pi-ai').AssistantMessage) => Promise<void>;
  signal?: AbortSignal;
}): Promise<CompactionEntry | undefined> {
  const plan = input.plan ?? prepareCompaction({
    session: input.session,
    entries: input.entries,
    settings: input.settings,
  });
  if (!plan) return undefined;
  input.signal?.throwIfAborted();
  const settings = resolveCompactionSettings(plan.settings);
  const summaryTokens = input.model
    ? compactionBudget(input.model, settings).summaryTokens
    : settings.summaryMaxTokens;
  const metadata = compactionFileMetadata(plan.details, summaryTokens);
  const generationTokens = Math.max(1, summaryTokens - Math.ceil(metadata.length / 4));

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
          onUsage: input.onUsage,
          onModelCall: input.onModelCall,
          onModelActivity: input.onModelActivity,
          signal: input.signal,
          maxTokens: generationTokens,
        })
      : deterministicSummary(plan);
  } catch (error) {
    if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    fallbackUsed = true;
    fallbackReason = error instanceof Error ? error.message : String(error);
    summary = deterministicSummary(plan);
  }
  summary = summary.trim() + metadata;

  return {
    type: 'compaction',
    id: `cmp_${createPortableId()}`,
    createdAt: new Date().toISOString(),
    trigger: input.trigger,
    tokensBefore: plan.tokensBefore,
    tokensAfterEstimate:
      Math.ceil(summary.length / 4) +
      plan.tokensAfterEstimate - Math.ceil((plan.previousSummary?.length ?? 0) / 4),
    fallbackUsed,
    ...(fallbackReason ? { fallbackReason: fallbackReason.slice(0, 500) } : {}),
    ...(plan.firstKeptEntryId ? { firstKeptEntryId: plan.firstKeptEntryId } : {}),
    ...(plan.retainedUserEntryId ? { retainedUserEntryId: plan.retainedUserEntryId } : {}),
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
  const summary = deterministicSummary(plan).trim() + compactionFileMetadata(
    plan.details, resolveCompactionSettings(plan.settings).summaryMaxTokens,
  );
  return {
    type: 'compaction',
    id: `cmp_${createPortableId()}`,
    createdAt: new Date().toISOString(),
    trigger: input.trigger,
    tokensBefore: plan.tokensBefore,
    tokensAfterEstimate:
      Math.ceil(summary.length / 4) +
      plan.tokensAfterEstimate - Math.ceil((plan.previousSummary?.length ?? 0) / 4),
    fallbackUsed: true,
    fallbackReason: 'local deterministic compaction',
    ...(plan.firstKeptEntryId ? { firstKeptEntryId: plan.firstKeptEntryId } : {}),
    ...(plan.retainedUserEntryId ? { retainedUserEntryId: plan.retainedUserEntryId } : {}),
    summary,
    details: plan.details,
  };
}
