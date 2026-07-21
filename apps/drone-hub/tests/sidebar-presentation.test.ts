import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  sidebarChatRowTone,
  sidebarChatLabelClass,
  sidebarChatStateClass,
  sidebarDensityClasses,
  sidebarFolderLabelClass,
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

  test('keeps chat row state hierarchy centralized and calm', () => {
    const selected = sidebarChatRowTone({ selected: true });
    const active = sidebarChatRowTone({ active: true });
    expect(selected).toContain('sidebar-fg-active');
    expect(selected).toContain('border-transparent');
    expect(selected).not.toContain('border-[var(--border)]');
    expect(active).toContain('sidebar-fg');
    expect(active).toContain('border-transparent');
    expect(sidebarChatRowTone({})).toContain('sidebar-subitem-fg');
    expect(sidebarChatRowTone({ disabled: true })).toContain('cursor-not-allowed');
    expect(sidebarChatStateClass).toContain('justify-end');
    expect(sidebarChatStateClass).toContain('inline-flex');
    expect(sidebarChatStateClass).toContain('w-[4.75rem]');
    expect(sidebarChatStateClass).toContain('leading-none');
    expect(sidebarChatLabelClass).toContain('[font-family:var(--sidebar-font)]');
    expect(sidebarChatLabelClass).toContain('font-normal');
    expect(sidebarChatLabelClass).not.toContain('font-mono');
  });
});
