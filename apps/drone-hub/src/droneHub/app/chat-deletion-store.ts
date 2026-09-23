import { create } from 'zustand';
import { createCanvasChatNodeId, parseCanvasChatNodeId } from './app-config';
import type { DroneSummary } from '../types';

type ChatDeletionState = {
  /** Chat node id -> deletions in flight, so every surface can show the chat going away. */
  deletingByNodeId: Record<string, number>;
  /**
   * Chat node id -> when it was deleted, for chats the drone summaries may still list.
   * Surfaces hide them meanwhile; the canvas would otherwise lay a still-listed chat out again.
   */
  deletedAtByNodeId: Record<string, number>;
};

export const useChatDeletionStore = create<ChatDeletionState>()(() => ({ deletingByNodeId: {}, deletedAtByNodeId: {} }));

/** Longest a deleted chat is hidden when no summary ever confirms it is gone. */
export const DELETED_CHAT_HIDE_MAX_MS = 60_000;

type ChatRef = { droneId: string; chatName: string };

export function markChatsDeleted(chats: ReadonlyArray<ChatRef>, now: number = Date.now()): void {
  const nodeIds = chats.map((chat) => createCanvasChatNodeId(chat.droneId, chat.chatName)).filter(Boolean);
  if (nodeIds.length === 0) return;
  useChatDeletionStore.setState((state) => ({
    deletedAtByNodeId: { ...state.deletedAtByNodeId, ...Object.fromEntries(nodeIds.map((nodeId) => [nodeId, now])) },
  }));
}

/** A deletion that failed after all: the chat shows again. */
export function unmarkChatsDeleted(chats: ReadonlyArray<ChatRef>): void {
  const nodeIds = new Set(chats.map((chat) => createCanvasChatNodeId(chat.droneId, chat.chatName)).filter(Boolean));
  useChatDeletionStore.setState((state) => {
    if (![...nodeIds].some((nodeId) => nodeId in state.deletedAtByNodeId)) return state;
    return { deletedAtByNodeId: Object.fromEntries(Object.entries(state.deletedAtByNodeId).filter(([nodeId]) => !nodeIds.has(nodeId))) };
  });
}

/** Forgets deleted chats the summaries no longer list (or whose drone is gone), and ones hidden too long. */
export function pruneDeletedChats(drones: readonly DroneSummary[], now: number = Date.now()): void {
  const listed = new Set<string>();
  for (const drone of drones) {
    for (const chatName of [...(drone.chats ?? []), ...(drone.workflowChats ?? []), ...(drone.sideChats ?? []).map((chat) => chat.name)]) {
      listed.add(createCanvasChatNodeId(drone.id, chatName));
    }
  }
  useChatDeletionStore.setState((state) => {
    const entries = Object.entries(state.deletedAtByNodeId);
    const kept = entries.filter(([nodeId, at]) => listed.has(nodeId) && now - at < DELETED_CHAT_HIDE_MAX_MS);
    return kept.length === entries.length ? state : { deletedAtByNodeId: Object.fromEntries(kept) };
  });
}

/** Like `pruneDeletedChats`, for one drone whose summary is at hand (a drone board). */
export function pruneDeletedChatsOfDrone(drone: Pick<DroneSummary, 'id' | 'chats' | 'workflowChats' | 'sideChats'>, now: number = Date.now()): void {
  const listed = new Set(
    [...(drone.chats ?? []), ...(drone.workflowChats ?? []), ...(drone.sideChats ?? []).map((chat) => chat.name)]
      .map((chatName) => createCanvasChatNodeId(drone.id, chatName)),
  );
  useChatDeletionStore.setState((state) => {
    const entries = Object.entries(state.deletedAtByNodeId);
    const kept = entries.filter(([nodeId, at]) =>
      parseCanvasChatNodeId(nodeId)?.droneId !== drone.id || (listed.has(nodeId) && now - at < DELETED_CHAT_HIDE_MAX_MS));
    return kept.length === entries.length ? state : { deletedAtByNodeId: Object.fromEntries(kept) };
  });
}

/** Marks chats as being deleted until the returned function is called for each of them. */
export function beginChatDeletion(chats: ReadonlyArray<{ droneId: string; chatName: string }>): (chat: { droneId: string; chatName: string }) => void {
  const nodeIds = chats.map((chat) => createCanvasChatNodeId(chat.droneId, chat.chatName)).filter(Boolean);
  if (nodeIds.length === 0) return () => {};
  useChatDeletionStore.setState((state) => {
    const deletingByNodeId = { ...state.deletingByNodeId };
    for (const nodeId of nodeIds) deletingByNodeId[nodeId] = (deletingByNodeId[nodeId] ?? 0) + 1;
    return { deletingByNodeId };
  });
  const pending = new Set(nodeIds);
  return (chat) => {
    const nodeId = createCanvasChatNodeId(chat.droneId, chat.chatName);
    if (!nodeId || !pending.delete(nodeId)) return;
    useChatDeletionStore.setState((state) => {
      const count = state.deletingByNodeId[nodeId] ?? 0;
      if (count <= 0) return state;
      const deletingByNodeId = { ...state.deletingByNodeId };
      if (count === 1) delete deletingByNodeId[nodeId];
      else deletingByNodeId[nodeId] = count - 1;
      return { deletingByNodeId };
    });
  };
}

export function useChatDeleting(droneId: string | null | undefined, chatName: string | null | undefined): boolean {
  const nodeId = droneId && chatName ? createCanvasChatNodeId(droneId, chatName) : '';
  return useChatDeletionStore((state) => Boolean(nodeId && state.deletingByNodeId[nodeId]));
}
