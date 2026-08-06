export const UI_PREFERENCES_SNAPSHOT_EVENT = 'drone-hub:ui-preferences-snapshot';

export type UiPreferencesSnapshotEventDetail = {
  uiPreferences: Record<string, unknown>;
  updatedAt: string | null;
  version: number | null;
};

export function dispatchUiPreferencesSnapshot(detail: UiPreferencesSnapshotEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UI_PREFERENCES_SNAPSHOT_EVENT, { detail }));
}
