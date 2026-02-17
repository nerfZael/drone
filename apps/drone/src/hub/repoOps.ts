import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { droneRootPath } from '../host/paths';

export type RepoDiffKind = 'staged' | 'unstaged';

export type RepoChangeType =
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

export type RepoBranchSummary = {
  head: string | null;
  upstream: string | null;
  oid: string | null;
  ahead: number;
  behind: number;
};

export type RepoChangeEntry = {
  path: string;
  originalPath: string | null;
  code: string;
  stagedChar: string;
  unstagedChar: string;
  stagedType: RepoChangeType;
  unstagedType: RepoChangeType;
  isUntracked: boolean;
  isIgnored: boolean;
  isConflicted: boolean;
};

export type RepoChangesSummary = {
  branch: RepoBranchSummary;
  entries: RepoChangeEntry[];
  counts: {
    changed: number;
    staged: number;
    unstaged: number;
    untracked: number;
    conflicted: number;
  };
};

export type RepoDiffResult = {
  path: string;
  kind: RepoDiffKind;
  diff: string;
  truncated: boolean;
  fromUntracked: boolean;
};

export type RepoNameStatusEntry = {
  path: string;
  originalPath: string | null;
  statusChar: string;
};

export type RepoPatchApplyErrorKind = 'patch_apply_conflict' | 'patch_apply_failed';

export class RepoPatchApplyError extends Error {
  kind: RepoPatchApplyErrorKind;
  patchName: string;
  conflictFiles: string[];
  stdout: string;
  stderr: string;

  constructor(opts: {
    kind: RepoPatchApplyErrorKind;
    patchName: string;
    message: string;
    conflictFiles?: string[];
    stdout?: string;
    stderr?: string;
  }) {
    super(opts.message);
    this.name = 'RepoPatchApplyError';
    this.kind = opts.kind;
    this.patchName = opts.patchName;
    this.conflictFiles = Array.isArray(opts.conflictFiles) ? opts.conflictFiles : [];
    this.stdout = String(opts.stdout ?? '');
    this.stderr = String(opts.stderr ?? '');
  }
}

export function isRepoPatchApplyError(err: unknown): err is RepoPatchApplyError {
  return err instanceof RepoPatchApplyError;
}
async function runLocal(
  cmd: string,
  args: string[],
  opts?: { cwd?: string }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: opts?.cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.once('error', (err: any) => resolve({ code: 127, stdout, stderr: `${stderr}${err?.message ?? String(err)}` }));
    child.once('close', (code) => resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr }));
  });
}

async function runLocalOrThrow(cmd: string, args: string[], opts?: { cwd?: string }): Promise<string> {
  const r = await runLocal(cmd, args, opts);
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout || `${cmd} failed (exit ${r.code})`).trim();
    throw new Error(msg);
  }
  return r.stdout;
}

function safeSlug(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'repo';
}

function normalizeStatusChar(raw: string | undefined): string {
  const ch = String(raw ?? '.').charAt(0);
  if (!ch || ch === ' ') return '.';
  return ch;
}

function statusCharToType(ch: string): RepoChangeType {
  switch (ch) {
    case '.':
      return null;
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
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
    case '?':
      return 'untracked';
    case '!':
      return 'ignored';
    default:
      return 'unknown';
  }
}

function parseAheadBehind(raw: string): { ahead: number; behind: number } {
  const m = String(raw ?? '').match(/\+(\d+)\s+-(\d+)/);
  if (!m) return { ahead: 0, behind: 0 };
  return {
    ahead: Number.parseInt(m[1], 10) || 0,
    behind: Number.parseInt(m[2], 10) || 0,
  };
}

function parseGitNameStatusZ(raw: string): RepoNameStatusEntry[] {
  const tokens = String(raw ?? '')
    .split('\0')
    .filter((t) => t.length > 0);
  const out: RepoNameStatusEntry[] = [];
  const statusTokenPattern = /^[A-Z][0-9]*$/;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    const tab = token.indexOf('\t');
    if (tab > 0) {
      const statusRaw = token.slice(0, tab);
      const statusChar = statusRaw.charAt(0) || '?';
      const pathA = token.slice(tab + 1);
      if (!pathA) continue;
      if (statusChar === 'R' || statusChar === 'C') {
        const pathB = tokens[i + 1] ?? '';
        i += 1;
        out.push({
          path: pathB || pathA,
          originalPath: pathA,
          statusChar,
        });
        continue;
      }
      out.push({
        path: pathA,
        originalPath: null,
        statusChar,
      });
      continue;
    }

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

function pushRepoChangeEntry(list: RepoChangeEntry[], opts: { path: string; originalPath?: string | null; stagedChar: string; unstagedChar: string; forceConflicted?: boolean }) {
  const stagedChar = normalizeStatusChar(opts.stagedChar);
  const unstagedChar = normalizeStatusChar(opts.unstagedChar);
  const stagedType = statusCharToType(stagedChar);
  const unstagedType = statusCharToType(unstagedChar);
  const isUntracked = stagedChar === '?' || unstagedChar === '?';
  const isIgnored = stagedChar === '!' || unstagedChar === '!';
  const isConflicted = Boolean(opts.forceConflicted) || stagedChar === 'U' || unstagedChar === 'U';
  list.push({
    path: String(opts.path ?? ''),
    originalPath: opts.originalPath ? String(opts.originalPath) : null,
    code: `${stagedChar}${unstagedChar}`,
    stagedChar,
    unstagedChar,
    stagedType,
    unstagedType,
    isUntracked,
    isIgnored,
    isConflicted,
  });
}

export function parseGitStatusPorcelainV2Z(raw: string): RepoChangesSummary {
  const branch: RepoBranchSummary = {
    head: null,
    upstream: null,
    oid: null,
    ahead: 0,
    behind: 0,
  };
  const entries: RepoChangeEntry[] = [];
  const chunks = String(raw ?? '').split('\0');

  for (let i = 0; i < chunks.length; i += 1) {
    const token = chunks[i];
    if (!token) continue;

    if (token.startsWith('# ')) {
      const body = token.slice(2);
      if (body.startsWith('branch.oid ')) {
        const oid = body.slice('branch.oid '.length).trim();
        branch.oid = oid && oid !== '(initial)' ? oid : null;
      } else if (body.startsWith('branch.head ')) {
        const head = body.slice('branch.head '.length).trim();
        branch.head = head && head !== '(detached)' ? head : null;
      } else if (body.startsWith('branch.upstream ')) {
        const upstream = body.slice('branch.upstream '.length).trim();
        branch.upstream = upstream || null;
      } else if (body.startsWith('branch.ab ')) {
        const ab = parseAheadBehind(body.slice('branch.ab '.length));
        branch.ahead = ab.ahead;
        branch.behind = ab.behind;
      }
      continue;
    }

    const recordType = token.charAt(0);
    if (recordType === '?') {
      const filePath = token.startsWith('? ') ? token.slice(2) : token.slice(1).trimStart();
      if (filePath) pushRepoChangeEntry(entries, { path: filePath, stagedChar: '.', unstagedChar: '?' });
      continue;
    }
    if (recordType === '!') {
      const filePath = token.startsWith('! ') ? token.slice(2) : token.slice(1).trimStart();
      if (filePath) pushRepoChangeEntry(entries, { path: filePath, stagedChar: '!', unstagedChar: '!' });
      continue;
    }
    if (recordType === '1') {
      // 1 <XY> ... <path>
      const fields = token.split(' ');
      const xy = String(fields[1] ?? '..');
      const filePath = fields.slice(8).join(' ');
      if (filePath) {
        pushRepoChangeEntry(entries, {
          path: filePath,
          stagedChar: xy.charAt(0),
          unstagedChar: xy.charAt(1),
        });
      }
      continue;
    }
    if (recordType === '2') {
      // 2 <XY> ... <X><score> <path> NUL <origPath>
      const fields = token.split(' ');
      const xy = String(fields[1] ?? '..');
      const filePath = fields.slice(9).join(' ');
      const origPath = chunks[i + 1] ?? '';
      i += 1;
      if (filePath) {
        pushRepoChangeEntry(entries, {
          path: filePath,
          originalPath: origPath || null,
          stagedChar: xy.charAt(0),
          unstagedChar: xy.charAt(1),
        });
      }
      continue;
    }
    if (recordType === 'u') {
      // u <XY> ... <path>
      const fields = token.split(' ');
      const xy = String(fields[1] ?? 'UU');
      const filePath = fields.slice(10).join(' ');
      if (filePath) {
        pushRepoChangeEntry(entries, {
          path: filePath,
          stagedChar: xy.charAt(0) || 'U',
          unstagedChar: xy.charAt(1) || 'U',
          forceConflicted: true,
        });
      }
      continue;
    }
  }

  entries.sort((a, b) => {
    const p = a.path.localeCompare(b.path);
    if (p !== 0) return p;
    return String(a.originalPath ?? '').localeCompare(String(b.originalPath ?? ''));
  });

  const visibleEntries = entries.filter((e) => !e.isIgnored);
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicted = 0;
  for (const e of visibleEntries) {
    if (e.stagedChar !== '.' && e.stagedChar !== '?' && e.stagedChar !== '!') staged += 1;
    if (e.unstagedChar !== '.' && e.unstagedChar !== '!') unstaged += 1;
    if (e.isUntracked) untracked += 1;
    if (e.isConflicted) conflicted += 1;
  }

  return {
    branch,
    entries: visibleEntries,
    counts: {
      changed: visibleEntries.length,
      staged,
      unstaged,
      untracked,
      conflicted,
    },
  };
}

export async function gitTopLevel(anyPathInRepo: string): Promise<string> {
  const root = (await runLocalOrThrow('git', ['-C', anyPathInRepo, 'rev-parse', '--show-toplevel'])).trim();
  if (!root) throw new Error(`Could not determine git root for: ${anyPathInRepo}`);
  return root;
}

export async function gitCurrentBranchOrSha(repoRoot: string): Promise<string> {
  const branch = (
    await runLocalOrThrow('git', ['-C', repoRoot, 'symbolic-ref', '--quiet', '--short', 'HEAD']).catch(async () => '')
  ).trim();
  if (branch) return branch;
  return (await runLocalOrThrow('git', ['-C', repoRoot, 'rev-parse', 'HEAD'])).trim();
}

export async function gitMergeBase(repoRoot: string, leftRef: string, rightRef: string): Promise<string | null> {
  const root = String(repoRoot ?? '').trim();
  const left = String(leftRef ?? '').trim();
  const right = String(rightRef ?? '').trim();
  if (!root || !left || !right) return null;
  const r = await runLocal('git', ['-C', root, 'merge-base', left, right]);
  if (r.code !== 0) return null;
  const sha = String(r.stdout ?? '').trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

export async function gitIsAncestor(repoRoot: string, ancestorRef: string, descendantRef: string): Promise<boolean> {
  const root = String(repoRoot ?? '').trim();
  const anc = String(ancestorRef ?? '').trim();
  const desc = String(descendantRef ?? '').trim();
  if (!root || !anc || !desc) return false;
  const r = await runLocal('git', ['-C', root, 'merge-base', '--is-ancestor', anc, desc]);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  return false;
}

export async function gitIsClean(repoRoot: string): Promise<boolean> {
  const out = (await runLocalOrThrow('git', ['-C', repoRoot, 'status', '--porcelain'])).trim();
  return !out;
}

export async function gitRepoChangesSummary(repoRoot: string): Promise<RepoChangesSummary> {
  const raw = await runLocalOrThrow('git', [
    '-C',
    repoRoot,
    'status',
    '--porcelain=v2',
    '--branch',
    '--untracked-files=all',
    '-z',
  ]);
  return parseGitStatusPorcelainV2Z(raw);
}

export async function gitRepoDiffForPath(opts: {
  repoRoot: string;
  filePath: string;
  kind: RepoDiffKind;
  contextLines?: number;
  maxChars?: number;
}): Promise<RepoDiffResult> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const requestedPath = String(opts.filePath ?? '').trim();
  const kind: RepoDiffKind = opts.kind === 'staged' ? 'staged' : 'unstaged';
  if (!repoRoot) throw new Error('missing repo root');
  if (!requestedPath) throw new Error('missing file path');
  if (requestedPath.includes('\0')) throw new Error('invalid file path');

  const contextLines =
    typeof opts.contextLines === 'number' && Number.isFinite(opts.contextLines) && opts.contextLines >= 0
      ? Math.floor(opts.contextLines)
      : 3;
  const maxChars =
    typeof opts.maxChars === 'number' && Number.isFinite(opts.maxChars) && opts.maxChars > 0
      ? Math.floor(opts.maxChars)
      : 350_000;

  const changes = await gitRepoChangesSummary(repoRoot);
  const entry = changes.entries.find((e) => e.path === requestedPath || e.originalPath === requestedPath) ?? null;
  const targetPath = entry?.path ?? requestedPath;

  let diffText = '';
  const contextFlag = `-U${contextLines}`;
  let fromUntracked = false;

  if (kind === 'staged') {
    diffText = await runLocalOrThrow('git', [
      '-C',
      repoRoot,
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--cached',
      contextFlag,
      '--',
      targetPath,
    ]);
  } else if (entry?.isUntracked) {
    fromUntracked = true;
    const absPath = path.resolve(repoRoot, targetPath);
    const repoWithSep = repoRoot.endsWith(path.sep) ? repoRoot : `${repoRoot}${path.sep}`;
    if (absPath !== repoRoot && !absPath.startsWith(repoWithSep)) {
      throw new Error(`invalid file path: ${targetPath}`);
    }
    const r = await runLocal('git', [
      '-C',
      repoRoot,
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-index',
      contextFlag,
      '/dev/null',
      absPath,
    ]);
    if (r.code !== 0 && r.code !== 1) {
      const msg = (r.stderr || r.stdout || 'git diff --no-index failed').trim();
      throw new Error(msg);
    }
    diffText = r.stdout;
  } else {
    diffText = await runLocalOrThrow('git', ['-C', repoRoot, 'diff', '--no-color', '--no-ext-diff', contextFlag, '--', targetPath]);
  }

  let truncated = false;
  if (diffText.length > maxChars) {
    truncated = true;
    diffText = `${diffText.slice(0, maxChars)}\n\n@@ truncated @@\n`;
  }

  return {
    path: targetPath,
    kind,
    diff: diffText,
    truncated,
    fromUntracked,
  };
}

export async function gitMergePreviewNameStatusEntries(opts: {
  repoRoot: string;
  oursRef: string;
  theirsRef: string;
}): Promise<RepoNameStatusEntry[]> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const oursRef = String(opts.oursRef ?? '').trim();
  const theirsRef = String(opts.theirsRef ?? '').trim();
  if (!repoRoot) throw new Error('missing repoRoot');
  if (!oursRef) throw new Error('missing oursRef');
  if (!theirsRef) throw new Error('missing theirsRef');

  const merge = await runLocal('git', ['-C', repoRoot, 'merge-tree', '--write-tree', oursRef, theirsRef]);
  const firstLine = String(merge.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^[0-9a-f]{40}$/i.test(l));
  if (!firstLine) {
    const details = `${String(merge.stderr ?? '')}\n${String(merge.stdout ?? '')}`.trim();
    throw new Error(`Failed to compute merge preview tree.${details ? `\n\n${details}` : ''}`);
  }

  const raw = await runLocalOrThrow('git', [
    '-C',
    repoRoot,
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    '--find-copies',
    oursRef,
    firstLine,
  ]);
  return parseGitNameStatusZ(raw);
}

export async function gitStashPush(repoRoot: string, message: string): Promise<{ created: boolean; stashRef?: string }> {
  // If clean, do nothing.
  if (await gitIsClean(repoRoot)) return { created: false };

  // Snapshot current tip of stash (if any) so we can detect a new entry.
  const before = (await runLocalOrThrow('git', ['-C', repoRoot, 'stash', 'list', '-1', '--format=%H'])).trim();
  await runLocalOrThrow('git', ['-C', repoRoot, 'stash', 'push', '-u', '-m', message]);
  const after = (await runLocalOrThrow('git', ['-C', repoRoot, 'stash', 'list', '-1', '--format=%H'])).trim();
  const stashRef = after && after !== before ? after : after || undefined;
  return { created: true, stashRef };
}

export async function gitStashPop(repoRoot: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  // Pop most recent stash.
  const r = await runLocal('git', ['-C', repoRoot, 'stash', 'pop'], {});
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr };
}

function repoKeyFromGitRoot(gitRoot: string): string {
  const slug = safeSlug(path.basename(gitRoot));
  const h = crypto.createHash('sha1').update(gitRoot).digest('hex');
  return `${slug}-${h}`;
}

export function defaultWorktreeRootDir(): string {
  return droneRootPath('worktrees');
}

export function quarantineWorktreePath(repoRoot: string, droneName: string): string {
  const key = repoKeyFromGitRoot(repoRoot);
  const safeDrone = safeSlug(droneName);
  return path.join(defaultWorktreeRootDir(), key, `quarantine-${safeDrone}`);
}

export async function ensureQuarantineWorktree(opts: {
  repoRoot: string;
  worktreePath: string;
  branch: string;
  fromRef: string;
}): Promise<void> {
  const repoRoot = opts.repoRoot;
  const wt = opts.worktreePath;
  const branch = opts.branch;
  const fromRef = opts.fromRef;

  await fs.mkdir(path.dirname(wt), { recursive: true });

  let usable = false;
  try {
    const ok = (await runLocalOrThrow('git', ['-C', wt, 'rev-parse', '--is-inside-work-tree'])).trim();
    usable = ok === 'true';
  } catch {
    usable = false;
  }

  if (!usable) {
    // If the directory exists but isn't a worktree, remove it and re-add.
    try {
      await fs.rm(wt, { recursive: true, force: true });
    } catch {
      // ignore
    }
    await runLocalOrThrow('git', ['-C', repoRoot, 'worktree', 'add', '-B', branch, wt, fromRef]);
  }

  // Reset the worktree branch to fromRef (idempotent sync).
  await runLocalOrThrow('git', ['-C', wt, 'checkout', '-B', branch, fromRef]);
  await runLocalOrThrow('git', ['-C', wt, 'reset', '--hard', fromRef]);
  await runLocalOrThrow('git', ['-C', wt, 'clean', '-fdx']);
}

export async function cleanupQuarantineWorktree(opts: {
  repoRoot: string;
  worktreePath: string;
  branch: string;
}): Promise<void> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const wt = String(opts.worktreePath ?? '').trim();
  const branch = String(opts.branch ?? '').trim();
  if (!repoRoot || !wt || !branch) return;

  // Remove linked worktree first so the branch can be deleted.
  const worktreeRemove = await runLocal('git', ['-C', repoRoot, 'worktree', 'remove', '--force', wt]);
  if (worktreeRemove.code !== 0) {
    try {
      await fs.rm(wt, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  const branchDelete = await runLocal('git', ['-C', repoRoot, 'branch', '-D', branch]);
  if (branchDelete.code !== 0) {
    const details = `${String(branchDelete.stderr ?? '')}\n${String(branchDelete.stdout ?? '')}`;
    if (!/not found/i.test(details)) {
      throw new Error((branchDelete.stderr || branchDelete.stdout || `Failed deleting branch ${branch}`).trim());
    }
  }
}

export async function applyPatchesToWorktree(opts: { worktreePath: string; patchesDir: string }): Promise<number> {
  const wt = opts.worktreePath;
  const dir = opts.patchesDir;
  const entries = await fs.readdir(dir);
  const patches = entries
    .filter((e) => e.toLowerCase().endsWith('.patch'))
    .sort()
    .map((e) => path.join(dir, e));
  if (patches.length === 0) return 0;

  // Ensure no previous failed am state remains.
  try {
    await runLocalOrThrow('git', ['-C', wt, 'am', '--abort']);
  } catch {
    // ignore
  }

  for (const p of patches) {
    try {
      let r = await runLocal('git', ['-C', wt, 'am', '--3way', p]);
      const initialAttemptCombined = `${String(r.stderr ?? '')}\n${String(r.stdout ?? '')}`.trim();
      if (r.code !== 0 && shouldRetryPatchAmWithoutThreeWay(initialAttemptCombined)) {
        try {
          await runLocalOrThrow('git', ['-C', wt, 'am', '--abort']);
        } catch {
          // ignore; we'll still try plain git am
        }
        // Force-disable any am.threeWay config for this retry.
        r = await runLocal('git', ['-C', wt, 'am', '--no-3way', p]);
      }
      if (r.code !== 0) {
        const combined = `${String(r.stderr ?? '')}\n${String(r.stdout ?? '')}`.trim();
        const patchName = path.basename(p);
        const conflictFiles = parsePatchConflictFiles(combined);
        const looksLikeConflict =
          conflictFiles.length > 0 ||
          /patch does not apply|CONFLICT|could not apply|failed to merge/i.test(combined) ||
          isThreeWayAncestorError(combined);
        const details = (r.stderr || r.stdout || `git am failed (exit ${r.code})`).trim();
        const message = looksLikeConflict
          ? `Patch apply conflict while applying ${patchName}:\n\n${details}`
          : `Failed applying patch ${patchName}:\n\n${details}`;
        throw new RepoPatchApplyError({
          kind: looksLikeConflict ? 'patch_apply_conflict' : 'patch_apply_failed',
          patchName,
          message,
          conflictFiles,
          stdout: r.stdout,
          stderr: r.stderr,
        });
      }
    } catch (e: any) {
      try {
        await runLocalOrThrow('git', ['-C', wt, 'am', '--abort']);
      } catch {
        // ignore
      }
      if (isRepoPatchApplyError(e)) throw e;
      const msg = e?.message ?? String(e);
      throw new RepoPatchApplyError({
        kind: /patch does not apply|CONFLICT|could not apply|failed to merge/i.test(msg) || isThreeWayAncestorError(msg)
          ? 'patch_apply_conflict'
          : 'patch_apply_failed',
        patchName: path.basename(p),
        message: `Failed applying patch ${path.basename(p)}:\n\n${msg}`,
      });
    }
  }

  return patches.length;
}

function shouldRetryPatchAmWithoutThreeWay(text: string): boolean {
  return isThreeWayAncestorError(text);
}

function shouldRetryPatchApplyWithoutThreeWay(text: string): boolean {
  return isThreeWayAncestorError(text);
}

function isThreeWayAncestorError(text: string): boolean {
  const raw = String(text ?? '');
  return /sha1 information is lacking or useless|could not build fake ancestor/i.test(raw);
}

// Fallback path: apply exported patches directly to the host working tree as tracked changes.
// This can leave normal Git conflict markers/unmerged entries in the host repo.
export async function applyPatchesToMainWorkingTree(opts: { repoRoot: string; patchesDir: string }): Promise<number> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const dir = String(opts.patchesDir ?? '').trim();
  if (!repoRoot) throw new Error('missing repoRoot');
  if (!dir) throw new Error('missing patchesDir');

  const entries = await fs.readdir(dir);
  const patches = entries
    .filter((e) => e.toLowerCase().endsWith('.patch'))
    .sort()
    .map((e) => path.join(dir, e));
  if (patches.length === 0) return 0;

  let applied = 0;
  for (const p of patches) {
    const patchName = path.basename(p);
    let r = await runLocal('git', ['-C', repoRoot, 'apply', '--3way', '--index', '--whitespace=nowarn', p]);
    const initialAttemptCombined = `${String(r.stderr ?? '')}\n${String(r.stdout ?? '')}`.trim();
    if (r.code !== 0 && shouldRetryPatchApplyWithoutThreeWay(initialAttemptCombined)) {
      r = await runLocal('git', ['-C', repoRoot, 'apply', '--index', '--whitespace=nowarn', p]);
    }
    if (r.code !== 0) {
      const combined = `${String(r.stderr ?? '')}\n${String(r.stdout ?? '')}`.trim();
      const conflictFiles = parsePatchConflictFiles(combined);
      const looksLikeConflict =
        conflictFiles.length > 0 ||
        /patch does not apply|CONFLICT|could not apply|failed to merge|with conflicts/i.test(combined) ||
        isThreeWayAncestorError(combined);
      const details = (r.stderr || r.stdout || `git apply failed (exit ${r.code})`).trim();
      throw new RepoPatchApplyError({
        kind: looksLikeConflict ? 'patch_apply_conflict' : 'patch_apply_failed',
        patchName,
        conflictFiles,
        stdout: r.stdout,
        stderr: r.stderr,
        message: looksLikeConflict
          ? `Host repo has merge conflicts while applying ${patchName}.\n\n${details}`
          : `Failed applying patch ${patchName} to host repo.\n\n${details}`,
      });
    }
    applied += 1;
  }

  return applied;
}

// Apply a single exported diff (base..HEAD) directly to the host working tree.
// This is used as a conflict fallback so users get one complete conflict set.
export async function applyExportedDiffToMainWorkingTree(opts: { repoRoot: string; diffPath: string }): Promise<void> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const diffPath = String(opts.diffPath ?? '').trim();
  if (!repoRoot) throw new Error('missing repoRoot');
  if (!diffPath) throw new Error('missing diffPath');

  let r = await runLocal('git', ['-C', repoRoot, 'apply', '--3way', '--index', '--whitespace=nowarn', diffPath]);
  const initialAttemptCombined = `${String(r.stderr ?? '')}\n${String(r.stdout ?? '')}`.trim();
  if (r.code !== 0 && shouldRetryPatchApplyWithoutThreeWay(initialAttemptCombined)) {
    r = await runLocal('git', ['-C', repoRoot, 'apply', '--index', '--whitespace=nowarn', diffPath]);
  }
  if (r.code === 0) return;

  const combined = `${String(r.stderr ?? '')}\n${String(r.stdout ?? '')}`.trim();
  const conflictFiles = parsePatchConflictFiles(combined);
  const looksLikeConflict =
    conflictFiles.length > 0 ||
    /patch does not apply|CONFLICT|could not apply|failed to merge|with conflicts|U\s+\S+/i.test(combined) ||
    isThreeWayAncestorError(combined);
  const details = (r.stderr || r.stdout || `git apply failed (exit ${r.code})`).trim();
  throw new RepoPatchApplyError({
    kind: looksLikeConflict ? 'patch_apply_conflict' : 'patch_apply_failed',
    patchName: path.basename(diffPath),
    conflictFiles,
    stdout: r.stdout,
    stderr: r.stderr,
    message: looksLikeConflict
      ? `Host repo has merge conflicts while applying ${path.basename(diffPath)}.\n\n${details}`
      : `Failed applying exported diff ${path.basename(diffPath)} to host repo.\n\n${details}`,
  });
}

function parsePatchConflictFiles(text: string): string[] {
  const raw = String(text ?? '');
  const out = new Set<string>();

  const patchFailedRe = /patch failed:\s+(.+?):\d+/gi;
  let m: RegExpExecArray | null = null;
  while ((m = patchFailedRe.exec(raw))) {
    const file = String(m[1] ?? '').trim();
    if (file) out.add(file);
  }

  const mergeConflictRe = /CONFLICT\s+\([^)]+\):\s+.*\s+in\s+(.+)$/gim;
  while ((m = mergeConflictRe.exec(raw))) {
    const file = String(m[1] ?? '').trim();
    if (file) out.add(file);
  }

  const doesNotApplyRe = /error:\s+(.+?):\s+patch does not apply$/gim;
  while ((m = doesNotApplyRe.exec(raw))) {
    const file = String(m[1] ?? '').trim();
    if (file) out.add(file);
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

export async function applyQuarantineDiffToMainWorkingTree(opts: {
  repoRoot: string;
  fromRef: string;
  branch: string;
}): Promise<void> {
  const revRange = `${opts.fromRef}..${opts.branch}`;
  await new Promise<void>((resolve, reject) => {
    const diff = spawn('git', ['-C', opts.repoRoot, 'diff', '--binary', revRange], { stdio: ['ignore', 'pipe', 'pipe'] });
    const apply = spawn('git', ['-C', opts.repoRoot, 'apply', '--whitespace=nowarn', '-'], { stdio: ['pipe', 'ignore', 'pipe'] });

    let diffErr = '';
    let applyErr = '';
    let settled = false;
    let diffExit: number | null = null;
    let applyExit: number | null = null;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      try {
        diff.kill();
      } catch {
        // ignore
      }
      try {
        apply.kill();
      } catch {
        // ignore
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    diff.stderr.on('data', (chunk) => (diffErr += chunk.toString('utf8')));
    apply.stderr.on('data', (chunk) => (applyErr += chunk.toString('utf8')));

    diff.on('error', fail);
    apply.on('error', fail);
    diff.stdout.pipe(apply.stdin);

    const maybeFinish = () => {
      if (settled) return;
      if (diffExit === null || applyExit === null) return;
      if (diffExit === 0 && applyExit === 0) {
        settled = true;
        resolve();
        return;
      }

      const details = [
        diffErr.trim() ? `git diff stderr:\n${diffErr.trim()}` : '',
        applyErr.trim() ? `git apply stderr:\n${applyErr.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      settled = true;
      reject(
        new Error(
          `Failed applying git diff range ${JSON.stringify(revRange)} in ${opts.repoRoot}${details ? `\n\n${details}` : ''}`
        )
      );
    };

    diff.on('close', (code) => {
      diffExit = typeof code === 'number' ? code : 1;
      maybeFinish();
    });
    apply.on('close', (code) => {
      applyExit = typeof code === 'number' ? code : 1;
      maybeFinish();
    });
  });
}

async function gitUnmergedFiles(repoRoot: string): Promise<string[]> {
  const r = await runLocal('git', ['-C', repoRoot, 'diff', '--name-only', '--diff-filter=U']);
  if (r.code !== 0) return [];
  return String(r.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export async function mergeBranchIntoMainWorkingTreeNoCommit(opts: { repoRoot: string; branch: string }): Promise<void> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const branch = String(opts.branch ?? '').trim();
  if (!repoRoot) throw new Error('missing repoRoot');
  if (!branch) throw new Error('missing branch');

  const r = await runLocal('git', ['-C', repoRoot, 'merge', '--no-commit', '--no-ff', branch]);
  if (r.code === 0) return;

  const combined = `${String(r.stderr ?? '')}\n${String(r.stdout ?? '')}`.trim();
  const conflictFiles = Array.from(new Set([...parsePatchConflictFiles(combined), ...(await gitUnmergedFiles(repoRoot))])).sort((a, b) =>
    a.localeCompare(b)
  );
  const looksLikeConflict =
    conflictFiles.length > 0 ||
    /CONFLICT|Automatic merge failed|Merge conflict/i.test(combined);
  const details = (r.stderr || r.stdout || `git merge failed (exit ${r.code})`).trim();

  if (!looksLikeConflict) {
    try {
      await runLocalOrThrow('git', ['-C', repoRoot, 'merge', '--abort']);
    } catch {
      // ignore; best effort cleanup for non-conflict merge failures.
    }
  }

  throw new RepoPatchApplyError({
    kind: looksLikeConflict ? 'patch_apply_conflict' : 'patch_apply_failed',
    patchName: branch,
    conflictFiles,
    stdout: r.stdout,
    stderr: r.stderr,
    message: looksLikeConflict
      ? `Host repo has merge conflicts while merging ${branch}.\n\n${details}`
      : `Failed merging ${branch} into host repo.\n\n${details}`,
  });
}

export async function importBundleHeadToHostRef(opts: { repoRoot: string; bundlePath: string; refName: string }): Promise<string> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const bundlePath = String(opts.bundlePath ?? '').trim();
  const refName = String(opts.refName ?? '').trim();
  if (!repoRoot) throw new Error('missing repoRoot');
  if (!bundlePath) throw new Error('missing bundlePath');
  if (!refName) throw new Error('missing refName');

  try {
    await fs.stat(bundlePath);
  } catch {
    throw new Error(`bundle not found: ${bundlePath}`);
  }

  const fetch = await runLocal('git', ['-C', repoRoot, 'fetch', '--no-tags', '--force', bundlePath, `HEAD:${refName}`]);
  if (fetch.code !== 0) {
    const details = `${String(fetch.stderr ?? '')}\n${String(fetch.stdout ?? '')}`.trim();
    throw new Error(`Failed importing bundle into ${refName}.${details ? `\n\n${details}` : ''}`);
  }

  const sha = (await runLocalOrThrow('git', ['-C', repoRoot, 'rev-parse', refName])).trim();
  if (!sha) throw new Error(`Failed resolving imported ref: ${refName}`);
  return sha;
}

export async function deleteHostRefBestEffort(opts: { repoRoot: string; refName: string }): Promise<void> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const refName = String(opts.refName ?? '').trim();
  if (!repoRoot || !refName) return;
  await runLocal('git', ['-C', repoRoot, 'update-ref', '-d', refName]);
}
