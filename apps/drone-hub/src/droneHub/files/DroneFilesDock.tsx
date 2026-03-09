import React from 'react';
import { requestJson } from '../http';
import { IconFolder, IconList, iconForFilePath } from '../icons';
import type { DroneFsEntry, DroneFsUploadPayload } from '../types';

function normalizeContainerPathInput(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function parentContainerPath(rawPath: string): string {
  const p = normalizeContainerPathInput(rawPath).replace(/\/+$/g, '') || '/';
  if (p === '/') return '/';
  const i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  return p.slice(0, i) || '/';
}

function formatBytes(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n < 1024) return `${Math.floor(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let idx = 0;
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024;
    idx += 1;
  }
  const precision = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(precision)} ${units[idx]}`;
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

function formatLocalDateShort(ms: number | null | undefined): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '-';
  try {
    return new Date(n).toLocaleDateString();
  } catch {
    return '-';
  }
}

function hasFileDragPayload(event: React.DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function IconGrid({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 1.75C1 .784 1.784 0 2.75 0h2.5C6.216 0 7 .784 7 1.75v2.5C7 5.216 6.216 6 5.25 6h-2.5A1.75 1.75 0 011 4.25v-2.5zM2.75 1A.75.75 0 002 1.75v2.5c0 .414.336.75.75.75h2.5A.75.75 0 006 4.25v-2.5A.75.75 0 005.25 1h-2.5zM9 1.75C9 .784 9.784 0 10.75 0h2.5C14.216 0 15 .784 15 1.75v2.5c0 .966-.784 1.75-1.75 1.75h-2.5A1.75 1.75 0 019 4.25v-2.5zM10.75 1a.75.75 0 00-.75.75v2.5c0 .414.336.75.75.75h2.5a.75.75 0 00.75-.75v-2.5a.75.75 0 00-.75-.75h-2.5zM1 10.75C1 9.784 1.784 9 2.75 9h2.5C6.216 9 7 9.784 7 10.75v2.5C7 14.216 6.216 15 5.25 15h-2.5A1.75 1.75 0 011 13.25v-2.5zM2.75 10a.75.75 0 00-.75.75v2.5c0 .414.336.75.75.75h2.5a.75.75 0 00.75-.75v-2.5a.75.75 0 00-.75-.75h-2.5zM9 10.75C9 9.784 9.784 9 10.75 9h2.5c.966 0 1.75.784 1.75 1.75v2.5c0 .966-.784 1.75-1.75 1.75h-2.5A1.75 1.75 0 019 13.25v-2.5zM10.75 10a.75.75 0 00-.75.75v2.5c0 .414.336.75.75.75h2.5a.75.75 0 00.75-.75v-2.5a.75.75 0 00-.75-.75h-2.5z" />
    </svg>
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
  homePath,
  entries,
  loading,
  error,
  startup,
  viewMode,
  onSetViewMode,
  onOpenPath,
  onOpenFile,
  onRefresh,
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
  onRefresh: () => void;
}) {
  const shownName = String(droneLabel ?? droneName).trim() || droneName;
  const normalizedPath = normalizeContainerPathInput(path);
  const normalizedHomePath = normalizeContainerPathInput(homePath);
  const [pathInput, setPathInput] = React.useState(normalizedPath);
  const [thumbFailedByPath, setThumbFailedByPath] = React.useState<Record<string, boolean>>({});
  const [openedImage, setOpenedImage] = React.useState<DroneFsEntry | null>(null);
  const [openedImageFailed, setOpenedImageFailed] = React.useState(false);
  const [openedImageZoom, setOpenedImageZoom] = React.useState(1);
  const [openedImagePan, setOpenedImagePan] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [openedImagePanning, setOpenedImagePanning] = React.useState(false);
  const openedImagePanDragRef = React.useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const dragDepthRef = React.useRef(0);
  const uploadRunRef = React.useRef(0);
  const [dragActive, setDragActive] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadStatus, setUploadStatus] = React.useState<string | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPathInput(normalizedPath);
  }, [normalizedPath]);

  React.useEffect(() => {
    setThumbFailedByPath({});
  }, [droneId, normalizedPath]);

  React.useEffect(() => {
    setOpenedImage(null);
    setOpenedImageFailed(false);
    setOpenedImageZoom(1);
    setOpenedImagePan({ x: 0, y: 0 });
    setOpenedImagePanning(false);
    openedImagePanDragRef.current = null;
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

  React.useEffect(() => {
    if (!openedImagePanning) return;
    const onMouseMove = (event: MouseEvent) => {
      const drag = openedImagePanDragRef.current;
      if (!drag) return;
      setOpenedImagePan({
        x: drag.baseX + (event.clientX - drag.startX),
        y: drag.baseY + (event.clientY - drag.startY),
      });
    };
    const onMouseUp = () => {
      setOpenedImagePanning(false);
      openedImagePanDragRef.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [openedImagePanning]);

  React.useEffect(() => {
    if (!openedImage) return;
    const next = entries.find((entry) => entry.path === openedImage.path && entry.kind === 'file' && entry.isImage);
    if (!next) {
      setOpenedImage(null);
      setOpenedImageFailed(false);
      return;
    }
    if (next.name !== openedImage.name || next.size !== openedImage.size || next.mtimeMs !== openedImage.mtimeMs) {
      setOpenedImage(next);
    }
  }, [entries, openedImage]);

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

  const goUp = React.useCallback(() => {
    onOpenPath(parentContainerPath(normalizedPath));
  }, [normalizedPath, onOpenPath]);

  const submitPath = React.useCallback(() => {
    onOpenPath(normalizeContainerPathInput(pathInput));
  }, [onOpenPath, pathInput]);

  const openImagePreview = React.useCallback((entry: DroneFsEntry) => {
    if (entry.kind !== 'file' || !entry.isImage) return;
    setOpenedImage(entry);
    setOpenedImageFailed(false);
    setOpenedImageZoom(1);
    setOpenedImagePan({ x: 0, y: 0 });
    setOpenedImagePanning(false);
    openedImagePanDragRef.current = null;
  }, []);

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
      if (uploaded > 0) onRefresh();
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
    [droneId, normalizedPath, onRefresh],
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

  const onPanelDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!dragActive) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }, [dragActive]);

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
  const canOpenEntry = React.useCallback((entry: DroneFsEntry): boolean => entry.kind === 'directory' || entry.kind === 'file', []);
  const openEntry = React.useCallback(
    (entry: DroneFsEntry) => {
      if (entry.kind === 'directory') {
        onOpenPath(entry.path);
        return;
      }
      if (entry.kind !== 'file') return;
      if (entry.isImage) {
        openImagePreview(entry);
        return;
      }
      onOpenFile(entry);
    },
    [onOpenFile, onOpenPath, openImagePreview],
  );
  const entryOpenTitle = React.useCallback((entry: DroneFsEntry): string => {
    if (entry.kind === 'directory') return `Double-click to open: ${entry.path}`;
    if (entry.kind === 'file' && entry.isImage) return `Double-click to preview: ${entry.path}`;
    if (entry.kind === 'file') return `Double-click to open: ${entry.path}`;
    return entry.path;
  }, []);
  const onEntryKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>, entry: DroneFsEntry) => {
      if (!canOpenEntry(entry)) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openEntry(entry);
      }
    },
    [canOpenEntry, openEntry],
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

  const showStartupPlaceholder = Boolean(startup?.waiting) && !openedImage && !error && entries.length === 0;
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
      <div className="px-2.5 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-[var(--muted-dim)] tracking-[0.12em] uppercase" style={{ fontFamily: 'var(--display)' }}>Files</div>
        <div className="inline-flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onSetViewMode('list')}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-semibold tracking-wide uppercase transition-all ${
              viewMode === 'list'
                ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent-muted)]'
                : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] border-[var(--border-subtle)] hover:text-[var(--muted)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="List view"
          >
            <IconList className="opacity-70" />
            List
          </button>
          <button
            type="button"
            onClick={() => onSetViewMode('thumb')}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-semibold tracking-wide uppercase transition-all ${
              viewMode === 'thumb'
                ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent-muted)]'
                : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] border-[var(--border-subtle)] hover:text-[var(--muted)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Thumbnail view"
          >
            <IconGrid className="opacity-70" />
            Thumb
          </button>
        </div>
      </div>

      <div className="px-2.5 py-2 border-b border-[var(--border-subtle)] flex flex-col gap-1.5">
        <div className="min-w-0 overflow-x-auto whitespace-nowrap text-[10px] text-[var(--muted)]">
          {crumbs.map((c, idx) => (
            <React.Fragment key={c.path}>
              {idx > 0 && <span className="mx-1 text-[var(--muted-dim)]">/</span>}
              <button
                type="button"
                onClick={() => onOpenPath(c.path)}
                className={`hover:text-[var(--fg-secondary)] ${idx === crumbs.length - 1 ? 'text-[var(--fg-secondary)] font-semibold' : ''}`}
                title={c.path}
              >
                {c.label}
              </button>
            </React.Fragment>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitPath();
              }
            }}
            className="flex-1 min-w-0 h-7 rounded-md border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-2 text-[11px] text-[var(--fg-secondary)] focus:outline-none"
            title={`Container path for ${shownName}`}
          />
          <button
            type="button"
            onClick={submitPath}
            className="h-7 px-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--panel-alt)] text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
            title="Go to path"
          >
            Go
          </button>
          <button
            type="button"
            onClick={() => onOpenPath(normalizedHomePath)}
            disabled={normalizedPath === normalizedHomePath}
            className={`h-7 px-2.5 rounded-md border text-[10px] font-semibold transition-colors ${
              normalizedPath === normalizedHomePath
                ? 'border-[var(--border-subtle)] bg-[var(--panel-alt)] text-[var(--muted-dim)] opacity-60 cursor-not-allowed'
                : 'border-[var(--border-subtle)] bg-[var(--panel-alt)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
            }`}
            title={`Go to home: ${normalizedHomePath}`}
          >
            Home
          </button>
          <button
            type="button"
            onClick={goUp}
            disabled={normalizedPath === '/'}
            className={`h-7 px-2.5 rounded-md border text-[10px] font-semibold transition-colors ${
              normalizedPath === '/'
                ? 'border-[var(--border-subtle)] bg-[var(--panel-alt)] text-[var(--muted-dim)] opacity-60 cursor-not-allowed'
                : 'border-[var(--border-subtle)] bg-[var(--panel-alt)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
            }`}
            title="Up one directory"
          >
            Up
          </button>
          <button
            type="button"
            onClick={onRefresh}
            className="h-7 px-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--panel-alt)] text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
            title="Refresh listing"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-2.5 py-2">
        {uploadStatus && (
          <div className="mb-2 p-2 rounded-md bg-[rgba(66,153,225,.12)] border border-[rgba(66,153,225,.28)] text-[12px] text-[var(--fg-secondary)]">
            {uploadStatus}
          </div>
        )}
        {uploadError && (
          <div className="mb-2 p-2 rounded-md bg-[var(--red-subtle)] border border-[rgba(248,81,73,.2)] text-[12px] text-[var(--red)]">
            {uploadError}
          </div>
        )}
        {error && (
          <div className="mb-2 p-2 rounded-md bg-[var(--red-subtle)] border border-[rgba(248,81,73,.2)] text-[12px] text-[var(--red)]">
            {error}
          </div>
        )}
        {showStartupPlaceholder ? (
          <div className="px-3 py-3 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[12px] text-[var(--muted)]">
            <div className="text-[11px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              {startupLabel}
            </div>
            <div className="mt-1">{startupText}</div>
            {startupDetail ? <div className="mt-1 text-[11px] text-[var(--muted-dim)]">{startupDetail}</div> : null}
          </div>
        ) : (
          <>
            {!error && !openedImage && loading && entries.length === 0 && (
              <div className="text-[12px] text-[var(--muted)]">Loading files...</div>
            )}
            {!error && !openedImage && !loading && entries.length === 0 && (
              <div className="text-[12px] text-[var(--muted)]">Directory is empty.</div>
            )}
          </>
        )}

        {!error && openedImage && (
          <div className="h-full min-h-0 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpenedImage(null);
                  setOpenedImageFailed(false);
                }}
                className="h-7 px-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--panel-alt)] text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] whitespace-nowrap"
                title="Back to file list"
              >
                Back to files
              </button>
              <div className="min-w-0 text-right">
                <div className="text-[12px] text-[var(--fg-secondary)] truncate" title={openedImage.path}>
                  {openedImage.name}
                </div>
                <div className="text-[11px] text-[var(--muted-dim)]">
                  {formatBytes(openedImage.size)} • {formatLocalDateTime(openedImage.mtimeMs)}
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] overflow-hidden flex items-center justify-center">
              {openedImageFailed ? (
                <div className="px-3 text-[12px] text-[var(--muted)] text-center">
                  Unable to load this image preview. Try refreshing the directory and opening it again.
                </div>
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center bg-[var(--panel-alt)] select-none"
                  style={{ cursor: openedImageZoom > 1 ? (openedImagePanning ? 'grabbing' : 'grab') : 'default' }}
                  onWheel={(event) => {
                    event.preventDefault();
                    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
                    setOpenedImageZoom((prev) => {
                      const next = Math.max(1, Math.min(8, prev * factor));
                      if (next === 1 && prev !== 1) {
                        setOpenedImagePan({ x: 0, y: 0 });
                        setOpenedImagePanning(false);
                        openedImagePanDragRef.current = null;
                      }
                      return next;
                    });
                  }}
                  onMouseDown={(event) => {
                    if (event.button !== 2) return;
                    if (openedImageZoom <= 1) return;
                    event.preventDefault();
                    openedImagePanDragRef.current = {
                      startX: event.clientX,
                      startY: event.clientY,
                      baseX: openedImagePan.x,
                      baseY: openedImagePan.y,
                    };
                    setOpenedImagePanning(true);
                  }}
                  onContextMenu={(event) => {
                    if (openedImageZoom > 1 || openedImagePanning) event.preventDefault();
                  }}
                >
                  <img
                    src={`/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${encodeURIComponent(openedImage.path)}`}
                    alt={openedImage.name}
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    className="w-full h-full object-contain bg-[var(--panel-alt)]"
                    style={{
                      transform: `translate(${openedImagePan.x}px, ${openedImagePan.y}px) scale(${openedImageZoom})`,
                      transformOrigin: 'center center',
                    }}
                    onLoad={() => setOpenedImageFailed(false)}
                    onError={() => setOpenedImageFailed(true)}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {!error && !openedImage && entries.length > 0 && viewMode === 'list' && (
          <div className="flex flex-col">
            <div className="grid grid-cols-[1fr_70px_100px_34px] gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wide text-[var(--muted-dim)] border-b border-[var(--border-subtle)]">
              <span>Name</span>
              <span className="text-right">Size</span>
              <span className="text-right">Modified</span>
              <span />
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {entries.map((entry) => {
                const isDir = entry.kind === 'directory';
                const modifiedText = formatLocalDateShort(entry.mtimeMs);
                const modifiedTitle = formatLocalDateTime(entry.mtimeMs);
                const typeText = isDir ? 'dir' : entry.isImage ? 'image' : entry.isVideo ? 'video' : entry.ext ? entry.ext : 'file';
                const openable = canOpenEntry(entry);
                const FileIcon = iconForFilePath(entry.path);
                return (
                  <div
                    key={entry.path}
                    className={`group grid grid-cols-[1fr_70px_100px_34px] gap-2 px-2 py-1.5 text-[11px] leading-5 select-none ${
                      openable ? 'hover:bg-[var(--hover)] cursor-pointer' : ''
                    }`}
                    onDoubleClick={() => openEntry(entry)}
                    role={openable ? 'button' : undefined}
                    tabIndex={openable ? 0 : -1}
                    onKeyDown={(e) => onEntryKeyDown(e, entry)}
                    title={entryOpenTitle(entry)}
                  >
                    <span className="min-w-0 flex items-center gap-1.5">
                      {isDir ? (
                        <IconFolder className="flex-shrink-0 text-[var(--muted)] opacity-80" />
                      ) : (
                        <FileIcon className="flex-shrink-0 text-[var(--muted)] opacity-80" />
                      )}
                      <span className="truncate text-[var(--fg-secondary)]">{entry.name}</span>
                      <span className="text-[11px] text-[var(--muted-dim)]">{typeText}</span>
                    </span>
                    <span className="text-right tabular-nums text-[var(--muted-dim)]">{isDir ? '-' : formatBytes(entry.size)}</span>
                    <span className="text-right tabular-nums text-[var(--muted-dim)] whitespace-nowrap overflow-hidden text-ellipsis" title={modifiedTitle}>
                      {modifiedText}
                    </span>
                    <span className="flex items-center justify-end">
                      {renderDownloadButton(
                        entry,
                        'w-6 h-6 rounded border border-[var(--border-subtle)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex items-center justify-center',
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!error && !openedImage && entries.length > 0 && viewMode === 'thumb' && (
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
            {entries.map((entry) => {
              const isDir = entry.kind === 'directory';
              const isRegularFile = entry.kind === 'file';
              const isImageFile = isRegularFile && entry.isImage;
              const canThumb = isImageFile && !thumbFailedByPath[entry.path];
              const FileIcon = iconForFilePath(entry.path);
              const openable = canOpenEntry(entry);
              const content = (
                <>
                  <div className="w-full h-20 rounded-md border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden flex items-center justify-center">
                    {isDir ? (
                      <IconFolder className="w-6 h-6 text-[var(--muted)] opacity-80" />
                    ) : canThumb ? (
                      <img
                        src={`/api/drones/${encodeURIComponent(droneId)}/fs/thumb?path=${encodeURIComponent(entry.path)}`}
                        alt={entry.name}
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={() =>
                          setThumbFailedByPath((prev) => ({
                            ...prev,
                            [entry.path]: true,
                          }))
                        }
                      />
                    ) : (
                      <FileIcon className="w-6 h-6 text-[var(--muted)] opacity-80" />
                    )}
                  </div>
                  <div className="min-w-0 mt-1">
                    <div className="text-[12px] text-[var(--fg-secondary)] truncate" title={entry.name}>
                      {entry.name}
                    </div>
                    <div className="text-[11px] text-[var(--muted-dim)] truncate">{isDir ? 'directory' : formatBytes(entry.size)}</div>
                  </div>
                </>
              );
              return (
                <div key={entry.path} className="relative group">
                  {openable ? (
                    <button
                      type="button"
                      onDoubleClick={() => openEntry(entry)}
                      onKeyDown={(e) => onEntryKeyDown(e, entry)}
                      className="w-full text-left p-2 pr-8 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] hover:bg-[var(--hover)] select-none"
                      title={entryOpenTitle(entry)}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="p-2 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] select-none" title={entry.path}>
                      {content}
                    </div>
                  )}
                  {renderDownloadButton(
                    entry,
                    'absolute top-2 right-2 w-6 h-6 rounded border border-[var(--border-subtle)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex items-center justify-center',
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-30 px-3 py-3">
          <div className="w-full h-full rounded-md border-2 border-dashed border-[var(--accent-muted)] bg-[rgba(18,23,34,.55)] flex items-center justify-center text-center px-4">
            <div className="text-[12px] text-[var(--fg-secondary)]">
              Drop files to upload into
              <div className="mt-1 font-mono text-[11px] text-[var(--accent)] break-all">{normalizedPath}</div>
            </div>
          </div>
        </div>
      )}
      <div className="px-2.5 py-1.5 border-t border-[var(--border-subtle)] text-[10px] text-[var(--muted-dim)] tabular-nums">
        {entries.length} item{entries.length !== 1 ? 's' : ''}
        {loading ? ' • refreshing…' : ''}
        {uploading ? ' • uploading…' : ''}
      </div>
    </div>
  );
}
