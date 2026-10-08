import { profileStorageKey } from '../../profile-storage';
import {
  createOpenedFileTab,
  createUntitledFileTab,
  type OpenedFileTab,
  type OpenedFileTabsState,
} from './opened-file-tabs';
import { readStoredUntitledFiles } from './untitled-editor-files';

const EMPTY_OPENED_FILE_TABS_STATE: OpenedFileTabsState = { tabs: [], activeTabId: null };
export const EDITOR_LAST_FILE_STORAGE_KEY = profileStorageKey('droneHub.editorLastFileByDrone');

export type RememberedEditorFile = {
  path: string;
  name: string;
  targetLine: number | null;
  targetColumn: number | null;
};

function normalizePositiveInt(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

function normalizeRememberedEditorFile(raw: unknown): RememberedEditorFile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Partial<RememberedEditorFile>;
  const path = String(candidate.path ?? '').trim();
  if (!path) return null;
  return {
    path,
    name: String(candidate.name ?? '').trim() || path.split('/').filter(Boolean).pop() || path,
    targetLine: normalizePositiveInt(candidate.targetLine),
    targetColumn: normalizePositiveInt(candidate.targetColumn),
  };
}

function readRememberedEditorFileMap(): Record<string, RememberedEditorFile> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = String(window.localStorage.getItem(EDITOR_LAST_FILE_STORAGE_KEY) ?? '').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const remembered: Record<string, RememberedEditorFile> = {};
    for (const [droneIdRaw, fileRaw] of Object.entries(parsed)) {
      const droneId = String(droneIdRaw ?? '').trim();
      const file = normalizeRememberedEditorFile(fileRaw);
      if (droneId && file) remembered[droneId] = file;
    }
    return remembered;
  } catch {
    return {};
  }
}

export function readRememberedEditorFile(droneIdRaw: string): RememberedEditorFile | null {
  const droneId = String(droneIdRaw ?? '').trim();
  return (droneId && readRememberedEditorFileMap()[droneId]) || null;
}

export function writeRememberedEditorFile(
  droneIdRaw: string,
  fileRaw: RememberedEditorFile | null,
): void {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId || typeof window === 'undefined') return;
  const current = readRememberedEditorFileMap();
  const file = normalizeRememberedEditorFile(fileRaw);
  if (file) current[droneId] = file;
  else delete current[droneId];
  try {
    if (Object.keys(current).length === 0) {
      window.localStorage.removeItem(EDITOR_LAST_FILE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(EDITOR_LAST_FILE_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // File restoration is optional when browser storage is unavailable.
  }
}

export function rememberedEditorFileFromTab(
  tab: OpenedFileTab | null | undefined,
): RememberedEditorFile | null {
  if (!tab || tab.untitled) return null;
  return {
    path: tab.path,
    name: tab.name,
    targetLine: tab.targetLine,
    targetColumn: tab.targetColumn,
  };
}

/**
 * Each drone's tabs for a new session: its last opened file and, when
 * `includeUntitled`, the unsaved new files it had open.
 */
export function restoredOpenedFileTabsStateByDrone(
  { includeUntitled = false }: { includeUntitled?: boolean } = {},
): Record<string, OpenedFileTabsState> {
  const restored: Record<string, OpenedFileTabsState> = {};
  for (const [droneId, file] of Object.entries(readRememberedEditorFileMap())) {
    const tab = createOpenedFileTab({
      droneId,
      path: file.path,
      name: file.name,
      targetLine: file.targetLine,
      targetColumn: file.targetColumn,
      navigationSeq: 0,
    });
    restored[droneId] = { tabs: [tab], activeTabId: tab.tabId };
  }
  if (!includeUntitled) return restored;
  for (const [droneId, untitled] of Object.entries(readStoredUntitledFiles())) {
    const tabs = untitled.files.map((file) =>
      createUntitledFileTab({ droneId, name: file.name, content: file.content, navigationSeq: 0 }),
    );
    const current = restored[droneId] ?? { tabs: [], activeTabId: null };
    const active = tabs.find((tab) => tab.name === untitled.activeName);
    restored[droneId] = {
      tabs: [...current.tabs, ...tabs],
      activeTabId: active?.tabId ?? current.activeTabId ?? tabs[0]?.tabId ?? null,
    };
  }
  return restored;
}

export function openedFileTabsStateForDrone(
  stateByDroneId: Record<string, OpenedFileTabsState>,
  droneIdRaw: string,
): OpenedFileTabsState {
  const droneId = String(droneIdRaw ?? '').trim();
  return (droneId && stateByDroneId[droneId]) || EMPTY_OPENED_FILE_TABS_STATE;
}

export function updateOpenedFileTabsStateForDrone(
  stateByDroneId: Record<string, OpenedFileTabsState>,
  droneIdRaw: string,
  update: (current: OpenedFileTabsState) => OpenedFileTabsState,
): Record<string, OpenedFileTabsState> {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return stateByDroneId;
  const current = openedFileTabsStateForDrone(stateByDroneId, droneId);
  const next = update(current);
  if (next === current) return stateByDroneId;
  return { ...stateByDroneId, [droneId]: next };
}
