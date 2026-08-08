import type {
  AgentRunFileChangeCounts,
  AgentRunFileChangeEntry,
  AgentRunFileChanges,
  AgentRunFileChangeWorkspace,
} from '@blip/protocol';

export type AgentRunChangeTreeStats = {
  changed: number;
  additions: number;
  deletions: number;
  modified?: number;
};

export type AgentRunLineChangeBreakdown = {
  net: number;
  added: number;
  modified: number;
  deleted: number;
};

export function agentRunLineChangeBreakdown(
  counts: Pick<AgentRunFileChangeCounts, 'additions' | 'deletions' | 'modified'>,
): AgentRunLineChangeBreakdown {
  const additions = Math.max(0, Number(counts.additions) || 0);
  const deletions = Math.max(0, Number(counts.deletions) || 0);
  const modified = Math.min(additions, deletions, Math.max(0, Number(counts.modified) || 0));
  return {
    net: additions - deletions,
    added: additions - modified,
    modified,
    deleted: deletions - modified,
  };
}

export function agentRunNetLineChangeLabel(net: number): string {
  const value = Number.isFinite(net) ? Math.trunc(net) : 0;
  return value === 0 ? '±0' : `${value > 0 ? '+' : ''}${value}`;
}

export type AgentRunChangeTreeNode =
  | {
      kind: 'directory';
      name: string;
      path: string;
      stats: AgentRunChangeTreeStats;
      children: AgentRunChangeTreeNode[];
    }
  | {
      kind: 'file';
      name: string;
      path: string;
      stats: AgentRunChangeTreeStats;
      entry: AgentRunFileChangeEntry;
    };

type DirectoryBuilder = {
  name: string;
  path: string;
  directories: Map<string, DirectoryBuilder>;
  files: AgentRunFileChangeEntry[];
};

export function isAgentRunFileChanges(value: unknown): value is AgentRunFileChanges {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<AgentRunFileChanges>;
  if (
    (candidate.version !== 1 && candidate.version !== 2) ||
    !Array.isArray(candidate.workspaces)
  ) {
    return false;
  }
  if (Number(candidate.counts?.changed) > 0) return true;
  return candidate.version === 2 && candidate.attribution === 'unavailable';
}

export function agentRunWorkspacePreviewEntries(
  workspace: AgentRunFileChangeWorkspace,
): AgentRunFileChangeEntry[] {
  return 'entries' in workspace ? workspace.entries : workspace.previewEntries;
}

export function agentRunFileStatusLabel(entry: AgentRunFileChangeEntry): string {
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

function fileName(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

function sumStats(nodes: AgentRunChangeTreeNode[]): AgentRunChangeTreeStats {
  return nodes.reduce(
    (total, node) => ({
      changed: total.changed + node.stats.changed,
      additions: total.additions + node.stats.additions,
      deletions: total.deletions + node.stats.deletions,
      modified: (total.modified ?? 0) + (node.stats.modified ?? 0),
    }),
    { changed: 0, additions: 0, deletions: 0, modified: 0 },
  );
}

export function buildAgentRunChangeTree(
  entries: AgentRunFileChangeEntry[],
): AgentRunChangeTreeNode[] {
  const root: DirectoryBuilder = {
    name: '',
    path: '',
    directories: new Map(),
    files: [],
  };

  for (const entry of entries) {
    const segments = String(entry.path ?? '')
      .split('/')
      .filter(Boolean);
    if (segments.length === 0) continue;
    let directory = root;
    for (const segment of segments.slice(0, -1)) {
      const nextPath = directory.path ? `${directory.path}/${segment}` : segment;
      let child = directory.directories.get(segment);
      if (!child) {
        child = { name: segment, path: nextPath, directories: new Map(), files: [] };
        directory.directories.set(segment, child);
      }
      directory = child;
    }
    directory.files.push(entry);
  }

  const collapseDirectory = (start: DirectoryBuilder) => {
    const names = [start.name];
    let directory = start;
    while (directory.files.length === 0 && directory.directories.size === 1) {
      const child = directory.directories.values().next().value as DirectoryBuilder | undefined;
      if (!child) break;
      directory = child;
      names.push(child.name);
    }
    return { directory, name: names.join('/') };
  };

  const buildNodes = (directory: DirectoryBuilder): AgentRunChangeTreeNode[] => {
    const directories: AgentRunChangeTreeNode[] = Array.from(directory.directories.values())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((child) => {
        const collapsed = collapseDirectory(child);
        const children = buildNodes(collapsed.directory);
        return {
          kind: 'directory' as const,
          name: collapsed.name,
          path: collapsed.directory.path,
          stats: sumStats(children),
          children,
        };
      });
    const files: AgentRunChangeTreeNode[] = directory.files
      .slice()
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((entry) => ({
        kind: 'file' as const,
        name: fileName(entry.path),
        path: entry.path,
        stats: {
          changed: 1,
          additions: entry.additions,
          deletions: entry.deletions,
          modified: entry.modified ?? 0,
        },
        entry,
      }));
    return [...directories, ...files];
  };

  return buildNodes(root);
}
