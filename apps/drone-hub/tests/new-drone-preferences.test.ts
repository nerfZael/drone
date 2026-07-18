import { describe, expect, test } from 'bun:test';
import { normalizeDesktopNewDronePreferences } from '../src/droneHub/app/new-drone-preferences';

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
        name: 'do-not-remember',
        group: 'do-not-remember',
        repoPath: '/do/not/remember',
      }),
    ).toEqual({
      mode: 'without-chat',
      runtime: 'host',
      createAsDraft: true,
      persistVolume: true,
      spawnAgentKey: 'builtin:codex',
      spawnModel: 'gpt-5.4',
      spawnReasoning: 'high',
      spawnAgentPermissionMode: 'read-only',
    });
  });

  test('uses safe defaults for malformed optional values', () => {
    expect(normalizeDesktopNewDronePreferences({})).toEqual({
      mode: 'with-chat',
      runtime: 'container',
      createAsDraft: false,
      persistVolume: false,
      spawnAgentKey: 'builtin:cursor',
      spawnModel: '',
      spawnReasoning: '',
      spawnAgentPermissionMode: 'full-access',
    });
    expect(normalizeDesktopNewDronePreferences(null)).toBeNull();
  });
});
