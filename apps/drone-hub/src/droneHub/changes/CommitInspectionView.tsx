import React from 'react';
import type { RepoChangeEntry, RepoCommitSummary } from '../types';
import { badgeTone, shortSha, statusBadgeTitle, statusCharLabel, type ExplorerNode } from './helpers';
import type { DiffState, DiffViewType } from './types';
import { DiffBlock } from './DiffBlock';
import { MetaChip } from './MetaChip';

function formatCommitTimestamp(raw: string | null | undefined): { short: string; title?: string } {
  const text = String(raw ?? '').trim();
  if (!text) return { short: '-' };
  const epoch = Date.parse(text);
  if (!Number.isFinite(epoch)) return { short: text };
  const date = new Date(epoch);
  return {
    short: date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    title: date.toLocaleString(),
  };
}

export function CommitInspectionView({
  contextMode,
  pullRequestNumber,
  commitList,
  commitListLoading,
  selectedCommitSha,
  onSelectCommit,
  selectedCommit,
  activeCommitDetails,
  activeCommitDetailsLoading,
  activeCommitDetailsError,
  commitEntries,
  commitFileSelectedPath,
  selectedCommitFileEntry,
  onSelectCommitFile,
  expandedCommitFiles,
  onToggleCommitFile,
  commitDiffByKey,
  commitDiffStateKey,
  loadCommitDiff,
  diffViewType,
  viewMode,
  commitExplorerTree,
  renderCommitExplorer,
  renderFileQuickActions,
  commitLayoutRef,
  commitListWidthPx,
  commitListResizing,
  startCommitListResize,
  moveCommitListResize,
  finishCommitListResize,
  resetCommitListWidth,
  splitLayoutRef,
  explorerResizing,
  explorerWidthPx,
  startExplorerResize,
  moveExplorerResize,
  finishExplorerResize,
  resetExplorerWidthPreference,
}: {
  contextMode: 'branch' | 'pull-request';
  pullRequestNumber: number | null;
  commitList: RepoCommitSummary[];
  commitListLoading: boolean;
  selectedCommitSha: string | null;
  onSelectCommit: (sha: string) => void;
  selectedCommit: RepoCommitSummary | null;
  activeCommitDetails:
    | {
        counts: {
          changed: number;
          additions: number;
          deletions: number;
        };
      }
    | null;
  activeCommitDetailsLoading: boolean;
  activeCommitDetailsError: string | null;
  commitEntries: RepoChangeEntry[];
  commitFileSelectedPath: string | null;
  selectedCommitFileEntry: RepoChangeEntry | null;
  onSelectCommitFile: (path: string | null) => void;
  expandedCommitFiles: Record<string, boolean>;
  onToggleCommitFile: (path: string, nextOpen: boolean) => void;
  commitDiffByKey: Record<string, DiffState>;
  commitDiffStateKey: (path: string, sha: string | null | undefined, mode: 'branch' | 'pull-request') => string;
  loadCommitDiff: (args: {
    filePath: string;
    sha: string | null | undefined;
    stateKey: string;
    mode: 'branch' | 'pull-request';
    force?: boolean;
  }) => Promise<void>;
  diffViewType: DiffViewType;
  viewMode: 'stacked' | 'split';
  commitExplorerTree: ExplorerNode[];
  renderCommitExplorer: (nodes: ExplorerNode[], depth: number) => React.ReactNode;
  renderFileQuickActions: (entry: RepoChangeEntry, alwaysVisible?: boolean) => React.ReactNode;
  commitLayoutRef: React.RefObject<HTMLDivElement | null>;
  commitListWidthPx: number;
  commitListResizing: boolean;
  startCommitListResize: React.PointerEventHandler<HTMLDivElement>;
  moveCommitListResize: React.PointerEventHandler<HTMLDivElement>;
  finishCommitListResize: React.PointerEventHandler<HTMLDivElement>;
  resetCommitListWidth: () => void;
  splitLayoutRef: React.RefObject<HTMLDivElement | null>;
  explorerResizing: boolean;
  explorerWidthPx: number;
  startExplorerResize: React.PointerEventHandler<HTMLDivElement>;
  moveExplorerResize: React.PointerEventHandler<HTMLDivElement>;
  finishExplorerResize: React.PointerEventHandler<HTMLDivElement>;
  resetExplorerWidthPreference: () => void;
}) {
  return (
    <div ref={commitLayoutRef} className="flex-1 min-h-0 overflow-hidden flex">
      <div
        className={`shrink-0 border-r border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] overflow-auto ${
          commitListResizing ? '' : 'transition-[width] duration-150 ease-out'
        }`}
        style={{
          width: `${commitListWidthPx}px`,
          minWidth: `${commitListWidthPx}px`,
          maxWidth: `${commitListWidthPx}px`,
        }}
      >
        <div className="sticky top-0 z-10 px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/95 backdrop-blur">
          <div className="text-[9px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            Commit List
          </div>
          <div className="mt-1 text-[10px] text-[var(--muted)]">
            {commitListLoading ? 'Refreshing commits…' : `${commitList.length} commit${commitList.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <div className="p-2 flex flex-col gap-2">
          {commitList.map((commit) => {
            const active = selectedCommitSha === commit.sha;
            const when = formatCommitTimestamp(commit.authoredAt);
            return (
              <button
                key={commit.sha}
                type="button"
                onClick={() => {
                  onSelectCommit(commit.sha);
                  onSelectCommitFile(null);
                }}
                className={`w-full text-left rounded border px-2.5 py-2 transition-colors ${
                  active
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] hover:bg-[var(--hover)]'
                }`}
                title={commit.subject}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-[var(--accent)]">{shortSha(commit.sha)}</span>
                  <span className="text-[9px] text-[var(--muted-dim)]" title={when.title}>
                    {when.short}
                  </span>
                </div>
                <div className="mt-1 text-[11px] font-semibold text-[var(--fg-secondary)] line-clamp-2">{commit.subject}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)] truncate">{commit.authorName || 'Unknown author'}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        className={`group relative w-2 shrink-0 cursor-col-resize touch-none ${
          commitListResizing ? 'bg-[var(--accent-subtle)]' : 'bg-transparent hover:bg-[var(--hover)]'
        }`}
        title="Drag to resize commit list. Double-click to reset."
        onPointerDown={startCommitListResize}
        onPointerMove={moveCommitListResize}
        onPointerUp={finishCommitListResize}
        onPointerCancel={finishCommitListResize}
        onLostPointerCapture={finishCommitListResize}
        onDoubleClick={resetCommitListWidth}
      >
        <span
          className={`pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-px ${
            commitListResizing ? 'bg-[var(--accent)]' : 'bg-[var(--border-subtle)] group-hover:bg-[var(--accent-muted)]'
          }`}
        />
      </div>

      <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
        {!selectedCommit ? (
          <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--muted)]">
            Select a commit to inspect its file-level changes.
          </div>
        ) : activeCommitDetailsError ? (
          <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--red)]">{activeCommitDetailsError}</div>
        ) : activeCommitDetailsLoading && !activeCommitDetails ? (
          <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--muted)]">Loading commit details…</div>
        ) : (
          <>
            <div className="px-2.5 py-2 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[11px] text-[var(--accent)]">{shortSha(selectedCommit.sha)}</span>
                <span className="text-[12px] font-semibold text-[var(--fg-secondary)]">{selectedCommit.subject}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[10px] text-[var(--muted)]">
                <MetaChip label="author" value={selectedCommit.authorName || '-'} />
                <MetaChip
                  label="date"
                  value={formatCommitTimestamp(selectedCommit.authoredAt).short}
                  title={formatCommitTimestamp(selectedCommit.authoredAt).title}
                />
                {contextMode === 'pull-request' ? <MetaChip label="pr" value={`#${pullRequestNumber ?? '-'}`} mono /> : null}
                {activeCommitDetails ? <MetaChip label="files" value={activeCommitDetails.counts.changed} /> : null}
                {activeCommitDetails ? <MetaChip label="+" value={activeCommitDetails.counts.additions} mono /> : null}
                {activeCommitDetails ? <MetaChip label="-" value={activeCommitDetails.counts.deletions} mono /> : null}
              </div>
            </div>

            {commitEntries.length === 0 ? (
              <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--muted)]">This commit has no file diffs to display.</div>
            ) : viewMode === 'stacked' ? (
              <div className="flex-1 min-h-0 overflow-auto px-2 py-2 flex flex-col gap-2">
                {commitEntries.map((entry) => {
                  const open = expandedCommitFiles[entry.path] === true;
                  const key = commitDiffStateKey(entry.path, selectedCommit.sha, contextMode);
                  const state = commitDiffByKey[key];
                  return (
                    <section key={`commit:${selectedCommit.sha}:${entry.path}`} className="group/file rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] overflow-hidden">
                      <div className="px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/70 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center justify-center min-w-[32px] h-5 rounded border text-[10px] font-mono ${badgeTone(entry)}`}
                          title={statusBadgeTitle(entry, 'pull-preview')}
                        >
                          {statusCharLabel(entry.stagedChar)}
                          {statusCharLabel(entry.unstagedChar)}
                        </span>
                        <span className="text-[11px] text-[var(--fg-secondary)] font-mono truncate flex-1" title={entry.path}>
                          {entry.path}
                        </span>
                        {renderFileQuickActions(entry)}
                        <button
                          type="button"
                          onClick={() => {
                            onToggleCommitFile(entry.path, !open);
                            if (!open) {
                              void loadCommitDiff({
                                filePath: entry.path,
                                sha: selectedCommit.sha,
                                stateKey: key,
                                mode: contextMode,
                              });
                            }
                          }}
                          className="h-6 px-2 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
                          title={open ? 'Hide diff' : 'Show diff'}
                        >
                          {open ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      {open ? <DiffBlock state={state} filePath={entry.path} viewType={diffViewType} /> : null}
                    </section>
                  );
                })}
              </div>
            ) : (
              <div ref={splitLayoutRef} className="flex-1 min-h-0 overflow-hidden flex">
                <div className="flex-1 min-w-0 min-h-0 overflow-auto bg-[rgba(0,0,0,.12)]">
                  <div className="sticky top-0 z-10 px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/95 backdrop-blur flex items-center justify-between gap-2">
                    <div className="min-w-0 text-[10px] text-[var(--muted)] font-mono truncate">
                      {selectedCommitFileEntry ? selectedCommitFileEntry.path : 'No file selected'}
                    </div>
                    <div className="inline-flex items-center gap-1">
                      {selectedCommitFileEntry ? renderFileQuickActions(selectedCommitFileEntry, true) : null}
                      <div className="text-[9px] text-[var(--muted-dim)] font-mono whitespace-nowrap">{shortSha(selectedCommit.sha)}</div>
                    </div>
                  </div>
                  {!selectedCommitFileEntry ? (
                    <div className="px-3 py-3 text-[11px] text-[var(--muted)]">Select a changed file to inspect its diff.</div>
                  ) : (
                    <DiffBlock
                      state={commitDiffByKey[commitDiffStateKey(selectedCommitFileEntry.path, selectedCommit.sha, contextMode)]}
                      filePath={selectedCommitFileEntry.path}
                      viewType={diffViewType}
                    />
                  )}
                </div>

                <div
                  role="separator"
                  aria-orientation="vertical"
                  className={`group relative w-2 shrink-0 cursor-col-resize touch-none ${
                    explorerResizing ? 'bg-[var(--accent-subtle)]' : 'bg-transparent hover:bg-[var(--hover)]'
                  }`}
                  title="Drag to resize explorer. Double-click to reset to auto width."
                  onPointerDown={startExplorerResize}
                  onPointerMove={moveExplorerResize}
                  onPointerUp={finishExplorerResize}
                  onPointerCancel={finishExplorerResize}
                  onLostPointerCapture={finishExplorerResize}
                  onDoubleClick={resetExplorerWidthPreference}
                >
                  <span
                    className={`pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-px ${
                      explorerResizing ? 'bg-[var(--accent)]' : 'bg-[var(--border-subtle)] group-hover:bg-[var(--accent-muted)]'
                    }`}
                  />
                </div>

                <div
                  className={`shrink-0 border-l border-[var(--border-subtle)] overflow-hidden flex flex-col ${
                    explorerResizing ? '' : 'transition-[width] duration-150 ease-out'
                  }`}
                  style={{
                    width: `${explorerWidthPx}px`,
                    minWidth: `${explorerWidthPx}px`,
                    maxWidth: `${explorerWidthPx}px`,
                  }}
                >
                  <div className="shrink-0 px-1.5 py-1 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/80 flex items-center justify-between gap-1">
                    <span className="text-[9px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                      Files
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto px-1.5 py-1">{renderCommitExplorer(commitExplorerTree, 0)}</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
