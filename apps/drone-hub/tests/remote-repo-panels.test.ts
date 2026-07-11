import { describe, expect, test } from 'bun:test';
import { REMOTE_REPO_PANEL_ENTRIES } from '../src/remote/remote-repo-panel-config';
import { canOpenRemoteAssistantDrone } from '../src/remote/remote-assistant-navigation';

describe('remote repo panels', () => {
  test('exposes files, changes, PRs, and Assistant panels', () => {
    expect(REMOTE_REPO_PANEL_ENTRIES).toEqual([
      { value: 'files', label: 'Files' },
      { value: 'changes', label: 'Changes' },
      { value: 'prs', label: 'PRs' },
      { value: 'assistant', label: 'Assistant' },
    ]);
  });

  test('only navigates Assistant links to remote-selectable drones', () => {
    const drones = [
      { id: 'container-a', runtime: 'container' as const },
      { id: 'host-a', runtime: 'host' as const },
    ];

    expect(canOpenRemoteAssistantDrone(drones, 'container-a')).toBe(true);
    expect(canOpenRemoteAssistantDrone(drones, 'host-a')).toBe(false);
    expect(canOpenRemoteAssistantDrone(drones, 'missing')).toBe(false);
  });
});
