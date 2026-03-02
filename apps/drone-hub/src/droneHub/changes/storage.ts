export const CHANGES_VIEW_STORAGE_KEY = 'droneHub.changesViewMode';
export const CHANGES_DIFF_VIEW_STORAGE_KEY = 'droneHub.changesDiffViewType';

export function readChangesStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeChangesStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
