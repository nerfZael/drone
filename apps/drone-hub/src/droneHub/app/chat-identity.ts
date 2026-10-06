/**
 * A chat's name is only its label; the hub gives every chat a stable ID that a
 * rename keeps. This maps a drone's chat names to those IDs so views and caches
 * can key a chat by what survives a rename.
 */

type ChatIds = Readonly<Record<string, string>>;

type ChatIdSource = { id: string; chatIds?: Record<string, string> };

// From the drone summaries, with this client's not-yet-reported renames applied.
let idsByDrone = new Map<string, ChatIds>();
// Renames made here, before the summaries show them.
const renamedIdsByDrone = new Map<string, Record<string, string>>();

function chatNameOf(chatName: string | null | undefined): string {
  return String(chatName ?? '').trim() || 'default';
}

/** Called while the app renders its drone summaries, so the views below see the same IDs. */
export function publishChatIds(drones: readonly ChatIdSource[]): void {
  const next = new Map<string, ChatIds>();
  for (const drone of drones) if (drone.chatIds) next.set(drone.id, drone.chatIds);
  idsByDrone = next;
  for (const [droneId, renamed] of renamedIdsByDrone) {
    const listed = next.get(droneId) ?? {};
    for (const [chatName, chatId] of Object.entries(renamed)) {
      // The summary caught up: it lists that ID, under this name or a later one.
      if (Object.values(listed).includes(chatId)) delete renamed[chatName];
    }
    if (Object.keys(renamed).length === 0) renamedIdsByDrone.delete(droneId);
  }
}

/** The new name resolves to the same chat at once, before any view renders it. */
export function renameChatId(droneId: string, oldName: string, newName: string): void {
  const chatId = chatIdFor(droneId, oldName);
  if (!droneId || !chatId) return;
  const renamed = renamedIdsByDrone.get(droneId) ?? {};
  renamed[chatNameOf(newName)] = chatId;
  renamedIdsByDrone.set(droneId, renamed);
}

export function chatIdFor(droneId: string | null | undefined, chatName: string | null | undefined): string | null {
  const id = String(droneId ?? '').trim();
  if (!id) return null;
  const name = chatNameOf(chatName);
  return renamedIdsByDrone.get(id)?.[name] ?? idsByDrone.get(id)?.[name] ?? null;
}

/** One chat's identity within its drone: its ID once known, its name until then. */
export function chatIdentity(droneId: string | null | undefined, chatName: string | null | undefined): string {
  const chatId = chatIdFor(droneId, chatName);
  // The hub rejects control characters in chat names, so an ID never reads as a name.
  return chatId ? `\u0001${chatId}` : chatNameOf(chatName);
}

/**
 * Whether a view that showed the chat at `previousKey` still shows the same chat at
 * `nextKey`: the same ID after a rename, or a chat known by name whose ID just arrived.
 * Both keys come from `chatSelectionKey`.
 */
export function continuesChat(previousKey: string, nextKey: string): boolean {
  if (previousKey === nextKey) return true;
  const separator = previousKey.indexOf('\u0000');
  const droneId = previousKey.slice(0, separator);
  const previous = previousKey.slice(separator + 1);
  if (separator < 0 || !nextKey.startsWith(`${droneId}\u0000\u0001`) || previous.startsWith('\u0001')) return false;
  return `${droneId}\u0000${chatIdentity(droneId, previous)}` === nextKey;
}

export const chatIdentityTesting = {
  reset() {
    idsByDrone = new Map();
    renamedIdsByDrone.clear();
  },
};
