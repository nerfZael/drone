import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  browserCacheControlForFileRevision,
  buildContainerFsListScript,
  FS_GIT_IGNORED_PATHS_MARKER,
  parseContainerFsListOutput,
} from '../src/hub/filesystem-media';

describe('filesystem media caching', () => {
  test('caches only URLs whose revision matches the served bytes', () => {
    expect(browserCacheControlForFileRevision('sha256:abc123', 'sha256:abc123')).toBe(
      'private, max-age=31536000, immutable',
    );
    expect(browserCacheControlForFileRevision('sha256:stale', 'sha256:current')).toBe('no-store');
    expect(browserCacheControlForFileRevision('', 'sha256:current')).toBe('no-store');
    expect(browserCacheControlForFileRevision(null, 'sha256:current')).toBe('no-store');
  });
});

describe('filesystem list metadata', () => {
  test('uses one batched stat command for container entries', () => {
    const script = buildContainerFsListScript('/work/repo', '/dvm-data/home');

    expect(script.match(/\bstat\b/g)).toHaveLength(1);
    expect(script).not.toContain('basename --');
    expect(script).toContain("stat --printf='%n\\0%s\\0%Y\\0'");
  });

  test('the batched container listing retains hidden files, kinds, sizes, and timestamps', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'drone-fs-list-'));
    try {
      writeFileSync(path.join(root, '.hidden file'), 'abc');
      mkdirSync(path.join(root, 'folder'));
      const output = execFileSync(
        'bash',
        ['-lc', buildContainerFsListScript(root, '/dvm-data/home')],
        { encoding: 'utf8' },
      );
      const parsed = parseContainerFsListOutput(output);

      expect(parsed.resolvedPath).toBe(root);
      expect(parsed.entries.find((entry) => entry.name === '.hidden file')).toMatchObject({
        kind: 'file',
        size: 3,
      });
      expect(parsed.entries.find((entry) => entry.name === 'folder')?.kind).toBe('directory');
      expect(parsed.entries.every((entry) => Number.isFinite(entry.mtimeMs))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('applies null-delimited Git ignore metadata to container entries', () => {
    const ignoredPath = '/work/repo/generated_output.log';
    const output = `${[
      '__PATH__\t/work/repo',
      'src\td\t0\t100',
      'generated_output.log\tf\t12\t101',
      FS_GIT_IGNORED_PATHS_MARKER,
    ].join('\n')}\n${ignoredPath}\0`;

    const parsed = parseContainerFsListOutput(output);

    expect(parsed.entries.find((entry) => entry.name === 'src')?.isGitIgnored).toBe(false);
    expect(
      parsed.entries.find((entry) => entry.name === 'generated_output.log')?.isGitIgnored,
    ).toBe(true);
  });

  test('ignores malformed Git decoration paths', () => {
    const parsed = parseContainerFsListOutput(
      [
        '__PATH__\t/work/repo',
        'README.md\tf\t12\t101',
        FS_GIT_IGNORED_PATHS_MARKER,
        'relative-path\0',
      ].join('\n'),
    );

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.isGitIgnored).toBe(false);
  });
});
