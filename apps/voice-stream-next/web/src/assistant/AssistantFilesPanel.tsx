import * as React from 'react';
import type { AssistantArtifactRecord } from '../dashboardTypes.js';
import { timeLabel } from '../time.js';
import { cn } from '../ui/cn.js';
import { MarkdownMessage } from '../ui/MarkdownMessage.js';

export type ArtifactPanelMode = 'view' | 'edit';

type AssistantFilesPanelProps = {
  artifacts: AssistantArtifactRecord[];
  artifactsLoading: boolean;
  artifactsError: string | null;
  selectedArtifact: AssistantArtifactRecord | null;
  artifactPathDraft: string;
  artifactContentDraft: string;
  artifactDirty: boolean;
  panelMode: ArtifactPanelMode;
  busy: boolean;
  onNew: () => void;
  onSelect: (artifact: AssistantArtifactRecord) => void;
  onPanelModeChange: (mode: ArtifactPanelMode) => void;
  onPathChange: (path: string) => void;
  onContentChange: (content: string) => void;
  onCancelEdit: () => void;
  onCloseFile: () => void;
  onSave: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onDownload: () => void;
};

const actionButtonClass =
  'inline-flex h-7 items-center justify-center gap-1 rounded-md border border-[var(--border-subtle)] bg-white/[.03] px-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-secondary)] transition hover:border-[rgba(136,145,168,.4)] hover:bg-white/[.06] hover:text-[var(--fg)] disabled:pointer-events-none disabled:opacity-45';
const primaryButtonClass =
  'inline-flex h-7 items-center justify-center gap-1 rounded-md border border-[rgba(74,222,128,.35)] bg-[rgba(74,222,128,.12)] px-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--green)] transition hover:border-[rgba(74,222,128,.5)] hover:bg-[rgba(74,222,128,.18)] disabled:pointer-events-none disabled:opacity-45';
const iconClass = 'h-3.5 w-3.5 shrink-0 fill-none stroke-current stroke-[1.75]';

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn(iconClass, className)}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function BackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn(iconClass, className)}>
      <path d="M15 18 9 12l6-6" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn(iconClass, className)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function formatArtifactSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function artifactFileName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path || 'Untitled';
}

function artifactDirectory(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

function artifactExtension(path: string): string {
  const name = artifactFileName(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

type ExplorerGroup = {
  directory: string;
  files: AssistantArtifactRecord[];
};

function buildExplorerGroups(artifacts: AssistantArtifactRecord[]): ExplorerGroup[] {
  const byDir = new Map<string, AssistantArtifactRecord[]>();
  for (const artifact of [...artifacts].sort((a, b) => a.path.localeCompare(b.path))) {
    const directory = artifactDirectory(artifact.path);
    const list = byDir.get(directory) ?? [];
    list.push(artifact);
    byDir.set(directory, list);
  }
  return [...byDir.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([directory, files]) => ({ directory, files }));
}

function FileTypeIcon({ path, className }: { path: string; className?: string }) {
  const ext = artifactExtension(path);
  const markdown = ext === 'md' || ext === 'markdown';
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn(iconClass, className)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      {markdown ? <path d="M8 13h8M8 17h5" /> : <path d="M8 13h8M8 17h8" />}
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn(iconClass, className)}>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function MobileEmptyFilesState({ busy, onNew }: { busy: boolean; onNew: () => void }) {
  return (
    <div className="hidden min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center max-md:flex">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-white/[.03] text-[var(--muted)]">
        <FileTypeIcon path="notes.md" className="h-6 w-6" />
      </div>
      <div className="max-w-sm">
        <p className="text-sm font-medium text-[var(--fg)]">No assistant files</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
          Create notes, plans, or artifacts for this thread.
        </p>
      </div>
      <button type="button" className={primaryButtonClass} onClick={onNew} disabled={busy}>
        New file
      </button>
    </div>
  );
}

function ExplorerSidebar({
  artifacts,
  artifactsLoading,
  busy,
  selectedPath,
  onSelect,
  onNew,
  hiddenOnMobile,
}: {
  artifacts: AssistantArtifactRecord[];
  artifactsLoading: boolean;
  busy: boolean;
  selectedPath: string;
  onSelect: (artifact: AssistantArtifactRecord) => void;
  onNew: () => void;
  hiddenOnMobile: boolean;
}) {
  const groups = React.useMemo(() => buildExplorerGroups(artifacts), [artifacts]);
  const [collapsedDirs, setCollapsedDirs] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    const directory = artifactDirectory(selectedPath);
    if (!directory) return;
    setCollapsedDirs((prev) => {
      if (!prev.has(directory)) return prev;
      const next = new Set(prev);
      next.delete(directory);
      return next;
    });
  }, [selectedPath]);

  const toggleDir = (directory: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(directory)) next.delete(directory);
      else next.add(directory);
      return next;
    });
  };

  return (
    <aside className={cn('flex min-h-0 w-full shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)] max-md:flex-1 max-md:border-r-0 max-md:bg-transparent md:w-[240px]', hiddenOnMobile && 'max-md:hidden')}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-2.5 py-2 max-md:border-b-0 max-md:px-3 max-md:pt-3">
        <div className="min-w-0 md:hidden">
          <div className="flex items-center gap-2">
            <h2 className="m-0 font-display text-[13px] font-bold tracking-tight text-[var(--fg)]">Files</h2>
            {artifacts.length > 0 ? (
              <span className="rounded-full border border-[var(--border-subtle)] bg-white/[.03] px-2 py-0.5 text-[10px] tabular-nums text-[var(--muted)]">
                {artifacts.length}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">Thread notes and artifacts</p>
        </div>
        <span className="font-display text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)] max-md:hidden">Explorer</span>
        <button type="button" className={cn(actionButtonClass, 'h-7 w-7 px-0')} onClick={onNew} disabled={busy} title="New file" aria-label="New file">
          <PlusIcon className="h-3 w-3" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1.5 max-md:px-3 max-md:py-3">
        {artifactsLoading && artifacts.length === 0 ? (
          <p className="px-2 py-3 text-xs text-[var(--muted)]">Loading files…</p>
        ) : null}
        {!artifactsLoading && artifacts.length === 0 ? (
          <>
            <MobileEmptyFilesState busy={busy} onNew={onNew} />
            <p className="px-2 py-3 text-xs leading-relaxed text-[var(--muted)] max-md:hidden">
              No files yet. Create one to store notes and plans for this thread.
            </p>
          </>
        ) : null}
        {groups.map((group) => {
          const collapsed = group.directory ? collapsedDirs.has(group.directory) : false;
          return (
            <div key={group.directory || '__root__'} className="mb-1 max-md:mb-0">
              {group.directory ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[11px] text-[var(--muted)] shadow-none transition hover:bg-white/[.04] hover:text-[var(--fg-secondary)] max-md:rounded-none max-md:px-0 max-md:py-1.5 max-md:hover:bg-transparent"
                  onClick={() => toggleDir(group.directory)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className={cn('h-3 w-3 fill-none stroke-current stroke-2 transition', collapsed && '-rotate-90')}
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  <FolderIcon className="text-[rgba(250,204,21,.75)]" />
                  <span className="min-w-0 truncate font-medium">{group.directory}</span>
                  <span className="ml-auto text-[9px] tabular-nums text-[var(--muted-dim)]">{group.files.length}</span>
                </button>
              ) : null}
              {!collapsed ? (
                <ul className={cn('grid gap-0.5 max-md:gap-1', group.directory && 'ml-3 border-l border-[var(--border-subtle)] pl-1.5 max-md:ml-5 max-md:border-l-0 max-md:pl-0')}>
                  {group.files.map((artifact) => {
                    const active = selectedPath === artifact.path;
                    return (
                      <li key={artifact.id}>
                        <button
                          type="button"
                          className={cn(
                            'group flex w-full min-w-0 items-start gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left shadow-none transition disabled:pointer-events-none disabled:opacity-45 max-md:rounded-md max-md:px-2 max-md:py-2 max-md:ring-0',
                            active
                              ? 'bg-[rgba(74,222,128,.1)] text-[var(--fg)] ring-1 ring-inset ring-[rgba(74,222,128,.22)] max-md:bg-white/[.025] max-md:text-[var(--fg)] max-md:ring-0'
                              : 'text-[var(--fg-secondary)] hover:bg-white/[.04] max-md:hover:bg-white/[.025]',
                          )}
                          onClick={() => onSelect(artifact)}
                          disabled={busy}
                        >
                          <FileTypeIcon
                            path={artifact.path}
                            className={cn('mt-0.5', active ? 'text-[var(--green)]' : 'text-[var(--muted)] group-hover:text-[var(--fg-secondary)]')}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] font-medium leading-tight">{artifactFileName(artifact.path)}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">{formatArtifactSize(artifact.size)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function Breadcrumb({ path }: { path: string }) {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) {
    return <span className="text-[var(--muted)]">Untitled draft</span>;
  }
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] text-[var(--muted)]" aria-label="File path">
      {segments.map((segment, index) => {
        const isFile = index === segments.length - 1;
        return (
          <React.Fragment key={`${index}-${segment}`}>
            {index > 0 ? <span className="text-[var(--muted-dim)]">/</span> : null}
            <span className={cn('truncate', isFile ? 'font-medium text-[var(--fg)]' : '')}>{segment}</span>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

function EmptyDetailState({ busy, onNew }: { busy: boolean; onNew: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center max-md:hidden">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-white/[.03] text-[var(--muted)]">
        <FileTypeIcon path="notes.md" className="h-6 w-6" />
      </div>
      <div className="max-w-sm">
        <p className="text-sm font-medium text-[var(--fg)]">Select a file</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
          Pick a file from the explorer to preview its contents, or create a new note for this thread.
        </p>
      </div>
      <button type="button" className={primaryButtonClass} onClick={onNew} disabled={busy}>
        New file
      </button>
    </div>
  );
}

export function AssistantFilesPanel({
  artifacts,
  artifactsLoading,
  artifactsError,
  selectedArtifact,
  artifactPathDraft,
  artifactContentDraft,
  artifactDirty,
  panelMode,
  busy,
  onNew,
  onSelect,
  onPanelModeChange,
  onPathChange,
  onContentChange,
  onCancelEdit,
  onCloseFile,
  onSave,
  onDelete,
  onCopy,
  onDownload,
}: AssistantFilesPanelProps) {
  const hasOpenFile = Boolean(artifactPathDraft.trim() || selectedArtifact);
  const isEditing = panelMode === 'edit';
  const displayPath = artifactPathDraft.trim() || selectedArtifact?.path || '';
  const contentSize = new Blob([artifactContentDraft]).size;
  const showMobileList = !hasOpenFile;
  const displayFileName = artifactFileName(displayPath);
  const displayDirectory = artifactDirectory(displayPath);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-[var(--border)] bg-[var(--panel-alt)] max-md:border-t-0">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5 max-md:hidden">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="m-0 font-display text-[13px] font-bold tracking-tight text-[var(--fg)]">Assistant files</h2>
            <span className="rounded-full border border-[var(--border-subtle)] bg-white/[.03] px-2 py-0.5 text-[10px] tabular-nums text-[var(--muted)]">
              {artifacts.length}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">Thread-scoped notes and artifacts</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button type="button" className={actionButtonClass} onClick={onNew} disabled={busy} title="New file" aria-label="New file">
            <PlusIcon className="h-3 w-3" />
            <span>New</span>
          </button>
        </div>
      </header>

      {artifactsError ? (
        <div className="mx-3 mt-2 shrink-0 rounded-md border border-[rgba(248,113,113,.28)] bg-[rgba(248,113,113,.08)] px-3 py-2 text-xs text-[#fecaca]">
          {artifactsError}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)]">
        <ExplorerSidebar
          artifacts={artifacts}
          artifactsLoading={artifactsLoading}
          busy={busy}
          selectedPath={selectedArtifact?.path ?? ''}
          onSelect={onSelect}
          onNew={onNew}
          hiddenOnMobile={!showMobileList}
        />

        <div className={cn('flex min-h-0 min-w-0 flex-col', showMobileList && 'max-md:hidden')}>
          {!hasOpenFile ? (
            <EmptyDetailState busy={busy} onNew={onNew} />
          ) : (
            <>
              <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] px-3 py-2 max-md:bg-transparent max-md:px-3 max-md:py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 max-md:flex-nowrap max-md:items-start">
                  <button type="button" className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 text-[var(--muted)] shadow-none transition hover:bg-white/[.04] hover:text-[var(--fg-secondary)] disabled:pointer-events-none disabled:opacity-45 max-md:inline-flex" onClick={onCloseFile} disabled={busy} title="Back to files" aria-label="Back to files">
                    <BackIcon />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="max-md:hidden">
                      <Breadcrumb path={displayPath} />
                    </div>
                    <div className="hidden min-w-0 max-md:block">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <h2 className="m-0 min-w-0 truncate text-sm font-semibold leading-tight text-[var(--fg)]">{displayFileName}</h2>
                        {!isEditing ? (
                          <button type="button" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 text-[var(--muted)] shadow-none transition hover:bg-white/[.04] hover:text-[var(--fg-secondary)] disabled:pointer-events-none disabled:opacity-45" onClick={() => onPanelModeChange('edit')} disabled={busy} title="Edit file" aria-label="Edit file">
                            <PencilIcon className="h-3 w-3" />
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] leading-tight text-[var(--muted)]">
                        {displayDirectory ? <span className="min-w-0 truncate">{displayDirectory}</span> : null}
                        {displayDirectory ? <span className="text-[var(--muted-dim)]">·</span> : null}
                        <span>{formatArtifactSize(contentSize)}</span>
                        {selectedArtifact ? (
                          <>
                            <span className="text-[var(--muted-dim)]">·</span>
                            <span>{timeLabel(selectedArtifact.updatedAt)}</span>
                          </>
                        ) : null}
                        {artifactDirty ? (
                          <>
                            <span className="text-[var(--muted-dim)]">·</span>
                            <span className="font-medium text-[rgba(250,204,21,.9)]">Unsaved</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-[var(--muted)] max-md:hidden">
                      <span>{formatArtifactSize(contentSize)}</span>
                      {selectedArtifact ? (
                        <>
                          <span className="text-[var(--muted-dim)]">·</span>
                          <span>Updated {timeLabel(selectedArtifact.updatedAt)}</span>
                        </>
                      ) : null}
                      {artifactDirty ? (
                        <>
                          <span className="text-[var(--muted-dim)]">·</span>
                          <span className="font-medium text-[rgba(250,204,21,.9)]">Unsaved</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    {!isEditing ? (
                      <button type="button" className={cn(primaryButtonClass, 'max-md:hidden')} onClick={() => onPanelModeChange('edit')} disabled={busy}>
                        Edit
                      </button>
                    ) : (
                      <>
                        <button type="button" className={actionButtonClass} onClick={onCancelEdit} disabled={busy}>
                          Cancel
                        </button>
                        <button type="button" className={primaryButtonClass} onClick={onSave} disabled={!artifactPathDraft.trim() || busy}>
                          Save
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {isEditing ? (
                <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
                  <label className="grid shrink-0 gap-1 border-b border-[var(--border-subtle)] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                    Path
                    <input
                      value={artifactPathDraft}
                      onChange={(event) => onPathChange(event.target.value)}
                      placeholder="notes/plan.md"
                      disabled={busy}
                      className="rounded-md border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2.5 py-1.5 font-mono text-[11px] normal-case text-[var(--fg)]"
                    />
                  </label>
                  <label className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                    Source
                    <textarea
                      value={artifactContentDraft}
                      onChange={(event) => onContentChange(event.target.value)}
                      placeholder="Write markdown or plain text…"
                      disabled={busy}
                      className="min-h-0 resize-none rounded-md border border-[var(--border-subtle)] bg-[rgba(0,0,0,.22)] px-3 py-2.5 font-mono text-[12px] font-normal normal-case leading-relaxed text-[var(--fg)]"
                    />
                  </label>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                  {artifactContentDraft.trim() ? (
                    <MarkdownMessage text={artifactContentDraft} className="text-[13px] leading-relaxed text-[var(--fg-secondary)]" />
                  ) : (
                    <p className="text-xs text-[var(--muted)]">This file is empty.</p>
                  )}
                </div>
              )}

              <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-2">
                <div className="flex flex-wrap items-center gap-1">
                  <button type="button" className={actionButtonClass} onClick={onCopy} disabled={!artifactContentDraft || busy}>
                    Copy
                  </button>
                  <button type="button" className={actionButtonClass} onClick={onDownload} disabled={!artifactPathDraft.trim() || busy}>
                    Download
                  </button>
                  <button
                    type="button"
                    className={cn(actionButtonClass, 'border-[rgba(248,113,113,.28)] text-[#fca5a5] hover:border-[rgba(248,113,113,.45)] hover:text-[#fecaca]')}
                    onClick={onDelete}
                    disabled={!selectedArtifact || busy}
                  >
                    Delete
                  </button>
                </div>
              </footer>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
