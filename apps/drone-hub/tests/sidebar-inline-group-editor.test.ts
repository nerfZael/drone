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

    const nestedCreateEditor = groupedTreeSource.slice(
      groupedTreeSource.indexOf('{actionsEnabled && showCreateInline ? ('),
      groupedTreeSource.indexOf('{(!actionsEnabled || !showCreateInline)', groupedTreeSource.indexOf('{actionsEnabled && showCreateInline ? (')),
    );
    expect(nestedCreateEditor).toContain('data-sidebar-group-draft-input="true"');
    expect(nestedCreateEditor).toContain('appearance-none rounded-none border-0 bg-transparent');
    expect(nestedCreateEditor).not.toContain('border border-dashed');
    expect(nestedCreateEditor).not.toContain('bg-[var(--panel-raised)]');
  });

  test('cancels group renaming when the editor loses focus', () => {
    const interactionsSource = readFileSync(
      new URL('../src/droneHub/app/use-sidebar-interactions.ts', import.meta.url),
      'utf8',
    );

    expect(interactionsSource).toContain("draft.mode === 'rename' || draft.dismissOnBlur");
    expect(interactionsSource).toContain('setFolderEditor(null)');
  });

  test('routes F2 to the selected group or drone inline editor', () => {
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

  test('keeps failed inline drone renames visible', () => {
    const cardSource = readFileSync(
      new URL('../src/droneHub/overview/DroneCard.tsx', import.meta.url),
      'utf8',
    );
    const inlineRenameInput = cardSource.slice(
      cardSource.indexOf('{inlineRenameOpen ? ('),
      cardSource.indexOf(') : (', cardSource.indexOf('{inlineRenameOpen ? (')),
    );

    expect(inlineRenameInput).toContain('if (inlineRenamePending) return');
    expect(cardSource).toContain('showInlineRenameError');
    expect(cardSource).toContain('role="alert"');
  });
});
