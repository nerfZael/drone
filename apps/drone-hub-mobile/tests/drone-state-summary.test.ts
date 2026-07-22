import { describe, expect, test } from 'bun:test';
import { normalizeMobileDrones } from '../src/drones/drone-sidebar-model';
import {
  summarizeMobileDrones,
  withOptimisticMobileBusyChat,
} from '../src/drones/drone-state-summary';

describe('mobile drone state summary', () => {
  test('marks a locally pending chat as working without mutating the server summary', () => {
    const [drone] = normalizeMobileDrones([
      { id: 'pending', chats: ['default', 'review'], busyChats: [] },
    ]);
    expect(drone).toBeDefined();
    if (!drone) return;

    const optimistic = withOptimisticMobileBusyChat(drone, 'review', true);
    expect(optimistic.busyChats).toEqual(['review']);
    expect(drone.busyChats).toEqual([]);
    expect(withOptimisticMobileBusyChat(optimistic, 'review', true)).toBe(optimistic);
    expect(withOptimisticMobileBusyChat(drone, 'review', false)).toBe(drone);
  });

  test('summarizes approval, working, and unread drones with desktop precedence', () => {
    const drones = normalizeMobileDrones([
      {
        id: 'working-unread',
        busyChats: ['default'],
        chats: ['default', 'review'],
        unreadChats: ['default', 'review'],
      },
      {
        id: 'approval-unread',
        approvalRequired: true,
        busyChats: ['default'],
        unreadChats: ['default'],
      },
      { id: 'ready', chats: ['default'] },
      { id: 'blocked-unread', status: 'blocked', unreadChats: ['default'] },
    ]);

    expect(summarizeMobileDrones(drones)).toEqual({
      approval: 1,
      working: 1,
      unread: 3,
    });
  });
});
