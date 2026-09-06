import { expect, test } from 'bun:test';
import { normalizeMobileExplorerFolderIcons } from '../src/mobile-explorer-folder-icons';

test('folder icons default on and only an explicit off disables them', () => {
  expect(normalizeMobileExplorerFolderIcons(null)).toBe(true);
  expect(normalizeMobileExplorerFolderIcons('on')).toBe(true);
  expect(normalizeMobileExplorerFolderIcons('garbage')).toBe(true);
  expect(normalizeMobileExplorerFolderIcons('off')).toBe(false);
});
