import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ChangeRequestCheckoutApplier } from '../src/hub/change-requests/change-request-checkout-applier';
import type {
  ChangeRequestRecord,
  ChangeRequestRevisionRecord,
} from '../src/hub/change-requests/change-request-types';
import { git, runCommand as run } from './helpers/change-request-test-support';

describe('ChangeRequestCheckoutApplier', () => {
  test('stages the exact squash candidate without committing or pushing', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-cr-apply-test-'));
    const origin = path.join(tempRoot, 'origin.git');
    const checkoutRoot = path.join(tempRoot, 'host');
    const storageRoot = path.join(tempRoot, 'storage');
    try {
      await run('git', ['init', '--bare', origin]);
      await run('git', ['init', '-b', 'main', checkoutRoot]);
      await git(checkoutRoot, ['config', 'user.name', 'Test User']);
      await git(checkoutRoot, ['config', 'user.email', 'test@example.test']);
      await git(checkoutRoot, ['remote', 'add', 'origin', origin]);
      await fs.writeFile(path.join(checkoutRoot, 'README.md'), 'base\n');
      await git(checkoutRoot, ['add', 'README.md']);
      await git(checkoutRoot, ['commit', '-m', 'base']);
      await git(checkoutRoot, ['push', '-u', 'origin', 'main']);
      const baseSha = await git(checkoutRoot, ['rev-parse', 'HEAD']);

      await git(checkoutRoot, ['checkout', '-b', 'source']);
      await fs.writeFile(path.join(checkoutRoot, 'README.md'), 'base\nreviewed\n');
      await fs.writeFile(path.join(checkoutRoot, 'feature.bin'), Buffer.from([0, 1, 2, 255]));
      await git(checkoutRoot, ['add', 'README.md', 'feature.bin']);
      await git(checkoutRoot, ['commit', '-m', 'source change']);
      const snapshotSha = await git(checkoutRoot, ['rev-parse', 'HEAD']);
      const snapshotRef = 'refs/drone/change-requests/apply-test/snapshots/1';
      await git(checkoutRoot, ['update-ref', snapshotRef, snapshotSha]);
      await git(checkoutRoot, ['checkout', 'main']);

      const record = changeRequestRecord({
        repoRoot: checkoutRoot,
        baseSha,
        snapshotRef,
        snapshotSha,
        sourceHeadSha: snapshotSha,
      });
      const revision = changeRequestRevision({
        baseSha,
        snapshotRef,
        snapshotSha,
        sourceHeadSha: snapshotSha,
      });
      const applier = new ChangeRequestCheckoutApplier({
        runHostCommand: run,
        storagePath: (...segments) => path.join(storageRoot, ...segments),
      });

      const receipt = await applier.apply(record, revision, checkoutRoot);

      expect(receipt).toMatchObject({
        revision: 1,
        checkoutRoot,
        destinationBranch: 'main',
        checkoutHeadSha: baseSha,
        applied: true,
        stagedFiles: ['README.md', 'feature.bin'],
      });
      expect(receipt.candidateTreeSha).toMatch(/^[0-9a-f]{40}$/);
      expect(await git(checkoutRoot, ['rev-parse', 'HEAD'])).toBe(baseSha);
      expect(await git(checkoutRoot, ['branch', '--show-current'])).toBe('main');
      expect(await git(checkoutRoot, ['diff', '--cached', '--name-only'])).toBe(
        'README.md\nfeature.bin',
      );
      expect(await fs.readFile(path.join(checkoutRoot, 'README.md'), 'utf8')).toBe(
        'base\nreviewed\n',
      );
      expect(await fs.readFile(path.join(checkoutRoot, 'feature.bin'))).toEqual(
        Buffer.from([0, 1, 2, 255]),
      );
      expect(await git(origin, ['rev-parse', 'refs/heads/main'])).toBe(baseSha);
      expect(
        (await run('git', ['-C', origin, 'cat-file', '-e', 'refs/heads/main:feature.bin'])).code,
      ).not.toBe(0);
      expect(await fs.readdir(path.join(storageRoot, 'change-request-apply-patches'))).toEqual([]);

      await git(checkoutRoot, ['reset', '--hard', 'HEAD']);
      await git(checkoutRoot, ['checkout', 'source']);
      await expect(applier.apply(record, revision, checkoutRoot)).rejects.toMatchObject({
        code: 'checkout_branch_mismatch',
      });
      await git(checkoutRoot, ['checkout', 'main']);
      await fs.writeFile(path.join(checkoutRoot, 'local.txt'), 'keep me\n');
      await expect(applier.apply(record, revision, checkoutRoot)).rejects.toMatchObject({
        code: 'checkout_dirty',
      });
      expect(await fs.readFile(path.join(checkoutRoot, 'local.txt'), 'utf8')).toBe('keep me\n');
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

function changeRequestRecord(overrides: Partial<ChangeRequestRecord>): ChangeRequestRecord {
  return {
    id: 'apply-test',
    number: 1,
    stateVersion: 1,
    status: 'open',
    droneId: 'source-drone',
    droneName: 'Source drone',
    chatId: null,
    chatName: 'default',
    repoRoot: '',
    baseBranch: 'main',
    baseSha: '',
    destinationBranch: 'main',
    snapshotRef: null,
    snapshotSha: null,
    sourceHeadSha: '',
    revision: 1,
    title: 'Apply this request',
    description: '',
    createdBy: { kind: 'chat', id: null, label: 'Source chat' },
    mergedBy: null,
    mergeCommitSha: null,
    lastError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    mergedAt: null,
    closedAt: null,
    githubMirror: null,
    ...overrides,
  };
}

function changeRequestRevision(
  overrides: Partial<ChangeRequestRevisionRecord>,
): ChangeRequestRevisionRecord {
  return {
    requestId: 'apply-test',
    number: 1,
    baseBranch: 'main',
    baseSha: '',
    snapshotRef: '',
    snapshotSha: '',
    sourceRef: '',
    sourceHeadSha: '',
    objectStorePath: null,
    createdBy: { kind: 'chat', id: null, label: 'Source chat' },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
