import type { WorkspaceRect } from './side-chat-placement';
import type { WorkspaceSize } from './floating-window-bounds';

/** A focused floating chat may take up to this much of the workspace. */
export const FOCUS_GROW_WIDTH_RATIO = 0.55;
export const FOCUS_GROW_HEIGHT_RATIO = 0.7;

export type FocusGrowNeeds = {
  /** Frame width at which agent prose reaches the app's reading measure. */
  width: number;
  /** Frame height at which the last agent block fits above the composer. */
  height: number;
};

/**
 * Bounds for a floating chat that just gained focus, or null when it is
 * already at least that big. The window never shrinks here, grows only up to
 * the workspace caps (unless it was already larger), and grows toward the
 * workspace centre so a window parked in a corner stays on screen.
 */
export function planGrownBounds({
  current,
  workspace,
  needs,
}: {
  current: WorkspaceRect;
  workspace: WorkspaceSize;
  needs: FocusGrowNeeds;
}): WorkspaceRect | null {
  const capWidth = Math.max(current.width, Math.floor(workspace.width * FOCUS_GROW_WIDTH_RATIO));
  const capHeight = Math.max(current.height, Math.floor(workspace.height * FOCUS_GROW_HEIGHT_RATIO));
  const width = Math.round(Math.min(capWidth, Math.max(current.width, needs.width)));
  const height = Math.round(Math.min(capHeight, Math.max(current.height, needs.height)));
  if (width <= current.width + 1 && height <= current.height + 1) return null;
  const growLeft = current.x + current.width / 2 > workspace.width / 2;
  const growUp = current.y + current.height / 2 > workspace.height / 2;
  const x = growLeft ? current.x + current.width - width : current.x;
  const y = growUp ? current.y + current.height - height : current.y;
  return {
    x: Math.round(Math.max(0, Math.min(x, workspace.width - width))),
    y: Math.round(Math.max(0, Math.min(y, workspace.height - height))),
    width,
    height,
  };
}

/**
 * Where a grown window goes back to its small size when the user starts
 * dragging it: the pointer keeps its relative spot on the title bar, so the
 * drag continues without a jump, and the drop is a real placement.
 */
export function collapseUnderPointer({
  grown,
  small,
  pointer,
}: {
  grown: WorkspaceRect;
  small: { width: number; height: number };
  pointer: { x: number; y: number };
}): WorkspaceRect {
  const ratio = grown.width > 0 ? (pointer.x - grown.x) / grown.width : 0.5;
  const x = pointer.x - Math.max(0, Math.min(1, ratio)) * small.width;
  return { x: Math.round(x), y: Math.round(grown.y), width: small.width, height: small.height };
}
