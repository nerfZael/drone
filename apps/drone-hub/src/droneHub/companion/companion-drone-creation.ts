import type { DesktopNewDronePreferences } from '../app/new-drone-preferences';

type DesktopSpawnPreferences = Omit<
  DesktopNewDronePreferences,
  'mode' | 'runtime' | 'persistVolume'
>;

export function resolveCompanionDroneCreationPreferences({
  remembered,
  defaults,
  spawnContext,
  hasSpawnContext,
}: {
  remembered: DesktopNewDronePreferences | null;
  defaults: DesktopNewDronePreferences;
  spawnContext: DesktopSpawnPreferences;
  hasSpawnContext: boolean;
}): DesktopNewDronePreferences {
  const base = remembered ?? defaults;
  // A legacy local preference is authoritative until a synchronized repo or
  // global fallback exists. With no legacy value, the normal fallback applies.
  return !remembered || hasSpawnContext ? { ...base, ...spawnContext } : base;
}
