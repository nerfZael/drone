import { describe, expect, test } from 'bun:test';

import { createHttpHubServices } from '../src/hub/application/hub-services';

describe('HTTP Hub services adapter', () => {
  test('maps domain operations to the public Hub API', async () => {
    const calls: Array<{ pathname: string; init?: RequestInit }> = [];
    const services = createHttpHubServices(async (pathname, init) => {
      calls.push({ pathname, init });
      return { ok: true } as any;
    });

    await services.repositories.list();
    await services.groups.list('/repo path');
    await services.groups.create({ name: 'Review', repoPath: '/repo' });
    await services.groups.delete({
      groupRef: 'group/id',
      repoPath: '/repo',
      keepVolume: false,
      forget: true,
    });
    await services.groups.rename({
      groupRef: 'group/id',
      repoPath: '/repo',
      newName: 'Done',
    });
    await services.groups.setDroneGroup({ droneIds: ['drone-a'], groupId: 'group-id' });
    await services.fleet.setDroneParent({ droneRef: 'drone/a', parentRef: 'parent' });
    await services.fleet.get('drone/a');
    await services.fleet.assign({ droneRef: 'drone/a', targetRef: 'target/a' });
    await services.fleet.unassign({ droneRef: 'drone/a', targetRef: 'target/a' });
    await services.drones.rename({ droneRef: 'drone/a', newName: 'Review' });
    await services.settings.readDeleteAction();
    await services.settings.uiPreferences.read();
    await services.settings.uiPreferences.update({
      uiPreferences: { pinnedDroneIds: ['drone-a'] },
      expectedVersion: 2,
      notificationMode: 'sidebar-snapshot',
    });

    expect(calls.map((call) => [call.init?.method, call.pathname])).toEqual([
      ['GET', '/api/repos'],
      ['GET', '/api/groups?repoPath=%2Frepo+path'],
      ['POST', '/api/groups'],
      ['DELETE', '/api/groups/group%2Fid?repoPath=%2Frepo&keepVolume=false&forget=true'],
      ['POST', '/api/groups/group%2Fid/rename'],
      ['POST', '/api/drones/group-set'],
      ['POST', '/api/fleet/actors/drone%2Fa/parent'],
      ['GET', '/api/fleet/actors/drone%2Fa'],
      ['POST', '/api/fleet/actors/drone%2Fa/assigned'],
      ['DELETE', '/api/fleet/actors/drone%2Fa/assigned/target%2Fa'],
      ['POST', '/api/drones/drone%2Fa/rename'],
      ['GET', '/api/settings/delete-action'],
      ['GET', '/api/settings/ui-preferences'],
      ['POST', '/api/settings/ui-preferences'],
    ]);
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      name: 'Review',
      repoPath: '/repo',
    });
    expect(JSON.parse(String(calls[13]?.init?.body))).toEqual({
      uiPreferences: { pinnedDroneIds: ['drone-a'] },
      expectedVersion: 2,
      notificationMode: 'sidebar_snapshot',
    });
  });
});
