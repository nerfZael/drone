import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('sidebar group creation actions', () => {
  test('renders group drafts immediately before their selected anchor', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('const beforeNodeId = showCreateInline');
    expect(source).toContain('beforeNodeId === childId');
    expect(source).toContain('props.folderEditor.parentPath === null');
  });

  test('offers a non-moving New group action on drone menus', () => {
    const cardSource = readFileSync(
      new URL('../src/droneHub/overview/DroneCard.tsx', import.meta.url),
      'utf8',
    );
    const treeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );

    expect(cardSource).toContain("label: 'New group'");
    expect(cardSource).toContain('onSelect: () => onCreateGroup?.()');
    expect(treeSource).toContain(
      'onCreateGroup={actionsEnabled && !repositoryRootView ? () => onCreateGroupBeforeDrone(drone) : undefined}',
    );
  });

  test('keeps the desktop create-group icon visually quiet until interaction', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('<IconFolderOutline className="h-4 w-4" />');
    expect(source).toContain(
      'opacity-70 transition-opacity group-hover/create-group:opacity-100 group-focus-visible/create-group:opacity-100',
    );
  });

  test('moves group actions from hover controls into a right-click menu', () => {
    const treeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );

    expect(treeSource).toContain('onContextMenu={(event) => {');
    expect(treeSource).toContain(
      'setContextMenuPosition({ x: event.clientX, y: event.clientY });',
    );
    expect(treeSource).toContain('if (!isSelected) onSelectFolder(folderPath);');
    expect(treeSource).toContain("label: isVirtualGroup ? 'New group' : 'New subfolder'");
    expect(treeSource).toContain("label: isHiddenGroup ? 'Unhide group' : 'Hide group'");
    expect(treeSource).toContain("label: 'Open multi-chat'");
    expect(treeSource).toContain("label: 'Delete group'");
    expect(treeSource).toContain("shortcut: 'Delete'");
    expect(treeSource).toContain('shortcutBindings.createDraftGroup');
    expect(treeSource).toContain('shortcutBindings.openHoveredGroupMultiChat');
    expect(treeSource).toContain('separatorBefore: true');
    expect(treeSource).not.toContain('data-sidebar-folder-actions');
  });

  test('deletes a selected group with the Delete key without requiring pointer hover', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );
    const treeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );

    const deleteShortcutIndex = sidebarSource.indexOf("event.key === 'Delete'");
    const hoverGuardIndex = sidebarSource.indexOf(
      "document.querySelector('[data-drone-sidebar-root=\"true\"]:hover')",
      deleteShortcutIndex,
    );
    expect(deleteShortcutIndex).toBeGreaterThan(-1);
    expect(hoverGuardIndex).toBeGreaterThan(deleteShortcutIndex);
    expect(sidebarSource).toContain('handleDeleteGroup(folderPath, selectedFolder.totalDroneCount');
    expect(treeSource).toContain("event.key !== 'Delete'");
    expect(treeSource).toContain('handleFolderDelete();');
    expect(treeSource).toContain("isSelected ? 'focus-visible:outline-none' : ''");
    expect(treeSource).not.toContain('node.totalDroneCount > 0');
    expect(sidebarSource).not.toContain('<IconTrash className="opacity-90" />');
  });

  test('does not offer folder creation as a drone drop target', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );
    const dndSource = readFileSync(
      new URL('../src/droneHub/app/use-sidebar-ungrouped-drop.ts', import.meta.url),
      'utf8',
    );

    expect(sidebarSource).not.toContain('Drop here to create a new folder');
    expect(sidebarSource).not.toContain('sidebar-create-group-drop');
    expect(dndSource).not.toContain('sidebar-create-group-drop');
    expect(dndSource).not.toContain('dragOverCreateGroup');
  });
});
