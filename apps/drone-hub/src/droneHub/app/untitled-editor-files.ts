import { profileStorageKey } from '../../profile-storage';
import type { OpenedFileTabsState } from './opened-file-tabs';

/**
 * New files made with Ctrl+N live only in the editor until they are saved
 * somewhere. Their tabs use an `untitled:` path so they never match a file
 * on disk, and their text is kept in browser storage so it survives a
 * restart, a crash or a change of drone.
 */
export const UNTITLED_EDITOR_PATH_PREFIX = 'untitled:';
export const EDITOR_UNTITLED_FILES_STORAGE_KEY = profileStorageKey('droneHub.editorUntitledFilesByDrone');

export type StoredUntitledFile = { name: string; content: string };
export type StoredUntitledFiles = { files: StoredUntitledFile[]; activeName: string | null };

export function isUntitledEditorPath(pathRaw: string | null | undefined): boolean {
  return String(pathRaw ?? '').startsWith(UNTITLED_EDITOR_PATH_PREFIX);
}

export function untitledEditorPath(name: string): string {
  return `${UNTITLED_EDITOR_PATH_PREFIX}${name}`;
}

/** The first free "Untitled-N" among the names already open. */
export function nextUntitledFileName(usedNames: Iterable<string>): string {
  const used = new Set(usedNames);
  for (let n = 1; ; n += 1) {
    const name = `Untitled-${n}`;
    if (!used.has(name)) return name;
  }
}

/** The untitled tabs of each drone, in strip order, as they are stored. */
export function untitledFilesFromTabState(
  stateByDroneId: Record<string, OpenedFileTabsState>,
): Record<string, StoredUntitledFiles> {
  const stored: Record<string, StoredUntitledFiles> = {};
  for (const [droneId, state] of Object.entries(stateByDroneId)) {
    const untitled = state.tabs.filter((tab) => tab.untitled);
    if (untitled.length === 0) continue;
    const active = untitled.find((tab) => tab.tabId === state.activeTabId);
    stored[droneId] = {
      files: untitled.map((tab) => ({ name: tab.name, content: tab.content })),
      activeName: active?.name ?? null,
    };
  }
  return stored;
}

function normalizeStoredUntitledFiles(raw: unknown): StoredUntitledFiles | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Partial<StoredUntitledFiles>;
  const seen = new Set<string>();
  const files: StoredUntitledFile[] = [];
  for (const fileRaw of Array.isArray(candidate.files) ? candidate.files : []) {
    const name = String((fileRaw as Partial<StoredUntitledFile>)?.name ?? '').trim();
    const content = (fileRaw as Partial<StoredUntitledFile>)?.content;
    if (!name || seen.has(name) || typeof content !== 'string') continue;
    seen.add(name);
    files.push({ name, content });
  }
  if (files.length === 0) return null;
  const activeName = typeof candidate.activeName === 'string' && seen.has(candidate.activeName)
    ? candidate.activeName
    : null;
  return { files, activeName };
}

export function readStoredUntitledFiles(): Record<string, StoredUntitledFiles> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = String(window.localStorage.getItem(EDITOR_UNTITLED_FILES_STORAGE_KEY) ?? '').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const stored: Record<string, StoredUntitledFiles> = {};
    for (const [droneIdRaw, filesRaw] of Object.entries(parsed)) {
      const droneId = String(droneIdRaw ?? '').trim();
      const files = normalizeStoredUntitledFiles(filesRaw);
      if (droneId && files) stored[droneId] = files;
    }
    return stored;
  } catch {
    return {};
  }
}

/** Returns the serialized value written, so callers can skip unchanged writes. */
export function writeStoredUntitledFiles(stored: Record<string, StoredUntitledFiles>): string {
  const serialized = Object.keys(stored).length === 0 ? '' : JSON.stringify(stored);
  if (typeof window === 'undefined') return serialized;
  try {
    if (serialized) window.localStorage.setItem(EDITOR_UNTITLED_FILES_STORAGE_KEY, serialized);
    else window.localStorage.removeItem(EDITOR_UNTITLED_FILES_STORAGE_KEY);
  } catch {
    // The text stays in the open tabs for this session if storage is full or unavailable.
  }
  return serialized;
}
