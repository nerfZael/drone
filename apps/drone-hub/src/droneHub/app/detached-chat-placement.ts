import { placeSideChat, type WorkspaceRect } from './side-chat-placement';
import { restoreSideChatBounds } from './side-chat-workspace-state';

export function placeDetachedChat(workspace: { width: number; height: number }, occupied: Array<WorkspaceRect & { floating?: boolean }>, count: number, saved?: WorkspaceRect): WorkspaceRect {
  // The docked workspace is the backdrop, not another floating window. Treating
  // it as occupied space forces cascading even when windows could fit beside it.
  const windows = occupied.filter((rect) => rect.floating !== false);
  if (!saved) return placeSideChat(workspace, windows, count);
  const restored = restoreSideChatBounds(saved, workspace);
  // Another window may have taken this spot while the chat was attached.
  // Account for the one-pixel frame inset in Dockview group measurements.
  const sameOrigin = windows.some((rect) => Math.abs(rect.x - restored.x) <= 1 && Math.abs(rect.y - restored.y) <= 1);
  return sameOrigin ? placeSideChat(workspace, windows, count, restored) : restored;
}
