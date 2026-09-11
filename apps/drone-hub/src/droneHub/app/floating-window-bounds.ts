import type { WorkspaceRect } from './side-chat-placement';
import { restoreSideChatBounds } from './side-chat-workspace-state';

export type WorkspaceSize = { width: number; height: number };

export type FloatingWindowSnapshot = { id: string; measured: WorkspaceRect };

/** Where a window with these intended bounds lands in a workspace of this size. */
export function fitFloatingBounds(intended: WorkspaceRect, workspace: WorkspaceSize): WorkspaceRect {
  return restoreSideChatBounds(intended, workspace);
}

/** Smaller than this is not a window the user sized; it is a frame measured before layout. */
export const MIN_FLOATING_WINDOW_SIZE = 40;

export function isUsableFloatingBounds(bounds: WorkspaceRect | null | undefined): bounds is WorkspaceRect {
  return Boolean(bounds)
    && [bounds!.x, bounds!.y, bounds!.width, bounds!.height].every(Number.isFinite)
    && bounds!.width >= MIN_FLOATING_WINDOW_SIZE && bounds!.height >= MIN_FLOATING_WINDOW_SIZE;
}

export function sameFloatingBounds(a: WorkspaceRect, b: WorkspaceRect, tolerance = 1.5): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance
    && Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance;
}

/**
 * Remembers where the user put each floating window, independently of where
 * the workspace currently forces it to be.
 *
 * Dockview clamps floating groups into the container on every resize and
 * keeps only the clamped position, so shrinking the app window and growing it
 * back scrambles a carefully arranged set of chats. The keeper holds the
 * intended bounds, learns new ones only from the user's own drags and resizes,
 * and hands back the bounds each window should have in the current workspace.
 */
export class FloatingWindowKeeper {
  private readonly intents = new Map<string, WorkspaceRect>();
  /** Windows placed by the app for the moment (a focus grow); not the user's intent. */
  private readonly holds = new Map<string, WorkspaceRect>();
  private gesture = false;

  /** A pointer went down on a floating window: the next layout change may be the user's. */
  markGesture(): void {
    this.gesture = true;
  }

  clearGesture(): void {
    this.gesture = false;
  }

  intent(id: string): WorkspaceRect | undefined {
    return this.intents.get(id);
  }

  ids(): string[] {
    return [...this.intents.keys()];
  }

  set(id: string, bounds: WorkspaceRect): void {
    if (!isUsableFloatingBounds(bounds)) return;
    this.intents.set(id, { ...bounds });
  }

  forget(id: string): void {
    this.intents.delete(id);
  }

  reset(): void {
    this.intents.clear();
    this.holds.clear();
    this.gesture = false;
  }

  /** The app moved this window; keep it there, and do not mistake it for a placement. */
  hold(id: string, bounds: WorkspaceRect): void {
    this.holds.set(id, { ...bounds });
  }

  release(id: string): void {
    this.holds.delete(id);
  }

  held(id: string): WorkspaceRect | undefined {
    return this.holds.get(id);
  }

  /**
   * Learn from the current layout. Windows seen for the first time adopt
   * their measured bounds. Known windows change intent only when the user
   * touched them and they are somewhere other than where their intent lands
   * in this workspace; a resize clamp is not the user's decision. Returns the
   * ids whose intent changed.
   */
  observe(windows: FloatingWindowSnapshot[], workspace: WorkspaceSize): string[] {
    const changed: string[] = [];
    const seen = new Set<string>();
    for (const window of windows) {
      seen.add(window.id);
      // A frame measured before it has a size (a hidden host, a workspace not
      // laid out yet) says nothing about where the user wants the window.
      if (!isUsableFloatingBounds(window.measured)) continue;
      const held = this.holds.get(window.id);
      if (held) {
        if (sameFloatingBounds(held, window.measured) || !this.gesture) continue;
        // The user resized or moved a held window: that is a placement, and the hold is over.
        this.holds.delete(window.id);
        this.intents.set(window.id, { ...window.measured });
        changed.push(window.id);
        continue;
      }
      const intent = this.intents.get(window.id);
      if (!intent) {
        this.intents.set(window.id, { ...window.measured });
        changed.push(window.id);
        continue;
      }
      if (!this.gesture) continue;
      if (sameFloatingBounds(fitFloatingBounds(intent, workspace), window.measured)) continue;
      this.intents.set(window.id, { ...window.measured });
      changed.push(window.id);
    }
    for (const id of this.intents.keys()) if (!seen.has(id)) this.intents.delete(id);
    for (const id of this.holds.keys()) if (!seen.has(id)) this.holds.delete(id);
    return changed;
  }

  /** Windows that are not where their intent lands in this workspace, with the bounds to give them. */
  targets(windows: FloatingWindowSnapshot[], workspace: WorkspaceSize): Array<{ id: string; bounds: WorkspaceRect }> {
    const targets: Array<{ id: string; bounds: WorkspaceRect }> = [];
    for (const window of windows) {
      if (this.holds.has(window.id)) continue;
      const intent = this.intents.get(window.id);
      if (!intent) continue;
      const bounds = fitFloatingBounds(intent, workspace);
      if (sameFloatingBounds(bounds, window.measured)) continue;
      targets.push({ id: window.id, bounds });
    }
    return targets;
  }
}

/** Dockview selectors for the parts of a floating frame the user grabs to move or resize it. */
export const FLOATING_WINDOW_GESTURE_SELECTOR = '.dv-resize-container';
