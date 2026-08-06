import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

const workspaceSource = fs.readFileSync(
  path.join(import.meta.dir, '../src/droneHub/app/DockableDroneWorkspace.tsx'),
  'utf8',
);

describe('workspace default layout', () => {
  test('starts a new drone with chat only', () => {
    const defaultLayoutSource = workspaceSource.slice(
      workspaceSource.indexOf('function createDefaultLayout'),
      workspaceSource.indexOf('function ChatPanel'),
    );

    expect(defaultLayoutSource).toContain('api.clear();');
    expect(defaultLayoutSource).toContain('ensureChatPanel(api);');
    expect(defaultLayoutSource).not.toContain('ensureWorkspaceToolPanel');
    expect(workspaceSource).toContain('localStorage.removeItem(LEGACY_LAYOUT_STORAGE_KEY)');
    expect(workspaceSource).not.toContain('migrateEditorChangesPanels(api, activeToolTab)');
  });
});
