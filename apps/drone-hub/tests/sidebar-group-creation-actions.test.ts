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
      'onCreateGroup={actionsEnabled ? () => onCreateGroupBeforeDrone(drone) : undefined}',
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
    expect(treeSource).toContain('shortcutBindings.createDraftGroup');
    expect(treeSource).toContain('shortcutBindings.openHoveredGroupMultiChat');
    expect(treeSource).toContain('separatorBefore: true');
    expect(treeSource).not.toContain('data-sidebar-folder-actions');
  });
});
