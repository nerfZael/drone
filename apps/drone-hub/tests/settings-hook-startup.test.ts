import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..');

const settingsOnlyHooks = [
  'useGithubSettings',
  'useAgentsSettings',
  'useFilesystemSettings',
  'useSyncSets',
  'useProfileSettings',
  'useSkillLibrary',
];

const settingsOnlyStateProps = [
  'githubSettingsState',
  'agentsSettingsState',
  'filesystemSettingsState',
  'syncSetsState',
  'profileSettingsState',
  'skillLibraryState',
];

const queryBackedSettingsHooks = [
  'use-agents-settings.ts',
  'use-delete-action-settings.ts',
  'use-filesystem-settings.ts',
  'use-github-settings.ts',
  'use-llm-settings.ts',
  'use-mcp-servers.ts',
  'use-profile-settings.ts',
  'use-registry-backup-settings.ts',
  'use-resource-subscription-settings.ts',
  'use-skill-library.ts',
  'use-speech-settings.ts',
  'use-sync-sets.ts',
];

function source(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('settings-only hook startup boundary', () => {
  test('keeps settings-only hooks out of the app model startup path', () => {
    const appModel = source('src/use-drone-hub-app-model.tsx');

    for (const hookName of settingsOnlyHooks) {
      expect(appModel).not.toContain(`import { ${hookName}`);
      expect(appModel).not.toContain(`${hookName}(requestJson`);
    }
  });

  test('keeps settings-only state props out of workspace prop plumbing', () => {
    const appModel = source('src/use-drone-hub-app-model.tsx');
    const viewProps = source('src/droneHub/app/use-drone-hub-view-props.ts');

    for (const propName of settingsOnlyStateProps) {
      expect(appModel).not.toContain(propName);
      expect(viewProps).not.toContain(propName);
    }
  });

  test('mounts SettingsView only for the settings app view', () => {
    const workspaceContent = source('src/droneHub/app/DroneHubWorkspaceContent.tsx');

    expect(workspaceContent).toContain("appView === 'settings' ? (");
    expect(workspaceContent).toContain('<SettingsView {...settingsViewProps} />');
  });

  test('keeps settings-only hooks owned by SettingsView', () => {
    const settingsView = source('src/droneHub/app/SettingsView.tsx');

    for (const hookName of settingsOnlyHooks) {
      expect(settingsView).toContain(`import { ${hookName}`);
      expect(settingsView).toContain(`${hookName}(requestJson`);
    }
  });

  test('keeps settings server resources on the shared query layer', () => {
    for (const fileName of queryBackedSettingsHooks) {
      const hook = source(`src/droneHub/app/${fileName}`);
      expect(hook).toContain('useSettingsQuery<');
    }
  });
});
