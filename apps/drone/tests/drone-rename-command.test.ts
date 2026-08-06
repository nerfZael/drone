import { describe, expect, test } from 'bun:test';

import { createRenameDroneCommand } from '../src/hub/drone-rename-command';

function harness() {
  const registry = {
    drones: {
      'drone-a': { id: 'drone-a', name: 'Untitled 1' },
      'drone-b': { id: 'drone-b', name: 'Existing name' },
    },
    pending: {
      'drone-c': { id: 'drone-c', name: 'Pending name' },
    },
  };
  const persisted: any[] = [];
  const logs: any[] = [];
  let notifications = 0;
  const renameDrone = createRenameDroneCommand({
    displayNameMaxLength: 80,
    findDroneIdByRef: (snapshot, ref) => {
      for (const [kind, entries] of [
        ['real', snapshot.drones],
        ['pending', snapshot.pending],
      ] as const) {
        for (const [id, entry] of Object.entries(entries) as Array<[string, any]>) {
          if (id === ref || entry.name === ref) return { id, kind };
        }
      }
      return null;
    },
    loadRegistry: async () => registry,
    log: (level, message, details) => logs.push({ level, message, details }),
    normalizeDisplayName: (value) => {
      const name = String(value ?? '').trim();
      if (name.length > 80 || /[\r\n]/.test(name)) throw new Error('invalid drone name');
      return name;
    },
    normalizeDroneIdentity: (value) => String(value ?? '').trim(),
    notifyRegistryWrite: () => {
      notifications += 1;
    },
    persistDisplayName: async (input) => {
      persisted.push(input);
      const entry =
        input.state === 'real' ? registry.drones[input.droneId] : registry.pending[input.droneId];
      if (!entry) throw new Error(`unknown drone: ${input.droneId}`);
      if (input.expectedName !== undefined && entry.name !== input.expectedName) {
        throw Object.assign(new Error('rename precondition failed'), {
          code: 'DRONE_RENAME_PRECONDITION_FAILED',
        });
      }
      entry.name = input.name;
    },
  });
  return { logs, persisted, registry, renameDrone, notifications: () => notifications };
}

describe('shared drone rename command', () => {
  test('validates, persists, and notifies through one in-process command', async () => {
    const state = harness();
    await expect(
      state.renameDrone({
        droneRef: 'drone-a',
        newName: 'Review proposals',
        expectedName: 'Untitled 1',
        source: 'test',
      }),
    ).resolves.toEqual({
      ok: true,
      id: 'drone-a',
      oldName: 'Untitled 1',
      newName: 'Review proposals',
      renamed: true,
    });
    expect(state.persisted).toEqual([
      {
        droneId: 'drone-a',
        state: 'real',
        name: 'Review proposals',
        expectedName: 'Untitled 1',
      },
    ]);
    expect(state.notifications()).toBe(1);
  });

  test('returns a no-op without writing or notifying', async () => {
    const state = harness();
    await expect(
      state.renameDrone({ droneRef: 'drone-a', newName: 'Untitled 1' }),
    ).resolves.toMatchObject({ renamed: false, reason: 'same-name' });
    expect(state.persisted).toHaveLength(0);
    expect(state.notifications()).toBe(0);
  });

  test('rejects active and pending name conflicts before persistence', async () => {
    for (const newName of ['Existing name', 'Pending name']) {
      const state = harness();
      await expect(state.renameDrone({ droneRef: 'drone-a', newName })).rejects.toMatchObject({
        status: 409,
        code: 'DRONE_RENAME_NAME_CONFLICT',
      });
      expect(state.persisted).toHaveLength(0);
      expect(state.notifications()).toBe(0);
    }
  });
});
