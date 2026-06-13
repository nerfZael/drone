import React from 'react';
import { IconPencil } from '../app/icons';
import { formatBytes } from '../app/selected-drone-workspace-utils';
import { requestJson } from '../http';
import { IconChevron, iconForFilePath } from '../icons';
import type { DroneFsEntry, DroneFsListPayload, DroneFsUploadPayload } from '../types';
import { OpenedDroneFilePanel } from './OpenedDroneFilePanel';
import type { DroneOpenedFileState } from './opened-file-types';
import { buildFileExplorerTree, type FileExplorerNode } from './tree';

const CHILD_DIRECTORY_CACHE_MAX_AGE_MS = 5 * 60_000;

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

function normalizeContainerPathInput(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
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

function IconDownload({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8.75 1.5a.75.75 0 00-1.5 0v6.19L5.53 5.97a.75.75 0 10-1.06 1.06l3 3a.75.75 0 001.06 0l3-3a.75.75 0 00-1.06-1.06L8.75 7.69V1.5zM2 10.75A1.75 1.75 0 013.75 9h8.5A1.75 1.75 0 0114 10.75v1.5A1.75 1.75 0 0112.25 14h-8.5A1.75 1.75 0 012 12.25v-1.5zm1.75-.25a.25.25 0 00-.25.25v1.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25v-1.5a.25.25 0 00-.25-.25h-8.5z" />
    </svg>
  );
}

export function DroneFilesDock({
  droneId,
  droneName,
  droneLabel,
  path,
  homePath: _homePath,
  entries,
  loading,
  error,
  startup,
  viewMode: _viewMode,
  onSetViewMode: _onSetViewMode,
  onOpenPath,
  onOpenFile,
  onOpenFileInPanel,
  onOpenFileTarget,
  onRefresh,
  onRefreshOpenedFile,
  openedFile,
  onOpenedFileContentChange,
  onSaveOpenedFile,
  onCloseOpenedFile,
}: {
  droneId: string;
  droneName: string;
  droneLabel?: string;
  path: string;
  homePath: string;
  entries: DroneFsEntry[];
  loading: boolean;
  error: string | null;
  startup?: { waiting: boolean; timedOut: boolean; hubPhase?: 'creating' | 'starting' | 'seeding' | 'error' | null; hubMessage?: string | null } | null;
  viewMode: 'list' | 'thumb';
  onSetViewMode: (next: 'list' | 'thumb') => void;
  onOpenPath: (nextPath: string) => void;
  onOpenFile: (entry: DroneFsEntry) => void;
  onOpenFileInPanel?: (entry: DroneFsEntry) => boolean;
  onOpenFileTarget?: (next: { path: string; name: string; line?: number | null; column?: number | null }) => void;
  onRefresh: () => void;
  onRefreshOpenedFile?: () => void;
  openedFile: DroneOpenedFileState;
  onOpenedFileContentChange?: (next: string) => void;
  onSaveOpenedFile?: (contentOverride?: string) => Promise<boolean>;
  onCloseOpenedFile?: () => void;
}) {
  const shownName = String(droneLabel ?? droneName).trim() || droneName;
  const normalizedPath = normalizeContainerPathInput(path);
  const activeOpenedFilePath = String(openedFile.path ?? '').trim();
  const [pathInput, setPathInput] = React.useState(normalizedPath);
  const [pathEntryOpen, setPathEntryOpen] = React.useState(false);
  const [expandedDirs, setExpandedDirs] = React.useState<Record<string, boolean>>({});
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

  React.useEffect(() => {
    setPathInput(normalizedPath);
  }, [normalizedPath]);

  React.useEffect(() => {
    setExpandedDirs({});
    setChildEntriesByPath({});
    setChildLoadingByPath({});
    setChildErrorByPath({});
  }, [droneId, normalizedPath]);

  React.useEffect(() => {
    uploadRunRef.current += 1;
    dragDepthRef.current = 0;
    setDragActive(false);
    setUploading(false);
    setUploadError(null);
    setUploadStatus(null);
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

  const crumbs = React.useMemo(() => {
    if (normalizedPath === '/') return [{ label: '/', path: '/' }];
    const out: Array<{ label: string; path: string }> = [{ label: '/', path: '/' }];
    const segs = normalizedPath.split('/').filter(Boolean);
    let current = '';
    for (const seg of segs) {
      current += `/${seg}`;
      out.push({ label: seg, path: current });
    }
    return out;
  }, [normalizedPath]);

  const submitPath = React.useCallback(() => {
    setPathEntryOpen(false);
    onOpenPath(normalizeContainerPathInput(pathInput));
  }, [onOpenPath, pathInput]);

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
        const data = await requestJson<DroneFsListPayload>(
          `/api/drones/${encodeURIComponent(droneId)}/fs/list?path=${encodeURIComponent(dirPath)}`,
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
    onRefresh();
    onRefreshOpenedFile?.();
    const visibleExpandedDirs = Object.entries(expandedDirs)
      .filter(([, open]) => open)
      .map(([dirPath]) => dirPath);
    for (const dirPath of visibleExpandedDirs) {
      void loadDirectory(dirPath, { force: true });
    }
  }, [expandedDirs, loadDirectory, onRefresh, onRefreshOpenedFile]);

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

  const openResolvedFile = React.useCallback(
    (next: { path: string; name: string; line?: number | null; column?: number | null }) => {
      if (onOpenFileTarget) {
        onOpenFileTarget(next);
        return;
      }
      onOpenFile({
        name: next.name,
        path: next.path,
        kind: 'file',
        size: null,
        mtimeMs: null,
        ext: null,
        isImage: false,
        isVideo: false,
      });
    },
    [onOpenFile, onOpenFileTarget],
  );

  const openFileEntry = React.useCallback(
    (entry: DroneFsEntry) => {
      if (entry.kind !== 'file') return;
      if (onOpenFileInPanel?.(entry)) return;
      onOpenFile(entry);
    },
    [onOpenFile, onOpenFileInPanel],
  );

  const renderDownloadButton = React.useCallback(
    (entry: DroneFsEntry, className: string) => {
      if (entry.kind !== 'directory' && entry.kind !== 'file') return null;
      return (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            downloadEntry(entry);
          }}
          className={className}
          title={`Download ${entry.kind === 'directory' ? 'directory' : 'file'}`}
        >
          <IconDownload className="opacity-80" />
        </button>
      );
    },
    [downloadEntry],
  );

  const actionButtonClassName =
    'w-6 h-6 rounded border border-[var(--border-subtle)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] flex items-center justify-center';

  function renderExplorer(nodes: FileExplorerNode[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      const indentPx = 8 + depth * 12;
      if (node.kind === 'directory') {
        const open = expandedDirs[node.path] === true;
        const childLoading = childLoadingByPath[node.path] === true;
        const childError = childErrorByPath[node.path];
        const childLoaded = Object.prototype.hasOwnProperty.call(childEntriesByPath, node.path);
        const title = `${node.path}${childLoaded && node.count != null ? ` • ${node.count} item${node.count === 1 ? '' : 's'}` : ''}`;

        return (
          <React.Fragment key={`dir:${node.path}`}>
            <div className="w-full group/dir" style={{ paddingLeft: `${indentPx}px` }}>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleDirectory(node.path)}
                  className={`flex-1 min-w-0 text-left px-1 rounded border transition-all flex items-center gap-0.5 ${
                    open
                      ? 'border-transparent bg-[rgba(255,255,255,.04)]'
                      : 'border-transparent hover:bg-[var(--hover)]'
                  }`}
                  style={{
                    minHeight: '28px',
                  }}
                  title={`${title} • Click to ${open ? 'collapse' : 'expand'}`}
                >
                  <span className="inline-flex items-center justify-center w-4 h-4 flex-shrink-0 text-[var(--muted-dim)]">
                    <IconChevron down={open} size={12} />
                  </span>
                  <span className="truncate flex-1 text-[var(--fg-secondary)] text-[11px]">{node.name}</span>
                  {childError ? (
                    <span
                      className="inline-flex items-center justify-center rounded border px-1 text-[8px] uppercase tracking-wide text-[var(--red)] border-[rgba(248,81,73,.22)] bg-[var(--red-subtle)]"
                      title={childError}
                    >
                      Error
                    </span>
                  ) : null}
                  {childLoading ? (
                    <span
                      className="inline-flex items-center gap-1 rounded border px-1 text-[8px] uppercase tracking-wide text-[var(--accent)] border-[var(--accent-muted)] bg-[var(--accent-subtle)]"
                      title={`Loading ${node.path}`}
                    >
                      <InlineSpinner />
                      Loading
                    </span>
                  ) : null}
                  {node.count != null ? <span className="text-[10px] text-[var(--muted-dim)] tabular-nums">{node.count}</span> : null}
                </button>
                {renderDownloadButton(
                  node.entry,
                  `${actionButtonClassName} opacity-0 group-hover/dir:opacity-100 focus:opacity-100 transition-opacity`,
                )}
              </div>
            </div>
            {open ? (
              <>
                {childError ? (
                  <div className="ml-7 mt-1 mb-1 rounded border border-[rgba(248,81,73,.18)] bg-[var(--red-subtle)] px-2 py-1 text-[10px] text-[var(--red)]">
                    {childError}
                  </div>
                ) : null}
                {childLoading && !childLoaded ? (
                  <div className="ml-7 mt-1 mb-1 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 py-1 text-[10px] text-[var(--muted)]">
                    Loading directory...
                  </div>
                ) : null}
                {childLoaded && node.children && node.children.length > 0 ? renderExplorer(node.children, depth + 1) : null}
                {childLoaded && (!node.children || node.children.length === 0) ? (
                  <div className="ml-7 mt-1 mb-1 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 py-1 text-[10px] text-[var(--muted)]">
                    Directory is empty.
                  </div>
                ) : null}
              </>
            ) : null}
          </React.Fragment>
        );
      }

      const entry = node.entry;
      const active = activeOpenedFilePath === entry.path;
      const FileIcon = iconForFilePath(entry.path);
      const modified = formatLocalDateTime(entry.mtimeMs);
      const openable = entry.kind === 'file';
      return (
        <div key={`file:${entry.path}`} className="w-full group/file" style={{ paddingLeft: `${indentPx}px` }}>
          <div className="flex items-center gap-1">
            {openable ? (
              <button
                type="button"
                onClick={() => openFileEntry(entry)}
                className={`flex-1 min-w-0 text-left px-1 rounded border transition-all flex items-center gap-0.5 ${
                  active
                    ? 'border-transparent bg-[rgba(255,255,255,.04)]'
                    : 'border-transparent hover:bg-[var(--hover)]'
                }`}
                style={{
                  minHeight: '28px',
                }}
                title={`${entry.path} • ${modified}`}
              >
                <span className="inline-flex items-center justify-center w-4 h-4 flex-shrink-0 text-[var(--muted-dim)]">
                  <FileIcon size={12} />
                </span>
                <span className="truncate flex-1 text-[var(--fg-secondary)] text-[11px]">{node.name}</span>
                <span className="text-[10px] text-[var(--muted-dim)] tabular-nums">
                  {entry.kind === 'file' ? formatBytes(entry.size) : '-'}
                </span>
              </button>
            ) : (
              <div
                className="flex-1 min-w-0 text-left px-1 rounded border border-transparent flex items-center gap-0.5 opacity-70"
                style={{
                  minHeight: '28px',
                }}
                title={`${entry.path} • ${modified}`}
              >
                <span className="inline-flex items-center justify-center w-4 h-4 flex-shrink-0 text-[var(--muted-dim)]">
                  <FileIcon size={12} />
                </span>
                <span className="truncate flex-1 text-[var(--fg-secondary)] text-[11px]">{node.name}</span>
                <span className="text-[10px] text-[var(--muted-dim)] tabular-nums">-</span>
              </div>
            )}
            {openable ? (
              <button
                type="button"
                onClick={() => openFileEntry(entry)}
                className={`${actionButtonClassName} opacity-0 group-hover/file:opacity-100 focus:opacity-100 transition-opacity`}
                title={`Open ${entry.path}`}
              >
                <IconPencil className="w-3 h-3" />
              </button>
            ) : null}
            {renderDownloadButton(
              entry,
              `${actionButtonClassName} opacity-0 group-hover/file:opacity-100 focus:opacity-100 transition-opacity`,
            )}
          </div>
        </div>
      );
    });
  }

  const showStartupPlaceholder = Boolean(startup?.waiting) && !error && entries.length === 0;
  const hasOpenedFile = activeOpenedFilePath.length > 0;
  const startupLabel = startup?.hubPhase === 'seeding' ? 'Seeding' : 'Starting';
  const startupDetail = String(startup?.hubMessage ?? '').trim();
  const startupText = startup?.timedOut
    ? 'Still waiting for the filesystem to come online. If this keeps happening, the drone may be stuck provisioning.'
    : 'Waiting for filesystem…';
  return (
    <div
      className={`w-full h-full min-h-0 bg-[var(--panel-alt)] overflow-hidden flex flex-col relative ${
        dragActive ? 'ring-1 ring-inset ring-[var(--accent-muted)]' : ''
      }`}
      onDragEnter={onPanelDragEnter}
      onDragOver={onPanelDragOver}
      onDragLeave={onPanelDragLeave}
      onDrop={onPanelDrop}
    >
      <div className="px-2.5 py-2 border-b border-[var(--border-subtle)] flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {pathEntryOpen ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitPath();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setPathInput(normalizedPath);
                    setPathEntryOpen(false);
                  }
                }}
                autoFocus
                className="flex-1 min-w-0 h-7 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] px-2 text-[11px] text-[var(--fg-secondary)] focus:outline-none"
                title={`Container path for ${shownName}`}
              />
              <button
                type="button"
                onClick={submitPath}
                className="h-7 px-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
                title="Go to path"
              >
                Go
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto whitespace-nowrap text-[11px] text-[var(--muted)]">
              {crumbs.map((c, idx) => (
                <React.Fragment key={c.path}>
                  {idx > 0 && <span className="mx-1 text-[var(--muted-dim)]">/</span>}
                  <button
                    type="button"
                    onClick={() => onOpenPath(c.path)}
                    className={`hover:text-[var(--fg-secondary)] ${idx === crumbs.length - 1 ? 'text-[var(--fg-secondary)]' : ''}`}
                    title={c.path}
                  >
                    {c.label}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              setPathInput(normalizedPath);
              setPathEntryOpen((prev) => !prev);
            }}
            className={`h-7 px-2.5 rounded-md border text-[10px] font-semibold transition-colors ${
              pathEntryOpen
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
            }`}
            title="Jump to path"
          >
            Path
          </button>
          <button
            type="button"
            onClick={refreshExplorer}
            className="h-7 px-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
            title="Refresh explorer"
          >
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      {uploadStatus ? (
        <div className="mx-2.5 mt-2 p-2 rounded-md bg-[rgba(66,153,225,.12)] border border-[rgba(66,153,225,.28)] text-[12px] text-[var(--fg-secondary)]">
          {uploadStatus}
        </div>
      ) : null}
      {uploadError ? (
        <div className="mx-2.5 mt-2 p-2 rounded-md bg-[var(--red-subtle)] border border-[rgba(248,81,73,.2)] text-[12px] text-[var(--red)]">
          {uploadError}
        </div>
      ) : null}
      {error ? (
        <div className="mx-2.5 mt-2 p-2 rounded-md bg-[var(--red-subtle)] border border-[rgba(248,81,73,.2)] text-[12px] text-[var(--red)]">
          {error}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {hasOpenedFile ? (
          <div className="flex-1 min-w-0 min-h-0 p-2.5 overflow-hidden">
            <OpenedDroneFilePanel
              droneId={droneId}
              file={openedFile}
              onFileContentChange={onOpenedFileContentChange}
              onSaveFile={onSaveOpenedFile}
              onCloseFile={onCloseOpenedFile}
              onOpenResolvedFile={openResolvedFile}
            />
          </div>
        ) : null}

        <div
          className={`shrink-0 bg-[var(--panel)] flex flex-col ${
            hasOpenedFile ? 'w-[300px] border-l border-[var(--border-subtle)]' : 'w-full'
          }`}
        >
          <div className="flex-1 min-h-0 overflow-auto px-1.5 py-1">
            {showStartupPlaceholder ? (
              <div className="rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3 text-[12px] text-[var(--muted)]">
                <div className="text-[11px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                  {startupLabel}
                </div>
                <div className="mt-1">{startupText}</div>
                {startupDetail ? <div className="mt-1 text-[11px] text-[var(--muted-dim)]">{startupDetail}</div> : null}
              </div>
            ) : !error && loading && entries.length === 0 ? (
              <div className="rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3 text-[12px] text-[var(--muted)]">
                Loading files...
              </div>
            ) : !error && !loading && entries.length === 0 ? (
              <div className="rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3 text-[12px] text-[var(--muted)]">
                Directory is empty.
              </div>
            ) : (
              renderExplorer(explorerTree, 0)
            )}
          </div>
        </div>
      </div>

      {dragActive ? (
        <div className="pointer-events-none absolute inset-0 z-30 px-3 py-3">
          <div className="w-full h-full rounded-md border-2 border-dashed border-[var(--accent-muted)] bg-[rgba(18,23,34,.55)] flex items-center justify-center text-center px-4">
            <div className="text-[12px] text-[var(--fg-secondary)]">
              Drop files to upload into
              <div className="mt-1 font-mono text-[11px] text-[var(--accent)] break-all">{normalizedPath}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
