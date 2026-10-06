import { getCanvasBoardActions, topicBoardKey, useDroneCanvasStore } from '../canvas/use-drone-canvas-store';
import { createCanvasChatNodeId } from './app-config';
import { useDesktopChatRequests } from './desktop-chat-requests';
import { useDetachedChatStore } from './detached-chat-store';
import { chatInputDraftKeyForDroneChat } from './helpers';
import { renameSideChatWorkspaceChat } from './side-chat-workspace-state';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

/** Every board that can show the chat keeps its card where it was. */
export function moveChatCanvasCards(droneId: string, oldName: string, newName: string): void {
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
}

/**
 * Moves what this client keeps under a chat's name to its new name: canvas cards,
 * windows, the unsent draft and the sidebar order. Each step does nothing once
 * moved, so a rename made here and then seen in the summaries moves things once.
 */
export function moveChatClientState(droneId: string, oldName: string, newName: string): void {
  if (!droneId || !oldName || !newName || oldName === newName) return;
  moveChatCanvasCards(droneId, oldName, newName);
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
  ui.setSidebarChatOrderByDrone((prev) => {
    const order = prev[droneId];
    if (!order?.includes(oldName)) return prev;
    return { ...prev, [droneId]: order.map((name) => (name === oldName ? newName : name)) };
  });
}
