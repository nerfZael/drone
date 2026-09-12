import type {
  DroneHubGlobalShortcutSettingsResponse,
  DroneHubShortcutActionId,
} from '@drone/hub-model';

let activeActionIds = new Set<DroneHubShortcutActionId>();

export function applyGlobalShortcutSettings(
  settings: DroneHubGlobalShortcutSettingsResponse,
): void {
  activeActionIds = new Set(
    Object.entries(settings.status.actions).flatMap(([actionId, status]) =>
      status?.active ? [actionId as DroneHubShortcutActionId] : [],
    ),
  );
}

export function clearActiveGlobalShortcutSettings(): void {
  activeActionIds = new Set();
}

export function isActiveGlobalShortcutAction(actionId: DroneHubShortcutActionId): boolean {
  return activeActionIds.has(actionId);
}
