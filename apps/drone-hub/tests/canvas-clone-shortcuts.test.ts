import { describe, expect, test } from 'bun:test';
import { createCanvasChatNodeId, createCanvasDroneNodeId } from '../src/droneHub/app/app-config';
import {
  cloneCanvasDronesById,
  collectCloneableChatsFromCanvasSelection,
  collectCloneableDroneIdsFromCanvasSelection,
  collectCloneSourceNodeIdByDroneId,
  planCanvasPastePositions,
  runWithConcurrency,
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

  const alphaNode = createCanvasChatNodeId('alpha', 'review');
  const betaNode = createCanvasChatNodeId('alpha', 'plan');
  const boundsById = {
    [alphaNode]: { x: 100, y: 100, width: 100, height: 40 },
    [betaNode]: { x: 300, y: 200, width: 100, height: 40 },
  };

  test('pastes a group centred on the cursor and keeps its shape', () => {
    const positions = planCanvasPastePositions({
      sourceNodeIds: [alphaNode, betaNode, 'not-on-the-board'],
      boundsById,
      anchor: { x: 1250, y: 670 },
      fallbackOffset: { x: 44, y: 34 },
    });
    // The group spans (100,100)-(400,240), centre (250,170): everything shifts by (1000,500).
    expect(positions).toEqual({
      [alphaNode]: { x: 1100, y: 600 },
      [betaNode]: { x: 1300, y: 700 },
    });
  });

  test('steps aside when the cursor is over the copied cards or unknown', () => {
    const offset = { [alphaNode]: { x: 144, y: 134 }, [betaNode]: { x: 344, y: 234 } };
    const base = { sourceNodeIds: [alphaNode, betaNode], boundsById, fallbackOffset: { x: 44, y: 34 } };
    expect(planCanvasPastePositions({ ...base, anchor: { x: 250, y: 170 } })).toEqual(offset);
    expect(planCanvasPastePositions({ ...base, anchor: null })).toEqual(offset);
  });

  test('clones a group in parallel without exceeding the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      done.push(item);
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test('collects chat cards without treating them as drone clones', () => {
    const sourceNodeId = createCanvasChatNodeId('alpha', 'review');
    expect(
      collectCloneableChatsFromCanvasSelection([createCanvasDroneNodeId('alpha'), sourceNodeId]),
    ).toEqual([{ nodeId: sourceNodeId, droneId: 'alpha', chatName: 'review' }]);
  });
});
