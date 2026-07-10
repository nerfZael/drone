import { describe, expect, test } from 'bun:test';
import { createCanvasChatNodeId } from '../src/droneHub/app/app-config';
import type { DroneSummary } from '../src/droneHub/types';
import { remoteBusyChatNodeIds, updateRemoteUnreadChats } from '../src/remote/remote-unread';

function drone(seed: Partial<DroneSummary> & Pick<DroneSummary, 'id'>): DroneSummary {
  return {
    id: seed.id,
    name: seed.name ?? seed.id,
    group: seed.group ?? null,
    createdAt: seed.createdAt ?? '2026-07-10T12:00:00.000Z',
    runtime: seed.runtime ?? 'container',
    repoPath: seed.repoPath ?? '',
    containerPort: seed.containerPort ?? 0,
    hostPort: seed.hostPort ?? null,
    statusOk: seed.statusOk ?? true,
    statusError: seed.statusError ?? null,
    chats: seed.chats ?? ['default'],
    busyChats: seed.busyChats ?? [],
    busy: seed.busy ?? false,
  };
}

describe('Remote Hub unread chats', () => {
  test('marks a non-selected chat unread when it changes from busy to idle', () => {
    const busyDrones = [drone({ id: 'worker', busyChats: ['default'] }), drone({ id: 'selected' })];
    const idleDrones = [drone({ id: 'worker' }), drone({ id: 'selected' })];
    const next = updateRemoteUnreadChats({
      drones: idleDrones,
      previousBusyChatNodeIds: remoteBusyChatNodeIds(busyDrones),
      busyChatNodeIds: remoteBusyChatNodeIds(idleDrones),
      unreadAgentMessageByChatNodeId: {},
      selectedDroneId: 'selected',
      selectedChat: 'default',
    });

    expect(next).toEqual({ [createCanvasChatNodeId('worker', 'default')]: true });
  });

  test('tracks the exact completed chat on multi-chat drones', () => {
    const busyDrones = [
      drone({ id: 'worker', chats: ['default', 'review'], busyChats: ['review'] }),
    ];
    const idleDrones = [drone({ id: 'worker', chats: ['default', 'review'] })];
    const next = updateRemoteUnreadChats({
      drones: idleDrones,
      previousBusyChatNodeIds: remoteBusyChatNodeIds(busyDrones),
      busyChatNodeIds: remoteBusyChatNodeIds(idleDrones),
      unreadAgentMessageByChatNodeId: {},
      selectedDroneId: 'worker',
      selectedChat: 'default',
    });

    expect(next).toEqual({ [createCanvasChatNodeId('worker', 'review')]: true });
  });

  test('clears the selected chat and prunes chats that no longer exist', () => {
    const selectedNodeId = createCanvasChatNodeId('worker', 'default');
    const removedNodeId = createCanvasChatNodeId('removed', 'default');
    const drones = [drone({ id: 'worker' })];
    const next = updateRemoteUnreadChats({
      drones,
      previousBusyChatNodeIds: new Set(),
      busyChatNodeIds: remoteBusyChatNodeIds(drones),
      unreadAgentMessageByChatNodeId: { [selectedNodeId]: true, [removedNodeId]: true },
      selectedDroneId: 'worker',
      selectedChat: 'default',
    });

    expect(next).toEqual({});
  });

  test('does not create unread notifications for local-only host drones', () => {
    const busyDrones = [drone({ id: 'host-worker', runtime: 'host', busyChats: ['default'] })];
    const idleDrones = [drone({ id: 'host-worker', runtime: 'host' })];
    expect(remoteBusyChatNodeIds(busyDrones)).toEqual(new Set());
    expect(
      updateRemoteUnreadChats({
        drones: idleDrones,
        previousBusyChatNodeIds: remoteBusyChatNodeIds(busyDrones),
        busyChatNodeIds: remoteBusyChatNodeIds(idleDrones),
        unreadAgentMessageByChatNodeId: {},
        selectedDroneId: null,
        selectedChat: 'default',
      }),
    ).toEqual({});
  });
});
