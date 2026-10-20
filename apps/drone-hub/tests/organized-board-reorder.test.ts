import { describe, expect, test } from 'bun:test';
import { applySidebarMove, buildSidebarChatTree, flattenSidebarChatTreeChatNodeIds } from '@drone/hub-model/sidebar';
import { organizedChatMoveIntent } from '../src/droneHub/canvas/organized-board-reorder';

const layout = (groupByChat: Record<string, string> = {}, groupPaths: string[] = []) => ({
  droneId: 'alpha',
  chatNames: ['plan', 'notes', 'review', 'default'],
  groupPaths,
  groupByChat,
  nodeOrderByParent: {},
});

describe('organized board moves as sidebar moves', () => {
  test("a chat dropped after another is the sidebar's own move", () => {
    const intent = organizedChatMoveIntent({ ...layout(), activeChatName: 'default', overChatName: 'plan', placement: 'after' });
    expect(intent).toMatchObject({
      kind: 'chat-tree-move', droneId: 'alpha', itemKind: 'chat', activeNodeId: 'chat:alpha:default', overNodeId: 'chat:alpha:plan',
      placement: 'after', sourcePath: null, targetPath: null,
    });
  });

  test('beside a chat in a group it joins that group', () => {
    const intent = organizedChatMoveIntent({
      ...layout({ 'chat:alpha:review': 'Later' }, ['Later']), activeChatName: 'plan', overChatName: 'review', placement: 'before',
    });
    expect(intent).toMatchObject({ sourcePath: null, targetPath: 'Later', overNodeId: 'chat:alpha:review' });
  });

  test('applied like a sidebar drag, it reorders the chats', () => {
    const base = layout();
    const intent = organizedChatMoveIntent({ ...base, activeChatName: 'default', overChatName: 'plan', placement: 'before' })!;
    const next = applySidebarMove({
      sidebarChatOrderByDrone: { alpha: base.chatNames },
      sidebarChatGroupPathsByDrone: {},
      sidebarChatGroupByChat: {},
      sidebarChatNodeOrderByParent: {},
    } as never, intent) as unknown as { sidebarChatGroupByChat: Record<string, string>; sidebarChatNodeOrderByParent: Record<string, string[]>; sidebarChatOrderByDrone: Record<string, string[]> };
    const tree = buildSidebarChatTree({
      droneId: 'alpha',
      chatNames: base.chatNames,
      groupPaths: [],
      groupByChat: next.sidebarChatGroupByChat ?? {},
      nodeOrderByParent: next.sidebarChatNodeOrderByParent ?? {},
    });
    expect(flattenSidebarChatTreeChatNodeIds(tree)).toEqual(['chat:alpha:default', 'chat:alpha:plan', 'chat:alpha:notes', 'chat:alpha:review']);
  });

  test('a chat the sidebar does not list has no move', () => {
    expect(organizedChatMoveIntent({ ...layout(), activeChatName: 'new chat', overChatName: 'plan', placement: 'before' })).toBeNull();
    expect(organizedChatMoveIntent({ ...layout(), activeChatName: 'plan', overChatName: 'plan', placement: 'before' })).toBeNull();
  });
});
