import { describe, expect, test } from 'bun:test';
import {
  sidebarChatRowTone,
  sidebarChatStateClass,
  sidebarDensityClasses,
  sidebarFolderLabelClass,
} from '../src/droneHub/sidebar/presentation';

describe('sidebar presentation', () => {
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
    expect(sidebarChatStateClass).toContain('grid-cols-[.75rem_minmax(0,1fr)]');
    expect(sidebarChatStateClass).toContain('w-[4.75rem]');
    expect(sidebarChatStateClass).toContain('leading-none');
  });
});
