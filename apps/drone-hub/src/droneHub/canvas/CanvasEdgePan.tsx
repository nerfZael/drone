import React from 'react';
import { createPortal } from 'react-dom';
import { UiToolbarButton } from '../../ui/components';
import {
  MAX_CANVAS_EDGE_PAN_SPEED,
  MIN_CANVAS_EDGE_PAN_SPEED,
  useDroneHubUiStore,
} from '../app/use-drone-hub-ui-store';
import { CORNER_BAND_PX, EDGE_BAND_PX, NO_EDGE, type CanvasEdgePanLock, type EdgePanDirection } from './use-canvas-edge-pan-lock';


function IconEdgePan({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M8 1.5v13M1.5 8h13M8 1.5 6.2 3.3M8 1.5l1.8 1.8M8 14.5l-1.8-1.8M8 14.5l1.8-1.8M1.5 8l1.8-1.8M1.5 8l1.8 1.8M14.5 8l-1.8-1.8M14.5 8l-1.8 1.8" />
    </svg>
  );
}

function formatPanSpeed(speed: number): string {
  return speed >= 1000 ? `${(speed / 1000).toFixed(speed % 1000 === 0 ? 0 : 1)}k px/s` : `${speed} px/s`;
}

type ToolbarSliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Arrow keys move by this; Page Up and Down by five of it. */
  keyStep: number;
  format: (value: number) => string;
  onChange: (next: number) => void;
};

/** A compact slider. Not a range input: while the pointer is held the canvas dispatches mouse events itself,
 * and a native range does not move for those. */
function ToolbarSlider({ label, value, min, max, step, keyStep, format, onChange }: ToolbarSliderProps) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const fraction = (value - min) / (max - min);
  const commit = (next: number) => onChange(Math.min(max, Math.max(min, Math.round(next / step) * step)));
  const setFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    commit(min + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * (max - min));
  };
  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    setFromClientX(event.clientX);
    const view = event.currentTarget.ownerDocument.defaultView;
    if (!view) return;
    const move = (moveEvent: MouseEvent) => setFromClientX(moveEvent.clientX);
    const up = () => {
      view.removeEventListener('mousemove', move);
      view.removeEventListener('mouseup', up);
    };
    view.addEventListener('mousemove', move);
    view.addEventListener('mouseup', up);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const by = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 }[event.key];
    if (by !== undefined) commit(value + by * keyStep);
    else if (event.key === 'Home') commit(min);
    else if (event.key === 'End') commit(max);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div className="flex flex-shrink-0 items-center gap-1" title={`${label}: ${format(value)}`}>
      <span className="text-10 text-[var(--muted-dim)]">{label}</span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
        className="group relative h-5 w-[60px] cursor-pointer rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <span className="absolute inset-x-[5px] top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--border)]" />
        <span
          className="absolute left-[5px] top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--accent)]"
          style={{ width: `calc((100% - 10px) * ${fraction.toFixed(4)})` }}
        />
        <span
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--accent)] bg-[var(--panel-raised)] shadow-[0_1px_3px_var(--shadow-color)] transition-transform duration-100 group-hover:scale-110 group-active:scale-110"
          style={{ left: `calc(5px + (100% - 10px) * ${fraction.toFixed(4)})` }}
        />
      </div>
    </div>
  );
}

/** The toolbar's edge pan toggle and how fast it pans. */
export function CanvasEdgePanControls({ lock }: { lock: CanvasEdgePanLock }) {
  const panSpeed = useDroneHubUiStore((state) => state.canvasEdgePanSpeed);
  const setPanSpeed = useDroneHubUiStore((state) => state.setCanvasEdgePanSpeed);
  return (
    <div className="flex flex-shrink-0 items-center gap-1.5" role="group" aria-label="Edge pan">
      <UiToolbarButton size="xsmall"
        pressed={lock.locked}
        leadingIcon={<IconEdgePan className="h-3.5 w-3.5" />}
        onClick={(event) => (lock.locked ? lock.unlock() : lock.lock(event.clientX, event.clientY))}
        title={lock.locked
          ? 'Release the cursor (middle-click or Esc)'
          : 'Hold the cursor inside the canvas; push it against an edge to pan that way. Middle-click the canvas to toggle.'}
      >
        Edge pan
      </UiToolbarButton>
      <ToolbarSlider label="Pan speed" value={panSpeed} min={MIN_CANVAS_EDGE_PAN_SPEED} max={MAX_CANVAS_EDGE_PAN_SPEED}
        step={100} keyStep={250} format={formatPanSpeed} onChange={setPanSpeed} />
    </div>
  );
}


function EdgeCursor({ edge }: { edge: EdgePanDirection }) {
  const atEdge = edge !== NO_EDGE;
  const angle = Math.atan2(edge.y, edge.x) * (180 / Math.PI);
  return (
    <>
      <svg
        width="18"
        height="22"
        viewBox="0 0 18 22"
        className={`absolute left-0 top-0 transition-opacity duration-100 ${atEdge ? 'opacity-0' : 'opacity-100'}`}
        style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.55))' }}
        aria-hidden="true"
      >
        <path d="M1.5 1.5v16.2l4.3-4.1 2.9 6.6 2.7-1.2-2.9-6.5h6.1z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      {/* At an edge the cursor becomes an arrow pointing the way the board moves, set in from the edge so it stays whole. */}
      <span
        data-canvas-edge-pan-arrow={atEdge ? `${edge.x},${edge.y}` : undefined}
        className={`absolute left-0 top-0 transition-opacity duration-100 ${atEdge ? 'opacity-100' : 'opacity-0'}`}
        style={{ transform: `translate(${-edge.x * 15 - 14}px, ${-edge.y * 15 - 14}px)` }}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--accent)_70%,white)] bg-[color-mix(in_srgb,var(--accent)_82%,black)] shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
          style={{ transform: `rotate(${angle}deg)` }}>
          <svg viewBox="0 0 16 16" className="h-4 w-4 text-white motion-safe:animate-[dh-edge-pan-nudge_0.7s_ease-in-out_infinite]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
          </svg>
        </span>
      </span>
    </>
  );
}

/** An arrow in a disc pointing the way the board moves, as a system cursor, with its tip on the pointer. */
function edgeCursor(dx: -1 | 0 | 1, dy: -1 | 0 | 1, fallback: string): string {
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
    `<g transform="rotate(${angle} 14 14)"><circle cx="14" cy="14" r="11" fill="#2c2f63" stroke="#c9cbff" stroke-width="1.5"/>` +
    `<path d="M8.5 14h10M15 10l4 4-4 4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
  // The hotspot sits toward the edge, so the arrow is drawn inside the canvas rather than past its edge.
  const length = Math.hypot(dx, dy);
  const hotX = Math.round(14 + (dx / length) * 11);
  const hotY = Math.round(14 + (dy / length) * 11);
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX} ${hotY}, ${fallback}`;
}

const BAND = EDGE_BAND_PX + 1;
const CORNER = CORNER_BAND_PX + 1;
type EdgeZone = { dx: -1 | 0 | 1; dy: -1 | 0 | 1; fallback: string; style: React.CSSProperties };
const CORNER_FALLBACK: Record<string, string> = { '-1,-1': 'nw-resize', '1,-1': 'ne-resize', '-1,1': 'sw-resize', '1,1': 'se-resize' };
/** Each corner reaches along both of its edges, as the panning does. */
const corner = (dx: -1 | 1, dy: -1 | 1): EdgeZone[] => {
  const horizontal = dx < 0 ? { left: 0 } : { right: 0 };
  const vertical = dy < 0 ? { top: 0 } : { bottom: 0 };
  const fallback = CORNER_FALLBACK[`${dx},${dy}`];
  return [
    { dx, dy, fallback, style: { ...horizontal, ...vertical, width: BAND, height: CORNER } },
    { dx, dy, fallback, style: { ...horizontal, ...vertical, width: CORNER, height: BAND } },
  ];
};
const EDGE_ZONES: EdgeZone[] = ([
  { dx: 0, dy: -1, fallback: 'n-resize', style: { top: 0, left: CORNER, right: CORNER, height: BAND } },
  { dx: 0, dy: 1, fallback: 's-resize', style: { bottom: 0, left: CORNER, right: CORNER, height: BAND } },
  { dx: -1, dy: 0, fallback: 'w-resize', style: { left: 0, top: CORNER, bottom: CORNER, width: BAND } },
  { dx: 1, dy: 0, fallback: 'e-resize', style: { right: 0, top: CORNER, bottom: CORNER, width: BAND } },
  ...corner(-1, -1),
  ...corner(1, -1),
  ...corner(-1, 1),
  ...corner(1, 1),
] as EdgeZone[]).map((zone) => ({ ...zone, style: { ...zone.style, cursor: edgeCursor(zone.dx, zone.dy, zone.fallback) } }));

const FORWARDED_ZONE_EVENTS = ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel'] as const;

/**
 * While the real cursor is held, the bands along the edges where it pans. They only set the cursor: anything done
 * there (a click, the wheel) is passed to what lies beneath them.
 */
function EdgeZones() {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const host = ref.current;
    const view = host?.ownerDocument.defaultView;
    if (!host || !view) return;
    const forward = (event: Event) => {
      const mouse = event as MouseEvent;
      if (mouse.button === 1) return;
      const beneath = host.ownerDocument.elementsFromPoint(mouse.clientX, mouse.clientY)
        .find((element) => !host.contains(element));
      if (!beneath) return;
      event.stopPropagation();
      if (event.type === 'contextmenu' || event.type === 'wheel') event.preventDefault();
      const init = { bubbles: true, cancelable: true, composed: true, view, clientX: mouse.clientX, clientY: mouse.clientY,
        screenX: mouse.screenX, screenY: mouse.screenY, button: mouse.button, buttons: mouse.buttons, detail: mouse.detail,
        ctrlKey: mouse.ctrlKey, shiftKey: mouse.shiftKey, altKey: mouse.altKey, metaKey: mouse.metaKey };
      const copy = event.type === 'wheel'
        ? new view.WheelEvent('wheel', { ...init, deltaX: (event as WheelEvent).deltaX, deltaY: (event as WheelEvent).deltaY, deltaMode: (event as WheelEvent).deltaMode })
        : new view.MouseEvent(event.type, init);
      beneath.dispatchEvent(copy);
    };
    for (const type of FORWARDED_ZONE_EVENTS) host.addEventListener(type, forward, { passive: false });
    return () => {
      for (const type of FORWARDED_ZONE_EVENTS) host.removeEventListener(type, forward);
    };
  }, []);
  return (
    <div ref={ref} aria-hidden="true" data-canvas-edge-pan-zones="" className="pointer-events-none absolute inset-0 z-50">
      {EDGE_ZONES.map((zone) => (
        <span key={`${zone.dx},${zone.dy},${zone.style.width}`} className="pointer-events-auto absolute" style={zone.style}
          data-canvas-edge-pan-zone={`${zone.dx},${zone.dy}`} />
      ))}
    </div>
  );
}

/**
 * What the lock shows. Holding the real cursor: bands along the edges that turn it into an arrow pointing the way
 * the board moves. Drawing one: the cursor itself, on the page rather than in the panel so it can follow into menus
 * that open outside it, rendered always (hidden while unlocked) so the lock can place it the moment it starts.
 */
export function CanvasEdgePanOverlay({ lock }: { lock: CanvasEdgePanLock }) {
  const anchorRef = React.useRef<HTMLSpanElement | null>(null);
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  React.useLayoutEffect(() => setHost(anchorRef.current?.ownerDocument.body ?? null), []);
  return (
    <>
      <span ref={anchorRef} hidden />
      {lock.mode === 'real' ? <EdgeZones /> : null}
      {host ? createPortal(
        <div
          ref={lock.cursorRef}
          aria-hidden="true"
          data-canvas-edge-pan-cursor=""
          className="pointer-events-none fixed left-0 top-0 z-[2147483647]"
          style={{ display: lock.mode === 'drawn' ? undefined : 'none' }}
        >
          <EdgeCursor edge={lock.edge} />
        </div>,
        host,
      ) : null}
    </>
  );
}
