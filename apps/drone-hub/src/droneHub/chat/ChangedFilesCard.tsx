import React from 'react';
import type { AgentRunFileChangeEntry, AgentRunFileChanges } from '@blip/protocol';

import { IconChevron } from './icons';
import { requestJson } from '../http';

type LoadedHistoricalDiff = {
  patch: string;
  truncated: boolean;
};

type HistoricalDiffState =
  | { status: 'loading' }
  | { status: 'loaded'; value: LoadedHistoricalDiff }
  | { status: 'error'; message: string };

const MAX_RENDERED_DIFF_LINES = 2_500;

async function loadHistoricalDiff(
  artifactId: string,
  filePath: string,
): Promise<LoadedHistoricalDiff> {
  const result = await requestJson<{
    ok: true;
    diff: { patch: string; truncated?: boolean };
  }>(
    `/api/agent-run-diffs/${encodeURIComponent(artifactId)}/file?path=${encodeURIComponent(filePath)}`,
  );
  return {
    patch: String(result.diff?.patch ?? ''),
    truncated: result.diff?.truncated === true,
  };
}

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

function diffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-[var(--muted)]';
  if (line.startsWith('+')) return 'bg-[var(--green-subtle)] text-[var(--green)]';
  if (line.startsWith('-')) return 'bg-[var(--red-subtle)] text-[var(--red)]';
  if (line.startsWith('@@')) return 'text-[var(--accent)]';
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'text-[var(--muted-dim)]';
  return 'text-[var(--fg-secondary)]';
}

function HistoricalDiffPanel({
  state,
  onRetry,
}: {
  state: HistoricalDiffState;
  onRetry: () => void;
}) {
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-3 text-[var(--text-10)] text-[var(--muted)]">
        <span className="h-3 w-3 animate-spin rounded-full border border-[var(--border)] border-t-[var(--accent)]" />
        Loading historical diff…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--red-subtle)] px-3 py-2.5 text-[var(--text-10)] text-[var(--red)]">
        <span>{state.message}</span>
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded border border-[var(--red-border)] px-2 py-1 font-[var(--weight-semibold)] hover:bg-[var(--surface-inset)]"
        >
          Retry
        </button>
      </div>
    );
  }
  const allLines = state.value.patch.split('\n');
  const visibleLines = allLines.slice(0, MAX_RENDERED_DIFF_LINES);
  const previewTruncated = state.value.truncated || allLines.length > visibleLines.length;
  return (
    <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-inset)]">
      <div className="max-h-[420px] overflow-auto py-2 font-mono text-[var(--text-10)] leading-[1.55]">
        {visibleLines.map((line, index) => (
          <div key={index} className={`min-w-max whitespace-pre px-3 ${diffLineClass(line)}`}>
            {line || ' '}
          </div>
        ))}
      </div>
      {previewTruncated ? (
        <div className="border-t border-[var(--border-subtle)] px-3 py-1.5 text-[var(--text-9)] text-[var(--muted-dim)]">
          Diff preview was limited for performance.
        </div>
      ) : null}
    </div>
  );
}

function FileRow({
  entry,
  artifactId,
  open,
  state,
  onToggle,
  onRetry,
}: {
  entry: AgentRunFileChangeEntry;
  artifactId?: string;
  open: boolean;
  state?: HistoricalDiffState;
  onToggle: () => void;
  onRetry: () => void;
}) {
  const pathParts = splitPath(entry.path);
  const row = (
    <>
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
        <span className="shrink-0 font-mono text-[var(--text-9)] text-[var(--muted-dim)]">
          binary
        </span>
      ) : (
        <span className="flex shrink-0 gap-1.5 font-mono text-[var(--text-10)] tabular-nums">
          {entry.additions > 0 ? (
            <span className="text-[var(--green)]">+{entry.additions}</span>
          ) : null}
          {entry.deletions > 0 ? (
            <span className="text-[var(--red)]">-{entry.deletions}</span>
          ) : null}
        </span>
      )}
      {artifactId ? (
        <IconChevron
          className={`h-2.5 w-2.5 shrink-0 text-[var(--muted-dim)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      ) : null}
    </>
  );
  return (
    <div>
      {artifactId ? (
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-2 px-3 py-1.5 transition-colors hover:bg-[var(--hover)] focus-visible:bg-[var(--hover)] focus-visible:outline-none"
          aria-expanded={open}
          title={`Show the diff captured for ${entry.path}`}
        >
          {row}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2 px-3 py-1.5">{row}</div>
      )}
      {open && state ? <HistoricalDiffPanel state={state} onRetry={onRetry} /> : null}
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
  const [openDiffKey, setOpenDiffKey] = React.useState<string | null>(null);
  const [diffs, setDiffs] = React.useState<Record<string, HistoricalDiffState>>({});
  if (!fileChanges || fileChanges.version !== 1 || fileChanges.counts.changed <= 0) return null;

  const requestDiff = (artifactId: string, filePath: string, force = false) => {
    const key = `${artifactId}\u0000${filePath}`;
    setOpenDiffKey(key);
    if (!force && diffs[key]) return;
    setDiffs((current) => ({ ...current, [key]: { status: 'loading' } }));
    void loadHistoricalDiff(artifactId, filePath)
      .then((value) => {
        setDiffs((current) => ({ ...current, [key]: { status: 'loaded', value } }));
      })
      .catch((error: any) => {
        setDiffs((current) => ({
          ...current,
          [key]: {
            status: 'error',
            message: String(error?.message ?? error ?? 'Unable to load historical diff.'),
          },
        }));
      });
  };

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
            <path
              d="M3 3.5h4M3 8h7M3 12.5h10"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
            />
            <path
              d="M11 3.5h2M12 2.5v2"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
            Changed files
          </span>
          <span className="block truncate text-[var(--text-10)] text-[var(--muted-dim)]">
            {changedLabel}
            {workspaceCount > 1 ? ` across ${workspaceCount} drones` : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 font-mono text-[var(--text-10)] tabular-nums">
          {fileChanges.counts.additions > 0 ? (
            <span className="text-[var(--green)]">+{fileChanges.counts.additions}</span>
          ) : null}
          {fileChanges.counts.deletions > 0 ? (
            <span className="text-[var(--red)]">-{fileChanges.counts.deletions}</span>
          ) : null}
          <IconChevron
            className={`h-3 w-3 text-[var(--muted)] transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
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
              {workspace.entries.map((entry) => {
                const artifactId = workspace.diffArtifactId;
                const diffKey = artifactId ? `${artifactId}\u0000${entry.path}` : '';
                return (
                  <FileRow
                    key={`${entry.status}:${entry.originalPath ?? ''}:${entry.path}`}
                    entry={entry}
                    artifactId={artifactId}
                    open={Boolean(diffKey && openDiffKey === diffKey)}
                    state={diffKey ? diffs[diffKey] : undefined}
                    onToggle={() => {
                      if (!artifactId) return;
                      if (openDiffKey === diffKey) {
                        setOpenDiffKey(null);
                        return;
                      }
                      requestDiff(artifactId, entry.path);
                    }}
                    onRetry={() => {
                      if (artifactId) requestDiff(artifactId, entry.path, true);
                    }}
                  />
                );
              })}
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
