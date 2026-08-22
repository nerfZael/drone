import { describe, expect, test } from 'bun:test';
import {
  applySidebarMove,
  buildSidebarChatTree,
  flattenSidebarChatTreeChatNodeIds,
  normalizeSidebarLayout,
  sidebarChatGroupNodeId,
  sidebarChatNodeId,
  sidebarChatRootNodeId,
} from '../src/sidebar';

describe('sidebar chat groups', () => {
  test('builds nested folders and leaves legacy chats at the drone root', () => {
    const tree = buildSidebarChatTree({
      droneId: 'alpha',
      chatNames: ['default', 'api', 'review'],
      groupPaths: ['Work/Backend'],
      groupByChat: {
        [sidebarChatNodeId('alpha', 'api')]: 'Work/Backend',
      },
      nodeOrderByParent: {
        [sidebarChatRootNodeId('alpha')]: [
          sidebarChatGroupNodeId('alpha', 'Work'),
          sidebarChatNodeId('alpha', 'review'),
          sidebarChatNodeId('alpha', 'default'),
        ],
      },
    });
    expect(tree.rootChildIds).toEqual([
      sidebarChatGroupNodeId('alpha', 'Work'),
      sidebarChatNodeId('alpha', 'review'),
      sidebarChatNodeId('alpha', 'default'),
    ]);
    expect(tree.childIdsByParent[sidebarChatGroupNodeId('alpha', 'Work')]).toEqual([
      sidebarChatGroupNodeId('alpha', 'Work/Backend'),
    ]);
    expect(tree.childIdsByParent[sidebarChatGroupNodeId('alpha', 'Work/Backend')]).toEqual([
      sidebarChatNodeId('alpha', 'api'),
    ]);
    expect(flattenSidebarChatTreeChatNodeIds(tree)).toEqual([
      sidebarChatNodeId('alpha', 'api'),
      sidebarChatNodeId('alpha', 'review'),
      sidebarChatNodeId('alpha', 'default'),
    ]);
  });

  test('moves multiple selected chats into a folder while preserving selection order', () => {
    const rootId = sidebarChatRootNodeId('alpha');
    const folderId = sidebarChatGroupNodeId('alpha', 'Work');
    const defaultId = sidebarChatNodeId('alpha', 'default');
    const apiId = sidebarChatNodeId('alpha', 'api');
    const reviewId = sidebarChatNodeId('alpha', 'review');
    const next = applySidebarMove(
      normalizeSidebarLayout({
        sidebarChatGroupPathsByDrone: { alpha: ['Work'] },
        sidebarChatNodeOrderByParent: {
          [rootId]: [defaultId, apiId, reviewId, folderId],
        },
      }),
      {
        kind: 'chat-tree-move',
        droneId: 'alpha',
        itemKind: 'chat',
        activeNodeId: apiId,
        activeNodeIds: [apiId, reviewId],
        sourcePath: null,
        sourceSiblingNodeIds: [defaultId, apiId, reviewId, folderId],
        targetPath: 'Work',
        targetSiblingNodeIds: [],
        placement: 'inside',
      },
    );
    expect(next.sidebarChatGroupByChat).toEqual({
      [apiId]: 'Work',
      [reviewId]: 'Work',
    });
    expect(next.sidebarChatNodeOrderByParent[rootId]).toEqual([defaultId, folderId]);
    expect(next.sidebarChatNodeOrderByParent[folderId]).toEqual([apiId, reviewId]);
  });

  test('renames a group subtree and flattens chats when it is deleted', () => {
    const apiId = sidebarChatNodeId('alpha', 'api');
    let layout = normalizeSidebarLayout({
      sidebarChatGroupPathsByDrone: { alpha: ['Work', 'Work/Backend'] },
      sidebarChatGroupByChat: { [apiId]: 'Work/Backend' },
    });
    layout = applySidebarMove(layout, {
      kind: 'chat-group-rename',
      droneId: 'alpha',
      path: 'Work',
      newPath: 'Projects',
    });
    expect(layout.sidebarChatGroupPathsByDrone.alpha).toEqual([
      'Projects',
      'Projects/Backend',
    ]);
    expect(layout.sidebarChatGroupByChat[apiId]).toBe('Projects/Backend');
    layout = applySidebarMove(layout, {
      kind: 'chat-group-delete',
      droneId: 'alpha',
      path: 'Projects/Backend',
    });
    expect(layout.sidebarChatGroupPathsByDrone.alpha).toEqual(['Projects']);
    expect(layout.sidebarChatGroupByChat[apiId]).toBe('Projects');
  });

  test('materializes inferred parents before mutating a nested group', () => {
    const apiId = sidebarChatNodeId('alpha', 'api');
    const layout = applySidebarMove(
      normalizeSidebarLayout({
        sidebarChatGroupPathsByDrone: { alpha: ['Work/Backend'] },
        sidebarChatGroupByChat: { [apiId]: 'Work/Backend' },
      }),
      { kind: 'chat-group-delete', droneId: 'alpha', path: 'Work' },
    );
    expect(layout.sidebarChatGroupPathsByDrone.alpha).toEqual([]);
    expect(layout.sidebarChatGroupByChat[apiId]).toBeUndefined();
  });

  test('removes stale chat placement after rename or deletion', () => {
    const apiId = sidebarChatNodeId('alpha', 'api');
    const folderId = sidebarChatGroupNodeId('alpha', 'Work');
    const layout = applySidebarMove(
      normalizeSidebarLayout({
        sidebarChatGroupPathsByDrone: { alpha: ['Work'] },
        sidebarChatGroupByChat: { [apiId]: 'Work' },
        sidebarChatNodeOrderByParent: { [folderId]: [apiId] },
      }),
      { kind: 'chat-tree-remove', droneId: 'alpha', nodeIds: [apiId] },
    );
    expect(layout.sidebarChatGroupByChat[apiId]).toBeUndefined();
    expect(layout.sidebarChatNodeOrderByParent[folderId]).toBeUndefined();
    expect(layout.sidebarChatGroupPathsByDrone.alpha).toEqual(['Work']);
  });

  test('does not remove chat placement owned by another drone', () => {
    const layout = normalizeSidebarLayout({
      sidebarChatGroupByChat: {
        'chat:drone-a:one': 'Work',
        'chat:drone-b:two': 'Elsewhere',
      },
      sidebarChatNodeOrderByParent: {
        'chat-folder:drone-a:Work': ['chat:drone-a:one'],
        'chat-folder:drone-b:Elsewhere': ['chat:drone-b:two'],
      },
    });

    const result = applySidebarMove(layout, {
      kind: 'chat-tree-remove',
      droneId: 'drone-a',
      nodeIds: ['chat:drone-a:one', 'chat:drone-b:two'],
    });

    expect(result.sidebarChatGroupByChat).toEqual({
      'chat:drone-b:two': 'Elsewhere',
    });
    expect(result.sidebarChatNodeOrderByParent).toEqual({
      'chat-folder:drone-b:Elsewhere': ['chat:drone-b:two'],
    });
  });

  test('preserves a grouped chat position while its node id is replaced after rename', () => {
    const folderId = sidebarChatGroupNodeId('alpha', 'Work');
    const firstId = sidebarChatNodeId('alpha', 'first');
    const oldId = sidebarChatNodeId('alpha', 'old-name');
    const nextId = sidebarChatNodeId('alpha', 'new-name');
    const lastId = sidebarChatNodeId('alpha', 'last');
    let layout = normalizeSidebarLayout({
      sidebarChatGroupPathsByDrone: { alpha: ['Work'] },
      sidebarChatGroupByChat: { [oldId]: 'Work' },
      sidebarChatNodeOrderByParent: { [folderId]: [firstId, oldId, lastId] },
    });

    layout = applySidebarMove(layout, {
      kind: 'chat-tree-move',
      droneId: 'alpha',
      itemKind: 'chat',
      activeNodeId: nextId,
      sourcePath: null,
      sourceSiblingNodeIds: [nextId],
      targetPath: 'Work',
      targetSiblingNodeIds: [firstId, oldId, lastId],
      overNodeId: oldId,
      placement: 'before',
    });
    layout = applySidebarMove(layout, {
      kind: 'chat-tree-remove',
      droneId: 'alpha',
      nodeIds: [oldId],
    });

    expect(layout.sidebarChatGroupByChat).toEqual({ [nextId]: 'Work' });
    expect(layout.sidebarChatNodeOrderByParent[folderId]).toEqual([
      firstId,
      nextId,
      lastId,
    ]);
  });

  test('rejects moving a chat group into its own descendant', () => {
    const layout = normalizeSidebarLayout({
      sidebarChatGroupPathsByDrone: { alpha: ['Work', 'Work/Backend'] },
    });
    const next = applySidebarMove(layout, {
      kind: 'chat-tree-move',
      droneId: 'alpha',
      itemKind: 'folder',
      activeNodeId: sidebarChatGroupNodeId('alpha', 'Work'),
      sourcePath: null,
      sourceSiblingNodeIds: [sidebarChatGroupNodeId('alpha', 'Work')],
      targetPath: 'Work/Backend',
      targetSiblingNodeIds: [],
      placement: 'inside',
    });
    expect(next).toBe(layout);
  });

  test('keeps flattened chats where the deleted group appeared', () => {
    const rootId = sidebarChatRootNodeId('alpha');
    const workId = sidebarChatGroupNodeId('alpha', 'Work');
    const backendId = sidebarChatGroupNodeId('alpha', 'Work/Backend');
    const beforeId = sidebarChatNodeId('alpha', 'before');
    const apiId = sidebarChatNodeId('alpha', 'api');
    const reviewId = sidebarChatNodeId('alpha', 'review');
    const afterId = sidebarChatNodeId('alpha', 'after');
    const layout = applySidebarMove(
      normalizeSidebarLayout({
        sidebarChatGroupPathsByDrone: { alpha: ['Work', 'Work/Backend'] },
        sidebarChatGroupByChat: {
          [apiId]: 'Work/Backend',
          [reviewId]: 'Work',
        },
        sidebarChatNodeOrderByParent: {
          [rootId]: [beforeId, workId, afterId],
          [workId]: [backendId, reviewId],
          [backendId]: [apiId],
        },
      }),
      { kind: 'chat-group-delete', droneId: 'alpha', path: 'Work' },
    );
    expect(layout.sidebarChatNodeOrderByParent[rootId]).toEqual([
      beforeId,
      apiId,
      reviewId,
      afterId,
    ]);
  });

  test('rejects chat node ids from another drone', () => {
    const layout = normalizeSidebarLayout({
      sidebarChatGroupPathsByDrone: { alpha: ['Work'] },
    });
    const next = applySidebarMove(layout, {
      kind: 'chat-tree-move',
      droneId: 'alpha',
      itemKind: 'chat',
      activeNodeId: sidebarChatNodeId('bravo', 'review'),
      sourcePath: null,
      sourceSiblingNodeIds: [],
      targetPath: 'Work',
      targetSiblingNodeIds: [],
      placement: 'inside',
    });
    expect(next).toBe(layout);
  });
});
