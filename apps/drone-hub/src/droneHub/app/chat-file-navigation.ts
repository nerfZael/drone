import type { MarkdownFileReference } from '../chat/MarkdownMessage';
import { dispatchAssistantOpenDroneChat } from '../assistant/open-drone-chat-event';

export const CHAT_OPEN_FILE_EVENT = 'drone-hub:chat-open-file';
type ChatFileOpenRequest = { droneId: string; chatName: string; ref: MarkdownFileReference };
let pending: ChatFileOpenRequest | null = null;

export function requestChatFileOpen(request: ChatFileOpenRequest): void {
  pending = request;
  dispatchAssistantOpenDroneChat(request.droneId, request.chatName);
  window.dispatchEvent(new CustomEvent(CHAT_OPEN_FILE_EVENT));
}

export function consumeChatFileOpen(droneId: string): ChatFileOpenRequest | null {
  if (pending?.droneId !== droneId) return null;
  const request = pending;
  pending = null;
  return request;
}
