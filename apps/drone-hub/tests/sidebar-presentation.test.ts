import { describe, expect, test } from 'bun:test';
import {
  sidebarChatRowTone,
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
    expect(sidebarChatRowTone({ selected: true })).toContain('sidebar-fg-active');
    expect(sidebarChatRowTone({ active: true })).toContain('sidebar-fg');
    expect(sidebarChatRowTone({})).toContain('sidebar-subitem-fg');
    expect(sidebarChatRowTone({ disabled: true })).toContain('cursor-not-allowed');
  });
});
