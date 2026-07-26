import React from 'react';
import type { AgentRunFileChangeEntry } from '@blip/protocol';
import {
  agentRunFileStatusLabel,
  buildAgentRunChangeTree,
  type AgentRunChangeTreeNode,
} from '@drone/assistant-chat';

import { IconChevron, IconFolder, iconForFilePath } from '../icons';

function statusTextClass(entry: AgentRunFileChangeEntry): string {
  switch (entry.status) {
    case 'added':
      return 'text-[var(--green)]';
    case 'deleted':
    case 'unmerged':
      return 'text-[var(--red)]';
    case 'modified':
    case 'renamed':
    case 'copied':
    case 'type-changed':
      return 'text-[var(--yellow)]';
    default:
      return 'text-[var(--muted)]';
  }
}

function statusBadgeClass(entry: AgentRunFileChangeEntry): string {
  switch (entry.status) {
    case 'added':
      return 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]';
    case 'deleted':
    case 'unmerged':
      return 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]';
    case 'modified':
    case 'renamed':
    case 'copied':
    case 'type-changed':
      return 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)]';
    default:
      return 'border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--muted)]';
  }
}

function DiffStats({
  additions,
  deletions,
  appearance,
}: {
  additions: number;
  deletions: number;
  appearance: 'chat' | 'panel';
}) {
  if (additions <= 0 && deletions <= 0) return null;
  return (
    <span
      className={`ml-auto flex shrink-0 gap-1.5 font-mono tabular-nums transition-opacity group-hover/change-row:opacity-100 group-focus-visible/change-row:opacity-100 ${
        appearance === 'panel' ? 'text-[var(--text-8)] opacity-70' : 'text-[var(--text-9)] opacity-75'
      }`}
    >
      {additions > 0 ? (
        <span className="text-[var(--green)]" title="Lines added">
          +{additions}
        </span>
      ) : null}
      {deletions > 0 ? (
        <span className="text-[var(--red)]" title="Lines deleted">
          -{deletions}
        </span>
      ) : null}
    </span>
  );
}

export function AgentRunChangedFilesTree({
  entries,
  expandedDirectories,
  selectedPath = null,
  density = 'compact',
  appearance = 'chat',
  defaultDirectoriesExpanded = true,
  initialVisibleRows,
  onToggleDirectory,
  onSelectFile,
}: {
  entries: AgentRunFileChangeEntry[];
  expandedDirectories: Record<string, boolean>;
  selectedPath?: string | null;
  density?: 'compact' | 'comfortable';
  appearance?: 'chat' | 'panel';
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
  const panelAppearance = appearance === 'panel';
  const rowHeight = panelAppearance
    ? 'h-6'
    : density === 'comfortable'
      ? 'py-1.5'
      : 'py-1';
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
            role={panelAppearance ? 'treeitem' : undefined}
            className={`group/change-row flex w-full items-center text-left text-[var(--muted)] transition-colors hover:text-[var(--fg)] focus-visible:text-[var(--fg)] ${rowHeight} ${
              panelAppearance
                ? 'dh-changes-explorer-row gap-1 pr-1'
                : 'gap-1.5 rounded-[var(--radius-small)] pr-2 focus-visible:outline-none'
            }`}
            style={{ paddingLeft }}
            aria-expanded={open}
          >
            <IconChevron
              down={open}
              className="shrink-0 text-[var(--muted-dim)] transition-colors group-hover/change-row:text-[var(--accent)] group-focus-visible/change-row:text-[var(--accent)]"
              size={panelAppearance ? 12 : 11}
            />
            <IconFolder
              className={
                panelAppearance
                  ? 'shrink-0 text-[var(--yellow)] opacity-80 transition-opacity group-hover/change-row:opacity-100 group-focus-visible/change-row:opacity-100'
                  : 'shrink-0 text-[var(--muted)] transition-colors group-hover/change-row:text-[var(--fg)] group-focus-visible/change-row:text-[var(--fg)]'
              }
              size={13}
            />
            <span className={`min-w-0 truncate ${panelAppearance ? 'text-[var(--text-12)]' : 'font-mono text-[var(--text-10)]'}`}>
              {node.name}
            </span>
            <DiffStats
              additions={node.stats.additions}
              deletions={node.stats.deletions}
              appearance={appearance}
            />
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
        role={panelAppearance ? 'treeitem' : undefined}
        onClick={() => onSelectFile(node.entry)}
        aria-selected={panelAppearance ? selected : undefined}
        className={`group/change-row flex w-full items-center text-left transition-colors ${rowHeight} ${
          panelAppearance
            ? `dh-changes-explorer-row gap-1 pr-1 ${
                selected
                  ? 'is-selected text-[var(--accent)]'
                  : 'text-[var(--fg-secondary)] hover:text-[var(--fg)] focus-visible:text-[var(--fg)]'
              }`
            : `gap-1.5 rounded-[var(--radius-small)] pr-2 focus-visible:outline-none ${
                selected
                  ? 'text-[var(--accent)]'
                  : 'text-[var(--fg-secondary)] hover:text-[var(--fg)] focus-visible:text-[var(--fg)]'
              }`
        }`}
        style={{ paddingLeft: paddingLeft + 14 }}
        title={node.entry.originalPath ? `${node.entry.originalPath} → ${node.path}` : node.path}
      >
        {!panelAppearance ? (
          <span
            className={`w-3 shrink-0 text-center font-mono text-[var(--text-9)] font-[var(--weight-bold)] ${statusTextClass(node.entry)}`}
          >
            {agentRunFileStatusLabel(node.entry)}
          </span>
        ) : null}
        <FileIcon
          className={`shrink-0 transition-colors ${
            selected
              ? 'text-[var(--accent)]'
              : 'text-[var(--muted)] group-hover/change-row:text-[var(--fg)] group-focus-visible/change-row:text-[var(--fg)]'
          }`}
          size={13}
        />
        <span className={`min-w-0 flex-1 truncate ${panelAppearance ? 'text-[var(--text-12)]' : 'font-mono text-[var(--text-10)]'}`}>
          {node.name}
        </span>
        {node.entry.binary ? (
          <span
            className={`shrink-0 text-[var(--muted-dim)] ${
              panelAppearance ? 'text-[var(--text-8)] uppercase tracking-wide' : 'text-[var(--text-9)]'
            }`}
          >
            binary
          </span>
        ) : (
          <DiffStats
            additions={node.entry.additions}
            deletions={node.entry.deletions}
            appearance={appearance}
          />
        )}
        {panelAppearance ? (
          <span
            className={`inline-flex h-[15px] min-w-5 shrink-0 items-center justify-center rounded-[3px] border px-1 font-mono text-[var(--text-8)] font-[var(--weight-bold)] ${statusBadgeClass(node.entry)}`}
            title={node.entry.status}
          >
            {agentRunFileStatusLabel(node.entry)}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div role={panelAppearance ? 'tree' : undefined} className={panelAppearance ? 'space-y-px' : 'space-y-0.5'}>
      {nodes.map((node) => renderNode(node, 0))}
      {hasMoreVisibleRows && Number.isFinite(visibleRowLimit) ? (
        <button
          type="button"
          onClick={() => setVisibleRowLimit((current) => current + (initialVisibleRows ?? 200))}
          className="w-full rounded-[var(--radius-small)] px-2 py-1.5 text-left text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--accent)] transition-colors hover:text-[var(--fg)] focus-visible:text-[var(--fg)] focus-visible:outline-none"
        >
          Show {initialVisibleRows ?? 200} more rows
        </button>
      ) : null}
    </div>
  );
}
