import { describe, expect, test } from 'bun:test';

import {
  resolveSidebarDroneDraftLocation,
  resolveSidebarGroupDraftLocation,
} from '../src/droneHub/app/sidebar-group-draft-location';

describe('sidebar group draft location', () => {
  const visibleFolderPaths = new Set([
    'Alpha',
    'Alpha/Untitled 1',
    'Alpha/Nested',
    'Alpha/Nested/Untitled 1',
    'Beta',
    'Untitled 1',
  ]);

  test('creates inside the selected visible group', () => {
    expect(
      resolveSidebarGroupDraftLocation('Alpha', visibleFolderPaths),
    ).toEqual({
      parentPath: 'Alpha',
      siblingNames: ['Untitled 1', 'Nested'],
    });
  });

  test('uses only direct children when allocating a nested group name', () => {
    expect(
      resolveSidebarGroupDraftLocation('Alpha/Nested', visibleFolderPaths),
    ).toEqual({
      parentPath: 'Alpha/Nested',
      siblingNames: ['Untitled 1'],
    });
  });

  test("creates inside the selected drone's group when no folder is selected", () => {
    expect(
      resolveSidebarGroupDraftLocation(null, visibleFolderPaths, 'Alpha'),
    ).toEqual({
      parentPath: 'Alpha',
      siblingNames: ['Untitled 1', 'Nested'],
    });
  });

  test('falls back to the root when there is no visible selected group', () => {
    expect(
      resolveSidebarGroupDraftLocation('Missing', visibleFolderPaths),
    ).toEqual({
      parentPath: null,
      siblingNames: ['Alpha', 'Beta', 'Untitled 1'],
    });
  });
});

describe('sidebar drone draft location', () => {
  const visibleFolderPaths = new Set(['Alpha', 'Alpha/Nested', 'Beta']);

  test('uses the selected folder before the selected drone group', () => {
    expect(
      resolveSidebarDroneDraftLocation({
        selectedFolderPath: 'Alpha/Nested',
        visibleFolderPaths,
        selectedDrone: {
          group: 'Beta',
          repoPath: '/repos/example',
        },
      }),
    ).toEqual({
      group: 'Alpha/Nested',
      repoPath: '/repos/example',
    });
  });

  test("uses the selected drone's group for the New Drone button", () => {
    expect(
      resolveSidebarDroneDraftLocation({
        selectedFolderPath: null,
        visibleFolderPaths,
        selectedDrone: {
          group: 'Beta',
          repoPath: '/repos/example',
        },
      }),
    ).toEqual({
      group: 'Beta',
      repoPath: '/repos/example',
    });
  });

  test('falls back to the active repository at the root', () => {
    expect(
      resolveSidebarDroneDraftLocation({
        selectedFolderPath: null,
        visibleFolderPaths,
        fallbackRepoPath: '/repos/example',
      }),
    ).toEqual({
      group: '',
      repoPath: '/repos/example',
    });
  });

  test('keeps an ungrouped selected drone at the root', () => {
    expect(
      resolveSidebarDroneDraftLocation({
        selectedFolderPath: null,
        visibleFolderPaths: new Set(['Ungrouped']),
        selectedDrone: {
          group: 'Ungrouped',
        },
      }),
    ).toEqual({
      group: '',
    });
  });
});
