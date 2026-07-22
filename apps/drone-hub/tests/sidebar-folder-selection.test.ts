import { describe, expect, test } from 'bun:test';

import { resolveSidebarFolderDroneSelection } from '../src/droneHub/app/sidebar-folder-selection';

describe('sidebar folder drone selection', () => {
  test('plain click clears drone selection without selecting the folder contents', () => {
    expect(
      resolveSidebarFolderDroneSelection({
        selectedDroneIds: ['outside'],
        folderDroneIds: ['one', 'two'],
      }),
    ).toEqual([]);
  });

  test('shift click selects every drone in the folder', () => {
    expect(
      resolveSidebarFolderDroneSelection({
        selectedDroneIds: ['outside'],
        folderDroneIds: ['one', 'two'],
        options: { selectDrones: true },
      }),
    ).toEqual(['one', 'two']);
  });

  test('control click adds an unselected folder and removes an already selected folder', () => {
    expect(
      resolveSidebarFolderDroneSelection({
        selectedDroneIds: ['outside'],
        folderDroneIds: ['one', 'two'],
        options: { selectDrones: true, toggle: true },
      }),
    ).toEqual(['outside', 'one', 'two']);
    expect(
      resolveSidebarFolderDroneSelection({
        selectedDroneIds: ['outside', 'one', 'two'],
        folderDroneIds: ['one', 'two'],
        options: { selectDrones: true, toggle: true },
      }),
    ).toEqual(['outside']);
  });
});
