import { createCanvasChatNodeId } from './app-config';
import type { DroneSummary } from '../types';

export function normalizedDroneChats(
  drone: DroneSummary | null | undefined,
  opts?: { includeDefaultWhenEmpty?: boolean },
): string[] {
  const source = Array.isArray(drone?.chats) ? drone.chats : [];
  const out: string[] = [];
  for (const raw of source) {
    const chatName = String(raw ?? '').trim();
    if (!chatName || out.includes(chatName)) continue;
    out.push(chatName);
  }
  if (out.length === 0 && opts?.includeDefaultWhenEmpty) out.push('default');
  return out;
}

export function droneChatNodeIds(drone: DroneSummary | null | undefined): string[] {
  const droneId = String(drone?.id ?? '').trim();
  if (!droneId) return [];
  const out: string[] = [];
  for (const chatName of normalizedDroneChats(drone, { includeDefaultWhenEmpty: true })) {
    const nodeId = createCanvasChatNodeId(droneId, chatName);
    if (!nodeId || out.includes(nodeId)) continue;
    out.push(nodeId);
  }
  return out;
}

export function busyChatNodeIdsForDrone(drone: DroneSummary | null | undefined): string[] {
  const droneId = String(drone?.id ?? '').trim();
  if (!droneId) return [];
  const rawBusyChats = Array.isArray(drone?.busyChats) && drone.busyChats.length > 0
    ? drone.busyChats
    : drone?.busy
      ? ['default']
      : [];
  const out: string[] = [];
  for (const raw of rawBusyChats) {
    const chatName = String(raw ?? '').trim() || 'default';
    const nodeId = createCanvasChatNodeId(droneId, chatName);
    if (!nodeId || out.includes(nodeId)) continue;
    out.push(nodeId);
  }
  return out;
}
