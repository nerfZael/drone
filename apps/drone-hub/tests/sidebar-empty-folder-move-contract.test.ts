import { describe, expect, test } from 'bun:test';
import {
  buildRepoSidebarModel,
  buildSidebarRepoScopedGroupIndex,
  SIDEBAR_ROOT_PARENT_ID,
  sidebarFolderNodeId,
} from '@drone/hub-model/sidebar';
import { parseSidebarMoveCommandRequest } from '@drone/device-protocol';
import { SidebarCommandService } from '../../drone/src/hub/sidebar-command-service';
import { parseDroneHubDragData } from '../src/droneHub/app/drone-hub-dnd';
import { planSidebarDrop } from '../src/droneHub/app/sidebar-drop-plan';
import type { SidebarNodeTreeModel } from '../src/droneHub/app/sidebar-node-tree';

describe('empty folder move contract', () => {
  test('carries canonical identity from drag payload through the rendered result', async () => {
    const repoPath = '/work/repo';
    const repoGroupPath = `repo:${repoPath}`;
    const sourceNodeId = sidebarFolderNodeId('Experiments');
    const targetNodeId = sidebarFolderNodeId('Bug Finding');
    const nodeTree: SidebarNodeTreeModel = {
      nodesById: {
        [sourceNodeId]: {
          id: sourceNodeId,
          kind: 'folder',
          path: 'Experiments',
          groupPath: 'Experiments',
          groupId: 'group-experiments',
          repoGroupPath,
          label: 'Experiments',
          groupKind: 'group',
          parentId: SIDEBAR_ROOT_PARENT_ID,
          depth: 0,
          totalDroneCount: 0,
          directDroneCount: 0,
        },
        [targetNodeId]: {
          id: targetNodeId,
          kind: 'folder',
          path: 'Bug Finding',
          groupPath: 'Bug Finding',
          groupId: 'group-bugs',
          repoGroupPath,
          label: 'Bug Finding',
          groupKind: 'group',
          parentId: SIDEBAR_ROOT_PARENT_ID,
          depth: 0,
          totalDroneCount: 0,
          directDroneCount: 0,
        },
      },
      childIdsByParent: {
        [SIDEBAR_ROOT_PARENT_ID]: [sourceNodeId, targetNodeId],
        [sourceNodeId]: [],
        [targetNodeId]: [],
      },
      rootChildIds: [sourceNodeId, targetNodeId],
      folderNodeByPath: {},
    };
    const drag = parseDroneHubDragData({
      type: 'sidebar-folder',
      groupId: 'group-experiments',
      folderNodeId: sourceNodeId,
      folderPath: 'Experiments',
      groupKind: 'group',
      label: 'Experiments',
    });
    const plan = planSidebarDrop({
      active: drag,
      target: {
        kind: 'folder-body',
        folderNodeId: targetNodeId,
        insertionTarget: null,
      },
      nodeTree,
      droneById: {},
      sidebarChatOrderByDrone: {},
    });
    const command = parseSidebarMoveCommandRequest({
      mutationId: 'vertical-empty-folder-move',
      intent: plan?.intent,
    });

    let canonicalGroups = [
      {
        id: 'group-bugs',
        repoPath,
        name: 'Bug Finding',
        createdAt: '2026-08-20T09:04:42Z',
      },
      {
        id: 'group-experiments',
        repoPath,
        name: 'Experiments',
        createdAt: '2026-08-20T09:04:49Z',
      },
    ];
    let uiPreferences: Record<string, unknown> = {
      sidebarNodeOrderByParent: {
        root: [sourceNodeId, targetNodeId],
        [targetNodeId]: [],
      },
    };
    const service = new SidebarCommandService({
      setDroneParent: async () => ({ ok: true }),
      setDroneGroup: async () => ({ ok: true, moved: [], rejected: [] }),
      renameGroup: async ({ groupRef, newName }) => {
        const source = canonicalGroups.find((group) => group.id === groupRef);
        if (!source) throw new Error(`unknown group: ${groupRef}`);
        canonicalGroups = canonicalGroups.map((group) =>
          group.id === groupRef ? { ...group, name: newName } : group,
        );
        return {
          ok: true,
          id: source.id,
          repoPath: source.repoPath,
          oldName: source.name,
          newName,
          renamed: true,
        };
      },
      readUiPreferences: async () => ({ version: 3, uiPreferences }),
      writeUiPreferences: async ({ uiPreferences: next }) => {
        uiPreferences = next;
        return { version: 4, uiPreferences };
      },
    });

    const result = await service.move(command);

    expect(command.intent).toMatchObject({
      itemKind: 'folder',
      sourceGroupId: 'group-experiments',
      repoPath,
    });
    expect(result).toMatchObject({
      ok: true,
      stages: {
        membership: { status: 'applied' },
        layout: { status: 'applied' },
      },
      canonical: {
        group: {
          id: 'group-experiments',
          repoPath,
          name: 'Bug Finding/Experiments',
        },
        sidebar: { version: 4 },
      },
    });

    const canonicalIndex = buildSidebarRepoScopedGroupIndex(canonicalGroups);
    const rendered = buildRepoSidebarModel({
      drones: [],
      registeredRepoPaths: [repoPath],
      sidebarGroupOrder: [],
      sidebarDroneOrderByGroup: {},
      sidebarNodeOrderByParent: result.ok
        ? result.uiPreferences.sidebarNodeOrderByParent
        : {},
      repoScopedGroupPathsByRepoGroup: canonicalIndex.pathsByRepoGroup,
      repoScopedGroupIdByPathByRepoGroup: canonicalIndex.idsByPathByRepoGroup,
      repoScopedGroupCreatedAtByPathByRepoGroup:
        canonicalIndex.createdAtByPathByRepoGroup,
    });
    const renderedFolders = Object.values(rendered.nodeTree.nodesById).filter(
      (node) => node.kind === 'folder' && node.repoGroupPath === repoGroupPath,
    );
    const movedFolder = renderedFolders.find(
      (node) => node.groupPath === 'Bug Finding/Experiments',
    );
    const parentFolder = renderedFolders.find((node) => node.groupPath === 'Bug Finding');
    expect(parentFolder).toBeDefined();
    expect(movedFolder).toMatchObject({
      groupId: 'group-experiments',
      groupPath: 'Bug Finding/Experiments',
      parentId: parentFolder!.id,
    });
  });
});
