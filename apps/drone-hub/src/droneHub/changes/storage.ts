export const CHANGES_VIEW_STORAGE_KEY = 'droneHub.changesViewMode';
export const CHANGES_DIFF_VIEW_STORAGE_KEY = 'droneHub.changesDiffViewType';
export const CHANGES_CONTEXT_STORAGE_KEY = 'droneHub.changesContextMode';
export const CHANGES_PRIMARY_VIEW_STORAGE_KEY = 'droneHub.changesPrimaryView';
export const CHANGES_BRANCH_MODE_STORAGE_KEY = 'droneHub.changesBranchMode';
export const CHANGES_EXPLORER_WIDTH_STORAGE_KEY = 'droneHub.changesExplorerWidthPx';
export const CHANGES_EXPLORER_ZOOM_STORAGE_KEY = 'droneHub.changesExplorerZoom';
export const CHANGES_COMMIT_LIST_WIDTH_STORAGE_KEY = 'droneHub.changesCommitListWidthPx';

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

export function removeChangesStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
