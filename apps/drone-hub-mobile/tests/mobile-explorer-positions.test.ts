import { expect, test } from 'bun:test';
import {
  mobileExplorerDragProgress,
  mobileExplorerSnapPosition,
  mobileExplorerTallHeight,
} from '../src/drones/mobile-explorer-drag';
import { mobileExplorerCreationAction } from '../src/drones/mobile-explorer-creation';

test('three positions preserve the middle stop and require deliberate travel', () => {
  expect(mobileExplorerTallHeight(900)).toBe(600);
  expect(mobileExplorerDragProgress(1, -50, 300, 100)).toBe(1.5);
  expect(mobileExplorerDragProgress(2, 150, 300, 100)).toBeCloseTo(5 / 6);
  expect(mobileExplorerDragProgress(0, -900, 300, 100)).toBe(2);
  expect(mobileExplorerSnapPosition(1.2, -900, 1)).toBe(1);
  expect(mobileExplorerSnapPosition(0.8, 900, 1)).toBe(1);
  expect(mobileExplorerSnapPosition(1.4, 0, 1)).toBe(1);
  expect(mobileExplorerSnapPosition(1.6, 0, 1)).toBe(2);
  expect(mobileExplorerSnapPosition(0.4, 0, 1)).toBe(0);
  expect(mobileExplorerSnapPosition(0.35, -700, 0)).toBe(1);
  expect(mobileExplorerSnapPosition(1.65, 700, 2)).toBe(1);
});

test('creation uses the extension, including hidden and multi-extension names', () => {
  for (const name of ['notes.md', 'archive.tar.gz', '.config.json'])
    expect(mobileExplorerCreationAction(name)).toBe('create-file');
  for (const name of ['notes', '.config', 'folder.'])
    expect(mobileExplorerCreationAction(name)).toBe('create-directory');
});
