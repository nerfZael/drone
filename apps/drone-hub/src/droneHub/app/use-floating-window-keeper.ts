import React from 'react';
import type { DockviewApi, DockviewGroupPanel, FloatingGroupOptions } from 'dockview';
import {
  FLOATING_WINDOW_GESTURE_SELECTOR,
  FloatingWindowKeeper,
  fitFloatingBounds,
  isUsableFloatingBounds,
  sameFloatingBounds,
  type FloatingWindowSnapshot,
  type WorkspaceSize,
} from './floating-window-bounds';
import type { WorkspaceRect } from './side-chat-placement';
import { measureSideChatBounds } from './side-chat-workspace-state';

type FloatingWindowKeeperOptions = {
  apiRef: React.RefObject<DockviewApi | null>;
  rootRef: React.RefObject<HTMLElement | null>;
  /** Changes whenever the Dockview instance is (re)created, so the keeper re-subscribes. */
  ready: unknown;
  /** Remember a window's intended bounds across sessions. */
  persist?(id: string, bounds: WorkspaceRect): void;
  /** Intended bounds remembered from an earlier session. */
  restore?(id: string): WorkspaceRect | undefined;
  /** After the keeper moved a window back into place. */
  onMoved?(api: DockviewApi, id: string): void;
};

/** A chat window holds one panel, so the panel id names the window; anything else goes by group. */
export function floatingWindowId(group: DockviewGroupPanel): string {
  return group.panels.length === 1 ? group.panels[0]!.id : group.id;
}

function floatingGroups(api: DockviewApi): DockviewGroupPanel[] {
  return api.groups.filter((group) =>
    group.api.location.type === 'floating' && group.panels.length > 0 && Boolean(group.element.closest('.dv-resize-container')));
}

/**
 * Position a floating group by styling its frame, the way Dockview's own
 * overlay does. Re-adding the group would detach and re-attach its DOM, which
 * resets scroll positions inside the window (a transcript jumping away from
 * the bottom) and costs a full re-layout. Falls back to re-adding if the
 * frame is not where Dockview puts it.
 */
export function moveFloatingGroup(api: DockviewApi, group: DockviewGroupPanel, bounds: WorkspaceRect): void {
  const frame = group.element.closest<HTMLElement>('.dv-resize-container');
  if (frame && frame.parentElement) {
    frame.style.left = `${Math.round(bounds.x)}px`;
    frame.style.top = `${Math.round(bounds.y)}px`;
    frame.style.right = 'auto';
    frame.style.bottom = 'auto';
    frame.style.width = `${Math.round(bounds.width)}px`;
    frame.style.height = `${Math.round(bounds.height)}px`;
    return;
  }
  const options: FloatingGroupOptions & { skipActiveGroup?: boolean } = { ...bounds, skipActiveGroup: true };
  api.addFloatingGroup(group, options);
}

function workspaceSize(root: HTMLElement): WorkspaceSize {
  const rect = root.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function snapshots(api: DockviewApi, root: HTMLElement): FloatingWindowSnapshot[] {
  return floatingGroups(api).map((group) => ({ id: floatingWindowId(group), measured: measureSideChatBounds(group.element, root) }));
}

/**
 * Keeps a Dockview host's floating windows where the user put them when the
 * host resizes, and back there again when it grows. See FloatingWindowKeeper.
 */
export function useFloatingWindowKeeper({ apiRef, rootRef, ready, persist, restore, onMoved }: FloatingWindowKeeperOptions): FloatingWindowKeeper {
  const keeper = React.useRef<FloatingWindowKeeper | null>(null);
  if (!keeper.current) keeper.current = new FloatingWindowKeeper();
  const callbacks = React.useRef({ persist, restore, onMoved });
  callbacks.current = { persist, restore, onMoved };

  React.useEffect(() => {
    const api = apiRef.current;
    const root = rootRef.current;
    const windows = keeper.current!;
    if (!api || !root) return;
    // A new Dockview instance (another drone, a remount) starts from what it shows.
    windows.reset();
    let observeTimer: number | null = null;
    let resizeTimer: number | null = null;
    let gestureTimer: number | null = null;

    const observe = () => {
      observeTimer = null;
      if (!root.isConnected) return;
      const size = workspaceSize(root);
      if (size.width <= 0 || size.height <= 0) return;
      const current = snapshots(api, root);
      // A window seen for the first time may have bounds remembered from an
      // earlier session. Adopt those when the window sits where they land
      // (the layout was saved at this size, or clamped from it); otherwise
      // the window was placed somewhere new since, and that placement wins.
      for (const window of current) {
        if (windows.intent(window.id) || !isUsableFloatingBounds(window.measured)) continue;
        const saved = callbacks.current.restore?.(window.id);
        if (!isUsableFloatingBounds(saved)) continue;
        const intent = sameFloatingBounds(fitFloatingBounds(saved, size), window.measured) ? saved : window.measured;
        windows.set(window.id, intent);
        if (intent !== saved) callbacks.current.persist?.(window.id, intent);
      }
      for (const id of windows.observe(current, size)) {
        const intent = windows.intent(id);
        if (intent) callbacks.current.persist?.(id, intent);
      }
    };
    const apply = () => {
      resizeTimer = null;
      if (!root.isConnected) return;
      const size = workspaceSize(root);
      if (size.width <= 0 || size.height <= 0) return;
      for (const target of windows.targets(snapshots(api, root), size)) {
        const group = floatingGroups(api).find((candidate) => floatingWindowId(candidate) === target.id);
        if (!group || group.api.isMaximized()) continue;
        moveFloatingGroup(api, group, target.bounds);
        callbacks.current.onMoved?.(api, target.id);
      }
    };
    const scheduleObserve = () => {
      if (observeTimer !== null) window.clearTimeout(observeTimer);
      observeTimer = window.setTimeout(observe, 60);
    };
    const scheduleApply = () => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(apply, 120);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(FLOATING_WINDOW_GESTURE_SELECTOR)) return;
      if (gestureTimer !== null) window.clearTimeout(gestureTimer);
      gestureTimer = null;
      windows.markGesture();
    };
    const onPointerUp = () => {
      if (gestureTimer !== null) window.clearTimeout(gestureTimer);
      // Dockview reports the finished drag or resize shortly after the pointer lifts.
      gestureTimer = window.setTimeout(() => { gestureTimer = null; windows.clearGesture(); }, 400);
    };

    const layoutSubscription = api.onDidLayoutChange(scheduleObserve);
    root.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleApply);
    resizeObserver?.observe(root);
    observe();
    return () => {
      layoutSubscription.dispose();
      root.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      resizeObserver?.disconnect();
      if (observeTimer !== null) window.clearTimeout(observeTimer);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      if (gestureTimer !== null) window.clearTimeout(gestureTimer);
      windows.clearGesture();
    };
  }, [apiRef, rootRef, ready]);

  return keeper.current;
}
