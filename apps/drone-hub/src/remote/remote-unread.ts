import { createCanvasChatNodeId } from '../droneHub/app/app-config';
import { busyChatNodeIdsForDrone, droneChatNodeIds } from '../droneHub/app/chat-node-helpers';
import type { DroneSummary } from '../droneHub/types';

export function remoteBusyChatNodeIds(drones: DroneSummary[]): Set<string> {
  const out = new Set<string>();
  for (const drone of drones) {
    if (drone.runtime === 'host') continue;
    for (const nodeId of busyChatNodeIdsForDrone(drone)) out.add(nodeId);
  }
  return out;
}

export function updateRemoteUnreadChats(args: {
  drones: DroneSummary[];
  previousBusyChatNodeIds: ReadonlySet<string>;
  busyChatNodeIds: ReadonlySet<string>;
  unreadAgentMessageByChatNodeId: Readonly<Record<string, boolean>>;
  selectedDroneId: string | null;
  selectedChat: string;
}): Record<string, boolean> {
  const validChatNodeIds = new Set<string>();
  for (const drone of args.drones) {
    if (drone.runtime === 'host') continue;
    for (const nodeId of droneChatNodeIds(drone)) validChatNodeIds.add(nodeId);
  }
  const selectedNodeId = createCanvasChatNodeId(args.selectedDroneId ?? '', args.selectedChat);
  const next: Record<string, boolean> = {};
  for (const [nodeId, unread] of Object.entries(args.unreadAgentMessageByChatNodeId)) {
    if (!unread || nodeId === selectedNodeId || !validChatNodeIds.has(nodeId)) continue;
    next[nodeId] = true;
  }
  for (const nodeId of args.previousBusyChatNodeIds) {
    if (
      args.busyChatNodeIds.has(nodeId) ||
      nodeId === selectedNodeId ||
      !validChatNodeIds.has(nodeId)
    )
      continue;
    next[nodeId] = true;
  }
  return next;
}
