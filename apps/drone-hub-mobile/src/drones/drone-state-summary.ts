import type { MobileDroneSummary } from './drone-sidebar-model';

export type MobileDroneDisplayState =
  | 'approval'
  | 'working'
  | 'waiting'
  | 'starting'
  | 'blocked'
  | 'offline'
  | 'idle';

export type MobileDroneStateSummary = {
  approval: number;
  working: number;
  unread: number;
};

export const EMPTY_MOBILE_DRONE_STATE_SUMMARY: MobileDroneStateSummary = {
  approval: 0,
  working: 0,
  unread: 0,
};

export function withOptimisticMobileBusyChat(
  drone: MobileDroneSummary,
  chatNameRaw: string,
  busy: boolean,
): MobileDroneSummary {
  if (!busy) return drone;
  const chatName = chatNameRaw.trim() || 'default';
  if (drone.busyChats.includes(chatName)) return drone;
  return { ...drone, busyChats: [...drone.busyChats, chatName] };
}

export function withMobileApprovalRequired(
  drone: MobileDroneSummary,
  locallyRequired: boolean,
): MobileDroneSummary {
  if (drone.approvalRequired || !locallyRequired) return drone;
  return { ...drone, approvalRequired: true };
}

function mobileDroneInactiveDisplayState(drone: MobileDroneSummary): MobileDroneDisplayState {
  const rawState =
    `${drone.phase ?? ''} ${drone.status ?? ''} ${drone.statusError ?? ''}`.toLowerCase();
  if (
    rawState.includes('block') ||
    rawState.includes('error') ||
    rawState.includes('fail') ||
    rawState.includes('problem')
  )
    return 'blocked';
  if (drone.statusOk === false) return 'offline';
  if (rawState.includes('wait')) return 'waiting';
  if (rawState.includes('start') || rawState.includes('creat') || rawState.includes('seed'))
    return 'starting';
  return 'idle';
}

export function mobileDroneDisplayState(
  drone: MobileDroneSummary,
  includeChatActivity = true,
): MobileDroneDisplayState {
  if (includeChatActivity && drone.approvalRequired) return 'approval';
  if (includeChatActivity && drone.busyChats.length > 0) return 'working';
  return mobileDroneInactiveDisplayState(drone);
}

export function mobileDroneChatDisplayState(
  drone: MobileDroneSummary,
  chatNameRaw: string,
  locallyApprovalRequired = false,
): MobileDroneDisplayState {
  const chatName = chatNameRaw.trim() || 'default';
  if (locallyApprovalRequired || drone.approvalChats?.includes(chatName)) {
    return 'approval';
  }
  if (drone.busyChats.includes(chatName)) return 'working';
  return mobileDroneInactiveDisplayState(drone);
}

export function addMobileDroneToStateSummary(
  summary: MobileDroneStateSummary,
  drone: MobileDroneSummary,
): void {
  const state = mobileDroneDisplayState(drone);
  const inactiveState = mobileDroneDisplayState(drone, false);
  if (state === 'approval') summary.approval += 1;
  if (state === 'working' || state === 'starting') summary.working += 1;
  if (
    inactiveState !== 'blocked' &&
    inactiveState !== 'offline' &&
    (drone.unreadChats?.length ?? 0) > 0
  ) {
    summary.unread += 1;
  }
}

export function summarizeMobileDrones(
  drones: readonly MobileDroneSummary[],
): MobileDroneStateSummary {
  const summary = { ...EMPTY_MOBILE_DRONE_STATE_SUMMARY };
  for (const drone of drones) addMobileDroneToStateSummary(summary, drone);
  return summary;
}

export function summarizeMobileDroneChats(
  drone: MobileDroneSummary,
  activeChatNameRaw = '',
): MobileDroneStateSummary {
  const summary = { ...EMPTY_MOBILE_DRONE_STATE_SUMMARY };
  const activeChatName = activeChatNameRaw.trim();
  const approvalChats = new Set(drone.approvalChats ?? []);
  for (const chatName of drone.chats) {
    const approval = approvalChats.has(chatName);
    const working = !approval && drone.busyChats.includes(chatName);
    const unread = chatName !== activeChatName && (drone.unreadChats ?? []).includes(chatName);
    if (approval) summary.approval += 1;
    if (working) summary.working += 1;
    if (unread) summary.unread += 1;
  }
  if (summary.approval === 0 && drone.approvalRequired) summary.approval = 1;
  return summary;
}
