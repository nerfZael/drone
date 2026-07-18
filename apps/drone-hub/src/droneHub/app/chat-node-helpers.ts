import { createCanvasChatNodeId } from './app-config';
import type { DroneSummary } from '../types';

export type ManualUnreadMarker = {
  latestAgentRevision: number | null;
  observedInSummary: boolean;
};

export type ChatReadCursor = {
  unread: boolean;
  latestAgentTurnId: string | null;
  latestAgentRevision: number;
};

export function nextUnreadChatReadCursor(
  current: ChatReadCursor,
  response: Partial<ChatReadCursor> | null | undefined,
  latestSummary: ChatReadCursor | null | undefined,
): ChatReadCursor | null {
  const candidates = [response, latestSummary];
  for (const candidate of candidates) {
    if (
      candidate?.unread !== true ||
      !Number.isSafeInteger(candidate.latestAgentRevision) ||
      Number(candidate.latestAgentRevision) <= current.latestAgentRevision
    ) {
      continue;
    }
    return {
      unread: true,
      latestAgentTurnId:
        typeof candidate.latestAgentTurnId === 'string'
          ? candidate.latestAgentTurnId
          : null,
      latestAgentRevision: Number(candidate.latestAgentRevision),
    };
  }
  return null;
}

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

export function hasOnlyDefaultChat(drone: DroneSummary | null | undefined): boolean {
  const chats = normalizedDroneChats(drone, { includeDefaultWhenEmpty: true });
  return chats.length === 1 && chats[0] === 'default';
}

export function resolveCanvasChatDisplay(
  drone: DroneSummary | null | undefined,
  chatNameRaw: string,
  droneLabelRaw?: string | null,
): { primaryLabel: string; secondaryLabel: string } {
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  const droneLabel =
    String(droneLabelRaw ?? '').trim() ||
    String(drone?.name ?? '').trim() ||
    String(drone?.id ?? '').trim();
  if (chatName === 'default' && hasOnlyDefaultChat(drone) && droneLabel) {
    return {
      primaryLabel: droneLabel,
      secondaryLabel: '',
    };
  }
  return {
    primaryLabel: chatName,
    secondaryLabel: droneLabel,
  };
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

export function unreadChatNodeIdsForDrone(
  drone: DroneSummary | null | undefined,
): string[] {
  const droneId = String(drone?.id ?? '').trim();
  if (!droneId) return [];
  const chats = normalizedDroneChats(drone, { includeDefaultWhenEmpty: true });
  const readStates = drone?.chatReadStates ?? {};
  const hasReadStates = Object.keys(readStates).length > 0;
  const unreadChats = hasReadStates
    ? chats.filter((chatName) => readStates[chatName]?.unread === true)
    : (drone?.unreadChats ?? []).filter((chatName) => chats.includes(chatName));
  const out: string[] = [];
  for (const chatName of unreadChats) {
    const nodeId = createCanvasChatNodeId(droneId, chatName);
    if (nodeId && !out.includes(nodeId)) out.push(nodeId);
  }
  return out;
}

export function reconcileManualUnreadMarker(
  marker: ManualUnreadMarker,
  readState: NonNullable<DroneSummary['chatReadStates']>[string] | null | undefined,
): ManualUnreadMarker | null {
  if (marker.latestAgentRevision == null || !readState) return marker;
  if (readState.latestAgentRevision > marker.latestAgentRevision) return null;
  if (readState.latestAgentRevision < marker.latestAgentRevision) return marker;
  if (readState.unread) {
    return marker.observedInSummary ? marker : { ...marker, observedInSummary: true };
  }
  return marker.observedInSummary ? null : marker;
}
