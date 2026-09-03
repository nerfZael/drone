import { describe, expect, test } from 'bun:test';
import { sameDroneFsListPayload } from '../src/droneHub/app/use-files-and-ports-pane-state';
import { sameDroneFsEntries } from '../src/droneHub/files/same-drone-fs-entries';
import type { DroneFsEntry, DroneFsListPayload } from '../src/droneHub/types';

function entry(overrides: Partial<DroneFsEntry> = {}): DroneFsEntry {
  return {
    name: 'README.md',
    path: '/work/repo/README.md',
    kind: 'file',
    size: 42,
    mtimeMs: 100,
    ext: 'md',
    isImage: false,
    isVideo: false,
    ...overrides,
  };
}

function payload(entries: DroneFsEntry[]): Extract<DroneFsListPayload, { ok: true }> {
  return { ok: true, id: 'drone-1', name: 'Drone 1', path: '/work/repo', entries };
}

describe('desktop files pane state', () => {
  test('shares ordered entry equality across every current metadata field', () => {
    const current = [entry()];
    expect(sameDroneFsEntries(current, [entry()])).toBe(true);
    for (const changed of [
      entry({ name: 'CHANGELOG.md' }),
      entry({ path: '/work/repo/CHANGELOG.md' }),
      entry({ kind: 'directory' }),
      entry({ size: 43 }),
      entry({ mtimeMs: 101 }),
      entry({ ext: 'txt' }),
      entry({ isGitIgnored: true }),
      entry({ isImage: true }),
      entry({ isVideo: true }),
    ]) {
      expect(sameDroneFsEntries(current, [changed])).toBe(false);
    }
    expect(sameDroneFsEntries(current, [entry(), entry({ name: 'second' })])).toBe(false);
  });

  test('composes list identity with the shared entry comparison', () => {
    const current = payload([entry()]);
    expect(sameDroneFsListPayload(current, payload([entry()]))).toBe(true);
    expect(sameDroneFsListPayload(current, payload([entry({ mtimeMs: 101 })]))).toBe(false);
    expect(sameDroneFsListPayload(current, { ...payload([entry()]), path: '/work/other' })).toBe(false);
  });
});
