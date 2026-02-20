import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  gitPullHostBranchBeforeCreate,
  deleteHostRefBestEffort,
  HostRepoPullBeforeCreateError,
  importBundleHeadToHostRef,
  mergeBranchIntoMainWorkingTreeNoCommit,
  RepoPatchApplyError,
} from '../src/hub/repoOps';

function run(cmd: string, args: string[], cwd?: string): { code: number; stdout: string; stderr: string } {
  const r = cp.spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    code: typeof r.status === 'number' ? r.status : 1,
    stdout: String(r.stdout ?? ''),
    stderr: String(r.stderr ?? ''),
  };
}

function runOrThrow(cmd: string, args: string[], cwd?: string): string {
  const r = run(cmd, args, cwd);
  if (r.code !== 0) {
    throw new Error(
      [
        `Command failed: ${cmd} ${args.join(' ')}`,
        `cwd: ${cwd ?? process.cwd()}`,
        `exit: ${String(r.code)}`,
        r.stdout.trim() ? `stdout:\n${r.stdout.trim()}` : '',
        r.stderr.trim() ? `stderr:\n${r.stderr.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')
    );
  }
  return r.stdout;
}

function mkRepo(): { repoRoot: string; cleanup: () => void } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-repo-ops-'));
  runOrThrow('git', ['init', '-b', 'main'], repoRoot);
  runOrThrow('git', ['config', 'user.name', 'Drone Test'], repoRoot);
  runOrThrow('git', ['config', 'user.email', 'drone-test@example.com'], repoRoot);
  return {
    repoRoot,
    cleanup: () => fs.rmSync(repoRoot, { recursive: true, force: true }),
  };
}

function writeAndCommit(repoRoot: string, relPath: string, content: string, message: string): void {
  fs.writeFileSync(path.join(repoRoot, relPath), content, 'utf8');
  runOrThrow('git', ['add', relPath], repoRoot);
  runOrThrow('git', ['commit', '-m', message], repoRoot);
}

describe('repoOps git-native pull helpers', () => {
  test('gitPullHostBranchBeforeCreate fast-forwards current tracked host branch', async () => {
    const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-repo-ops-remote-'));
    const { repoRoot: sourceRepo, cleanup: cleanupSource } = mkRepo();
    const hostClone = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-repo-ops-host-'));
    try {
      runOrThrow('git', ['init', '--bare'], remoteRoot);
      runOrThrow('git', ['remote', 'add', 'origin', remoteRoot], sourceRepo);
      writeAndCommit(sourceRepo, 'base.txt', 'base\n', 'init');
      runOrThrow('git', ['push', '-u', 'origin', 'main'], sourceRepo);

      runOrThrow('git', ['clone', '-b', 'main', remoteRoot, hostClone]);
      const hostHeadBefore = runOrThrow('git', ['rev-parse', 'HEAD'], hostClone).trim();

      writeAndCommit(sourceRepo, 'base.txt', 'base\nnext\n', 'update upstream');
      const sourceHeadAfter = runOrThrow('git', ['rev-parse', 'HEAD'], sourceRepo).trim();
      runOrThrow('git', ['push', 'origin', 'main'], sourceRepo);

      const pulled = await gitPullHostBranchBeforeCreate(hostClone);
      expect(pulled.repoRoot).toBe(hostClone);
      expect(pulled.branch).toBe('main');
      expect(pulled.upstream).toBe('origin/main');
      expect(pulled.beforeSha).toBe(hostHeadBefore.toLowerCase());
      expect(pulled.afterSha).toBe(sourceHeadAfter.toLowerCase());
      expect(pulled.changed).toBe(true);

      const hostHeadAfter = runOrThrow('git', ['rev-parse', 'HEAD'], hostClone).trim();
      expect(hostHeadAfter).toBe(sourceHeadAfter);
    } finally {
      cleanupSource();
      fs.rmSync(remoteRoot, { recursive: true, force: true });
      fs.rmSync(hostClone, { recursive: true, force: true });
    }
  });

  test('gitPullHostBranchBeforeCreate rejects branches without upstream tracking', async () => {
    const { repoRoot, cleanup } = mkRepo();
    try {
      writeAndCommit(repoRoot, 'base.txt', 'base\n', 'init');
      let err: unknown = null;
      try {
        await gitPullHostBranchBeforeCreate(repoRoot);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(HostRepoPullBeforeCreateError);
      expect((err as HostRepoPullBeforeCreateError).code).toBe('missing_upstream');
    } finally {
      cleanup();
    }
  });

  test('gitPullHostBranchBeforeCreate rejects detached HEAD state', async () => {
    const { repoRoot, cleanup } = mkRepo();
    try {
      writeAndCommit(repoRoot, 'base.txt', 'base\n', 'init');
      runOrThrow('git', ['checkout', '--detach', 'HEAD'], repoRoot);
      let err: unknown = null;
      try {
        await gitPullHostBranchBeforeCreate(repoRoot);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(HostRepoPullBeforeCreateError);
      expect((err as HostRepoPullBeforeCreateError).code).toBe('detached_head');
    } finally {
      cleanup();
    }
  });

  test('imports bundle HEAD into a temporary host ref and supports cleanup', async () => {
    const { repoRoot, cleanup } = mkRepo();
    try {
      writeAndCommit(repoRoot, 'a.txt', 'one\n', 'init');
      writeAndCommit(repoRoot, 'a.txt', 'two\n', 'update');
      const head = runOrThrow('git', ['rev-parse', 'HEAD'], repoRoot).trim();
      const bundlePath = path.join(repoRoot, 'changes.bundle');
      runOrThrow('git', ['bundle', 'create', bundlePath, 'HEAD~1..HEAD'], repoRoot);

      const refName = 'refs/drone/imports/test/import-one';
      const importedSha = await importBundleHeadToHostRef({ repoRoot, bundlePath, refName });
      expect(importedSha).toBe(head);
      const refSha = runOrThrow('git', ['rev-parse', refName], repoRoot).trim();
      expect(refSha).toBe(head);

      await deleteHostRefBestEffort({ repoRoot, refName });
      const missingRef = run('git', ['rev-parse', '--verify', refName], repoRoot);
      expect(missingRef.code).not.toBe(0);
    } finally {
      cleanup();
    }
  });

  test('mergeBranchIntoMainWorkingTreeNoCommit creates a normal merge state on success', async () => {
    const { repoRoot, cleanup } = mkRepo();
    try {
      writeAndCommit(repoRoot, 'base.txt', 'base\n', 'init');
      runOrThrow('git', ['checkout', '-b', 'feature'], repoRoot);
      writeAndCommit(repoRoot, 'feature.txt', 'feature\n', 'feature work');
      runOrThrow('git', ['checkout', 'main'], repoRoot);

      await mergeBranchIntoMainWorkingTreeNoCommit({ repoRoot, branch: 'feature' });

      const mergeHead = runOrThrow('git', ['rev-parse', '--verify', 'MERGE_HEAD'], repoRoot).trim();
      expect(mergeHead.length).toBe(40);
      const status = runOrThrow('git', ['status', '--porcelain'], repoRoot);
      expect(status.trim().length).toBeGreaterThan(0);

      runOrThrow('git', ['merge', '--abort'], repoRoot);
      const clean = runOrThrow('git', ['status', '--porcelain'], repoRoot).trim();
      expect(clean).toBe('');
    } finally {
      cleanup();
    }
  });

  test('mergeBranchIntoMainWorkingTreeNoCommit reports conflict files for merge conflicts', async () => {
    const { repoRoot, cleanup } = mkRepo();
    try {
      writeAndCommit(repoRoot, 'conflict.txt', 'same\n', 'init');
      runOrThrow('git', ['checkout', '-b', 'feature'], repoRoot);
      writeAndCommit(repoRoot, 'conflict.txt', 'feature\n', 'feature change');
      runOrThrow('git', ['checkout', 'main'], repoRoot);
      writeAndCommit(repoRoot, 'conflict.txt', 'main\n', 'main change');

      let err: unknown = null;
      try {
        await mergeBranchIntoMainWorkingTreeNoCommit({ repoRoot, branch: 'feature' });
      } catch (e) {
        err = e;
      }

      expect(err).toBeInstanceOf(RepoPatchApplyError);
      const patchErr = err as RepoPatchApplyError;
      expect(patchErr.kind).toBe('patch_apply_conflict');
      expect(patchErr.conflictFiles).toContain('conflict.txt');

      const unmerged = runOrThrow('git', ['diff', '--name-only', '--diff-filter=U'], repoRoot)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      expect(unmerged).toContain('conflict.txt');

      runOrThrow('git', ['merge', '--abort'], repoRoot);
    } finally {
      cleanup();
    }
  });

  test('importBundleHeadToHostRef throws a clear error when bundle path is missing', async () => {
    const { repoRoot, cleanup } = mkRepo();
    try {
      writeAndCommit(repoRoot, 'a.txt', 'one\n', 'init');
      const missingPath = path.join(repoRoot, 'does-not-exist.bundle');
      let err: unknown = null;
      try {
        await importBundleHeadToHostRef({
          repoRoot,
          bundlePath: missingPath,
          refName: 'refs/drone/imports/test/missing',
        });
      } catch (e) {
        err = e;
      }
      expect(String((err as any)?.message ?? err)).toContain('bundle not found');
    } finally {
      cleanup();
    }
  });
});
