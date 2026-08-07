import { describe, expect, test } from 'bun:test';
import {
  normalizeDesktopNewDronePreferences,
  normalizeDesktopNewDronePreferencesByRepo,
} from '../src/droneHub/app/new-drone-preferences';

describe('desktop new drone preferences', () => {
  test('normalizes the device-scoped creation fields', () => {
    expect(
      normalizeDesktopNewDronePreferences({
        mode: 'without-chat',
        runtime: 'host',
        createAsDraft: true,
        persistVolume: true,
        spawnAgentKey: ' builtin:codex ',
        spawnModel: ' gpt-5.4 ',
        spawnReasoning: ' high ',
        spawnAgentPermissionMode: 'read-only',
        spawnApprovalPolicy: 'agent-decides',
        repoBranchSource: 'remote',
        repoCreateRemoteBranch: ' origin/feature-a ',
        name: 'do-not-remember',
        group: 'do-not-remember',
        repoPath: '/do/not/remember',
      }),
    ).toEqual({
      mode: 'with-chat',
      runtime: 'host',
      persistVolume: true,
      spawnAgentKey: 'builtin:codex',
      spawnModel: 'gpt-5.4',
      spawnReasoning: 'high',
      spawnAgentPermissionMode: 'read-only',
      spawnApprovalPolicy: 'agent-decides',
      repoBranchSource: 'remote',
      repoCreateRemoteBranch: 'origin/feature-a',
    });
  });

  test('uses safe defaults for malformed optional values', () => {
    expect(normalizeDesktopNewDronePreferences({})).toEqual({
      mode: 'with-chat',
      runtime: 'container',
      persistVolume: false,
      spawnAgentKey: 'builtin:cursor',
      spawnModel: '',
      spawnReasoning: '',
      spawnAgentPermissionMode: 'full-access',
      spawnApprovalPolicy: 'ask',
      repoBranchSource: 'host',
      repoCreateRemoteBranch: '',
    });
    expect(normalizeDesktopNewDronePreferences(null)).toBeNull();
  });

  test('keeps creation preferences isolated by repository key', () => {
    const normalized = normalizeDesktopNewDronePreferencesByRepo({
      '/repos/a': { runtime: 'container', repoBranchSource: 'remote', repoCreateRemoteBranch: 'origin/a' },
      '/repos/b': { runtime: 'host', repoBranchSource: 'host' },
    });

    expect(normalized['/repos/a']?.runtime).toBe('container');
    expect(normalized['/repos/a']?.repoCreateRemoteBranch).toBe('origin/a');
    expect(normalized['/repos/b']?.runtime).toBe('host');
    expect(normalized['/repos/b']?.repoCreateRemoteBranch).toBe('');
  });
});
