import React from 'react';
import { createPortal } from 'react-dom';
import type {
  AgentRunFileChangeEntry,
  AgentRunFileChanges,
  AgentRunFileChangeWorkspace,
} from '@blip/protocol';
import { agentRunWorkspacePreviewEntries } from '@drone/assistant-chat';

import { DiffBlock } from '../changes/DiffBlock';
import type { DiffState, DiffViewType } from '../changes/types';
import { AgentRunChangedFilesTree } from './AgentRunChangedFilesTree';
import {
  agentRunDiffError,
  agentRunDiffKey,
  loadAgentRunDiff,
  loadAgentRunDiffFiles,
  type AgentRunDiffState,
} from './agent-run-diffs';

const PANEL_METADATA_PAGE_SIZE = 5_000;

export type AgentRunChangesPanelSelection = {
  workspaceTargetId: string;
  path?: string;
};

type WorkspaceMetadataState =
  | { status: 'loading'; entries: AgentRunFileChangeEntry[] }
  | { status: 'loaded'; entries: AgentRunFileChangeEntry[]; metadataTruncated: boolean }
  | { status: 'error'; entries: AgentRunFileChangeEntry[]; message: string };

type SelectedDiffState = { key: string; state: AgentRunDiffState } | null;

function closeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 3.5l9 9m0-9l-9 9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function initialWorkspaceMetadata(
  fileChanges: AgentRunFileChanges,
): Record<string, WorkspaceMetadataState> {
  return Object.fromEntries(
    fileChanges.workspaces.map((workspace) => [
      workspace.targetId,
      'entries' in workspace
        ? {
            status: 'loaded',
            entries: workspace.entries,
            metadataTruncated: workspace.truncated === true,
          }
        : { status: 'loading', entries: workspace.previewEntries },
    ]),
  );
}

async function loadCompleteWorkspaceMetadata(
  workspace: AgentRunFileChangeWorkspace,
  signal: AbortSignal,
): Promise<{ entries: AgentRunFileChangeEntry[]; metadataTruncated: boolean }> {
  if ('entries' in workspace) {
    return { entries: workspace.entries, metadataTruncated: workspace.truncated === true };
  }
  if (!workspace.diffArtifactId) {
    return {
      entries: workspace.previewEntries,
      metadataTruncated: workspace.metadataTruncated === true,
    };
  }
  const entries: AgentRunFileChangeEntry[] = [];
  let offset: number | null = 0;
  let metadataTruncated = workspace.metadataTruncated === true;
  while (offset != null) {
    const page = await loadAgentRunDiffFiles(workspace.diffArtifactId, {
      offset,
      limit: PANEL_METADATA_PAGE_SIZE,
      signal,
    });
    entries.push(...page.entries);
    metadataTruncated ||= page.metadataTruncated;
    offset = page.nextOffset;
  }
  return { entries, metadataTruncated };
}

function diffStateForSelection(
  workspace: AgentRunFileChangeWorkspace,
  entry: AgentRunFileChangeEntry,
  selectedDiff: SelectedDiffState,
): DiffState {
  if (!workspace.diffArtifactId) {
    return {
      status: 'loaded',
      text: '',
      truncated: false,
      fromUntracked: false,
      isBinary: entry.binary === true,
      noTextReason: entry.binary ? 'binary' : 'unavailable',
      contextLines: 3,
    };
  }
  const key = agentRunDiffKey(workspace.diffArtifactId, entry.path);
  const state = selectedDiff?.key === key ? selectedDiff.state : undefined;
  if (!state || state.status === 'loading') return { status: 'loading' };
  if (state.status === 'error') return { status: 'error', error: state.message };
  return {
    status: 'loaded',
    text: state.value.patch,
    truncated: state.value.truncated,
    fromUntracked: entry.status === 'added',
    isBinary: entry.binary === true,
    noTextReason: entry.binary ? 'binary' : state.value.patch.trim() ? null : 'empty',
    contextLines: 3,
  };
}

export function AgentRunChangesPanel({
  fileChanges,
  initialSelection,
  onClose,
}: {
  fileChanges: AgentRunFileChanges;
  initialSelection: AgentRunChangesPanelSelection;
  onClose: () => void;
}) {
  const [selection, setSelection] = React.useState(initialSelection);
  const [workspaceMetadata, setWorkspaceMetadata] = React.useState(() =>
    initialWorkspaceMetadata(fileChanges),
  );
  const [metadataRetryNonce, setMetadataRetryNonce] = React.useState(0);
  const [expandedByWorkspace, setExpandedByWorkspace] = React.useState<
    Record<string, Record<string, boolean>>
  >({});
  const [viewType, setViewType] = React.useState<DiffViewType>('unified');
  const [selectedDiff, setSelectedDiff] = React.useState<SelectedDiffState>(null);
  const [diffRetryNonce, setDiffRetryNonce] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    for (const workspace of fileChanges.workspaces) {
      if ('entries' in workspace) continue;
      setWorkspaceMetadata((current) => ({
        ...current,
        [workspace.targetId]: {
          status: 'loading',
          entries: current[workspace.targetId]?.entries ?? workspace.previewEntries,
        },
      }));
      void loadCompleteWorkspaceMetadata(workspace, controller.signal)
        .then((result) => {
          setWorkspaceMetadata((current) => ({
            ...current,
            [workspace.targetId]: { status: 'loaded', ...result },
          }));
        })
        .catch((error: any) => {
          if (error?.name === 'AbortError') return;
          setWorkspaceMetadata((current) => ({
            ...current,
            [workspace.targetId]: {
              status: 'error',
              entries: current[workspace.targetId]?.entries ?? workspace.previewEntries,
              message: agentRunDiffError(error).message,
            },
          }));
        });
    }
    return () => controller.abort();
  }, [fileChanges, metadataRetryNonce]);

  const selectedWorkspace =
    fileChanges.workspaces.find(
      (workspace) => workspace.targetId === selection.workspaceTargetId,
    ) ??
    fileChanges.workspaces[0] ??
    null;
  const selectedWorkspaceEntries = selectedWorkspace
    ? (workspaceMetadata[selectedWorkspace.targetId]?.entries ??
      agentRunWorkspacePreviewEntries(selectedWorkspace))
    : [];
  const selectedEntry =
    selectedWorkspaceEntries.find((entry) => entry.path === selection.path) ??
    selectedWorkspaceEntries[0] ??
    null;
  const selectedArtifactId = selectedWorkspace?.diffArtifactId;
  const selectedPath = selectedEntry?.path;

  React.useEffect(() => {
    if (!selectedWorkspace || selection.path || selectedWorkspaceEntries.length === 0) return;
    setSelection({
      workspaceTargetId: selectedWorkspace.targetId,
      path: selectedWorkspaceEntries[0]!.path,
    });
  }, [selectedWorkspace, selectedWorkspaceEntries, selection.path]);

  React.useEffect(() => {
    if (!selectedArtifactId || !selectedPath) {
      setSelectedDiff(null);
      return;
    }
    const key = agentRunDiffKey(selectedArtifactId, selectedPath);
    const controller = new AbortController();
    setSelectedDiff({ key, state: { status: 'loading' } });
    void loadAgentRunDiff(selectedArtifactId, selectedPath, controller.signal)
      .then((value) => setSelectedDiff({ key, state: { status: 'loaded', value } }))
      .catch((error: any) => {
        if (error?.name === 'AbortError') return;
        setSelectedDiff({ key, state: agentRunDiffError(error) });
      });
    return () => controller.abort();
  }, [diffRetryNonce, selectedArtifactId, selectedPath]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  React.useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const currentDiffState =
    selectedWorkspace && selectedEntry
      ? diffStateForSelection(selectedWorkspace, selectedEntry, selectedDiff)
      : undefined;
  const currentError = selectedDiff?.state.status === 'error' ? selectedDiff.state : null;

  const panel = (
    <div
      className="fixed inset-0 z-[90] bg-[var(--scrim-soft)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Agent run changes"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="absolute inset-y-0 right-0 flex w-[min(1120px,calc(100vw-32px))] flex-col border-l border-[var(--border)] bg-[var(--panel-alt)] shadow-[-24px_0_72px_var(--shadow-color)] max-sm:w-full">
        <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-softest)] px-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="text-[var(--text-12)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--fg-strong)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Agent run changes
              </span>
              <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-0.5 font-mono text-[var(--text-9)] tabular-nums text-[var(--muted)] max-sm:hidden">
                {fileChanges.counts.changed} files
              </span>
              <span className="font-mono text-[var(--text-10)] tabular-nums text-[var(--green)] max-sm:hidden">
                +{fileChanges.counts.additions}
              </span>
              <span className="font-mono text-[var(--text-10)] tabular-nums text-[var(--red)] max-sm:hidden">
                -{fileChanges.counts.deletions}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[var(--text-10)] text-[var(--muted-dim)]">
              {selectedEntry?.path ?? 'Select a changed file'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-0.5 max-sm:hidden">
            {(['unified', 'split'] as const).map((nextViewType) => (
              <button
                key={nextViewType}
                type="button"
                onClick={() => setViewType(nextViewType)}
                aria-pressed={viewType === nextViewType}
                className={`rounded px-2 py-1 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide transition-colors ${viewType === nextViewType ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--fg-secondary)]'}`}
              >
                {nextViewType}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] transition-colors hover:border-[var(--border)] hover:text-[var(--fg)]"
            aria-label="Close agent run changes"
            title="Close"
          >
            {closeIcon()}
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] max-md:grid-cols-[220px_minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[minmax(180px,34vh)_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface-inset-faint)] px-2 py-2 max-sm:border-b max-sm:border-r-0">
            {fileChanges.workspaces.map((workspace) => {
              const metadata = workspaceMetadata[workspace.targetId];
              const entries = metadata?.entries ?? agentRunWorkspacePreviewEntries(workspace);
              return (
                <div key={workspace.targetId} className="mb-2 last:mb-0">
                  {fileChanges.workspaces.length > 1 ||
                  workspace.targetId.startsWith('artifacts:') ? (
                    <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">
                      <span className="truncate">{workspace.label}</span>
                      <span className="font-mono tabular-nums">{workspace.counts.changed}</span>
                    </div>
                  ) : null}
                  <AgentRunChangedFilesTree
                    entries={entries}
                    expandedDirectories={expandedByWorkspace[workspace.targetId] ?? {}}
                    defaultDirectoriesExpanded={false}
                    initialVisibleRows={200}
                    selectedPath={
                      selectedWorkspace?.targetId === workspace.targetId
                        ? selectedEntry?.path
                        : null
                    }
                    density="comfortable"
                    onToggleDirectory={(directoryPath) =>
                      setExpandedByWorkspace((current) => ({
                        ...current,
                        [workspace.targetId]: {
                          ...(current[workspace.targetId] ?? {}),
                          [directoryPath]: !(current[workspace.targetId]?.[directoryPath] ?? false),
                        },
                      }))
                    }
                    onSelectFile={(entry) =>
                      setSelection({ workspaceTargetId: workspace.targetId, path: entry.path })
                    }
                  />
                  {metadata?.status === 'loading' ? (
                    <div className="px-2 py-2 text-[var(--text-9)] text-[var(--muted-dim)]">
                      Loading complete file list…
                    </div>
                  ) : null}
                  {metadata?.status === 'error' ? (
                    <div className="flex items-center justify-between gap-2 px-2 py-2 text-[var(--text-9)] text-[var(--red)]">
                      <span className="min-w-0 truncate">{metadata.message}</span>
                      <button
                        type="button"
                        className="shrink-0 font-[var(--weight-semibold)] hover:underline"
                        onClick={() => setMetadataRetryNonce((value) => value + 1)}
                      >
                        Retry
                      </button>
                    </div>
                  ) : null}
                  {metadata?.status === 'loaded' && metadata.metadataTruncated ? (
                    <div className="px-2 py-2 text-[var(--text-9)] text-[var(--muted-dim)]">
                      Stored list limited to 5,000 files.
                    </div>
                  ) : null}
                </div>
              );
            })}
          </aside>

          <main className="min-h-0 overflow-auto bg-[var(--panel)]">
            {selectedEntry ? (
              <div className="min-w-[620px] max-sm:min-w-full">
                <div className="sticky top-0 z-10 flex min-h-9 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3">
                  <span className="min-w-0 flex-1 truncate font-mono text-[var(--text-10)] text-[var(--fg-secondary)]">
                    {selectedEntry.originalPath
                      ? `${selectedEntry.originalPath} → ${selectedEntry.path}`
                      : selectedEntry.path}
                  </span>
                  {currentError?.retryable ? (
                    <button
                      type="button"
                      onClick={() => setDiffRetryNonce((value) => value + 1)}
                      className="rounded border border-[var(--red-border)] px-2 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--red)] hover:bg-[var(--red-subtle)]"
                    >
                      Retry
                    </button>
                  ) : null}
                </div>
                <DiffBlock
                  state={currentDiffState}
                  filePath={selectedEntry.path}
                  viewType={viewType}
                />
              </div>
            ) : (
              <div className="flex h-full min-h-64 items-center justify-center px-6 text-center text-[var(--text-11)] text-[var(--muted)]">
                No changed file is available for this run.
              </div>
            )}
          </main>
        </div>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? panel : createPortal(panel, document.body);
}
