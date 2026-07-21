import React from 'react';
import type {
  AgentRunFileChangeEntry,
  AgentRunFileChanges,
} from '@blip/protocol';

import { IconChevron } from './icons';

function statusLabel(entry: AgentRunFileChangeEntry): string {
  switch (entry.status) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    case 'type-changed':
      return 'T';
    case 'unmerged':
      return 'U';
    case 'modified':
      return 'M';
    default:
      return '?';
  }
}

function statusClass(entry: AgentRunFileChangeEntry): string {
  if (entry.status === 'added') return 'text-[var(--green)]';
  if (entry.status === 'deleted') return 'text-[var(--red)]';
  if (entry.status === 'renamed' || entry.status === 'copied') return 'text-[var(--yellow)]';
  return 'text-[var(--accent)]';
}

function splitPath(filePath: string): { directory: string; name: string } {
  const separator = filePath.lastIndexOf('/');
  if (separator < 0) return { directory: '', name: filePath };
  return {
    directory: filePath.slice(0, separator + 1),
    name: filePath.slice(separator + 1),
  };
}

function FileRow({ entry }: { entry: AgentRunFileChangeEntry }) {
  const pathParts = splitPath(entry.path);
  return (
    <div className="flex w-full items-center gap-2 px-3 py-1.5">
      <span
        className={`w-4 shrink-0 font-mono text-[var(--text-10)] font-[var(--weight-bold)] ${statusClass(entry)}`}
        title={entry.status}
      >
        {statusLabel(entry)}
      </span>
      <span className="min-w-0 flex-1 truncate text-left font-mono text-[var(--text-11)]">
        {pathParts.directory ? (
          <span className="text-[var(--muted-dim)]">{pathParts.directory}</span>
        ) : null}
        <span className="text-[var(--fg-secondary)]">{pathParts.name}</span>
      </span>
      {entry.binary ? (
        <span className="shrink-0 font-mono text-[var(--text-9)] text-[var(--muted-dim)]">binary</span>
      ) : (
        <span className="flex shrink-0 gap-1.5 font-mono text-[var(--text-10)] tabular-nums">
          {entry.additions > 0 ? <span className="text-[var(--green)]">+{entry.additions}</span> : null}
          {entry.deletions > 0 ? <span className="text-[var(--red)]">-{entry.deletions}</span> : null}
        </span>
      )}
    </div>
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
  if (!fileChanges || fileChanges.version !== 1 || fileChanges.counts.changed <= 0) return null;

  const workspaceCount = fileChanges.workspaces.length;
  const changedLabel = `${fileChanges.counts.changed} changed ${fileChanges.counts.changed === 1 ? 'file' : 'files'}`;
  return (
    <section
      className={`mt-3 overflow-hidden rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset-faint)] ${className}`}
      aria-label="Files changed by this agent run"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--hover)] focus-visible:bg-[var(--hover)] focus-visible:outline-none"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--surface-inset-strong)] text-[var(--muted)]">
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 3.5h4M3 8h7M3 12.5h10" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
            <path d="M11 3.5h2M12 2.5v2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
            Changed files
          </span>
          <span className="block truncate text-[var(--text-10)] text-[var(--muted-dim)]">
            {changedLabel}{workspaceCount > 1 ? ` across ${workspaceCount} drones` : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 font-mono text-[var(--text-10)] tabular-nums">
          {fileChanges.counts.additions > 0 ? (
            <span className="text-[var(--green)]">+{fileChanges.counts.additions}</span>
          ) : null}
          {fileChanges.counts.deletions > 0 ? (
            <span className="text-[var(--red)]">-{fileChanges.counts.deletions}</span>
          ) : null}
          <IconChevron className={`h-3 w-3 text-[var(--muted)] transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-[var(--border-subtle)] py-1">
          {fileChanges.workspaces.map((workspace) => (
            <div key={workspace.targetId}>
              {workspaceCount > 1 ? (
                <div className="px-3 pb-1 pt-2 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">
                  {workspace.label}
                </div>
              ) : null}
              {workspace.entries.map((entry) => (
                <FileRow
                  key={`${entry.status}:${entry.originalPath ?? ''}:${entry.path}`}
                  entry={entry}
                />
              ))}
              {workspace.truncated ? (
                <div className="px-3 py-1.5 text-[var(--text-10)] text-[var(--muted-dim)]">
                  Showing the first {workspace.entries.length} files.
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
