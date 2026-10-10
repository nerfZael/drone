import path from 'node:path';

import { ShortLivedSingleFlightCache } from './repo-changes-scan-cache';

/** A checkout of a drone's repository, as `git worktree list` reports it. The first one is the main checkout. */
export type RepoWorktree = {
  path: string;
  /** Short branch name; null when HEAD is detached. */
  branch: string | null;
  head: string | null;
  main: boolean;
};

/** The worktree a chat said it works in, as kept on the chat entry. */
export type ChatCurrentWorktree = {
  path: string;
  branch: string | null;
  reportedAt: string;
};

type GitResult = { code: number; stdout: string; stderr: string };

/** Where a drone's repository is and how to run git there, for its runtime. */
export type DroneRepoGit = {
  runtime: 'host' | 'container';
  /** The checkout the drone was given; the Changes explorer shows it unless asked for another worktree. */
  mainPath: () => Promise<string>;
  run: (cwd: string, args: string[]) => Promise<GitResult>;
};

export function parseGitWorktreeList(porcelain: string): RepoWorktree[] {
  const worktrees: RepoWorktree[] = [];
  for (const block of porcelain.split(/\n\s*\n/)) {
    let worktreePath = '';
    let branch: string | null = null;
    let head: string | null = null;
    let bare = false;
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) worktreePath = line.slice('worktree '.length).trim();
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim() || null;
      else if (line.startsWith('branch ')) branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '') || null;
      else if (line.trim() === 'bare') bare = true;
    }
    // A bare repository has no files to show.
    if (!worktreePath || bare) continue;
    worktrees.push({ path: worktreePath, branch, head, main: worktrees.length === 0 });
  }
  return worktrees;
}

export function normalizeWorktreePath(runtime: 'host' | 'container', raw: string): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  if (runtime === 'host') return path.resolve(text);
  const normalized = path.posix.normalize(text.startsWith('/') ? text : `/${text}`);
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function statusError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/**
 * The worktrees of drones' repositories. The Changes explorer may show any of them, but only ones git lists for the
 * drone's repository, so a request cannot point the repository routes at an arbitrary folder.
 */
export class RepoWorktrees {
  private readonly cache = new ShortLivedSingleFlightCache<RepoWorktree[]>(3_000);

  constructor(private readonly gitFor: (drone: any) => DroneRepoGit) {}

  async list(droneId: string, drone: any): Promise<RepoWorktree[]> {
    const git = this.gitFor(drone);
    const mainPath = await git.mainPath();
    return await this.cache.getOrLoad(`${git.runtime}\0${droneId}\0${mainPath}`, async () => {
      const result = await git.run(mainPath, ['worktree', 'list', '--porcelain']);
      if (result.code !== 0) {
        throw new Error(String(result.stderr || result.stdout || 'git worktree list failed').trim());
      }
      const listed = parseGitWorktreeList(result.stdout).map((worktree) => ({
        ...worktree,
        path: normalizeWorktreePath(git.runtime, worktree.path),
      }));
      // The drone's checkout is the main one here even when it is itself a linked worktree.
      const main = normalizeWorktreePath(git.runtime, mainPath);
      const ordered = [
        ...listed.filter((worktree) => worktree.path === main),
        ...listed.filter((worktree) => worktree.path !== main),
      ];
      if (ordered[0]?.path !== main) ordered.unshift({ path: main, branch: null, head: null, main: true });
      return ordered.map((worktree, index) => ({ ...worktree, main: index === 0 }));
    });
  }

  /** The listed worktree at exactly this path; throws when there is none. */
  async require(droneId: string, drone: any, requestedPath: string): Promise<RepoWorktree> {
    const git = this.gitFor(drone);
    const wanted = normalizeWorktreePath(git.runtime, requestedPath);
    const worktree = (await this.list(droneId, drone)).find((candidate) => candidate.path === wanted);
    if (!worktree) throw statusError(`not a worktree of this drone's repository: ${requestedPath}`, 404);
    return worktree;
  }

  /**
   * The worktree an agent means: by branch, or by any path inside a worktree (it may report the folder it is in).
   * The Hub's list is read fresh, since the agent has usually just created the worktree.
   */
  async find(droneId: string, drone: any, input: { path?: string; branch?: string }): Promise<RepoWorktree> {
    const git = this.gitFor(drone);
    this.cache.invalidate();
    const worktrees = await this.list(droneId, drone);
    const branch = String(input.branch ?? '').trim().replace(/^refs\/heads\//, '');
    if (branch) {
      const match = worktrees.find((worktree) => worktree.branch === branch);
      if (!match) throw statusError(`no worktree of this drone's repository has branch "${branch}" checked out`, 404);
      return match;
    }
    const requested = normalizeWorktreePath(git.runtime, String(input.path ?? ''));
    if (!requested) throw statusError('give the worktree path or its branch', 400);
    const direct = worktrees.find((worktree) => worktree.path === requested);
    if (direct) return direct;
    const topLevel = await git.run(requested, ['rev-parse', '--show-toplevel']).catch(() => null);
    const root = topLevel?.code === 0 ? normalizeWorktreePath(git.runtime, topLevel.stdout) : '';
    const match = root ? worktrees.find((worktree) => worktree.path === root) : undefined;
    if (!match) {
      throw statusError(
        `${input.path} is not in a worktree of this drone's repository. Worktrees: ${worktrees.map((worktree) => worktree.path).join(', ')}`,
        404,
      );
    }
    return match;
  }
}

/** The drone entry as the repository routes should see it when they read the given worktree. */
export function droneEntryForWorktree(drone: any, runtime: 'host' | 'container', worktreePath: string): any {
  if (runtime === 'host') {
    return {
      ...drone,
      repoPath: worktreePath,
      ...(drone?.repo?.dest ? { repo: { ...drone.repo, dest: worktreePath } } : {}),
    };
  }
  return { ...drone, repo: { ...(drone?.repo ?? {}), dest: worktreePath } };
}

export function normalizeChatCurrentWorktree(value: unknown): ChatCurrentWorktree | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const worktreePath = typeof record.path === 'string' ? record.path.trim() : '';
  if (!worktreePath) return null;
  return {
    path: worktreePath,
    branch: typeof record.branch === 'string' && record.branch.trim() ? record.branch.trim() : null,
    reportedAt: typeof record.reportedAt === 'string' ? record.reportedAt : '',
  };
}
