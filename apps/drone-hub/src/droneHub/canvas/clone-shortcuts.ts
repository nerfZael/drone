import { parseCanvasChatNodeId } from '../app/app-config';
import type { DroneSummary } from '../types';

const DRAFT_CANVAS_NODE_PREFIX = 'draft:';

export function collectCloneableDroneIdsFromCanvasSelection(selectedNodeIdsRaw: string[]): string[] {
  const selectedNodeIds = Array.isArray(selectedNodeIdsRaw) ? selectedNodeIdsRaw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of selectedNodeIds) {
    const nodeId = String(raw ?? '').trim();
    if (!nodeId || nodeId.startsWith(DRAFT_CANVAS_NODE_PREFIX)) continue;
    const chatRef = parseCanvasChatNodeId(nodeId);
    if (!chatRef) continue;
    const droneId = String(chatRef.droneId ?? '').trim();
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
