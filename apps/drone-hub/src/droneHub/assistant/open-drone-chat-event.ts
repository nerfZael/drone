export const ASSISTANT_OPEN_DRONE_CHAT_EVENT = 'drone-hub:assistant-open-drone-chat';

export type AssistantOpenDroneChatEventDetail = {
  droneId: string;
  chatName: string;
};

export function dispatchAssistantOpenDroneChat(droneIdRaw: string, chatNameRaw: string = 'default'): void {
  if (typeof window === 'undefined') return;
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return;
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  window.dispatchEvent(
    new CustomEvent<AssistantOpenDroneChatEventDetail>(ASSISTANT_OPEN_DRONE_CHAT_EVENT, {
      detail: { droneId, chatName },
    }),
  );
}
