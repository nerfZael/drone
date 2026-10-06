import React from 'react';
import { canvasPerf } from './canvas-perf';
import { useShallow } from 'zustand/react/shallow';
import { selectCanvasBoard, useDroneCanvasStore } from './use-drone-canvas-store';
import type { CanvasRect } from './lineage-geometry';
import { buildCanvasRelationshipEdges } from './relationship-edges';

/**
 * What the canvas draws, split by what each part follows so a gesture renders as little as possible:
 * the world follows pan and zoom, the cards layer and edges follow positions, and the dock above them
 * follows none of these. Keep it that way: a component that subscribes to positions or zoom renders on
 * every frame of a drag or zoom, and a CSS variable inherited by the world restyles every element on the
 * board each time it changes.
 *
 * A zoom scales the whole board, cards, text and arrowheads alike, and nothing else: no part resizes
 * itself to the zoom, so a zoom never ends in anything settling or sharpening.
 */
const DOT_GRID_BASE_SPACING_PX = 32;
const DOT_GRID_RADIUS_PX = 1.05;
const DOT_GRID_MAX_OPACITY = 0.34;
// Zoomed out, the dots are as bright as node outlines and read as noise; they are gone by this scale.
const DOT_GRID_FADE_OUT_SCALE = 0.55;
// Arrowheads, in board pixels: they scale with the zoom like the cards they point at.
const EDGE_MARKER_PX = 14;
const EDGE_PLUG_MARKER_PX = 10;
// Every chat has one of these lines, so they stay quieter than lineage and copy lines.
const CHAT_OWNER_EDGE_COLOR = 'color-mix(in srgb, var(--canvas-chat-owner-muted) 65%, transparent)';

export const NO_CARD_SPREAD = { x: 1, y: 1 } as const;

/**
 * Marks a pan or marquee in progress, which shows a shield over the cards (see styles.css): content moving
 * under the pointer then hit-tests one element instead of every card, and no card's hover restyles.
 * A shield rather than `pointer-events: none` on the world, which is inherited and so would restyle every
 * element in it twice per gesture.
 */
export function setCanvasGesture(viewport: HTMLElement | null, active: boolean) {
  if (!viewport) return;
  if (active) viewport.setAttribute('data-canvas-gesture', '');
  else viewport.removeAttribute('data-canvas-gesture');
}

/**
 * A pan offset on whole device pixels. The pan layer is drawn once and moved by the GPU; moved by a fraction of a
 * pixel it would be resampled, and every card's text and edges would blur.
 */
function snapToDevicePixels(value: number): number {
  const ratio = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  return Math.round(value * ratio) / ratio;
}

function positiveRemainder(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function CanvasWorldLayer({ boardDroneId, children }: {
  boardDroneId: string | null;
  children: React.ReactNode;
}) {
  const perfStart = canvasPerf.renderStart();
  React.useLayoutEffect(() => canvasPerf.renderEnd('world', perfStart));
  const { panX, panY, scale } = useDroneCanvasStore(
    useShallow((state) => {
      const board = selectCanvasBoard(state, boardDroneId);
      return { panX: board.panX, panY: board.panY, scale: board.scale };
    }),
  );
  const dotVisibility = Math.max(0, Math.min(1, (scale - DOT_GRID_FADE_OUT_SCALE) / (1 - DOT_GRID_FADE_OUT_SCALE)));
  const dotOpacity = DOT_GRID_MAX_OPACITY * Math.pow(dotVisibility, 1.2);
  const dotSpacing = DOT_GRID_BASE_SPACING_PX * scale;
  return (
    <>
      {/* The grid is a tile larger by one spacing, slid by the pan's remainder: panning moves it rather than
          drawing it again, and only a zoom changes what it draws. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" data-canvas-dot-grid="">
        <div
          className="absolute"
          style={{
            left: -dotSpacing,
            top: -dotSpacing,
            width: `calc(100% + ${dotSpacing * 2}px)`,
            height: `calc(100% + ${dotSpacing * 2}px)`,
            backgroundImage:
              dotOpacity > 0
                ? `radial-gradient(circle, rgba(var(--canvas-dot-rgb), ${dotOpacity.toFixed(3)}) ${DOT_GRID_RADIUS_PX}px, transparent ${DOT_GRID_RADIUS_PX}px)`
                : 'none',
            backgroundSize: `${dotSpacing}px ${dotSpacing}px`,
            transform: `translate3d(${snapToDevicePixels(positiveRemainder(panX, dotSpacing))}px, ${snapToDevicePixels(positiveRemainder(panY, dotSpacing))}px, 0)`,
            willChange: 'transform',
          }}
        />
      </div>
      {/* Panning moves the outer element, zooming scales the world inside it. Neither is a GPU layer of its own:
          one would be drawn at one size and stretched by the next zoom, blurring every card until Chrome drew it
          again, and after a long zoom it does not. Drawn as part of the page, the board is sharp at every zoom;
          keeping card shadows short is what keeps that cheap enough for every frame. */}
      <div
        data-canvas-pan=""
        className="absolute left-0 top-0"
        style={{ transform: `translate(${snapToDevicePixels(panX)}px, ${snapToDevicePixels(panY)}px)` }}
      >
        <div
          data-canvas-world="1"
          className="absolute left-0 top-0"
          style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}
        >
          {children}
        </div>
      </div>
    </>
  );
}

export type CanvasNodeSize = { width: number; height: number };
export type CardSpread = { readonly x: number; readonly y: number };

/** Where each card is drawn in world space: its stored position, spread apart for detailed cards. */
export function viewBoundsOf(
  nodesById: Readonly<Record<string, { x: number; y: number }>>,
  nodeIds: readonly string[],
  sizeById: Readonly<Record<string, CanvasNodeSize>>,
  spread: CardSpread,
): Record<string, CanvasRect> {
  const out: Record<string, CanvasRect> = {};
  for (const id of nodeIds) {
    const node = nodesById[id];
    const size = sizeById[id];
    if (!node || !size) continue;
    out[id] = { x: node.x * spread.x, y: node.y * spread.y, width: size.width, height: size.height };
  }
  return out;
}

/**
 * Positions each card in a slot. Only this layer follows positions, so a drag frame re-renders
 * these slots while the cards themselves, built once by the dock, are reused as they are.
 */
export function CanvasCardsLayer({ boardKey, nodeIds, cardById, cardSpread, movingNodeIds }: {
  boardKey: string | null;
  nodeIds: readonly string[];
  cardById: Readonly<Record<string, React.ReactElement>>;
  cardSpread: CardSpread;
  /** Cards being dragged: each gets its own GPU layer, so moving them draws nothing again. */
  movingNodeIds: ReadonlySet<string>;
}) {
  const perfStart = canvasPerf.renderStart();
  React.useLayoutEffect(() => canvasPerf.renderEnd('cards', perfStart));
  const nodesById = useDroneCanvasStore((state) => selectCanvasBoard(state, boardKey).nodesByDroneId);
  return (
    <>
      {nodeIds.map((id) => {
        const node = nodesById[id];
        if (!node) return null;
        return (
          <div
            key={id}
            data-canvas-node-slot=""
            className="absolute left-0 top-0"
            style={{
              translate: `${node.x * cardSpread.x}px ${node.y * cardSpread.y}px`,
              willChange: movingNodeIds.has(id) ? 'translate' : undefined,
            }}
          >
            {cardById[id]}
          </div>
        );
      })}
    </>
  );
}

type CanvasEdgesLayerProps = {
  boardKey: string | null;
  nodeIds: readonly string[];
  sizeById: Readonly<Record<string, CanvasNodeSize>>;
  cardSpread: CardSpread;
  preferredNodeByDroneId: Record<string, { droneId: string }>;
  droneNodeByDroneId: Record<string, { droneId: string }>;
  chatNodesByDroneId: Record<string, Array<{ droneId: string }>>;
  fleetParentIdByDroneId: Record<string, string>;
  fleetAssignedIdsByDroneId: Record<string, string[]>;
  forkSourceNodeIdByNodeId: Record<string, string>;
};

/** Lines between related cards. Follows positions itself, so moving cards does not render the dock. */
export function CanvasEdgesLayer({
  boardKey,
  nodeIds,
  sizeById,
  cardSpread,
  preferredNodeByDroneId,
  droneNodeByDroneId,
  chatNodesByDroneId,
  fleetParentIdByDroneId,
  fleetAssignedIdsByDroneId,
  forkSourceNodeIdByNodeId,
}: CanvasEdgesLayerProps) {
  const perfStart = canvasPerf.renderStart();
  React.useLayoutEffect(() => canvasPerf.renderEnd('edges', perfStart));
  const lineageMarkerId = React.useId();
  const assignedMarkerId = React.useId();
  const chatOwnerMarkerId = React.useId();
  const nodesById = useDroneCanvasStore((state) => selectCanvasBoard(state, boardKey).nodesByDroneId);
  const viewBoundsById = React.useMemo(
    () => viewBoundsOf(nodesById, nodeIds, sizeById, cardSpread),
    [cardSpread, nodeIds, nodesById, sizeById],
  );
  const edges = React.useMemo(() => buildCanvasRelationshipEdges({
    preferredNodeByDroneId,
    droneNodeByDroneId,
    chatNodesByDroneId,
    renderedNodeBoundsById: viewBoundsById,
    fallbackNodeBoundsById: viewBoundsById,
    fleetParentIdByDroneId,
    fleetAssignedIdsByDroneId,
    forkSourceNodeIdByNodeId,
  }), [
    chatNodesByDroneId,
    droneNodeByDroneId,
    fleetAssignedIdsByDroneId,
    fleetParentIdByDroneId,
    forkSourceNodeIdByNodeId,
    preferredNodeByDroneId,
    viewBoundsById,
  ]);
  const paths = React.useMemo(() => edges.map((edge) => (
    <path
      key={edge.key}
      d={edge.path}
      fill="none"
      stroke={
        edge.variant === 'chat-owner'
          ? CHAT_OWNER_EDGE_COLOR
          : edge.variant === 'assigned'
            ? 'var(--canvas-assigned-muted)'
            : 'var(--canvas-related-muted)'
      }
      strokeWidth={edge.variant === 'chat-owner' ? '2' : edge.variant === 'assigned' ? '1.5' : '1.8'}
      vectorEffect="non-scaling-stroke"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={
        edge.variant === 'chat-owner'
          ? '2 5'
          : edge.variant === 'assigned'
            ? '7 5'
            : edge.variant === 'chat-fork'
              ? '4 4'
              : undefined
      }
      markerEnd={`url(#${
        edge.variant === 'chat-owner'
          ? chatOwnerMarkerId
          : edge.variant === 'assigned'
            ? assignedMarkerId
            : lineageMarkerId
      })`}
    />
  )), [assignedMarkerId, chatOwnerMarkerId, edges, lineageMarkerId]);
  if (edges.length === 0) return null;
  return (
    <svg
      width="1"
      height="1"
      className="absolute left-0 top-0 pointer-events-none overflow-visible"
      style={{ overflow: 'visible' }}
      aria-hidden="true"
    >
      <defs>
        <marker
          id={lineageMarkerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth={EDGE_MARKER_PX}
          markerHeight={EDGE_MARKER_PX}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--canvas-related)" />
        </marker>
        <marker
          id={assignedMarkerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth={EDGE_MARKER_PX}
          markerHeight={EDGE_MARKER_PX}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--canvas-assigned)" />
        </marker>
        <marker
          id={chatOwnerMarkerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth={EDGE_PLUG_MARKER_PX}
          markerHeight={EDGE_PLUG_MARKER_PX}
          orient="auto"
        >
          <path d="M 1 5 H 9 M 9 2.5 V 7.5" fill="none" stroke={CHAT_OWNER_EDGE_COLOR} strokeWidth="1.6" strokeLinecap="round" />
        </marker>
      </defs>
      {paths}
    </svg>
  );
}

export function CanvasZoomLabel({ boardKey }: { boardKey: string | null }) {
  const scale = useDroneCanvasStore((state) => selectCanvasBoard(state, boardKey).scale);
  return (
    <span className="w-[48px] text-right text-10 font-mono text-[var(--muted-dim)]" title="Current zoom">
      {Math.round(scale * 100)}%
    </span>
  );
}
