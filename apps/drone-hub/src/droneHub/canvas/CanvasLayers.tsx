import React from 'react';
import { canvasPerf } from './canvas-perf';
import type { ZoomGesture } from './zoom-gesture';
import { useShallow } from 'zustand/react/shallow';
import { selectCanvasBoard, useDroneCanvasStore } from './use-drone-canvas-store';
import { scaleCanvasRect, type CanvasRect } from './lineage-geometry';
import { buildCanvasRelationshipEdges } from './relationship-edges';
import { NODE_HEIGHT_PX } from './node-metrics';

/**
 * What the canvas draws, split by what each part follows so a gesture renders as little as possible:
 * the world follows pan and zoom, the cards layer and edges follow positions and the readability boost,
 * and the dock above them follows none of these. Keep it that way: a component that subscribes to positions
 * or zoom renders on every frame of a drag or zoom, and a CSS variable inherited by the world restyles
 * every element on the board each time it changes.
 */
const DOT_GRID_BASE_SPACING_PX = 32;
const DOT_GRID_RADIUS_PX = 1.05;
const DOT_GRID_MAX_OPACITY = 0.34;
// Zoomed out, the dots are as bright as node outlines and read as noise; they are gone by this scale.
const DOT_GRID_FADE_OUT_SCALE = 0.55;
// Nodes counter-scale so they never render smaller than this fraction of their natural size...
const NODE_LEGIBLE_SCALE = 0.85;
// ...up to this factor, which keeps sibling chat nodes on a drone board from touching.
const NODE_MAX_READABILITY_BOOST = 1.4;
// Arrowheads shrink with the zoom like the nodes used to, but never below a visible size.
const EDGE_MARKER_SCREEN_PX = 14;
const EDGE_PLUG_MARKER_SCREEN_PX = 10;
// Every chat has one of these lines, so they stay quieter than lineage and copy lines.
const CHAT_OWNER_EDGE_COLOR = 'color-mix(in srgb, var(--canvas-chat-owner-muted) 65%, transparent)';
const EDGE_MARKER_MIN_SCREEN_PX = 6;

export const NO_CARD_SPREAD = { x: 1, y: 1 } as const;
/** How long cards take to ease to the readability boost of a new zoom. */
const BOOST_SETTLE_MS = 160;

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

/** The zoom that cards' readability boost and edge arrowheads follow: the live zoom, or the one a zoom gesture froze. */
const CanvasBoostScaleContext = React.createContext(1);

export function CanvasWorldLayer({ boardDroneId, zoomGesture, children }: {
  boardDroneId: string | null;
  zoomGesture: ZoomGesture;
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
  const frozenScale = React.useSyncExternalStore(zoomGesture.subscribe, zoomGesture.frozenScale);
  const wasFrozenRef = React.useRef(false);
  React.useEffect(() => {
    if (wasFrozenRef.current && frozenScale === null) canvasPerf.window('zoom-settle', BOOST_SETTLE_MS + 120);
    wasFrozenRef.current = frozenScale !== null;
  }, [frozenScale]);
  const boostScale = frozenScale ?? scale;
  const dotVisibility = Math.max(0, Math.min(1, (scale - DOT_GRID_FADE_OUT_SCALE) / (1 - DOT_GRID_FADE_OUT_SCALE)));
  const dotOpacity = DOT_GRID_MAX_OPACITY * Math.pow(dotVisibility, 1.2);
  const boost = nodeReadabilityBoostAt(boostScale);
  const boostText = boost.toFixed(3);
  // Cards are scaled by their slots (CanvasCardsLayer). Labels and the rename field follow the boost by
  // rules on just those elements: a variable inherited by the whole world would restyle every element
  // under it, tens of milliseconds per zoom frame. Each rule has its own sheet, so a change to one
  // does not restyle what the others select.
  const worldId = React.useId();
  const scope = `[data-canvas-world-id="${worldId}"]`;
  return (
    <>
      <style>{`${scope} [data-canvas-label-boost]{scale:min(${boostText},var(--canvas-label-boost-limit));transition:scale ${BOOST_SETTLE_MS}ms ease-out}${scope} [data-canvas-rename-input]{--canvas-node-boost:${boostText}}`}</style>
      <style>{`${scope} [data-canvas-node]{--canvas-node-padding:${boost > 1 ? '0.5rem' : '0.625rem'}}`}</style>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            dotOpacity > 0
              ? `radial-gradient(circle, rgba(var(--canvas-dot-rgb), ${dotOpacity.toFixed(3)}) ${DOT_GRID_RADIUS_PX}px, transparent ${DOT_GRID_RADIUS_PX}px)`
              : 'none',
          backgroundSize: `${DOT_GRID_BASE_SPACING_PX * scale}px ${DOT_GRID_BASE_SPACING_PX * scale}px`,
          backgroundPosition: `${panX}px ${panY}px`,
        }}
      />
      <div
        data-canvas-world="1"
        data-canvas-world-id={worldId}
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
          transformOrigin: '0 0',
          // During a zoom gesture the GPU scales what is already drawn; the cards are drawn sharp once it ends.
          willChange: frozenScale === null ? undefined : 'transform',
        }}
      >
        <CanvasBoostScaleContext.Provider value={boostScale}>{children}</CanvasBoostScaleContext.Provider>
      </div>
    </>
  );
}

/** How much cards are scaled up at this zoom, rounded as the CSS variable that applies it is. */
export function nodeReadabilityBoostAt(scale: number): number {
  return Number(Math.min(NODE_MAX_READABILITY_BOOST, Math.max(1, NODE_LEGIBLE_SCALE / scale)).toFixed(3));
}

export type CanvasNodeSize = { width: number; height: number };
export type CardSpread = { readonly x: number; readonly y: number };

/** Where each card is drawn in world space before the zoom boost: its stored position, spread apart for detailed cards. */
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
export function CanvasCardsLayer({ boardKey, nodeIds, cardById, sizeById, cardSpread, movingNodeIds }: {
  boardKey: string | null;
  nodeIds: readonly string[];
  cardById: Readonly<Record<string, React.ReactElement>>;
  sizeById: Readonly<Record<string, CanvasNodeSize>>;
  cardSpread: CardSpread;
  /** Cards being dragged: each gets its own GPU layer, so moving them draws nothing again. */
  movingNodeIds: ReadonlySet<string>;
}) {
  const perfStart = canvasPerf.renderStart();
  React.useLayoutEffect(() => canvasPerf.renderEnd('cards', perfStart));
  const nodesById = useDroneCanvasStore((state) => selectCanvasBoard(state, boardKey).nodesByDroneId);
  // Zoomed out, cards are scaled up around their left middle to stay legible. The slots carry it:
  // a slot restyles in about a microsecond, a card with all its classes in tens.
  const boost = nodeReadabilityBoostAt(React.useContext(CanvasBoostScaleContext));
  // When the boost changes the cards ease to it on the GPU. The transition is only declared meanwhile:
  // on every slot all the time, it makes each drag frame's restyle several times slower.
  const settledBoostRef = React.useRef(boost);
  const [easing, setEasing] = React.useState(false);
  const boostChanged = settledBoostRef.current !== boost;
  React.useLayoutEffect(() => {
    if (settledBoostRef.current === boost) return;
    settledBoostRef.current = boost;
    setEasing(true);
    const timer = setTimeout(() => setEasing(false), BOOST_SETTLE_MS + 50);
    return () => clearTimeout(timer);
  }, [boost]);
  const transition = boostChanged || easing ? `scale ${BOOST_SETTLE_MS}ms ease-out` : undefined;
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
              // The individual properties compose as translate, then scale: `scale` beside a `transform`
              // would apply outside it and scale the card's position along with its size.
              translate: `${node.x * cardSpread.x}px ${node.y * cardSpread.y}px`,
              scale: String(boost),
              transformOrigin: `0 ${(sizeById[id]?.height ?? NODE_HEIGHT_PX) / 2}px`,
              transition,
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

/** Lines between related cards. Follows positions and zoom itself, so neither renders the dock. */
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
  // Arrowheads keep their size through a zoom gesture like the cards do, so nothing in the world is drawn again.
  const scale = React.useContext(CanvasBoostScaleContext);
  const boost = nodeReadabilityBoostAt(scale);
  const viewBoundsById = React.useMemo(
    () => viewBoundsOf(nodesById, nodeIds, sizeById, cardSpread),
    [cardSpread, nodeIds, nodesById, sizeById],
  );
  // Match the card's CSS scale and its left/vertical-center transform origin.
  const edges = React.useMemo(() => buildCanvasRelationshipEdges({
    preferredNodeByDroneId,
    droneNodeByDroneId,
    chatNodesByDroneId,
    renderedNodeBoundsById: Object.fromEntries(
      Object.entries(viewBoundsById).map(([id, rect]) => [id, scaleCanvasRect(rect, boost)]),
    ),
    fallbackNodeBoundsById: viewBoundsById,
    fleetParentIdByDroneId,
    fleetAssignedIdsByDroneId,
    forkSourceNodeIdByNodeId,
  }), [
    boost,
    chatNodesByDroneId,
    droneNodeByDroneId,
    fleetAssignedIdsByDroneId,
    fleetParentIdByDroneId,
    forkSourceNodeIdByNodeId,
    preferredNodeByDroneId,
    viewBoundsById,
  ]);
  // The same elements while only the zoom changes: the arrowheads below are all that follow it.
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
  const edgeMarkerWorldSize = (screenPx: number) =>
    Math.max(EDGE_MARKER_MIN_SCREEN_PX, Math.min(screenPx, screenPx * scale)) / scale;
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
          markerWidth={edgeMarkerWorldSize(EDGE_MARKER_SCREEN_PX)}
          markerHeight={edgeMarkerWorldSize(EDGE_MARKER_SCREEN_PX)}
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
          markerWidth={edgeMarkerWorldSize(EDGE_MARKER_SCREEN_PX)}
          markerHeight={edgeMarkerWorldSize(EDGE_MARKER_SCREEN_PX)}
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
          markerWidth={edgeMarkerWorldSize(EDGE_PLUG_MARKER_SCREEN_PX)}
          markerHeight={edgeMarkerWorldSize(EDGE_PLUG_MARKER_SCREEN_PX)}
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
