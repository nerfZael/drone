import type {
  DroneHubGlobalShortcutBindings,
  DroneHubGlobalShortcutSettingsResponse,
  DroneHubShortcutActionId,
} from '@drone/hub-model';

let activeBindings: DroneHubGlobalShortcutBindings = {};

export function applyGlobalShortcutSettings(
  settings: DroneHubGlobalShortcutSettingsResponse,
): void {
  const bindings = { ...settings.bindings };
  activeBindings = Object.fromEntries(
    Object.entries(bindings).filter(
      ([actionId]) => settings.status.actions[actionId as DroneHubShortcutActionId]?.active,
    ),
  );
}

export function clearActiveGlobalShortcutSettings(): void {
  activeBindings = {};
}

export function activeGlobalShortcutBindings(): DroneHubGlobalShortcutBindings {
  return activeBindings;
}
