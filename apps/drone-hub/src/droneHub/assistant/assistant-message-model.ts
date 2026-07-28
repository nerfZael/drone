import {
  compactRepeatedToolItems,
  compactPreview,
  lastAssistantContentBlock,
  latestThinkingText,
  messageImageParts,
  messageText,
  messageVisibleText,
  renderItemsFromMessages,
  toolActivityIsSettled,
  toolCalls,
  toolItemName,
  toolLabel,
  type AssistantRenderItem,
  type AssistantToolCall,
  type AssistantToolRenderItem,
} from '@drone/assistant-chat';
import type {
  AssistantDroneNameMap,
  AssistantMessage,
  AssistantQueuedPrompt,
} from './assistant-types';

const TOOL_ROW_TARGET_PREVIEW_MAX = 3;

export {
  compactRepeatedToolItems,
  compactPreview,
  lastAssistantContentBlock,
  latestThinkingText,
  messageImageParts,
  messageText,
  messageVisibleText,
  renderItemsFromMessages,
  toolActivityIsSettled,
  toolCalls,
  toolItemName,
  toolLabel,
};
export type { AssistantRenderItem, AssistantToolCall, AssistantToolRenderItem };
export type AssistantWaitTargetLabel = { key: string; droneLabel: string; chatName: string };
export type AssistantMessageDroneSummary = {
  droneLabel: string;
  chatName: string;
  message: string;
};

export type AssistantRunTiming = {
  startedAt?: number;
  endedAt?: number;
};

export function assistantTranscriptHasErrorMessage(
  messages: ReadonlyArray<{
    role?: string;
    errorMessage?: string | null;
  }>,
  error: string | null | undefined,
): boolean {
  const normalized = String(error ?? '').trim();
  if (!normalized) return false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== 'assistant' && message.role !== 'user') continue;
    return (
      message.role === 'assistant' &&
      String(message.errorMessage ?? '').trim() === normalized
    );
  }
  return false;
}

export function assistantMessageTimestampMs(
  message: AssistantMessage | undefined,
): number | undefined {
  if (!message) return undefined;
  const value = message.createdAt ?? message.timestamp;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function directAssistantRunTiming(
  items: AssistantRenderItem[],
  userItemIndex: number,
): AssistantRunTiming | null {
  const userItem = items[userItemIndex];
  if (userItem?.type !== 'message' || userItem.message.role !== 'user') return null;

  let hasAssistantReply = false;
  let endedAt: number | undefined;
  for (let index = userItemIndex + 1; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.type === 'message' && item.message.role === 'user') break;
    if (item.type !== 'message') return null;
    if (item.message.role !== 'assistant') continue;
    hasAssistantReply = true;
    endedAt = assistantMessageTimestampMs(item.message) ?? endedAt;
  }

  if (!hasAssistantReply) return null;
  return {
    startedAt: assistantMessageTimestampMs(userItem.message),
    endedAt,
  };
}

export function assistantHasEnabledMcpGroup(
  tools: Array<{ name: string; group?: { kind?: string; id?: string } | null }>,
  enabledToolNames: string[],
  groupId: string,
): boolean {
  const enabled = new Set(enabledToolNames);
  return tools.some(
    (tool) =>
      tool.group?.kind === 'mcp' &&
      tool.group.id === groupId &&
      enabled.has(tool.name),
  );
}

export function assistantPromptHasVisibleUserMessage(
  messages: Array<{ role: string; content?: unknown; timestamp?: unknown }>,
  prompt: AssistantQueuedPrompt,
): boolean {
  return assistantUserPromptIsVisible(messages, {
    prompt: prompt.prompt,
    createdAt: prompt.createdAt,
  });
}

export function assistantUserPromptIsVisible(
  messages: Array<{ role: string; content?: unknown; timestamp?: unknown }>,
  prompt: { prompt: string; createdAt?: string | number | null },
): boolean {
  const promptText = String(prompt.prompt ?? '').trim();
  if (!promptText) return false;
  const createdAtMs =
    typeof prompt.createdAt === 'number'
      ? prompt.createdAt
      : Date.parse(String(prompt.createdAt ?? ''));
  return messages.some((message) => {
    if (message.role !== 'user') return false;
    const text = messageText(message as AssistantMessage).trim();
    if (text !== promptText && !text.startsWith(`${promptText}\n\nAttached files:`)) return false;
    if (!Number.isFinite(createdAtMs)) return true;
    const timestamp = (message as any).timestamp;
    const messageAtMs =
      typeof timestamp === 'number' && Number.isFinite(timestamp)
        ? timestamp
        : Date.parse(String(timestamp ?? ''));
    return !Number.isFinite(messageAtMs) || messageAtMs >= createdAtMs - 5_000;
  });
}
export function isChatIdleToolName(name: string | undefined): boolean {
  return (
    name === 'subscribe_to_any_chat_idle' ||
    name === 'subscribe_to_all_chats_idle' ||
    name === 'subscribe_to_chats_idle' ||
    name === 'wait_for_agent_chats_idle'
  );
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
