import { useMobileCompanionHubToggle } from './use-mobile-companion-hub-toggle';

const AUTO_APPROVE = {
  label: 'auto-approve proposals',
  get: 'auto-approve.settings.get',
  update: 'auto-approve.settings.update',
  changed: 'auto-approve.settings.changed',
};

/** The preference belongs to the selected Hub, shared with desktop Companion. */
export function useMobileCompanionAutoApproveSettings(deviceId: string) {
  return useMobileCompanionHubToggle(deviceId, AUTO_APPROVE);
}
