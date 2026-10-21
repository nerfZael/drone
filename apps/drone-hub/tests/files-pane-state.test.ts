import { describe, expect, test } from 'bun:test';
import { rewrittenPreviewOverride, sameDroneFsListPayload } from '../src/droneHub/app/use-files-and-ports-pane-state';
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

  test('leaves a saved preview URL alone once it points at the host port', () => {
    const ports = [{ containerPort: 3000, hostPort: 45123 }];
    // Already at its host address: no update, so the effect that stores it does not run again forever.
    expect(rewrittenPreviewOverride('http://localhost:45123/app', ports, null)).toBeUndefined();
    expect(rewrittenPreviewOverride('http://localhost:45999/', ports, null)).toBeUndefined();
    // Container ports and Hub preview routes move to the host port once.
    expect(rewrittenPreviewOverride('http://localhost:3000/app', ports, null)).toBe('http://localhost:45123/app');
    expect(rewrittenPreviewOverride('/api/drones/d1/preview/3000/app', ports, null)).toBe('http://localhost:45123/app');
    // The port's own default URL needs no override.
    expect(rewrittenPreviewOverride('http://localhost:3000/', ports, 'http://localhost:45123/')).toBeNull();
    expect(rewrittenPreviewOverride('https://example.com/', ports, null)).toBeUndefined();
  });
});
