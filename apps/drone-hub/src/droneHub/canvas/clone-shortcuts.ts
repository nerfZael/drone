import { parseCanvasChatNodeId, parseCanvasDroneNodeId } from '../app/app-config';
import type { DroneSummary } from '../types';

const DRAFT_CANVAS_NODE_PREFIX = 'draft:';

export function collectCloneableDroneIdsFromCanvasSelection(selectedNodeIdsRaw: string[]): string[] {
  const selectedNodeIds = Array.isArray(selectedNodeIdsRaw) ? selectedNodeIdsRaw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of selectedNodeIds) {
    const nodeId = String(raw ?? '').trim();
    if (!nodeId || nodeId.startsWith(DRAFT_CANVAS_NODE_PREFIX)) continue;
    const droneId = String(parseCanvasDroneNodeId(nodeId) ?? '').trim();
    if (!droneId || seen.has(droneId)) continue;
    seen.add(droneId);
    out.push(droneId);
  }
  return out;
}

export async function cloneCanvasDronesById(
  copiedDroneIdsRaw: string[],
  droneById: Record<string, DroneSummary>,
  cloneDrone: (drone: DroneSummary) => Promise<boolean> | boolean,
): Promise<void> {
  const copiedDroneIds = Array.isArray(copiedDroneIdsRaw) ? copiedDroneIdsRaw : [];
  for (const raw of copiedDroneIds) {
    const droneId = String(raw ?? '').trim();
    if (!droneId) continue;
    const drone = droneById[droneId];
    if (!drone) continue;
    await cloneDrone(drone);
  }
}

export function collectCloneSourceNodeIdByDroneId(selectedNodeIdsRaw: string[]): Record<string, string> {
  const selectedNodeIds = Array.isArray(selectedNodeIdsRaw) ? selectedNodeIdsRaw : [];
  const out: Record<string, string> = {};
  for (const raw of selectedNodeIds) {
    const nodeId = String(raw ?? '').trim();
    if (!nodeId || nodeId.startsWith(DRAFT_CANVAS_NODE_PREFIX)) continue;
    const droneId = String(parseCanvasDroneNodeId(nodeId) ?? '').trim();
    if (!droneId || out[droneId]) continue;
    out[droneId] = nodeId;
  }
  return out;
}

type PasteRect = { x: number; y: number; width: number; height: number };

/**
 * Where each copied card's clone lands, keyed by the source card. The group
 * keeps its shape and is centred on `anchor` (the cursor, or the middle of the
 * view). An anchor on top of the sources would hide the clones behind them, so
 * that case falls back to a diagonal offset, as does a missing anchor.
 */
export function planCanvasPastePositions(args: {
  sourceNodeIds: string[];
  boundsById: Record<string, PasteRect | undefined>;
  anchor: { x: number; y: number } | null;
  fallbackOffset: { x: number; y: number };
}): Record<string, { x: number; y: number }> {
  const sources: Array<{ nodeId: string; rect: PasteRect }> = [];
  for (const raw of Array.isArray(args.sourceNodeIds) ? args.sourceNodeIds : []) {
    const nodeId = String(raw ?? '').trim();
    const rect = nodeId ? args.boundsById[nodeId] : undefined;
    if (rect && !sources.some((source) => source.nodeId === nodeId)) sources.push({ nodeId, rect });
  }
  if (sources.length === 0) return {};
  const left = Math.min(...sources.map(({ rect }) => rect.x));
  const top = Math.min(...sources.map(({ rect }) => rect.y));
  const right = Math.max(...sources.map(({ rect }) => rect.x + rect.width));
  const bottom = Math.max(...sources.map(({ rect }) => rect.y + rect.height));
  const anchor = args.anchor;
  const centred = anchor && !(anchor.x >= left && anchor.x <= right && anchor.y >= top && anchor.y <= bottom);
  const dx = centred ? anchor.x - (left + right) / 2 : args.fallbackOffset.x;
  const dy = centred ? anchor.y - (top + bottom) / 2 : args.fallbackOffset.y;
  const out: Record<string, { x: number; y: number }> = {};
  for (const { nodeId, rect } of sources) {
    out[nodeId] = { x: Math.round((rect.x + dx) * 10) / 10, y: Math.round((rect.y + dy) * 10) / 10 };
  }
  return out;
}

/** Runs `task` over `items` with at most `limit` in flight, so a group paste is fast without flooding the hub. */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

export type CanvasChatCloneSource = {
  nodeId: string;
  droneId: string;
  chatName: string;
};

export function collectCloneableChatsFromCanvasSelection(
  selectedNodeIdsRaw: string[],
): CanvasChatCloneSource[] {
  const out: CanvasChatCloneSource[] = [];
  for (const raw of Array.isArray(selectedNodeIdsRaw) ? selectedNodeIdsRaw : []) {
    const nodeId = String(raw ?? '').trim();
    const chatRef = parseCanvasChatNodeId(nodeId);
    if (!chatRef) continue;
    out.push({ nodeId, droneId: chatRef.droneId, chatName: chatRef.chatName });
  }
  return out;
}
