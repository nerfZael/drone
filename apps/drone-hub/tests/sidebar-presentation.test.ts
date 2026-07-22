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
  test('prioritizes the current device name in the desktop header', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );
    const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(sidebarSource).toContain('h-8 min-w-0 cursor-default');
    expect(sidebarSource).toContain('<span className="min-w-0 truncate">{deviceName}</span>');
    expect(sidebarSource).not.toContain('max-w-[8.5rem]');
    expect(sidebarSource).toContain('flex-shrink-0 text-left dh-type-sidebar-brand');
    expect(sidebarSource).toContain('rounded-[var(--radius-medium)] pl-1.5 pr-0.5');
    expect(sidebarSource).toContain('ml-2 h-3.5 w-3.5');
    expect(sidebarSource).toContain('bg-[var(--app-header-bg)] pl-3.5 pr-2');
    expect(stylesSource).toContain('--sidebar-brand-size: .875rem;');
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
    expect(selected).toContain('sidebar-fg-active');
    expect(selected).toContain('dh-sidebar-row-selected');
    expect(selected).toContain('dh-sidebar-row-interactive');
    expect(selected).toContain('border-transparent');
    expect(selected).not.toContain('border-[var(--border)]');
    expect(active).toContain('sidebar-fg-active');
    expect(active).toContain('dh-sidebar-row-selected');
    expect(active).toContain('border-transparent');
    expect(active).toContain('focus-visible:ring-[var(--focus-ring)]');
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

    expect(sidebarSource).toContain('overflow-x-hidden overflow-y-auto');
    expect(sidebarSource).toContain('px-2 pt-0 pb-1.5');
    expect(sidebarSource).not.toContain('overflow-y-auto px-2 py-1.5');
    expect(sidebarSource).toContain('[--sidebar-selection-edge-offset:-0.5rem]');
    expect(sidebarSource).toContain('className={`flex flex-col gap-0 ${sidebarListSelectClass}`}');
    expect(sidebarSource).toContain('<div className="flex flex-col gap-0">');
    expect(sidebarSource).toContain('<div className="flex flex-col gap-0">\n                  <>');
    expect(stylesSource).toContain('.dh-sidebar-row-selected::before');
    expect(stylesSource).toContain(".dh-sidebar-row-interactive:not([aria-disabled='true']):not(.dh-sidebar-row-selected):not(.dh-sidebar-row-highlighted):hover::after");
    expect(stylesSource).toContain('background: var(--sidebar-row-selected-bg);');
    expect(stylesSource).toContain('top: -1px;');
    expect(stylesSource).toContain('bottom: -1px;');
    expect(stylesSource).toContain('left: -100vw;');
    expect(stylesSource).toContain('right: -100vw;');
    expect(stylesSource).toContain('left: var(--sidebar-selection-edge-offset, 0px);');
  });

  test('uses the same full-bleed navigation states for repository rows', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );

    expect(sidebarSource).toContain('dh-sidebar-row-interactive group/repository-row relative');
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
      'group/active-repository flex min-h-14 w-full flex-shrink-0 items-center border-b border-[var(--border)] pr-2 transition-colors hover:bg-[var(--hover)] focus-within:bg-[var(--hover)]',
    );
    expect(sidebarSource).toContain(
      'className="flex min-h-14 min-w-0 flex-1 items-center gap-2 px-2.5 text-left"',
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
});
