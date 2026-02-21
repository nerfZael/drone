import { describe, expect, test } from 'bun:test';
import type { DroneSummary } from '../src/droneHub/types';
import { sortGroupMultiChatDrones } from '../src/droneHub/app/group-multi-chat-sort';

function drone(id: string): DroneSummary {
  return {
    id,
    name: id,
    group: 'g',
    createdAt: '2026-02-01T00:00:00.000Z',
    repoPath: '',
    containerPort: 0,
    hostPort: null,
    statusOk: true,
    statusError: null,
    chats: ['default'],
    hubPhase: null,
    hubMessage: null,
  };
}

describe('group multi-chat status sorting', () => {
  test('keeps existing order when status sort is disabled', () => {
    const drones = [drone('a'), drone('b'), drone('c')];
    const out = sortGroupMultiChatDrones({
      drones,
      statusSortEnabled: false,
      runtimeByDroneId: {
        a: { waitingForAgent: false, waitingSinceMs: null, lastResponseAtMs: 100 },
        b: { waitingForAgent: true, waitingSinceMs: 200, lastResponseAtMs: 50 },
        c: { waitingForAgent: false, waitingSinceMs: null, lastResponseAtMs: 300 },
      },
    });
    expect(out.map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  test('moves waiting drones to the right and sorts responded drones oldest to newest', () => {
    const drones = [drone('a'), drone('b'), drone('c'), drone('d')];
    const out = sortGroupMultiChatDrones({
      drones,
      statusSortEnabled: true,
      runtimeByDroneId: {
        a: { waitingForAgent: false, waitingSinceMs: null, lastResponseAtMs: 100 },
        b: { waitingForAgent: true, waitingSinceMs: 300, lastResponseAtMs: 20 },
        c: { waitingForAgent: false, waitingSinceMs: null, lastResponseAtMs: 200 },
        d: { waitingForAgent: true, waitingSinceMs: 150, lastResponseAtMs: 10 },
      },
    });
    expect(out.map((d) => d.id)).toEqual(['a', 'c', 'd', 'b']);
  });

  test('places a newly responded drone at the right end of responded drones', () => {
    const drones = [drone('a'), drone('b'), drone('c')];
    const waiting = sortGroupMultiChatDrones({
      drones,
      statusSortEnabled: true,
      runtimeByDroneId: {
        a: { waitingForAgent: false, waitingSinceMs: null, lastResponseAtMs: 100 },
        b: { waitingForAgent: true, waitingSinceMs: 400, lastResponseAtMs: 200 },
        c: { waitingForAgent: false, waitingSinceMs: null, lastResponseAtMs: 300 },
      },
    });
    expect(waiting.map((d) => d.id)).toEqual(['a', 'c', 'b']);

    const responded = sortGroupMultiChatDrones({
      drones,
      statusSortEnabled: true,
      runtimeByDroneId: {
        a: { waitingForAgent: false, waitingSinceMs: null, lastResponseAtMs: 100 },
        b: { waitingForAgent: false, waitingSinceMs: null, lastResponseAtMs: 500 },
        c: { waitingForAgent: false, waitingSinceMs: null, lastResponseAtMs: 300 },
      },
    });
    expect(responded.map((d) => d.id)).toEqual(['a', 'c', 'b']);
  });
});
