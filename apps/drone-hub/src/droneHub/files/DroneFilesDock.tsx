import React from 'react';
import type { DroneFsEntry } from '../types';

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

function IconFolder({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5a.25.25 0 01-.2-.1l-.9-1.2c-.33-.44-.85-.7-1.4-.7h-3.25z" />
    </svg>
  );
}

function IconList({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 4.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM4.5 3.5a.5.5 0 000 1h9a.5.5 0 000-1h-9zM3 8a.75.75 0 11-1.5 0A.75.75 0 013 8zm1.5-.5a.5.5 0 000 1h9a.5.5 0 000-1h-9zM3 11.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM4.5 11a.5.5 0 000 1h9a.5.5 0 000-1h-9z" />
    </svg>
  );
}

function IconGrid({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 1.75C1 .784 1.784 0 2.75 0h2.5C6.216 0 7 .784 7 1.75v2.5C7 5.216 6.216 6 5.25 6h-2.5A1.75 1.75 0 011 4.25v-2.5zM2.75 1A.75.75 0 002 1.75v2.5c0 .414.336.75.75.75h2.5A.75.75 0 006 4.25v-2.5A.75.75 0 005.25 1h-2.5zM9 1.75C9 .784 9.784 0 10.75 0h2.5C14.216 0 15 .784 15 1.75v2.5c0 .966-.784 1.75-1.75 1.75h-2.5A1.75 1.75 0 019 4.25v-2.5zM10.75 1a.75.75 0 00-.75.75v2.5c0 .414.336.75.75.75h2.5a.75.75 0 00.75-.75v-2.5a.75.75 0 00-.75-.75h-2.5zM1 10.75C1 9.784 1.784 9 2.75 9h2.5C6.216 9 7 9.784 7 10.75v2.5C7 14.216 6.216 15 5.25 15h-2.5A1.75 1.75 0 011 13.25v-2.5zM2.75 10a.75.75 0 00-.75.75v2.5c0 .414.336.75.75.75h2.5a.75.75 0 00.75-.75v-2.5a.75.75 0 00-.75-.75h-2.5zM9 10.75C9 9.784 9.784 9 10.75 9h2.5c.966 0 1.75.784 1.75 1.75v2.5c0 .966-.784 1.75-1.75 1.75h-2.5A1.75 1.75 0 019 13.25v-2.5zM10.75 10a.75.75 0 00-.75.75v2.5c0 .414.336.75.75.75h2.5a.75.75 0 00.75-.75v-2.5a.75.75 0 00-.75-.75h-2.5z" />
    </svg>
  );
}

function IconFile({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.75 0A1.75 1.75 0 002 1.75v12.5C2 15.216 2.784 16 3.75 16h8.5A1.75 1.75 0 0014 14.25V5.5a.75.75 0 00-.22-.53L9.03.22A.75.75 0 008.5 0H3.75zm4 .75v3A1.75 1.75 0 009.5 5.5h3v8.75a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25V1.75a.25.25 0 01.25-.25h4zm1.5 1.06L11.94 4H9.5a.25.25 0 01-.25-.25V1.81z" />
    </svg>
  );
}

export function DroneFilesDock({
  droneName,
  path,
  homePath,
  entries,
  loading,
  error,
  viewMode,
  onSetViewMode,
  onOpenPath,
  onRefresh,
}: {
  droneName: string;
  path: string;
  homePath: string;
  entries: DroneFsEntry[];
  loading: boolean;
  error: string | null;
  viewMode: 'list' | 'thumb';
  onSetViewMode: (next: 'list' | 'thumb') => void;
  onOpenPath: (nextPath: string) => void;
  onRefresh: () => void;
}) {
  const normalizedPath = normalizeContainerPathInput(path);
  const normalizedHomePath = normalizeContainerPathInput(homePath);
  const [pathInput, setPathInput] = React.useState(normalizedPath);
  const [thumbFailedByPath, setThumbFailedByPath] = React.useState<Record<string, boolean>>({});
  const [openedImage, setOpenedImage] = React.useState<DroneFsEntry | null>(null);
  const [openedImageFailed, setOpenedImageFailed] = React.useState(false);

  React.useEffect(() => {
    setPathInput(normalizedPath);
  }, [normalizedPath]);

  React.useEffect(() => {
    setThumbFailedByPath({});
  }, [droneName, normalizedPath]);

  React.useEffect(() => {
    setOpenedImage(null);
    setOpenedImageFailed(false);
  }, [droneName, normalizedPath]);

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
  }, []);

  return (
    <div className="w-full h-full min-h-0 bg-[var(--panel-alt)] overflow-hidden flex flex-col relative">
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
            title={`Container path for ${droneName}`}
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
        {error && (
          <div className="mb-2 p-2 rounded-md bg-[var(--red-subtle)] border border-[rgba(248,81,73,.2)] text-[12px] text-[var(--red)]">
            {error}
          </div>
        )}
        {!error && !openedImage && loading && entries.length === 0 && <div className="text-[12px] text-[var(--muted)]">Loading files...</div>}
        {!error && !openedImage && !loading && entries.length === 0 && <div className="text-[12px] text-[var(--muted)]">Directory is empty.</div>}

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
                <img
                  src={`/api/drones/${encodeURIComponent(droneName)}/fs/thumb?path=${encodeURIComponent(openedImage.path)}`}
                  alt={openedImage.name}
                  className="w-full h-full object-contain bg-[var(--panel-alt)]"
                  onLoad={() => setOpenedImageFailed(false)}
                  onError={() => setOpenedImageFailed(true)}
                />
              )}
            </div>
          </div>
        )}

        {!error && !openedImage && entries.length > 0 && viewMode === 'list' && (
          <div className="flex flex-col">
            <div className="grid grid-cols-[1fr_70px_100px] gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wide text-[var(--muted-dim)] border-b border-[var(--border-subtle)]">
              <span>Name</span>
              <span className="text-right">Size</span>
              <span className="text-right">Modified</span>
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {entries.map((entry) => {
                const isDir = entry.kind === 'directory';
                const isImageFile = entry.kind === 'file' && entry.isImage;
                const canOpenEntry = isDir || isImageFile;
                const modifiedText = formatLocalDateShort(entry.mtimeMs);
                const modifiedTitle = formatLocalDateTime(entry.mtimeMs);
                const typeText = isDir ? 'dir' : entry.isImage ? 'image' : entry.ext ? entry.ext : 'file';
                return (
                  <div
                    key={entry.path}
                    className={`grid grid-cols-[1fr_70px_100px] gap-2 px-2 py-1.5 text-[11px] leading-5 select-none ${
                      canOpenEntry ? 'hover:bg-[var(--hover)] cursor-pointer' : ''
                    }`}
                    onDoubleClick={() => {
                      if (isDir) onOpenPath(entry.path);
                      else if (isImageFile) openImagePreview(entry);
                    }}
                    role={canOpenEntry ? 'button' : undefined}
                    tabIndex={canOpenEntry ? 0 : -1}
                    onKeyDown={(e) => {
                      if (!canOpenEntry) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (isDir) onOpenPath(entry.path);
                        else if (isImageFile) openImagePreview(entry);
                      }
                    }}
                    title={isDir ? `Double-click to open: ${entry.path}` : isImageFile ? `Double-click to preview: ${entry.path}` : entry.path}
                  >
                    <span className="min-w-0 flex items-center gap-1.5">
                      {isDir ? (
                        <IconFolder className="flex-shrink-0 text-[var(--muted)] opacity-80" />
                      ) : (
                        <IconFile className="flex-shrink-0 text-[var(--muted)] opacity-80" />
                      )}
                      <span className="truncate text-[var(--fg-secondary)]">{entry.name}</span>
                      <span className="text-[11px] text-[var(--muted-dim)]">{typeText}</span>
                    </span>
                    <span className="text-right tabular-nums text-[var(--muted-dim)]">{isDir ? '-' : formatBytes(entry.size)}</span>
                    <span className="text-right tabular-nums text-[var(--muted-dim)] whitespace-nowrap overflow-hidden text-ellipsis" title={modifiedTitle}>
                      {modifiedText}
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
              const isImageFile = entry.kind === 'file' && entry.isImage;
              const canThumb = isImageFile && !thumbFailedByPath[entry.path];
              const canOpenEntry = isDir || isImageFile;
              const content = (
                <>
                  <div className="w-full h-20 rounded-md border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden flex items-center justify-center">
                    {isDir ? (
                      <IconFolder className="w-6 h-6 text-[var(--muted)] opacity-80" />
                    ) : canThumb ? (
                      <img
                        src={`/api/drones/${encodeURIComponent(droneName)}/fs/thumb?path=${encodeURIComponent(entry.path)}`}
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
                      <IconFile className="w-6 h-6 text-[var(--muted)] opacity-80" />
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
              return canOpenEntry ? (
                <button
                  key={entry.path}
                  type="button"
                  onDoubleClick={() => {
                    if (isDir) onOpenPath(entry.path);
                    else if (isImageFile) openImagePreview(entry);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (isDir) onOpenPath(entry.path);
                      else if (isImageFile) openImagePreview(entry);
                    }
                  }}
                  className="text-left p-2 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] hover:bg-[var(--hover)] select-none"
                  title={isDir ? `Double-click to open: ${entry.path}` : `Double-click to preview: ${entry.path}`}
                >
                  {content}
                </button>
              ) : (
                <div key={entry.path} className="p-2 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] select-none" title={entry.path}>
                  {content}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="px-2.5 py-1.5 border-t border-[var(--border-subtle)] text-[10px] text-[var(--muted-dim)] tabular-nums">
        {entries.length} item{entries.length !== 1 ? 's' : ''}
        {loading ? ' • refreshing…' : ''}
      </div>
    </div>
  );
}
