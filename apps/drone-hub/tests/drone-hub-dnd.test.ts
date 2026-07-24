import { describe, expect, test } from 'bun:test';
import {
  assignedDroneIdsFromData,
  resolveAssignedDroneIdsFromTransfer,
} from '../src/droneHub/app/drone-hub-dnd-utils';
import { DRONE_CHAT_DND_MIME, DRONE_DND_MIME, createCanvasChatNodeId } from '../src/droneHub/app/app-config';

describe('drone hub assignment drag helpers', () => {
  test('resolves sidebar chat drags into their underlying drone id', () => {
    expect(
      assignedDroneIdsFromData({
        type: 'sidebar-chat',
        droneId: 'bravo',
        chatName: 'default',
        nodeId: createCanvasChatNodeId('bravo', 'default'),
        label: 'bravo / default',
      }),
    ).toEqual(['bravo']);
  });

  test('keeps pinned reorder drags scoped to the pinned list', () => {
    expect(
      assignedDroneIdsFromData({
        type: 'sidebar-pinned-drone',
        droneId: 'bravo',
        label: 'Bravo',
      }),
    ).toEqual([]);
  });

  test('resolves native drag payloads from drone ids and chat refs', () => {
    const transfer = {
      getData(type: string) {
        if (type === DRONE_DND_MIME) return JSON.stringify(['alpha', 'bravo']);
        if (type === DRONE_CHAT_DND_MIME) {
          return JSON.stringify([
            { nodeId: createCanvasChatNodeId('charlie', 'default') },
            { droneId: 'delta', chatName: 'review' },
          ]);
        }
        return '';
      },
    };

    expect(resolveAssignedDroneIdsFromTransfer(transfer)).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
  });
});
