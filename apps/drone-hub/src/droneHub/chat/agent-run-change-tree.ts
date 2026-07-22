import type { AgentRunFileChangeEntry } from '@blip/protocol';

export type AgentRunChangeTreeStats = {
  changed: number;
  additions: number;
  deletions: number;
};

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
    }),
    { changed: 0, additions: 0, deletions: 0 },
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
        stats: { changed: 1, additions: entry.additions, deletions: entry.deletions },
        entry,
      }));
    return [...directories, ...files];
  };

  return buildNodes(root);
}
