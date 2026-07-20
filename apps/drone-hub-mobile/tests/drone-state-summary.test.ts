import { describe, expect, test } from 'bun:test';
import { normalizeMobileDrones } from '../src/drones/drone-sidebar-model';
import { summarizeMobileDrones } from '../src/drones/drone-state-summary';

describe('mobile drone state summary', () => {
  test('shows only working and unread drone counts', () => {
    const drones = normalizeMobileDrones([
      {
        id: 'working-unread',
        busyChats: ['default'],
        chats: ['default', 'review'],
        unreadChats: ['default', 'review'],
      },
      { id: 'ready', chats: ['default'] },
      { id: 'blocked-unread', status: 'blocked', unreadChats: ['default'] },
    ]);

    expect(summarizeMobileDrones(drones)).toEqual({
      working: 1,
      unread: 2,
    });
  });
});
