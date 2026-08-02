import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  sidebarChatRowTone,
  sidebarChatLabelClass,
  sidebarChatStateClass,
  sidebarDensityClasses,
  sidebarFolderLabelClass,
  sidebarSelectionEdgeClass,
} from '../src/droneHub/sidebar/presentation';

describe('sidebar presentation', () => {
  test('keeps the enabled device picker compact in the desktop header', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );
    const pickerSource = readFileSync(
      new URL('../src/droneHub/app/DesktopDevicePicker.tsx', import.meta.url),
      'utf8',
    );
    const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(sidebarSource).toContain('<DesktopDevicePicker');
    expect(sidebarSource).toContain("setSettingsActiveTab('devices')");
    expect(pickerSource).toContain('<span>Manage devices</span>');
    expect(pickerSource).not.toContain('<IconNetwork');
    expect(pickerSource).toContain('border-t border-[var(--border-subtle)] p-1');
    expect(pickerSource).toContain('h-7 min-w-0 items-center');
    expect(pickerSource).toContain('<span className="min-w-0 truncate">{name}</span>');
    expect(pickerSource).toContain('aria-haspopup="menu"');
    expect(pickerSource).toContain('selectDevice(device.id)');
    expect(pickerSource).not.toContain('switching is coming soon');
    expect(pickerSource).not.toContain('Drone Hubs');
    expect(pickerSource).not.toContain('Mesh route available');
    expect(pickerSource).not.toContain('No mesh devices');
    expect(pickerSource).toContain('<DeviceConnectionIndicator online={hasRoute} />');
    expect(pickerSource).toContain('{platformLabel(device.platform)}');
    expect(pickerSource).toContain("platform === 'server' || platform === 'desktop'");
    expect(pickerSource).toContain("return 'Desktop'");
    expect(pickerSource).toContain('w-[232px] !bg-[var(--sidebar-bg)]');
    expect(pickerSource).toContain('bg-[var(--sidebar-row-selected-bg)]');
    expect(pickerSource).toContain('border-b border-[var(--border-subtle)]');
    expect(sidebarSource).toContain('flex-shrink-0 text-left dh-type-sidebar-brand');
    expect(pickerSource).toContain('rounded-[var(--radius-medium)] pl-1.5 pr-0.5');
    expect(pickerSource).toContain('ml-2 h-3.5 w-3.5');
    expect(sidebarSource).toContain('h-11 flex-shrink-0 select-none items-center');
    expect(sidebarSource).toContain('bg-[var(--app-header-bg)] pl-3 pr-2');
    expect(stylesSource).toContain('--sidebar-brand-size: .875rem;');
  });

  test('uses the Drone Hub brand as a project-list home control', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );

    expect(sidebarSource).toContain('aria-label="Open project list"');
    expect(sidebarSource).toContain(
      "setAppView('workspace');\n                openRepositoryOverview();",
    );
  });

  test('uses the wider desktop sidebar for both the shell and dock preview', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );

    expect(sidebarSource).toContain('const SIDEBAR_EXPANDED_WIDTH_PX = 308;');
    expect(sidebarSource).toContain('style={{ width: SIDEBAR_EXPANDED_WIDTH_PX }}');
    expect(sidebarSource).toContain('`min(${SIDEBAR_EXPANDED_WIDTH_PX}px, 100vw)`');
  });

  test('uses one density contract for every sidebar renderer', () => {
    const compact = sidebarDensityClasses('compact');
    const normal = sidebarDensityClasses('default');
    const comfortable = sidebarDensityClasses('comfortable');

    expect(compact.chatRow).toContain('h-6');
    expect(normal.chatRow).toContain('h-[25px]');
    expect(comfortable.chatRow).toContain('h-7');
    expect(compact.chatRow).toContain('text-[var(--sidebar-item-compact-size)]');
    expect(normal.chatRow).toContain('text-[var(--sidebar-item-size)]');
    expect(comfortable.chatRow).toContain('text-[var(--sidebar-item-comfortable-size)]');
    expect(normal.folderLabel).toContain('text-[var(--sidebar-item-size)]');
    expect(compact.chatRow).toContain('pl-1 pr-1.5');
    expect(normal.chatRow).toContain('pl-1 pr-1.5');
    expect(comfortable.chatRow).toContain('pl-1 pr-2');
    expect(compact.folderBody).toContain('ml-[11px]');
    expect(normal.folderBody).toContain('ml-3');
    expect(comfortable.folderBody).toContain('ml-[15px]');
    expect(normal.folderBody).toContain('pl-0');
    expect(compact.folderDepthPaddingPx).toBeLessThan(normal.folderDepthPaddingPx);
    expect(normal.folderDepthPaddingPx).toBeLessThan(comfortable.folderDepthPaddingPx);
    expect(sidebarFolderLabelClass).toContain('dh-type-sidebar-heading');
  });

  test('uses a slim buttonless Chromium scrollbar in the sidebar', () => {
    const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(stylesSource).toContain('.dh-sidebar-scrollbar::-webkit-scrollbar { width: 2px; }');
    expect(stylesSource).toContain('.dh-sidebar-scrollbar::-webkit-scrollbar-button:vertical:start:decrement');
    expect(stylesSource).toContain('.dh-sidebar-scrollbar::-webkit-scrollbar-button:vertical:end:increment');
    expect(stylesSource).toContain('-webkit-appearance: none;');
    expect(stylesSource).toContain('@supports (-moz-appearance: none)');
  });

  test('keeps chat row state hierarchy centralized and compact', () => {
    const selected = sidebarChatRowTone({ selected: true });
    const active = sidebarChatRowTone({ active: true });
    expect(selected).toContain('sidebar-drone-fg');
    expect(selected).not.toContain('sidebar-fg-active');
    expect(selected).toContain('dh-sidebar-row-selected');
    expect(selected).toContain('dh-sidebar-row-interactive');
    expect(selected).toContain('border-transparent');
    expect(selected).not.toContain('border-[var(--border)]');
    expect(active).toContain('sidebar-drone-fg');
    expect(active).not.toContain('sidebar-fg-active');
    expect(active).not.toContain('dh-sidebar-row-selected');
    expect(active).toContain('border-transparent');
    expect(active).toContain('focus-visible:outline-none');
    expect(active).not.toContain('focus-visible:ring-');
    expect(sidebarChatRowTone({})).toContain('sidebar-subitem-fg');
    expect(sidebarChatRowTone({})).toContain('dh-sidebar-row-interactive');
    expect(sidebarChatRowTone({})).not.toContain('hover:bg-');
    expect(sidebarChatRowTone({ disabled: true })).toContain('cursor-not-allowed');
    expect(sidebarChatStateClass).toContain('justify-center');
    expect(sidebarChatStateClass).toContain('inline-flex');
    expect(sidebarChatStateClass).toContain('h-3 w-3');
    expect(sidebarChatStateClass).not.toContain('w-[4.75rem]');
    expect(sidebarChatStateClass).toContain('leading-none');
    expect(sidebarChatLabelClass).toContain('[font-family:var(--sidebar-font)]');
    expect(sidebarChatLabelClass).toContain('font-normal');
    expect(sidebarChatLabelClass).not.toContain('font-mono');
    expect(sidebarSelectionEdgeClass).toContain('sidebar-row-selected-edge');
    expect(sidebarSelectionEdgeClass).toContain('w-[2px]');
    expect(sidebarSelectionEdgeClass).toContain('dh-sidebar-selection-edge');
  });

  test('extends selected rows to both sidebar edges and closes adjacent row gaps', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );
    const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const hoverRule = stylesSource.slice(
      stylesSource.indexOf(".dh-sidebar-row-interactive:not([aria-disabled='true'])"),
      stylesSource.indexOf('.dh-sidebar-row-selected::before'),
    );
    const selectedRule = stylesSource.slice(
      stylesSource.indexOf('.dh-sidebar-row-selected::before'),
      stylesSource.indexOf('.dh-sidebar-selection-edge'),
    );

    expect(sidebarSource).toContain('overflow-x-hidden overflow-y-auto');
    expect(sidebarSource).toContain('px-2 pt-0 pb-1.5');
    expect(sidebarSource).not.toContain('overflow-y-auto px-2 py-1.5');
    expect(sidebarSource).toContain('[--sidebar-selection-edge-offset:-0.5rem]');
    expect(sidebarSource).toContain('className={`flex flex-col gap-0 ${sidebarListSelectClass}`}');
    expect(sidebarSource).toContain('<div className="flex flex-col gap-0">');
    expect(sidebarSource).toContain('<div className="flex flex-col gap-0">\n                  <>');
    expect(stylesSource).toContain('.dh-sidebar-row-selected::before');
    expect(stylesSource).toContain(".dh-sidebar-row-interactive:not([aria-disabled='true']):not(.dh-sidebar-row-selected):not(.dh-sidebar-row-highlighted):is(:hover, :focus-visible)::after");
    expect(hoverRule).toContain('background: var(--hover);');
    expect(hoverRule).not.toContain('background: var(--sidebar-row-selected-bg);');
    expect(selectedRule).toContain('background: var(--sidebar-row-selected-bg);');
    expect(stylesSource).toContain('top: -1px;');
    expect(stylesSource).toContain('bottom: -1px;');
    expect(stylesSource).toContain('left: -100vw;');
    expect(stylesSource).toContain('right: -100vw;');
    expect(stylesSource).toContain('left: var(--sidebar-selection-edge-offset, 0px);');
  });

  test('keeps complete drone units in a compact explorer rhythm', () => {
    const groupedTreeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );

    expect(groupedTreeSource).toContain('data-sidebar-drone-unit="true"');
    expect(groupedTreeSource).toContain(
      'className={`flex flex-col gap-0 transition-[margin] duration-150',
    );
  });

  test('uses explorer chevrons and immediate select-and-toggle folder clicks', () => {
    const groupedTreeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );

    expect(groupedTreeSource).toContain('down={!collapsed}');
    expect(groupedTreeSource).toContain('strokeWidth={1.25}');
    expect(groupedTreeSource).toContain('densityClasses.folderChevron');
    expect(groupedTreeSource).toContain('onSelectFolder(folderPath, opts);');
    expect(groupedTreeSource).toContain('onToggleGroupCollapsed(folderPath);');
    expect(groupedTreeSource).not.toContain('GROUPED_FOLDER_SINGLE_CLICK_DELAY_MS');
    expect(groupedTreeSource).not.toContain('scheduleFolderSingleClick');
    expect(groupedTreeSource).not.toContain('Empty folder.');
    expect(groupedTreeSource).not.toContain('No drones in this folder.');
    expect(groupedTreeSource).not.toContain('No drones in this repo yet.');
    expect(groupedTreeSource).not.toContain('Create a top-level folder');
  });

  test('connects multi-chat subtrees to their parent with a subtle rail', () => {
    const groupedTreeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );

    expect(groupedTreeSource).toContain('data-sidebar-chat-rail="true"');
    expect(groupedTreeSource).toContain(
      'className={`${densityClasses.chatIndent} dh-sidebar-drone-chat-body flex flex-col gap-0 border-l [--sidebar-selection-edge-offset:-1px]`}',
    );
    expect(groupedTreeSource).toContain(
      "data-sidebar-guide-selected={hasActiveChildChat ? 'true' : undefined}",
    );
  });

  test('balances root tree spacing below the active project header', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );

    expect(sidebarSource).toContain(
      'group/active-repository sticky top-0 z-20 -mx-2 mb-2',
    );
  });

  test('shows folder guides only for hovered ancestry or a direct selected child', () => {
    const groupedTreeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );
    const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(groupedTreeSource).toContain('data-sidebar-folder-node={node.id}');
    expect(groupedTreeSource).toContain('data-sidebar-guide-selected={selectedDirectChild');
    expect(groupedTreeSource).toContain('selectedDirectChild={hasSelectedDirectChild}');
    expect(groupedTreeSource).toContain('selectedSidebarNodeId === childId');
    expect(stylesSource).toContain('[data-sidebar-folder-node]:hover > .dh-sidebar-folder-body');
    expect(stylesSource).toContain(".dh-sidebar-folder-body[data-sidebar-guide-selected='true']");
    expect(stylesSource).toContain('[data-sidebar-drone-unit]:hover > .dh-sidebar-drone-chat-body');
    expect(stylesSource).toContain(".dh-sidebar-drone-chat-body[data-sidebar-guide-selected='true']");
    expect(stylesSource).toContain('border-left-color: transparent;');
  });

  test('distinguishes the selected chat from an open chat without an extra marker', () => {
    const groupedTreeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );

    expect(groupedTreeSource).toContain("aria-current={active ? 'page' : undefined}");
    expect(groupedTreeSource).not.toContain('sidebarOpenChatIndicatorClass');
    expect(groupedTreeSource).toContain(
      '{selected ? <span className={sidebarSelectionEdgeClass} /> : null}',
    );
    expect(groupedTreeSource).toContain(
      'aria-label={`${uiDroneName(drone.name)} / ${chatName}`}',
    );
    expect(groupedTreeSource).not.toContain(
      'title={`${uiDroneName(drone.name)} / ${chatName}`}',
    );
  });

  test('uses the same full-bleed navigation states for repository rows', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );

    expect(sidebarSource).toContain('dh-sidebar-row-interactive group/repository-row relative');
    expect(sidebarSource).toContain('flex min-h-12 w-full items-center rounded-[var(--sidebar-row-radius)]');
    expect(sidebarSource).not.toContain('const repositoryProjectCount =');
    expect(sidebarSource).toContain('const isUngrouped = !item.repoPath;');
    expect(sidebarSource).toContain('{item.repoPath || \'Drones without a repository\'}');
    expect(sidebarSource).toContain('items-start gap-2');
    expect(sidebarSource).toContain('inline-flex h-5 w-5 flex-shrink-0 items-center justify-center');
    expect(sidebarSource).not.toContain('inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[5px] border');
    expect(sidebarSource).toContain('mx-1.5 h-px bg-[var(--border-subtle)]');
    expect(sidebarSource).toContain('font-mono text-[.5625rem]');
    expect(sidebarSource).toContain('text-[var(--sidebar-meta-fg)] opacity-55');
    expect(sidebarSource).toContain("containsSelectedDrone ? 'dh-sidebar-row-selected' : ''");
    expect(sidebarSource).toContain(
      '{containsSelectedDrone ? <span className={sidebarSelectionEdgeClass} /> : null}',
    );
    expect(sidebarSource).not.toContain("containsSelectedDrone\n                          ? 'bg-[var(--selected)]'");
  });

  test('highlights the complete active repository header row', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );

    expect(sidebarSource).toContain(
      'group/active-repository sticky top-0 z-20 -mx-2 mb-2 flex h-10 w-[calc(100%+1rem)] flex-shrink-0 items-center border-b border-[var(--border-subtle)] bg-[var(--sidebar-bg)]',
    );
    expect(sidebarSource).toContain(
      "pinnedSidebarPlacement === 'top' && globalPinnedDrones.length > 0",
    );
    expect(sidebarSource).toContain("? 'border-t'");
    expect(sidebarSource).toContain(
      'className="flex h-10 min-w-0 flex-1 items-center gap-1.5 px-2 text-left"',
    );
  });

  test('orders repository header states by approval, unread, then working', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );
    const headerStart = sidebarSource.indexOf(
      'activeRepositoryNavigationItem.stateSummary.approval',
    );
    const headerEnd = sidebarSource.indexOf('</button>', headerStart);
    const headerStates = sidebarSource.slice(headerStart, headerEnd);

    expect(headerStates.indexOf('stateSummary.approval')).toBeLessThan(
      headerStates.indexOf('stateSummary.unread'),
    );
    expect(headerStates.indexOf('stateSummary.unread')).toBeLessThan(
      headerStates.indexOf('stateSummary.working'),
    );
  });

  test('shows descendant state counts only on collapsed group headers in repository order', () => {
    const groupedTreeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );
    const countsStart = groupedTreeSource.indexOf('function SidebarGroupStateCounts');
    const countsEnd = groupedTreeSource.indexOf('function groupedDroneDragData', countsStart);
    const countsSource = groupedTreeSource.slice(countsStart, countsEnd);

    expect(groupedTreeSource).toContain(
      '{collapsed ? <SidebarGroupStateCounts summary={stateSummary} /> : null}',
    );
    expect(groupedTreeSource).toContain(
      'collectSidebarTreeDroneIds(nodeTree, node.id)',
    );
    expect(groupedTreeSource).toContain("inactiveDisplayState !== 'blocked'");
    expect(groupedTreeSource).toContain("inactiveDisplayState !== 'offline'");
    expect(countsSource.indexOf('summary.approval')).toBeLessThan(
      countsSource.indexOf('summary.unread'),
    );
    expect(countsSource.indexOf('summary.unread')).toBeLessThan(
      countsSource.indexOf('summary.working'),
    );
    expect(groupedTreeSource).toContain(
      'group/folder-row relative flex items-center gap-1 rounded-[var(--sidebar-row-radius)] pr-0.5',
    );
  });

  test('optically aligns repository status counts with their indicators', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );

    expect(sidebarSource).toContain('function SidebarRepositoryStateCount({');
    expect(sidebarSource).toContain(
      'className="inline-flex h-3 w-3 flex-shrink-0 items-center justify-center leading-none"',
    );
    expect(sidebarSource).toContain(
      'className="relative top-px inline-flex h-3 min-w-[2ch] items-center leading-none tabular-nums"',
    );
  });
});
