import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildSidebarChatDeleteConfirmation } from '../src/droneHub/app/sidebar-chat-delete-confirmation';

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
