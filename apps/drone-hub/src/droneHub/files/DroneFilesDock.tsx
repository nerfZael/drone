import React from 'react';
import {
  UiCenteredLoadingState,
  UiPaneState,
  UiPanel,
  UiPanelStatusStrip,
} from '../../ui/components';
import { DRONE_WORKSPACE_STATE_DISPOSE_EVENT, disposedDroneIdFromEvent } from '../workspace-state-events';
import { invalidateFsListCachesForDrone } from '../app/use-files-and-ports-pane-state';
import { requestJson, requestJsonWithTimeout } from '../http';
import { IconChevron } from '../icons';
import type { DroneFsEntry, DroneFsListPayload, DroneFsUploadPayload } from '../types';
import { runDroneFsAction } from './file-actions-api';
import type { DroneOpenedFileState } from './opened-file-types';
import { FileTypeIcon } from './FileTypeIcon';
import { InlineExplorerNameInput } from './InlineExplorerNameInput';
import {
  fileExtensionLower,
  isPathInsideOrEqual,
  movedPathForEntry,
  parentFsPath,
  pruneSelectedPaths,
  renamedPathForEntry,
  selectedEntriesFromPaths,
  setAllVisibleSelected,
  topLevelSelectedEntries,
  toggleSelectedPath,
  type FileClipboardState,
} from './explorer-state';
import {
  DroneFilesContextMenu,
  type DroneFilesActionMode,
  type DroneFilesContextMenuState,
} from './DroneFilesContextMenu';
import { buildFileExplorerTree, type FileExplorerNode } from './tree';
import { clampWorkspaceExplorerZoom } from '../app/workspace-explorer-preferences';

const CHILD_DIRECTORY_CACHE_MAX_AGE_MS = 5 * 60_000;
const FS_LIST_REQUEST_TIMEOUT_MS = 12_000;

type ChildDirectoryCacheEntry = {
  atMs: number;
  entries: DroneFsEntry[];
};

const childDirectoryCache = new Map<string, ChildDirectoryCacheEntry>();

function childDirectoryCacheKey(droneIdRaw: string, dirPathRaw: string): string {
  return `${String(droneIdRaw ?? '').trim()}\u0000${normalizeContainerPathInput(dirPathRaw)}`;
}

function readChildDirectoryCache(cacheKey: string): DroneFsEntry[] | null {
  const cached = childDirectoryCache.get(cacheKey);
  if (!cached || Date.now() - cached.atMs > CHILD_DIRECTORY_CACHE_MAX_AGE_MS) return null;
  return cached.entries;
}

function writeChildDirectoryCache(cacheKey: string, entries: DroneFsEntry[]): void {
  if (!cacheKey) return;
  if (childDirectoryCache.size > 500) childDirectoryCache.clear();
  childDirectoryCache.set(cacheKey, { atMs: Date.now(), entries });
}

function clearChildDirectoryCacheForDrone(droneIdRaw: string): void {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return;
  for (const key of Array.from(childDirectoryCache.keys())) {
    if (key.startsWith(`${droneId}\u0000`)) childDirectoryCache.delete(key);
  }
}

const expandedDirectoriesByWorkspace = new Map<string, Record<string, boolean>>();

if (typeof window !== 'undefined') {
  window.addEventListener(DRONE_WORKSPACE_STATE_DISPOSE_EVENT, (event) => {
    const droneId = disposedDroneIdFromEvent(event);
    if (!droneId) return;
    for (const key of expandedDirectoriesByWorkspace.keys()) {
      if (key.startsWith(`${droneId}\u0000`)) expandedDirectoriesByWorkspace.delete(key);
    }
  });
}

function filesWorkspaceStateKey(droneIdRaw: string, pathRaw: string): string {
  return `${String(droneIdRaw ?? '').trim()}\u0000${normalizeContainerPathInput(pathRaw)}`;
}

function normalizeContainerPathInput(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function contextMenuPosition(x: number, y: number): { x: number; y: number } {
  const menuWidth = 220;
  const menuHeight = 380;
  return {
    x: Math.max(4, Math.min(x, window.innerWidth - menuWidth - 4)),
    y: Math.max(4, Math.min(y, window.innerHeight - menuHeight - 4)),
  };
}

function formatLocalDateTime(ms: number | null | undefined): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '-';
  try {
    return new Date(n).toLocaleString();
  } catch {
    return '-';
  }
}

function hasFileDragPayload(event: React.DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function sameFsEntries(a: DroneFsEntry[] | undefined, b: DroneFsEntry[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!right) return false;
    if (
      left.name !== right.name ||
      left.path !== right.path ||
      left.kind !== right.kind ||
      left.size !== right.size ||
      left.mtimeMs !== right.mtimeMs ||
      left.ext !== right.ext ||
      left.isGitIgnored !== right.isGitIgnored ||
      left.isImage !== right.isImage ||
      left.isVideo !== right.isVideo
    ) {
      return false;
    }
  }
  return true;
}

function InlineSpinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 rounded-full border border-[var(--accent-muted)] border-t-[var(--accent)] animate-spin"
    />
  );
}

export function DroneFilesDock({
  droneId,
  path,
  homePath: _homePath,
  entries,
  loading,
  error,
  startup,
  onOpenPath,
  onOpenFile,
  onOpenFileInPanel,
  onRefresh,
  onRefreshOpenedFile,
  onCloseOpenedFile,
  onConfirmCloseOpenedFilesForPaths,
  onCloseOpenedFilesForPaths,
  onRemapOpenedFilesForPathChange,
  openedFile,
  readOnly = false,
  zoom = 1,
}: {
  droneId: string;
  droneName: string;
  droneLabel?: string;
  path: string;
  homePath: string;
  entries: DroneFsEntry[];
  loading: boolean;
  error: string | null;
  startup?: { waiting: boolean; timedOut: boolean; hubPhase?: 'draft' | 'creating' | 'starting' | 'seeding' | 'error' | null; hubMessage?: string | null } | null;
  onOpenPath: (nextPath: string) => void;
  onOpenFile: (entry: DroneFsEntry) => void;
  onOpenFileInPanel?: (entry: DroneFsEntry) => boolean;
  onRefresh: () => void;
  onRefreshOpenedFile?: () => void;
  onCloseOpenedFile?: () => void;
  onConfirmCloseOpenedFilesForPaths?: (paths: string[], actionLabel?: string) => boolean;
  onCloseOpenedFilesForPaths?: (paths: string[]) => void;
  onRemapOpenedFilesForPathChange?: (sourcePath: string, targetPath: string) => void;
  openedFile: DroneOpenedFileState;
  readOnly?: boolean;
  zoom?: number;
}) {
  const explorerZoom = clampWorkspaceExplorerZoom(Number.isFinite(zoom) ? zoom : 1);
  const explorerRowHeightPx = Math.round(22 * explorerZoom);
  const explorerTextSizePx = Math.round(13 * explorerZoom * 10) / 10;
  const explorerLineHeightPx = Math.round(20 * explorerZoom);
  const explorerIconSlotPx = Math.round(16 * explorerZoom);
  const explorerFileIconPx = Math.round(15 * explorerZoom * 10) / 10;
  const explorerChevronPx = Math.round(12 * explorerZoom * 10) / 10;
  const explorerIndentPx = Math.round(8 * explorerZoom * 10) / 10;
  const explorerGuideOffsetPx = Math.round(11 * explorerZoom * 10) / 10;
  const explorerRowGeometryStyle: React.CSSProperties = {
    height: `${explorerRowHeightPx}px`,
    fontSize: `${explorerTextSizePx}px`,
    lineHeight: `${explorerLineHeightPx}px`,
  };
  const explorerIconSlotStyle: React.CSSProperties = {
    width: explorerIconSlotPx,
    height: explorerIconSlotPx,
  };
  const normalizedPath = normalizeContainerPathInput(path);
  const workspaceStateKey = filesWorkspaceStateKey(droneId, normalizedPath);
  const activeOpenedFilePath = String(openedFile.path ?? '').trim();
  const explorerRef = React.useRef<HTMLDivElement | null>(null);
  const selectionAnchorRef = React.useRef<string | null>(null);
  const [expandedDirs, setExpandedDirsState] = React.useState<Record<string, boolean>>(
    () => expandedDirectoriesByWorkspace.get(workspaceStateKey) ?? {},
  );
  const setExpandedDirs = React.useCallback<React.Dispatch<React.SetStateAction<Record<string, boolean>>>>(
    (next) => {
      setExpandedDirsState((current) => {
        const resolved = typeof next === 'function' ? next(current) : next;
        expandedDirectoriesByWorkspace.set(workspaceStateKey, resolved);
        return resolved;
      });
    },
    [workspaceStateKey],
  );
  const [childEntriesByPath, setChildEntriesByPath] = React.useState<Record<string, DroneFsEntry[]>>({});
  const [childLoadingByPath, setChildLoadingByPath] = React.useState<Record<string, boolean>>({});
  const [childErrorByPath, setChildErrorByPath] = React.useState<Record<string, string | null>>({});
  const dragDepthRef = React.useRef(0);
  const uploadRunRef = React.useRef(0);
  const childRequestSeqRef = React.useRef<Record<string, number>>({});
  const [dragActive, setDragActive] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadStatus, setUploadStatus] = React.useState<string | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = React.useState<Set<string>>(() => new Set());
  const [clipboard, setClipboard] = React.useState<FileClipboardState>(null);
  const [actionMode, setActionMode] = React.useState<DroneFilesActionMode | null>(null);
  const [actionInput, setActionInput] = React.useState('');
  const [actionTargetDirectory, setActionTargetDirectory] = React.useState(normalizedPath);
  const [actionLoading, setActionLoading] = React.useState(false);
  const actionRunRef = React.useRef(false);
  const [actionStatus, setActionStatus] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [contextMenu, setContextMenu] = React.useState<DroneFilesContextMenuState | null>(null);

  React.useEffect(() => {
    setExpandedDirsState(expandedDirectoriesByWorkspace.get(workspaceStateKey) ?? {});
    setChildEntriesByPath({});
    setChildLoadingByPath({});
    setChildErrorByPath({});
  }, [workspaceStateKey]);

  React.useEffect(() => {
    uploadRunRef.current += 1;
    dragDepthRef.current = 0;
    setDragActive(false);
    setUploading(false);
    setUploadError(null);
    setUploadStatus(null);
    setActionMode(null);
    setActionInput('');
    setActionTargetDirectory(normalizedPath);
    setActionLoading(false);
    actionRunRef.current = false;
    setActionError(null);
    setActionStatus(null);
    setSelectedPaths(new Set());
    setContextMenu(null);
    selectionAnchorRef.current = null;
  }, [droneId, normalizedPath]);

  React.useEffect(
    () => () => {
      uploadRunRef.current += 1;
    },
    [],
  );

  const explorerTree = React.useMemo(
    () =>
      buildFileExplorerTree({
        rootEntries: entries,
        childEntriesByPath,
      }),
    [childEntriesByPath, entries],
  );

  const visibleEntries = React.useMemo(() => {
    const out: DroneFsEntry[] = [];
    const visit = (nodes: FileExplorerNode[]) => {
      for (const node of nodes) {
        out.push(node.entry);
        if (node.kind === 'directory' && expandedDirs[node.path] === true && node.children) {
          visit(node.children);
        }
      }
    };
    visit(explorerTree);
    return out;
  }, [expandedDirs, explorerTree]);

  const selectedEntries = React.useMemo(() => selectedEntriesFromPaths(visibleEntries, selectedPaths), [selectedPaths, visibleEntries]);
  const actionEntries = React.useMemo(() => topLevelSelectedEntries(selectedEntries), [selectedEntries]);
  const selectedCount = selectedEntries.length;
  const selectedOne = selectedCount === 1 ? selectedEntries[0] ?? null : null;
  const busy = uploading || actionLoading;

  const openContextMenu = React.useCallback((x: number, y: number, entry: DroneFsEntry | null) => {
    const position = contextMenuPosition(x, y);
    setContextMenu({ ...position, entry });
  }, []);

  const ensureContextMenu = React.useCallback((entry: DroneFsEntry | null) => {
    setContextMenu((current) => {
      if (current) return { ...current, entry };
      const rect = explorerRef.current?.getBoundingClientRect();
      const position = contextMenuPosition((rect?.left ?? 0) + 12, (rect?.top ?? 0) + 12);
      return { ...position, entry };
    });
  }, []);

  const closeContextMenu = React.useCallback(() => {
    if (actionLoading) return;
    setContextMenu(null);
    setActionMode(null);
    setActionInput('');
  }, [actionLoading]);

  const selectEntryFromClick = React.useCallback(
    (entry: DroneFsEntry, event: React.MouseEvent<HTMLElement>) => {
      const additive = event.metaKey || event.ctrlKey;
      if (event.shiftKey && selectionAnchorRef.current) {
        const anchorIndex = visibleEntries.findIndex((visibleEntry) => visibleEntry.path === selectionAnchorRef.current);
        const entryIndex = visibleEntries.findIndex((visibleEntry) => visibleEntry.path === entry.path);
        if (anchorIndex >= 0 && entryIndex >= 0) {
          const start = Math.min(anchorIndex, entryIndex);
          const end = Math.max(anchorIndex, entryIndex);
          setSelectedPaths((previous) => {
            const next = additive ? new Set(previous) : new Set<string>();
            for (const visibleEntry of visibleEntries.slice(start, end + 1)) next.add(visibleEntry.path);
            return next;
          });
          return;
        }
      }

      selectionAnchorRef.current = entry.path;
      if (additive) {
        setSelectedPaths((previous) => toggleSelectedPath(previous, entry.path));
      } else {
        setSelectedPaths(new Set([entry.path]));
      }
    },
    [visibleEntries],
  );

  const loadDirectory = React.useCallback(
    async (dirPathRaw: string, opts?: { force?: boolean }) => {
      const dirPath = normalizeContainerPathInput(dirPathRaw);
      if (!dirPath || dirPath === normalizedPath) return;
      if (childLoadingByPath[dirPath]) return;
      const cacheKey = childDirectoryCacheKey(droneId, dirPath);
      const cached = opts?.force ? null : readChildDirectoryCache(cacheKey);
      if (!opts?.force && Object.prototype.hasOwnProperty.call(childEntriesByPath, dirPath) && !cached) return;
      if (cached) {
        setChildEntriesByPath((prev) => {
          if (sameFsEntries(prev[dirPath], cached)) return prev;
          return { ...prev, [dirPath]: cached };
        });
        setChildErrorByPath((prev) => {
          if (prev[dirPath] == null) return prev;
          return { ...prev, [dirPath]: null };
        });
      }

      const seq = (childRequestSeqRef.current[dirPath] ?? 0) + 1;
      childRequestSeqRef.current[dirPath] = seq;
      if (!cached) setChildLoadingByPath((prev) => ({ ...prev, [dirPath]: true }));
      setChildErrorByPath((prev) => ({ ...prev, [dirPath]: null }));

      try {
        const data = await requestJsonWithTimeout<DroneFsListPayload>(
          `/api/drones/${encodeURIComponent(droneId)}/fs/list?path=${encodeURIComponent(dirPath)}`,
          undefined,
          FS_LIST_REQUEST_TIMEOUT_MS,
        );
        if ((data as any)?.ok !== true) {
          throw new Error(String((data as any)?.error ?? 'filesystem request failed'));
        }
        if (childRequestSeqRef.current[dirPath] !== seq) return;
        const nextEntries = Array.isArray((data as any).entries) ? (((data as any).entries as DroneFsEntry[]) ?? []) : [];
        writeChildDirectoryCache(cacheKey, nextEntries);
        setChildEntriesByPath((prev) => {
          if (sameFsEntries(prev[dirPath], nextEntries)) return prev;
          return { ...prev, [dirPath]: nextEntries };
        });
        setChildErrorByPath((prev) => {
          if (prev[dirPath] == null) return prev;
          return { ...prev, [dirPath]: null };
        });
      } catch (e: any) {
        if (childRequestSeqRef.current[dirPath] !== seq) return;
        const msg = String(e?.message ?? e ?? 'failed to load directory').trim() || 'failed to load directory';
        setChildErrorByPath((prev) => ({ ...prev, [dirPath]: msg }));
      } finally {
        if (childRequestSeqRef.current[dirPath] !== seq) return;
        setChildLoadingByPath((prev) => {
          if (prev[dirPath] === false) return prev;
          return { ...prev, [dirPath]: false };
        });
      }
    },
    [childEntriesByPath, childLoadingByPath, droneId, normalizedPath],
  );

  const toggleDirectory = React.useCallback(
    (dirPath: string) => {
      const open = expandedDirs[dirPath] === true;
      const nextOpen = !open;
      setExpandedDirs((prev) => ({ ...prev, [dirPath]: nextOpen }));
      if (nextOpen) void loadDirectory(dirPath);
    },
    [expandedDirs, loadDirectory],
  );

  const refreshExplorer = React.useCallback(() => {
    clearChildDirectoryCacheForDrone(droneId);
    invalidateFsListCachesForDrone(droneId);
    onRefresh();
    onRefreshOpenedFile?.();
    const visibleExpandedDirs = Object.entries(expandedDirs)
      .filter(([, open]) => open)
      .map(([dirPath]) => dirPath);
    for (const dirPath of visibleExpandedDirs) {
      void loadDirectory(dirPath, { force: true });
    }
  }, [droneId, expandedDirs, loadDirectory, onRefresh, onRefreshOpenedFile]);

  const pathContainsActiveFile = React.useCallback(
    (entry: DroneFsEntry) => isPathInsideOrEqual(entry.path, activeOpenedFilePath),
    [activeOpenedFilePath],
  );

  const clearClipboardForChangedEntries = React.useCallback((changedEntries: DroneFsEntry[]) => {
    if (changedEntries.length === 0) return;
    setClipboard((prev) => {
      if (!prev) return prev;
      const hasChangedSource = prev.entries.some((clipEntry) =>
        changedEntries.some((changedEntry) => isPathInsideOrEqual(changedEntry.path, clipEntry.path)),
      );
      return hasChangedSource ? null : prev;
    });
  }, []);

  const refreshAfterMutation = React.useCallback(
    (message: string) => {
      setActionStatus(message);
      clearChildDirectoryCacheForDrone(droneId);
      invalidateFsListCachesForDrone(droneId);
      onRefresh();
      const visibleExpandedDirs = Object.entries(expandedDirs)
        .filter(([, open]) => open)
        .map(([dirPath]) => dirPath);
      for (const dirPath of visibleExpandedDirs) {
        void loadDirectory(dirPath, { force: true });
      }
    },
    [droneId, expandedDirs, loadDirectory, onRefresh],
  );

  const runAction = React.useCallback(
    async (label: string, task: () => Promise<void>) => {
      if (actionRunRef.current) return;
      actionRunRef.current = true;
      setActionLoading(true);
      setActionError(null);
      setActionStatus(`${label}...`);
      try {
        await task();
      } catch (e: any) {
        setActionError(String(e?.message ?? e ?? 'filesystem action failed'));
        setActionStatus(null);
      } finally {
        actionRunRef.current = false;
        setActionLoading(false);
      }
    },
    [],
  );

  const submitInlineAction = React.useCallback(() => {
    const value = actionInput.trim();
    if (actionLoading || !actionMode || !value) return;
    if (actionMode === 'go-to-path') {
      setActionMode(null);
      setActionInput('');
      setContextMenu(null);
      onOpenPath(normalizeContainerPathInput(value));
      return;
    }
    if (actionMode === 'create-file' || actionMode === 'create-directory') {
      void runAction(actionMode === 'create-file' ? 'Creating file' : 'Creating folder', async () => {
        const result = await runDroneFsAction(droneId, {
          action: actionMode,
          targetDir: actionTargetDirectory,
          name: value,
        });
        setActionMode(null);
        setActionInput('');
        setContextMenu(null);
        if (actionMode === 'create-file' && result.path) {
          onOpenFile({
            name: value,
            path: result.path,
            kind: 'file',
            size: 0,
            mtimeMs: null,
            ext: fileExtensionLower(value),
            isImage: false,
            isVideo: false,
          });
        }
        refreshAfterMutation(`${actionMode === 'create-file' ? 'Created file' : 'Created folder'} ${value}.`);
      });
      return;
    }
    if (actionMode === 'rename' && selectedOne) {
      const previous = selectedOne;
      if (previous.name === value) {
        setActionMode(null);
        setActionInput('');
        setContextMenu(null);
        return;
      }
      void runAction('Renaming', async () => {
        const result = await runDroneFsAction(droneId, {
          action: 'rename',
          path: previous.path,
          name: value,
        });
        const nextPath = result.targetPath ?? renamedPathForEntry(previous, value, previous.path);
        if (nextPath) onRemapOpenedFilesForPathChange?.(previous.path, nextPath);
        clearClipboardForChangedEntries([previous]);
        setSelectedPaths(new Set());
        setActionMode(null);
        setActionInput('');
        setContextMenu(null);
        refreshAfterMutation(`Renamed ${previous.name} to ${value}.`);
      });
      return;
    }
    if (actionMode === 'move' && selectedCount > 0) {
      const moving = [...actionEntries];
      void runAction('Moving', async () => {
        const result = await runDroneFsAction(droneId, {
          action: 'move',
          paths: moving.map((entry) => entry.path),
          targetDir: value,
        });
        const targetDir = result.targetDir ?? value;
        for (const entry of moving) {
          const nextPath = movedPathForEntry(entry, targetDir, entry.path);
          if (nextPath) onRemapOpenedFilesForPathChange?.(entry.path, nextPath);
        }
        clearClipboardForChangedEntries(moving);
        setSelectedPaths(new Set());
        setActionMode(null);
        setActionInput('');
        setContextMenu(null);
        refreshAfterMutation(`Moved ${moving.length} item${moving.length === 1 ? '' : 's'}.`);
      });
    }
  }, [
    actionInput,
    actionLoading,
    actionMode,
    actionTargetDirectory,
    droneId,
    clearClipboardForChangedEntries,
    normalizedPath,
    onOpenFile,
    onOpenPath,
    onRemapOpenedFilesForPathChange,
    refreshAfterMutation,
    runAction,
    actionEntries,
    selectedCount,
    selectedOne,
  ]);

  const beginCreate = React.useCallback(
    (mode: 'create-file' | 'create-directory', entry?: DroneFsEntry | null) => {
      const targetDirectory = entry
        ? entry.kind === 'directory'
          ? entry.path
          : parentFsPath(entry.path)
        : normalizedPath;
      setContextMenu(null);
      setActionMode(mode);
      setActionInput('');
      setActionTargetDirectory(targetDirectory);
      setActionError(null);
      setActionStatus(null);
      if (entry?.kind === 'directory') {
        setExpandedDirs((current) => ({ ...current, [entry.path]: true }));
        void loadDirectory(entry.path);
      }
    },
    [loadDirectory, normalizedPath, setExpandedDirs],
  );

  const beginRename = React.useCallback((entry?: DroneFsEntry) => {
    const target = entry ?? selectedOne;
    if (!target) return;
    setSelectedPaths(new Set([target.path]));
    selectionAnchorRef.current = target.path;
    setContextMenu(null);
    setActionMode('rename');
    setActionInput(target.name);
    setActionError(null);
    setActionStatus(null);
  }, [selectedOne]);

  const cancelInlineNameAction = React.useCallback(() => {
    if (actionLoading) return;
    setActionMode(null);
    setActionInput('');
    setActionTargetDirectory(normalizedPath);
    setActionError(null);
    setActionStatus(null);
  }, [actionLoading, normalizedPath]);

  const beginMove = React.useCallback(() => {
    if (selectedCount === 0) return;
    ensureContextMenu(selectedOne);
    setActionMode('move');
    setActionInput(normalizedPath);
    setActionError(null);
    setActionStatus(null);
  }, [ensureContextMenu, normalizedPath, selectedCount, selectedOne]);

  const beginGoToPath = React.useCallback(() => {
    ensureContextMenu(null);
    setActionMode('go-to-path');
    setActionInput(normalizedPath);
    setActionError(null);
    setActionStatus(null);
  }, [ensureContextMenu, normalizedPath]);

  const deleteEntries = React.useCallback(
    (entriesToDelete: DroneFsEntry[]) => {
      if (entriesToDelete.length === 0) return;
      const preview = entriesToDelete.slice(0, 4).map((entry) => entry.name).join(', ');
      const suffix = entriesToDelete.length > 4 ? `, and ${entriesToDelete.length - 4} more` : '';
      const confirmed = window.confirm(`Delete ${entriesToDelete.length} item${entriesToDelete.length === 1 ? '' : 's'}?\n\n${preview}${suffix}`);
      if (!confirmed) return;
      const paths = entriesToDelete.map((entry) => entry.path);
      if (onConfirmCloseOpenedFilesForPaths && !onConfirmCloseOpenedFilesForPaths(paths, 'Delete selected item')) return;
      void runAction('Deleting', async () => {
        await runDroneFsAction(droneId, {
          action: 'delete',
          paths,
        });
        if (onCloseOpenedFilesForPaths) {
          onCloseOpenedFilesForPaths(paths);
        } else if (activeOpenedFilePath && entriesToDelete.some(pathContainsActiveFile)) {
          onCloseOpenedFile?.();
        }
        clearClipboardForChangedEntries(entriesToDelete);
        setSelectedPaths(new Set());
        refreshAfterMutation(`Deleted ${entriesToDelete.length} item${entriesToDelete.length === 1 ? '' : 's'}.`);
      });
    },
    [
      activeOpenedFilePath,
      clearClipboardForChangedEntries,
      droneId,
      onCloseOpenedFile,
      onCloseOpenedFilesForPaths,
      onConfirmCloseOpenedFilesForPaths,
      pathContainsActiveFile,
      refreshAfterMutation,
      runAction,
    ],
  );

  const copySelected = React.useCallback(() => {
    if (actionEntries.length === 0) return;
    setClipboard({ entries: actionEntries });
    setActionStatus(`Copied ${actionEntries.length} item${actionEntries.length === 1 ? '' : 's'} for paste.`);
    setActionError(null);
  }, [actionEntries]);

  const pasteClipboard = React.useCallback(() => {
    if (!clipboard || clipboard.entries.length === 0) return;
    void runAction('Pasting', async () => {
      await runDroneFsAction(droneId, {
        action: 'copy',
        paths: clipboard.entries.map((entry) => entry.path),
        targetDir: normalizedPath,
      });
      refreshAfterMutation(`Pasted ${clipboard.entries.length} item${clipboard.entries.length === 1 ? '' : 's'}.`);
    });
  }, [clipboard, droneId, normalizedPath, refreshAfterMutation, runAction]);

  React.useEffect(() => {
    setSelectedPaths((prev) => pruneSelectedPaths(prev, visibleEntries));
  }, [visibleEntries]);

  const uploadFilesToCurrentPath = React.useCallback(
    async (dropped: FileList | File[] | null | undefined) => {
      const files = Array.from(dropped ?? []);
      if (files.length === 0) return;
      const runId = uploadRunRef.current + 1;
      uploadRunRef.current = runId;
      setUploadError(null);
      setUploading(true);
      setUploadStatus(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}...`);

      let uploaded = 0;
      const failures: string[] = [];
      for (const file of files) {
        try {
          await requestJson<Extract<DroneFsUploadPayload, { ok: true }>>(
            `/api/drones/${encodeURIComponent(droneId)}/fs/upload?path=${encodeURIComponent(normalizedPath)}&name=${encodeURIComponent(file.name)}`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/octet-stream' },
              body: file,
            },
          );
          uploaded += 1;
          if (uploadRunRef.current === runId) {
            setUploadStatus(`Uploading ${uploaded}/${files.length}...`);
          }
        } catch (e: any) {
          const status = Number(e?.status ?? 0);
          let reason = String(e?.message ?? e ?? '').trim() || 'upload failed';
          if (status === 413 && !/settings/i.test(reason)) {
            reason = `${reason} Increase "Upload max file size" in Settings.`;
          }
          failures.push(`${file.name}: ${reason}`);
        }
      }

      if (uploadRunRef.current !== runId) return;
      setUploading(false);
      if (uploaded > 0) refreshExplorer();
      if (failures.length === 0) {
        setUploadError(null);
        setUploadStatus(`Uploaded ${uploaded} file${uploaded === 1 ? '' : 's'} to ${normalizedPath}.`);
        return;
      }

      const failureText =
        failures.length === 1
          ? failures[0]
          : `${failures.length} uploads failed: ${failures.slice(0, 3).join(' • ')}${failures.length > 3 ? ' • ...' : ''}`;
      setUploadError(failureText);
      setUploadStatus(uploaded > 0 ? `Uploaded ${uploaded}/${files.length}.` : null);
    },
    [droneId, normalizedPath, refreshExplorer],
  );

  const onPanelDragEnter = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasFileDragPayload(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      if (!dragActive) setDragActive(true);
    },
    [dragActive],
  );

  const onPanelDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileDragPayload(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onPanelDragLeave = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!dragActive) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    },
    [dragActive],
  );

  const onPanelDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasFileDragPayload(event) && (event.dataTransfer?.files?.length ?? 0) <= 0) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      if (uploading) return;
      void uploadFilesToCurrentPath(event.dataTransfer?.files ?? null);
    },
    [uploadFilesToCurrentPath, uploading],
  );

  const downloadEntry = React.useCallback(
    (entry: DroneFsEntry) => {
      if (entry.kind !== 'file' && entry.kind !== 'directory') return;
      const href = `/api/drones/${encodeURIComponent(droneId)}/fs/download?path=${encodeURIComponent(entry.path)}`;
      const link = document.createElement('a');
      link.href = href;
      link.rel = 'noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    [droneId],
  );

  const openFileEntry = React.useCallback(
    (entry: DroneFsEntry) => {
      if (entry.kind !== 'file') return;
      if (onOpenFileInPanel?.(entry)) return;
      onOpenFile(entry);
    },
    [onOpenFile, onOpenFileInPanel],
  );

  const activateEntry = React.useCallback(
    (entry: DroneFsEntry, event: React.MouseEvent<HTMLElement>) => {
      selectEntryFromClick(entry, event);
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (entry.kind === 'directory') {
        toggleDirectory(entry.path);
      } else if (entry.kind === 'file') {
        openFileEntry(entry);
      }
    },
    [openFileEntry, selectEntryFromClick, toggleDirectory],
  );

  const openEntryContextMenu = React.useCallback(
    (entry: DroneFsEntry, event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!selectedPaths.has(entry.path)) {
        setSelectedPaths(new Set([entry.path]));
        selectionAnchorRef.current = entry.path;
      }
      openContextMenu(event.clientX, event.clientY, entry);
    },
    [openContextMenu, selectedPaths],
  );

  const inlineNameMode =
    actionMode === 'create-file' || actionMode === 'create-directory' || actionMode === 'rename'
      ? actionMode
      : null;
  const contextActionMode =
    actionMode === 'move' || actionMode === 'go-to-path' ? actionMode : null;

  function renderInlineCreateRow(): React.ReactNode {
    if (inlineNameMode !== 'create-file' && inlineNameMode !== 'create-directory') return null;
    const creatingDirectory = inlineNameMode === 'create-directory';
    return (
      <div
        role="treeitem"
        aria-selected="true"
        className="relative flex w-full items-center gap-1 bg-[var(--info-subtle)] pr-1 text-left text-[var(--fg)] shadow-[inset_2px_0_0_var(--accent)]"
        style={{ ...explorerRowGeometryStyle, paddingLeft: `${explorerIndentPx}px` }}
      >
        <span className="inline-flex flex-shrink-0 items-center justify-center text-[var(--muted)]" style={explorerIconSlotStyle}>
          {creatingDirectory ? (
            <IconChevron down={false} size={explorerChevronPx} />
          ) : (
            <FileTypeIcon path={actionInput || 'untitled'} size={explorerFileIconPx} />
          )}
        </span>
        <InlineExplorerNameInput
          value={actionInput}
          mode={inlineNameMode}
          loading={actionLoading}
          zoom={explorerZoom}
          onChange={setActionInput}
          onSubmit={submitInlineAction}
          onCancel={cancelInlineNameAction}
        />
      </div>
    );
  }

  function renderExplorer(nodes: FileExplorerNode[]): React.ReactNode {
    return nodes.map((node) => {
      const indentPx = explorerIndentPx;
      if (node.kind === 'directory') {
        const open = expandedDirs[node.path] === true;
        const ignored = node.entry.isGitIgnored === true;
        const childLoading = childLoadingByPath[node.path] === true;
        const childError = childErrorByPath[node.path];
        const childLoaded = Object.prototype.hasOwnProperty.call(childEntriesByPath, node.path);
        const title = `${node.path}${childLoaded && node.count != null ? ` • ${node.count} item${node.count === 1 ? '' : 's'}` : ''}`;
        const selected = selectedPaths.has(node.path);
        const renaming = inlineNameMode === 'rename' && selectedOne?.path === node.path;
        const creatingInside =
          (inlineNameMode === 'create-file' || inlineNameMode === 'create-directory') &&
          actionTargetDirectory === node.path;
        const hasSelectedDescendant = Array.from(selectedPaths).some(
          (selectedPath) => selectedPath !== node.path && isPathInsideOrEqual(node.path, selectedPath),
        );

        return (
          <div
            key={`dir:${node.path}`}
            role="none"
            data-file-explorer-directory={node.path}
            className="flex flex-col"
          >
            <div className="relative w-full">
              {renaming ? (
                <div
                  role="treeitem"
                  aria-expanded={open}
                  aria-selected="true"
                  className="relative flex w-full items-center gap-1 bg-[var(--info-subtle)] pr-1 text-left text-[var(--fg)] shadow-[inset_2px_0_0_var(--accent)]"
                  style={{ ...explorerRowGeometryStyle, paddingLeft: `${indentPx}px` }}
                >
                  <span className="inline-flex flex-shrink-0 items-center justify-center text-[var(--muted)]" style={explorerIconSlotStyle}>
                    <IconChevron down={open} size={explorerChevronPx} />
                  </span>
                  <InlineExplorerNameInput
                    value={actionInput}
                    mode="rename"
                    loading={actionLoading}
                    zoom={explorerZoom}
                    onChange={setActionInput}
                    onSubmit={submitInlineAction}
                    onCancel={cancelInlineNameAction}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  role="treeitem"
                  aria-expanded={open}
                  aria-selected={selected}
                  disabled={busy}
                  onClick={(event) => activateEntry(node.entry, event)}
                  onContextMenu={(event) => openEntryContextMenu(node.entry, event)}
                  className={`relative flex w-full items-center gap-1 pr-1 text-left transition-colors disabled:opacity-60 ${
                    selected
                      ? 'bg-[var(--info-subtle)] text-[var(--fg)] shadow-[inset_2px_0_0_var(--accent)] hover:bg-[var(--selected)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-muted)]'
                      : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-muted)]'
                  }`}
                  style={{ ...explorerRowGeometryStyle, paddingLeft: `${indentPx}px` }}
                  title={`${title}${ignored ? ' • Ignored by Git' : ''} • Click to ${open ? 'collapse' : 'expand'} • Right-click for actions`}
                >
                  <span className={`inline-flex flex-shrink-0 items-center justify-center text-[var(--muted)] ${ignored ? 'opacity-50' : ''}`} style={explorerIconSlotStyle}>
                    <IconChevron down={open} size={explorerChevronPx} />
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${ignored ? 'text-[var(--muted-dim)] opacity-60' : ''}`}>
                    {node.name}
                  </span>
                  {childError ? <span className="px-1 text-[var(--text-9)] uppercase text-[var(--red)]">Error</span> : null}
                  {childLoading ? (
                    <span className="inline-flex items-center gap-1 px-1 text-[var(--text-9)] uppercase text-[var(--accent)]">
                      <InlineSpinner />
                      Loading
                    </span>
                  ) : null}
                </button>
              )}
            </div>
            {open ? (
              <div
                role="group"
                className="dh-file-explorer-directory-body flex flex-col border-l"
                style={{ marginLeft: `${explorerGuideOffsetPx}px` }}
                data-file-explorer-guide-selected={hasSelectedDescendant ? 'true' : undefined}
              >
                {creatingInside ? renderInlineCreateRow() : null}
                {childError ? (
                  <div className="my-0.5 px-2 py-1 text-[var(--text-10)] text-[var(--red)]">
                    {childError}
                  </div>
                ) : null}
                {childLoading && !childLoaded ? (
                  <div className="my-0.5 px-2 py-1 text-[var(--text-10)] text-[var(--muted)]">
                    Loading directory...
                  </div>
                ) : null}
                {childLoaded && node.children && node.children.length > 0 ? renderExplorer(node.children) : null}
                {childLoaded && !creatingInside && (!node.children || node.children.length === 0) ? (
                  <div className="my-0.5 px-2 py-1 text-[var(--text-10)] text-[var(--muted)]">
                    Directory is empty.
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      }

      const entry = node.entry;
      const active = activeOpenedFilePath === entry.path;
      const ignored = entry.isGitIgnored === true;
      const selected = selectedPaths.has(entry.path);
      const modified = formatLocalDateTime(entry.mtimeMs);
      const openable = entry.kind === 'file';
      const renaming = inlineNameMode === 'rename' && selectedOne?.path === entry.path;
      return (
        <div key={`file:${entry.path}`} role="none" className="relative w-full">
          {renaming ? (
            <div
              role="treeitem"
              aria-selected="true"
              className="relative flex w-full items-center gap-1 bg-[var(--info-subtle)] pr-1 text-left text-[var(--fg)] shadow-[inset_2px_0_0_var(--accent)]"
              style={{ ...explorerRowGeometryStyle, paddingLeft: `${indentPx}px` }}
            >
              <span className="inline-flex flex-shrink-0 items-center justify-center text-[var(--muted)]" style={explorerIconSlotStyle}>
                <FileTypeIcon path={actionInput || entry.path} size={explorerFileIconPx} />
              </span>
              <InlineExplorerNameInput
                value={actionInput}
                mode="rename"
                loading={actionLoading}
                zoom={explorerZoom}
                onChange={setActionInput}
                onSubmit={submitInlineAction}
                onCancel={cancelInlineNameAction}
              />
            </div>
          ) : (
            <button
              type="button"
              role="treeitem"
              aria-selected={selected}
              disabled={busy}
              onClick={(event) => activateEntry(entry, event)}
              onContextMenu={(event) => openEntryContextMenu(entry, event)}
              className={`relative flex w-full items-center gap-1 pr-1 text-left transition-colors disabled:opacity-60 ${
                selected
                  ? 'bg-[var(--info-subtle)] text-[var(--fg)] shadow-[inset_2px_0_0_var(--accent)] hover:bg-[var(--selected)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-muted)]'
                  : active
                    ? 'bg-[var(--surface-soft)] text-[var(--fg)] hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-muted)]'
                    : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-muted)]'
              }`}
              style={{ ...explorerRowGeometryStyle, paddingLeft: `${indentPx}px` }}
              title={`${entry.path} • ${modified}${ignored ? ' • Ignored by Git' : ''} • Right-click for actions`}
            >
              <span className={`inline-flex flex-shrink-0 items-center justify-center text-[var(--muted)] ${ignored ? 'opacity-50' : openable ? '' : 'opacity-70'}`} style={explorerIconSlotStyle}>
                <FileTypeIcon path={entry.path} size={explorerFileIconPx} />
              </span>
              <span className={`min-w-0 flex-1 truncate ${ignored ? 'text-[var(--muted-dim)] opacity-60' : openable ? '' : 'opacity-70'}`}>
                {node.name}
              </span>
            </button>
          )}
        </div>
      );
    });
  }

  const handleExplorerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.target instanceof HTMLElement && event.target.closest('[role="menu"]')) return;
    const commandKey = event.metaKey || event.ctrlKey;
    if (commandKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelectedPaths((previous) => setAllVisibleSelected(visibleEntries, previous, true));
      return;
    }
    if (!readOnly && commandKey && event.key.toLowerCase() === 'c' && selectedCount > 0) {
      event.preventDefault();
      copySelected();
      return;
    }
    if (!readOnly && commandKey && event.key.toLowerCase() === 'v' && clipboard) {
      event.preventDefault();
      pasteClipboard();
      return;
    }
    if (!readOnly && event.key === 'F2' && selectedOne) {
      event.preventDefault();
      beginRename();
      return;
    }
    if (!readOnly && event.key === 'Delete' && selectedCount > 0) {
      event.preventDefault();
      deleteEntries(actionEntries);
      return;
    }
    if (event.key === 'Escape' && selectedCount > 0) {
      setSelectedPaths(new Set());
      selectionAnchorRef.current = null;
    }
  };

  const showStartupPlaceholder = Boolean(startup?.waiting) && !error && entries.length === 0;
  const startupLabel = startup?.hubPhase === 'seeding' ? 'Seeding' : 'Starting';
  const startupDetail = String(startup?.hubMessage ?? '').trim();
  const startupText = startup?.timedOut
    ? 'Still waiting for the filesystem to come online. If this keeps happening, the drone may be stuck provisioning.'
    : 'Waiting for filesystem…';
  return (
    <UiPanel
      ref={explorerRef}
      flush
      surface="alternate"
      className={`relative h-full w-full ${
        dragActive ? 'ring-1 ring-inset ring-[var(--accent-muted)]' : ''
      }`}
      onDragEnter={readOnly ? undefined : onPanelDragEnter}
      onDragOver={readOnly ? undefined : onPanelDragOver}
      onDragLeave={readOnly ? undefined : onPanelDragLeave}
      onDrop={readOnly ? undefined : onPanelDrop}
      onKeyDown={handleExplorerKeyDown}
    >
      {uploadStatus ? (
        <UiPanelStatusStrip tone="info">{uploadStatus}</UiPanelStatusStrip>
      ) : null}
      {actionStatus ? (
        <UiPanelStatusStrip tone="info">{actionStatus}</UiPanelStatusStrip>
      ) : null}
      {actionError ? (
        <UiPanelStatusStrip tone="danger">{actionError}</UiPanelStatusStrip>
      ) : null}
      {uploadError ? (
        <UiPanelStatusStrip tone="danger">{uploadError}</UiPanelStatusStrip>
      ) : null}
      {error ? (
        <UiPanelStatusStrip tone="danger">{error}</UiPanelStatusStrip>
      ) : null}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="w-full bg-[var(--panel)] flex flex-col">
          <div
            className="relative flex-1 min-h-0 overflow-auto py-1 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-muted)]"
            role="tree"
            aria-label="File Explorer"
            aria-multiselectable="true"
            tabIndex={0}
            onClick={(event) => {
              if (event.target !== event.currentTarget) return;
              setSelectedPaths(new Set());
              selectionAnchorRef.current = null;
            }}
            onContextMenu={(event) => {
              if (event.defaultPrevented) return;
              event.preventDefault();
              openContextMenu(event.clientX, event.clientY, null);
            }}
          >
            {showStartupPlaceholder && !startup?.timedOut ? (
              <div className="absolute inset-0" role="treeitem">
                <UiCenteredLoadingState
                  message={startupLabel}
                  description={[startupText, startupDetail].filter(Boolean).join(' ')}
                />
              </div>
            ) : showStartupPlaceholder ? (
              <UiPaneState
                kind="warning"
                title={startupLabel}
                description={[startupText, startupDetail].filter(Boolean).join(' ')}
                compact
                role="treeitem"
              />
            ) : !error && loading && explorerTree.length === 0 ? (
              <div className="absolute inset-0" role="treeitem">
                <UiCenteredLoadingState message="Loading files…" />
              </div>
            ) : !error && !loading && explorerTree.length === 0 && !inlineNameMode ? (
              <UiPaneState
                kind="empty"
                title="Directory is empty"
                description={readOnly ? undefined : 'Right-click to create a file or folder.'}
                compact
                role="treeitem"
              />
            ) : (
              <>
                {actionTargetDirectory === normalizedPath ? renderInlineCreateRow() : null}
                {renderExplorer(explorerTree)}
              </>
            )}
          </div>
        </div>
      </div>

      {contextMenu ? (
        <DroneFilesContextMenu
          menu={contextMenu}
          busy={busy}
          selectedCount={selectedCount}
          clipboardCount={clipboard?.entries.length ?? 0}
          actionMode={contextActionMode}
          actionInput={actionInput}
          actionLoading={actionLoading}
          readOnly={readOnly}
          onOpen={() => {
            const entry = contextMenu.entry;
            if (entry?.kind === 'directory') toggleDirectory(entry.path);
            if (entry?.kind === 'file') openFileEntry(entry);
            setContextMenu(null);
          }}
          onCreate={(mode) => beginCreate(mode, contextMenu.entry)}
          onRename={() => beginRename()}
          onDelete={() => {
            setContextMenu(null);
            deleteEntries(actionEntries);
          }}
          onMove={beginMove}
          onCopy={() => {
            copySelected();
            setContextMenu(null);
          }}
          onPaste={() => {
            pasteClipboard();
            setContextMenu(null);
          }}
          onDownload={() => {
            if (contextMenu.entry) downloadEntry(contextMenu.entry);
            setContextMenu(null);
          }}
          onRefresh={() => {
            refreshExplorer();
            setContextMenu(null);
          }}
          onGoToPath={beginGoToPath}
          onActionInputChange={setActionInput}
          onSubmitAction={submitInlineAction}
          onClose={closeContextMenu}
        />
      ) : null}

      {dragActive ? (
        <div className="pointer-events-none absolute inset-0 z-30 px-3 py-3">
          <div className="w-full h-full rounded-[var(--radius-medium)] border-2 border-dashed border-[var(--accent-muted)] bg-[var(--panel-overlay-soft)] flex items-center justify-center text-center px-4">
            <div className="text-[var(--text-12)] text-[var(--fg-secondary)]">
              Drop files to upload into
              <div className="mt-1 font-mono text-[var(--text-11)] text-[var(--accent)] break-all">{normalizedPath}</div>
            </div>
          </div>
        </div>
      ) : null}
    </UiPanel>
  );
}
