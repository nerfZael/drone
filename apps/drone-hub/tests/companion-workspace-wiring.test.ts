import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Companion workspace wiring', () => {
  test('uses one typed workspace boundary for app, composer, and editor tools', () => {
    const appSource = readFileSync(new URL('../src/DroneHubApp.tsx', import.meta.url), 'utf8');
    const modelSource = readFileSync(
      new URL('../src/use-drone-hub-app-model.tsx', import.meta.url),
      'utf8',
    );
    const dictationSource = readFileSync(
      new URL('../src/droneHub/chat/ContinuousDictationContext.tsx', import.meta.url),
      'utf8',
    );
    const companionSource = readFileSync(
      new URL('../src/droneHub/companion/CompanionContext.tsx', import.meta.url),
      'utf8',
    );
    const editorSource = readFileSync(
      new URL('../src/droneHub/files/OpenedDroneFilePanel.tsx', import.meta.url),
      'utf8',
    );
    const workspaceSource = readFileSync(
      new URL('../src/droneHub/companion/CompanionWorkspaceContext.tsx', import.meta.url),
      'utf8',
    );

    expect(appSource.indexOf('<CompanionWorkspaceProvider>')).toBeLessThan(
      appSource.indexOf('<ContinuousDictationProvider>'),
    );
    expect(modelSource).toContain('companionWorkspace.registerWorkspaceTarget({');
    expect(dictationSource).toContain('companionWorkspace.registerComposerTarget({');
    expect(editorSource).toContain('companionWorkspace.registerEditor({');
    expect(companionSource).toContain('workspace.readActiveComposer()');
    expect(companionSource).toContain('workspace.readOpenFile()');
    expect(dictationSource).toContain("throw new Error('STALE_COMPOSER_TARGET')");
    expect(workspaceSource).toContain("throw new Error('STALE_EDITOR_TARGET')");
    expect(companionSource).not.toContain('CustomEvent');
    expect(companionSource).not.toContain('requestCompanionBrowserAction');
  });
});
