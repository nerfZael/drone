import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  buildSidebarChatDeleteConfirmation,
  buildSidebarChatGroupDeleteConfirmation,
} from '../src/droneHub/app/sidebar-chat-delete-confirmation';

describe('sidebar chat delete confirmation', () => {
  test('describes one permanent chat deletion', () => {
    expect(buildSidebarChatDeleteConfirmation({
      chatNames: ['review'],
      droneLabel: 'Alpha',
      deleteMode: 'permanent',
    })).toEqual({
      title: 'Delete chat?',
      message: 'Delete chat “review” from “Alpha”?',
      confirmLabel: 'Delete chat',
      destructive: true,
    });
  });

  test('describes one bulk archive confirmation and keeps default', () => {
    const confirmation = buildSidebarChatDeleteConfirmation({
      chatNames: ['review', 'planning'],
      droneLabel: 'Alpha',
      deleteMode: 'archive',
      defaultChatKept: true,
    });

    expect(confirmation.title).toBe('Archive 2 chats?');
    expect(confirmation.message).toContain('Archive 2 selected chats from “Alpha”?');
    expect(confirmation.message).toContain('restore archived chats');
    expect(confirmation.message).toContain('The default chat will be kept.');
    expect(confirmation.confirmLabel).toBe('Archive chats');
  });

  test('distinguishes archived chats from permanently deleted drafts', () => {
    expect(buildSidebarChatDeleteConfirmation({
      chatNames: ['review', 'scratch'],
      draftChatNames: ['scratch'],
      droneLabel: 'Alpha',
      deleteMode: 'archive',
    })).toEqual({
      title: 'Archive and delete 2 chats?',
      message: 'Archive 1 chat and permanently delete 1 draft chat from “Alpha”? You can restore archived chats from Settings > Archive before they auto-delete.',
      confirmLabel: 'Archive and delete',
      destructive: true,
    });
  });

  test('describes deleting chats in a group while preserving its hierarchy', () => {
    expect(buildSidebarChatGroupDeleteConfirmation({
      chatCount: 3,
      groupLabel: 'Review',
      droneLabel: 'Alpha',
      deleteMode: 'permanent',
      defaultChatKept: true,
    })).toEqual({
      title: 'Delete chats in “Review”?',
      message: 'Delete all 3 chats in this group and its subgroups from “Alpha”? The group and its subgroups are not deleted. The default chat will be kept.',
      confirmLabel: 'Delete chats',
      destructive: true,
    });
  });

  test('offers group chat deletion before deleting the group itself', () => {
    const treeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );
    const groupActionIndex = treeSource.indexOf("label: 'Delete chats in group'");
    const deleteGroupIndex = treeSource.indexOf("label: 'Delete group'", groupActionIndex);

    expect(groupActionIndex).toBeGreaterThan(-1);
    expect(deleteGroupIndex).toBeGreaterThan(groupActionIndex);
    expect(treeSource).toContain('sidebarChatTreeChatNamesInGroup(tree, groupNodeId)');
    expect(treeSource).toContain('await confirmDelete(buildSidebarChatGroupDeleteConfirmation({');
    expect(treeSource).toContain("chatName !== 'default'");
    expect(treeSource).toContain("label: directlyMuted ? 'Unmute group' : 'Mute group'");
    expect(treeSource).not.toContain("id: 'visibility'");
    expect(sidebarSource).not.toContain('Show hidden groups');
  });

  test('bulk deletion confirms once with the app dialog', () => {
    const treeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );
    const bulkDeleteFlow = treeSource.slice(
      treeSource.indexOf('const deleteSelectedChats'),
      treeSource.indexOf('React.useEffect(() => {', treeSource.indexOf('const deleteSelectedChats')),
    );
    expect(bulkDeleteFlow).toContain('await confirmDelete(');
    expect(bulkDeleteFlow).toContain('{ confirmed: true }');
    expect(bulkDeleteFlow).not.toContain('window.confirm');

    const modelSource = readFileSync(
      new URL('../src/use-drone-hub-app-model.tsx', import.meta.url),
      'utf8',
    );
    const singleDeleteFlow = modelSource.slice(
      modelSource.indexOf('const deleteCanvasChat'),
      modelSource.indexOf('const renderRightPanelTabContent'),
    );
    expect(singleDeleteFlow).toContain('opts?.confirmed !== true');
    expect(singleDeleteFlow).toContain('await confirmDelete(');
    expect(singleDeleteFlow).not.toContain('window.confirm');
  });
});
