import { describe, expect, test } from 'bun:test';
import type { DroneFsEntry } from '../src/droneHub/types';
import {
  allVisibleSelected,
  isPathInsideOrEqual,
  movedPathForEntry,
  pruneSelectedPaths,
  renamedPathForEntry,
  selectedEntriesFromPaths,
  setAllVisibleSelected,
  topLevelSelectedEntries,
  toggleSelectedPath,
} from '../src/droneHub/files/explorer-state';

function entry(seed: Partial<DroneFsEntry> & Pick<DroneFsEntry, 'name' | 'path' | 'kind'>): DroneFsEntry {
  return {
    name: seed.name,
    path: seed.path,
    kind: seed.kind,
    size: seed.size ?? null,
    mtimeMs: seed.mtimeMs ?? null,
    ext: seed.ext ?? null,
    isImage: seed.isImage ?? false,
    isVideo: seed.isVideo ?? false,
  };
}

describe('file explorer state helpers', () => {
  test('toggles, selects, and prunes visible selections', () => {
    const entries = [
      entry({ name: 'src', path: '/work/repo/src', kind: 'directory' }),
      entry({ name: 'README.md', path: '/work/repo/README.md', kind: 'file' }),
    ];

    let selected = toggleSelectedPath(new Set<string>(), '/work/repo/src');
    expect([...selected]).toEqual(['/work/repo/src']);
    selected = setAllVisibleSelected(entries, selected, true);
    expect(allVisibleSelected(entries, selected)).toBe(true);
    expect(selectedEntriesFromPaths(entries, selected).map((item) => item.path)).toEqual([
      '/work/repo/src',
      '/work/repo/README.md',
    ]);
    selected = pruneSelectedPaths(selected, [entries[1]]);
    expect([...selected]).toEqual(['/work/repo/README.md']);
  });

  test('maps active editor path through rename and move operations', () => {
    const dir = entry({ name: 'src', path: '/work/repo/src', kind: 'directory' });
    const file = entry({ name: 'main.ts', path: '/work/repo/src/main.ts', kind: 'file' });

    expect(isPathInsideOrEqual('/work/repo/src', '/work/repo/src/main.ts')).toBe(true);
    expect(renamedPathForEntry(dir, 'lib', '/work/repo/src/main.ts')).toBe('/work/repo/lib/main.ts');
    expect(movedPathForEntry(file, '/work/repo/tests', '/work/repo/src/main.ts')).toBe('/work/repo/tests/main.ts');
  });

  test('collapses nested selections before filesystem actions', () => {
    const selected = [
      entry({ name: 'src', path: '/work/repo/src', kind: 'directory' }),
      entry({ name: 'main.ts', path: '/work/repo/src/main.ts', kind: 'file' }),
      entry({ name: 'README.md', path: '/work/repo/README.md', kind: 'file' }),
    ];

    expect(topLevelSelectedEntries(selected).map((item) => item.path)).toEqual([
      '/work/repo/src',
      '/work/repo/README.md',
    ]);
  });
});
