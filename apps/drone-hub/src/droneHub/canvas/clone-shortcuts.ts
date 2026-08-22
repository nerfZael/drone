import {
  createCanvasChatNodeId,
  createCanvasDroneNodeId,
  parseCanvasChatNodeId,
  parseCanvasDroneNodeId,
} from '../app/app-config';
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

export function buildOptimisticCloneCanvasNodes(args: {
  copiedDroneIdsRaw: string[];
  cloneResultsRaw: Array<{ sourceDroneId: string; cloneDroneId?: string | null; cloneDroneName?: string | null }>;
  sourceNodeIdByDroneId: Record<string, string>;
  nodesById: Record<string, { x: number; y: number } | undefined>;
  cloneOffsetXPx: number;
  cloneOffsetYPx: number;
}): {
  nodes: Array<{ droneId: string; label: string; x: number; y: number }>;
  optimisticDroneNameById: Record<string, string>;
} {
  const copiedDroneIds = Array.isArray(args.copiedDroneIdsRaw) ? args.copiedDroneIdsRaw : [];
  const cloneResults = Array.isArray(args.cloneResultsRaw) ? args.cloneResultsRaw : [];
  const cloneResultBySourceDroneId = new Map<string, { cloneDroneId: string; cloneDroneName: string }>();
  for (const candidate of cloneResults) {
    const sourceDroneId = String(candidate?.sourceDroneId ?? '').trim();
    const cloneDroneId = String(candidate?.cloneDroneId ?? '').trim();
    if (!sourceDroneId || !cloneDroneId) continue;
    cloneResultBySourceDroneId.set(sourceDroneId, {
      cloneDroneId,
      cloneDroneName: String(candidate?.cloneDroneName ?? '').trim(),
    });
  }

  const nodes: Array<{ droneId: string; label: string; x: number; y: number }> = [];
  const optimisticDroneNameById: Record<string, string> = {};
  let cloneIndex = 0;

  for (const raw of copiedDroneIds) {
    const sourceDroneId = String(raw ?? '').trim();
    if (!sourceDroneId) continue;
    const result = cloneResultBySourceDroneId.get(sourceDroneId);
    if (!result) continue;
    const sourceNodeId = String(args.sourceNodeIdByDroneId[sourceDroneId] ?? '').trim();
    const sourceNode = sourceNodeId ? args.nodesById[sourceNodeId] : null;
    const cloneNodeId = createCanvasDroneNodeId(result.cloneDroneId);
    if (!sourceNode || !cloneNodeId) continue;
    cloneIndex += 1;
    nodes.push({
      droneId: cloneNodeId,
      label: result.cloneDroneName || result.cloneDroneId,
      x: sourceNode.x + args.cloneOffsetXPx * cloneIndex,
      y: sourceNode.y + args.cloneOffsetYPx * cloneIndex,
    });
    if (result.cloneDroneName) optimisticDroneNameById[result.cloneDroneId] = result.cloneDroneName;
  }

  return { nodes, optimisticDroneNameById };
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

export function buildOptimisticChatCloneCanvasNodes(args: {
  sources: CanvasChatCloneSource[];
  cloneResults: Array<{ sourceNodeId: string; chatName?: string | null }>;
  nodesById: Record<string, { x: number; y: number } | undefined>;
  cloneOffsetXPx: number;
  cloneOffsetYPx: number;
}): Array<{ droneId: string; label: string; x: number; y: number }> {
  const resultBySourceNodeId = new Map<string, string>();
  for (const result of Array.isArray(args.cloneResults) ? args.cloneResults : []) {
    const sourceNodeId = String(result?.sourceNodeId ?? '').trim();
    const chatName = String(result?.chatName ?? '').trim();
    if (sourceNodeId && chatName) resultBySourceNodeId.set(sourceNodeId, chatName);
  }

  const nodes: Array<{ droneId: string; label: string; x: number; y: number }> = [];
  let cloneIndex = 0;
  for (const source of Array.isArray(args.sources) ? args.sources : []) {
    const chatName = resultBySourceNodeId.get(source.nodeId);
    const sourceNode = args.nodesById[source.nodeId];
    if (!chatName || !sourceNode) continue;
    const nodeId = createCanvasChatNodeId(source.droneId, chatName);
    if (!nodeId) continue;
    cloneIndex += 1;
    nodes.push({
      droneId: nodeId,
      label: chatName,
      x: sourceNode.x + args.cloneOffsetXPx * cloneIndex,
      y: sourceNode.y + args.cloneOffsetYPx * cloneIndex,
    });
  }
  return nodes;
}
