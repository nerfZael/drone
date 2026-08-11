import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  ChangeRequestPatch,
  ChangeRequestRepository,
} from '../src/hub/change-requests/change-request-repository';
import { ChangeRequestService } from '../src/hub/change-requests/change-request-service';
import type { ChangeRequestRecord } from '../src/hub/change-requests/change-request-types';
import type { RunResult } from '../src/host/dvm';

class MemoryChangeRequestRepository implements ChangeRequestRepository {
  private sequence = 0;
  private readonly records = new Map<string, ChangeRequestRecord>();

  async insert(input: Omit<ChangeRequestRecord, 'number'>): Promise<ChangeRequestRecord> {
    const record = { ...input, number: ++this.sequence };
    this.records.set(record.id, record);
    return structuredClone(record);
  }

  get(id: string): ChangeRequestRecord | null {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  list(): ChangeRequestRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record));
  }

  async update(id: string, patch: ChangeRequestPatch): Promise<ChangeRequestRecord> {
    const current = this.records.get(id);
    if (!current) throw new Error(`unknown change request: ${id}`);
    const updated = { ...current, ...patch };
    this.records.set(id, updated);
    return structuredClone(updated);
  }
}

async function run(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await run('git', ['-C', cwd, ...args]);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

describe('ChangeRequestService', () => {
  test('captures a durable host snapshot and directly squash-merges a planned branch', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-change-request-test-'));
    const origin = path.join(tempRoot, 'origin.git');
    const repoRoot = path.join(tempRoot, 'repo');
    const upstreamRepo = path.join(tempRoot, 'upstream');
    const storageRoot = path.join(tempRoot, 'storage');
    try {
      await run('git', ['init', '--bare', origin]);
      await run('git', ['init', '-b', 'main', repoRoot]);
      await git(repoRoot, ['config', 'user.name', 'Host User']);
      await git(repoRoot, ['config', 'user.email', 'host@example.test']);
      await git(repoRoot, ['remote', 'add', 'origin', origin]);
      await fs.writeFile(path.join(repoRoot, 'README.md'), 'base\n');
      await git(repoRoot, ['add', 'README.md']);
      await git(repoRoot, ['commit', '-m', 'base']);
      await git(repoRoot, ['push', '-u', 'origin', 'main']);
      await git(repoRoot, ['checkout', '-b', 'feature']);
      await fs.writeFile(path.join(repoRoot, 'feature.txt'), 'captured change\n');
      await git(repoRoot, ['add', 'feature.txt']);
      await git(repoRoot, ['commit', '-m', 'container-authored change']);

      const repository = new MemoryChangeRequestRepository();
      const service = new ChangeRequestService({
        repository,
        resolveDrone: async () => ({
          kind: 'real',
          id: 'drone-1',
          drone: {
            id: 'drone-1',
            name: 'Test drone',
            runtime: 'host',
            repoPath: repoRoot,
            repo: { baseRef: 'main' },
            chats: { default: { id: 'chat-1' } },
          },
        }),
        withLockedDroneContainer: async () => {
          throw new Error('container access was not expected');
        },
        exportFullHeadBundleFromDrone: async () => {
          throw new Error('container export was not expected');
        },
        importBundleHeadToHostRef: async () => {
          throw new Error('bundle import was not expected');
        },
        createHostAuthoredMirrorCommit: async ({ repoRoot, sourceRef, parentRef, message }) => {
          const tree = await git(repoRoot, ['rev-parse', `${sourceRef}^{tree}`]);
          return await git(repoRoot, [
            'commit-tree',
            tree,
            '-p',
            parentRef,
            '-m',
            message ?? 'snapshot',
          ]);
        },
        updateHostRef: async ({ repoRoot, refName, target }) => {
          await git(repoRoot, ['update-ref', refName, target]);
        },
        deleteHostRefBestEffort: async ({ repoRoot, refName }) => {
          await run('git', ['-C', repoRoot, 'update-ref', '-d', refName]);
        },
        gitTopLevel: async (repoPath) => await git(repoPath, ['rev-parse', '--show-toplevel']),
        droneRepoBaseSha: async () => null,
        dvmRepoHeadSha: async () => {
          throw new Error('container HEAD was not expected');
        },
        runGitInDrone: async () => {
          throw new Error('container git was not expected');
        },
        runHostCommand: run,
        storagePath: (...segments) => path.join(storageRoot, ...segments),
        now: () => new Date().toISOString(),
      });

      const created = await service.create({
        droneRef: 'drone-1',
        chatName: 'default',
        title: 'Add the captured feature',
        destinationBranch: 'integration/42',
        actor: { kind: 'user', id: null, label: 'Test user' },
      });

      expect(created.status).toBe('open');
      expect(created.destinationExists).toBe(false);
      expect(created.snapshotSha).toMatch(/^[0-9a-f]{40}$/);
      expect((await service.changes(created.id)).entries.map((entry) => entry.path)).toEqual([
        'feature.txt',
      ]);

      await run('git', ['clone', '-b', 'main', origin, upstreamRepo]);
      await git(upstreamRepo, ['config', 'user.name', 'Upstream User']);
      await git(upstreamRepo, ['config', 'user.email', 'upstream@example.test']);
      await fs.writeFile(path.join(upstreamRepo, 'remote.txt'), 'new destination work\n');
      await git(upstreamRepo, ['add', 'remote.txt']);
      await git(upstreamRepo, ['commit', '-m', 'advance main']);
      await git(upstreamRepo, ['push', 'origin', 'main']);

      const refreshed = await service.refreshAssessment(created.id);
      expect(refreshed.stale).toBe(true);
      expect(refreshed.destinationSha).toBe(await git(upstreamRepo, ['rev-parse', 'HEAD']));

      const sourceBranchBeforeMerge = await git(repoRoot, ['branch', '--show-current']);
      const merged = await service.merge(created.id, {
        actor: { kind: 'user', id: null, label: 'Test user' },
        commitMessage: 'Custom squash message',
      });

      expect(merged.status).toBe('merged');
      expect(merged.snapshotSha).toBe(created.snapshotSha);
      expect(merged.mergeCommitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(await git(repoRoot, ['branch', '--show-current'])).toBe(sourceBranchBeforeMerge);
      expect(await git(repoRoot, ['status', '--porcelain'])).toBe('');
      expect(await git(origin, ['show', 'refs/heads/integration/42:feature.txt'])).toBe(
        'captured change',
      );
      expect(await git(origin, ['show', '-s', '--format=%an', 'refs/heads/integration/42'])).toBe(
        'Host User',
      );
      expect(await git(origin, ['show', '-s', '--format=%s', 'refs/heads/integration/42'])).toBe(
        'Custom squash message',
      );
      const snapshotRef = `refs/drone/change-requests/${created.id}/snapshot`;
      expect(
        (await run('git', ['-C', repoRoot, 'rev-parse', '--verify', snapshotRef])).code,
      ).not.toBe(0);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('imports a container bundle and keeps the snapshot reviewable without the container', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-change-request-container-'));
    const origin = path.join(tempRoot, 'origin.git');
    const repoRoot = path.join(tempRoot, 'host-repo');
    const containerRepo = path.join(tempRoot, 'container-repo');
    const storageRoot = path.join(tempRoot, 'storage');
    try {
      await run('git', ['init', '--bare', origin]);
      await run('git', ['init', '-b', 'main', repoRoot]);
      await git(repoRoot, ['config', 'user.name', 'Host User']);
      await git(repoRoot, ['config', 'user.email', 'host@example.test']);
      await git(repoRoot, ['remote', 'add', 'origin', origin]);
      await fs.writeFile(path.join(repoRoot, 'README.md'), 'base\n');
      await git(repoRoot, ['add', 'README.md']);
      await git(repoRoot, ['commit', '-m', 'base']);
      const baseSha = await git(repoRoot, ['rev-parse', 'HEAD']);
      await git(repoRoot, ['push', '-u', 'origin', 'main']);

      await run('git', ['clone', '-b', 'main', origin, containerRepo]);
      await git(containerRepo, ['config', 'user.name', 'Container User']);
      await git(containerRepo, ['config', 'user.email', 'container@example.test']);
      await git(containerRepo, ['checkout', '-b', 'feature']);
      await fs.writeFile(path.join(containerRepo, 'container.txt'), 'container change\n');
      await git(containerRepo, ['add', 'container.txt']);
      await git(containerRepo, ['commit', '-m', 'container change']);

      const repository = new MemoryChangeRequestRepository();
      const service = new ChangeRequestService({
        repository,
        resolveDrone: async () => ({
          kind: 'real',
          id: 'container-drone',
          drone: {
            id: 'container-drone',
            name: 'Container drone',
            runtime: 'container',
            repoPath: repoRoot,
            repo: { baseRef: 'main', dest: '/work/repo' },
            chats: { default: { id: 'container-chat' } },
          },
        }),
        withLockedDroneContainer: async (_input, operation) =>
          await operation({ containerName: 'fake-container', droneEntry: {} }),
        exportFullHeadBundleFromDrone: async ({ outDir }) => {
          await fs.mkdir(outDir, { recursive: true });
          const exportedPath = path.join(outDir, 'snapshot.bundle');
          await git(containerRepo, ['bundle', 'create', exportedPath, 'HEAD']);
          return { exportedPath };
        },
        importBundleHeadToHostRef: async ({ repoRoot, bundlePath, refName }) => {
          await git(repoRoot, ['fetch', bundlePath, `HEAD:${refName}`]);
          return await git(repoRoot, ['rev-parse', refName]);
        },
        createHostAuthoredMirrorCommit: async ({ repoRoot, sourceRef, parentRef, message }) => {
          const tree = await git(repoRoot, ['rev-parse', `${sourceRef}^{tree}`]);
          return await git(repoRoot, [
            'commit-tree',
            tree,
            '-p',
            parentRef,
            '-m',
            message ?? 'snapshot',
          ]);
        },
        updateHostRef: async ({ repoRoot, refName, target }) => {
          await git(repoRoot, ['update-ref', refName, target]);
        },
        deleteHostRefBestEffort: async ({ repoRoot, refName }) => {
          await run('git', ['-C', repoRoot, 'update-ref', '-d', refName]);
        },
        gitTopLevel: async (repoPath) => await git(repoPath, ['rev-parse', '--show-toplevel']),
        droneRepoBaseSha: async () => baseSha,
        dvmRepoHeadSha: async () => await git(containerRepo, ['rev-parse', 'HEAD']),
        runGitInDrone: async ({ args }) => await run('git', ['-C', containerRepo, ...args]),
        runHostCommand: run,
        storagePath: (...segments) => path.join(storageRoot, ...segments),
        now: () => new Date().toISOString(),
      });

      const created = await service.create({
        droneRef: 'container-drone',
        chatName: 'default',
        title: 'Capture the container change',
        actor: { kind: 'chat', id: 'container-chat', label: 'Container chat' },
      });

      await fs.rm(containerRepo, { recursive: true, force: true });

      expect(created.snapshotSha).toMatch(/^[0-9a-f]{40}$/);
      expect((await service.changes(created.id)).entries.map((entry) => entry.path)).toEqual([
        'container.txt',
      ]);
      expect((await service.diff(created.id, 'container.txt')).diff).toContain('+container change');
      expect(await fs.readdir(path.join(storageRoot, 'change-request-exports'))).toEqual([]);

      const closed = await service.close(created.id);
      expect(closed.status).toBe('closed');
      expect(
        (
          await run('git', [
            '-C',
            repoRoot,
            'rev-parse',
            '--verify',
            `refs/drone/change-requests/${created.id}/snapshot`,
          ])
        ).code,
      ).not.toBe(0);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
