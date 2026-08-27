export const ASSISTANT_OPEN_DRONE_CHAT_EVENT = 'drone-hub:assistant-open-drone-chat';

export type AssistantOpenDroneChatEventDetail = {
  droneId?: string;
  droneName?: string;
  chatName?: string | null;
};

export function dispatchAssistantOpenDroneTarget(input: AssistantOpenDroneChatEventDetail): void {
  if (typeof window === 'undefined') return;
  const droneId = String(input.droneId ?? '').trim();
  const droneName = String(input.droneName ?? '').trim();
  if (!droneId && !droneName) return;
  const chatName = input.chatName === null ? null : String(input.chatName ?? '').trim() || null;
  window.dispatchEvent(
    new CustomEvent<AssistantOpenDroneChatEventDetail>(ASSISTANT_OPEN_DRONE_CHAT_EVENT, {
      detail: { droneId, droneName, chatName },
    }),
  );
}

export function dispatchAssistantOpenDroneChat(
  droneIdRaw: string,
  chatNameRaw: string = 'default',
): void {
  dispatchAssistantOpenDroneTarget({
    droneId: droneIdRaw,
    chatName: String(chatNameRaw ?? '').trim() || 'default',
  });
}
