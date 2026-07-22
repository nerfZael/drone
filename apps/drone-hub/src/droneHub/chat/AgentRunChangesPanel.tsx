import React from 'react';
import { createPortal } from 'react-dom';
import type {
  AgentRunFileChangeEntry,
  AgentRunFileChanges,
  AgentRunFileChangeWorkspace,
} from '@blip/protocol';

import { DiffBlock } from '../changes/DiffBlock';
import type { DiffState, DiffViewType } from '../changes/types';
import { AgentRunChangedFilesTree } from './AgentRunChangedFilesTree';
import {
  agentRunDiffError,
  agentRunDiffKey,
  loadAgentRunDiff,
  type AgentRunDiffState,
} from './agent-run-diffs';

export type AgentRunChangesPanelSelection = {
  workspaceTargetId: string;
  path?: string;
};

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

function firstSelection(fileChanges: AgentRunFileChanges): AgentRunChangesPanelSelection | null {
  const workspace = fileChanges.workspaces.find((candidate) => candidate.entries.length > 0);
  const entry = workspace?.entries[0];
  return workspace && entry ? { workspaceTargetId: workspace.targetId, path: entry.path } : null;
}

function diffStateForSelection(
  workspace: AgentRunFileChangeWorkspace,
  entry: AgentRunFileChangeEntry,
  state: AgentRunDiffState | undefined,
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
  const fallbackSelection = React.useMemo(() => firstSelection(fileChanges), [fileChanges]);
  const [selection, setSelection] = React.useState<AgentRunChangesPanelSelection>(
    initialSelection ?? fallbackSelection ?? { workspaceTargetId: '' },
  );
  const [expandedByWorkspace, setExpandedByWorkspace] = React.useState<
    Record<string, Record<string, boolean>>
  >({});
  const [viewType, setViewType] = React.useState<DiffViewType>('unified');
  const [diffs, setDiffs] = React.useState<Record<string, AgentRunDiffState>>({});
  const diffsRef = React.useRef(diffs);
  diffsRef.current = diffs;

  const selectedWorkspace =
    fileChanges.workspaces.find(
      (workspace) => workspace.targetId === selection.workspaceTargetId,
    ) ??
    fileChanges.workspaces[0] ??
    null;
  const selectedEntry =
    selectedWorkspace?.entries.find((entry) => entry.path === selection.path) ??
    selectedWorkspace?.entries[0] ??
    null;
  const selectedArtifactId = selectedWorkspace?.diffArtifactId;
  const selectedDiffKey =
    selectedArtifactId && selectedEntry
      ? agentRunDiffKey(selectedArtifactId, selectedEntry.path)
      : null;

  const requestDiff = React.useCallback((artifactId: string, filePath: string, force = false) => {
    const key = agentRunDiffKey(artifactId, filePath);
    if (!force && diffsRef.current[key]) return;
    setDiffs((current) => ({ ...current, [key]: { status: 'loading' } }));
    void loadAgentRunDiff(artifactId, filePath)
      .then((value) => {
        setDiffs((current) => ({ ...current, [key]: { status: 'loaded', value } }));
      })
      .catch((error: any) => {
        setDiffs((current) => ({ ...current, [key]: agentRunDiffError(error) }));
      });
  }, []);

  React.useEffect(() => {
    if (selectedArtifactId && selectedEntry) requestDiff(selectedArtifactId, selectedEntry.path);
  }, [requestDiff, selectedArtifactId, selectedEntry]);

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
      ? diffStateForSelection(
          selectedWorkspace,
          selectedEntry,
          selectedDiffKey ? diffs[selectedDiffKey] : undefined,
        )
      : undefined;
  const currentError = selectedDiffKey ? diffs[selectedDiffKey] : undefined;
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
                className={`rounded px-2 py-1 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide transition-colors ${
                  viewType === nextViewType
                    ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'text-[var(--muted)] hover:text-[var(--fg-secondary)]'
                }`}
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
            {fileChanges.workspaces.map((workspace) => (
              <div key={workspace.targetId} className="mb-2 last:mb-0">
                {fileChanges.workspaces.length > 1 ||
                workspace.targetId.startsWith('artifacts:') ? (
                  <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">
                    <span className="truncate">{workspace.label}</span>
                    <span className="font-mono tabular-nums">{workspace.counts.changed}</span>
                  </div>
                ) : null}
                <AgentRunChangedFilesTree
                  entries={workspace.entries}
                  expandedDirectories={expandedByWorkspace[workspace.targetId] ?? {}}
                  selectedPath={
                    selectedWorkspace?.targetId === workspace.targetId ? selectedEntry?.path : null
                  }
                  density="comfortable"
                  onToggleDirectory={(directoryPath) => {
                    setExpandedByWorkspace((current) => ({
                      ...current,
                      [workspace.targetId]: {
                        ...(current[workspace.targetId] ?? {}),
                        [directoryPath]: !(current[workspace.targetId]?.[directoryPath] ?? true),
                      },
                    }));
                  }}
                  onSelectFile={(entry) => {
                    setSelection({ workspaceTargetId: workspace.targetId, path: entry.path });
                  }}
                />
                {workspace.truncated ? (
                  <div className="px-2 py-2 text-[var(--text-9)] text-[var(--muted-dim)]">
                    Showing the first {workspace.entries.length} files.
                  </div>
                ) : null}
              </div>
            ))}
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
                  {currentError?.status === 'error' &&
                  currentError.retryable &&
                  selectedArtifactId ? (
                    <button
                      type="button"
                      onClick={() => requestDiff(selectedArtifactId, selectedEntry.path, true)}
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
