import { beforeEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CanvasTopicDeleteDialog } from '../src/droneHub/canvas/CanvasTopicSwitcher';
import { createCanvasChatNodeId, createCanvasDroneNodeId } from '../src/droneHub/app/app-config';
import { buildDroneBoardMembers, planTopicBoardPlacements } from '../src/droneHub/canvas/drone-board';
import {
  EMPTY_CANVAS_BOARD,
  getCanvasBoardActions,
  selectCanvasBoard,
  topicBoardKey,
  useDroneCanvasStore,
} from '../src/droneHub/canvas/use-drone-canvas-store';

const store = () => useDroneCanvasStore.getState();
const topic = (id: string) => store().topics.find((item) => item.id === id);

beforeEach(() => {
  useDroneCanvasStore.setState({ ...EMPTY_CANVAS_BOARD, droneBoards: {}, scope: 'drone', topics: [], activeTopicId: null });
});

describe('canvas topics', () => {
  test('a new topic opens with the given repository and a free name', () => {
    const first = store().createTopic({ repoPath: '/work/drone' });
    expect(store().scope).toBe('topic');
    expect(store().activeTopicId).toBe(first);
    expect(topic(first)).toMatchObject({ name: 'Topic 1', repoPath: '/work/drone', droneIds: [] });
    store().renameTopic(first, 'Topic 2');
    const second = store().createTopic();
    expect(topic(second)?.name).toBe('Topic 3');
    store().renameTopic(second, '   ');
    expect(topic(second)?.name).toBe('Topic 3');
  });

  test('a drone can be in several topics, and leaving one keeps it in the others', () => {
    const a = store().createTopic();
    const b = store().createTopic();
    store().addDronesToTopic(a, ['alpha', 'beta', 'alpha']);
    store().addDronesToTopic(b, ['alpha']);
    expect(topic(a)?.droneIds).toEqual(['alpha', 'beta']);
    store().removeDronesFromTopic(a, ['alpha']);
    expect(topic(a)?.droneIds).toEqual(['beta']);
    expect(topic(b)?.droneIds).toEqual(['alpha']);
  });

  test('a deleted drone leaves every topic; a deleted topic takes only its layout', () => {
    const a = store().createTopic({ droneIds: ['alpha', 'beta'] });
    const b = store().createTopic({ droneIds: ['alpha'] });
    getCanvasBoardActions(topicBoardKey(a)).upsertNodes([{ droneId: createCanvasDroneNodeId('beta'), label: 'Beta', x: 0, y: 0 }]);
    store().removeDroneBoards(['alpha']);
    expect(topic(a)?.droneIds).toEqual(['beta']);
    expect(topic(b)?.droneIds).toEqual([]);
    expect(selectCanvasBoard(store(), topicBoardKey(a)).nodeOrder).toEqual([createCanvasDroneNodeId('beta')]);

    store().openTopic(a);
    store().deleteTopic(a);
    expect(topic(a)).toBeUndefined();
    expect(store().droneBoards[topicBoardKey(a)]).toBeUndefined();
    // Deleting the open topic goes back to the global board.
    expect(store().scope).toBe('global');
    expect(store().activeTopicId).toBeNull();
  });

  test('a stored topic scope without its topic opens the drone board', async () => {
    const id = store().createTopic({ name: 'Auth', droneIds: ['alpha'], repoPath: '/work/drone' });
    const persisted = { state: { scope: 'topic', activeTopicId: 'gone', topics: store().topics }, version: 3 };
    const merged = useDroneCanvasStore.persist.getOptions().merge!(persisted.state, store());
    expect(merged.scope).toBe('drone');
    expect(merged.topics).toEqual([{ id, name: 'Auth', droneIds: ['alpha'], repoPath: '/work/drone' }]);
    expect(merged.activeTopicId).toBeNull();
  });
});

describe('topic layout', () => {
  const width = () => 120;
  test('each drone gets a card with its chats below it, clear of what is already there', () => {
    const alpha = buildDroneBoardMembers({ id: 'alpha', chats: ['default', 'plan'] });
    const beta = buildDroneBoardMembers({ id: 'beta', chats: ['default'] });
    const occupied = { [createCanvasDroneNodeId('gamma')]: { x: 0, y: 0, label: 'Gamma' } };
    const planned = planTopicBoardPlacements({
      drones: [
        { droneId: 'alpha', label: 'Alpha', width: 120, members: alpha },
        { droneId: 'beta', label: 'Beta', width: 120, members: beta },
      ],
      nodesById: occupied,
      anchor: { x: 0, y: 0 },
      widthOf: width,
    });
    const at = (id: string) => planned.find((node) => node.droneId === id)!;
    const alphaCard = at(createCanvasDroneNodeId('alpha'));
    expect(alphaCard.y).toBeGreaterThan(0); // Below Gamma, not on top of it.
    const alphaDefault = at(createCanvasChatNodeId('alpha', 'default'));
    expect(alphaDefault.y).toBeGreaterThan(alphaCard.y);
    expect(alphaDefault.x).toBeGreaterThan(alphaCard.x);
    const ys = planned.map((node) => `${node.x}:${node.y}`);
    expect(new Set(ys).size).toBe(ys.length);
  });

  test('a new drone whose first chat is placed gets its card just above that chat', () => {
    const members = buildDroneBoardMembers({ id: 'alpha', chats: ['default'] });
    const planned = planTopicBoardPlacements({
      drones: [{ droneId: 'alpha', label: 'Alpha', width: 120, members }],
      nodesById: { [createCanvasChatNodeId('alpha', 'default')]: { x: 300, y: 200, label: 'default' } },
      anchor: { x: 0, y: 0 },
      widthOf: width,
    });
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ droneId: createCanvasDroneNodeId('alpha'), x: 300 });
    expect(planned[0].y).toBeLessThan(200);
  });
});

describe('deleting a topic', () => {
  const auth = { id: 'auth', name: 'Auth', droneIds: ['alpha', 'beta', 'gone'], repoPath: '' };
  const render = (props: Partial<React.ComponentProps<typeof CanvasTopicDeleteDialog>>) => renderToStaticMarkup(
    <CanvasTopicDeleteDialog topic={auth} topics={[auth]} droneNameById={{ alpha: 'Alpha', beta: 'Beta' }} deleteMode="archive"
      onDeleteTopic={() => {}} onDeleteTopicAndDrones={() => {}} onCancel={() => {}} {...props} />,
  );

  test('offers the topic alone, or its drones too, archived or deleted as the delete setting says', () => {
    const html = render({});
    expect(html).toContain('Delete topic only');
    // A drone deleted since it was added is not counted.
    expect(html).toContain('Archive 2 drones too');
    expect(html).toContain('Alpha, Beta');
    expect(html).toContain('restored from Settings &gt; Archive');
    expect(html).not.toContain('also in other topics');
    const permanent = render({ deleteMode: 'permanent' });
    expect(permanent).toContain('Delete 2 drones too');
    expect(permanent).not.toContain('Settings &gt; Archive');
  });

  test('says which drones other topics would lose', () => {
    const other = { id: 'other', name: 'Other', droneIds: ['beta'], repoPath: '' };
    expect(render({ topics: [auth, other] })).toContain('1 of them is also in other topics, which would lose it too.');
  });

  test('a topic with no drones, or no way to delete them, offers only the topic', () => {
    expect(render({ topic: { ...auth, droneIds: [] } })).not.toContain('drones too');
    expect(render({ onDeleteTopicAndDrones: undefined })).not.toContain('drones too');
  });
});
