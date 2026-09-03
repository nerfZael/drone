import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  test('uses bounded stat batches for container entries', () => {
    const script = buildContainerFsListScript('/work/repo', '/dvm-data/home');

    expect(script.match(/\bstat\b/g)).toHaveLength(1);
    expect(script).not.toContain('basename --');
    expect(script).toContain("stat --printf='__FS_ENTRY_Z__\\0%n\\0%F\\0%s\\0%Y\\0'");
    expect(script).toContain('xargs -0 -r -s 131072 -n 256');
  });

  test('the batched container listing retains hidden files, kinds, sizes, and timestamps', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'drone-fs-list-'));
    try {
      const unusualNames = [
        '.hidden file',
        ' leading.txt',
        'trailing.txt ',
        'tab\tname.txt',
        'line\nname.txt',
        '__FS_ENTRY_Z__',
        '__GIT_IGNORED_PATHS_Z__',
      ];
      for (const name of unusualNames) writeFileSync(path.join(root, name), 'abc');
      mkdirSync(path.join(root, 'folder'));
      symlinkSync('.hidden file', path.join(root, 'file-link'));
      symlinkSync('folder', path.join(root, 'directory-link'));
      symlinkSync('missing', path.join(root, 'dangling-link'));
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
      for (const name of unusualNames) {
        expect(parsed.entries.some((entry) => entry.name === name)).toBe(true);
      }
      expect(parsed.entries.find((entry) => entry.name === 'folder')?.kind).toBe('directory');
      for (const name of ['file-link', 'directory-link', 'dangling-link']) {
        expect(parsed.entries.find((entry) => entry.name === name)?.kind).toBe('other');
      }
      expect(parsed.entries.every((entry) => Number.isFinite(entry.mtimeMs))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('chunks directories whose operands exceed the conservative argv budget', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'drone-fs-list-argv-'));
    try {
      const names = Array.from({ length: 900 }, (_, index) =>
        `${String(index).padStart(4, '0')}-${'x'.repeat(170)}.txt`,
      );
      expect(names.reduce((total, name) => total + name.length + 3, 0)).toBeGreaterThan(128 * 1024);
      for (const name of names) writeFileSync(path.join(root, name), 'x');

      const output = execFileSync(
        'bash',
        ['-lc', buildContainerFsListScript(root, '/dvm-data/home')],
        { encoding: 'utf8' },
      );
      expect(parseContainerFsListOutput(output).entries).toHaveLength(names.length);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('surfaces a partial stat failure instead of returning a partial success', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'drone-fs-list-failure-'));
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(root, 'first.txt'), 'one');
    writeFileSync(path.join(root, 'second.txt'), 'two');
    const fakeStat = path.join(bin, 'stat');
    writeFileSync(
      fakeStat,
      [
        '#!/usr/bin/env bash',
        'format=${1#--printf=}',
        'shift',
        '[ "${1:-}" = "--" ] && shift',
        '[ "$#" -gt 0 ] && /usr/bin/stat --printf="$format" -- "$1"',
        'echo "simulated metadata failure" >&2',
        'exit 7',
      ].join('\n'),
    );
    chmodSync(fakeStat, 0o755);
    try {
      expect(() =>
        execFileSync('bash', ['-lc', buildContainerFsListScript(root, '/dvm-data/home')], {
          encoding: 'utf8',
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      ).toThrow(/metadata-failed|simulated metadata failure/);
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
