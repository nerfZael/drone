import { describe, expect, test } from 'bun:test';
import {
  browserCacheControlForFileRevision,
  FS_GIT_IGNORED_PATHS_MARKER,
  parseContainerFsListOutput,
} from '../src/hub/filesystem-media';

describe('filesystem media caching', () => {
  test('caches only URLs tied to a file revision', () => {
    expect(browserCacheControlForFileRevision('sha256:abc123')).toBe(
      'private, max-age=31536000, immutable',
    );
    expect(browserCacheControlForFileRevision('')).toBe('no-store');
    expect(browserCacheControlForFileRevision(null)).toBe('no-store');
  });
});

describe('filesystem list metadata', () => {
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
