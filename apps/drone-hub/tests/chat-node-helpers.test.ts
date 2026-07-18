import { describe, expect, test } from 'bun:test';
import {
  hasOnlyDefaultChat,
  nextUnreadChatReadCursor,
  reconcileManualUnreadMarker,
  resolveCanvasChatDisplay,
  unreadChatNodeIdsForDrone,
} from '../src/droneHub/app/chat-node-helpers';
import type { DroneSummary } from '../src/droneHub/types';

function drone(seed: Partial<DroneSummary> & Pick<DroneSummary, 'id' | 'name'>): DroneSummary {
  return {
    id: seed.id,
    name: seed.name,
    group: seed.group ?? null,
    createdAt: seed.createdAt ?? '2026-01-01T00:00:00.000Z',
    repoPath: seed.repoPath ?? '',
    containerPort: seed.containerPort ?? 0,
    hostPort: seed.hostPort ?? null,
    statusOk: seed.statusOk ?? true,
    statusError: seed.statusError ?? null,
    chats: seed.chats ?? ['default'],
    unreadChats: seed.unreadChats,
    chatReadStates: seed.chatReadStates,
    fleetParentId: seed.fleetParentId ?? null,
    repoAttached: seed.repoAttached ?? false,
    hubPhase: seed.hubPhase ?? null,
    hubMessage: seed.hubMessage ?? null,
    busy: seed.busy ?? false,
  };
}

describe('chat node helpers', () => {
  test('treats an implicit empty chat list as only the default chat', () => {
    expect(hasOnlyDefaultChat(drone({ id: 'alpha', name: 'Alpha', chats: [] }))).toBe(true);
  });

  test('uses the drone name as the canvas primary label for a lone default chat', () => {
    expect(resolveCanvasChatDisplay(drone({ id: 'alpha', name: 'Alpha', chats: ['default'] }), 'default', 'Alpha')).toEqual({
      primaryLabel: 'Alpha',
      secondaryLabel: '',
    });
  });

  test('keeps the chat name when the drone has additional chats', () => {
    expect(resolveCanvasChatDisplay(drone({ id: 'alpha', name: 'Alpha', chats: ['default', 'review'] }), 'default', 'Alpha')).toEqual({
      primaryLabel: 'default',
      secondaryLabel: 'Alpha',
    });
  });

  test('uses cursor-backed read states instead of a stale unread summary array', () => {
    expect(
      unreadChatNodeIdsForDrone(
        drone({
          id: 'alpha',
          name: 'Alpha',
          chats: ['default', 'review'],
          unreadChats: ['default'],
          chatReadStates: {
            default: {
              unread: false,
              latestAgentTurnId: null,
              latestAgentRevision: 0,
            },
            review: {
              unread: true,
              latestAgentTurnId: 'turn-2',
              latestAgentRevision: 2,
            },
          },
        }),
      ),
    ).toEqual(['chat:alpha::review']);
  });

  test('keeps a manual unread marker until its shared unread state has been observed', () => {
    const pending = { latestAgentRevision: 2, observedInSummary: false };
    expect(
      reconcileManualUnreadMarker(pending, {
        unread: false,
        latestAgentTurnId: 'turn-2',
        latestAgentRevision: 2,
      }),
    ).toBe(pending);

    const observed = reconcileManualUnreadMarker(pending, {
      unread: true,
      latestAgentTurnId: 'turn-2',
      latestAgentRevision: 2,
    });
    expect(observed).toEqual({ latestAgentRevision: 2, observedInSummary: true });
    expect(
      reconcileManualUnreadMarker(observed!, {
        unread: false,
        latestAgentTurnId: 'turn-2',
        latestAgentRevision: 2,
      }),
    ).toBeNull();
    expect(
      reconcileManualUnreadMarker(pending, {
        unread: true,
        latestAgentTurnId: 'turn-3',
        latestAgentRevision: 3,
      }),
    ).toBeNull();
  });

  test('continues a read acknowledgement from the newer server cursor when the registry is stale', () => {
    expect(
      nextUnreadChatReadCursor(
        {
          unread: true,
          latestAgentTurnId: 'turn-1',
          latestAgentRevision: 1,
        },
        {
          unread: true,
          latestAgentTurnId: 'turn-2',
          latestAgentRevision: 2,
        },
        {
          unread: true,
          latestAgentTurnId: 'turn-1',
          latestAgentRevision: 1,
        },
      ),
    ).toEqual({
      unread: true,
      latestAgentTurnId: 'turn-2',
      latestAgentRevision: 2,
    });
  });

  test('stops a read acknowledgement when neither cursor has advanced', () => {
    const current = {
      unread: true,
      latestAgentTurnId: 'turn-2',
      latestAgentRevision: 2,
    };
    expect(nextUnreadChatReadCursor(current, current, current)).toBeNull();
  });
});
