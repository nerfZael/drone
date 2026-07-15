import { describe, expect, test } from 'bun:test';
import { createPendingDroneStateHelpers } from '../src/hub/drone-pending-state';

const {
  applyPendingDisplayNameToProvisionedDrone,
  normalizePendingStartupPrompts,
  resolvePendingDroneDisplayName,
} = createPendingDroneStateHelpers({
  normalizeChatName: (raw: any) => String(raw ?? 'default').trim() || 'default',
  nowIso: () => '2026-03-25T18:00:00.000Z',
});

describe('pending provisioning display name helpers', () => {
  test('prefers the latest pending rename over a stale created drone name', () => {
    const droneEntry: any = { id: 'drone-1', name: 'Untitled 25' };
    const pendingEntry: any = { id: 'drone-1', name: 'auth-bugfix' };

    const applied = applyPendingDisplayNameToProvisionedDrone(droneEntry, pendingEntry, 'Untitled 25');

    expect(applied).toBe('auth-bugfix');
    expect(droneEntry.name).toBe('auth-bugfix');
  });

  test('keeps the created drone name when no pending rename exists', () => {
    const droneEntry: any = { id: 'drone-1', name: 'existing-name' };

    const applied = applyPendingDisplayNameToProvisionedDrone(droneEntry, null, 'fallback-name');

    expect(applied).toBe('existing-name');
    expect(droneEntry.name).toBe('existing-name');
  });

  test('keeps a rename already carried into the real drone during creation', () => {
    const droneEntry: any = { id: 'drone-1', name: 'auth-bugfix' };
    const stalePendingEntry: any = { id: 'drone-1', name: 'Untitled 25' };

    const applied = applyPendingDisplayNameToProvisionedDrone(
      droneEntry,
      stalePendingEntry,
      'Untitled 25',
    );

    expect(applied).toBe('auth-bugfix');
    expect(droneEntry.name).toBe('auth-bugfix');
  });

  test('falls back when the pending entry has no valid name yet', () => {
    expect(resolvePendingDroneDisplayName({ name: '   ' }, 'Untitled 25')).toBe('Untitled 25');
  });

  test('normalizes startup pending prompts with chat filtering', () => {
    const prompts = normalizePendingStartupPrompts(
      [
        { id: 'one', chatName: ' default ', prompt: { message: 'first' }, state: 'sending' },
        { id: 'two', chatName: 'ops', prompt: 'second', state: 'weird' },
        { id: '', chatName: 'default', prompt: 'ignored' },
      ],
      'default',
    );

    expect(prompts).toEqual([
      {
        id: 'one',
        chatName: 'default',
        at: '2026-03-25T18:00:00.000Z',
        prompt: 'first',
        state: 'sending',
        error: undefined,
        updatedAt: undefined,
      },
    ]);
  });
});
