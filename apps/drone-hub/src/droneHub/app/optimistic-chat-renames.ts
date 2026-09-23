import type { DroneSummary } from '../types';

/** Drone id -> old chat name -> new chat name, for renames the drone summary has not caught up with. */
export type OptimisticChatRenames = Record<string, Record<string, string>>;

function renameEntry(name: string, renames: Record<string, string>): string {
  return renames[name] ?? name;
}

function renameList(list: string[] | undefined, renames: Record<string, string>): string[] | undefined {
  return list ? Array.from(new Set(list.map((name) => renameEntry(name, renames)))) : list;
}

function renameKeys<T>(record: Record<string, T> | undefined, renames: Record<string, string>): Record<string, T> | undefined {
  if (!record) return record;
  const out: Record<string, T> = {};
  for (const [name, value] of Object.entries(record)) {
    const next = renameEntry(name, renames);
    // A newer entry under the new name (the summary caught up for that field) wins.
    if (next !== name && Object.prototype.hasOwnProperty.call(record, next)) continue;
    out[next] = value;
  }
  return out;
}

/**
 * The summary as it will look once the hub reports the renames. Without this, a renamed
 * chat is briefly "not listed", and the chat view drops its cached transcript and reloads.
 */
export function applyOptimisticChatRenames(drone: DroneSummary, renamesRaw: Record<string, string> | undefined): DroneSummary {
  const renames = Object.fromEntries(
    Object.entries(renamesRaw ?? {}).filter(([oldName, newName]) =>
      oldName !== newName && (drone.chats?.includes(oldName) || drone.sideChats?.some((chat) => chat.name === oldName)
        || drone.workflowChats?.includes(oldName))),
  );
  if (Object.keys(renames).length === 0) return drone;
  const chatCloneSources = renameKeys(drone.chatCloneSources, renames);
  return {
    ...drone,
    chats: renameList(drone.chats, renames) ?? [],
    workflowChats: renameList(drone.workflowChats, renames),
    sideChats: drone.sideChats?.map((chat) => ({
      ...chat,
      name: renameEntry(chat.name, renames),
      sourceChatName: renameEntry(chat.sourceChatName, renames),
    })),
    chatCloneSources: chatCloneSources
      ? Object.fromEntries(Object.entries(chatCloneSources).map(([name, source]) => [name, renameEntry(source, renames)]))
      : chatCloneSources,
    chatCreatedAt: renameKeys(drone.chatCreatedAt, renames),
    chatReadStates: renameKeys(drone.chatReadStates, renames),
    draftChats: renameKeys(drone.draftChats, renames),
    unreadChats: renameList(drone.unreadChats, renames),
    busyChats: renameList(drone.busyChats, renames),
    approvalChats: renameList(drone.approvalChats, renames),
    lastActivityChat: drone.lastActivityChat ? renameEntry(drone.lastActivityChat, renames) : drone.lastActivityChat,
  };
}

/** Drops renames the polled summaries already show (the old name is gone) and drones that are gone. */
export function pruneOptimisticChatRenames(current: OptimisticChatRenames, polledDrones: readonly DroneSummary[]): OptimisticChatRenames {
  const byId = new Map(polledDrones.map((drone) => [drone.id, drone]));
  let changed = false;
  const next: OptimisticChatRenames = {};
  for (const [droneId, renames] of Object.entries(current)) {
    const drone = byId.get(droneId);
    const kept = Object.fromEntries(Object.entries(renames).filter(([oldName]) =>
      Boolean(drone) && Boolean(drone!.chats?.includes(oldName) || drone!.sideChats?.some((chat) => chat.name === oldName)
        || drone!.workflowChats?.includes(oldName))));
    if (Object.keys(kept).length !== Object.keys(renames).length) changed = true;
    if (Object.keys(kept).length > 0) next[droneId] = kept;
  }
  return changed ? next : current;
}
