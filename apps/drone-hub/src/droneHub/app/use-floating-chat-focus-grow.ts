import React from 'react';
import type { DockviewApi, DockviewGroupPanel } from 'dockview';
import { ACTIVE_SIDE_CHAT_EVENT, type ActiveSideChatEventDetail } from '../chat/composer-focus-routing';
import { FloatingWindowKeeper, sameFloatingBounds } from './floating-window-bounds';
import { collapseUnderPointer, planGrownBounds, type FocusGrowNeeds } from './floating-chat-focus-grow';
import type { WorkspaceRect } from './side-chat-placement';
import { measureSideChatBounds } from './side-chat-workspace-state';
import { floatingWindowId, moveFloatingGroup } from './use-floating-window-keeper';

type Grown = { id: string; name: string; before: WorkspaceRect; grown: WorkspaceRect };

/** Frame chrome the user grabs to move or resize; pressing there must not grow the window. */
const FRAME_CONTROL_SELECTOR = '.dv-tabs-and-actions-container, .dv-void-container, [class*="dv-resize-handle"]';

function floatingGroupForChat(api: DockviewApi, name: string): DockviewGroupPanel | undefined {
  return api.groups.find((group) =>
    group.api.location.type === 'floating'
    && Boolean(group.element.closest('.dv-resize-container'))
    && [...group.element.querySelectorAll<HTMLElement>('[data-side-chat-name]')].some((element) =>
      element.dataset.sideChatName === name && !element.closest('.dv-tabs-container')));
}

function frameOf(group: DockviewGroupPanel): HTMLElement | null {
  return group.element.closest<HTMLElement>('.dv-resize-container');
}

/**
 * What the focused window needs to read comfortably: wide enough for prose to
 * reach the reading measure, tall enough that the last agent block (the one
 * before it while a run is in progress) fits above the composer.
 */
function measureNeeds(frame: HTMLElement): FocusGrowNeeds | null {
  const scroll = frame.querySelector<HTMLElement>('[data-chat-transcript-scroll]');
  const inner = scroll?.firstElementChild as HTMLElement | null;
  if (!scroll || !inner) return null;
  const frameRect = frame.getBoundingClientRect();
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:var(--chat-prose-max)';
  inner.appendChild(probe);
  const measure = probe.offsetWidth;
  probe.remove();
  const width = measure + (frameRect.width - inner.clientWidth);

  const users = inner.querySelectorAll<HTMLElement>('.dh-chat-user-message');
  const working = Boolean(inner.querySelector('[data-chat-working="true"]'));
  const anchor = users[users.length - 1 - (working ? 1 : 0)] ?? null;
  const innerRect = inner.getBoundingClientRect();
  const scrollStyle = getComputedStyle(scroll);
  const blockTop = anchor ? anchor.getBoundingClientRect().bottom : innerRect.top;
  const block = innerRect.bottom - blockTop
    + parseFloat(scrollStyle.paddingBottom || '0') + parseFloat(scrollStyle.paddingTop || '0');
  const height = (frameRect.height - scroll.clientHeight) + block;
  return { width, height };
}

/**
 * Grows a small floating chat while it is focused so it reads cleanly, and
 * puts it back when focus leaves. Dragging a grown window collapses it first
 * (the drop is then a real placement); resizing it keeps what the user made.
 */
export function useFloatingChatFocusGrow({
  apiRef,
  rootRef,
  ready,
  keeper,
}: {
  apiRef: React.RefObject<DockviewApi | null>;
  rootRef: React.RefObject<HTMLElement | null>;
  ready: unknown;
  keeper: FloatingWindowKeeper;
}): void {
  React.useEffect(() => {
    const api = apiRef.current;
    const root = rootRef.current;
    if (!api || !root) return;
    let grown: Grown | null = null;
    let settleFrame: number | null = null;

    const workspaceSize = () => {
      const rect = root.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    };
    const restore = () => {
      if (!grown) return;
      const current = grown;
      grown = null;
      if (settleFrame !== null) { window.cancelAnimationFrame(settleFrame); settleFrame = null; }
      keeper.release(current.id);
      const group = floatingGroupForChat(api, current.name);
      const frame = group && frameOf(group);
      if (!group || !frame) return;
      // A window the user resized while grown keeps that size.
      if (!sameFloatingBounds(measureSideChatBounds(group.element, root), current.grown, 2)) return;
      moveFloatingGroup(api, group, current.before);
    };
    const scrollToEnd = (frame: HTMLElement) => {
      const scroll = frame.querySelector<HTMLElement>('[data-chat-transcript-scroll]');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    };
    const grow = (name: string) => {
      const group = floatingGroupForChat(api, name);
      const frame = group && frameOf(group);
      if (!group || !frame) return;
      const id = floatingWindowId(group);
      const before = measureSideChatBounds(group.element, root);
      const needs = measureNeeds(frame);
      if (!needs) return;
      const workspace = workspaceSize();
      const planned = planGrownBounds({ current: before, workspace, needs });
      if (!planned) return;
      grown = { id, name, before, grown: planned };
      keeper.hold(id, planned);
      moveFloatingGroup(api, group, planned);
      scrollToEnd(frame);
      // Prose reflows at the new width, so the height it needs can only be
      // known after a layout pass; settle it then.
      settleFrame = window.requestAnimationFrame(() => {
        settleFrame = null;
        if (!grown || grown.id !== id) return;
        const again = measureNeeds(frame);
        if (!again) return;
        const settled = planGrownBounds({
          current: { ...planned, height: before.height },
          workspace,
          needs: { width: planned.width, height: again.height },
        }) ?? { ...planned, height: before.height };
        if (settled.height === planned.height) return;
        grown = { ...grown, grown: settled };
        keeper.hold(id, settled);
        moveFloatingGroup(api, group, settled);
        scrollToEnd(frame);
      });
    };
    const onActiveChange = (event: Event) => {
      const detail = (event as CustomEvent<ActiveSideChatEventDetail>).detail;
      if (!detail) return;
      if (grown && grown.name !== detail.name) restore();
      if (!detail.name || grown?.name === detail.name) return;
      // Grabbing the title bar or an edge is a move or resize, not reading.
      if (detail.target.closest(FRAME_CONTROL_SELECTOR)) return;
      grow(detail.name);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!grown || event.button !== 0 || !(event.target instanceof Element)) return;
      if (!event.target.closest('.dv-void-container')) return;
      const group = floatingGroupForChat(api, grown.name);
      if (!group || group.element !== event.target.closest('.dv-groupview')) return;
      // Dragging collapses first; the drag then moves the small window and
      // the drop is where it lives from now on.
      const current = grown;
      grown = null;
      keeper.release(current.id);
      const rootRect = root.getBoundingClientRect();
      const collapsed = collapseUnderPointer({
        grown: measureSideChatBounds(group.element, root),
        small: { width: current.before.width, height: current.before.height },
        pointer: { x: event.clientX - rootRect.x, y: event.clientY - rootRect.y },
      });
      moveFloatingGroup(api, group, collapsed);
    };

    window.addEventListener(ACTIVE_SIDE_CHAT_EVENT, onActiveChange);
    root.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener(ACTIVE_SIDE_CHAT_EVENT, onActiveChange);
      root.removeEventListener('pointerdown', onPointerDown, true);
      if (settleFrame !== null) window.cancelAnimationFrame(settleFrame);
      if (grown) keeper.release(grown.id);
    };
  }, [apiRef, rootRef, ready, keeper]);
}
