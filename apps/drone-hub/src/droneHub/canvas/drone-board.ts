import { createCanvasChatNodeId, parseCanvasChatNodeId } from '../app/app-config';
import type { DroneSummary } from '../types';
import { CHAT_NODE_HEIGHT_PX, getNodeWidthPx } from './node-metrics';
import {
  getCanvasBoardActions,
  selectCanvasBoard,
  useDroneCanvasStore,
  type OptimisticBoardMember,
} from './use-drone-canvas-store';

const BRANCH_GAP_X_PX = 56;
const SLOT_GAP_Y_PX = 18;
const SLOT_COLLISION_MARGIN_PX = 12;
const MAX_SLOT_STEPS = 200;
// Long enough for a drone summary to arrive; short enough that a chat which
// never materialised does not linger as a ghost card.
export const OPTIMISTIC_MEMBER_TTL_MS = 60_000;

type Point = { x: number; y: number };
type PlacedNode = { droneId: string; label: string; x: number; y: number };

export type DroneBoardMember = {
  nodeId: string;
  chatName: string;
  /** The chat this one was cloned from, when the drone records it. */
  sourceNodeId: string | null;
};

/** A drone board always shows every chat of its drone; membership is never stored. */
export function buildDroneBoardMembers(
  drone: Pick<DroneSummary, 'id' | 'chats' | 'sideChats' | 'chatCloneSources'> | null | undefined,
  optimistic: OptimisticBoardMember[] = [],
  now: number = Date.now(),
): DroneBoardMember[] {
  const droneId = String(drone?.id ?? '').trim();
  if (!droneId) return [];
  const out: DroneBoardMember[] = [];
  const seen = new Set<string>();
  const add = (chatNameRaw: string, sourceChatNameRaw?: string) => {
    const chatName = String(chatNameRaw ?? '').trim();
    const nodeId = chatName ? createCanvasChatNodeId(droneId, chatName) : '';
    if (!nodeId || seen.has(nodeId)) return;
    seen.add(nodeId);
    const sourceChatName = String(sourceChatNameRaw ?? '').trim();
    out.push({
      nodeId,
      chatName,
      sourceNodeId: sourceChatName ? createCanvasChatNodeId(droneId, sourceChatName) || null : null,
    });
  };
  for (const chatName of drone?.chats ?? []) add(chatName, drone?.chatCloneSources?.[chatName]);
  for (const sideChat of drone?.sideChats ?? []) add(sideChat.name, sideChat.sourceChatName);
  for (const member of optimistic) {
    if (now - member.addedAt < OPTIMISTIC_MEMBER_TTL_MS) add(member.chatName, member.sourceChatName);
  }
  return out;
}

function collides(x: number, y: number, width: number, occupied: PlacedNode[]): boolean {
  const margin = SLOT_COLLISION_MARGIN_PX;
  return occupied.some((node) => {
    const nodeWidth = getNodeWidthPx(node.label);
    return (
      x - margin < node.x + nodeWidth &&
      x + width + margin > node.x &&
      y - margin < node.y + CHAT_NODE_HEIGHT_PX &&
      y + CHAT_NODE_HEIGHT_PX + margin > node.y
    );
  });
}

function firstFreeSlotBelow(anchor: Point, width: number, occupied: PlacedNode[]): Point {
  const stepY = CHAT_NODE_HEIGHT_PX + SLOT_GAP_Y_PX;
  for (let step = 0; step < MAX_SLOT_STEPS; step += 1) {
    const y = anchor.y + step * stepY;
    if (!collides(anchor.x, y, width, occupied)) return { x: anchor.x, y };
  }
  return anchor;
}

function branchAnchor(source: PlacedNode): Point {
  return { x: source.x + getNodeWidthPx(source.label) + BRANCH_GAP_X_PX, y: source.y };
}

/**
 * Positions for members that have none yet. A clone lands to the right of its
 * source; anything else takes the first free slot below `rootAnchor`.
 */
export function planDroneBoardPlacements(args: {
  members: DroneBoardMember[];
  nodesById: Record<string, { x: number; y: number } | undefined>;
  rootAnchor?: Point | null;
}): PlacedNode[] {
  const memberIds = new Set(args.members.map((member) => member.nodeId));
  const placedById = new Map<string, PlacedNode>();
  for (const member of args.members) {
    const node = args.nodesById[member.nodeId];
    if (node) placedById.set(member.nodeId, { droneId: member.nodeId, label: member.chatName, x: node.x, y: node.y });
  }
  const occupied = [...placedById.values()];
  const rootAnchor = args.rootAnchor ?? { x: 0, y: 0 };
  const planned: PlacedNode[] = [];
  let pending = args.members.filter((member) => !placedById.has(member.nodeId));

  while (pending.length > 0) {
    const waiting: DroneBoardMember[] = [];
    for (const member of pending) {
      const sourceId = member.sourceNodeId && memberIds.has(member.sourceNodeId) ? member.sourceNodeId : null;
      const source = sourceId ? placedById.get(sourceId) : null;
      if (sourceId && !source) {
        waiting.push(member);
        continue;
      }
      const width = getNodeWidthPx(member.chatName);
      const slot = firstFreeSlotBelow(source ? branchAnchor(source) : rootAnchor, width, occupied);
      const placed = { droneId: member.nodeId, label: member.chatName, x: slot.x, y: slot.y };
      placedById.set(member.nodeId, placed);
      occupied.push(placed);
      planned.push(placed);
    }
    // Sources that never resolve (a cycle) fall back to root placement.
    if (waiting.length === pending.length) {
      pending = waiting.map((member) => ({ ...member, sourceNodeId: null }));
    } else {
      pending = waiting;
    }
  }
  return planned;
}

/**
 * Registers a chat this client just cloned on its drone's board: it becomes a
 * member at once and lands at `position`, or beside its source. Returns the new
 * node id, or null when nothing was placed (the board lays it out when shown).
 */
export function placeClonedChatOnDroneBoard(
  droneIdRaw: string,
  sourceChatNameRaw: string,
  cloneChatNameRaw: string,
  opts?: { position?: Point | null; sideChat?: boolean },
): string | null {
  const droneId = String(droneIdRaw ?? '').trim();
  const sourceChatName = String(sourceChatNameRaw ?? '').trim();
  const sourceNodeId = createCanvasChatNodeId(droneId, sourceChatName);
  const cloneChatName = String(cloneChatNameRaw ?? '').trim();
  const cloneNodeId = createCanvasChatNodeId(droneId, cloneChatName);
  if (!droneId || !sourceNodeId || !cloneNodeId) return null;
  const addMember = () => useDroneCanvasStore.getState().addOptimisticBoardMember(droneId, {
    chatName: cloneChatName,
    sourceChatName,
    sideChat: opts?.sideChat === true,
    addedAt: Date.now(),
  });
  const board = selectCanvasBoard(useDroneCanvasStore.getState(), droneId);
  // An explicit paste position wins over a stored one: the name was just picked as unused,
  // so a stored card for it is left over from a deleted chat of the same name.
  let slot = opts?.position ?? null;
  if (!slot && !board.nodesByDroneId[cloneNodeId]) {
    const source = board.nodesByDroneId[sourceNodeId];
    if (source) {
      const occupied = Object.values(board.nodesByDroneId)
        .filter((node) => parseCanvasChatNodeId(node.droneId))
        .map((node) => ({ ...node, label: parseCanvasChatNodeId(node.droneId)?.chatName ?? node.label }));
      slot = firstFreeSlotBelow(branchAnchor({ ...source, label: sourceChatName }), getNodeWidthPx(cloneChatName), occupied);
    }
  }
  if (!slot) {
    addMember();
    return null;
  }
  // Position first: a new member without one would be laid out by the board before this lands.
  getCanvasBoardActions(droneId).upsertNodes([
    { droneId: cloneNodeId, label: cloneChatName, x: slot.x, y: slot.y },
  ]);
  addMember();
  return cloneNodeId;
}

/**
 * Undoes `placeClonedChatOnDroneBoard` for a clone that was never created. `previous` is the
 * card stored under that name before the placement (a chat this client did not know about yet
 * can own the name), which goes back where it was.
 */
export function removeClonedChatFromDroneBoard(
  droneIdRaw: string,
  cloneChatNameRaw: string,
  previous?: { x: number; y: number; label: string } | null,
): void {
  const droneId = String(droneIdRaw ?? '').trim();
  const cloneChatName = String(cloneChatNameRaw ?? '').trim();
  const cloneNodeId = createCanvasChatNodeId(droneId, cloneChatName);
  if (!droneId || !cloneNodeId) return;
  useDroneCanvasStore.getState().dropOptimisticBoardMembers(droneId, [cloneChatName]);
  const actions = getCanvasBoardActions(droneId);
  if (previous) actions.upsertNodes([{ droneId: cloneNodeId, label: previous.label, x: previous.x, y: previous.y }]);
  else actions.removeNodes([cloneNodeId]);
}

/**
 * Forgets the card stored for a chat name this client just picked as unused. Names are
 * reused ("Untitled 2" again after an empty draft was thrown away), and a card left from
 * the earlier chat would otherwise put the new one where the old one was, not where it
 * was asked for.
 */
export function forgetStaleChatCard(droneIdRaw: string, chatNameRaw: string): void {
  const droneId = String(droneIdRaw ?? '').trim();
  const nodeId = createCanvasChatNodeId(droneId, String(chatNameRaw ?? '').trim());
  if (!droneId || !nodeId) return;
  const actions = getCanvasBoardActions(droneId);
  if (selectCanvasBoard(useDroneCanvasStore.getState(), droneId).nodesByDroneId[nodeId]) actions.removeNodes([nodeId]);
}
