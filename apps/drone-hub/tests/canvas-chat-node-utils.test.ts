import { describe, expect, test } from 'bun:test';
import {
  DRONE_CHAT_DND_MIME,
  DRONE_DND_MIME,
  createCanvasChatNodeId,
} from '../src/droneHub/app/app-config';
import {
  expandDroneIdsToChatNodeIds,
  resolveDraggedCanvasChatNodeIds,
} from '../src/droneHub/canvas/chat-node-utils';

describe('canvas drag payload helpers', () => {
  test('expands dragged drone ids into every ordered chat node for those drones', () => {
    const alphaDefault = createCanvasChatNodeId('alpha', 'default');
    const alphaReview = createCanvasChatNodeId('alpha', 'review');
    const betaDefault = createCanvasChatNodeId('beta', 'default');

    expect(
      expandDroneIdsToChatNodeIds(['alpha', 'beta'], [
        betaDefault,
        alphaDefault,
        alphaReview,
      ]),
    ).toEqual([
      alphaDefault,
      alphaReview,
      betaDefault,
    ]);
  });

  test('falls back to the default chat when a dragged drone is missing from sidebar order', () => {
    expect(expandDroneIdsToChatNodeIds(['gamma'], [])).toEqual([
      createCanvasChatNodeId('gamma', 'default'),
    ]);
  });

  test('resolves explicit chat payloads and whole-drone payloads into ordered canvas nodes', () => {
    const alphaDefault = createCanvasChatNodeId('alpha', 'default');
    const alphaReview = createCanvasChatNodeId('alpha', 'review');
    const betaDefault = createCanvasChatNodeId('beta', 'default');

    const transfer = {
      getData(type: string) {
        if (type === DRONE_CHAT_DND_MIME) {
          return JSON.stringify([{ droneId: 'beta', chatName: 'default' }]);
        }
        if (type === DRONE_DND_MIME) {
          return JSON.stringify(['alpha']);
        }
        return '';
      },
    };

    expect(
      resolveDraggedCanvasChatNodeIds(transfer, [
        alphaDefault,
        alphaReview,
        betaDefault,
      ]),
    ).toEqual([
      alphaDefault,
      alphaReview,
      betaDefault,
    ]);
  });
});
