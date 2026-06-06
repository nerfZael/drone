import type { DroneSummary } from '../types';
import type { RightPanelTab } from './app-config';
import { isDroneStartingOrSeeding } from './helpers';

export function shellTerminalPrewarmKey(opts: { droneId: string; cwd: string }): string {
  const droneId = String(opts.droneId ?? '').trim();
  const cwd = String(opts.cwd ?? '').trim();
  if (!droneId || !cwd) return '';
  return `${droneId}\u0000${cwd}`;
}

export function shouldPrewarmShellTerminal(opts: {
  drone: DroneSummary | null;
  cwd: string;
  rightPanelOpen: boolean;
  rightPanelTab: RightPanelTab;
  rightPanelSplit: boolean;
  rightPanelBottomTab: RightPanelTab;
}): boolean {
  const drone = opts.drone;
  if (!drone) return false;
  if (!opts.rightPanelOpen) return false;
  if (String(drone.runtime ?? '').trim().toLowerCase() !== 'container') return false;
  if (!drone.statusOk) return false;
  if (isDroneStartingOrSeeding(drone.hubPhase)) return false;
  if (!String(opts.cwd ?? '').trim()) return false;
  if (opts.rightPanelTab === 'terminal') return false;
  return true;
}
