import type { AssistantMessage } from '@drone/assistant-chat';
import type { TranscriptItem } from '../types';

export function latestExternalCheckpointId(turns: readonly TranscriptItem[] | null): string {
  return (
    [...(turns ?? [])]
      .reverse()
      .find(
        (turn) =>
          turn.id && turn.ok && !turn.userOnly && !turn.silentCompletion && turn.output.trim(),
      )?.id ?? ''
  );
}

export function latestNativeCheckpointId(messages: readonly AssistantMessage[]): string {
  return (
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.id &&
          message.role === 'assistant' &&
          message.stopReason === 'stop' &&
          Array.isArray(message.content) &&
          !message.content.some((part) => part.type === 'toolCall') &&
          message.content.some((part) => part.type === 'text' && part.text?.trim()),
      )?.id ?? ''
  );
}
