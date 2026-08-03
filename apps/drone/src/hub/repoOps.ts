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

export type RepoRemoteBranchSummary = {
  ref: string;
  remote: string;
  branch: string;
  oid: string | null;
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
  headBlobOid?: string | null;
  indexBlobOid?: string | null;
  reviewKey?: string;
  reviewToken?: string;
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

export type RepoCommitSummary = {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string | null;
  authoredAt: string;
  subject: string;
  isMerge: boolean;
};

export type RepoCommitChangeEntry = {
  path: string;
  originalPath: string | null;
  statusChar: string;
  statusType: RepoChangeType;
  additions: number;
  deletions: number;
  changes: number;
};

export type RepoCommitDetails = {
  repoRoot: string;
  commit: RepoCommitSummary & {
    body: string;
    committerName: string;
    committerEmail: string | null;
    committedAt: string;
  };
  counts: {
    changed: number;
    additions: number;
    deletions: number;
  };
  entries: RepoCommitChangeEntry[];
};

function reviewDigest(parts: Array<string | number | null | undefined>): string {
  const hash = crypto.createHash('sha1');
  for (const part of parts) {
    hash.update(String(part ?? ''));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function buildReviewScopeId(kind: string, parts: Array<string | number | null | undefined>): string {
  return reviewDigest([kind, ...parts]);
}

export function repoChangeReviewKey(pathRaw: string, originalPathRaw?: string | null): string {
  const path = String(pathRaw ?? '').trim();
  const originalPath = String(originalPathRaw ?? '').trim();
  return `${originalPath}\u0000${path}`;
}

export function buildWorkingTreeRepoChangeReviewToken(entry: RepoChangeEntry, worktreeContentHash: string | null): string {
  return reviewDigest([
    repoChangeReviewKey(entry.path, entry.originalPath),
    entry.code,
    entry.stagedChar,
    entry.unstagedChar,
    entry.stagedType ?? '',
    entry.unstagedType ?? '',
    entry.isUntracked ? '1' : '0',
    entry.isIgnored ? '1' : '0',
    entry.isConflicted ? '1' : '0',
    entry.headBlobOid ?? '',
    entry.indexBlobOid ?? '',
    worktreeContentHash ?? '',
  ]);
}

export type RepoPatchApplyErrorKind = 'patch_apply_conflict' | 'patch_apply_failed';

export class RepoPatchApplyError extends Error {
  kind: RepoPatchApplyErrorKind;
  patchName: string;
  conflictFiles: string[];
  stdout: string;
  stderr: string;
  appliedToHost: boolean;

  constructor(opts: {
    kind: RepoPatchApplyErrorKind;
    patchName: string;
    message: string;
    conflictFiles?: string[];
    stdout?: string;
    stderr?: string;
    appliedToHost?: boolean;
  }) {
    super(opts.message);
    this.name = 'RepoPatchApplyError';
    this.kind = opts.kind;
    this.patchName = opts.patchName;
    this.conflictFiles = Array.isArray(opts.conflictFiles) ? opts.conflictFiles : [];
    this.stdout = String(opts.stdout ?? '');
    this.stderr = String(opts.stderr ?? '');
    this.appliedToHost = opts.appliedToHost === true;
  }
}

export function isRepoPatchApplyError(err: unknown): err is RepoPatchApplyError {
  return err instanceof RepoPatchApplyError;
}

export function resolveBundleImportSourceRefFromListHeads(raw: string): string {
  const refs = Array.from(
    new Set(
      String(raw ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.match(/^[0-9a-f]{40,}\s+(\S+)$/i)?.[1] ?? '')
        .filter(Boolean)
    )
  );

  if (refs.includes('HEAD')) return 'HEAD';
  if (refs.length === 1) return refs[0] ?? 'HEAD';

  const branchRefs = refs.filter((ref) => ref.startsWith('refs/heads/'));
  if (branchRefs.length === 1) return branchRefs[0] ?? 'HEAD';

  throw new Error(
    refs.length > 0
      ? `Bundle does not advertise an unambiguous import ref: ${refs.join(', ')}`
      : 'Bundle does not advertise any importable refs.'
  );
}

async function runLocal(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: opts?.cwd, env: opts?.env ?? process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.once('error', (err: any) => resolve({ code: 127, stdout, stderr: `${stderr}${err?.message ?? String(err)}` }));
    child.once('close', (code) => resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr }));
  });
}

async function runLocalOrThrow(cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<string> {
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

type RepoNumStatEntry = {
  path: string;
  originalPath: string | null;
  additions: number;
  deletions: number;
};

function parseNumstatValue(raw: string): number {
  const text = String(raw ?? '').trim();
  if (!text || text === '-') return 0;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function parseGitNumStatZ(raw: string): RepoNumStatEntry[] {
  const tokens = String(raw ?? '')
    .split('\0')
    .filter((token) => token.length > 0);
  const out: RepoNumStatEntry[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const parts = token.split('\t');
    if (parts.length < 3) continue;
    const additions = parseNumstatValue(parts[0]);
    const deletions = parseNumstatValue(parts[1]);
    const rest = parts.slice(2).join('\t');
    if (rest) {
      out.push({
        path: rest,
        originalPath: null,
        additions,
        deletions,
      });
      continue;
    }
    const originalPath = tokens[i + 1] ?? '';
    const path = tokens[i + 2] ?? '';
    if (originalPath || path) {
      out.push({
        path: path || originalPath,
        originalPath: originalPath || null,
        additions,
        deletions,
      });
    }
    i += 2;
  }
  return out;
}

export function parseGitCommitList(raw: string): RepoCommitSummary[] {
  return String(raw ?? '')
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [shaRaw, parentsRaw, authorNameRaw, authorEmailRaw, authoredAtRaw, subjectRaw] = record.split('\x1f');
      const sha = String(shaRaw ?? '').trim().toLowerCase();
      if (!/^[0-9a-f]{40}$/.test(sha)) return null;
      const parents = String(parentsRaw ?? '')
        .trim()
        .split(/\s+/g)
        .map((value) => value.trim().toLowerCase())
        .filter((value) => /^[0-9a-f]{40}$/.test(value));
      return {
        sha,
        parents,
        authorName: String(authorNameRaw ?? '').trim(),
        authorEmail: String(authorEmailRaw ?? '').trim() || null,
        authoredAt: String(authoredAtRaw ?? '').trim(),
        subject: String(subjectRaw ?? '').trim() || sha.slice(0, 12),
        isMerge: parents.length > 1,
      } satisfies RepoCommitSummary;
    })
    .filter((value): value is RepoCommitSummary => value != null);
}

export function parseGitCommitDetails(raw: string): RepoCommitDetails['commit'] {
  const parts = String(raw ?? '').split('\0');
  const sha = String(parts[0] ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('failed to resolve commit sha');
  const parents = String(parts[1] ?? '')
    .trim()
    .split(/\s+/g)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[0-9a-f]{40}$/.test(value));
  return {
    sha,
    parents,
    authorName: String(parts[2] ?? '').trim(),
    authorEmail: String(parts[3] ?? '').trim() || null,
    authoredAt: String(parts[4] ?? '').trim(),
    committerName: String(parts[5] ?? '').trim(),
    committerEmail: String(parts[6] ?? '').trim() || null,
    committedAt: String(parts[7] ?? '').trim(),
    subject: String(parts[8] ?? '').trim() || sha.slice(0, 12),
    body: String(parts[9] ?? ''),
    isMerge: parents.length > 1,
  };
}

function commitDiffTreeArgs(sha: string, parentSha: string | null, format: '--name-status' | '--numstat'): string[] {
  if (parentSha) {
    return ['diff-tree', format, '-z', '-r', '--find-renames', '--find-copies', parentSha, sha];
  }
  return ['diff-tree', '--root', format, '-z', '-r', '--find-renames', '--find-copies', sha];
}

function pushRepoChangeEntry(
  list: RepoChangeEntry[],
  opts: {
    path: string;
    originalPath?: string | null;
    stagedChar: string;
    unstagedChar: string;
    forceConflicted?: boolean;
    headBlobOid?: string | null;
    indexBlobOid?: string | null;
  }
) {
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
    headBlobOid: opts.headBlobOid ? String(opts.headBlobOid).trim().toLowerCase() : null,
    indexBlobOid: opts.indexBlobOid ? String(opts.indexBlobOid).trim().toLowerCase() : null,
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
          headBlobOid: String(fields[6] ?? '').trim() || null,
          indexBlobOid: String(fields[7] ?? '').trim() || null,
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
          headBlobOid: String(fields[6] ?? '').trim() || null,
          indexBlobOid: String(fields[7] ?? '').trim() || null,
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
          headBlobOid: String(fields[8] ?? '').trim() || null,
          indexBlobOid: String(fields[9] ?? '').trim() || null,
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

async function hashHostFileContents(repoRoot: string, repoRelativePath: string): Promise<string | null> {
  const absPath = path.resolve(repoRoot, repoRelativePath);
  const repoWithSep = repoRoot.endsWith(path.sep) ? repoRoot : `${repoRoot}${path.sep}`;
  if (absPath !== repoRoot && !absPath.startsWith(repoWithSep)) return null;
  try {
    const content = await fs.readFile(absPath);
    const header = Buffer.from(`blob ${content.length}\0`, 'utf8');
    return crypto.createHash('sha1').update(header).update(content).digest('hex');
  } catch {
    return null;
  }
}

async function applyWorkingTreeReviewMetadata(repoRoot: string, summary: RepoChangesSummary): Promise<RepoChangesSummary> {
  const entries = await Promise.all(
    summary.entries.map(async (entry) => {
      const needsWorktreeHash = entry.isUntracked || (entry.unstagedType !== null && entry.unstagedType !== 'deleted');
      const worktreeContentHash = needsWorktreeHash ? await hashHostFileContents(repoRoot, entry.path) : null;
      return {
        ...entry,
        reviewKey: repoChangeReviewKey(entry.path, entry.originalPath),
        reviewToken: buildWorkingTreeRepoChangeReviewToken(entry, worktreeContentHash),
      };
    })
  );
  return {
    ...summary,
    entries,
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

function normalizeRemoteBranchRef(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/^refs\/remotes\//, '')
    .replace(/^remotes\//, '');
}

export async function gitListRemoteBranches(repoPathRaw: string): Promise<{
  repoRoot: string;
  hostBranch: string | null;
  remoteBranches: RepoRemoteBranchSummary[];
}> {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) throw new Error('missing repo path');
  const repoRoot = await gitTopLevel(repoPath);
  const status = await gitRepoChangesSummary(repoRoot);
  const raw = await runLocalOrThrow('git', [
    '-C',
    repoRoot,
    'for-each-ref',
    '--format=%(refname:short)%00%(objectname)%00%(symref)',
    'refs/remotes',
  ]);

  const remoteBranches: RepoRemoteBranchSummary[] = [];
  for (const line of String(raw ?? '')
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const [refShortRaw, oidRaw, symrefRaw] = line.split('\0');
    const ref = normalizeRemoteBranchRef(refShortRaw);
    if (!ref || ref.endsWith('/HEAD')) continue;
    if (String(symrefRaw ?? '').trim()) continue;
    const slash = ref.indexOf('/');
    if (slash <= 0 || slash >= ref.length - 1) continue;
    const remote = ref.slice(0, slash);
    const branch = ref.slice(slash + 1);
    const oid = String(oidRaw ?? '').trim().toLowerCase();
    remoteBranches.push({
      ref,
      remote,
      branch,
      oid: /^[0-9a-f]{40}$/.test(oid) ? oid : null,
    });
  }

  remoteBranches.sort((a, b) => {
    const remoteCompare = a.remote.localeCompare(b.remote);
    if (remoteCompare !== 0) return remoteCompare;
    return a.branch.localeCompare(b.branch);
  });

  return {
    repoRoot,
    hostBranch: String(status.branch.head ?? '').trim() || null,
    remoteBranches,
  };
}

export async function gitResolveRemoteBranchForCreate(repoPathRaw: string, remoteBranchRaw: string): Promise<{
  repoRoot: string;
  remoteBranch: string;
  oid: string | null;
}> {
  const repoRoot = await gitTopLevel(String(repoPathRaw ?? '').trim());
  const remoteBranch = normalizeRemoteBranchRef(remoteBranchRaw);
  if (!remoteBranch) throw new Error('missing remote branch');

  const listed = await gitListRemoteBranches(repoRoot);
  const matched = listed.remoteBranches.find((entry) => entry.ref === remoteBranch) ?? null;
  if (matched) {
    return {
      repoRoot: listed.repoRoot,
      remoteBranch: matched.ref,
      oid: matched.oid,
    };
  }

  const verified = await runLocalOrThrow('git', ['-C', repoRoot, 'rev-parse', '--verify', `refs/remotes/${remoteBranch}`]).catch(() => '');
  const oid = String(verified ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(oid)) {
    throw new Error(`remote branch "${remoteBranch}" was not found in ${repoRoot}`);
  }
  return {
    repoRoot,
    remoteBranch,
    oid,
  };
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

export async function gitResolveCommitSha(repoRoot: string, ref: string): Promise<string | null> {
  const root = String(repoRoot ?? '').trim();
  const target = String(ref ?? '').trim();
  if (!root || !target) return null;
  const r = await runLocal('git', ['-C', root, 'rev-parse', '--verify', `${target}^{commit}`]);
  if (r.code !== 0) return null;
  const sha = String(r.stdout ?? '').trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

async function gitRequiredConfig(repoRoot: string, key: string): Promise<string> {
  const value = (await runLocalOrThrow('git', ['-C', repoRoot, 'config', '--get', key])).trim();
  if (!value) throw new Error(`Host git config ${key} is not set.`);
  return value;
}

async function hostCommitEnv(repoRoot: string): Promise<NodeJS.ProcessEnv> {
  const [name, email] = await Promise.all([gitRequiredConfig(repoRoot, 'user.name'), gitRequiredConfig(repoRoot, 'user.email')]);
  return {
    ...process.env,
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

export async function createHostAuthoredMirrorCommit(opts: {
  repoRoot: string;
  sourceRef: string;
  parentRef: string;
  message?: string;
}): Promise<string> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const sourceRef = String(opts.sourceRef ?? '').trim();
  const parentRef = String(opts.parentRef ?? '').trim();
  const message = String(opts.message ?? '').trim() || 'chore(drone): mirror drone changes for host apply';
  if (!repoRoot) throw new Error('missing repoRoot');
  if (!sourceRef) throw new Error('missing sourceRef');
  if (!parentRef) throw new Error('missing parentRef');

  const tree = (await runLocalOrThrow('git', ['-C', repoRoot, 'rev-parse', `${sourceRef}^{tree}`])).trim();
  if (!/^[0-9a-f]{40}$/.test(tree)) throw new Error(`Failed resolving tree for ${sourceRef}.`);

  const parentSha = await gitResolveCommitSha(repoRoot, parentRef);
  if (!parentSha) throw new Error(`Failed resolving mirror parent ${parentRef}.`);

  const commit = await runLocal('git', ['-C', repoRoot, 'commit-tree', tree, '-p', parentSha, '-m', message], {
    env: await hostCommitEnv(repoRoot),
  });
  if (commit.code !== 0) {
    const details = (commit.stderr || commit.stdout || `git commit-tree failed (exit ${commit.code})`).trim();
    throw new Error(`Failed creating host-authored mirror commit for ${sourceRef}.\n\n${details}`);
  }
  const sha = String(commit.stdout ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Failed parsing host-authored mirror commit SHA: ${commit.stdout || '(empty)'}`);
  return sha;
}

export async function updateHostRef(opts: { repoRoot: string; refName: string; target: string }): Promise<void> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const refName = String(opts.refName ?? '').trim();
  const target = String(opts.target ?? '').trim();
  if (!repoRoot) throw new Error('missing repoRoot');
  if (!refName) throw new Error('missing refName');
  if (!target) throw new Error('missing target');
  await runLocalOrThrow('git', ['-C', repoRoot, 'update-ref', refName, target]);
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
  const summary = parseGitStatusPorcelainV2Z(raw);
  return await applyWorkingTreeReviewMetadata(repoRoot, summary);
}

export async function gitRepoCommitList(opts: {
  repoRoot: string;
  headRef?: string;
  baseRef?: string | null;
  limit?: number;
}): Promise<RepoCommitSummary[]> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  if (!repoRoot) throw new Error('missing repo root');
  const headRef = String(opts.headRef ?? 'HEAD').trim() || 'HEAD';
  const baseRef = String(opts.baseRef ?? '').trim();
  const limit =
    typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0 ? Math.min(200, Math.floor(opts.limit)) : 100;
  const revisionRange = baseRef ? `${baseRef}..${headRef}` : headRef;
  const raw = await runLocalOrThrow('git', [
    '-C',
    repoRoot,
    'log',
    `--max-count=${limit}`,
    '--date=iso-strict',
    '--no-show-signature',
    '--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s',
    revisionRange,
  ]);
  return parseGitCommitList(raw);
}

export async function gitRepoCommitDetails(opts: { repoRoot: string; sha: string }): Promise<RepoCommitDetails> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const sha = String(opts.sha ?? '').trim().toLowerCase();
  if (!repoRoot) throw new Error('missing repo root');
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('invalid commit sha');

  const commitMeta = parseGitCommitDetails(
    await runLocalOrThrow('git', [
      '-C',
      repoRoot,
      'show',
      '-s',
      '--no-show-signature',
      '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%b',
      sha,
    ]),
  );
  const parentSha = commitMeta.parents[0] ?? null;
  const [nameStatusRaw, numstatRaw] = await Promise.all([
    runLocalOrThrow('git', ['-C', repoRoot, ...commitDiffTreeArgs(sha, parentSha, '--name-status')]),
    runLocalOrThrow('git', ['-C', repoRoot, ...commitDiffTreeArgs(sha, parentSha, '--numstat')]),
  ]);
  const nameStatus = parseGitNameStatusZ(nameStatusRaw);
  const numstat = parseGitNumStatZ(numstatRaw);
  const statByKey = new Map<string, RepoNumStatEntry>();
  for (const entry of numstat) {
    statByKey.set(`${entry.path}\u0000${entry.originalPath ?? ''}`, entry);
  }
  const entries: RepoCommitChangeEntry[] = nameStatus.map((entry) => {
    const stats = statByKey.get(`${entry.path}\u0000${entry.originalPath ?? ''}`) ?? null;
    const additions = stats?.additions ?? 0;
    const deletions = stats?.deletions ?? 0;
    return {
      path: entry.path,
      originalPath: entry.originalPath,
      statusChar: entry.statusChar,
      statusType: statusCharToType(entry.statusChar),
      additions,
      deletions,
      changes: additions + deletions,
    };
  });
  const additions = entries.reduce((sum, entry) => sum + entry.additions, 0);
  const deletions = entries.reduce((sum, entry) => sum + entry.deletions, 0);
  return {
    repoRoot,
    commit: commitMeta,
    counts: {
      changed: entries.length,
      additions,
      deletions,
    },
    entries,
  };
}

export async function gitRepoCommitDiffForPath(opts: {
  repoRoot: string;
  sha: string;
  filePath: string;
  contextLines?: number;
  maxChars?: number;
}): Promise<{ repoRoot: string; sha: string; path: string; diff: string; truncated: boolean }> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const sha = String(opts.sha ?? '').trim().toLowerCase();
  const requestedPath = String(opts.filePath ?? '').trim();
  if (!repoRoot) throw new Error('missing repo root');
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('invalid commit sha');
  if (!requestedPath || requestedPath.includes('\0')) throw new Error('invalid file path');
  const contextLines =
    typeof opts.contextLines === 'number' && Number.isFinite(opts.contextLines) && opts.contextLines >= 0
      ? Math.floor(opts.contextLines)
      : 3;
  const maxChars =
    typeof opts.maxChars === 'number' && Number.isFinite(opts.maxChars) && opts.maxChars > 0 ? Math.floor(opts.maxChars) : 350_000;
  const parentsRaw = await runLocalOrThrow('git', ['-C', repoRoot, 'show', '-s', '--format=%P', sha]);
  const parentSha = String(parentsRaw ?? '')
    .trim()
    .split(/\s+/g)
    .map((value) => value.trim().toLowerCase())
    .find((value) => /^[0-9a-f]{40}$/.test(value)) ?? null;
  const args = parentSha
    ? ['-C', repoRoot, 'diff', '--no-color', '--no-ext-diff', `-U${contextLines}`, parentSha, sha, '--', requestedPath]
    : ['-C', repoRoot, 'show', '--format=', '--no-color', '--no-ext-diff', `-U${contextLines}`, sha, '--', requestedPath];
  let diffText = await runLocalOrThrow('git', args);
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
    const noIndexStdout = String(r.stdout ?? '');
    const noIndexStderr = String(r.stderr ?? '').trim();
    if (!noIndexStdout && noIndexStderr) {
      throw new Error(noIndexStderr);
    }
    diffText = noIndexStdout;
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
export async function applyExportedDiffToMainWorkingTree(opts: { repoRoot: string; diffPath: string; label?: string }): Promise<void> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const diffPath = String(opts.diffPath ?? '').trim();
  const label = String(opts.label ?? '').trim() || path.basename(diffPath);
  if (!repoRoot) throw new Error('missing repoRoot');
  if (!diffPath) throw new Error('missing diffPath');

  let r = await runLocal('git', ['-C', repoRoot, 'apply', '--3way', '--index', '--whitespace=nowarn', diffPath]);
  const initialAttemptCombined = `${String(r.stderr ?? '')}\n${String(r.stdout ?? '')}`.trim();
  if (r.code !== 0 && shouldRetryPatchApplyWithoutThreeWay(initialAttemptCombined)) {
    r = await runLocal('git', ['-C', repoRoot, 'apply', '--index', '--whitespace=nowarn', diffPath]);
  }
  if (r.code === 0) return;

  const combined = `${String(r.stderr ?? '')}\n${String(r.stdout ?? '')}`.trim();
  const conflictFiles = Array.from(new Set([...parsePatchConflictFiles(combined), ...(await gitUnmergedFiles(repoRoot))])).sort((a, b) =>
    a.localeCompare(b)
  );
  const looksLikeConflict =
    conflictFiles.length > 0 ||
    /patch does not apply|CONFLICT|could not apply|failed to merge|with conflicts|U\s+\S+/i.test(combined) ||
    isThreeWayAncestorError(combined);
  const details = (r.stderr || r.stdout || `git apply failed (exit ${r.code})`).trim();
  throw new RepoPatchApplyError({
    kind: looksLikeConflict ? 'patch_apply_conflict' : 'patch_apply_failed',
    patchName: label,
    conflictFiles,
    stdout: r.stdout,
    stderr: r.stderr,
    message: looksLikeConflict
      ? `Host repo has conflicts while applying ${label}.\n\n${details}`
      : `Failed applying exported diff ${label} to host repo.\n\n${details}`,
  });
}

async function gitPath(repoRoot: string, relPath: string): Promise<string> {
  const resolved = (await runLocalOrThrow('git', ['-C', repoRoot, 'rev-parse', '--git-path', relPath])).trim();
  if (!resolved) return resolved;
  return path.isAbsolute(resolved) ? resolved : path.resolve(repoRoot, resolved);
}

async function clearGitMergeStateBestEffort(repoRoot: string): Promise<void> {
  for (const relPath of ['MERGE_HEAD', 'MERGE_MODE', 'MERGE_MSG', 'AUTO_MERGE']) {
    try {
      const resolved = await gitPath(repoRoot, relPath);
      if (!resolved) continue;
      await fs.rm(resolved, { force: true });
    } catch {
      // Ignore cleanup failures; merge metadata is best-effort after a successful host apply.
    }
  }
}

async function restoreCleanHostRepoStateAfterFailedApply(repoRoot: string, restoreRef: string): Promise<void> {
  try {
    await runLocalOrThrow('git', ['-C', repoRoot, 'merge', '--abort']);
    await clearGitMergeStateBestEffort(repoRoot);
    return;
  } catch {
    // Fall back to a hard reset only when the caller guaranteed a clean repo before apply.
  }
  await runLocalOrThrow('git', ['-C', repoRoot, 'reset', '--hard', restoreRef]);
  await runLocalOrThrow('git', ['-C', repoRoot, 'clean', '-fd']);
  await clearGitMergeStateBestEffort(repoRoot);
}

async function applyWorktreeDiffToMainWorkingTree(opts: { repoRoot: string; worktreePath: string; label?: string }): Promise<void> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const worktreePath = String(opts.worktreePath ?? '').trim();
  const label = String(opts.label ?? '').trim() || path.basename(worktreePath);
  if (!repoRoot) throw new Error('missing repoRoot');
  if (!worktreePath) throw new Error('missing worktreePath');

  const diff = await runLocal('git', ['-C', worktreePath, 'diff', '--binary', '--full-index', '--find-renames', '--no-color', '--no-ext-diff', 'HEAD']);
  if (diff.code !== 0) {
    const details = `${String(diff.stderr ?? '')}\n${String(diff.stdout ?? '')}`.trim();
    throw new Error(`Failed generating merged host apply diff for ${label}.${details ? `\n\n${details}` : ''}`);
  }
  if (!String(diff.stdout ?? '').trim()) return;

  const tempRoot = droneRootPath('repo-exports');
  await fs.mkdir(tempRoot, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tempRoot, 'host-apply-'));
  const diffPath = path.join(tempDir, 'import.diff');
  try {
    await fs.writeFile(diffPath, diff.stdout, 'utf8');

    const check = await runLocal('git', ['-C', repoRoot, 'apply', '--check', '--index', '--whitespace=nowarn', diffPath]);
    if (check.code !== 0) {
      const combined = `${String(check.stderr ?? '')}\n${String(check.stdout ?? '')}`.trim();
      const conflictFiles = parsePatchConflictFiles(combined);
      const looksLikeConflict =
        conflictFiles.length > 0 ||
        /patch does not apply|CONFLICT|could not apply|failed to merge|with conflicts/i.test(combined) ||
        isThreeWayAncestorError(combined);
      const details = (check.stderr || check.stdout || `git apply --check failed (exit ${check.code})`).trim();
      throw new RepoPatchApplyError({
        kind: looksLikeConflict ? 'patch_apply_conflict' : 'patch_apply_failed',
        patchName: label,
        conflictFiles,
        stdout: check.stdout,
        stderr: check.stderr,
        appliedToHost: false,
        message: looksLikeConflict
          ? `Host repo would have conflicts while applying ${label}. Host repo was not modified.\n\n${details}`
          : `Failed validating merged host apply diff for ${label}. Host repo was not modified.\n\n${details}`,
      });
    }

    await applyExportedDiffToMainWorkingTree({ repoRoot, diffPath, label });
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup failures
    }
  }
}

async function applyBranchMergeToMainWorkingTree(opts: { repoRoot: string; branch: string }): Promise<void> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const branch = String(opts.branch ?? '').trim();
  if (!repoRoot) throw new Error('missing repoRoot');
  if (!branch) throw new Error('missing branch');
  const restoreRef = (await runLocalOrThrow('git', ['-C', repoRoot, 'rev-parse', 'HEAD'])).trim();
  const wasCleanBefore = await gitIsClean(repoRoot);
  let mergeStateShouldBeCleared = false;
  try {
    const merge = await runLocal('git', ['-C', repoRoot, 'merge', '--no-commit', '--no-ff', branch]);
    const combined = `${String(merge.stderr ?? '')}\n${String(merge.stdout ?? '')}`.trim();
    const conflictFiles = Array.from(new Set([...parsePatchConflictFiles(combined), ...(await gitUnmergedFiles(repoRoot))])).sort((a, b) =>
      a.localeCompare(b)
    );
    const looksLikeConflict =
      conflictFiles.length > 0 ||
      /CONFLICT|Automatic merge failed|fix conflicts and then commit the result/i.test(combined);

    if (merge.code === 0) {
      mergeStateShouldBeCleared = true;
      return;
    }

    if (looksLikeConflict) {
      mergeStateShouldBeCleared = true;
      const details = (merge.stderr || merge.stdout || `git merge failed (exit ${merge.code})`).trim();
      throw new RepoPatchApplyError({
        kind: 'patch_apply_conflict',
        patchName: branch,
        conflictFiles,
        stdout: merge.stdout,
        stderr: merge.stderr,
        appliedToHost: true,
        message: `Host repo has conflicts while applying ${branch}.\n\n${details}`,
      });
    }

    if (wasCleanBefore) {
      await restoreCleanHostRepoStateAfterFailedApply(repoRoot, restoreRef);
    }
    const details = (merge.stderr || merge.stdout || `git merge failed (exit ${merge.code})`).trim();
    throw new RepoPatchApplyError({
      kind: 'patch_apply_failed',
      patchName: branch,
      conflictFiles,
      stdout: merge.stdout,
      stderr: merge.stderr,
      appliedToHost: false,
      message: `Failed applying imported branch ${branch} to host repo.\n\n${details}`,
    });
  } finally {
    if (mergeStateShouldBeCleared) {
      await clearGitMergeStateBestEffort(repoRoot);
    }
  }
}

async function mergeBranchNoCommitToMainWorkingTree(opts: { repoRoot: string; branch: string }): Promise<void> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const branch = String(opts.branch ?? '').trim();
  if (!repoRoot) throw new Error('missing repoRoot');
  if (!branch) throw new Error('missing branch');

  const merge = await runLocal('git', ['-C', repoRoot, 'merge', '--no-commit', '--no-ff', branch]);
  const combined = `${String(merge.stderr ?? '')}\n${String(merge.stdout ?? '')}`.trim();
  const conflictFiles = Array.from(new Set([...parsePatchConflictFiles(combined), ...(await gitUnmergedFiles(repoRoot))])).sort((a, b) =>
    a.localeCompare(b)
  );
  const looksLikeConflict =
    conflictFiles.length > 0 ||
    /CONFLICT|Automatic merge failed|fix conflicts and then commit the result/i.test(combined);

  if (merge.code === 0) return;

  if (looksLikeConflict) {
    const details = (merge.stderr || merge.stdout || `git merge failed (exit ${merge.code})`).trim();
    throw new RepoPatchApplyError({
      kind: 'patch_apply_conflict',
      patchName: branch,
      conflictFiles,
      stdout: merge.stdout,
      stderr: merge.stderr,
      appliedToHost: true,
      message: `Host repo has conflicts while applying ${branch}.\n\n${details}`,
    });
  }

  const details = (merge.stderr || merge.stdout || `git merge failed (exit ${merge.code})`).trim();
  throw new RepoPatchApplyError({
    kind: 'patch_apply_failed',
    patchName: branch,
    conflictFiles,
    stdout: merge.stdout,
    stderr: merge.stderr,
    appliedToHost: false,
    message: `Failed applying imported branch ${branch} to host repo.\n\n${details}`,
  });
}

export async function applyBranchMergeNoCommitToMainWorkingTree(opts: {
  repoRoot: string;
  branch: string;
  applyConflictsToHost?: boolean;
}): Promise<void> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const branch = String(opts.branch ?? '').trim();
  const applyConflictsToHost = opts.applyConflictsToHost === true;
  if (!repoRoot) throw new Error('missing repoRoot');
  if (!branch) throw new Error('missing branch');

  const hostHeadRef = (await runLocalOrThrow('git', ['-C', repoRoot, 'rev-parse', 'HEAD'])).trim();
  const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const safeBranch = safeSlug(branch);
  const worktreePath = path.join(defaultWorktreeRootDir(), repoKeyFromGitRoot(repoRoot), `host-merge-${safeBranch}-${runId}`);
  const tempBranch = `drone-host-merge/${safeBranch}-${runId}`;

  try {
    await ensureQuarantineWorktree({
      repoRoot,
      worktreePath,
      branch: tempBranch,
      fromRef: hostHeadRef,
    });

    const merge = await runLocal('git', ['-C', worktreePath, 'merge', '--no-commit', '--no-ff', branch]);
    const combined = `${String(merge.stderr ?? '')}\n${String(merge.stdout ?? '')}`.trim();
    const conflictFiles = Array.from(new Set([...parsePatchConflictFiles(combined), ...(await gitUnmergedFiles(worktreePath))])).sort((a, b) =>
      a.localeCompare(b)
    );
    const looksLikeConflict =
      conflictFiles.length > 0 ||
      /CONFLICT|Automatic merge failed|fix conflicts and then commit the result/i.test(combined);

    if (merge.code === 0) {
      await mergeBranchNoCommitToMainWorkingTree({ repoRoot, branch });
      return;
    }

    if (looksLikeConflict) {
      const details = (merge.stderr || merge.stdout || `git merge failed (exit ${merge.code})`).trim();
      if (!applyConflictsToHost) {
        throw new RepoPatchApplyError({
          kind: 'patch_apply_conflict',
          patchName: branch,
          conflictFiles,
          stdout: merge.stdout,
          stderr: merge.stderr,
          appliedToHost: false,
          message: `Host repo would have conflicts while applying ${branch}. Host repo was not modified.\n\n${details}`,
        });
      }
      await mergeBranchNoCommitToMainWorkingTree({ repoRoot, branch });
      return;
    }

    const details = (merge.stderr || merge.stdout || `git merge failed (exit ${merge.code})`).trim();
    throw new RepoPatchApplyError({
      kind: 'patch_apply_failed',
      patchName: branch,
      conflictFiles,
      stdout: merge.stdout,
      stderr: merge.stderr,
      appliedToHost: false,
      message: `Failed preparing host apply for ${branch}. Host repo was not modified.\n\n${details}`,
    });
  } finally {
    await cleanupQuarantineWorktree({
      repoRoot,
      worktreePath,
      branch: tempBranch,
    }).catch(() => {
      // ignore cleanup failures
    });
  }
}

// Preview imported branch changes in a disposable worktree first. Clean merges are applied
// back to the real host repo as a plain diff. Conflicts only touch the host repo when the
// caller explicitly asks to materialize them there for manual resolution.
export async function applyBranchDiffToMainWorkingTree(opts: {
  repoRoot: string;
  branch: string;
  applyConflictsToHost?: boolean;
}): Promise<void> {
  const repoRoot = String(opts.repoRoot ?? '').trim();
  const branch = String(opts.branch ?? '').trim();
  const applyConflictsToHost = opts.applyConflictsToHost === true;
  if (!repoRoot) throw new Error('missing repoRoot');
  if (!branch) throw new Error('missing branch');

  const hostHeadRef = (await runLocalOrThrow('git', ['-C', repoRoot, 'rev-parse', 'HEAD'])).trim();
  const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const safeBranch = safeSlug(branch);
  const worktreePath = path.join(defaultWorktreeRootDir(), repoKeyFromGitRoot(repoRoot), `host-apply-${safeBranch}-${runId}`);
  const tempBranch = `drone-host-apply/${safeBranch}-${runId}`;

  try {
    await ensureQuarantineWorktree({
      repoRoot,
      worktreePath,
      branch: tempBranch,
      fromRef: hostHeadRef,
    });

    const merge = await runLocal('git', ['-C', worktreePath, 'merge', '--no-commit', '--no-ff', branch]);
    const combined = `${String(merge.stderr ?? '')}\n${String(merge.stdout ?? '')}`.trim();
    const conflictFiles = Array.from(new Set([...parsePatchConflictFiles(combined), ...(await gitUnmergedFiles(worktreePath))])).sort((a, b) =>
      a.localeCompare(b)
    );
    const looksLikeConflict =
      conflictFiles.length > 0 ||
      /CONFLICT|Automatic merge failed|fix conflicts and then commit the result/i.test(combined);

    if (merge.code === 0) {
      await applyWorktreeDiffToMainWorkingTree({ repoRoot, worktreePath, label: branch });
      return;
    }

    if (looksLikeConflict) {
      const details = (merge.stderr || merge.stdout || `git merge failed (exit ${merge.code})`).trim();
      if (!applyConflictsToHost) {
        throw new RepoPatchApplyError({
          kind: 'patch_apply_conflict',
          patchName: branch,
          conflictFiles,
          stdout: merge.stdout,
          stderr: merge.stderr,
          appliedToHost: false,
          message: `Host repo would have conflicts while applying ${branch}. Host repo was not modified.\n\n${details}`,
        });
      }
      await applyBranchMergeToMainWorkingTree({ repoRoot, branch });
      return;
    }

    const details = (merge.stderr || merge.stdout || `git merge failed (exit ${merge.code})`).trim();
    throw new RepoPatchApplyError({
      kind: 'patch_apply_failed',
      patchName: branch,
      conflictFiles,
      stdout: merge.stdout,
      stderr: merge.stderr,
      appliedToHost: false,
      message: `Failed preparing host apply for ${branch}. Host repo was not modified.\n\n${details}`,
    });
  } finally {
    await cleanupQuarantineWorktree({
      repoRoot,
      worktreePath,
      branch: tempBranch,
    }).catch(() => {
      // ignore cleanup failures
    });
  }
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

  const listHeads = await runLocal('git', ['bundle', 'list-heads', bundlePath]);
  if (listHeads.code !== 0) {
    const details = `${String(listHeads.stderr ?? '')}\n${String(listHeads.stdout ?? '')}`.trim();
    throw new Error(`Failed reading bundle refs from ${bundlePath}.${details ? `\n\n${details}` : ''}`);
  }

  const sourceRef = resolveBundleImportSourceRefFromListHeads(listHeads.stdout);
  const fetch = await runLocal('git', ['-C', repoRoot, 'fetch', '--no-tags', '--force', bundlePath, `${sourceRef}:${refName}`]);
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
