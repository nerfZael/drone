import { dispatchAssistantOpenDroneChat } from '../assistant/open-drone-chat-event';
export const OPEN_SIDE_CHAT_EVENT = 'drone-hub:open-side-chat';
export const FOCUS_SIDE_CHAT_EVENT = 'drone-hub:focus-side-chat';
export const ALIGN_FLOATING_CHATS_EVENT = 'drone-hub:align-floating-chats';

export function requestAlignFloatingChats(droneId: string): boolean {
  const event = new CustomEvent(ALIGN_FLOATING_CHATS_EVENT, { detail: { droneId }, cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

export type SideChatCheckpointTarget = { sourceChatName: string; checkpointId: string };
export type OpenSideChatDetail = { droneId: string; target?: SideChatCheckpointTarget };

export function focusSideChat(droneId: string, chatName: string): boolean {
  const event = new CustomEvent(FOCUS_SIDE_CHAT_EVENT, {
    detail: { droneId, chatName },
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

let pendingSideChat: OpenSideChatDetail | null = null;

export function consumePendingSideChat(droneId: string): OpenSideChatDetail | null {
  if (pendingSideChat?.droneId !== droneId) return null;
  const pending = pendingSideChat;
  pendingSideChat = null;
  return pending;
}

export function requestSideChat(droneId: string, target?: SideChatCheckpointTarget): boolean {
  if (!target) {
    const active = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('[data-side-chat-active="true"]');
    const detached = active ? [...document.querySelectorAll<HTMLElement>('[data-detached-chat-key]')]
      .find((node) => node.dataset.detachedChatKey === active.dataset.sideChatName) : null;
    if (detached) {
      const checkpointId = detached.querySelector<HTMLElement>('[data-side-chat-checkpoint-id]')?.dataset.sideChatCheckpointId;
      if (!checkpointId || !detached.dataset.chatDroneId || !detached.dataset.chatName) return false;
      droneId = detached.dataset.chatDroneId;
      target = { sourceChatName: detached.dataset.chatName, checkpointId };
    }
  }
  const event = new CustomEvent<OpenSideChatDetail>(OPEN_SIDE_CHAT_EVENT, {
    detail: { droneId, ...(target ? { target } : {}) },
    cancelable: true,
  });
  window.dispatchEvent(event);
  if (event.defaultPrevented) return true;
  if (!target) return false;
  pendingSideChat = { droneId, target };
  dispatchAssistantOpenDroneChat(droneId, target.sourceChatName);
  return true;
}
