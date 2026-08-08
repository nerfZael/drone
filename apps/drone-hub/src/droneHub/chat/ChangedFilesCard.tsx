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
  isAgentRunFileChanges,
} from '@drone/assistant-chat';

import { IconChevron } from '../icons';
import { requestAgentRunChanges, type AgentRunChangesSelection } from '../changes/navigation';
import { AgentRunChangedFilesTree } from './AgentRunChangedFilesTree';
import { agentRunDiffError, loadAgentRunDiffFiles } from './agent-run-diffs';

const CARD_PAGE_SIZE = 20;

function WorkspaceFiles({
  workspace,
  onSelectFile,
}: {
  workspace: AgentRunFileChangeWorkspace;
  onSelectFile: (entry: AgentRunFileChangeEntry) => void;
}) {
  const attributionUnavailable =
    'attribution' in workspace && workspace.attribution === 'unavailable';
  const legacyEntries = 'entries' in workspace ? workspace.entries : null;
  const [entries, setEntries] = React.useState<AgentRunFileChangeEntry[]>(legacyEntries ?? []);
  const [nextOffset, setNextOffset] = React.useState<number | null>(
    legacyEntries && legacyEntries.length > CARD_PAGE_SIZE ? CARD_PAGE_SIZE : null,
  );
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'loaded' | 'error'>(
    legacyEntries ? 'loaded' : 'idle',
  );
  const [error, setError] = React.useState('');
  const [retryNonce, setRetryNonce] = React.useState(0);
  const [expandedDirectories, setExpandedDirectories] = React.useState<Record<string, boolean>>({});
  const visibleEntries = legacyEntries
    ? legacyEntries.slice(0, nextOffset ?? legacyEntries.length)
    : entries;

  React.useEffect(() => {
    if (attributionUnavailable) return;
    if (legacyEntries) return;
    if (!workspace.diffArtifactId) {
      setEntries(agentRunWorkspacePreviewEntries(workspace));
      setNextOffset(null);
      setStatus('loaded');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    setError('');
    void loadAgentRunDiffFiles(workspace.diffArtifactId, {
      offset: 0,
      limit: CARD_PAGE_SIZE,
      signal: controller.signal,
    })
      .then((result) => {
        setEntries(result.entries);
        setNextOffset(result.nextOffset);
        setStatus('loaded');
      })
      .catch((reason: any) => {
        if (reason?.name === 'AbortError') return;
        setStatus('error');
        setError(agentRunDiffError(reason).message);
      });
    return () => controller.abort();
  }, [attributionUnavailable, legacyEntries, retryNonce, workspace]);

  const loadMore = () => {
    if (legacyEntries) {
      const next = Math.min(legacyEntries.length, (nextOffset ?? 0) + CARD_PAGE_SIZE);
      setNextOffset(next < legacyEntries.length ? next : null);
      return;
    }
    if (!workspace.diffArtifactId || nextOffset == null || status === 'loading') return;
    setStatus('loading');
    setError('');
    void loadAgentRunDiffFiles(workspace.diffArtifactId, {
      offset: nextOffset,
      limit: CARD_PAGE_SIZE,
    })
      .then((result) => {
        setEntries((current) => [...current, ...result.entries]);
        setNextOffset(result.nextOffset);
        setStatus('loaded');
      })
      .catch((reason: any) => {
        setStatus('error');
        setError(agentRunDiffError(reason).message);
      });
  };

  if (attributionUnavailable) {
    return (
      <div className="px-2 py-1.5 text-[var(--text-10)] text-[var(--yellow)]">
        Exact attribution is unavailable for this workspace.
      </div>
    );
  }

  if (status === 'loading' && visibleEntries.length === 0) {
    return (
      <div className="px-2 py-2 text-[var(--text-10)] text-[var(--muted-dim)]">
        Loading changed files…
      </div>
    );
  }
  if (status === 'error' && visibleEntries.length === 0) {
    return (
      <div className="flex items-center justify-between gap-2 px-2 py-2 text-[var(--text-10)] text-[var(--red)]">
        <span className="min-w-0 truncate">{error}</span>
        <button
          type="button"
          className="shrink-0 font-[var(--weight-semibold)] hover:underline"
          onClick={() => setRetryNonce((value) => value + 1)}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <AgentRunChangedFilesTree
        entries={visibleEntries}
        expandedDirectories={expandedDirectories}
        onToggleDirectory={(directoryPath) =>
          setExpandedDirectories((current) => ({
            ...current,
            [directoryPath]: !(current[directoryPath] ?? true),
          }))
        }
        onSelectFile={onSelectFile}
      />
      {nextOffset != null ? (
        <button
          type="button"
          disabled={status === 'loading'}
          onClick={loadMore}
          className="mt-1 w-full rounded-[var(--radius-small)] px-2 py-1.5 text-left text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--accent)] hover:bg-[var(--hover)] disabled:text-[var(--muted-dim)]"
        >
          {status === 'loading' ? 'Loading…' : `Show ${CARD_PAGE_SIZE} more`}
        </button>
      ) : null}
      {status === 'error' && visibleEntries.length > 0 ? (
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[var(--text-10)] text-[var(--red)]">
          <span>{error}</span>
          <button
            type="button"
            className="font-[var(--weight-semibold)] hover:underline"
            onClick={loadMore}
          >
            Retry
          </button>
        </div>
      ) : null}
      {'metadataTruncated' in workspace && workspace.metadataTruncated ? (
        <div className="px-2 py-1.5 text-[var(--text-10)] text-[var(--muted-dim)]">
          The stored list is limited to 5,000 files.
        </div>
      ) : 'truncated' in workspace && workspace.truncated ? (
        <div className="px-2 py-1.5 text-[var(--text-10)] text-[var(--muted-dim)]">
          This older run contains a partial file list.
        </div>
      ) : null}
    </>
  );
}

export function ChangedFilesCard({
  fileChanges,
  className = '',
  initiallyExpanded = false,
}: {
  fileChanges?: AgentRunFileChanges | null;
  className?: string;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(initiallyExpanded);
  const previousInitiallyExpanded = React.useRef(initiallyExpanded);
  React.useEffect(() => {
    if (previousInitiallyExpanded.current === initiallyExpanded) return;
    previousInitiallyExpanded.current = initiallyExpanded;
    setExpanded(initiallyExpanded);
  }, [initiallyExpanded]);
  if (!isAgentRunFileChanges(fileChanges)) return null;

  const attribution = fileChanges.version === 2 ? fileChanges.attribution : undefined;
  const attributionUnavailable = attribution === 'unavailable';
  const attributionNormalized = attribution === 'base-normalized';
  const attributionPartial = attribution === 'partial';
  const lineChanges = agentRunLineChangeBreakdown(fileChanges.counts);
  const workspaceCount = fileChanges.workspaces.length;
  const firstWorkspace = fileChanges.workspaces.find((workspace) => workspace.counts.changed > 0);
  const firstEntry = firstWorkspace
    ? agentRunWorkspacePreviewEntries(firstWorkspace)[0]
    : undefined;
  const canOpenPanel = Boolean(firstWorkspace && (firstEntry || firstWorkspace.diffArtifactId));
  const openPanel = (selection?: AgentRunChangesSelection) => {
    const next =
      selection ??
      (firstWorkspace
        ? { workspaceTargetId: firstWorkspace.targetId, path: firstEntry?.path }
        : null);
    if (!next) return;
    requestAgentRunChanges({
      fileChanges,
      initialSelection: next,
      ...(firstWorkspace?.droneId ? { droneId: firstWorkspace.droneId } : {}),
    });
  };

  return (
    <section
      className={`mt-2 overflow-hidden rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--muted)] ${className}`}
      aria-label="Files changed by this agent run"
    >
      <div className="flex items-stretch">
        <button
          type="button"
          disabled={attributionUnavailable}
          className={`group/changed-files-header flex min-w-0 flex-1 items-center px-1 pt-1 text-left focus-visible:outline-none ${
            expanded ? 'pb-0' : 'pb-1'
          }`}
          onClick={() => {
            if (!attributionUnavailable) setExpanded((current) => !current);
          }}
          aria-expanded={attributionUnavailable ? undefined : expanded}
        >
          <span
            className={`inline-flex min-w-0 max-w-full items-center gap-2 px-2 pt-1 ${
              expanded ? 'pb-0.5' : 'pb-1'
            }`}
          >
            <span className="min-w-0 truncate text-[var(--text-10-5)] font-[var(--weight-semibold)] text-[var(--muted)] transition-colors group-hover/changed-files-header:text-[var(--fg)] group-focus-visible/changed-files-header:text-[var(--fg)]">
              Changed files{' '}
              <span className="text-[var(--muted-dim)] transition-colors group-hover/changed-files-header:text-[var(--muted)] group-focus-visible/changed-files-header:text-[var(--muted)]">
                {attributionUnavailable ? '(unavailable)' : `(${fileChanges.counts.changed})`}
              </span>
            </span>
            {!attributionUnavailable ? (
              <span className="flex shrink-0 items-center gap-1.5 font-mono text-[var(--text-10)] tabular-nums opacity-80 transition-opacity group-hover/changed-files-header:opacity-100 group-focus-visible/changed-files-header:opacity-100">
                <span className="text-[var(--green)]" title="Lines added">
                  +{lineChanges.added}
                </span>
                <span className="text-[var(--yellow)]" title="Lines modified">
                  ~{lineChanges.modified}
                </span>
                <span className="text-[var(--red)]" title="Lines deleted">
                  -{lineChanges.deleted}
                </span>
                <span className="mx-0.5 text-[var(--muted-dim)]" aria-hidden="true">
                  │
                </span>
                <span
                  className="font-[var(--weight-semibold)] text-[var(--accent)]"
                  title="Net line change"
                  aria-label={`${agentRunNetLineChangeLabel(lineChanges.net)} net lines`}
                >
                  {agentRunNetLineChangeLabel(lineChanges.net)}
                </span>
              </span>
            ) : null}
            {attributionNormalized ? (
              <span
                className="shrink-0 rounded-full bg-[var(--accent-subtle)] px-1.5 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--accent)]"
                title="Base branch movement was excluded from this summary"
              >
                Base normalized
              </span>
            ) : null}
            {attributionPartial ? (
              <span
                className="shrink-0 rounded-full bg-[var(--yellow-subtle)] px-1.5 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--yellow)]"
                title="Some workspaces could not be attributed exactly"
              >
                Partial
              </span>
            ) : null}
            {!attributionUnavailable ? (
              <IconChevron
                down={expanded}
                className="shrink-0 text-[var(--muted)] transition-colors group-hover/changed-files-header:text-[var(--accent)] group-focus-visible/changed-files-header:text-[var(--accent)]"
                size={12}
              />
            ) : null}
          </span>
        </button>
        <button
          type="button"
          data-changed-files-view-diff="true"
          onClick={() => openPanel()}
          disabled={!canOpenPanel}
          className="mr-2 shrink-0 self-center rounded-[var(--radius-small)] px-1 py-1 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--link)] underline-offset-2 transition-colors hover:text-[var(--link-hover)] hover:underline focus-visible:text-[var(--link-hover)] focus-visible:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-muted)] disabled:cursor-default disabled:text-[var(--muted-dim)] disabled:no-underline"
          aria-label="View agent run diff in the Changes panel"
          title="View diff in Changes"
        >
          View diff
        </button>
      </div>
      {attributionUnavailable ? (
        <div className="px-3 pb-2 text-[var(--text-10)] text-[var(--yellow)]">
          The base branch changed during this run, and the starting changes could not be replayed
          safely. Exact changed-file attribution is unavailable.
        </div>
      ) : null}
      {attributionPartial ? (
        <div className="px-3 pb-2 text-[var(--text-10)] text-[var(--yellow)]">
          Some workspaces could not be attributed exactly. Totals include only attributed
          workspaces.
        </div>
      ) : null}
      {expanded ? (
        <div className="dh-changed-files-scrollbar mx-1 max-h-72 overflow-y-auto overscroll-contain rounded-[var(--radius-small)] px-1.5 pb-1.5 pt-0">
          {fileChanges.workspaces.map((workspace) => (
            <div key={workspace.targetId}>
              {workspaceCount > 1 || workspace.targetId.startsWith('artifacts:') ? (
                <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">
                  <span className="truncate">{workspace.label}</span>
                  <span className="font-mono tabular-nums">{workspace.counts.changed}</span>
                </div>
              ) : null}
              <WorkspaceFiles
                workspace={workspace}
                onSelectFile={(entry) =>
                  openPanel({ workspaceTargetId: workspace.targetId, path: entry.path })
                }
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
