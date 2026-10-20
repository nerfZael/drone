import { getCanvasBoardActions, topicBoardKey, useDroneCanvasStore } from '../canvas/use-drone-canvas-store';
import { renameChatInFolds } from '../canvas/organized-board-folds';
import { createCanvasChatNodeId } from './app-config';
import { useDesktopChatRequests } from './desktop-chat-requests';
import { useDetachedChatStore } from './detached-chat-store';
import { chatInputDraftKeyForDroneChat } from './helpers';
import { renameSideChatWorkspaceChat } from './side-chat-workspace-state';
import { renameChatInSidebarPlaces } from './sidebar-chat-rename';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import type { ChatRename } from './chat-identity';

/**
 * The chat keeps its place on every board: its card where it was, its folds, and
 * its place in the sidebar, which the organized board follows.
 */
export function moveChatBoardPlaces(droneId: string, oldName: string, newName: string): void {
  const oldNodeId = createCanvasChatNodeId(droneId, oldName);
  const newNodeId = createCanvasChatNodeId(droneId, newName);
  if (!oldNodeId || !newNodeId || oldNodeId === newNodeId) return;
  getCanvasBoardActions(null).replaceNodeId(oldNodeId, newNodeId, newName);
  getCanvasBoardActions(droneId).replaceNodeId(oldNodeId, newNodeId, newName);
  for (const topic of useDroneCanvasStore.getState().topics) {
    if (topic.droneIds.includes(droneId)) {
      getCanvasBoardActions(topicBoardKey(topic.id)).replaceNodeId(oldNodeId, newNodeId, newName);
    }
  }
  // A folded chat stays folded, and a card keeps what was folded into it.
  const canvas = useDroneCanvasStore.getState();
  const folds = canvas.chatFoldsByDrone[droneId];
  const renamedFolds = renameChatInFolds(folds, oldName, newName);
  if (renamedFolds && renamedFolds !== folds) canvas.setChatFolds(droneId, renamedFolds);
  // The sidebar keeps the chat's order, group and mute under its name.
  const ui = useDroneHubUiStore.getState();
  const places = renameChatInSidebarPlaces(ui, droneId, oldName, newName);
  if (places.sidebarChatOrderByDrone !== ui.sidebarChatOrderByDrone) ui.setSidebarChatOrderByDrone(places.sidebarChatOrderByDrone);
  if (places.sidebarChatGroupByChat !== ui.sidebarChatGroupByChat) ui.setSidebarChatGroupByChat(places.sidebarChatGroupByChat);
  if (places.sidebarChatNodeOrderByParent !== ui.sidebarChatNodeOrderByParent) ui.setSidebarChatNodeOrderByParent(places.sidebarChatNodeOrderByParent);
  if (places.mutedChatIds !== ui.mutedChatIds) ui.setMutedChatIds(places.mutedChatIds);
}

/**
 * Moves what this client keeps under a chat's name to its new name: its board
 * places, windows and the unsent draft. Each step does nothing once
 * moved, so a rename made here and then seen in the summaries moves things once.
 */
export function moveChatClientState(droneId: string, oldName: string, newName: string): void {
  if (!droneId || !oldName || !newName || oldName === newName) return;
  moveChatBoardPlaces(droneId, oldName, newName);
  useDetachedChatStore.getState().rename(droneId, oldName, newName);
  useDesktopChatRequests.getState().rename(droneId, oldName, newName);
  renameSideChatWorkspaceChat(droneId, oldName, newName);
  const ui = useDroneHubUiStore.getState();
  const oldDraftKey = chatInputDraftKeyForDroneChat(droneId, oldName);
  const newDraftKey = chatInputDraftKeyForDroneChat(droneId, newName);
  const draft = ui.chatInputDrafts[oldDraftKey];
  if (draft) {
    ui.setChatInputDraft(newDraftKey, draft);
    ui.setChatInputDraft(oldDraftKey, '');
  }
  if (ui.chatInputEditorModes[oldDraftKey]) {
    ui.setChatInputEditorMode(newDraftKey, true);
    ui.setChatInputEditorMode(oldDraftKey, false);
  }
  if (ui.selectedDrone === droneId && (String(ui.selectedChat ?? '').trim() || 'default') === oldName) {
    ui.setSelectedChat(newName);
  }
}

/**
 * Follows renames that happened together, such as two chats swapping names.
 * Each chat's state first moves to a name no chat can have (the hub refuses
 * control characters), then to its new name, so none lands on another's.
 */
export function moveRenamedChatsClientState(renames: readonly ChatRename[]): void {
  const parked = renames.map((rename, index) => ({ ...rename, parkedName: `\u0000renaming:${index}` }));
  for (const rename of parked) moveChatClientState(rename.droneId, rename.oldName, rename.parkedName);
  for (const rename of parked) moveChatClientState(rename.droneId, rename.parkedName, rename.newName);
}
