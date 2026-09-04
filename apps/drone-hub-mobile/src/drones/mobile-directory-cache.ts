export type MobileExplorerEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'other';
  isGitIgnored: boolean;
};

export type MobileDirectoryState = {
  entries: MobileExplorerEntry[];
  loading: boolean;
  error: string | null;
  loaded: boolean;
};

export const MOBILE_DIRECTORY_CACHE_MAX_ENTRIES = 64;

export class MobileDirectoryContextCache {
  directories: Record<string, MobileDirectoryState> = {};
  private recentPaths: string[] = [];

  update(
    updates: ReadonlyArray<{ path: string; state: MobileDirectoryState }>,
    rootPath: string,
    maxEntries = MOBILE_DIRECTORY_CACHE_MAX_ENTRIES,
  ): Record<string, MobileDirectoryState> {
    let next = this.directories;
    for (const update of updates) {
      this.touch(update.path);
      const current = next[update.path];
      if (sameMobileDirectoryState(current, update.state)) continue;
      if (next === this.directories) next = { ...this.directories };
      next[update.path] = update.state;
    }

    const limit = Math.max(1, maxEntries);
    while (Object.keys(next).length > limit) {
      const oldest = this.recentPaths.find((path) => path !== rootPath && path in next);
      const path = oldest ?? this.recentPaths.find((candidate) => candidate in next);
      if (path == null) break;
      if (next === this.directories) next = { ...this.directories };
      delete next[path];
      this.recentPaths = this.recentPaths.filter((candidate) => candidate !== path);
    }

    this.directories = next;
    return next;
  }

  deletePaths(paths: readonly string[]): Record<string, MobileDirectoryState> {
    const prefixes = paths.map((path) => path.replace(/[\\/]+$/g, '')).filter(Boolean);
    const removed = Object.keys(this.directories).filter((path) =>
      prefixes.some(
        (prefix) =>
          path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}\\`),
      ),
    );
    if (removed.length === 0) return this.directories;
    const next = { ...this.directories };
    for (const path of removed) delete next[path];
    const removedSet = new Set(removed);
    this.recentPaths = this.recentPaths.filter((path) => !removedSet.has(path));
    this.directories = next;
    return next;
  }

  private touch(path: string): void {
    this.recentPaths = this.recentPaths.filter((candidate) => candidate !== path);
    this.recentPaths.push(path);
  }
}

export function mobileDirectoryErrorMode(
  state: MobileDirectoryState | undefined,
): 'none' | 'cold' | 'stale' {
  if (!state?.error) return 'none';
  return state.loaded ? 'stale' : 'cold';
}

export function retainMobileExplorerEntries(
  current: MobileExplorerEntry[],
  next: MobileExplorerEntry[],
): MobileExplorerEntry[] {
  return current.length === next.length &&
    current.every(
      (entry, index) =>
        entry.name === next[index]?.name &&
        entry.path === next[index]?.path &&
        entry.kind === next[index]?.kind &&
        entry.isGitIgnored === next[index]?.isGitIgnored,
    )
    ? current
    : next;
}

function sameMobileDirectoryState(
  current: MobileDirectoryState | undefined,
  next: MobileDirectoryState,
): boolean {
  return Boolean(
    current &&
    current.entries === next.entries &&
    current.loading === next.loading &&
    current.error === next.error &&
    current.loaded === next.loaded,
  );
}
