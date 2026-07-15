import type { LocalAssistantMessage } from './local-assistant-types';

export function messagesAfterDeletion(
  messages: LocalAssistantMessage[],
  messageId: string,
  deleteFollowing: boolean,
): LocalAssistantMessage[] | null {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return null;
  if (deleteFollowing) return messages.slice(0, index);
  const selected = messages[index];
  const toolCallIds = new Set(
    selected.role === 'assistant' && Array.isArray(selected.content)
      ? selected.content
          .filter((part) => part?.type === 'toolCall')
          .map((part) => String(part.id ?? '').trim())
          .filter(Boolean)
      : [],
  );
  return messages.filter(
    (message, messageIndex) =>
      messageIndex !== index &&
      !(
        message.role === 'toolResult' &&
        toolCallIds.has(String(message.toolCallId ?? '').trim())
      ),
  );
}
