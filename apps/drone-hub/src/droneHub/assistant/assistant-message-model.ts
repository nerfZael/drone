import {
  compactPreview,
  lastAssistantContentBlock,
  latestThinkingText,
  messageImageParts,
  messageText,
  renderItemsFromMessages,
  toolCalls,
  toolItemName,
  toolLabel,
  type AssistantRenderItem,
  type AssistantToolCall,
  type AssistantToolRenderItem,
} from '@drone/assistant-chat';
import type { AssistantDroneNameMap, AssistantMessage } from './assistant-types';

const TOOL_ROW_TARGET_PREVIEW_MAX = 3;

export {
  compactPreview,
  lastAssistantContentBlock,
  latestThinkingText,
  messageImageParts,
  messageText,
  renderItemsFromMessages,
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
