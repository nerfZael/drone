import type { OpenedFileTabsState } from './opened-file-tabs';

const EMPTY_OPENED_FILE_TABS_STATE: OpenedFileTabsState = { tabs: [], activeTabId: null };

export function openedFileTabsStateForDrone(
  stateByDroneId: Record<string, OpenedFileTabsState>,
  droneIdRaw: string,
): OpenedFileTabsState {
  const droneId = String(droneIdRaw ?? '').trim();
  return (droneId && stateByDroneId[droneId]) || EMPTY_OPENED_FILE_TABS_STATE;
}

export function updateOpenedFileTabsStateForDrone(
  stateByDroneId: Record<string, OpenedFileTabsState>,
  droneIdRaw: string,
  update: (current: OpenedFileTabsState) => OpenedFileTabsState,
): Record<string, OpenedFileTabsState> {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return stateByDroneId;
  const current = openedFileTabsStateForDrone(stateByDroneId, droneId);
  const next = update(current);
  if (next === current) return stateByDroneId;
  return { ...stateByDroneId, [droneId]: next };
}
