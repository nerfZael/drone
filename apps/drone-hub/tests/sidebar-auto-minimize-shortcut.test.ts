import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolveManualSidebarToggle } from '../src/droneHub/app/resolve-manual-sidebar-toggle';

describe('manual sidebar shortcut toggle', () => {
  test('disables auto-minimize while collapsing the sidebar', () => {
    expect(resolveManualSidebarToggle({ sidebarCollapsed: false })).toEqual({
      sidebarAutoMinimize: false,
      sidebarCollapsed: true,
    });
  });

  test('disables auto-minimize while expanding the sidebar', () => {
    expect(resolveManualSidebarToggle({ sidebarCollapsed: true })).toEqual({
      sidebarAutoMinimize: false,
      sidebarCollapsed: false,
    });
  });

  test('wires the manual override through the store and sidebar shortcut', () => {
    const storeSource = readFileSync(
      new URL('../src/droneHub/app/use-drone-hub-ui-store.ts', import.meta.url),
      'utf8',
    );
    const lifecycleSource = readFileSync(
      new URL('../src/droneHub/app/use-drone-hub-lifecycle-effects.ts', import.meta.url),
      'utf8',
    );

    expect(storeSource).toMatch(
      /toggleSidebarCollapsedManually: \(\) =>\s*set\(\(s\) => resolveManualSidebarToggle\(s\)\)/,
    );
    expect(lifecycleSource).toMatch(
      /toggleSidebarCollapsed: \(\) => \{\s*toggleSidebarCollapsedManually\(\);\s*return true;/,
    );
  });
});
