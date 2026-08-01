import { describe, expect, test } from 'bun:test';
import { normalizeMobileDrones } from '../src/drones/drone-sidebar-model';
import {
  mobileDroneChatDisplayState,
  mobileDroneDisplayState,
  summarizeMobileDrones,
  withMobileApprovalRequired,
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

  test('keeps approval ahead of working from either server or active-chat state', () => {
    const [serverApproval, activeChatApproval] = normalizeMobileDrones([
      {
        id: 'server',
        chats: ['default', 'review'],
        approvalChats: ['review'],
        busyChats: ['default'],
      },
      { id: 'active-chat', busyChats: ['default'] },
    ]);
    expect(serverApproval).toBeDefined();
    expect(activeChatApproval).toBeDefined();
    if (!serverApproval || !activeChatApproval) return;

    expect(withMobileApprovalRequired(serverApproval, false)).toBe(serverApproval);
    expect(serverApproval.approvalChats).toEqual(['review']);
    expect(mobileDroneDisplayState(serverApproval)).toBe('approval');

    const derivedApproval = withMobileApprovalRequired(activeChatApproval, true);
    expect(derivedApproval.approvalRequired).toBe(true);
    expect(mobileDroneDisplayState(derivedApproval)).toBe('approval');
  });

  test('uses the desktop blocked glyph state when statusError explains an unhealthy drone', () => {
    const [blocked, offline] = normalizeMobileDrones([
      { id: 'blocked', statusOk: false, statusError: 'Agent failed to start' },
      { id: 'offline', statusOk: false },
    ]);

    expect(blocked).toBeDefined();
    expect(offline).toBeDefined();
    if (!blocked || !offline) return;

    expect(mobileDroneDisplayState(blocked)).toBe('blocked');
    expect(mobileDroneDisplayState(offline)).toBe('offline');
  });

  test('derives multi-chat indicators from each chat before the shared inactive state', () => {
    const [drone] = normalizeMobileDrones([
      {
        id: 'multi-chat',
        chats: ['default', 'review', 'approval'],
        busyChats: ['review'],
        approvalChats: ['approval'],
        statusError: 'failed to connect',
      },
    ]);
    expect(drone).toBeDefined();
    if (!drone) return;

    expect(mobileDroneChatDisplayState(drone, 'approval')).toBe('approval');
    expect(mobileDroneChatDisplayState(drone, 'review')).toBe('working');
    expect(mobileDroneChatDisplayState(drone, 'default')).toBe('blocked');
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
