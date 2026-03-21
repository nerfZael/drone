import { describe, expect, test } from 'bun:test';
import { createCanvasChatNodeId } from '../src/droneHub/app/app-config';
import {
  cloneCanvasDronesById,
  collectCloneableDroneIdsFromCanvasSelection,
} from '../src/droneHub/canvas/clone-shortcuts';
import type { DroneSummary } from '../src/droneHub/types';

describe('canvas clone shortcut helpers', () => {
  test('dedupes selected chats down to ordered unique drone ids', () => {
    expect(
      collectCloneableDroneIdsFromCanvasSelection([
        createCanvasChatNodeId('alpha', 'default'),
        createCanvasChatNodeId('alpha', 'review'),
        createCanvasChatNodeId('beta', 'default'),
      ]),
    ).toEqual(['alpha', 'beta']);
  });

  test('ignores draft and invalid node ids', () => {
    expect(
      collectCloneableDroneIdsFromCanvasSelection([
        'draft:abc123',
        'not-a-canvas-node',
        createCanvasChatNodeId('gamma', 'default'),
      ]),
    ).toEqual(['gamma']);
  });

  test('clones every copied drone in order and skips missing ids', async () => {
    const cloned: string[] = [];
    const drone = (id: string): DroneSummary =>
      ({
        id,
        name: id,
        group: null,
        createdAt: '2026-03-21T00:00:00.000Z',
        statusOk: true,
        statusError: null,
        hubStatus: 'ready',
        hubUrl: null,
        kind: 'drone',
        runtime: 'container',
      }) as DroneSummary;

    await cloneCanvasDronesById(
      ['alpha', 'missing', 'beta'],
      { alpha: drone('alpha'), beta: drone('beta') },
      async (entry) => {
        cloned.push(entry.id);
        return true;
      },
    );

    expect(cloned).toEqual(['alpha', 'beta']);
  });
});
