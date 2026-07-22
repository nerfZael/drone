import React from 'react';
import type { AgentRunFileChanges } from '@blip/protocol';

import { IconChevron } from '../icons';
import { AgentRunChangedFilesTree } from './AgentRunChangedFilesTree';
import type { AgentRunChangesPanelSelection } from './AgentRunChangesPanel';

const AgentRunChangesPanel = React.lazy(async () => ({
  default: (await import('./AgentRunChangesPanel')).AgentRunChangesPanel,
}));

function ChangesPanelLoading() {
  return (
    <div className="fixed inset-0 z-[80] bg-[var(--scrim-soft)]" aria-label="Loading changes panel">
      <div className="absolute inset-y-0 right-0 w-full max-w-[min(1120px,94vw)] border-l border-[var(--border-subtle)] bg-[var(--surface-raised)] shadow-2xl">
        <div className="h-14 animate-pulse border-b border-[var(--border-subtle)] bg-[var(--surface-inset-faint)]" />
      </div>
    </div>
  );
}

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

export function ChangedFilesCard({
  fileChanges,
  className = '',
}: {
  fileChanges?: AgentRunFileChanges | null;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [expandedByWorkspace, setExpandedByWorkspace] = React.useState<
    Record<string, Record<string, boolean>>
  >({});
  const [panelSelection, setPanelSelection] = React.useState<AgentRunChangesPanelSelection | null>(
    null,
  );
  if (!fileChanges || fileChanges.version !== 1 || fileChanges.counts.changed <= 0) return null;

  const workspaceCount = fileChanges.workspaces.length;
  const changedLabel = `${fileChanges.counts.changed} changed ${fileChanges.counts.changed === 1 ? 'file' : 'files'}`;
  const firstWorkspace = fileChanges.workspaces.find((workspace) => workspace.entries.length > 0);
  const firstEntry = firstWorkspace?.entries[0];
  const openPanel = (selection?: AgentRunChangesPanelSelection) => {
    const next =
      selection ??
      (firstWorkspace && firstEntry
        ? { workspaceTargetId: firstWorkspace.targetId, path: firstEntry.path }
        : null);
    if (next) setPanelSelection(next);
  };

  return (
    <>
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
            disabled={!firstEntry}
            className="flex w-10 shrink-0 items-center justify-center border-l border-[var(--border-subtle)] text-[var(--muted)] transition-colors hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)] focus-visible:bg-[var(--accent-subtle)] focus-visible:text-[var(--accent)] focus-visible:outline-none disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--muted)]"
            aria-label="Open agent run changes panel"
            title="View agent run changes"
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
                <AgentRunChangedFilesTree
                  entries={workspace.entries}
                  expandedDirectories={expandedByWorkspace[workspace.targetId] ?? {}}
                  onToggleDirectory={(directoryPath) => {
                    setExpandedByWorkspace((current) => ({
                      ...current,
                      [workspace.targetId]: {
                        ...(current[workspace.targetId] ?? {}),
                        [directoryPath]: !(current[workspace.targetId]?.[directoryPath] ?? true),
                      },
                    }));
                  }}
                  onSelectFile={(entry) =>
                    openPanel({ workspaceTargetId: workspace.targetId, path: entry.path })
                  }
                />
                {workspace.truncated ? (
                  <div className="px-2 py-1.5 text-[var(--text-10)] text-[var(--muted-dim)]">
                    Showing the first {workspace.entries.length} files.
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {panelSelection ? (
        <React.Suspense fallback={<ChangesPanelLoading />}>
          <AgentRunChangesPanel
            fileChanges={fileChanges}
            initialSelection={panelSelection}
            onClose={() => setPanelSelection(null)}
          />
        </React.Suspense>
      ) : null}
    </>
  );
}
