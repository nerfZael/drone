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

export function mobileDroneDisplayState(drone: MobileDroneSummary): MobileDroneDisplayState {
  const rawState = `${drone.phase ?? ''} ${drone.status ?? ''}`.toLowerCase();
  if (drone.approvalRequired || rawState.includes('approval')) return 'approval';
  if (drone.busyChats.length > 0) return 'working';
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

export function addMobileDroneToStateSummary(
  summary: MobileDroneStateSummary,
  drone: MobileDroneSummary,
): void {
  const state = mobileDroneDisplayState(drone);
  if (state === 'approval') summary.approval += 1;
  if (state === 'working' || state === 'starting') summary.working += 1;
  if ((drone.unreadChats?.length ?? 0) > 0) summary.unread += 1;
}

export function summarizeMobileDrones(
  drones: readonly MobileDroneSummary[],
): MobileDroneStateSummary {
  const summary = { ...EMPTY_MOBILE_DRONE_STATE_SUMMARY };
  for (const drone of drones) addMobileDroneToStateSummary(summary, drone);
  return summary;
}
