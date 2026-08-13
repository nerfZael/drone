import React from 'react';
import type {
  AgentRunFileChangeEntry,
  AgentRunFileChanges,
  AgentRunFileChangeWorkspace,
} from '@blip/protocol';
import {
  agentRunLineChangeBreakdown,
  agentRunNetLineChangeLabel,
  agentRunWorkspacePreviewEntries,
} from '@drone/assistant-chat';

import { DiffBlock } from './DiffBlock';
import { diffZoomStyle } from './diff-zoom-style';
import { useEditorZoomLevel } from '../files/editor-zoom';
import { fileNameForChangesPath } from './helpers';
import type { AgentRunChangesSelection } from './navigation';
import {
  CHANGES_DIFF_VIEW_STORAGE_KEY,
  readChangesStorage,
  writeChangesStorage,
} from './storage';
import type { DiffState, DiffViewType } from './types';
import { AgentRunChangedFilesTree } from '../chat/AgentRunChangedFilesTree';
import {
  agentRunDiffError,
  agentRunDiffKey,
  loadAgentRunDiff,
  loadAgentRunDiffFiles,
  type AgentRunDiffState,
} from '../chat/agent-run-diffs';

const PANEL_METADATA_PAGE_SIZE = 5_000;

type WorkspaceMetadataState =
  | { status: 'loading'; entries: AgentRunFileChangeEntry[] }
  | { status: 'loaded'; entries: AgentRunFileChangeEntry[]; metadataTruncated: boolean }
  | { status: 'error'; entries: AgentRunFileChangeEntry[]; message: string };

type SelectedDiffState = { key: string; state: AgentRunDiffState } | null;

function currentChangesIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9.5 3.5 5 8l4.5 4.5M5.5 8H13"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function expandedParentsForPath(filePath: string | null | undefined): Record<string, boolean> {
  const segments = String(filePath ?? '').split('/').filter(Boolean);
  const expanded: Record<string, boolean> = {};
  for (let index = 1; index < segments.length; index += 1) {
    expanded[segments.slice(0, index).join('/')] = true;
  }
  return expanded;
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

export function AgentRunHistoricalChangesView({
  fileChanges,
  initialSelection,
  onClose,
}: {
  fileChanges: AgentRunFileChanges;
  initialSelection: AgentRunChangesSelection;
  onClose: () => void;
}) {
  const lineChanges = agentRunLineChangeBreakdown(fileChanges.counts);
  const [selection, setSelection] = React.useState(initialSelection);
  const [workspaceMetadata, setWorkspaceMetadata] = React.useState(() =>
    initialWorkspaceMetadata(fileChanges),
  );
  const [metadataRetryNonce, setMetadataRetryNonce] = React.useState(0);
  const [expandedByWorkspace, setExpandedByWorkspace] = React.useState<
    Record<string, Record<string, boolean>>
  >(() => ({
    [initialSelection.workspaceTargetId]: expandedParentsForPath(initialSelection.path),
  }));
  const [viewType, setViewType] = React.useState<DiffViewType>(() =>
    readChangesStorage(CHANGES_DIFF_VIEW_STORAGE_KEY) === 'split' ? 'split' : 'unified',
  );
  const editorZoomLevel = useEditorZoomLevel();
  const [selectedDiff, setSelectedDiff] = React.useState<SelectedDiffState>(null);
  const [diffRetryNonce, setDiffRetryNonce] = React.useState(0);

  React.useEffect(() => {
    writeChangesStorage(CHANGES_DIFF_VIEW_STORAGE_KEY, viewType);
  }, [viewType]);

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
    if (!selectedWorkspace || !selectedPath) return;
    const parents = expandedParentsForPath(selectedPath);
    setExpandedByWorkspace((current) => ({
      ...current,
      [selectedWorkspace.targetId]: {
        ...(current[selectedWorkspace.targetId] ?? {}),
        ...parents,
      },
    }));
  }, [selectedPath, selectedWorkspace]);

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

  const currentDiffState =
    selectedWorkspace && selectedEntry
      ? diffStateForSelection(selectedWorkspace, selectedEntry, selectedDiff)
      : undefined;
  const currentError = selectedDiff?.state.status === 'error' ? selectedDiff.state : null;

  return (
    <div
      data-editor-zoom-surface="historical-changes"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--chat-background)] dh-changes-dock"
      style={diffZoomStyle(editorZoomLevel)}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.12em] text-[var(--muted-dim)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Changes
          </span>
          <span className="h-6 rounded-[var(--radius-medium)] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide leading-6 text-[var(--accent)]">
            Agent run
          </span>
          <span className="font-mono text-[var(--text-9)] tabular-nums text-[var(--muted)]">
            {fileChanges.counts.changed} files
          </span>
          <span
            className="font-mono text-[var(--text-9)] font-[var(--weight-semibold)] tabular-nums text-[var(--accent)]"
            title="Net line change"
            aria-label={`${agentRunNetLineChangeLabel(lineChanges.net)} net lines`}
          >
            {agentRunNetLineChangeLabel(lineChanges.net)}
          </span>
          <span className="text-[var(--muted-dim)]" aria-hidden="true">
            │
          </span>
          <span className="font-mono text-[var(--text-9)] tabular-nums text-[var(--green)]" title="Lines added">
            +{lineChanges.added}
          </span>
          <span className="font-mono text-[var(--text-9)] tabular-nums text-[var(--yellow)]" title="Lines modified">
            ~{lineChanges.modified}
          </span>
          <span className="font-mono text-[var(--text-9)] tabular-nums text-[var(--red)]" title="Lines deleted">
            -{lineChanges.deleted}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="dh-changes-toolbar-group">
            <span className="dh-changes-toolbar-label">Diff</span>
            <div className="dh-changes-segment">
              {(['unified', 'split'] as const).map((nextViewType) => (
                <button
                  key={nextViewType}
                  type="button"
                  onClick={() => setViewType(nextViewType)}
                  aria-pressed={viewType === nextViewType}
                  className={`dh-changes-segment-button ${viewType === nextViewType ? 'is-active' : ''}`}
                >
                  {nextViewType === 'split' ? 'Split' : 'Unified'}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="dh-changes-quiet-button inline-flex items-center gap-1.5"
            aria-label="Return to current changes"
            title="Return to current changes"
          >
            {currentChangesIcon()}
            Current
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-[var(--chat-background)]">
          {selectedEntry ? (
            <div className="min-w-0">
              <div className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/95 px-2.5 backdrop-blur">
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[var(--text-10)] text-[var(--fg-secondary)]"
                  title={
                    selectedEntry.originalPath
                      ? `${selectedEntry.originalPath} → ${selectedEntry.path}`
                      : selectedEntry.path
                  }
                >
                  {fileNameForChangesPath(selectedEntry.path)}
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

        <aside className="flex min-h-0 w-[min(260px,36%)] min-w-[190px] shrink-0 flex-col overflow-hidden border-l border-[var(--border-subtle)] bg-[var(--chat-background)]">
          <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/80 px-2">
            <span className="dh-changes-toolbar-label">Files</span>
            <span className="font-mono text-[var(--text-8)] tabular-nums text-[var(--muted-dim)]">
              {fileChanges.counts.changed}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
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
                    appearance="panel"
                    density="compact"
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
          </div>
        </aside>
      </div>
    </div>
  );
}
