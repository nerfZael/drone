import { describe, expect, test } from 'bun:test';

import {
  resolveCompanionDroneCreationPreferences,
} from '../src/droneHub/companion/companion-drone-creation';

const defaultPreferences = {
  mode: 'with-chat' as const,
  runtime: 'container' as const,
  persistVolume: false,
  spawnAgentKey: 'builtin:cursor',
  spawnModel: '',
  spawnReasoning: '',
  spawnAgentPermissionMode: 'execute' as const,
  spawnApprovalPolicy: 'ask' as const,
  repoBranchSource: 'host' as const,
  repoCreateRemoteBranch: '',
};

const codexSpawnContext = {
  spawnAgentKey: 'builtin:codex',
  spawnModel: 'gpt-5',
  spawnReasoning: 'high',
  spawnAgentPermissionMode: 'write' as const,
  spawnApprovalPolicy: 'auto' as const,
  repoBranchSource: 'host' as const,
  repoCreateRemoteBranch: '',
};

describe('Companion drone creation', () => {
  test('preserves remembered repo settings until a synchronized spawn context exists', () => {
    const remembered = {
      ...defaultPreferences,
      spawnAgentKey: 'builtin:blip',
      spawnModel: 'remembered-model',
    };

    expect(
      resolveCompanionDroneCreationPreferences({
        remembered,
        defaults: defaultPreferences,
        spawnContext: codexSpawnContext,
        hasSpawnContext: false,
      }),
    ).toEqual(remembered);

    expect(
      resolveCompanionDroneCreationPreferences({
        remembered,
        defaults: defaultPreferences,
        spawnContext: codexSpawnContext,
        hasSpawnContext: true,
      }),
    ).toMatchObject(codexSpawnContext);
  });

  test('uses the global spawn fallback when no repo settings were remembered', () => {
    expect(
      resolveCompanionDroneCreationPreferences({
        remembered: null,
        defaults: defaultPreferences,
        spawnContext: codexSpawnContext,
        hasSpawnContext: false,
      }),
    ).toMatchObject(codexSpawnContext);
  });
});
