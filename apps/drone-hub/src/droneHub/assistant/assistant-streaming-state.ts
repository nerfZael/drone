import { messageVisibleText, type AssistantRenderItem } from '@drone/assistant-chat';

import type { AssistantMessage } from './assistant-types';

function normalizedVisibleText(message: AssistantMessage): string {
  return messageVisibleText(message).trim();
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
