import { describe, expect, test } from 'bun:test';

import {
  isSidebarFolderRowSelected,
  resolveSidebarFolderDroneSelection,
} from '../src/droneHub/app/sidebar-folder-selection';

describe('sidebar folder drone selection', () => {
  test('only marks a folder row selected when the folder itself is selected', () => {
    expect(
      isSidebarFolderRowSelected({
        folderNodeId: 'folder:group-a',
        folderPath: 'Group A',
        selectedSidebarNodeId: 'drone:one',
        selectedFolderPath: null,
      }),
    ).toBe(false);

    expect(
      isSidebarFolderRowSelected({
        folderNodeId: 'folder:group-a',
        folderPath: 'Group A',
        selectedSidebarNodeId: 'folder:group-a',
        selectedFolderPath: 'Group A',
      }),
    ).toBe(true);
  });

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

  test('control click combines any number of folders with individually selected drones', () => {
    const withFirstFolder = resolveSidebarFolderDroneSelection({
      selectedDroneIds: ['outside'],
      folderDroneIds: ['one', 'two'],
      options: { selectDrones: true, toggle: true },
    });
    const withBothFolders = resolveSidebarFolderDroneSelection({
      selectedDroneIds: withFirstFolder,
      folderDroneIds: ['three', 'four'],
      options: { selectDrones: true, toggle: true },
    });

    expect(withBothFolders).toEqual(['outside', 'one', 'two', 'three', 'four']);
    expect(
      resolveSidebarFolderDroneSelection({
        selectedDroneIds: withBothFolders,
        folderDroneIds: ['one', 'two'],
        options: { selectDrones: true, toggle: true },
      }),
    ).toEqual(['outside', 'three', 'four']);
  });
});
