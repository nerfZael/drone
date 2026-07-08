import { describe, expect, test } from 'bun:test';
import {
  resolveDroneDeleteTargetIds,
  resolveDroneCardSelection,
  resolveSelectedChatForDrone,
  shouldKeepPendingSelectedChat,
} from '../src/droneHub/app/drone-selection-helpers';
import type { DroneSummary } from '../src/droneHub/types';

function makeDrone(id: string, chats: string[]): DroneSummary {
  return {
    id,
    name: id,
    group: null,
    createdAt: '2026-03-07T00:00:00.000Z',
    repoPath: '',
    containerPort: 7777,
    hostPort: null,
    statusOk: true,
    statusError: null,
    chats,
  };
}

describe('resolveSelectedChatForDrone', () => {
  test('restores the last selected chat when it still exists on the drone', () => {
    const selected = resolveSelectedChatForDrone({
      droneId: 'drone-a',
      drones: [makeDrone('drone-a', ['default', 'chat-2'])],
      lastSelectedChatByDrone: { 'drone-a': 'chat-2' },
    });

    expect(selected).toBe('chat-2');
  });

  test('falls back to default when the remembered chat no longer exists', () => {
    const selected = resolveSelectedChatForDrone({
      droneId: 'drone-a',
      drones: [makeDrone('drone-a', ['default'])],
      lastSelectedChatByDrone: { 'drone-a': 'chat-2' },
    });

    expect(selected).toBe('default');
  });

  test('falls back to the first available chat when default is unavailable', () => {
    const selected = resolveSelectedChatForDrone({
      droneId: 'drone-a',
      drones: [makeDrone('drone-a', ['review'])],
      lastSelectedChatByDrone: {},
    });

    expect(selected).toBe('review');
  });

  test('falls back to default when the drone has no chats yet', () => {
    const selected = resolveSelectedChatForDrone({
      droneId: 'drone-a',
      drones: [makeDrone('drone-a', [])],
      lastSelectedChatByDrone: {},
    });

    expect(selected).toBe('default');
  });
});

describe('shouldKeepPendingSelectedChat', () => {
  test('keeps a newly selected non-default chat while the server list is stale', () => {
    expect(
      shouldKeepPendingSelectedChat({
        selectedChat: 'chat-2',
        availableChats: ['default'],
        pendingUntilMs: 2_000,
        nowMs: 1_000,
      }),
    ).toBe(true);
  });

  test('stops keeping the pending chat after the grace window expires', () => {
    expect(
      shouldKeepPendingSelectedChat({
        selectedChat: 'chat-2',
        availableChats: ['default'],
        pendingUntilMs: 1_000,
        nowMs: 2_000,
      }),
    ).toBe(false);
  });

  test('does not keep default or already-materialized chats', () => {
    expect(
      shouldKeepPendingSelectedChat({
        selectedChat: 'default',
        availableChats: ['default'],
        pendingUntilMs: 2_000,
        nowMs: 1_000,
      }),
    ).toBe(false);
    expect(
      shouldKeepPendingSelectedChat({
        selectedChat: 'chat-2',
        availableChats: ['default', 'chat-2'],
        pendingUntilMs: 2_000,
        nowMs: 1_000,
      }),
    ).toBe(false);
  });
});

describe('resolveDroneCardSelection', () => {
  test('plain click selects only the clicked drone', () => {
    expect(
      resolveDroneCardSelection({
        droneId: 'charlie',
        selectedDrone: 'alpha',
        selectedDroneIds: ['alpha', 'bravo'],
        orderedDroneIds: ['alpha', 'bravo', 'charlie'],
        selectionAnchor: 'alpha',
      }),
    ).toEqual({
      selectedDroneIds: ['charlie'],
      activeDroneId: 'charlie',
      selectionAnchor: 'charlie',
    });
  });

  test('ctrl click adds and removes individual drones', () => {
    expect(
      resolveDroneCardSelection({
        droneId: 'charlie',
        selectedDrone: 'bravo',
        selectedDroneIds: ['alpha', 'bravo'],
        orderedDroneIds: ['alpha', 'bravo', 'charlie'],
        selectionAnchor: 'bravo',
        opts: { toggle: true },
      }),
    ).toEqual({
      selectedDroneIds: ['alpha', 'bravo', 'charlie'],
      activeDroneId: 'charlie',
      selectionAnchor: 'charlie',
    });

    expect(
      resolveDroneCardSelection({
        droneId: 'bravo',
        selectedDrone: 'bravo',
        selectedDroneIds: ['alpha', 'bravo', 'charlie'],
        orderedDroneIds: ['alpha', 'bravo', 'charlie'],
        selectionAnchor: 'bravo',
        opts: { toggle: true },
      }),
    ).toEqual({
      selectedDroneIds: ['alpha', 'charlie'],
      activeDroneId: 'charlie',
      selectionAnchor: 'bravo',
    });
  });

  test('ctrl click can clear the last selected drone', () => {
    expect(
      resolveDroneCardSelection({
        droneId: 'alpha',
        selectedDrone: 'alpha',
        selectedDroneIds: ['alpha'],
        orderedDroneIds: ['alpha', 'bravo', 'charlie'],
        selectionAnchor: 'alpha',
        opts: { toggle: true },
      }),
    ).toEqual({
      selectedDroneIds: [],
      activeDroneId: null,
      selectionAnchor: 'alpha',
    });
  });

  test('shift click selects a visible range from the anchor', () => {
    expect(
      resolveDroneCardSelection({
        droneId: 'delta',
        selectedDrone: 'bravo',
        selectedDroneIds: ['bravo'],
        orderedDroneIds: ['alpha', 'bravo', 'charlie', 'delta'],
        selectionAnchor: 'bravo',
        opts: { range: true },
      }),
    ).toEqual({
      selectedDroneIds: ['bravo', 'charlie', 'delta'],
      activeDroneId: 'delta',
      selectionAnchor: 'bravo',
    });
  });

  test('shift range can use the current rendered sidebar order', () => {
    expect(
      resolveDroneCardSelection({
        droneId: 'alpha',
        selectedDrone: 'delta',
        selectedDroneIds: ['delta'],
        orderedDroneIds: ['alpha', 'bravo', 'charlie', 'delta'],
        selectionAnchor: 'delta',
        opts: { range: true, orderedDroneIds: ['delta', 'bravo', 'alpha', 'charlie'] },
      }),
    ).toEqual({
      selectedDroneIds: ['delta', 'bravo', 'alpha'],
      activeDroneId: 'alpha',
      selectionAnchor: 'delta',
    });
  });
});

describe('resolveDroneDeleteTargetIds', () => {
  test('delete key targets all selected drones', () => {
    expect(
      resolveDroneDeleteTargetIds({
        selectedDrone: 'alpha',
        selectedDroneIds: ['alpha', 'bravo', 'charlie'],
      }),
    ).toEqual(['alpha', 'bravo', 'charlie']);
  });

  test('delete key falls back to the active drone when there is no multi-selection', () => {
    expect(
      resolveDroneDeleteTargetIds({
        selectedDrone: 'alpha',
        selectedDroneIds: [],
      }),
    ).toEqual(['alpha']);
  });

  test('trash on a selected drone targets the full multi-selection', () => {
    expect(
      resolveDroneDeleteTargetIds({
        droneId: 'bravo',
        selectedDrone: 'alpha',
        selectedDroneIds: ['alpha', 'bravo', 'charlie'],
      }),
    ).toEqual(['alpha', 'bravo', 'charlie']);
  });

  test('trash on an unselected drone targets only that drone', () => {
    expect(
      resolveDroneDeleteTargetIds({
        droneId: 'delta',
        selectedDrone: 'alpha',
        selectedDroneIds: ['alpha', 'bravo', 'charlie'],
      }),
    ).toEqual(['delta']);
  });
});
