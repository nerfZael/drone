import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('delete confirmation policy', () => {
  test('does not expose or persist an auto-delete preference', () => {
    const sidebarSource = source('../src/droneHub/app/DroneSidebar.tsx');
    const storeSource = source('../src/droneHub/app/use-drone-hub-ui-store.ts');
    const settingsSource = source('../src/droneHub/app/use-ui-preferences-settings.ts');

    expect(sidebarSource).not.toContain('Confirm before deleting');
    expect(sidebarSource).not.toContain("id: 'delete-confirm'");
    expect(storeSource).not.toContain('autoDelete: boolean');
    expect(settingsSource).not.toContain('autoDelete');
  });

  test('always opens confirmation for destructive sidebar actions', () => {
    const modelSource = source('../src/use-drone-hub-app-model.tsx');
    const groupSource = source('../src/droneHub/app/use-group-management.ts');
    const droneSource = source('../src/droneHub/app/use-drone-mutation-actions.ts');
    const workspaceSource = source('../src/droneHub/app/use-workspace-actions.ts');

    expect(modelSource).toContain('setDroneDeleteConfirm({ drones: rows });');
    expect(groupSource).toContain(
      'const ok = await confirmDelete(buildSidebarGroupDeleteConfirmation({',
    );
    expect(droneSource).toContain('if (opts?.confirmed !== true) {');
    expect(workspaceSource).toContain(
      'const ok = window.confirm(`Remove repo "${path}" from the registry?`);',
    );
  });
});
