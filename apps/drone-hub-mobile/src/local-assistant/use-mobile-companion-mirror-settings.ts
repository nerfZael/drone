import { useMobileCompanionHubToggle } from './use-mobile-companion-hub-toggle';

const MIRROR = {
  label: 'desktop mirroring',
  get: 'mirror.settings.get',
  update: 'mirror.settings.update',
  changed: 'mirror.settings.changed',
};

/** Whether the selected Hub shows this phone's Companion; the same switch as desktop Companion's. */
export function useMobileCompanionMirrorSettings(deviceId: string) {
  return useMobileCompanionHubToggle(deviceId, MIRROR);
}
