import { DRONE_CHAT_DND_MIME, DRONE_DND_MIME, parseCanvasChatNodeId } from './app-config';
import { parseDraggedChatPayload, parseDraggedDronePayload } from '../canvas/chat-node-utils';
import type { DroneHubDragData } from './drone-hub-dnd';

export function assignedDroneIdsFromData(data: DroneHubDragData | null): string[] {
  if (!data) return [];
  if (data.type === 'sidebar-chat') {
    const droneId = String(data.droneId ?? '').trim();
    return droneId ? [droneId] : [];
  }
  if (data.type === 'sidebar-folder' || data.type === 'sidebar-pinned-drone') return [];
  return Array.from(new Set(data.droneIds.map((item) => String(item ?? '').trim()).filter(Boolean)));
}

export function resolveAssignedDroneIdsFromTransfer(transfer: Pick<DataTransfer, 'getData'>): string[] {
  const droneIds = parseDraggedDronePayload(transfer.getData(DRONE_DND_MIME));
  const chatDroneIds = parseDraggedChatPayload(transfer.getData(DRONE_CHAT_DND_MIME))
    .map((nodeId) => parseCanvasChatNodeId(nodeId)?.droneId ?? '')
    .filter(Boolean);
  return Array.from(new Set([...droneIds, ...chatDroneIds]));
}
