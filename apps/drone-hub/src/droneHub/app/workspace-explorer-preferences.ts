import { profileStorageKey } from '../../profile-storage';

export const WORKSPACE_EXPLORER_WIDTH_MIN_PX = 180;
export const WORKSPACE_EXPLORER_WIDTH_DEFAULT_PX = 240;
export const WORKSPACE_EXPLORER_WIDTH_MAX_PX = 480;
export const WORKSPACE_EXPLORER_ZOOM_MIN = 0.5;
export const WORKSPACE_EXPLORER_ZOOM_DEFAULT = 1;
export const WORKSPACE_EXPLORER_ZOOM_MAX = 2;
export const WORKSPACE_EXPLORER_ZOOM_STEP = 0.05;

export const WORKSPACE_EXPLORER_WIDTH_STORAGE_KEY = profileStorageKey('droneHub.workspaceExplorerWidthPx');
export const WORKSPACE_EXPLORER_ZOOM_STORAGE_KEY = profileStorageKey('droneHub.workspaceExplorerZoom');

const LEGACY_CHANGES_EXPLORER_WIDTH_STORAGE_KEY = profileStorageKey('droneHub.changesExplorerWidthPx');
const LEGACY_CHANGES_EXPLORER_ZOOM_STORAGE_KEY = profileStorageKey('droneHub.changesExplorerZoom');
const LEGACY_EDITOR_EXPLORER_LAYOUT_STORAGE_KEY = profileStorageKey('droneHub.editorExplorerLayout');
const workspaceExplorerZoomListeners = new Set<() => void>();

function readStorage(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Keep the active preference in memory when browser storage is unavailable.
  }
}

export function clampWorkspaceExplorerWidth(width: number): number {
  const safeWidth = Number.isFinite(width) ? Math.round(width) : WORKSPACE_EXPLORER_WIDTH_DEFAULT_PX;
  return Math.max(WORKSPACE_EXPLORER_WIDTH_MIN_PX, Math.min(WORKSPACE_EXPLORER_WIDTH_MAX_PX, safeWidth));
}

export function clampWorkspaceExplorerZoom(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) ? zoom : WORKSPACE_EXPLORER_ZOOM_DEFAULT;
  return Math.round(
    Math.max(WORKSPACE_EXPLORER_ZOOM_MIN, Math.min(WORKSPACE_EXPLORER_ZOOM_MAX, safeZoom)) * 100,
  ) / 100;
}

export function readWorkspaceExplorerWidth(): number {
  const sharedWidth = Number(readStorage(WORKSPACE_EXPLORER_WIDTH_STORAGE_KEY));
  if (Number.isFinite(sharedWidth) && sharedWidth > 0) return clampWorkspaceExplorerWidth(sharedWidth);

  const legacyChangesWidth = Number(readStorage(LEGACY_CHANGES_EXPLORER_WIDTH_STORAGE_KEY));
  if (Number.isFinite(legacyChangesWidth) && legacyChangesWidth > 0) {
    return clampWorkspaceExplorerWidth(legacyChangesWidth);
  }

  try {
    const legacyEditorLayout = JSON.parse(readStorage(LEGACY_EDITOR_EXPLORER_LAYOUT_STORAGE_KEY) ?? 'null') as {
      width?: unknown;
    } | null;
    const legacyEditorWidth = Number(legacyEditorLayout?.width);
    if (Number.isFinite(legacyEditorWidth) && legacyEditorWidth > 0) {
      return clampWorkspaceExplorerWidth(legacyEditorWidth);
    }
  } catch {
    // Fall through to the shared default.
  }
  return WORKSPACE_EXPLORER_WIDTH_DEFAULT_PX;
}

export function writeWorkspaceExplorerWidth(width: number): void {
  writeStorage(WORKSPACE_EXPLORER_WIDTH_STORAGE_KEY, String(clampWorkspaceExplorerWidth(width)));
}

export function readWorkspaceExplorerZoom(): number {
  const sharedZoom = Number(readStorage(WORKSPACE_EXPLORER_ZOOM_STORAGE_KEY));
  if (Number.isFinite(sharedZoom) && sharedZoom > 0) return clampWorkspaceExplorerZoom(sharedZoom);
  const legacyZoom = Number(readStorage(LEGACY_CHANGES_EXPLORER_ZOOM_STORAGE_KEY));
  return Number.isFinite(legacyZoom) && legacyZoom > 0
    ? clampWorkspaceExplorerZoom(legacyZoom)
    : WORKSPACE_EXPLORER_ZOOM_DEFAULT;
}

export function writeWorkspaceExplorerZoom(zoom: number): void {
  writeStorage(WORKSPACE_EXPLORER_ZOOM_STORAGE_KEY, String(clampWorkspaceExplorerZoom(zoom)));
  for (const listener of workspaceExplorerZoomListeners) listener();
}

export function subscribeWorkspaceExplorerZoom(listener: () => void): () => void {
  workspaceExplorerZoomListeners.add(listener);
  return () => workspaceExplorerZoomListeners.delete(listener);
}
