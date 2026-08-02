import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  parseMobileSidebarCollapsedDroneIds,
  parseMobileSidebarExpandedFolderIds,
  serializeMobileSidebarCollapsedDroneIds,
  serializeMobileSidebarExpandedFolderIds,
} from '../src/local-assistant/mobile-sidebar-expansion-state';

describe('mobile sidebar expansion state', () => {
  test('starts with every folder collapsed when no viewer state is saved', () => {
    expect(parseMobileSidebarExpandedFolderIds(null)).toEqual(new Set());
  });

  test('round trips the folders opened on the viewing device', () => {
    const serialized = serializeMobileSidebarExpandedFolderIds(
      new Set(['repo:/work:Review', 'repo:/work:Planning']),
    );

    expect(parseMobileSidebarExpandedFolderIds(serialized)).toEqual(
      new Set(['repo:/work:Planning', 'repo:/work:Review']),
    );
  });

  test('ignores invalid saved state', () => {
    expect(parseMobileSidebarExpandedFolderIds('{invalid')).toEqual(new Set());
    expect(parseMobileSidebarExpandedFolderIds('{"folder":true}')).toEqual(new Set());
    expect(parseMobileSidebarExpandedFolderIds('["Review", null, 42, "  "]')).toEqual(
      new Set(['Review']),
    );
  });

  test('round trips collapsed multi-chat drones while defaulting them to expanded', () => {
    expect(parseMobileSidebarCollapsedDroneIds(null)).toEqual(new Set());

    const serialized = serializeMobileSidebarCollapsedDroneIds(
      new Set(['drone-b', 'drone-a']),
    );
    expect(parseMobileSidebarCollapsedDroneIds(serialized)).toEqual(
      new Set(['drone-a', 'drone-b']),
    );
  });

  test('persists expansion on the viewing phone without resetting it for the selected device', () => {
    const drawerSource = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const hookSource = readFileSync(
      new URL(
        '../src/local-assistant/use-mobile-sidebar-expanded-folder-ids.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const droneHookSource = readFileSync(
      new URL(
        '../src/local-assistant/use-mobile-sidebar-collapsed-drone-ids.ts',
        import.meta.url,
      ),
      'utf8',
    );

    expect(hookSource).toContain(
      'AsyncStorage.getItem(MOBILE_SIDEBAR_EXPANDED_FOLDER_IDS_STORAGE_KEY)',
    );
    expect(hookSource).toContain('if (loadedRef.current) persist(next);');
    expect(drawerSource).toContain('const collapsed = !expandedFolderIds.has(folder.id);');
    expect(drawerSource).toContain('useMobileSidebarExpandedFolderIds();');
    expect(drawerSource).not.toContain('setExpandedFolderIds(new Set());');
    expect(droneHookSource).toContain(
      'AsyncStorage.getItem(MOBILE_SIDEBAR_COLLAPSED_DRONE_IDS_STORAGE_KEY)',
    );
    expect(drawerSource).toContain(
      'const { collapsedDroneIds, toggleDrone } = useMobileSidebarCollapsedDroneIds();',
    );
  });
});
