import {
  createCanvasChatNodeId,
  parseCanvasChatNodeId,
  type CanvasChatRef,
} from '../app/app-config';

type DraggedChatPayloadEntry =
  | string
  | {
      nodeId?: unknown;
      droneId?: unknown;
      chatName?: unknown;
    };

export function parseDraggedChatPayload(jsonRaw: string): string[] {
  const out: string[] = [];
  const add = (raw: unknown) => {
    const nodeId = String(raw ?? '').trim();
    if (!nodeId || out.includes(nodeId)) return;
    if (!parseCanvasChatNodeId(nodeId)) return;
    out.push(nodeId);
  };

  try {
    if (!jsonRaw) return out;
    const parsed = JSON.parse(jsonRaw);
    if (!Array.isArray(parsed)) return out;
    for (const value of parsed as DraggedChatPayloadEntry[]) {
      if (typeof value === 'string') {
        add(value);
        continue;
      }
      const nodeId = String(value?.nodeId ?? '').trim();
      if (nodeId) {
        add(nodeId);
        continue;
      }
      const droneId = String(value?.droneId ?? '').trim();
      const chatName = String(value?.chatName ?? '').trim() || 'default';
      if (!droneId) continue;
      add(createCanvasChatNodeId(droneId, chatName));
    }
  } catch {
    // Ignore malformed drag payload.
  }
  return out;
}

export function orderChatNodeIdsBySidebar(ids: string[], sidebarOrderedChatNodeIds: string[]): string[] {
  if (!Array.isArray(ids) || ids.length <= 1) return ids;
  const rankById = new Map<string, number>();
  for (const [index, rawId] of sidebarOrderedChatNodeIds.entries()) {
    const id = String(rawId ?? '').trim();
    if (!id || rankById.has(id)) continue;
    rankById.set(id, index);
  }

  return ids
    .map((id, index) => ({ id, index, rank: rankById.get(id) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.index - b.index;
    })
    .map((item) => item.id);
}

export function buildChatCountByDroneId(sidebarOrderedChatNodeIds: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const rawId of sidebarOrderedChatNodeIds) {
    const nodeId = String(rawId ?? '').trim();
    if (!nodeId) continue;
    const ref = parseCanvasChatNodeId(nodeId);
    if (!ref) continue;
    counts[ref.droneId] = (counts[ref.droneId] ?? 0) + 1;
  }
  return counts;
}

export function collectUniqueChatTargets(nodeIds: string[]): CanvasChatRef[] {
  const out: CanvasChatRef[] = [];
  for (const rawId of nodeIds) {
    const nodeId = String(rawId ?? '').trim();
    if (!nodeId) continue;
    const ref = parseCanvasChatNodeId(nodeId);
    if (!ref) continue;
    if (out.some((x) => x.droneId === ref.droneId && x.chatName === ref.chatName)) continue;
    out.push(ref);
  }
  return out;
}

export function sortChatNodeIdsForDestructiveDelete(nodeIds: string[]): string[] {
  return nodeIds.slice().sort((a, b) => {
    const aRef = parseCanvasChatNodeId(a);
    const bRef = parseCanvasChatNodeId(b);
    const aDefault = aRef?.chatName === 'default';
    const bDefault = bRef?.chatName === 'default';
    if (aDefault === bDefault) return 0;
    return aDefault ? 1 : -1;
  });
}

export function getChatNodeActionFlags(
  chatRef: CanvasChatRef | null,
  chatCountByDroneId: Record<string, number>,
): { chatCountForDrone: number; renameDisabled: boolean; deleteDisabled: boolean } {
  const droneId = String(chatRef?.droneId ?? '').trim();
  const chatName = String(chatRef?.chatName ?? '').trim();
  const chatCountForDrone = droneId ? Math.max(1, chatCountByDroneId[droneId] ?? 1) : 0;
  const renameDisabled = chatName === 'default';
  const deleteDisabled = chatName === 'default' && chatCountForDrone > 1;
  return { chatCountForDrone, renameDisabled, deleteDisabled };
}
