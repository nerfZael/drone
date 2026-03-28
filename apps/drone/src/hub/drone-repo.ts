import { dvmExec } from '../host/dvm';
import { normalizeContainerPath } from './hub-format';
import {
  buildWorkingTreeRepoChangeReviewToken,
  parseGitCommitDetails,
  parseGitCommitList,
  parseGitNumStatZ,
  parseGitStatusPorcelainV2Z,
  repoChangeReviewKey,
  type RepoCommitDetails,
  type RepoCommitSummary,
} from './repoOps';

export async function runGitInDrone(opts: {
  container: string;
  repoPathInContainer: string;
  args: string[];
}): Promise<{ code: number; stdout: string; stderr: string }> {
  return await dvmExec(opts.container, 'git', ['-C', normalizeContainerPath(opts.repoPathInContainer), ...opts.args]);
}

export async function runGitInDroneOrThrow(opts: {
  container: string;
  repoPathInContainer: string;
  args: string[];
  okCodes?: number[];
}): Promise<{ code: number; stdout: string; stderr: string }> {
  const okCodes = Array.isArray(opts.okCodes) && opts.okCodes.length > 0 ? opts.okCodes : [0];
  const r = await runGitInDrone(opts);
  if (!okCodes.includes(r.code)) {
    const msg = (r.stderr || r.stdout || `git ${opts.args.join(' ')} failed (exit ${r.code})`).trim();
    throw new Error(msg);
  }
  return r;
}

export async function droneRepoChangesSummary(opts: {
  container: string;
  repoPathInContainer: string;
}): Promise<{ repoRoot: string; summary: ReturnType<typeof parseGitStatusPorcelainV2Z> }> {
  const repoPathInContainer = normalizeContainerPath(opts.repoPathInContainer);
  const repoRootRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['rev-parse', '--show-toplevel'],
  });
  const repoRoot = String(repoRootRaw.stdout ?? '').trim() || repoPathInContainer;
  const statusRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'],
  });
  const parsed = parseGitStatusPorcelainV2Z(statusRaw.stdout);
  const entries = await Promise.all(
    parsed.entries.map(async (entry) => {
      const needsWorktreeHash = entry.isUntracked || (entry.unstagedType !== null && entry.unstagedType !== 'deleted');
      const worktreeContentHash = needsWorktreeHash
        ? await hashDroneFileContents({
            container: opts.container,
            repoPathInContainer,
            repoRelativePath: entry.path,
          })
        : null;
      return {
        ...entry,
        reviewKey: repoChangeReviewKey(entry.path, entry.originalPath),
        reviewToken: buildWorkingTreeRepoChangeReviewToken(entry, worktreeContentHash),
      };
    }),
  );
  return {
    repoRoot,
    summary: {
      ...parsed,
      entries,
    },
  };
}

async function hashDroneFileContents(opts: {
  container: string;
  repoPathInContainer: string;
  repoRelativePath: string;
}): Promise<string | null> {
  const requestedPath = String(opts.repoRelativePath ?? '').trim();
  if (!requestedPath || requestedPath.includes('\0')) return null;
  const result = await runGitInDrone({
    container: opts.container,
    repoPathInContainer: opts.repoPathInContainer,
    args: ['hash-object', '--no-filters', '--', requestedPath],
  });
  if (result.code !== 0) return null;
  const hash = String(result.stdout ?? '').trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(hash) ? hash : null;
}

export async function droneRepoDiffForPath(opts: {
  container: string;
  repoPathInContainer: string;
  filePath: string;
  kind: 'staged' | 'unstaged';
  contextLines?: number;
  maxChars?: number;
}): Promise<{ path: string; kind: 'staged' | 'unstaged'; diff: string; truncated: boolean; fromUntracked: boolean }> {
  const repoPathInContainer = normalizeContainerPath(opts.repoPathInContainer);
  const requestedPath = String(opts.filePath ?? '').trim();
  const kind: 'staged' | 'unstaged' = opts.kind === 'staged' ? 'staged' : 'unstaged';
  if (!requestedPath) throw new Error('missing file path');
  if (requestedPath.includes('\0')) throw new Error('invalid file path');

  const contextLines =
    typeof opts.contextLines === 'number' && Number.isFinite(opts.contextLines) && opts.contextLines >= 0
      ? Math.floor(opts.contextLines)
      : 3;
  const maxChars =
    typeof opts.maxChars === 'number' && Number.isFinite(opts.maxChars) && opts.maxChars > 0 ? Math.floor(opts.maxChars) : 350_000;

  const contextFlag = `-U${contextLines}`;
  let diffText = '';
  let fromUntracked = false;

  if (kind === 'staged') {
    const staged = await runGitInDroneOrThrow({
      container: opts.container,
      repoPathInContainer,
      args: ['diff', '--no-color', '--no-ext-diff', '--cached', contextFlag, '--', requestedPath],
    });
    diffText = staged.stdout;
  } else {
    const unstaged = await runGitInDroneOrThrow({
      container: opts.container,
      repoPathInContainer,
      args: ['diff', '--no-color', '--no-ext-diff', contextFlag, '--', requestedPath],
    });
    diffText = unstaged.stdout;

    // `dvm exec` can produce a trailing newline even when command output is otherwise empty.
    // Treat whitespace-only output as empty so untracked fallback still runs.
    if (!String(diffText ?? '').trim()) {
      const tracked = await runGitInDroneOrThrow({
        container: opts.container,
        repoPathInContainer,
        args: ['ls-files', '--error-unmatch', '--', requestedPath],
        okCodes: [0, 1],
      });
      if (tracked.code !== 0) {
        const noIndex = await runGitInDrone({
          container: opts.container,
          repoPathInContainer,
          args: ['diff', '--no-color', '--no-ext-diff', '--no-index', contextFlag, '/dev/null', requestedPath],
        });
        if (noIndex.code !== 0 && noIndex.code !== 1) {
          const msg = (noIndex.stderr || noIndex.stdout || 'git diff --no-index failed').trim();
          throw new Error(msg);
        }

        const noIndexStdout = String(noIndex.stdout ?? '');
        const noIndexStderr = String(noIndex.stderr ?? '').trim();
        let extracted = noIndexStdout;

        // dvm wraps non-zero command output into stderr as:
        // "Error: Command failed ...\n\n<original output>"
        // For git --no-index, exit code 1 means "different", not failure.
        if (!extracted && noIndex.code === 1 && noIndexStderr) {
          const at = noIndexStderr.indexOf('diff --git ');
          if (at >= 0) extracted = noIndexStderr.slice(at);
        }

        if (!extracted && noIndexStderr) {
          throw new Error(noIndexStderr);
        }
        diffText = extracted;
        fromUntracked = Boolean(String(extracted ?? '').trim());
      }
    }
  }

  let truncated = false;
  if (diffText.length > maxChars) {
    truncated = true;
    diffText = `${diffText.slice(0, maxChars)}\n\n@@ truncated @@\n`;
  }

  return {
    path: requestedPath,
    kind,
    diff: diffText,
    truncated,
    fromUntracked,
  };
}

type RepoPullChangeType =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'unmerged'
  | 'untracked'
  | 'ignored'
  | 'unknown'
  | null;

export type RepoPullChangeEntry = {
  path: string;
  originalPath: string | null;
  statusChar: string;
  statusType: RepoPullChangeType;
};

export function nameStatusCharToType(chRaw: string): RepoPullChangeType {
  const ch = String(chRaw ?? '.').charAt(0);
  switch (ch) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type-changed';
    case 'U':
      return 'unmerged';
    default:
      return ch ? 'unknown' : null;
  }
}

export function parseGitNameStatusZ(raw: string): RepoPullChangeEntry[] {
  const tokens = String(raw ?? '')
    .split('\0')
    .filter((t) => t.length > 0);

  const out: RepoPullChangeEntry[] = [];
  const statusTokenPattern = /^[A-Z][0-9]*$/;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;

    // Canonical `git diff --name-status -z` format is status + NUL + path (+ NUL + path for R/C).
    if (!statusTokenPattern.test(token)) continue;
    const statusChar = token.charAt(0) || '?';
    if (statusChar === 'R' || statusChar === 'C') {
      const oldPath = tokens[i + 1] ?? '';
      const newPath = tokens[i + 2] ?? '';
      if (oldPath || newPath) {
        out.push({
          path: newPath || oldPath,
          originalPath: oldPath || null,
          statusChar,
          statusType: nameStatusCharToType(statusChar),
        });
      }
      i += 2;
      continue;
    }

    const pathA = tokens[i + 1] ?? '';
    if (pathA) {
      out.push({
        path: pathA,
        originalPath: null,
        statusChar,
        statusType: nameStatusCharToType(statusChar),
      });
    }
    i += 1;
  }

  out.sort((a, b) => {
    const p = a.path.localeCompare(b.path);
    if (p !== 0) return p;
    return String(a.originalPath ?? '').localeCompare(String(b.originalPath ?? ''));
  });
  return out;
}

export async function droneRepoBaseSha(opts: { container: string; repoPathInContainer: string }): Promise<string | null> {
  const repoPathInContainer = normalizeContainerPath(opts.repoPathInContainer);
  const r = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['config', '--get', 'dvm.baseSha'],
    okCodes: [0, 1],
  });
  const sha = String(r.stdout ?? '').trim().toLowerCase();
  if (!sha) return null;
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

export async function droneRepoPullChangesSummary(opts: {
  container: string;
  repoPathInContainer: string;
  baseSha?: string;
}): Promise<{ repoRoot: string; baseSha: string; headSha: string; branchHead: string | null; entries: RepoPullChangeEntry[] }> {
  const repoPathInContainer = normalizeContainerPath(opts.repoPathInContainer);
  const repoRootRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['rev-parse', '--show-toplevel'],
  });
  const repoRoot = String(repoRootRaw.stdout ?? '').trim() || repoPathInContainer;

  const overrideBaseSha =
    typeof opts.baseSha === 'string' && /^[0-9a-f]{40}$/.test(opts.baseSha.trim().toLowerCase())
      ? opts.baseSha.trim().toLowerCase()
      : null;
  const baseSha = overrideBaseSha ?? (await droneRepoBaseSha({ container: opts.container, repoPathInContainer }));
  if (!baseSha) {
    throw new Error('missing dvm.baseSha (reseed may be required)');
  }

  const headRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['rev-parse', 'HEAD'],
  });
  const headSha = String(headRaw.stdout ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error('failed to resolve HEAD sha');
  const branchRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    okCodes: [0, 1],
  });
  const branchHead = branchRaw.code === 0 ? String(branchRaw.stdout ?? '').trim() || null : null;

  const nameStatus = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['diff', '--name-status', '-z', `${baseSha}..${headSha}`],
  });
  const entries = parseGitNameStatusZ(nameStatus.stdout);
  return { repoRoot, baseSha, headSha, branchHead, entries };
}

export async function droneRepoPullDiffForPath(opts: {
  container: string;
  repoPathInContainer: string;
  filePath: string;
  baseSha?: string;
  headSha?: string;
  contextLines?: number;
  maxChars?: number;
}): Promise<{ repoRoot: string; baseSha: string; headSha: string; path: string; diff: string; truncated: boolean }> {
  const repoPathInContainer = normalizeContainerPath(opts.repoPathInContainer);
  const requestedPath = String(opts.filePath ?? '').trim();
  if (!requestedPath) throw new Error('missing file path');
  if (requestedPath.includes('\0')) throw new Error('invalid file path');

  const repoRootRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['rev-parse', '--show-toplevel'],
  });
  const repoRoot = String(repoRootRaw.stdout ?? '').trim() || repoPathInContainer;

  const baseSha =
    typeof opts.baseSha === 'string' && /^[0-9a-f]{40}$/.test(opts.baseSha.trim().toLowerCase())
      ? opts.baseSha.trim().toLowerCase()
      : await droneRepoBaseSha({ container: opts.container, repoPathInContainer });
  if (!baseSha) throw new Error('missing dvm.baseSha (reseed may be required)');

  const headSha =
    typeof opts.headSha === 'string' && /^[0-9a-f]{40}$/.test(opts.headSha.trim().toLowerCase())
      ? opts.headSha.trim().toLowerCase()
      : String(
          (
            await runGitInDroneOrThrow({
              container: opts.container,
              repoPathInContainer,
              args: ['rev-parse', 'HEAD'],
            })
          ).stdout ?? '',
        )
          .trim()
          .toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error('failed to resolve HEAD sha');

  const contextLines =
    typeof opts.contextLines === 'number' && Number.isFinite(opts.contextLines) && opts.contextLines >= 0
      ? Math.floor(opts.contextLines)
      : 3;
  const maxChars =
    typeof opts.maxChars === 'number' && Number.isFinite(opts.maxChars) && opts.maxChars > 0 ? Math.floor(opts.maxChars) : 350_000;

  const diffRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['diff', '--no-color', '--no-ext-diff', `-U${contextLines}`, `${baseSha}..${headSha}`, '--', requestedPath],
  });
  let diffText = diffRaw.stdout ?? '';
  let truncated = false;
  if (diffText.length > maxChars) {
    truncated = true;
    diffText = `${diffText.slice(0, maxChars)}\n\n@@ truncated @@\n`;
  }
  return { repoRoot, baseSha, headSha, path: requestedPath, diff: diffText, truncated };
}

export async function droneRepoCommitList(opts: {
  container: string;
  repoPathInContainer: string;
  headRef?: string;
  baseRef?: string | null;
  limit?: number;
}): Promise<{ repoRoot: string; commits: RepoCommitSummary[] }> {
  const repoPathInContainer = normalizeContainerPath(opts.repoPathInContainer);
  const repoRootRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['rev-parse', '--show-toplevel'],
  });
  const repoRoot = String(repoRootRaw.stdout ?? '').trim() || repoPathInContainer;
  const headRef = String(opts.headRef ?? 'HEAD').trim() || 'HEAD';
  const baseRef = String(opts.baseRef ?? '').trim();
  const limit =
    typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0 ? Math.min(200, Math.floor(opts.limit)) : 100;
  const revisionRange = baseRef ? `${baseRef}..${headRef}` : headRef;
  const raw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: [
      'log',
      `--max-count=${limit}`,
      '--date=iso-strict',
      '--no-show-signature',
      '--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s',
      revisionRange,
    ],
  });
  return {
    repoRoot,
    commits: parseGitCommitList(raw.stdout),
  };
}

export async function droneRepoCommitDetails(opts: {
  container: string;
  repoPathInContainer: string;
  sha: string;
}): Promise<RepoCommitDetails> {
  const repoPathInContainer = normalizeContainerPath(opts.repoPathInContainer);
  const sha = String(opts.sha ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('invalid commit sha');
  const repoRootRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['rev-parse', '--show-toplevel'],
  });
  const repoRoot = String(repoRootRaw.stdout ?? '').trim() || repoPathInContainer;
  const commit = parseGitCommitDetails(
    (
      await runGitInDroneOrThrow({
        container: opts.container,
        repoPathInContainer,
        args: ['show', '-s', '--no-show-signature', '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%b', sha],
      })
    ).stdout,
  );
  const parentSha = commit.parents[0] ?? null;
  const [nameStatusRaw, numstatRaw] = await Promise.all([
    runGitInDroneOrThrow({
      container: opts.container,
      repoPathInContainer,
      args: parentSha
        ? ['diff-tree', '--name-status', '-z', '-r', '--find-renames', '--find-copies', parentSha, sha]
        : ['diff-tree', '--root', '--name-status', '-z', '-r', '--find-renames', '--find-copies', sha],
    }),
    runGitInDroneOrThrow({
      container: opts.container,
      repoPathInContainer,
      args: parentSha
        ? ['diff-tree', '--numstat', '-z', '-r', '--find-renames', '--find-copies', parentSha, sha]
        : ['diff-tree', '--root', '--numstat', '-z', '-r', '--find-renames', '--find-copies', sha],
    }),
  ]);
  const nameStatus = parseGitNameStatusZ(nameStatusRaw.stdout);
  const numstat = parseGitNumStatZ(numstatRaw.stdout);
  const statByKey = new Map<string, { additions: number; deletions: number }>();
  for (const entry of numstat) {
    statByKey.set(`${entry.path}\u0000${entry.originalPath ?? ''}`, {
      additions: entry.additions,
      deletions: entry.deletions,
    });
  }
  const entries = nameStatus.map((entry) => {
    const stats = statByKey.get(`${entry.path}\u0000${entry.originalPath ?? ''}`) ?? null;
    const additions = stats?.additions ?? 0;
    const deletions = stats?.deletions ?? 0;
    return {
      path: entry.path,
      originalPath: entry.originalPath,
      statusChar: entry.statusChar,
      statusType: nameStatusCharToType(entry.statusChar),
      additions,
      deletions,
      changes: additions + deletions,
    };
  });
  const additions = entries.reduce((sum, entry) => sum + entry.additions, 0);
  const deletions = entries.reduce((sum, entry) => sum + entry.deletions, 0);
  return {
    repoRoot,
    commit,
    counts: {
      changed: entries.length,
      additions,
      deletions,
    },
    entries,
  };
}

export async function droneRepoCommitDiffForPath(opts: {
  container: string;
  repoPathInContainer: string;
  sha: string;
  filePath: string;
  contextLines?: number;
  maxChars?: number;
}): Promise<{ repoRoot: string; sha: string; path: string; diff: string; truncated: boolean }> {
  const repoPathInContainer = normalizeContainerPath(opts.repoPathInContainer);
  const sha = String(opts.sha ?? '').trim().toLowerCase();
  const requestedPath = String(opts.filePath ?? '').trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('invalid commit sha');
  if (!requestedPath || requestedPath.includes('\0')) throw new Error('invalid file path');
  const contextLines =
    typeof opts.contextLines === 'number' && Number.isFinite(opts.contextLines) && opts.contextLines >= 0
      ? Math.floor(opts.contextLines)
      : 3;
  const maxChars =
    typeof opts.maxChars === 'number' && Number.isFinite(opts.maxChars) && opts.maxChars > 0 ? Math.floor(opts.maxChars) : 350_000;
  const repoRootRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['rev-parse', '--show-toplevel'],
  });
  const repoRoot = String(repoRootRaw.stdout ?? '').trim() || repoPathInContainer;
  const parentsRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['show', '-s', '--format=%P', sha],
  });
  const parentSha =
    String(parentsRaw.stdout ?? '')
      .trim()
      .split(/\s+/g)
      .map((value) => value.trim().toLowerCase())
      .find((value) => /^[0-9a-f]{40}$/.test(value)) ?? null;
  const diffRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: parentSha
      ? ['diff', '--no-color', '--no-ext-diff', `-U${contextLines}`, parentSha, sha, '--', requestedPath]
      : ['show', '--format=', '--no-color', '--no-ext-diff', `-U${contextLines}`, sha, '--', requestedPath],
  });
  let diffText = diffRaw.stdout ?? '';
  let truncated = false;
  if (diffText.length > maxChars) {
    truncated = true;
    diffText = `${diffText.slice(0, maxChars)}\n\n@@ truncated @@\n`;
  }
  return {
    repoRoot,
    sha,
    path: requestedPath,
    diff: diffText,
    truncated,
  };
}
