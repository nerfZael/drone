import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  applyBranchMergeNoCommitToMainWorkingTree,
  applyBranchDiffToMainWorkingTree,
  buildWorkingTreeRepoChangeReviewToken,
  createHostAuthoredMirrorCommit,
  gitListRemoteBranches,
  gitRepoChangesSummary,
  gitResolveRemoteBranchForCreate,
  deleteHostRefBestEffort,
  importBundleHeadToHostRef,
  RepoPatchApplyError,
  updateHostRef,
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
  fs.mkdirSync(path.dirname(path.join(repoRoot, relPath)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, relPath), content, 'utf8');
  runOrThrow('git', ['add', relPath], repoRoot);
  runOrThrow('git', ['commit', '-m', message], repoRoot);
}

describe('repoOps git-native helpers', () => {
  test('lists remote branches and resolves a selected remote branch for repo seeding', async () => {
    const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-repo-ops-remote-list-'));
    const { repoRoot: sourceRepo, cleanup: cleanupSource } = mkRepo();
    const hostClone = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-repo-ops-host-list-'));
    try {
      runOrThrow('git', ['init', '--bare'], remoteRoot);
      runOrThrow('git', ['remote', 'add', 'origin', remoteRoot], sourceRepo);
      writeAndCommit(sourceRepo, 'base.txt', 'base\n', 'init');
      runOrThrow('git', ['push', '-u', 'origin', 'main'], sourceRepo);
      runOrThrow('git', ['checkout', '-b', 'release/next'], sourceRepo);
      writeAndCommit(sourceRepo, 'release.txt', 'next\n', 'release');
      runOrThrow('git', ['push', '-u', 'origin', 'release/next'], sourceRepo);

      runOrThrow('git', ['clone', '-b', 'main', remoteRoot, hostClone]);
      runOrThrow('git', ['fetch', '--all', '--prune'], hostClone);

      const listed = await gitListRemoteBranches(hostClone);
      expect(listed.repoRoot).toBe(hostClone);
      expect(listed.hostBranch).toBe('main');
      expect(listed.remoteBranches.map((entry) => entry.ref)).toContain('origin/main');
      expect(listed.remoteBranches.map((entry) => entry.ref)).toContain('origin/release/next');
      expect(listed.remoteBranches.some((entry) => entry.ref.endsWith('/HEAD'))).toBe(false);

      const resolved = await gitResolveRemoteBranchForCreate(hostClone, 'origin/release/next');
      expect(resolved.repoRoot).toBe(hostClone);
      expect(resolved.remoteBranch).toBe('origin/release/next');
      expect(resolved.oid).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      cleanupSource();
      fs.rmSync(remoteRoot, { recursive: true, force: true });
      fs.rmSync(hostClone, { recursive: true, force: true });
    }
  });

  test('imports a revision-range bundle into a temporary host ref and supports cleanup', async () => {
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

  test('imports a branch bundle even when the bundle does not advertise HEAD', async () => {
    const { repoRoot, cleanup } = mkRepo();
    try {
      writeAndCommit(repoRoot, 'a.txt', 'one\n', 'init');
      writeAndCommit(repoRoot, 'a.txt', 'two\n', 'update');
      const head = runOrThrow('git', ['rev-parse', 'HEAD'], repoRoot).trim();
      const bundlePath = path.join(repoRoot, 'branch.bundle');
      runOrThrow('git', ['bundle', 'create', bundlePath, 'main'], repoRoot);

      const advertisedRefs = runOrThrow('git', ['bundle', 'list-heads', bundlePath], repoRoot);
      expect(advertisedRefs).toContain('refs/heads/main');
      expect(advertisedRefs).not.toContain(' HEAD');

      const refName = 'refs/drone/imports/test/import-branch';
      const importedSha = await importBundleHeadToHostRef({ repoRoot, bundlePath, refName });
      expect(importedSha).toBe(head);
      const refSha = runOrThrow('git', ['rev-parse', refName], repoRoot).trim();
      expect(refSha).toBe(head);
    } finally {
      cleanup();
    }
  });

  test('host-authored mirror merge leaves a pending merge without drone-authored host history', async () => {
    const { repoRoot, cleanup } = mkRepo();
    try {
      runOrThrow('git', ['config', 'user.name', 'Host User'], repoRoot);
      runOrThrow('git', ['config', 'user.email', 'host@example.com'], repoRoot);
      writeAndCommit(repoRoot, 'base.txt', 'base\n', 'init');
      runOrThrow('git', ['checkout', '-b', 'drone'], repoRoot);
      runOrThrow('git', ['config', 'user.name', 'Drone User'], repoRoot);
      runOrThrow('git', ['config', 'user.email', 'drone@example.com'], repoRoot);
      writeAndCommit(repoRoot, 'feature.txt', 'feature\n', 'drone feature');
      const droneHead = runOrThrow('git', ['rev-parse', 'HEAD'], repoRoot).trim();
      runOrThrow('git', ['checkout', 'main'], repoRoot);
      runOrThrow('git', ['config', 'user.name', 'Host User'], repoRoot);
      runOrThrow('git', ['config', 'user.email', 'host@example.com'], repoRoot);

      const mirrorSha = await createHostAuthoredMirrorCommit({
        repoRoot,
        sourceRef: droneHead,
        parentRef: 'HEAD',
        message: 'mirror drone feature',
      });
      await updateHostRef({ repoRoot, refName: 'refs/drone/mirrors/test/candidate', target: mirrorSha });

      await applyBranchMergeNoCommitToMainWorkingTree({ repoRoot, branch: 'refs/drone/mirrors/test/candidate' });

      const mergeHead = runOrThrow('git', ['rev-parse', 'MERGE_HEAD'], repoRoot).trim();
      expect(mergeHead).toBe(mirrorSha);
      runOrThrow('git', ['commit', '-m', 'apply mirrored drone feature'], repoRoot);

      const parents = runOrThrow('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], repoRoot)
        .trim()
        .split(/\s+/);
      expect(parents).toHaveLength(3);
      const originalDroneAncestor = run('git', ['merge-base', '--is-ancestor', droneHead, 'HEAD'], repoRoot);
      expect(originalDroneAncestor.code).toBe(1);
      const authorEmails = runOrThrow('git', ['log', '--format=%ae', 'HEAD'], repoRoot)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      expect(authorEmails).not.toContain('drone@example.com');
    } finally {
      cleanup();
    }
  });

  test('host-authored mirror ancestry keeps host edits when later drone work is unrelated', async () => {
    const { repoRoot, cleanup } = mkRepo();
    try {
      runOrThrow('git', ['config', 'user.name', 'Host User'], repoRoot);
      runOrThrow('git', ['config', 'user.email', 'host@example.com'], repoRoot);
      writeAndCommit(repoRoot, 'picker.txt', 'Boxes\nModels\n', 'init');
      const baseSha = runOrThrow('git', ['rev-parse', 'HEAD'], repoRoot).trim();

      runOrThrow('git', ['checkout', '-b', 'drone'], repoRoot);
      runOrThrow('git', ['config', 'user.name', 'Drone User'], repoRoot);
      runOrThrow('git', ['config', 'user.email', 'drone@example.com'], repoRoot);
      writeAndCommit(repoRoot, 'feature.txt', 'first drone feature\n', 'drone feature');
      const firstDroneHead = runOrThrow('git', ['rev-parse', 'HEAD'], repoRoot).trim();
      runOrThrow('git', ['checkout', 'main'], repoRoot);
      runOrThrow('git', ['config', 'user.name', 'Host User'], repoRoot);
      runOrThrow('git', ['config', 'user.email', 'host@example.com'], repoRoot);

      const firstMirrorSha = await createHostAuthoredMirrorCommit({
        repoRoot,
        sourceRef: firstDroneHead,
        parentRef: baseSha,
        message: 'mirror first drone feature',
      });
      await updateHostRef({ repoRoot, refName: 'refs/drone/mirrors/test/applied', target: firstMirrorSha });
      await applyBranchMergeNoCommitToMainWorkingTree({ repoRoot, branch: 'refs/drone/mirrors/test/applied' });
      fs.writeFileSync(path.join(repoRoot, 'picker.txt'), 'Plus\nAdd Models\n', 'utf8');
      runOrThrow('git', ['add', 'picker.txt'], repoRoot);
      runOrThrow('git', ['commit', '-m', 'apply first drone feature with host UI edit'], repoRoot);

      runOrThrow('git', ['checkout', 'drone'], repoRoot);
      writeAndCommit(repoRoot, 'unrelated.txt', 'later drone work\n', 'later unrelated drone work');
      const secondDroneHead = runOrThrow('git', ['rev-parse', 'HEAD'], repoRoot).trim();
      runOrThrow('git', ['checkout', 'main'], repoRoot);

      const secondMirrorSha = await createHostAuthoredMirrorCommit({
        repoRoot,
        sourceRef: secondDroneHead,
        parentRef: firstMirrorSha,
        message: 'mirror later drone work',
      });
      await updateHostRef({ repoRoot, refName: 'refs/drone/mirrors/test/candidate', target: secondMirrorSha });
      await applyBranchMergeNoCommitToMainWorkingTree({ repoRoot, branch: 'refs/drone/mirrors/test/candidate' });

      expect(fs.readFileSync(path.join(repoRoot, 'picker.txt'), 'utf8')).toBe('Plus\nAdd Models\n');
      expect(fs.readFileSync(path.join(repoRoot, 'unrelated.txt'), 'utf8')).toBe('later drone work\n');
      runOrThrow('git', ['commit', '-m', 'apply later drone work'], repoRoot);
      const authorEmails = runOrThrow('git', ['log', '--format=%ae', 'HEAD'], repoRoot)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      expect(authorEmails).not.toContain('drone@example.com');
    } finally {
      cleanup();
    }
  });

  test('applyBranchDiffToMainWorkingTree stages imported changes without leaving merge state', async () => {
    const { repoRoot, cleanup } = mkRepo();
    try {
      writeAndCommit(repoRoot, 'base.txt', 'base\n', 'init');
      runOrThrow('git', ['checkout', '-b', 'feature'], repoRoot);
      writeAndCommit(repoRoot, 'feature.txt', 'feature\n', 'feature work');
      runOrThrow('git', ['checkout', 'main'], repoRoot);

      await applyBranchDiffToMainWorkingTree({ repoRoot, branch: 'feature' });

      const status = runOrThrow('git', ['status', '--porcelain'], repoRoot);
      expect(status.trim().length).toBeGreaterThan(0);
      const mergeHead = run('git', ['rev-parse', '--verify', 'MERGE_HEAD'], repoRoot);
      expect(mergeHead.code).not.toBe(0);

      runOrThrow('git', ['commit', '-m', 'apply imported changes'], repoRoot);
      const parents = runOrThrow('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], repoRoot)
        .trim()
        .split(/\s+/);
      expect(parents).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  test('applyBranchDiffToMainWorkingTree reports conflict files without leaving merge state', async () => {
    const { repoRoot, cleanup } = mkRepo();
    try {
      writeAndCommit(repoRoot, 'conflict.txt', 'same\n', 'init');
      runOrThrow('git', ['checkout', '-b', 'feature'], repoRoot);
      writeAndCommit(repoRoot, 'conflict.txt', 'feature\n', 'feature change');
      runOrThrow('git', ['checkout', 'main'], repoRoot);
      writeAndCommit(repoRoot, 'conflict.txt', 'main\n', 'main change');

      let err: unknown = null;
      try {
        await applyBranchDiffToMainWorkingTree({ repoRoot, branch: 'feature' });
      } catch (e) {
        err = e;
      }

      expect(err).toBeInstanceOf(RepoPatchApplyError);
      const patchErr = err as RepoPatchApplyError;
      expect(patchErr.kind).toBe('patch_apply_conflict');
      expect(patchErr.patchName).toBe('feature');
      expect(patchErr.conflictFiles).toContain('conflict.txt');
      expect(patchErr.appliedToHost).toBe(false);

      const status = runOrThrow('git', ['status', '--porcelain'], repoRoot);
      expect(status.trim()).toBe('');
      const mergeHead = run('git', ['rev-parse', '--verify', 'MERGE_HEAD'], repoRoot);
      expect(mergeHead.code).not.toBe(0);
    } finally {
      cleanup();
    }
  });

  test('applyBranchDiffToMainWorkingTree can project text conflicts onto host when requested', async () => {
    const { repoRoot, cleanup } = mkRepo();
    try {
      writeAndCommit(repoRoot, 'conflict.txt', 'same\n', 'init');
      runOrThrow('git', ['checkout', '-b', 'feature'], repoRoot);
      writeAndCommit(repoRoot, 'conflict.txt', 'feature\n', 'feature change');
      runOrThrow('git', ['checkout', 'main'], repoRoot);
      writeAndCommit(repoRoot, 'conflict.txt', 'main\n', 'main change');

      let err: unknown = null;
      try {
        await applyBranchDiffToMainWorkingTree({ repoRoot, branch: 'feature', applyConflictsToHost: true });
      } catch (e) {
        err = e;
      }

      expect(err).toBeInstanceOf(RepoPatchApplyError);
      const patchErr = err as RepoPatchApplyError;
      expect(patchErr.kind).toBe('patch_apply_conflict');
      expect(patchErr.appliedToHost).toBe(true);
      expect(patchErr.conflictFiles).toContain('conflict.txt');

      const unmerged = runOrThrow('git', ['diff', '--name-only', '--diff-filter=U'], repoRoot)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      expect(unmerged).toContain('conflict.txt');
      const mergeHead = run('git', ['rev-parse', '--verify', 'MERGE_HEAD'], repoRoot);
      expect(mergeHead.code).not.toBe(0);
    } finally {
      cleanup();
    }
  });

  test('applyBranchDiffToMainWorkingTree preserves modify/delete conflicts for host apply', async () => {
    const { repoRoot, cleanup } = mkRepo();
    try {
      writeAndCommit(repoRoot, 'apps/web/src/components/storyboards/StoryboardPreparingState.tsx', 'one\n', 'init');
      runOrThrow('git', ['checkout', '-b', 'feature'], repoRoot);
      writeAndCommit(repoRoot, 'apps/web/src/components/storyboards/StoryboardPreparingState.tsx', 'two\n', 'feature change');
      runOrThrow('git', ['checkout', 'main'], repoRoot);
      runOrThrow('git', ['rm', 'apps/web/src/components/storyboards/StoryboardPreparingState.tsx'], repoRoot);
      runOrThrow('git', ['commit', '-m', 'remove file on main'], repoRoot);

      let err: unknown = null;
      try {
        await applyBranchDiffToMainWorkingTree({ repoRoot, branch: 'feature', applyConflictsToHost: true });
      } catch (e) {
        err = e;
      }

      expect(err).toBeInstanceOf(RepoPatchApplyError);
      const patchErr = err as RepoPatchApplyError;
      expect(patchErr.kind).toBe('patch_apply_conflict');
      expect(patchErr.appliedToHost).toBe(true);
      expect(patchErr.conflictFiles).toContain('apps/web/src/components/storyboards/StoryboardPreparingState.tsx');

      const status = runOrThrow('git', ['status', '--porcelain'], repoRoot);
      expect(status).toContain('DU apps/web/src/components/storyboards/StoryboardPreparingState.tsx');
      const mergeHead = run('git', ['rev-parse', '--verify', 'MERGE_HEAD'], repoRoot);
      expect(mergeHead.code).not.toBe(0);

      fs.mkdirSync(path.join(repoRoot, 'apps/web/src/components/storyboards'), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, 'apps/web/src/components/storyboards/StoryboardPreparingState.tsx'), 'resolved\n', 'utf8');
      runOrThrow('git', ['add', 'apps/web/src/components/storyboards/StoryboardPreparingState.tsx'], repoRoot);
      runOrThrow('git', ['commit', '-m', 'resolve imported change'], repoRoot);
      const parents = runOrThrow('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], repoRoot)
        .trim()
        .split(/\s+/);
      expect(parents).toHaveLength(2);
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

  test('gitRepoChangesSummary uses git-compatible worktree hashing for review tokens', async () => {
    const { repoRoot, cleanup } = mkRepo();
    try {
      writeAndCommit(repoRoot, 'a.txt', 'one\n', 'init');
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'one\ntwo\n', 'utf8');

      const summary = await gitRepoChangesSummary(repoRoot);
      const entry = summary.entries.find((item) => item.path === 'a.txt');
      expect(entry).toBeTruthy();
      const gitBlobHash = runOrThrow('git', ['hash-object', '--no-filters', '--', 'a.txt'], repoRoot).trim().toLowerCase();
      expect(entry?.reviewToken).toBe(buildWorkingTreeRepoChangeReviewToken(entry!, gitBlobHash));
    } finally {
      cleanup();
    }
  });
});
