import React from 'react';
import type {
  AgentRunFileChangeEntry,
  AgentRunFileChanges,
  AgentRunFileChangeWorkspace,
} from '@blip/protocol';
import { agentRunWorkspacePreviewEntries, isAgentRunFileChanges } from '@drone/assistant-chat';

import { IconChevron } from '../icons';
import { requestAgentRunChanges, type AgentRunChangesSelection } from '../changes/navigation';
import { AgentRunChangedFilesTree } from './AgentRunChangedFilesTree';
import { agentRunDiffError, loadAgentRunDiffFiles } from './agent-run-diffs';

const CARD_PAGE_SIZE = 20;

function changesIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 3.5h4M3 8h7M3 12.5h10"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path d="M11 3.5h2M12 2.5v2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function openPanelIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 3.5h11v9h-11z" stroke="currentColor" strokeWidth="1.25" />
      <path d="M6 3.5v9" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M8.5 6h2.5M8.5 8.5h3"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WorkspaceFiles({
  workspace,
  onSelectFile,
}: {
  workspace: AgentRunFileChangeWorkspace;
  onSelectFile: (entry: AgentRunFileChangeEntry) => void;
}) {
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
  }, [legacyEntries, retryNonce, workspace]);

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
}: {
  fileChanges?: AgentRunFileChanges | null;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  if (!isAgentRunFileChanges(fileChanges)) return null;

  const workspaceCount = fileChanges.workspaces.length;
  const changedLabel = `${fileChanges.counts.changed} changed ${fileChanges.counts.changed === 1 ? 'file' : 'files'}`;
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
      className={`mt-3 overflow-hidden rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset-faint)] ${className}`}
      aria-label="Files changed by this agent run"
    >
      <div className="flex items-stretch">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--hover)] focus-visible:bg-[var(--hover)] focus-visible:outline-none"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--surface-inset-strong)] text-[var(--muted)]">
            {changesIcon()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
              Changed files
            </span>
            <span className="block truncate text-[var(--text-10)] text-[var(--muted-dim)]">
              {changedLabel}
              {workspaceCount > 1 ? ` across ${workspaceCount} workspaces` : ''}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 font-mono text-[var(--text-10)] tabular-nums">
            {fileChanges.counts.additions > 0 ? (
              <span className="text-[var(--green)]">+{fileChanges.counts.additions}</span>
            ) : null}
            {fileChanges.counts.deletions > 0 ? (
              <span className="text-[var(--red)]">-{fileChanges.counts.deletions}</span>
            ) : null}
            <IconChevron down={expanded} className="text-[var(--muted)]" size={12} />
          </span>
        </button>
        <button
          type="button"
          onClick={() => openPanel()}
          disabled={!canOpenPanel}
          className="flex w-10 shrink-0 items-center justify-center border-l border-[var(--border-subtle)] text-[var(--muted)] transition-colors hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)] focus-visible:bg-[var(--accent-subtle)] focus-visible:text-[var(--accent)] focus-visible:outline-none disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--muted)]"
          aria-label="Open agent run changes in the Changes panel"
          title="Open in Changes"
        >
          {openPanelIcon()}
        </button>
      </div>
      {expanded ? (
        <div className="border-t border-[var(--border-subtle)] px-1.5 py-1.5">
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
