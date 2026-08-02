import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('sidebar inline group editor', () => {
  test('keeps group create and rename editors visually inline', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );
    const groupedTreeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );

    for (const source of [sidebarSource, groupedTreeSource]) {
      expect(source).toContain('appearance-none rounded-none border-0 bg-transparent');
      expect(source).toContain("style={{ border: 0, outline: 'none', boxShadow: 'none' }}");
    }

    const groupDraftEditor = groupedTreeSource.slice(
      groupedTreeSource.indexOf('function GroupedSidebarGroupDraftRow()'),
      groupedTreeSource.indexOf('function GroupedSidebarChildEntries('),
    );
    expect(groupDraftEditor).toContain('data-sidebar-group-draft-input="true"');
    expect(groupDraftEditor).toContain('<IconChevron');
    expect(groupDraftEditor).not.toContain('<IconFolder');
    expect(groupDraftEditor).toContain('appearance-none rounded-none border-0 bg-transparent');
    expect(groupDraftEditor).not.toContain('border border-dashed');
    expect(groupDraftEditor).not.toContain('bg-[var(--panel-raised)]');
  });

  test('cancels group renaming when the editor loses focus', () => {
    const interactionsSource = readFileSync(
      new URL('../src/droneHub/app/use-sidebar-interactions.ts', import.meta.url),
      'utf8',
    );

    expect(interactionsSource).toContain("draft.mode === 'rename' || draft.dismissOnBlur");
    expect(interactionsSource).toContain('setFolderEditor(null)');
  });

  test('routes F2 to the selected group, drone, or chat inline editor', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );
    const cardSource = readFileSync(
      new URL('../src/droneHub/overview/DroneCard.tsx', import.meta.url),
      'utf8',
    );

    expect(sidebarSource).toContain("event.key === 'F2'");
    expect(sidebarSource).toContain('startRenameFolder(selectedFolderPath)');
    expect(sidebarSource).toContain(
      "sidebarChatRefFromNodeId(selectedSidebarNodeId ?? '')",
    );
    expect(sidebarSource).toContain('if (selectedChatRef) {');
    expect(sidebarSource).toContain("if (selectedChatRef.chatName !== 'default') {");
    expect(sidebarSource).toContain(
      'startRenameDroneChat(selectedChatRef.droneId, selectedChatRef.chatName)',
    );
    expect(sidebarSource).toContain(
      "sidebarDroneIdFromNodeId(selectedSidebarNodeId ?? '')",
    );
    expect(sidebarSource).toContain(
      "(!selectedFolderPath ? String(selectedDrone ?? '').trim() : '')",
    );
    expect(sidebarSource).toContain('requestInlineDroneRename(selectedDroneId)');
    expect(cardSource).toContain('inlineRenameRequestKey');
    expect(cardSource).toContain('setInlineRenameValue(shownName)');
    expect(cardSource).toContain('setInlineRenameOpen(true)');
  });
});
