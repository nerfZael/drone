import type { DroneSummary } from '../types';

export function allDroneChatNames(drone: DroneSummary, sideChatNames: string[] = []): string[] {
  // Group membership is sidebar presentation; drone.chats is the full inventory.
  return [...new Set([...drone.chats, ...(drone.workflowChats ?? []),
    ...(drone.sideChats ?? []).map((chat) => chat.name), ...sideChatNames])];
}

export type ChatPreviewPayload = {
  messages: Array<{ role: 'user' | 'assistant' | 'error'; text: string; at: string }>;
  pending: Array<{ prompt: string; at: string; state: string }>;
  pendingTruncated?: boolean;
};

export function latestChatPreview(payload: ChatPreviewPayload) {
  const messages = payload.messages.filter((message) => message.role !== 'error');
  const candidates = [
    ...messages.map((message) => ({ role: message.role, text: message.text, at: message.at })),
    ...payload.pending.filter((prompt) => prompt.state !== 'cancelled')
      .map((prompt) => ({ role: 'user' as const, text: prompt.prompt, at: prompt.at })),
  ];
  candidates.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  const latest = candidates[candidates.length - 1];
  return latest ? { ...latest, text: latest.text.replace(/\s+/g, ' ').trim() || 'Attachment' } : null;
}
