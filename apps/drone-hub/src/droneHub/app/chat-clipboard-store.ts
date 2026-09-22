import { create } from 'zustand';

export type CopiedChat = { droneId: string; chatName: string };
/** A drone card copied on a canvas; `nodeId` is the card it was copied from. */
export type CopiedDrone = { droneId: string; nodeId: string };

type ChatClipboardState = {
  chats: CopiedChat[];
  drones: CopiedDrone[];
  /** Replaces the whole clipboard, like any copy. */
  copy: (next: { chats: CopiedChat[]; drones?: CopiedDrone[] }) => void;
};

/**
 * What Ctrl+C or "Copy" last took from the Canvas or Chats window. Shared, so a
 * copy in one window pastes in the other. Read it through `pastableClipboard`.
 */
export const useChatClipboardStore = create<ChatClipboardState>()((set) => ({
  chats: [],
  drones: [],
  copy: ({ chats, drones = [] }) => set({
    chats: chats.map(({ droneId, chatName }) => ({ droneId, chatName })),
    drones: drones.map(({ droneId, nodeId }) => ({ droneId, nodeId })),
  }),
}));

type ClipboardContent = Pick<ChatClipboardState, 'chats' | 'drones'>;

/**
 * What can be pasted where. Inside a drone (its Chats window or canvas board)
 * only that drone's copied chats count, so a copy from another drone looks like
 * no copy at all until you return to it. The global canvas pastes everything.
 */
export function pastableClipboard(state: ClipboardContent, droneId: string | null): ClipboardContent {
  if (!droneId) return { chats: state.chats, drones: state.drones };
  return { chats: state.chats.filter((chat) => chat.droneId === droneId), drones: [] };
}

export function chatClipboardHasContent(state: ClipboardContent, droneId: string | null = null): boolean {
  const content = pastableClipboard(state, droneId);
  return content.chats.length > 0 || content.drones.length > 0;
}
