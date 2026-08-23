import { describe, expect, test } from 'bun:test';

import { createGroup } from '../src/hub/application/create-group';
import { createDeleteGroupCommand } from '../src/hub/application/delete-group';
import { createFleetActorService } from '../src/hub/application/fleet-actors';
import { HubApplicationEvents } from '../src/hub/application/hub-application-events';
import { renameGroup } from '../src/hub/application/rename-group';
import { setDroneGroup } from '../src/hub/application/set-drone-group';
import { setDroneParent } from '../src/hub/application/set-drone-parent';
import { UiPreferencesService } from '../src/hub/application/ui-preferences';
import { describeHubError } from '../src/hub/domain-errors';
import {
  UiPreferencesSettingsConflictError,
  UiPreferencesSettingsValidationError,
} from '../src/hub/hub-settings';

describe('Hub application services', () => {
  test('keeps legacy command status errors compatible at HTTP boundaries', () => {
    expect(
      describeHubError(Object.assign(new Error('conflict'), { code: 'HUB_409' })),
    ).toMatchObject({ statusCode: 409, body: { error: 'conflict' } });
    expect(describeHubError(Object.assign(new Error('missing'), { status: 404 }))).toMatchObject({
      statusCode: 404,
      body: { error: 'missing' },
    });
  });

  test('creates a canonical group through one command', async () => {
    const calls: unknown[] = [];
    const result = await createGroup(
      { name: ' Review ', repoPath: ' /repo ', at: 'now' },
      {
        listCanonicalGroups: async (repoPath) => {
          calls.push(['list', repoPath]);
          return [];
        },
        ensureCanonicalGroup: async (...args) => {
          calls.push(['ensure', ...args]);
          return {
            id: 'group-id',
            repoPath: '/repo',
            name: 'Review',
            label: 'Review',
            parentId: null,
            createdAt: 'now',
          };
        },
        nowIso: () => 'unused',
      },
    );

    expect(calls).toEqual([
      ['list', '/repo'],
      ['ensure', 'Review', '/repo', 'now'],
    ]);
    expect(result).toMatchObject({ ok: true, id: 'group-id', name: 'Review' });
  });

  test('deletes a group and its pending drones through one command', async () => {
    const dequeued: string[] = [];
    const lifecycleDeletes: unknown[] = [];
    const deletedGroups: unknown[] = [];
    const command = createDeleteGroupCommand({
      listCanonicalGroups: async () => [
        { id: 'group-id', repoPath: '/repo', name: 'Review' },
      ],
      loadRegistry: async () => ({
        drones: {},
        pending: {
          pending: { name: 'Pending', repoPath: '/repo', group: 'Review' },
        },
      }),
      normalizeDroneIdentity: (value) => String(value ?? '').trim(),
      deleteCanonicalGroupArtifacts: async (...args) => {
        deletedGroups.push(args);
      },
      dequeueProvisioning: (droneId) => dequeued.push(droneId),
      removeDroneById: async () => ({ removedRegistry: true }),
      deleteCanonicalDroneLifecycleBatch: async (...args) => {
        lifecycleDeletes.push(args);
      },
    });

    const result = await command({
      groupRef: 'group-id',
      repoPath: '/ignored',
      keepVolume: false,
      forget: true,
    });

    expect(result).toMatchObject({
      ok: true,
      group: 'Review',
      repoPath: '/repo',
      removed: [{ id: 'pending', name: 'Pending' }],
      deletedGroup: true,
    });
    expect(dequeued).toEqual(['pending']);
    expect(lifecycleDeletes).toEqual([
      [[{ state: 'pending', droneId: 'pending' }], { ignoreMissing: true }],
    ]);
    expect(deletedGroups).toEqual([['/repo', 'Review']]);
  });

  test('deletes only drones in a group hierarchy when preserving its groups', async () => {
    const removedDroneIds: string[] = [];
    const deletedGroups: unknown[] = [];
    const command = createDeleteGroupCommand({
      listCanonicalGroups: async () => [
        { id: 'group-id', repoPath: '/repo', name: 'Review' },
        { id: 'nested-id', repoPath: '/repo', name: 'Review/Nested' },
      ],
      loadRegistry: async () => ({
        drones: {
          direct: { name: 'Direct', repoPath: '/repo', group: 'Review' },
          nested: { name: 'Nested', repoPath: '/repo', group: 'Review/Nested' },
          sibling: { name: 'Sibling', repoPath: '/repo', group: 'Other' },
          otherRepo: { name: 'Other repo', repoPath: '/other', group: 'Review' },
        },
        pending: {},
      }),
      normalizeDroneIdentity: (value) => String(value ?? '').trim(),
      deleteCanonicalGroupArtifacts: async (...args) => {
        deletedGroups.push(args);
      },
      dequeueProvisioning: () => undefined,
      removeDroneById: async ({ id }) => {
        removedDroneIds.push(id);
        return { removedRegistry: true };
      },
      deleteCanonicalDroneLifecycleBatch: async () => undefined,
    });

    const result = await command({
      groupRef: 'group-id',
      repoPath: '/ignored',
      keepVolume: false,
      forget: true,
      preserveGroup: true,
    });

    expect(result).toMatchObject({
      ok: true,
      group: 'Review',
      removed: [
        { id: 'direct', name: 'Direct' },
        { id: 'nested', name: 'Nested' },
      ],
      deletedGroup: false,
    });
    expect(removedDroneIds).toEqual(['direct', 'nested']);
    expect(deletedGroups).toEqual([]);
  });

  test('sets a fleet parent through one canonical command', async () => {
    let persisted: any = null;
    const result = await setDroneParent(
      { droneRef: 'child', parentRef: 'parent' },
      {
        resolveDrone: async (ref) => (ref === 'child' ? { kind: 'real', id: 'child-id' } : null),
        loadRegistry: async () => ({ drones: {} }),
        findDroneIdByRef: (_registry, ref) => (ref === 'parent' ? { id: 'parent-id' } : null),
        resolveStableDroneOrPendingIdFromRef: (_registry, ref) =>
          ref === 'parent' ? 'parent-id' : null,
        fleetDescendantIdsForActor: () => [],
        updateDroneFleetMetadata: async (input) => {
          persisted = {
            droneId: input.droneId,
            fleet: input.transform({ assigned: ['worker'] }),
          };
        },
      },
    );

    expect(result).toEqual({ ok: true, id: 'child-id', parentId: 'parent-id' });
    expect(persisted).toEqual({
      droneId: 'child-id',
      fleet: { assigned: ['worker'], createdBy: 'parent-id' },
    });
  });

  test('assigns fleet actors through one canonical service', async () => {
    let fleet = { assigned: ['existing'] };
    const service = createFleetActorService({
      resolveDrone: async (ref) =>
        ref === 'owner' ? { id: 'owner-id', kind: 'real' as const } : null,
      loadRegistry: async () => ({ drones: {} }),
      findDroneIdByRef: (_registry, ref) => (ref === 'target' ? { id: 'target-id' } : null),
      updateDroneFleetMetadata: async (input) => {
        fleet = input.transform(fleet) as typeof fleet;
      },
      fleetActorConfig: (entry) => entry.fleet,
      fleetActorPayload: (_registry, actorId) => ({ ok: true, id: actorId, fleet }),
    });

    await expect(service.assign({ droneRef: 'owner', targetRef: 'target' })).resolves.toEqual({
      ok: true,
      id: 'owner-id',
      fleet: { assigned: ['existing', 'target-id'] },
    });
  });

  test('rejects pending fleet actors with a conflict', async () => {
    const service = createFleetActorService({
      resolveDrone: async () => ({ id: 'pending-id', kind: 'pending' }),
      loadRegistry: async () => ({ pending: {} }),
      findDroneIdByRef: () => null,
      updateDroneFleetMetadata: async () => undefined,
      fleetActorConfig: () => ({ assigned: [] }),
      fleetActorPayload: () => ({}),
    });

    await expect(service.get('pending')).rejects.toMatchObject({
      statusCode: 409,
      message: 'drone "pending" is still starting',
    });
  });

  test('sets group membership and returns the canonical group id', async () => {
    const result = await setDroneGroup(
      { droneIds: ['alpha', 'alpha'], groupId: 'group-id' },
      {
        normalizeDroneIdentity: (value) => String(value ?? '').trim(),
        resolveCanonicalGroupReference: async () => ({ name: 'Review', repoPath: '/repo' }),
        resolveDrone: async () => ({
          kind: 'real',
          id: 'alpha',
          drone: { name: 'Alpha', repoPath: '/repo', group: 'Old' },
        }),
        setDroneGroupMetadata: async () => ({
          name: 'Alpha',
          lifecycle: { group: 'Review', groupId: 'group-id' },
        }),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      group: 'Review',
      total: 1,
      rejected: [],
      moved: [{ id: 'alpha', groupId: 'group-id', previousGroup: 'Old' }],
    });
  });

  test('keeps null and empty legacy group ids compatible', async () => {
    const writtenGroups: Array<string | null> = [];
    let groupLookups = 0;
    const dependencies = {
      normalizeDroneIdentity: (value: unknown) => String(value ?? '').trim(),
      resolveCanonicalGroupReference: async () => {
        groupLookups += 1;
        return null;
      },
      resolveDrone: async () => ({
        kind: 'real' as const,
        id: 'alpha',
        drone: { name: 'Alpha', repoPath: '/repo', group: 'Old' },
      }),
      setDroneGroupMetadata: async ({ group }: { group: string | null }) => {
        writtenGroups.push(group);
        return { name: 'Alpha', lifecycle: { group } };
      },
    };

    await setDroneGroup({ droneIds: ['alpha'], groupId: null, group: 'Review' }, dependencies);
    await setDroneGroup({ droneIds: ['alpha'], groupId: '' }, dependencies);

    expect(groupLookups).toBe(0);
    expect(writtenGroups).toEqual(['Review', null]);
  });

  test('renames a canonical group through one orchestration path', async () => {
    const calls: unknown[] = [];
    const result = await renameGroup(
      { groupRef: 'group-id', repoPath: '/ignored', newName: 'Done', at: 'now' },
      {
        listCanonicalGroups: async () => [{ id: 'group-id', repoPath: '/repo', name: 'Review' }],
        renameCanonicalGroupOrchestration: async (...args) => {
          calls.push(args);
          return { ok: true, movedDrones: 2, movedPending: 1 };
        },
      },
    );

    expect(calls).toEqual([['/repo', 'Review', 'Done', 'now']]);
    expect(result).toMatchObject({
      ok: true,
      id: 'group-id',
      renamed: true,
      movedDrones: 2,
      movedPending: 1,
    });
  });

  test('publishes one event after a UI preference write', async () => {
    const events = new HubApplicationEvents();
    const received: unknown[] = [];
    events.subscribe((event) => {
      received.push(event);
    });
    const service = new UiPreferencesService(events, {
      read: async () => ({ uiPreferences: { pinnedDroneIds: ['alpha'] }, version: 2 }),
      write: async () => undefined,
    });

    const result = await service.update({
      uiPreferences: { pinnedDroneIds: ['alpha'] },
      expectedVersion: 1,
      notificationMode: 'sidebar-snapshot',
    });

    expect(result.version).toBe(2);
    expect(received).toEqual([
      { type: 'ui-preferences.changed', notificationMode: 'sidebar-snapshot' },
    ]);
  });

  test('maps preference repository failures to domain errors', async () => {
    const events = new HubApplicationEvents();
    const conflict = new UiPreferencesService(events, {
      read: async () => ({ uiPreferences: {}, version: 1 }),
      write: async () => {
        throw new UiPreferencesSettingsConflictError({
          key: 'ui-preferences',
          value: {},
          updatedAt: 'now',
          version: 3,
        } as any);
      },
    });
    const invalid = new UiPreferencesService(events, {
      read: async () => ({ uiPreferences: {}, version: 1 }),
      write: async () => {
        throw new UiPreferencesSettingsValidationError('invalid');
      },
    });

    await expect(conflict.update({ uiPreferences: {} })).rejects.toMatchObject({
      statusCode: 409,
      details: { version: 3 },
    });
    await expect(invalid.update({ uiPreferences: {} })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
