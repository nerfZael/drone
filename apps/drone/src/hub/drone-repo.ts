import { dvmExec } from '../host/dvm';
import { normalizeContainerPath } from './hub-format';
import { parseGitStatusPorcelainV2Z } from './repoOps';

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
  return {
    repoRoot,
    summary: parseGitStatusPorcelainV2Z(statusRaw.stdout),
  };
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

    if (!diffText) {
      const tracked = await runGitInDroneOrThrow({
        container: opts.container,
        repoPathInContainer,
        args: ['ls-files', '--error-unmatch', '--', requestedPath],
        okCodes: [0, 1],
      });
      if (tracked.code !== 0) {
        const noIndex = await runGitInDroneOrThrow({
          container: opts.container,
          repoPathInContainer,
          args: ['diff', '--no-color', '--no-ext-diff', '--no-index', contextFlag, '/dev/null', requestedPath],
          okCodes: [0, 1],
        });
        diffText = noIndex.stdout;
        fromUntracked = Boolean(diffText);
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

type RepoPullChangeEntry = {
  path: string;
  originalPath: string | null;
  statusChar: string;
  statusType: RepoPullChangeType;
};

function nameStatusCharToType(chRaw: string): RepoPullChangeType {
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

function parseGitNameStatusZ(raw: string): RepoPullChangeEntry[] {
  const tokens = String(raw ?? '')
    .split('\0')
    .filter((t) => t.length > 0);

  const out: RepoPullChangeEntry[] = [];
  const statusTokenPattern = /^[A-Z][0-9]*$/;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    const tab = token.indexOf('\t');
    if (tab > 0) {
      // Back-compat for tab-delimited output variants.
      const statusRaw = token.slice(0, tab);
      const statusChar = statusRaw.charAt(0) || '?';
      const pathA = token.slice(tab + 1);
      if (!pathA) continue;

      if (statusChar === 'R' || statusChar === 'C') {
        const pathB = tokens[i + 1] ?? '';
        i += 1;
        const newPath = pathB || pathA;
        out.push({
          path: newPath,
          originalPath: pathA,
          statusChar,
          statusType: nameStatusCharToType(statusChar),
        });
        continue;
      }

      out.push({
        path: pathA,
        originalPath: null,
        statusChar,
        statusType: nameStatusCharToType(statusChar),
      });
      continue;
    }

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
}): Promise<{ repoRoot: string; baseSha: string; headSha: string; entries: RepoPullChangeEntry[] }> {
  const repoPathInContainer = normalizeContainerPath(opts.repoPathInContainer);
  const repoRootRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['rev-parse', '--show-toplevel'],
  });
  const repoRoot = String(repoRootRaw.stdout ?? '').trim() || repoPathInContainer;

  const baseSha = await droneRepoBaseSha({ container: opts.container, repoPathInContainer });
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

  const nameStatus = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['diff', '--name-status', '-z', `${baseSha}..${headSha}`],
  });
  const entries = parseGitNameStatusZ(nameStatus.stdout);
  return { repoRoot, baseSha, headSha, entries };
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

