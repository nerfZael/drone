import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { run } from '../src/host/dvm';
import { listGitIgnoredPaths } from '../src/hub/listGitIgnoredPaths';

describe('filesystem Git ignore metadata', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-git-ignore-'));

  beforeAll(async () => {
    fs.mkdirSync(path.join(repoRoot, 'ignored-build'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.gitignore'), '*.tmp\n/ignored-build/\n', 'utf8');
    fs.writeFileSync(path.join(repoRoot, 'ignored.tmp'), 'ignored\n', 'utf8');
    fs.writeFileSync(path.join(repoRoot, 'tracked.tmp'), 'tracked\n', 'utf8');
    fs.writeFileSync(path.join(repoRoot, 'visible.txt'), 'visible\n', 'utf8');
    await run('git', ['-C', repoRoot, 'init']);
    await run('git', ['-C', repoRoot, 'add', '.gitignore']);
    await run('git', ['-C', repoRoot, 'add', '-f', 'tracked.tmp']);
  });

  afterAll(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  test('batches paths through Git and excludes tracked matches', async () => {
    const entryPaths = ['ignored.tmp', 'ignored-build', 'tracked.tmp', 'visible.txt'].map((name) =>
      path.join(repoRoot, name),
    );

    const ignoredPaths = await listGitIgnoredPaths({
      directoryPath: repoRoot,
      entryPaths,
      runCommand: run,
      timeoutMs: 2_000,
    });

    expect(ignoredPaths.has(path.join(repoRoot, 'ignored.tmp'))).toBe(true);
    expect(ignoredPaths.has(path.join(repoRoot, 'ignored-build'))).toBe(true);
    expect(ignoredPaths.has(path.join(repoRoot, 'tracked.tmp'))).toBe(false);
    expect(ignoredPaths.has(path.join(repoRoot, 'visible.txt'))).toBe(false);
  });

  test('returns no ignored paths outside a Git repository', async () => {
    const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-not-git-ignore-'));
    const entryPath = path.join(directoryPath, 'visible.txt');
    fs.writeFileSync(entryPath, 'visible\n', 'utf8');

    try {
      const ignoredPaths = await listGitIgnoredPaths({
        directoryPath,
        entryPaths: [entryPath],
        runCommand: run,
        timeoutMs: 2_000,
      });
      expect(ignoredPaths.size).toBe(0);
    } finally {
      fs.rmSync(directoryPath, { recursive: true, force: true });
    }
  });
});
