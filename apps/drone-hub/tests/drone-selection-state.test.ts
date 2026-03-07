import { describe, expect, test } from 'bun:test';
import { resolveSelectedChatForDrone } from '../src/droneHub/app/use-drone-selection-state';
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
});
