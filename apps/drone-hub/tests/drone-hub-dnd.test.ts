import { describe, expect, test } from 'bun:test';
import {
  assignedDroneIdsFromData,
  resolveAssignedDroneIdsFromTransfer,
} from '../src/droneHub/app/drone-hub-dnd-utils';
import { draggedCanvasNodeIdsFromData, parseDroneHubDragData, resolveSidebarDroneDragIds } from '../src/droneHub/app/drone-hub-dnd';
import { DRONE_CHAT_DND_MIME, DRONE_DND_MIME, createCanvasChatNodeId, createCanvasDroneNodeId } from '../src/droneHub/app/app-config';

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

describe('sidebar drone drag selection', () => {
  test('keeps drone and chat drops as different canvas node kinds', () => {
    expect(
      draggedCanvasNodeIdsFromData({
        type: 'sidebar-drone',
        droneId: 'alpha',
        droneIds: ['alpha', 'beta'],
        groupOrderKey: null,
        label: 'Alpha',
      }),
    ).toEqual([createCanvasDroneNodeId('alpha'), createCanvasDroneNodeId('beta')]);
    expect(
      draggedCanvasNodeIdsFromData({
        type: 'sidebar-chat',
        droneId: 'alpha',
        chatName: 'review',
        nodeId: createCanvasChatNodeId('alpha', 'review'),
        label: 'review',
      }),
    ).toEqual([createCanvasChatNodeId('alpha', 'review')]);
    expect(
      draggedCanvasNodeIdsFromData({
        type: 'sidebar-pinned-drone',
        droneId: 'pinned',
        label: 'Pinned',
      }),
    ).toEqual([createCanvasDroneNodeId('pinned')]);
  });

  test('preserves the stable group id for folder drags', () => {
    expect(
      parseDroneHubDragData({
        type: 'sidebar-folder',
        groupId: ' group-123 ',
        folderNodeId: 'folder:Experiments',
        folderPath: 'Experiments',
        groupKind: 'group',
        label: 'Experiments',
      }),
    ).toEqual({
      type: 'sidebar-folder',
      groupId: 'group-123',
      folderNodeId: 'folder:Experiments',
      folderPath: 'Experiments',
      groupKind: 'group',
      label: 'Experiments',
    });
  });

  test('plain dragging an unselected drone replaces the existing selection', () => {
    expect(
      resolveSidebarDroneDragIds({
        draggedDroneId: 'charlie',
        selectedDroneIds: ['alpha', 'bravo'],
        additive: false,
      }),
    ).toEqual(['charlie']);
  });

  test('dragging an already-selected drone keeps the selected set together', () => {
    expect(
      resolveSidebarDroneDragIds({
        draggedDroneId: 'bravo',
        selectedDroneIds: ['alpha', 'bravo'],
        additive: false,
      }),
    ).toEqual(['alpha', 'bravo']);
  });

  test('modifier-dragging an unselected drone adds it to the dragged set', () => {
    expect(
      resolveSidebarDroneDragIds({
        draggedDroneId: 'charlie',
        selectedDroneIds: ['alpha', 'bravo'],
        additive: true,
      }),
    ).toEqual(['alpha', 'bravo', 'charlie']);
  });
});
