import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  browserCacheControlForFileRevision,
  buildContainerFsListScript,
  FS_GIT_IGNORED_PATHS_MARKER,
  parseContainerFsListOutput,
} from '../src/hub/filesystem-media';
import {
  buildContainerMediaRangeScript,
  parseRequestedByteRange,
  readHostMediaRange,
  resolveByteRange,
} from '../src/hub/filesystem-media-range';

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

describe('filesystem media ranges', () => {
  test('resolves closed, open, suffix, and invalid byte ranges', () => {
    expect(resolveByteRange(parseRequestedByteRange('bytes=2-5'), 10)).toEqual({
      kind: 'range',
      start: 2,
      end: 5,
      length: 4,
    });
    expect(resolveByteRange(parseRequestedByteRange('bytes=7-'), 10)).toEqual({
      kind: 'range',
      start: 7,
      end: 9,
      length: 3,
    });
    expect(resolveByteRange(parseRequestedByteRange('bytes=-20'), 10)).toEqual({
      kind: 'range',
      start: 0,
      end: 9,
      length: 10,
    });
    expect(resolveByteRange(parseRequestedByteRange('bytes=10-11'), 10)).toBeNull();
    expect(resolveByteRange(parseRequestedByteRange('bytes=9-'), 10)).toMatchObject({
      start: 9,
      end: 9,
      length: 1,
    });
    expect(resolveByteRange(parseRequestedByteRange('bytes=-20'), 10)).toMatchObject({
      start: 0,
      end: 9,
      length: 10,
    });
    expect(resolveByteRange(parseRequestedByteRange('bytes=-0'), 10)).toBeNull();
    expect(resolveByteRange(parseRequestedByteRange('bytes=unsafe'), 10)).toBeNull();
    expect(resolveByteRange(parseRequestedByteRange('bytes=0-1,4-5'), 10)).toBeNull();
    expect(resolveByteRange(parseRequestedByteRange('bytes=0-'), 0)).toBeNull();
  });

  test('reads only an unversioned host range and hashes the exact revisioned stream', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'drone-media-range-'));
    const filePath = path.join(root, 'video.mp4');
    const bytes = Buffer.alloc(300_000);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    writeFileSync(filePath, bytes);
    try {
      const unversioned = await readHostMediaRange({
        targetPath: filePath,
        maxBytes: 400_000,
        requestedRange: parseRequestedByteRange('bytes=100000-100127'),
        includeRevision: false,
      });
      expect(unversioned.bytes).toEqual(bytes.subarray(100_000, 100_128));
      expect(unversioned.servedRevision).toBeNull();

      const revisioned = await readHostMediaRange({
        targetPath: filePath,
        maxBytes: 400_000,
        requestedRange: parseRequestedByteRange('bytes=-257'),
        includeRevision: true,
      });
      expect(revisioned.bytes).toEqual(bytes.subarray(bytes.length - 257));
      expect(revisioned.servedRevision).toBe(
        `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
      );

      const allocations: number[] = [];
      const openEnded = await readHostMediaRange({
        targetPath: filePath,
        maxBytes: 400_000,
        requestedRange: parseRequestedByteRange('bytes=1-'),
        includeRevision: true,
        allocateBytes: (length) => {
          allocations.push(length);
          return Buffer.alloc(length);
        },
      });
      expect(openEnded.bytes).toEqual(bytes.subarray(1));
      expect(allocations).toEqual([bytes.length - 1]);

      const head = await readHostMediaRange({
        targetPath: filePath,
        maxBytes: 400_000,
        requestedRange: parseRequestedByteRange('bytes=5-9'),
        includeRevision: true,
        retainBytes: false,
      });
      expect(head.bytes.length).toBe(0);
      expect(head.range).toMatchObject({ kind: 'range', start: 5, end: 9, length: 5 });
      expect(head.servedRevision).toBe(
        `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
      );
      await expect(
        readHostMediaRange({
          targetPath: filePath,
          maxBytes: 400_000,
          requestedRange: parseRequestedByteRange('bytes=400000-'),
          includeRevision: false,
        }),
      ).rejects.toMatchObject({ statusCode: 416, size: bytes.length });
      await expect(
        readHostMediaRange({
          targetPath: filePath,
          maxBytes: 100,
          requestedRange: parseRequestedByteRange(''),
          includeRevision: false,
        }),
      ).rejects.toMatchObject({ statusCode: 413, size: bytes.length });

      const controller = new AbortController();
      controller.abort();
      await expect(
        readHostMediaRange({
          targetPath: filePath,
          maxBytes: 400_000,
          requestedRange: parseRequestedByteRange('bytes=1-2'),
          includeRevision: true,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('container range script transfers the requested bytes and hashes one immutable stream', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'drone-container-media-range-'));
    const filePath = path.join(root, 'video.mp4');
    const bytes = Buffer.alloc(400_000);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 239;
    writeFileSync(filePath, bytes);
    try {
      const output = execFileSync(
        'bash',
        [
          '-lc',
          buildContainerMediaRangeScript({
            targetPath: filePath,
            maxBytes: 500_000,
            requestedRange: parseRequestedByteRange('bytes=130000-131000'),
            includeRevision: true,
          }),
        ],
        { encoding: 'utf8' },
      );
      const firstNewline = output.indexOf('\n');
      const metadata = output.slice(0, firstNewline).split('\t');
      const transferred = Buffer.from(output.slice(firstNewline + 1), 'base64');
      expect(metadata.slice(2, 6)).toEqual(['400000', '130000', '1001', '1']);
      expect(metadata[6]).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
      expect(metadata[7]).toBe(String(bytes.length));
      expect(transferred).toEqual(bytes.subarray(130_000, 131_001));

      const headOutput = execFileSync(
        'bash',
        [
          '-lc',
          buildContainerMediaRangeScript({
            targetPath: filePath,
            maxBytes: 500_000,
            requestedRange: parseRequestedByteRange('bytes=-20'),
            includeRevision: true,
            includeBody: false,
          }),
        ],
        { encoding: 'utf8' },
      );
      const headParts = headOutput.trimEnd().split('\n');
      expect(headParts).toHaveLength(1);
      const headMetadata = headParts[0].split('\t');
      expect(headMetadata.slice(2, 6)).toEqual(['400000', '399980', '20', '1']);
      expect(headMetadata[6]).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));

      try {
        execFileSync(
          'bash',
          [
            '-lc',
            buildContainerMediaRangeScript({
              targetPath: filePath,
              maxBytes: 500_000,
              requestedRange: parseRequestedByteRange('bytes=500000-'),
              includeRevision: false,
            }),
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
        throw new Error('expected the invalid range command to fail');
      } catch (error: any) {
        expect(String(error?.stdout ?? '')).toMatch(/__ERR__\s+range\s+400000/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('container range failures clean bounded snapshot files', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'drone-container-media-failure-'));
    const bin = path.join(root, 'bin');
    const tmp = path.join(root, 'tmp');
    const filePath = path.join(root, 'video.mp4');
    mkdirSync(bin);
    mkdirSync(tmp);
    writeFileSync(filePath, Buffer.alloc(200_000, 4));
    const sha = path.join(bin, 'sha256sum');
    writeFileSync(sha, '#!/bin/sh\nexit 7\n');
    chmodSync(sha, 0o755);
    try {
      expect(() =>
        execFileSync(
          'bash',
          [
            '-c',
            buildContainerMediaRangeScript({
              targetPath: filePath,
              maxBytes: 300_000,
              requestedRange: parseRequestedByteRange('bytes=10-20'),
              includeRevision: true,
            }),
          ],
          {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      ).toThrow();
      expect(readdirSync(tmp)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
      const names = Array.from(
        { length: 900 },
        (_, index) => `${String(index).padStart(4, '0')}-${'x'.repeat(170)}.txt`,
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
