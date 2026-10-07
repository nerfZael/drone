import React from 'react';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { canvasPerf } from './canvas-perf';
import type { DroneCanvasBoard } from './use-drone-canvas-store';

/**
 * RTS-style edge panning. Middle-click holds the cursor inside the canvas panel (its toolbar included); pushing
 * it against an edge or a corner pans that way, at a constant speed. Middle-click or Escape releases it.
 *
 * In the desktop app on X11 the real cursor is held, by walls the app puts around the panel: it keeps the
 * user's own speed and acceleration and every event is the browser's own. Where that cannot be done (a plain
 * browser, Wayland, macOS, Windows), the Pointer Lock API hides the cursor and reports movement only, and the
 * canvas draws its own: every mouse event then arrives at the panel at a frozen position, and is swallowed and
 * dispatched again at the drawn cursor, to whatever is under it. Either way, menus and dialogs a control opens
 * outside the panel can be reached.
 */

export type EdgePanDirection = { readonly x: -1 | 0 | 1; readonly y: -1 | 0 | 1 };

export const NO_EDGE: EdgePanDirection = Object.freeze({ x: 0, y: 0 });
const LOCK_ATTRIBUTE = 'data-canvas-edge-pan-lock';
/** How close to an edge the cursor must be to pan. It stops at the edge, so pushing keeps it there. */
export const EDGE_BAND_PX = 4;
/**
 * Against one edge, how close to a corner counts as the corner. Pushed diagonally, the walls that hold the real
 * cursor can stop it a few pixels short of the corner, and it should still pan both ways.
 */
export const CORNER_BAND_PX = 16;
/** Panels a control opens outside the canvas (menus, pickers) that the cursor may enter. */
const POPUP_SELECTOR = '[role="menu"], [role="listbox"], [role="dialog"]';
const MAX_FRAME_MS = 50;
/** Chromium sometimes reports a locked mouse jumping hundreds of pixels at once; no hand moves that far in one event. */
const MAX_MOVEMENT_PX = 400;
/** A second middle-click this soon after the one that held the cursor is a double middle-click. */
export const DOUBLE_MIDDLE_CLICK_MS = 500;

/** The events the lock dispatches itself, at its cursor; every other mouse event while locked is the real mouse. */
const dispatchedByLock = new WeakSet<Event>();

const SWALLOWED_EVENTS = [
  'mousemove', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu',
  'pointermove', 'pointerdown', 'pointerup', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
  'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
] as const;

/** A real mouse event while the canvas holds the pointer: the lock dispatches its own copy at the drawn cursor. */
export function isEdgePanLockedEvent(event: Event): boolean {
  if (dispatchedByLock.has(event)) return false;
  const doc = event.target instanceof Node ? event.target.ownerDocument ?? (event.target as Document) : document;
  return Boolean(doc?.pointerLockElement?.hasAttribute(LOCK_ATTRIBUTE));
}

type Rect = { left: number; top: number; right: number; bottom: number };

function toRect(rect: DOMRect): Rect {
  return { left: rect.left, top: rect.top, right: rect.right - 1, bottom: rect.bottom - 1 };
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function commonAncestor(a: Element | null, b: Element): Element {
  if (!a) return b;
  for (let node: Element | null = a; node; node = node.parentElement) {
    if (node.contains(b)) return node;
  }
  return b;
}

/** Clicking a field focuses it, which an event the page dispatches itself does not do. */
function focusField(target: Element) {
  const field = target.closest<HTMLElement>('input, textarea, select, [contenteditable="true"]');
  field?.focus({ preventScroll: true });
}

/** How the cursor is held: the real one, walled in by the desktop app, or one the canvas draws. */
export type EdgePanMode = 'real' | 'drawn';

type DesktopCursorBridge = {
  confineCursor(rect: { x: number; y: number; width: number; height: number }): Promise<{ ok: boolean; unsupported?: boolean }>;
  releaseCursor(): Promise<boolean>;
  onCursorConfineEnded(callback: () => void): () => void;
};

function desktopCursorBridge(view: Window): DesktopCursorBridge | null {
  const bridge = (view as Window & { droneHubDesktop?: Partial<DesktopCursorBridge> }).droneHubDesktop;
  return bridge?.confineCursor && bridge.releaseCursor && bridge.onCursorConfineEnded ? (bridge as DesktopCursorBridge) : null;
}

/** The menus and dialogs on the page now: those already open when the hold starts belong to something else. */
function openPopups(region: HTMLElement): Set<Element> {
  return new Set(region.ownerDocument.querySelectorAll(POPUP_SELECTOR));
}

/**
 * The panel and any menu or dialog opened outside it during the hold: where the cursor may go. A picker left open
 * in a chat pane beside the canvas does not count, or the walls would grow to take that pane in too.
 */
function reachableRects(region: HTMLElement, ignored: ReadonlySet<Element>): Rect[] {
  const popups = Array.from(region.ownerDocument.querySelectorAll(POPUP_SELECTOR))
    .filter((popup) => !ignored.has(popup) && !region.contains(popup))
    .map((popup) => toRect(popup.getBoundingClientRect()))
    .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
  return [toRect(region.getBoundingClientRect()), ...popups];
}

/** The smallest rectangle around all of them: walls can only make a box. */
function boundingBox(rects: Rect[]): { x: number; y: number; width: number; height: number } {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right)) + 1;
  const bottom = Math.max(...rects.map((rect) => rect.bottom)) + 1;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function side(value: number, low: number, high: number, band: number): -1 | 0 | 1 {
  return value <= low + band ? -1 : value >= high - band ? 1 : 0;
}

/** Which edges of the panel a point is pushing against. */
function edgeAt(region: HTMLElement, x: number, y: number): EdgePanDirection {
  const rect = toRect(region.getBoundingClientRect());
  if (!contains(rect, x, y)) return NO_EDGE;
  let horizontal = side(x, rect.left, rect.right, EDGE_BAND_PX);
  let vertical = side(y, rect.top, rect.bottom, EDGE_BAND_PX);
  if (horizontal && !vertical) vertical = side(y, rect.top, rect.bottom, CORNER_BAND_PX);
  else if (vertical && !horizontal) horizontal = side(x, rect.left, rect.right, CORNER_BAND_PX);
  return horizontal || vertical ? { x: horizontal, y: vertical } : NO_EDGE;
}

/**
 * Pans while the cursor pushes an edge: full speed from the first frame, the same straight or diagonal, as in an
 * RTS. While a button is held, `follow` runs after each step, so a card drag or a selection box under the still
 * cursor keeps up with the board moving under it.
 */
function startEdgePanLoop(view: Window, read: () => { edge: EdgePanDirection; buttons: number },
  pan: (dx: number, dy: number) => void, follow: () => void, onFrame: () => void = () => {}) {
  let lastFrame = view.performance.now();
  let frame = 0;
  let panning = false;
  const tick = (now: number) => {
    frame = view.requestAnimationFrame(tick);
    const dt = Math.min(MAX_FRAME_MS, now - lastFrame) / 1000;
    lastFrame = now;
    onFrame();
    const { edge, buttons } = read();
    // A right-drag pans by hand; the edge does not fight it.
    const active = edge !== NO_EDGE && (buttons & 2) === 0;
    if (active !== panning) {
      panning = active;
      if (active) canvasPerf.gestureStart('edge-pan');
      else canvasPerf.gestureEnd('edge-pan');
    }
    if (!active) return;
    const length = Math.hypot(edge.x, edge.y);
    const speed = useDroneHubUiStore.getState().canvasEdgePanSpeed;
    pan((edge.x / length) * speed * dt, (edge.y / length) * speed * dt);
    if (buttons & 1) follow();
  };
  frame = view.requestAnimationFrame(tick);
  return () => {
    view.cancelAnimationFrame(frame);
    if (panning) canvasPerf.gestureEnd('edge-pan');
  };
}

export type CanvasEdgePanLock = {
  locked: boolean;
  mode: EdgePanMode | null;
  /** The edges being pushed, for the overlay. */
  edge: EdgePanDirection;
  /** The drawn cursor; the lock moves it directly, without rendering. */
  cursorRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Holds the cursor, starting at this point. Call from a real click: browsers lock only in response to one. */
  lock: (clientX: number, clientY: number) => void;
  unlock: () => void;
};

export function useCanvasEdgePanLock({ regionRef, getView, setPan, onDoubleMiddleClick }: {
  /** The element the cursor is held inside: the canvas panel. */
  regionRef: React.RefObject<HTMLElement | null>;
  getView: () => DroneCanvasBoard;
  setPan: (panX: number, panY: number) => void;
  /**
   * A double middle-click. The first click holds the cursor and the second, which arrives while it is held,
   * releases it as usual, then this runs.
   */
  onDoubleMiddleClick?: () => void;
}): CanvasEdgePanLock {
  const [mode, setMode] = React.useState<EdgePanMode | null>(null);
  const [edge, setEdge] = React.useState<EdgePanDirection>(NO_EDGE);
  const cursorRef = React.useRef<HTMLDivElement | null>(null);
  const viewRef = React.useRef({ getView, setPan });
  viewRef.current = { getView, setPan };
  /** Set while the cursor is held; ends the hold. */
  const sessionRef = React.useRef<{ mode: EdgePanMode; end: () => void } | null>(null);
  const startingRef = React.useRef(false);
  /** When the cursor was last held; a release by middle-click soon after is the second click of a double. */
  const lockedAtRef = React.useRef(-Infinity);
  /** Set by a second middle-click that lands while the desktop app is still putting up the walls. */
  const abortStartRef = React.useRef(false);
  const onDoubleRef = React.useRef(onDoubleMiddleClick);
  onDoubleRef.current = onDoubleMiddleClick;
  /** After a release by middle-click: a double middle-click when it came soon after the hold. */
  const middleReleased = React.useCallback(() => {
    if (performance.now() - lockedAtRef.current > DOUBLE_MIDDLE_CLICK_MS) return;
    lockedAtRef.current = -Infinity;
    onDoubleRef.current?.();
  }, []);

  const unlock = React.useCallback(() => {
    sessionRef.current?.end();
  }, []);

  const lock = React.useCallback((clientX: number, clientY: number) => {
    const region = regionRef.current;
    const view = region?.ownerDocument.defaultView;
    if (!region || !view || sessionRef.current) return;
    if (startingRef.current) {
      // The second click of a double, before the walls are up: they come down as soon as they are.
      abortStartRef.current = true;
      middleReleased();
      return;
    }
    lockedAtRef.current = performance.now();
    const doc = region.ownerDocument;
    const pan = (dx: number, dy: number) => {
      const { panX, panY } = viewRef.current.getView();
      viewRef.current.setPan(panX - dx, panY - dy);
    };

    /** The real cursor, walled in by the desktop app; the canvas only watches where it is. */
    const startReal = (bridge: DesktopCursorBridge, ignoredPopups: ReadonlySet<Element>) => {
      let x = clientX;
      let y = clientY;
      let buttons = 0;
      let current: EdgePanDirection = NO_EDGE;
      let walls = '';
      let wallsDirty = false;
      let ended = false;
      const updateEdge = () => {
        const next = edgeAt(region, x, y);
        if (next.x === current.x && next.y === current.y) return;
        current = next;
        setEdge(next);
      };
      const onMove = (event: MouseEvent) => {
        x = event.clientX;
        y = event.clientY;
        buttons = event.buttons;
        updateEdge();
      };
      const onDown = (event: MouseEvent) => {
        buttons = event.buttons;
        if (event.button !== 1) return;
        // Middle-click releases, and does nothing else: no paste into a field under the cursor.
        event.preventDefault();
        event.stopImmediatePropagation();
        end();
        middleReleased();
      };
      const swallowMiddle = (event: MouseEvent) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        end();
      };
      const onHidden = () => {
        if (doc.visibilityState === 'hidden') end();
      };
      const rewall = () => {
        const box = boundingBox(reachableRects(region, ignoredPopups));
        const key = `${box.x},${box.y},${box.width},${box.height}`;
        if (key === walls) return;
        walls = key;
        void bridge.confineCursor(box).then((result) => {
          if (!result.ok && !ended) end();
        });
      };
      // A menu opening outside the panel, or the panel resizing, widens or moves the walls. Other changes to the
      // page (a streaming reply) are left alone: measuring for them would lay out the page every frame.
      const isPopup = (node: Node) => node instanceof view.Element && (node.matches(POPUP_SELECTOR) || Boolean(node.querySelector(POPUP_SELECTOR)));
      const mutations = new view.MutationObserver((records) => {
        if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some(isPopup))) wallsDirty = true;
      });
      mutations.observe(doc.body, { childList: true, subtree: true });
      const resizes = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(() => { wallsDirty = true; }) : null;
      resizes?.observe(region);
      const stopLoop = startEdgePanLoop(view, () => ({ edge: current, buttons }), pan, () => {
        const target = doc.elementFromPoint(x, y) ?? region;
        target.dispatchEvent(new view.MouseEvent('mousemove', {
          bubbles: true, cancelable: true, composed: true, view, clientX: x, clientY: y, buttons,
        }));
      }, () => {
        if (!wallsDirty) return;
        wallsDirty = false;
        rewall();
      });
      const stopEnded = bridge.onCursorConfineEnded(() => end());
      view.addEventListener('pointermove', onMove, true);
      view.addEventListener('mousemove', onMove, true);
      view.addEventListener('mousedown', onDown, true);
      view.addEventListener('mouseup', swallowMiddle, true);
      view.addEventListener('auxclick', swallowMiddle, true);
      view.addEventListener('keydown', onKey, true);
      view.addEventListener('blur', end);
      doc.addEventListener('visibilitychange', onHidden);
      region.setAttribute(LOCK_ATTRIBUTE, 'real');
      function end() {
        if (ended) return;
        ended = true;
        if (sessionRef.current?.end === end) sessionRef.current = null;
        stopLoop();
        stopEnded();
        mutations.disconnect();
        resizes?.disconnect();
        view!.removeEventListener('pointermove', onMove, true);
        view!.removeEventListener('mousemove', onMove, true);
        view!.removeEventListener('mousedown', onDown, true);
        view!.removeEventListener('mouseup', swallowMiddle, true);
        view!.removeEventListener('auxclick', swallowMiddle, true);
        view!.removeEventListener('keydown', onKey, true);
        view!.removeEventListener('blur', end);
        doc.removeEventListener('visibilitychange', onHidden);
        region!.removeAttribute(LOCK_ATTRIBUTE);
        void bridge.releaseCursor();
        setEdge(NO_EDGE);
        setMode(null);
      }
      walls = (() => { const box = boundingBox(reachableRects(region, ignoredPopups)); return `${box.x},${box.y},${box.width},${box.height}`; })();
      updateEdge();
      sessionRef.current = { mode: 'real', end };
      setMode('real');
    };

    /** The pointer locked and hidden; the canvas draws a cursor and dispatches every event at it. */
    const startDrawn = () => {
      region.setAttribute(LOCK_ATTRIBUTE, 'drawn');
      let started = false;
      const onLockChange = () => {
        if (doc.pointerLockElement === region && !started) {
          started = true;
          const endDrawn = runDrawn(region, view, { x: clientX, y: clientY }, cursorRef, setEdge, pan, () => {
            doc.exitPointerLock();
            middleReleased();
          });
          const end = () => {
            if (sessionRef.current?.end !== end) return;
            sessionRef.current = null;
            cleanup();
            endDrawn();
            region.removeAttribute(LOCK_ATTRIBUTE);
            setEdge(NO_EDGE);
            setMode(null);
            if (doc.pointerLockElement === region) doc.exitPointerLock();
          };
          sessionRef.current = { mode: 'drawn', end };
          setMode('drawn');
        } else if (doc.pointerLockElement !== region) {
          if (started) sessionRef.current?.end();
          else fail();
        }
      };
      const cleanup = () => {
        doc.removeEventListener('pointerlockchange', onLockChange);
        doc.removeEventListener('pointerlockerror', fail);
      };
      function fail() {
        cleanup();
        region!.removeAttribute(LOCK_ATTRIBUTE);
      }
      doc.addEventListener('pointerlockchange', onLockChange);
      doc.addEventListener('pointerlockerror', fail);
      try {
        const request = region.requestPointerLock() as unknown as Promise<void> | undefined;
        request?.catch?.(fail);
      } catch {
        fail();
      }
    };

    const bridge = desktopCursorBridge(view);
    if (!bridge) {
      startDrawn();
      return;
    }
    startingRef.current = true;
    abortStartRef.current = false;
    const ignoredPopups = openPopups(region);
    void bridge.confineCursor(boundingBox(reachableRects(region, ignoredPopups))).then((result) => {
      startingRef.current = false;
      // The canvas closed while the app answered, or a second middle-click already released it.
      if (!region.isConnected || abortStartRef.current) {
        if (result.ok) void bridge.releaseCursor();
        return;
      }
      if (result.ok) startReal(bridge, ignoredPopups);
      // Where the app cannot hold the real cursor, the drawn one; the click still counts as the user's request.
      else startDrawn();
    }, () => {
      startingRef.current = false;
      if (!abortStartRef.current) startDrawn();
    });
  }, [middleReleased, regionRef]);

  // Leaving the canvas releases the cursor.
  React.useEffect(() => () => sessionRef.current?.end(), []);

  return { locked: mode !== null, mode, edge, cursorRef, lock, unlock };
}

/** The drawn cursor's session: swallows the locked mouse and dispatches each event again at the drawn cursor. */
function runDrawn(
  region: HTMLElement,
  view: Window & typeof globalThis,
  origin: { x: number; y: number },
  cursorRef: React.MutableRefObject<HTMLDivElement | null>,
  setEdge: (edge: EdgePanDirection) => void,
  pan: (dx: number, dy: number) => void,
  release: () => void,
): () => void {
  const doc = region.ownerDocument;
  let x = origin.x;
  let y = origin.y;
  let buttons = 0;
  let modifiers = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
  let hovered: Element | null = null;
  const downTargets = new Map<number, Element>();
  let currentEdge: EdgePanDirection = NO_EDGE;
  let popupRects: Rect[] | null = null;

  const ignoredPopups = openPopups(region);
  const allowedRects = () => (popupRects ??= reachableRects(region, ignoredPopups));

  const placeCursor = () => {
    const cursor = cursorRef.current;
    if (cursor) cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const updateEdge = () => {
    const next = edgeAt(region, x, y);
    if (next.x === currentEdge.x && next.y === currentEdge.y) return;
    currentEdge = next;
    setEdge(next);
  };

  /** Moves the drawn cursor, keeping it in the panel or a popup the panel opened. */
  const moveBy = (dx: number, dy: number) => {
    const nextX = x + dx;
    const nextY = y + dy;
    const rects = allowedRects();
    if (rects.some((rect) => contains(rect, nextX, nextY))) {
      x = nextX;
      y = nextY;
    } else {
      const home = rects.find((rect) => contains(rect, x, y)) ?? rects[0];
      x = Math.min(home.right, Math.max(home.left, nextX));
      y = Math.min(home.bottom, Math.max(home.top, nextY));
    }
    placeCursor();
    updateEdge();
  };

  const targetAtCursor = (): Element => doc.elementFromPoint(x, y) ?? region;
  const mouseInit = (source: MouseEvent | null, extra: MouseEventInit = {}): MouseEventInit => ({
    bubbles: true,
    cancelable: true,
    composed: true,
    view,
    clientX: x,
    clientY: y,
    screenX: source?.screenX ?? 0,
    screenY: source?.screenY ?? 0,
    button: source?.button ?? 0,
    buttons,
    detail: source?.detail ?? 0,
    movementX: source?.movementX ?? 0,
    movementY: source?.movementY ?? 0,
    ...modifiers,
    ...extra,
  });
  const pointerInit = (source: MouseEvent | null, extra: PointerEventInit = {}): PointerEventInit => ({
    ...mouseInit(source),
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    width: 1,
    height: 1,
    pressure: buttons ? 0.5 : 0,
    ...extra,
  });
  const dispatch = (target: Element, event: Event) => {
    dispatchedByLock.add(event);
    target.dispatchEvent(event);
  };
  const dispatchMouse = (target: Element, type: string, init: MouseEventInit) => {
    dispatch(target, new view.MouseEvent(type, init));
  };
  const dispatchPointer = (target: Element, type: string, init: PointerEventInit) => {
    if (typeof view.PointerEvent === 'function') dispatch(target, new view.PointerEvent(type, init));
  };

  /** Moves hover to what is under the cursor; React's enter and leave come from these. */
  const hover = (target: Element, source: MouseEvent | null) => {
    if (target === hovered) return;
    const previous = hovered;
    hovered = target;
    if (previous?.isConnected) {
      dispatchPointer(previous, 'pointerout', pointerInit(source, { relatedTarget: target }));
      dispatchMouse(previous, 'mouseout', mouseInit(source, { relatedTarget: target }));
    }
    dispatchPointer(target, 'pointerover', pointerInit(source, { relatedTarget: previous }));
    dispatchMouse(target, 'mouseover', mouseInit(source, { relatedTarget: previous }));
  };

  const moveAtCursor = (source: MouseEvent | null) => {
    const target = targetAtCursor();
    hover(target, source);
    dispatchPointer(target, 'pointermove', pointerInit(source));
    dispatchMouse(target, 'mousemove', mouseInit(source));
  };

  const takeState = (event: MouseEvent) => {
    buttons = event.buttons;
    modifiers = { ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey };
  };

  const onEvent = (event: Event) => {
    if (dispatchedByLock.has(event)) return;
    event.stopImmediatePropagation();
    if (!(event instanceof view.MouseEvent)) return;
    const mouse = event as MouseEvent;
    takeState(mouse);
    switch (event.type) {
      case 'pointermove': {
        // Movement comes from the pointer events: when several arrive within a frame, Chromium merges them,
        // and their own movements are summed here so a fast hand loses none of its distance.
        const samples = (mouse as PointerEvent).getCoalescedEvents?.() ?? [];
        let dx = 0;
        let dy = 0;
        for (const sample of samples.length ? samples : [mouse]) {
          if (Math.abs(sample.movementX) > MAX_MOVEMENT_PX || Math.abs(sample.movementY) > MAX_MOVEMENT_PX) continue;
          dx += sample.movementX;
          dy += sample.movementY;
        }
        moveBy(dx, dy);
        moveAtCursor(mouse);
        return;
      }
      case 'mousedown': {
        event.preventDefault();
        if (mouse.button === 1) {
          release();
          return;
        }
        const target = targetAtCursor();
        downTargets.set(mouse.button, target);
        focusField(target);
        dispatchPointer(target, 'pointerdown', pointerInit(mouse));
        dispatchMouse(target, 'mousedown', mouseInit(mouse));
        return;
      }
      case 'mouseup': {
        if (mouse.button === 1) return;
        const target = targetAtCursor();
        dispatchPointer(target, 'pointerup', pointerInit(mouse));
        dispatchMouse(target, 'mouseup', mouseInit(mouse));
        return;
      }
      case 'click':
      case 'dblclick': {
        if (mouse.button !== 0) return;
        // As a browser does: on the nearest element that both the press and the release were over.
        const target = commonAncestor(downTargets.get(0) ?? null, targetAtCursor());
        dispatchMouse(target, event.type, mouseInit(mouse));
        return;
      }
      case 'contextmenu':
        event.preventDefault();
        return;
      default:
        // The mouse events that follow each pointer move, and enter/leave at the frozen position: the copies
        // dispatched above stand for them.
        return;
    }
  };

  const onWheel = (event: WheelEvent) => {
    if (dispatchedByLock.has(event)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    takeState(event);
    dispatch(targetAtCursor(), new view.WheelEvent('wheel', {
      ...mouseInit(event),
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
    }));
  };

  for (const type of SWALLOWED_EVENTS) view.addEventListener(type, onEvent, true);
  view.addEventListener('wheel', onWheel, { capture: true, passive: false });
  placeCursor();
  updateEdge();
  moveAtCursor(null);
  const stopLoop = startEdgePanLoop(view, () => ({ edge: currentEdge, buttons }), pan, () => moveAtCursor(null), () => {
    popupRects = null;
  });

  return () => {
    for (const type of SWALLOWED_EVENTS) view.removeEventListener(type, onEvent, true);
    view.removeEventListener('wheel', onWheel, true);
    stopLoop();
    if (hovered?.isConnected) dispatchMouse(hovered, 'mouseout', mouseInit(null, { relatedTarget: null }));
  };
}
