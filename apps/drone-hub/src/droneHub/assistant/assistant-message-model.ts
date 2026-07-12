import type { AssistantDroneNameMap, AssistantMessage } from './assistant-types';

const TOOL_ROW_MESSAGE_PREVIEW_MAX = 72;
const TOOL_ROW_TARGET_PREVIEW_MAX = 3;

export type AssistantToolCall = { id: string; name: string; args: any };
export type AssistantWaitTargetLabel = { key: string; droneLabel: string; chatName: string };
export type AssistantMessageDroneSummary = {
  droneLabel: string;
  chatName: string;
  message: string;
};
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
  | { type: 'toolGroup'; key: string; items: AssistantToolRenderItem[] };

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
  for (let i = content.length - 1; i >= 0; i -= 1) {
    const part = content[i];
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
  for (let i = content.length - 1; i >= 0; i -= 1) {
    const part = content[i];
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

const TOOL_LABELS: Record<string, string> = {
  create_chat: 'Create chat',
  create_drone: 'Create drone',
  get_current_context: 'Read current context',
  get_system_prompt: 'Read system prompt',
  update_system_prompt: 'Update system prompt',
  get_working_tree_status: 'Get working tree status',
  list_chats: 'List chats',
  list_drones: 'List drones',
  list_groups: 'List groups',
  list_repos: 'List repositories',
  list_targets: 'List workspace targets',
  read_chat: 'Read chat',
  send_message: 'Send message',
  set_drone_group: 'Set drone group',
  set_target: 'Set workspace target',
  subscribe_to_any_chat_idle: 'Subscribe to any chat idle',
  subscribe_to_all_chats_idle: 'Subscribe to all chats idle',
  subscribe_to_chats_idle: 'Subscribe to all chats idle',
  wait_for_agent_chats_idle: 'Wait for chats idle',
};

export function isChatIdleToolName(name: string | undefined): boolean {
  return (
    name === 'subscribe_to_any_chat_idle' ||
    name === 'subscribe_to_all_chats_idle' ||
    name === 'subscribe_to_chats_idle' ||
    name === 'wait_for_agent_chats_idle'
  );
}

export function toolLabel(name: string | undefined): string {
  const key = String(name ?? '').trim();
  if (!key) return 'Tool';
  return TOOL_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizeAssistantWaitTargets(
  args: any,
  droneNameById: AssistantDroneNameMap,
): AssistantWaitTargetLabel[] {
  const rawTargets = Array.isArray(args?.targets) ? args.targets : [];
  const seen = new Set<string>();
  const targets: AssistantWaitTargetLabel[] = [];
  for (const rawTarget of rawTargets) {
    const droneId = String(rawTarget?.droneId ?? rawTarget?.id ?? rawTarget?.drone ?? '').trim();
    const explicitName = String(
      rawTarget?.droneName ?? rawTarget?.name ?? rawTarget?.displayName ?? '',
    ).trim();
    const chatName =
      String(rawTarget?.chatName ?? rawTarget?.chat ?? 'default').trim() || 'default';
    const key = `${droneId || explicitName}\u0000${chatName}`;
    if ((!droneId && !explicitName) || seen.has(key)) continue;
    seen.add(key);
    targets.push({ key, droneLabel: explicitName || droneNameById[droneId] || droneId, chatName });
  }
  return targets;
}

export function compactPreview(raw: unknown, maxLength = TOOL_ROW_MESSAGE_PREVIEW_MAX): string {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function summarizeWaitTargets(targets: AssistantWaitTargetLabel[]): string {
  if (targets.length === 0) return '';
  const labels = targets.map((target) => target.droneLabel).filter(Boolean);
  const visible = labels.slice(0, TOOL_ROW_TARGET_PREVIEW_MAX);
  const remainder = labels.length - visible.length;
  return remainder > 0 ? `${visible.join(', ')} +${remainder}` : visible.join(', ');
}

function messageDroneSummary(args: any, droneNameById: AssistantDroneNameMap): string {
  const resolved = args?.resolved ?? args ?? {};
  const droneId = String(resolved?.droneId ?? resolved?.id ?? args?.droneId ?? '').trim();
  const droneLabel =
    String(resolved?.droneName ?? resolved?.name ?? '').trim() || droneNameById[droneId] || droneId;
  const message = compactPreview(
    resolved?.message ?? resolved?.prompt ?? args?.message ?? args?.prompt,
  );
  if (droneLabel && message) return `${droneLabel}: ${message}`;
  return droneLabel || message;
}

export function messageDroneDetails(
  args: any,
  droneNameById: AssistantDroneNameMap,
): AssistantMessageDroneSummary {
  const resolved = args?.resolved ?? args ?? {};
  const droneId = String(resolved?.droneId ?? resolved?.id ?? args?.droneId ?? '').trim();
  const droneLabel =
    String(resolved?.droneName ?? resolved?.name ?? '').trim() || droneNameById[droneId] || droneId;
  const chatName = String(resolved?.chatName ?? args?.chatName ?? '').trim();
  const message = String(
    resolved?.message ?? resolved?.prompt ?? args?.message ?? args?.prompt ?? '',
  ).trim();
  return { droneLabel, chatName, message };
}

export function toolActivityTitle(
  call: AssistantToolCall | undefined,
  result: AssistantMessage | undefined,
  droneNameById: AssistantDroneNameMap,
): string {
  const baseTitle = toolLabel(call?.name || result?.toolName);
  if (!call) return baseTitle;
  if (isChatIdleToolName(call.name)) {
    const summary = summarizeWaitTargets(normalizeAssistantWaitTargets(call.args, droneNameById));
    return summary ? `${baseTitle}: ${summary}` : baseTitle;
  }
  if (call.name === 'message_drone') {
    const summary = messageDroneSummary(call.args, droneNameById);
    return summary ? `${baseTitle}: ${summary}` : baseTitle;
  }
  return baseTitle;
}

export function toolItemName(item: AssistantToolRenderItem): string {
  return String(item.call?.name || item.result?.toolName || '').trim();
}

function canGroupToolItem(item: AssistantToolRenderItem): boolean {
  const name = toolItemName(item);
  return Boolean(name) && name !== 'message_drone' && !isChatIdleToolName(name);
}

function compactRepeatedToolItems(items: AssistantRenderItem[]): AssistantRenderItem[] {
  const compacted: AssistantRenderItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.type !== 'tool' || !canGroupToolItem(item)) {
      compacted.push(item);
      continue;
    }
    const name = toolItemName(item);
    const run: AssistantToolRenderItem[] = [item];
    let nextIndex = index + 1;
    while (nextIndex < items.length) {
      const next = items[nextIndex];
      if (next.type !== 'tool' || !canGroupToolItem(next) || toolItemName(next) !== name) break;
      run.push(next);
      nextIndex += 1;
    }
    if (run.length > 1) {
      compacted.push({
        type: 'toolGroup',
        key: `tool-group:${name}:${run[0].key}:${run.length}`,
        items: run,
      });
      index = nextIndex - 1;
    } else {
      compacted.push(item);
    }
  }
  return compacted;
}

export function toolDroneLookupKey(items: AssistantRenderItem[]): string {
  const keys: string[] = [];
  for (const item of items) {
    if (item.type !== 'tool' || !item.call) continue;
    if (isChatIdleToolName(item.call.name)) {
      const targets = Array.isArray(item.call.args?.targets) ? item.call.args.targets : [];
      for (const target of targets) {
        const droneId = String(target?.droneId ?? target?.id ?? target?.drone ?? '').trim();
        if (!droneId) continue;
        const chatName = String(target?.chatName ?? target?.chat ?? 'default').trim() || 'default';
        keys.push(`${droneId}:${chatName}`);
      }
      continue;
    }
    if (item.call.name === 'message_drone') {
      const droneId = String(
        item.call.args?.resolved?.droneId ?? item.call.args?.droneId ?? '',
      ).trim();
      if (droneId) keys.push(droneId);
    }
  }
  return keys.join('|');
}

export function renderItemsFromMessages(messages: AssistantMessage[]): AssistantRenderItem[] {
  const consumedToolResults = new Set<number>();
  const items: AssistantRenderItem[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
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
    if (messageText(message).trim() || message.errorMessage) {
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
