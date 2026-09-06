import { expect, test } from 'bun:test';
import {
  toggleWorkspace,
  workspaceAccessSignature,
  validateMobileWorkspaceSelection,
  workspaceCategory,
} from '../src/local-assistant/workspace-access-model';
import type { ChatWorkspaceOption } from '@drone/assistant-chat';

const workspace: ChatWorkspaceOption = {
  id: 'drone:a',
  kind: 'drone',
  droneId: 'a',
  name: 'A',
  deviceId: 'device',
  deviceName: 'Laptop',
  read: true,
  write: true,
  execute: true,
};

test('device repositories and folders are separate from container drones', () => {
  expect(workspaceCategory({ ...workspace, kind: 'host', repository: true })).toBe('Repositories');
  expect(workspaceCategory({ ...workspace, kind: 'host', repository: false })).toBe('Folders');
  expect(workspaceCategory({ ...workspace, kind: 'host', runtime: 'host' })).toBe('Host drones');
  expect(workspaceCategory({ ...workspace, runtime: 'container' })).toBe('Container drones');
  expect(workspaceCategory({ ...workspace, kind: 'remote' })).toBe('Folders');
});

test('phone saves revalidate destination grants and cannot upgrade an offline workspace', async () => {
  const remote: ChatWorkspaceOption = {
    ...workspace,
    kind: 'remote',
    workspaceId: 'folder',
    id: 'remote:device:folder',
  };
  const selected = { targets: [remote], defaultTargetId: remote.id };
  await expect(
    validateMobileWorkspaceSelection(selected, selected, async () => [{ ...remote, write: false }]),
  ).rejects.toThrow('Access is unavailable');
  const readOnly = { ...selected, targets: [{ ...remote, write: false, execute: false }] };
  await expect(
    validateMobileWorkspaceSelection(selected, readOnly, async () => {
      throw new Error('offline');
    }),
  ).rejects.toThrow('Access is unavailable');
  expect(
    await validateMobileWorkspaceSelection(readOnly, selected, async () => {
      throw new Error('offline');
    }),
  ).toEqual(readOnly);
  let requests = 0;
  expect(
    await validateMobileWorkspaceSelection(
      { targets: [], defaultTargetId: null },
      selected,
      async () => {
        requests++;
        throw new Error('offline');
      },
    ),
  ).toEqual({ targets: [], defaultTargetId: null });
  expect(requests).toBe(0);
});

test('adding a workspace starts with read access and keeps the existing default', () => {
  const first = toggleWorkspace({ targets: [], defaultTargetId: null }, workspace);
  expect(first).toMatchObject({
    defaultTargetId: workspace.id,
    targets: [{ read: true, write: false, execute: false }],
  });
  const second = toggleWorkspace(first, { ...workspace, id: 'drone:b', droneId: 'b' });
  expect(second.defaultTargetId).toBe(workspace.id);
  expect(second.targets).toHaveLength(2);
});

test('removing the default requires a deliberate replacement and never redirects silently', () => {
  const access = {
    targets: [workspace, { ...workspace, id: 'drone:b', droneId: 'b' }],
    defaultTargetId: workspace.id,
  };
  const removed = toggleWorkspace(access, workspace);
  expect(removed.targets.map((target) => target.id)).toEqual(['drone:b']);
  expect(removed.defaultTargetId).toBeNull();
});

test('dirty state ignores discovery labels and ordering but includes grants and default', () => {
  const access = { targets: [workspace], defaultTargetId: workspace.id };
  expect(workspaceAccessSignature(access)).toBe(
    workspaceAccessSignature({ ...access, targets: [{ ...workspace, name: 'Renamed' }] }),
  );
  expect(workspaceAccessSignature(access)).not.toBe(
    workspaceAccessSignature({ ...access, targets: [{ ...workspace, write: false }] }),
  );
});
