import { beforeEach, describe, expect, test } from 'bun:test';
import { createCanvasChatNodeId } from '../src/droneHub/app/app-config';
import {
  buildDroneBoardMembers,
  placeClonedChatOnDroneBoard,
  planDroneBoardPlacements,
} from '../src/droneHub/canvas/drone-board';
import { buildCanvasRelationshipEdges } from '../src/droneHub/canvas/relationship-edges';
import {
  EMPTY_CANVAS_BOARD,
  getCanvasBoardActions,
  selectCanvasBoard,
  useDroneCanvasStore,
} from '../src/droneHub/canvas/use-drone-canvas-store';

const agent = { kind: 'builtin', id: 'claude' };
const nodeId = (chatName: string) => createCanvasChatNodeId('alpha', chatName);

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 96 && Math.abs(a.y - b.y) < 38;
}

describe('drone board membership', () => {
  test('lists every chat and records where side chats branched from', () => {
    const members = buildDroneBoardMembers({
      id: 'alpha',
      chats: ['default', 'plan'],
      sideChats: [{ name: 'side-1', sourceChatName: 'plan', checkpointId: 'c1', agent }],
    });
    expect(members).toEqual([
      { nodeId: nodeId('default'), chatName: 'default', sourceNodeId: null },
      { nodeId: nodeId('plan'), chatName: 'plan', sourceNodeId: null },
      { nodeId: nodeId('side-1'), chatName: 'side-1', sourceNodeId: nodeId('plan') },
    ]);
  });

  test('links a sidebar clone to its source the same way as a side chat', () => {
    const members = buildDroneBoardMembers({
      id: 'alpha',
      chats: ['default', 'plan', 'plan-copy'],
      chatCloneSources: { 'plan-copy': 'plan' },
    });
    expect(members.find((member) => member.chatName === 'plan-copy')?.sourceNodeId).toBe(nodeId('plan'));
    const planned = planDroneBoardPlacements({ members, nodesById: { [nodeId('plan')]: { x: 300, y: 200 } } });
    const clone = planned.find((node) => node.droneId === nodeId('plan-copy'))!;
    expect(clone.x).toBeGreaterThan(300);
    expect(clone.y).toBe(200);
  });

  test('has no members without a drone', () => {
    expect(buildDroneBoardMembers(null)).toEqual([]);
  });
});

describe('drone board placement', () => {
  test('lays out a first visit without overlaps and keeps forks beside their source', () => {
    const members = buildDroneBoardMembers({
      id: 'alpha',
      chats: ['default', 'plan'],
      sideChats: [
        { name: 'side-1', sourceChatName: 'plan', checkpointId: 'c1', agent },
        { name: 'side-2', sourceChatName: 'plan', checkpointId: 'c2', agent },
      ],
    });
    const planned = planDroneBoardPlacements({ members, nodesById: {} });
    expect(planned.map((node) => node.droneId).sort()).toEqual(members.map((member) => member.nodeId).sort());
    for (let i = 0; i < planned.length; i += 1) {
      for (let j = i + 1; j < planned.length; j += 1) expect(overlaps(planned[i], planned[j])).toBe(false);
    }
    const byId = Object.fromEntries(planned.map((node) => [node.droneId, node]));
    expect(byId[nodeId('side-1')].x).toBeGreaterThan(byId[nodeId('plan')].x);
    expect(byId[nodeId('side-1')].y).toBe(byId[nodeId('plan')].y);
    expect(byId[nodeId('side-2')].y).toBeGreaterThan(byId[nodeId('side-1')].y);
  });

  test('leaves positioned chats alone and only places newcomers', () => {
    const members = buildDroneBoardMembers({ id: 'alpha', chats: ['default', 'new-chat'] });
    const planned = planDroneBoardPlacements({
      members,
      nodesById: { [nodeId('default')]: { x: 400, y: 300 } },
      rootAnchor: { x: 400, y: 300 },
    });
    expect(planned).toHaveLength(1);
    expect(planned[0].droneId).toBe(nodeId('new-chat'));
    expect(overlaps(planned[0], { x: 400, y: 300 })).toBe(false);
  });

  test('places a side chat whose source is gone instead of waiting forever', () => {
    const members = buildDroneBoardMembers({
      id: 'alpha',
      chats: ['default'],
      sideChats: [{ name: 'side-1', sourceChatName: 'deleted', checkpointId: 'c1', agent }],
    });
    expect(planDroneBoardPlacements({ members, nodesById: {} })).toHaveLength(2);
  });
});

describe('canvas boards in the store', () => {
  beforeEach(() => {
    useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, optimisticMembersByDroneId: {} });
  });

  test('keeps a drone board separate from the global board', () => {
    getCanvasBoardActions('alpha').upsertNodes([{ droneId: nodeId('default'), label: 'default', x: 10, y: 20 }]);
    const state = useDroneCanvasStore.getState();
    expect(state.nodeOrder).toEqual([]);
    expect(selectCanvasBoard(state, 'alpha').nodesByDroneId[nodeId('default')]).toMatchObject({ x: 10, y: 20 });
    expect(selectCanvasBoard(state, 'beta')).toBe(EMPTY_CANVAS_BOARD);

    state.upsertNodes([{ droneId: nodeId('plan'), label: 'plan', x: 1, y: 2 }]);
    expect(useDroneCanvasStore.getState().nodeOrder).toEqual([nodeId('plan')]);
    expect(selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha').nodeOrder).toEqual([nodeId('default')]);
  });

  test('drops a board with its drone', () => {
    getCanvasBoardActions('alpha').upsertNodes([{ droneId: nodeId('default'), label: 'default', x: 0, y: 0 }]);
    useDroneCanvasStore.getState().removeDroneBoards(['alpha']);
    expect(useDroneCanvasStore.getState().droneBoards).toEqual({});
  });

  test('puts a cloned chat beside its source on the drone board', () => {
    getCanvasBoardActions('alpha').upsertNodes([{ droneId: nodeId('plan'), label: 'plan', x: 100, y: 100 }]);
    expect(placeClonedChatOnDroneBoard('alpha', 'plan', 'plan-copy')).toBe(nodeId('plan-copy'));
    const board = selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha');
    const clone = board.nodesByDroneId[nodeId('plan-copy')];
    expect(clone.x).toBeGreaterThan(100);
    expect(clone.y).toBe(100);

    placeClonedChatOnDroneBoard('alpha', 'plan', 'plan-copy-2');
    const second = selectCanvasBoard(useDroneCanvasStore.getState(), 'alpha').nodesByDroneId[nodeId('plan-copy-2')];
    expect(overlaps(second, clone)).toBe(false);
  });

  test('honours an explicit paste position and makes the chat a board member before the summary has it', () => {
    getCanvasBoardActions('alpha').upsertNodes([{ droneId: nodeId('plan'), label: 'plan', x: 100, y: 100 }]);
    placeClonedChatOnDroneBoard('alpha', 'plan', 'pasted', { position: { x: 900, y: 40 } });
    placeClonedChatOnDroneBoard('alpha', 'plan', 'side-9', { sideChat: true });
    const state = useDroneCanvasStore.getState();
    expect(selectCanvasBoard(state, 'alpha').nodesByDroneId[nodeId('pasted')]).toMatchObject({ x: 900, y: 40 });

    const optimistic = state.optimisticMembersByDroneId.alpha;
    const members = buildDroneBoardMembers({ id: 'alpha', chats: ['default', 'plan'] }, optimistic);
    expect(members.map((member) => member.chatName)).toEqual(['default', 'plan', 'pasted', 'side-9']);
    expect(members[3].sourceNodeId).toBe(nodeId('plan'));
    // A chat that never materialises does not linger.
    const later = Date.now() + 5 * 60_000;
    expect(buildDroneBoardMembers({ id: 'alpha', chats: ['default'] }, optimistic, later)).toHaveLength(1);

    state.dropOptimisticBoardMembers('alpha', ['pasted', 'side-9']);
    expect(useDroneCanvasStore.getState().optimisticMembersByDroneId).toEqual({});
  });

  test('leaves placement to the board when the source was never laid out', () => {
    expect(placeClonedChatOnDroneBoard('alpha', 'plan', 'plan-copy')).toBeNull();
    expect(useDroneCanvasStore.getState().droneBoards).toEqual({});
  });
});

describe('chat fork edges', () => {
  test('draws an edge from a source chat to its fork', () => {
    const edges = buildCanvasRelationshipEdges({
      preferredNodeByDroneId: {},
      renderedNodeBoundsById: {},
      fallbackNodeBoundsById: {
        [nodeId('plan')]: { x: 0, y: 0, width: 96, height: 38 },
        [nodeId('side-1')]: { x: 200, y: 0, width: 96, height: 38 },
      },
      fleetParentIdByDroneId: {},
      fleetAssignedIdsByDroneId: {},
      forkSourceNodeIdByNodeId: { [nodeId('side-1')]: nodeId('plan'), [nodeId('side-2')]: nodeId('plan') },
    });
    expect(edges.map((edge) => edge.variant)).toEqual(['chat-fork']);
  });
});
