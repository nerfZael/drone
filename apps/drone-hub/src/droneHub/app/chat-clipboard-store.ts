import { create } from 'zustand';
import {
  composerReferencesBlock,
  mergeComposerReferences,
  type ComposerReference,
  type DroneNames,
} from '../chat/composer-references';

export type CopiedChat = { droneId: string; chatName: string };
/** A drone card copied on a canvas; `nodeId` is the card it was copied from. */
export type CopiedDrone = { droneId: string; nodeId: string };

type ChatClipboardState = {
  chats: CopiedChat[];
  drones: CopiedDrone[];
  /** Drone names at copy time, for reference tiles and the copied text. */
  droneNames: Record<string, string>;
  /** What the copy put on the system clipboard; a paste of exactly this text pastes the copy as references. */
  text: string;
  /**
   * Replaces the whole clipboard, like any copy. `view` is the window the copy came from:
   * a desktop tool window can only write its own system clipboard, not the Hub's.
   */
  copy: (next: { chats: CopiedChat[]; drones?: CopiedDrone[]; droneNames?: Record<string, string>; view?: Window | null }) => void;
};

function copiedReferences(state: Pick<ChatClipboardState, 'chats' | 'drones'>): ComposerReference[] {
  return mergeComposerReferences([], [
    ...state.drones.map(({ droneId }): ComposerReference => ({ kind: 'drone', droneId })),
    ...state.chats.map(({ droneId, chatName }): ComposerReference => ({ kind: 'chat', droneId, chatName })),
  ]);
}

export function droneNamesForReferences(names: Record<string, string>): DroneNames {
  return Object.fromEntries(Object.entries(names).map(([droneId, name]) => [droneId, { name }]));
}

/**
 * What Ctrl+C or "Copy" last took from the Canvas or Chats window. Shared, so a
 * copy in one window pastes in the other. Read it through `pastableClipboard`.
 * The copy also goes on the system clipboard as text, so a composer can paste it as references.
 */
export const useChatClipboardStore = create<ChatClipboardState>()((set) => ({
  chats: [],
  drones: [],
  droneNames: {},
  text: '',
  copy: ({ chats, drones = [], droneNames = {}, view }) => {
    const next = {
      chats: chats.map(({ droneId, chatName }) => ({ droneId, chatName })),
      drones: drones.map(({ droneId, nodeId }) => ({ droneId, nodeId })),
      droneNames: { ...droneNames },
    };
    const text = composerReferencesBlock(copiedReferences(next), droneNamesForReferences(next.droneNames));
    set({ ...next, text });
    // No focus-stealing fallback: copying must leave the keyboard on the canvas or Chats window.
    void (view ?? globalThis).navigator?.clipboard?.writeText?.(text)?.catch?.(() => {});
  },
}));

/**
 * The copied drones and chats, when the pasted text is what the last copy put on the
 * system clipboard. Anything copied since (elsewhere) pastes as usual.
 */
export function pastedChatReferences(
  clipboardData: Pick<DataTransfer, 'getData'> | null | undefined,
  state: Pick<ChatClipboardState, 'chats' | 'drones' | 'droneNames' | 'text'> = useChatClipboardStore.getState(),
): { references: ComposerReference[]; droneNames: Record<string, string>; text: string } | null {
  const pasted = String(clipboardData?.getData('text/plain') ?? '').trim();
  if (!pasted || !state.text || pasted !== state.text.trim()) return null;
  const references = copiedReferences(state);
  return references.length ? { references, droneNames: state.droneNames, text: state.text } : null;
}

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
