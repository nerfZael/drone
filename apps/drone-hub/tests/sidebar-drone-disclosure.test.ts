import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('multi-chat drone disclosure', () => {
  test('makes grouped multi-chat drone rows toggle chats without selecting a chat', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("const hasChatSection = chats.length > 1;");
    expect(source).toContain('onSelectDroneContainer(drone.id);');
    expect(source).toContain('? selectedSidebarNodeId === node.id');
    expect(source).toContain("onToggleDroneSection(drone.id, 'chats');\n                return;");
    expect(source).toContain(
      'disclosureExpanded={hasChatSection ? chatSectionExpanded : undefined}',
    );
    expect(source).toContain('(chats.length > 1 && chatSectionExpanded)');
  });

  test('gives every child chat full state and a focused context menu', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );
    const chatRows = source.slice(
      source.indexOf('const GroupedSidebarChatRowDnd'),
      source.indexOf('const GroupedSidebarDroneRow'),
    );

    expect(chatRows).toContain('(drone.busyChats ?? []).includes(chatName)');
    expect(chatRows).toContain('(drone.unreadChats ?? []).includes(chatName)');
    expect(chatRows).toContain('showReadyAnchor');
    expect(chatRows).toContain('onContextMenu={(event) => {');
    expect(chatRows).toContain("label: 'Create chat'");
    expect(chatRows).toContain("label: 'Rename chat'");
    expect(chatRows).toContain("shortcut: 'F2'");
    expect(chatRows).toContain("label: 'Delete chat'");
    expect(chatRows).toContain('const chatActionsDisabled =');
    expect(chatRows).toContain("disabled: chatName === 'default' || chatActionsDisabled");
    expect(chatRows).not.toContain('group-hover/chat-row:pr-14');
    expect(chatRows).not.toContain('group-focus-within/chat-row:pr-14');
    expect(chatRows).not.toContain('pointer-events-none absolute inset-y-0 right-0');
  });

  test('aligns a grouped multi-chat selection edge with its parent guide', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      "hasChatSection && groupPath ? '[--sidebar-selection-edge-offset:-1px]' : undefined",
    );
    expect(source).toContain(
      'active={showOpenDefaultChatIndicator || showCollapsedActiveChatIndicator}',
    );
  });

  test('keeps the default child selected inside a multi-chat drone', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/use-sidebar-interactions.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain('const selectedDroneHasMultipleChats =');
    expect(source).toContain(
      'const selectedDroneChatCount = normalizedDroneChats(',
    );
    expect(source).toContain('const selectedDroneHasMultipleChats = selectedDroneChatCount > 1;');
    expect(source).toContain('[activeChatName, selectedDrone, selectedDroneChatCount]');
    expect(source).toContain('selectedDroneHasMultipleChats || selectedChatName !== \'default\'');
    expect(source).toContain('sidebarChatSidebarNodeId(droneId, selectedChatName)');
  });

  test('uses the same parent-only disclosure interaction in read-only desktop trees', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );

    expect(source.match(/onToggleDroneSection\(drone(?:Id|\.id), 'chats'\);/g)).toHaveLength(2);
    expect(source.match(/onSelectDroneContainer\(drone(?:Id|\.id)\);/g)).toHaveLength(2);
    expect(source).toContain('const showChatRows = hasChatSection && chatSectionExpanded;');
    expect(source).toContain('{hasChatSection && chatSectionExpanded ? (');
    const containerSelectionStart = source.indexOf('const selectGroupedDroneContainer');
    const containerSelectionEnd = source.indexOf(
      'const focusGroupedDroneChat',
      containerSelectionStart,
    );
    const containerSelectionSource = source.slice(
      containerSelectionStart,
      containerSelectionEnd,
    );
    expect(containerSelectionSource).not.toContain('onSetDroneSelectionFromFolder');
  });

  test('exposes the disclosure state accessibly with the shared runtime icon', () => {
    const source = readFileSync(
      new URL('../src/droneHub/overview/DroneCard.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('aria-expanded={disclosureExpanded}');
    expect(source).toContain(
      'className={`flex-shrink-0 ${densityClasses.folderChevron}`}',
    );
    expect(source).toContain('<DroneRuntimeIcon');
    expect(source).toContain('droneRuntimeIconToneClass(runtime)');
    expect(source).toContain('const chatNames = normalizedDroneChats(drone);');
    expect(source).not.toContain('data-sidebar-drone-spine');
    expect(source).toContain("typeof disclosureExpanded === 'boolean' ? null : isDraftDrone ? (");
    expect(source).not.toContain('disclosureExpanded ? <IconDrone');
  });
});
