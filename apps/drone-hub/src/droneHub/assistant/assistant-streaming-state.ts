import { messageVisibleText, type AssistantRenderItem } from '@drone/assistant-chat';

import type { AssistantMessage } from './assistant-types';

function normalizedVisibleText(message: AssistantMessage): string {
  return messageVisibleText(message).trim();
}

export function historyContainsStreamingAssistantText(
  messages: AssistantMessage[],
  streamingText: string,
): boolean {
  const expected = streamingText.trim();
  if (!expected) return false;
  return messages.some(
    (message) =>
      message.role === 'assistant' && normalizedVisibleText(message) === expected,
  );
}

export function hasVisibleAssistantStreamingText(messages: AssistantMessage[]): boolean {
  return messages.some(
    (message) => message.role === 'assistant' && Boolean(normalizedVisibleText(message)),
  );
}

export function latestActivityHasVisibleAssistantText(
  items: AssistantRenderItem[],
): boolean {
  const latest = items[items.length - 1];
  return Boolean(
    latest?.type === 'message' &&
      latest.message.role === 'assistant' &&
      normalizedVisibleText(latest.message),
  );
}

export function visibleAssistantStreamingMessages({
  persistedMessages,
  snapshotMessages,
  localMessage,
}: {
  persistedMessages: AssistantMessage[];
  snapshotMessages: AssistantMessage[];
  localMessage: AssistantMessage | null;
}): AssistantMessage[] {
  const visibleSnapshot = snapshotMessages.filter(
    (message) => message.role === 'assistant' || message.role === 'user',
  );
  const snapshotWithoutAssistant = localMessage
    ? visibleSnapshot.filter((message) => message.role !== 'assistant')
    : visibleSnapshot;
  const candidates = localMessage
    ? [...snapshotWithoutAssistant, localMessage]
    : snapshotWithoutAssistant;

  return candidates.filter((message) => {
    if (message.role !== 'assistant') return true;
    const text = normalizedVisibleText(message);
    return !text || !historyContainsStreamingAssistantText(persistedMessages, text);
  });
}
