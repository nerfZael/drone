import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('sidebar inline group editor', () => {
  test('keeps group create and rename editors visually inline', () => {
    const groupedTreeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );

    expect(groupedTreeSource).toContain('appearance-none rounded-none border-0 bg-transparent');
    expect(groupedTreeSource).toContain("style={{ border: 0, outline: 'none', boxShadow: 'none' }}");

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
    expect(sidebarSource).toContain("event.target, '[data-chat-surface=\"true\"]'");
    expect(sidebarSource).toContain(
      "event.target, '[role=\"tree\"][aria-label=\"File Explorer\"]'",
    );
    expect(sidebarSource).toContain("document.querySelector('[data-chat-surface=\"true\"]:hover')");
    expect(sidebarSource).toContain('chatTargeted || (!sidebarTargeted && chatHovered)');
    expect(sidebarSource).toContain('sidebarTargeted || (!chatContext && sidebarHovered)');
    expect(sidebarSource).toContain('resolveAgentChatF2RenameTarget({');
    expect(sidebarSource).toContain('(editableTarget && !chatContext)');
    expect(sidebarSource).toContain(
      "document.querySelector('[role=\"dialog\"][aria-modal=\"true\"]')",
    );
    expect(sidebarSource).toContain('setSidebarCollapsed(false)');
    expect(sidebarSource).toContain('event.stopPropagation()');
    expect(sidebarSource).toContain("if (renameTarget.kind === 'chat') {");
    expect(sidebarSource).toContain(
      'startRenameDroneChat(renameTarget.droneId, renameTarget.chatName)',
    );
    expect(sidebarSource).toContain("window.addEventListener('keydown', onKeyDown, true)");
    expect(cardSource).toContain('inlineRenameRequestKey');
    expect(cardSource).toContain('setInlineRenameValue(shownName)');
    expect(cardSource).toContain('setInlineRenameOpen(true)');
  });

  test('keeps chat and group rename controls within their existing row geometry', () => {
    const groupedTreeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );
    const chatRenameEditor = groupedTreeSource.slice(
      groupedTreeSource.indexOf('if (editing) {'),
      groupedTreeSource.indexOf("id: 'rename-chat'"),
    );

    expect(chatRenameEditor).toContain('sidebarChatRowTone({ selected, active })');
    expect(chatRenameEditor).toContain('sidebarChatStateClass');
    expect(chatRenameEditor).toContain('appearance-none rounded-none border-0 bg-transparent p-0');
    expect(chatRenameEditor).toContain("style={{ border: 0, outline: 'none', boxShadow: 'none' }}");
    expect(chatRenameEditor).not.toContain('bg-[var(--panel-overlay-soft)]');
    expect(chatRenameEditor).not.toContain("chatEditor?.error ? <div");

    const groupRenameEditor = groupedTreeSource.slice(
      groupedTreeSource.indexOf('showEditorInline && folderEditor'),
      groupedTreeSource.indexOf(') : (', groupedTreeSource.indexOf('showEditorInline && folderEditor')),
    );
    expect(groupRenameEditor).toContain('p-0 leading-tight');
    expect(groupRenameEditor).toContain('aria-invalid={Boolean(folderEditor.error)}');
    expect(groupedTreeSource).not.toContain(
      'showEditorInline && folderEditor?.error ? <div',
    );
  });

  test('reveals chat rename editors and cancels them on blur like other inline renames', () => {
    const interactionsSource = readFileSync(
      new URL('../src/droneHub/app/use-sidebar-interactions.ts', import.meta.url),
      'utf8',
    );
    const startChatRename = interactionsSource.slice(
      interactionsSource.indexOf('const startRenameDroneChat'),
      interactionsSource.indexOf('const openFolderCreate'),
    );
    const blurChatRename = interactionsSource.slice(
      interactionsSource.indexOf('const blurChatEditor'),
      interactionsSource.indexOf('const moveFolderIntoGroup'),
    );

    expect(startChatRename).toContain("sidebarInlineSectionKey(droneId, 'chats')");
    expect(startChatRename).toContain('{ ...prev, [chatSectionKey]: false }');
    expect(blurChatRename).toContain("draft.mode === 'rename'");
    expect(blurChatRename).toContain('setChatEditor(null)');
  });
});
