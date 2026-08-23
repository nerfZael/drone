import { describe, expect, test } from 'bun:test';
import { sidebarGroupDroneIds } from '../src/droneHub/app/sidebar-group-drone-targets';

describe('sidebar group drone targets', () => {
  const drones = [
    { id: 'direct', group: 'work', repoPath: '/alpha' },
    { id: 'nested', group: 'work/review', repoPath: '/alpha' },
    { id: 'sibling', group: 'personal', repoPath: '/alpha' },
    { id: 'other-repo', group: 'work', repoPath: '/beta' },
    { id: 'ungrouped', group: null, repoPath: '/alpha' },
  ];

  test('includes drones in the selected group and its subgroups only', () => {
    expect(sidebarGroupDroneIds(drones, 'work', '/alpha')).toEqual(['direct', 'nested']);
  });

  test('keeps repository scopes isolated', () => {
    expect(sidebarGroupDroneIds(drones, 'work', '/beta')).toEqual(['other-repo']);
  });

  test('targets only ungrouped drones for the ungrouped bucket', () => {
    expect(sidebarGroupDroneIds(drones, 'Ungrouped', '/alpha')).toEqual(['ungrouped']);
  });
});
