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

export type ChatRename = { droneId: string; oldName: string; newName: string };
// Renames seen in the summaries, from this client or anywhere else, not yet followed.
let seenRenames: ChatRename[] = [];
// Old name -> the name it was renamed to, so a reference by the old name finds the chat.
const renamedToByDrone = new Map<string, Record<string, string>>();
const RENAMED_TO_LIMIT = 50;

function rememberRenamedTo(droneId: string, oldName: string, newName: string): void {
  const renamedTo = renamedToByDrone.get(droneId) ?? {};
  delete renamedTo[oldName];
  renamedTo[oldName] = newName;
  const oldest = Object.keys(renamedTo);
  for (const name of oldest.slice(0, Math.max(0, oldest.length - RENAMED_TO_LIMIT))) delete renamedTo[name];
  renamedToByDrone.set(droneId, renamedTo);
}

function chatNameOf(chatName: string | null | undefined): string {
  return String(chatName ?? '').trim() || 'default';
}

/** Called while the app renders its drone summaries, so the views below see the same IDs. */
export function publishChatIds(drones: readonly ChatIdSource[]): void {
  const next = new Map<string, ChatIds>();
  for (const drone of drones) if (drone.chatIds) next.set(drone.id, drone.chatIds);
  for (const [droneId, chatIds] of next) {
    const previous = idsByDrone.get(droneId);
    if (!previous || previous === chatIds) continue;
    const nameById = new Map(Object.entries(previous).map(([chatName, chatId]) => [chatId, chatName]));
    for (const [newName, chatId] of Object.entries(chatIds)) {
      const oldName = nameById.get(chatId);
      if (oldName === undefined || oldName === newName) continue;
      seenRenames.push({ droneId, oldName, newName });
      rememberRenamedTo(droneId, oldName, newName);
    }
  }
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

/** Renames the summaries showed since the last call, in the order they happened. */
export function takeSeenChatRenames(): ChatRename[] {
  const renames = seenRenames;
  seenRenames = [];
  return renames;
}

/** The new name resolves to the same chat at once, before any view renders it. */
export function renameChatId(droneId: string, oldName: string, newName: string): void {
  const chatId = chatIdFor(droneId, oldName);
  if (!droneId || !chatId) return;
  const renamed = renamedIdsByDrone.get(droneId) ?? {};
  renamed[chatNameOf(newName)] = chatId;
  renamedIdsByDrone.set(droneId, renamed);
  rememberRenamedTo(droneId, chatNameOf(oldName), chatNameOf(newName));
}

/** The chat's name now: a name no chat holds any more leads to the chat it was renamed to. */
export function currentChatName(droneId: string | null | undefined, chatName: string): string {
  const id = String(droneId ?? '').trim();
  const renamedTo = renamedToByDrone.get(id);
  let name = chatName;
  for (let hops = 0; renamedTo?.[name] && !chatIdFor(id, name) && hops < RENAMED_TO_LIMIT; hops += 1) {
    name = renamedTo[name]!;
  }
  return name;
}

export function chatIdFor(droneId: string | null | undefined, chatName: string | null | undefined): string | null {
  const id = String(droneId ?? '').trim();
  if (!id) return null;
  const name = chatNameOf(chatName);
  return renamedIdsByDrone.get(id)?.[name] ?? idsByDrone.get(id)?.[name] ?? null;
}

/**
 * The chat's segment in a hub route: its ID once known, so the request reaches
 * this chat even if it is renamed meanwhile; its name until then.
 */
export function chatPathRef(droneId: string | null | undefined, chatName: string | null | undefined): string {
  return encodeURIComponent(chatIdFor(droneId, chatName) ?? chatNameOf(chatName));
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
    renamedToByDrone.clear();
    seenRenames = [];
  },
};
