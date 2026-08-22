import { describe, expect, test } from 'bun:test';
import { createCanvasChatNodeId, createCanvasDroneNodeId } from '../src/droneHub/app/app-config';
import {
  buildOptimisticChatCloneCanvasNodes,
  buildOptimisticCloneCanvasNodes,
  cloneCanvasDronesById,
  collectCloneableChatsFromCanvasSelection,
  collectCloneableDroneIdsFromCanvasSelection,
  collectCloneSourceNodeIdByDroneId,
} from '../src/droneHub/canvas/clone-shortcuts';
import type { DroneSummary } from '../src/droneHub/types';

describe('canvas clone shortcut helpers', () => {
  test('collects only explicit drone cards for drone cloning', () => {
    expect(
      collectCloneableDroneIdsFromCanvasSelection([
        createCanvasChatNodeId('alpha', 'default'),
        createCanvasDroneNodeId('alpha'),
        createCanvasDroneNodeId('beta'),
      ]),
    ).toEqual(['alpha', 'beta']);
  });

  test('ignores draft and invalid node ids', () => {
    expect(
      collectCloneableDroneIdsFromCanvasSelection([
        'draft:abc123',
        'not-a-canvas-node',
        createCanvasChatNodeId('gamma', 'default'),
        createCanvasDroneNodeId('gamma'),
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

  test('records explicit drone cards as paste-clone placement sources', () => {
    expect(
      collectCloneSourceNodeIdByDroneId([
        createCanvasChatNodeId('alpha', 'review'),
        createCanvasDroneNodeId('alpha'),
        'draft:abc123',
        createCanvasDroneNodeId('beta'),
      ]),
    ).toEqual({
      alpha: createCanvasDroneNodeId('alpha'),
      beta: createCanvasDroneNodeId('beta'),
    });
  });

  test('builds optimistic clone nodes in source order with stable offsets', () => {
    const optimistic = buildOptimisticCloneCanvasNodes({
      copiedDroneIdsRaw: ['alpha', 'beta', 'missing'],
      cloneResultsRaw: [
        { sourceDroneId: 'alpha', cloneDroneId: 'alpha-copy', cloneDroneName: 'alpha-copy' },
        { sourceDroneId: 'beta', cloneDroneId: 'beta-copy', cloneDroneName: 'beta-copy' },
      ],
      sourceNodeIdByDroneId: {
        alpha: createCanvasDroneNodeId('alpha'),
        beta: createCanvasDroneNodeId('beta'),
      },
      nodesById: {
        [createCanvasDroneNodeId('alpha')]: { x: 100, y: 200 },
        [createCanvasDroneNodeId('beta')]: { x: 300, y: 400 },
      },
      cloneOffsetXPx: 44,
      cloneOffsetYPx: 34,
    });

    expect(optimistic.nodes).toEqual([
      {
        droneId: createCanvasDroneNodeId('alpha-copy'),
        label: 'alpha-copy',
        x: 144,
        y: 234,
      },
      {
        droneId: createCanvasDroneNodeId('beta-copy'),
        label: 'beta-copy',
        x: 388,
        y: 468,
      },
    ]);
    expect(optimistic.optimisticDroneNameById).toEqual({
      'alpha-copy': 'alpha-copy',
      'beta-copy': 'beta-copy',
    });
  });

  test('collects and places chat clones without treating them as drone clones', () => {
    const sourceNodeId = createCanvasChatNodeId('alpha', 'review');
    const sources = collectCloneableChatsFromCanvasSelection([
      createCanvasDroneNodeId('alpha'),
      sourceNodeId,
    ]);
    expect(sources).toEqual([
      { nodeId: sourceNodeId, droneId: 'alpha', chatName: 'review' },
    ]);

    expect(
      buildOptimisticChatCloneCanvasNodes({
        sources,
        cloneResults: [{ sourceNodeId, chatName: 'untitled' }],
        nodesById: { [sourceNodeId]: { x: 80, y: 120 } },
        cloneOffsetXPx: 44,
        cloneOffsetYPx: 34,
      }),
    ).toEqual([
      {
        droneId: createCanvasChatNodeId('alpha', 'untitled'),
        label: 'untitled',
        x: 124,
        y: 154,
      },
    ]);
  });
});
