import { describe, expect, test } from 'bun:test';
import { resolveMobileSidebarRepositoryAlignment } from '../src/local-assistant/mobile-sidebar-repository-navigation';

describe('mobile sidebar repository navigation', () => {
  test('does not snap manual repository navigation back after a drone-list refresh', () => {
    const initial = resolveMobileSidebarRepositoryAlignment({
      open: true,
      activeDeviceId: 'device-1',
      activeDroneId: 'drone-a',
      resolvedRepoId: 'repo-a',
      alignedSelectionKey: null,
    });
    expect(initial.repoIdToOpen).toBe('repo-a');

    // The user has navigated to repo B, but repo A still contains the open drone.
    // Rebuilding the drone/repository model must not make repo A authoritative again.
    const afterRefresh = resolveMobileSidebarRepositoryAlignment({
      open: true,
      activeDeviceId: 'device-1',
      activeDroneId: 'drone-a',
      resolvedRepoId: 'repo-a',
      alignedSelectionKey: initial.alignedSelectionKey,
    });
    expect(afterRefresh).toEqual({
      alignedSelectionKey: initial.alignedSelectionKey,
      repoIdToOpen: null,
    });
  });

  test('aligns with the open drone again when the drawer is reopened', () => {
    const initial = resolveMobileSidebarRepositoryAlignment({
      open: true,
      activeDeviceId: 'device-1',
      activeDroneId: 'drone-a',
      resolvedRepoId: 'repo-a',
      alignedSelectionKey: null,
    });
    const closed = resolveMobileSidebarRepositoryAlignment({
      open: false,
      activeDeviceId: 'device-1',
      activeDroneId: 'drone-a',
      resolvedRepoId: 'repo-a',
      alignedSelectionKey: initial.alignedSelectionKey,
    });
    const reopened = resolveMobileSidebarRepositoryAlignment({
      open: true,
      activeDeviceId: 'device-1',
      activeDroneId: 'drone-a',
      resolvedRepoId: 'repo-a',
      alignedSelectionKey: closed.alignedSelectionKey,
    });

    expect(closed.alignedSelectionKey).toBeNull();
    expect(reopened.repoIdToOpen).toBe('repo-a');
  });

  test('waits for repository data before consuming the opening alignment', () => {
    const unresolved = resolveMobileSidebarRepositoryAlignment({
      open: true,
      activeDeviceId: 'device-1',
      activeDroneId: 'drone-a',
      resolvedRepoId: null,
      alignedSelectionKey: null,
    });
    const resolved = resolveMobileSidebarRepositoryAlignment({
      open: true,
      activeDeviceId: 'device-1',
      activeDroneId: 'drone-a',
      resolvedRepoId: 'repo-a',
      alignedSelectionKey: unresolved.alignedSelectionKey,
    });

    expect(unresolved).toEqual({ alignedSelectionKey: null, repoIdToOpen: null });
    expect(resolved.repoIdToOpen).toBe('repo-a');
  });

  test('realigns when a drone is selected again after an empty selection', () => {
    const cleared = resolveMobileSidebarRepositoryAlignment({
      open: true,
      activeDeviceId: 'device-1',
      activeDroneId: '',
      resolvedRepoId: null,
      alignedSelectionKey: 'device-1\u0000drone-a',
    });
    const reselected = resolveMobileSidebarRepositoryAlignment({
      open: true,
      activeDeviceId: 'device-1',
      activeDroneId: 'drone-a',
      resolvedRepoId: 'repo-a',
      alignedSelectionKey: cleared.alignedSelectionKey,
    });

    expect(cleared.alignedSelectionKey).toBeNull();
    expect(reselected.repoIdToOpen).toBe('repo-a');
  });
});
