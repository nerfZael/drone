import { describe, expect, test } from 'bun:test';
import { sameDroneFsListPayload } from '../src/droneHub/app/use-files-and-ports-pane-state';
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
  test('recognizes unchanged directory payloads and entry metadata changes', () => {
    const current = payload([entry()]);

    expect(sameDroneFsListPayload(current, payload([entry()]))).toBe(true);
    expect(sameDroneFsListPayload(current, payload([entry({ mtimeMs: 101 })]))).toBe(false);
    expect(sameDroneFsListPayload(current, payload([entry({ isGitIgnored: true })]))).toBe(false);
  });
});
