import React from 'react';
import type { AgentRunFileChangeEntry } from '@blip/protocol';
import {
  agentRunFileStatusLabel,
  buildAgentRunChangeTree,
  type AgentRunChangeTreeNode,
} from '@drone/assistant-chat';

import { IconChevron, IconFolder, iconForFilePath } from '../icons';

function statusClass(entry: AgentRunFileChangeEntry): string {
  if (entry.status === 'added') return 'text-[var(--green)]';
  if (entry.status === 'deleted') return 'text-[var(--red)]';
  if (entry.status === 'renamed' || entry.status === 'copied') return 'text-[var(--yellow)]';
  return 'text-[var(--accent)]';
}

function DiffStats({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions <= 0 && deletions <= 0) return null;
  return (
    <span className="ml-auto flex shrink-0 gap-1.5 font-mono text-[var(--text-9)] tabular-nums">
      {additions > 0 ? <span className="text-[var(--green)]">+{additions}</span> : null}
      {deletions > 0 ? <span className="text-[var(--red)]">-{deletions}</span> : null}
    </span>
  );
}

export function AgentRunChangedFilesTree({
  entries,
  expandedDirectories,
  selectedPath = null,
  density = 'compact',
  defaultDirectoriesExpanded = true,
  initialVisibleRows,
  onToggleDirectory,
  onSelectFile,
}: {
  entries: AgentRunFileChangeEntry[];
  expandedDirectories: Record<string, boolean>;
  selectedPath?: string | null;
  density?: 'compact' | 'comfortable';
  defaultDirectoriesExpanded?: boolean;
  initialVisibleRows?: number;
  onToggleDirectory: (directoryPath: string) => void;
  onSelectFile: (entry: AgentRunFileChangeEntry) => void;
}) {
  const nodes = React.useMemo(() => buildAgentRunChangeTree(entries), [entries]);
  const [visibleRowLimit, setVisibleRowLimit] = React.useState(
    initialVisibleRows ?? Number.POSITIVE_INFINITY,
  );
  React.useEffect(() => {
    setVisibleRowLimit(initialVisibleRows ?? Number.POSITIVE_INFINITY);
  }, [entries, initialVisibleRows]);
  const rowHeight = density === 'comfortable' ? 'py-1.5' : 'py-1';
  let visibleRows = 0;
  let hasMoreVisibleRows = false;

  const renderNode = (node: AgentRunChangeTreeNode, depth: number): React.ReactNode => {
    if (visibleRows >= visibleRowLimit) {
      hasMoreVisibleRows = true;
      return null;
    }
    visibleRows += 1;
    const paddingLeft = 8 + depth * 14;
    if (node.kind === 'directory') {
      const open = expandedDirectories[node.path] ?? defaultDirectoriesExpanded;
      return (
        <div key={`directory:${node.path}`}>
          <button
            type="button"
            onClick={() => onToggleDirectory(node.path)}
            className={`group flex w-full items-center gap-1.5 rounded-[var(--radius-small)] pr-2 text-left text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] ${rowHeight}`}
            style={{ paddingLeft }}
            aria-expanded={open}
          >
            <IconChevron down={open} className="shrink-0 text-[var(--muted-dim)]" size={11} />
            <IconFolder className="shrink-0 text-[var(--muted)]" size={13} />
            <span className="min-w-0 truncate font-mono text-[var(--text-10)]">{node.name}</span>
            <DiffStats additions={node.stats.additions} deletions={node.stats.deletions} />
          </button>
          {open ? node.children.map((child) => renderNode(child, depth + 1)) : null}
        </div>
      );
    }

    const FileIcon = iconForFilePath(node.path);
    const selected = selectedPath === node.path;
    return (
      <button
        key={`file:${node.path}`}
        type="button"
        onClick={() => onSelectFile(node.entry)}
        className={`group flex w-full items-center gap-1.5 rounded-[var(--radius-small)] pr-2 text-left transition-colors ${rowHeight} ${
          selected
            ? 'bg-[var(--accent-subtle)] text-[var(--fg)]'
            : 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
        }`}
        style={{ paddingLeft: paddingLeft + 14 }}
        title={node.entry.originalPath ? `${node.entry.originalPath} → ${node.path}` : node.path}
      >
        <span
          className={`w-3 shrink-0 text-center font-mono text-[var(--text-9)] font-[var(--weight-bold)] ${statusClass(node.entry)}`}
        >
          {agentRunFileStatusLabel(node.entry)}
        </span>
        <FileIcon className="shrink-0 text-[var(--muted)]" size={13} />
        <span className="min-w-0 flex-1 truncate font-mono text-[var(--text-10)]">{node.name}</span>
        {node.entry.binary ? (
          <span className="shrink-0 text-[var(--text-9)] text-[var(--muted-dim)]">binary</span>
        ) : (
          <DiffStats additions={node.entry.additions} deletions={node.entry.deletions} />
        )}
      </button>
    );
  };

  return (
    <div className="space-y-0.5">
      {nodes.map((node) => renderNode(node, 0))}
      {hasMoreVisibleRows && Number.isFinite(visibleRowLimit) ? (
        <button
          type="button"
          onClick={() => setVisibleRowLimit((current) => current + (initialVisibleRows ?? 200))}
          className="w-full rounded-[var(--radius-small)] px-2 py-1.5 text-left text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--accent)] hover:bg-[var(--hover)]"
        >
          Show {initialVisibleRows ?? 200} more rows
        </button>
      ) : null}
    </div>
  );
}
