export const OPEN_SIDE_CHAT_EVENT = 'drone-hub:open-side-chat';
export const FOCUS_SIDE_CHAT_EVENT = 'drone-hub:focus-side-chat';

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

export function requestSideChat(droneId: string, target?: SideChatCheckpointTarget): boolean {
  const event = new CustomEvent<OpenSideChatDetail>(OPEN_SIDE_CHAT_EVENT, {
    detail: { droneId, ...(target ? { target } : {}) },
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
