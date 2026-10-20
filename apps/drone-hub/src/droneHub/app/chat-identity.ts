/**
 * A chat's name is only its label; the hub gives every chat a stable ID that a
 * rename keeps. This maps a drone's chat names to those IDs so views and caches
 * can key a chat by what survives a rename.
 */

import { profileStorageKey } from '../../profile-storage';

type ChatIds = Readonly<Record<string, string>>;

type ChatIdSource = { id: string; chatIds?: Record<string, string> };

// From the drone summaries, with this client's not-yet-reported renames applied.
let idsByDrone = new Map<string, ChatIds>();
// IDs this client knows before the summaries do: chats it renamed or is creating.
const localIdsByDrone = new Map<string, Record<string, string>>();

export type ChatRename = { droneId: string; oldName: string; newName: string };
// Renames seen in the summaries and not yet followed, one batch per summary: a
// batch's renames happened together, so two chats in it may have swapped names.
let seenRenames: ChatRename[][] = [];
// Renames this client made and already followed: "droneId\0chatId\0newName".
const followedRenames = new Set<string>();
// Old name -> the name it was renamed to, so a reference by the old name finds the chat.
const renamedToByDrone = new Map<string, Record<string, string>>();
const RENAMED_TO_LIMIT = 50;
// The last IDs seen, kept across launches so a rename made while the app was
// closed is noticed in the first summary, like one made while it is open.
const STORED_CHAT_IDS_KEY = profileStorageKey('droneHub.chatIds');
let storedChatIdsLoaded = false;
let storedChatIdsJson = '';

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

function followedRenameKey(droneId: string, chatId: string, newName: string): string {
  return `${droneId}\u0000${chatId}\u0000${newName}`;
}

function readStoredChatIds(): Map<string, ChatIds> {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(STORED_CHAT_IDS_KEY) ?? '{}');
    const out = new Map<string, ChatIds>();
    for (const [droneId, chatIds] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
      if (!chatIds || typeof chatIds !== 'object') continue;
      const valid = Object.entries(chatIds as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1]),
      );
      if (valid.length > 0) out.set(droneId, Object.fromEntries(valid));
    }
    return out;
  } catch {
    return new Map();
  }
}

function storeChatIds(chatIds: Map<string, ChatIds>): void {
  const json = JSON.stringify(Object.fromEntries(chatIds));
  if (json === storedChatIdsJson) return;
  storedChatIdsJson = json;
  try {
    globalThis.localStorage?.setItem(STORED_CHAT_IDS_KEY, json);
  } catch {
    // Without it, renames made while the app is closed are not followed.
  }
}

/** Called while the app renders its drone summaries, so the views below see the same IDs. */
export function publishChatIds(drones: readonly ChatIdSource[]): void {
  const next = new Map<string, ChatIds>();
  for (const drone of drones) if (drone.chatIds) next.set(drone.id, drone.chatIds);
  if (!storedChatIdsLoaded) {
    storedChatIdsLoaded = true;
    if (idsByDrone.size === 0) idsByDrone = readStoredChatIds();
  }
  for (const [droneId, chatIds] of next) {
    const previous = idsByDrone.get(droneId);
    if (!previous || previous === chatIds) continue;
    const nameById = new Map(Object.entries(previous).map(([chatName, chatId]) => [chatId, chatName]));
    const batch: ChatRename[] = [];
    for (const [newName, chatId] of Object.entries(chatIds)) {
      const oldName = nameById.get(chatId);
      if (oldName === undefined || oldName === newName) continue;
      rememberRenamedTo(droneId, oldName, newName);
      // Made here and followed already; following it again could move what a
      // chat that took the old name since then keeps under it.
      if (followedRenames.delete(followedRenameKey(droneId, chatId, newName))) continue;
      batch.push({ droneId, oldName, newName });
    }
    if (batch.length > 0) seenRenames.push(batch);
  }
  const previousByDrone = idsByDrone;
  idsByDrone = next;
  storeChatIds(next);
  for (const [droneId, local] of localIdsByDrone) {
    const listed = next.get(droneId) ?? {};
    const previous = previousByDrone.get(droneId) ?? {};
    for (const [chatName, chatId] of Object.entries(local)) {
      // The summary caught up: it lists that ID, under this name or a later one.
      if (Object.values(listed).includes(chatId)) delete local[chatName];
      // Another chat took the name since, so the create this ID was kept for never happened.
      // (A name still listed under a just-deleted chat's ID keeps the ID kept here.)
      else if (chatName in listed && listed[chatName] !== previous[chatName]) delete local[chatName];
    }
    if (Object.keys(local).length === 0) localIdsByDrone.delete(droneId);
  }
}

/** Renames the summaries showed since the last call, in batches that each happened together. */
export function takeSeenChatRenames(): ChatRename[][] {
  const renames = seenRenames;
  seenRenames = [];
  return renames;
}

/** The new name resolves to the same chat at once, before any view renders it. */
export function renameChatId(droneId: string, oldName: string, newName: string): void {
  const chatId = chatIdFor(droneId, oldName);
  if (!droneId || !chatId) return;
  const local = localIdsByDrone.get(droneId) ?? {};
  local[chatNameOf(newName)] = chatId;
  localIdsByDrone.set(droneId, local);
  rememberRenamedTo(droneId, chatNameOf(oldName), chatNameOf(newName));
  followedRenames.add(followedRenameKey(droneId, chatId, chatNameOf(newName)));
}

/**
 * The ID for a chat this client is about to create, sent with the create. The
 * chat resolves to it from its first render, and a retried create reuses it.
 * Never an ID the summaries list: that chat exists already.
 */
export function newChatId(droneId: string, chatName: string): string {
  const name = chatNameOf(chatName);
  const local = localIdsByDrone.get(droneId) ?? {};
  const pending = local[name];
  if (pending && !Object.values(idsByDrone.get(droneId) ?? {}).includes(pending)) return pending;
  const chatId = crypto.randomUUID();
  local[name] = chatId;
  localIdsByDrone.set(droneId, local);
  return chatId;
}

/** A create that failed: the name no longer stands for that ID. */
export function forgetNewChatId(droneId: string, chatName: string, chatId: string): void {
  const local = localIdsByDrone.get(droneId);
  const name = chatNameOf(chatName);
  if (local?.[name] !== chatId) return;
  delete local[name];
  if (Object.keys(local).length === 0) localIdsByDrone.delete(droneId);
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
  return localIdsByDrone.get(id)?.[name] ?? idsByDrone.get(id)?.[name] ?? null;
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
    localIdsByDrone.clear();
    renamedToByDrone.clear();
    followedRenames.clear();
    seenRenames = [];
    storedChatIdsLoaded = false;
    storedChatIdsJson = '';
  },
};
