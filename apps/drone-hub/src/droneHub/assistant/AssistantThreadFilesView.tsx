import React from 'react';

import { MarkdownMessage } from '../chat/MarkdownMessage';
import { IconChevron, IconFile, IconFolder, iconForFilePath } from '../icons';
import { formatArtifactSize, formatUpdatedAt } from './assistant-formatters';
import type { AssistantArtifactFile, AssistantArtifactSummary } from './assistant-types';

type AssistantArtifactTreeNode =
  | {
      kind: 'directory';
      name: string;
      path: string;
      children: AssistantArtifactTreeNode[];
    }
  | {
      kind: 'file';
      name: string;
      path: string;
      file: AssistantArtifactSummary;
    };

function sortAssistantArtifactTree(
  nodes: AssistantArtifactTreeNode[],
): AssistantArtifactTreeNode[] {
  return nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

function buildAssistantArtifactTree(
  files: AssistantArtifactSummary[],
): AssistantArtifactTreeNode[] {
  const root: AssistantArtifactTreeNode[] = [];
  const directoriesByPath = new Map<
    string,
    Extract<AssistantArtifactTreeNode, { kind: 'directory' }>
  >();

  for (const file of files) {
    const path = String(file.path ?? '').trim();
    if (!path) continue;
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop() ?? path;
    let parent = root;
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let directory = directoriesByPath.get(currentPath);
      if (!directory) {
        directory = { kind: 'directory', name: part, path: currentPath, children: [] };
        directoriesByPath.set(currentPath, directory);
        parent.push(directory);
      }
      parent = directory.children;
    }

    parent.push({ kind: 'file', name: fileName, path, file });
  }

  const sortDeep = (nodes: AssistantArtifactTreeNode[]) => {
    sortAssistantArtifactTree(nodes);
    for (const node of nodes) {
      if (node.kind === 'directory') sortDeep(node.children);
    }
  };
  sortDeep(root);
  return root;
}

function collectAssistantArtifactDirectoryPaths(nodes: AssistantArtifactTreeNode[]): string[] {
  const out: string[] = [];
  const visit = (items: AssistantArtifactTreeNode[]) => {
    for (const node of items) {
      if (node.kind !== 'directory') continue;
      out.push(node.path);
      visit(node.children);
    }
  };
  visit(nodes);
  return out;
}

function AssistantTreeIndentGuides({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0">
      {Array.from({ length: depth }).map((_, index) => (
        <span
          key={index}
          className="absolute inset-y-0 w-px bg-[rgba(136,145,168,.18)]"
          style={{ left: `${9 + index * 14}px` }}
        />
      ))}
    </span>
  );
}

export function selectDefaultArtifactPath(files: AssistantArtifactSummary[]): string | null {
  if (files.length === 0) return null;
  const preferred =
    files.find((file) => file.path === 'status.md') ??
    files.find((file) => file.path.endsWith('/status.md'));
  return preferred?.path ?? files[0]?.path ?? null;
}

function isImageMimeType(mimeRaw: unknown): boolean {
  return String(mimeRaw ?? '')
    .trim()
    .toLowerCase()
    .startsWith('image/');
}

export function AssistantThreadFilesView({
  threadId,
  files,
  selectedPath,
  selectedFile,
  loading,
  error,
  onSelectPath,
  onRefresh,
  onClose,
}: {
  threadId: string;
  files: AssistantArtifactSummary[];
  selectedPath: string | null;
  selectedFile: AssistantArtifactFile | null;
  loading: boolean;
  error: string | null;
  onSelectPath: (path: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const artifactTree = React.useMemo(() => buildAssistantArtifactTree(files), [files]);
  const [expandedDirs, setExpandedDirs] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    const availableDirs = new Set(collectAssistantArtifactDirectoryPaths(artifactTree));
    setExpandedDirs((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const dirPath of availableDirs) {
        next[dirPath] = prev[dirPath] ?? true;
        if (!(dirPath in prev)) changed = true;
      }
      if (Object.keys(prev).some((dirPath) => !availableDirs.has(dirPath))) changed = true;
      return changed ? next : prev;
    });
  }, [artifactTree]);

  const toggleDirectory = React.useCallback((path: string) => {
    setExpandedDirs((prev) => ({ ...prev, [path]: prev[path] !== true }));
  }, []);

  function renderArtifactTree(nodes: AssistantArtifactTreeNode[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      const indentPx = 4 + depth * 14;
      if (node.kind === 'directory') {
        const open = expandedDirs[node.path] === true;
        return (
          <React.Fragment key={`dir:${node.path}`}>
            <div className="relative w-full group/artifact-dir">
              <AssistantTreeIndentGuides depth={depth} />
              <button
                type="button"
                onClick={() => toggleDirectory(node.path)}
                title={node.path}
                className="flex h-[22px] w-full min-w-0 items-center gap-1 pr-2 text-left text-[13px] text-[var(--fg-secondary)] transition-colors hover:bg-[rgba(255,255,255,.055)]"
                style={{ paddingLeft: `${indentPx}px` }}
              >
                <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-[var(--muted)]">
                  <IconChevron down={open} size={12} />
                </span>
                <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-[#d7b85a]">
                  <IconFolder size={13} />
                </span>
                <span className="min-w-0 flex-1 truncate leading-none">{node.name}</span>
              </button>
            </div>
            {open ? renderArtifactTree(node.children, depth + 1) : null}
          </React.Fragment>
        );
      }

      const Icon = iconForFilePath(node.path) ?? IconFile;
      const selected = node.path === selectedPath;
      return (
        <button
          key={`file:${node.path}`}
          type="button"
          onClick={() => onSelectPath(node.path)}
          title={`${node.path} • ${formatUpdatedAt(node.file.updatedAt)} • ${formatArtifactSize(node.file.size)}`}
          className={`relative flex h-[22px] w-full min-w-0 items-center gap-1 pr-2 text-left text-[13px] transition-colors ${
            selected
              ? 'bg-[rgba(55,118,171,.20)] text-[var(--fg)] shadow-[inset_0_0_0_1px_rgba(64,156,255,.55)]'
              : 'text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,.055)]'
          }`}
          style={{ paddingLeft: `${indentPx}px` }}
        >
          <AssistantTreeIndentGuides depth={depth} />
          <span
            className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-[var(--muted)]"
            aria-hidden="true"
          />
          <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-[var(--muted)]">
            <Icon size={13} />
          </span>
          <span className="min-w-0 flex-1 truncate leading-none">{node.name}</span>
        </button>
      );
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[rgba(0,0,0,.08)]">
      <div className="flex h-10 flex-shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <IconFile className="h-4 w-4 flex-shrink-0 text-[var(--muted)]" />
          <div className="min-w-0">
            <div className="min-w-0 truncate text-[12px] font-semibold text-[var(--fg-secondary)]">
              Thread files
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--muted-dim)]">
              <span>
                {files.length} file{files.length === 1 ? '' : 's'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" aria-hidden="true" />
                Live refresh
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onRefresh}
            disabled={!threadId || loading}
            className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)] disabled:opacity-45"
            style={{ fontFamily: 'var(--display)' }}
          >
            {loading ? 'Loading' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Chat
          </button>
        </div>
      </div>
      {error ? (
        <div className="mx-3 mt-3 rounded border border-[rgba(255,90,90,.35)] bg-[rgba(255,90,90,.08)] px-2.5 py-2 text-[11px] text-[var(--red)]">
          {error}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <aside className="w-[210px] flex-shrink-0 overflow-y-auto border-r border-[var(--border-subtle)] py-1">
          {files.length === 0 ? (
            <div className="px-2 py-3 text-[11px] text-[var(--muted-dim)]">
              {loading ? 'Loading files...' : 'No thread files.'}
            </div>
          ) : (
            <div>{renderArtifactTree(artifactTree, 0)}</div>
          )}
        </aside>
        <main className="min-w-0 flex-1 overflow-hidden">
          {selectedFile ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex-shrink-0 border-b border-[var(--border-subtle)] px-4 py-2">
                <div className="truncate text-[13px] font-medium text-[var(--fg-secondary)]">
                  {selectedFile.path}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-[var(--muted-dim)]">
                  {formatArtifactSize(selectedFile.size)} ·{' '}
                  {formatUpdatedAt(selectedFile.updatedAt)} · {selectedFile.revision}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
                {selectedFile.contentBase64 && isImageMimeType(selectedFile.mimeType) ? (
                  <img
                    src={`data:${selectedFile.mimeType || 'image/png'};base64,${selectedFile.contentBase64}`}
                    alt={selectedFile.path}
                    className="max-h-full max-w-full rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.16)] object-contain"
                  />
                ) : selectedFile.content.trim() ? (
                  <MarkdownMessage
                    text={selectedFile.content}
                    className="dh-markdown text-[13px]"
                  />
                ) : (
                  <div className="text-[12px] text-[var(--muted-dim)]">
                    {selectedFile.binary ? 'Binary file preview is unavailable.' : 'Empty file'}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-[var(--muted-dim)]">
              {loading ? 'Loading selected file...' : 'No file selected'}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
