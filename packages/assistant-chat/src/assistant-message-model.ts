import type { AssistantMessage } from './assistant-message-types';
import type { AgentRunFileChanges, BlipCompactionHistoryDetails } from '@blip/protocol';
import { isAgentRunFileChanges } from './agent-run-file-changes';

export type AssistantToolCall = { id: string; name: string; args: any };
export type AssistantToolRenderItem = {
  type: 'tool';
  key: string;
  call?: AssistantToolCall;
  result?: AssistantMessage;
};
export type AssistantRenderItem =
  | {
      type: 'message';
      key: string;
      message: AssistantMessage;
      showToolCalls?: boolean;
      sourceMessageIndex: number;
    }
  | AssistantToolRenderItem
  | { type: 'toolGroup'; key: string; items: AssistantToolRenderItem[] }
  | {
      type: 'compaction';
      key: string;
      details: BlipCompactionHistoryDetails;
      timestamp?: string | number;
    }
  | { type: 'runSummary'; key: string; fileChanges: AgentRunFileChanges };

function readCompactionDetails(value: unknown): BlipCompactionHistoryDetails | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const summaryId = String(raw.summaryId ?? '').trim();
  const tokensBefore = raw.tokensBefore;
  const tokensAfter = raw.tokensAfter == null ? null : raw.tokensAfter;
  if (
    !summaryId ||
    (raw.trigger !== 'manual' && raw.trigger !== 'auto') ||
    typeof tokensBefore !== 'number' ||
    !Number.isFinite(tokensBefore) ||
    tokensBefore < 0 ||
    (tokensAfter !== null &&
      (typeof tokensAfter !== 'number' || !Number.isFinite(tokensAfter) || tokensAfter < 0))
  ) {
    return null;
  }
  return {
    summaryId,
    trigger: raw.trigger,
    tokensBefore,
    tokensAfter,
    ...(raw.fallbackUsed === true ? { fallbackUsed: true } : {}),
    ...(typeof raw.fallbackReason === 'string' && raw.fallbackReason.trim()
      ? { fallbackReason: raw.fallbackReason.trim() }
      : {}),
  };
}

export function messageText(message: AssistantMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part.type === 'text') return String(part.text ?? '');
      if (part.type === 'thinking') return String(part.thinking ?? '');
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/** Text intended for the transcript, excluding private model reasoning. */
export function messageVisibleText(message: AssistantMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text')
    .map((part) => String(part.text ?? ''))
    .filter(Boolean)
    .join('\n');
}

export function messageImageParts(
  message: AssistantMessage,
): Array<{ data: string; mimeType: string }> {
  const content = message.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part?.type === 'image' && String(part.data ?? '').trim())
    .map((part) => ({
      data: String(part.data ?? '').trim(),
      mimeType: String(part.mimeType ?? '').trim() || 'image/png',
    }));
}

export function lastAssistantContentBlock(message: AssistantMessage): { type: string } | null {
  const content = message.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const part = content[index];
    if (!part || typeof part !== 'object') continue;
    const type = String(part.type ?? '');
    if (type === 'text' || type === 'thinking' || type === 'toolCall') return { type };
  }
  return null;
}

export function latestThinkingText(message: AssistantMessage): string {
  if (lastAssistantContentBlock(message)?.type !== 'thinking') return '';
  const content = message.content;
  if (!Array.isArray(content)) return '';
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const part = content[index];
    if (part?.type === 'thinking') return String(part.thinking ?? '');
  }
  return '';
}

export function toolCalls(message: AssistantMessage): AssistantToolCall[] {
  const content = message.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part.type === 'toolCall')
    .map((part) => ({
      id: String(part.id ?? ''),
      name: String(part.name ?? ''),
      args: part.arguments ?? {},
    }))
    .filter((part) => part.id && part.name);
}

export function compactPreview(raw: unknown, maxLength = 72): string {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

const TOOL_LABELS: Record<string, string> = {
  create_chat: 'Create chat',
  create_drone: 'Create drone',
  assistant_files: 'Assistant files',
  get_system_prompt: 'Read system prompt',
  update_system_prompt: 'Update system prompt',
  get_working_tree_status: 'Get working tree status',
  list_chats: 'List chats',
  get_chat_overview: 'Read chat overview',
  inspect_drone: 'Inspect drone',
  list_drones: 'List drones',
  list_groups: 'List groups',
  list_repos: 'List repositories',
  list_targets: 'List workspace targets',
  message_drone: 'Send user message to drone',
  read_chat: 'Read chat',
  read_chat_messages: 'Read chat messages',
  search_chat_messages: 'Search chat messages',
  send_message: 'Send message',
  set_drone_group: 'Set drone group',
  set_target: 'Set workspace target',
  transfer_files: 'Transfer files',
  subscribe_to_any_chat_idle: 'Subscribe to any chat idle',
  subscribe_to_all_chats_idle: 'Subscribe to all chats idle',
  subscribe_to_chats_idle: 'Subscribe to all chats idle',
  wait_for_agent_chats_idle: 'Wait for chats idle',
  list_files: 'List files',
  read_file: 'Read file',
  search_files: 'Search files',
  write_file: 'Write file',
};

export function toolLabel(name: string | undefined): string {
  const key = String(name ?? '').trim();
  if (!key) return 'Tool';
  return TOOL_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function toolItemName(item: AssistantToolRenderItem): string {
  return String(item.call?.name || item.result?.toolName || '').trim();
}

export function toolActivityIsSettled(item: AssistantToolRenderItem): boolean {
  if (!item.result) return false;
  const details = item.result.details;
  if (
    !details ||
    typeof details !== 'object' ||
    Array.isArray(details) ||
    (details as Record<string, unknown>).type !== 'workspace_transfer'
  ) {
    return true;
  }
  const phase = (details as Record<string, unknown>).phase;
  return item.result.isError === true || phase === 'completed' || phase === 'failed';
}

function canGroupToolItem(item: AssistantToolRenderItem): boolean {
  const name = toolItemName(item);
  return (
    Boolean(name) &&
    name !== 'message_drone' &&
    name !== 'subscribe_to_any_chat_idle' &&
    name !== 'subscribe_to_all_chats_idle' &&
    name !== 'subscribe_to_chats_idle' &&
    name !== 'wait_for_agent_chats_idle'
  );
}

function repeatedToolRun(item: AssistantRenderItem | undefined): AssistantToolRenderItem[] | null {
  if (!item) return null;
  if (item.type === 'tool') return canGroupToolItem(item) ? [item] : null;
  if (item.type !== 'toolGroup' || item.items.length === 0) return null;
  const name = toolItemName(item.items[0]!);
  return item.items.every((entry) => canGroupToolItem(entry) && toolItemName(entry) === name)
    ? item.items
    : null;
}

export function compactRepeatedToolItems(items: AssistantRenderItem[]): AssistantRenderItem[] {
  const compacted: AssistantRenderItem[] = [];
  for (const item of items) {
    const run = repeatedToolRun(item);
    if (!run) {
      compacted.push(item);
      continue;
    }

    const previousIndex = compacted.length - 1;
    const previousRun = repeatedToolRun(compacted[previousIndex]);
    const name = toolItemName(run[0]!);
    if (previousRun && toolItemName(previousRun[0]!) === name) {
      const combined = [...previousRun, ...run];
      compacted[previousIndex] = {
        type: 'toolGroup',
        key: `tool-group:${name}:${combined[0]!.key}:${combined.length}`,
        items: combined,
      };
    } else {
      compacted.push(item);
    }
  }
  return compacted;
}

export function renderItemsFromMessages(messages: AssistantMessage[]): AssistantRenderItem[] {
  const consumedToolResults = new Set<number>();
  const items: AssistantRenderItem[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'compaction') {
      const details = readCompactionDetails(message.details);
      if (details) {
        items.push({
          type: 'compaction',
          key: `compaction:${message.id ?? details.summaryId}`,
          details,
          timestamp: message.timestamp ?? message.createdAt,
        });
      }
      continue;
    }
    if (message.role === 'runSummary') {
      const fileChanges = (message.details as any)?.fileChanges as AgentRunFileChanges | undefined;
      if (isAgentRunFileChanges(fileChanges)) {
        items.push({
          type: 'runSummary',
          key: `run-summary:${message.id ?? index}`,
          fileChanges,
        });
      }
      continue;
    }
    if (message.role === 'toolResult') {
      if (consumedToolResults.has(index)) continue;
      const resultKey = String(message.toolCallId ?? '').trim();
      items.push({
        type: 'tool',
        key: resultKey ? `tool-result:${resultKey}` : `tool-result:idx-${index}`,
        result: message,
      });
      continue;
    }
    const calls = toolCalls(message);
    if (message.role !== 'assistant' || calls.length === 0) {
      items.push({
        type: 'message',
        key: `message:${index}:${message.role}`,
        message,
        sourceMessageIndex: index,
      });
      continue;
    }
    // A reasoning block attached to a tool call is part of the same agent run. Treating it as a
    // transcript message inserts an invisible boundary between model/tool iterations and makes one
    // user request appear as several separate tool runs.
    if (
      messageVisibleText(message).trim() ||
      messageImageParts(message).length > 0 ||
      message.errorMessage
    ) {
      items.push({
        type: 'message',
        key: `message:${index}:${message.role}`,
        message,
        showToolCalls: false,
        sourceMessageIndex: index,
      });
    }
    for (const call of calls) {
      let resultIndex = -1;
      for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
        if (consumedToolResults.has(nextIndex)) continue;
        const candidate = messages[nextIndex];
        if (candidate.role !== 'toolResult') continue;
        const candidateCallId = String(candidate.toolCallId ?? '').trim();
        if (candidateCallId && candidateCallId !== call.id) continue;
        resultIndex = nextIndex;
        break;
      }
      const result = resultIndex >= 0 ? messages[resultIndex] : undefined;
      if (resultIndex >= 0) consumedToolResults.add(resultIndex);
      items.push({ type: 'tool', key: `tool-call:${call.id}`, call, result });
    }
  }
  return compactRepeatedToolItems(items);
}
