import { expect, test } from 'bun:test';
import { toggleCompanionWorkspace, type ChatWorkspaceOption } from '../src/workspace-access';
const a: ChatWorkspaceOption = {
  id: 'drone:a',
  kind: 'drone',
  droneId: 'a',
  deviceId: 'home',
  deviceName: 'Home',
  name: 'A',
  read: true,
  write: true,
  execute: true,
};
const b = { ...a, id: 'drone:b', droneId: 'b', name: 'B' };

test('desktop and mobile Companion selection grants only Read and maintains a valid default', () => {
  const first = toggleCompanionWorkspace({ targets: [], defaultTargetId: null }, a);
  expect(first.targets[0]).toMatchObject({ read: true, write: false, execute: false });
  expect(first.defaultTargetId).toBe(a.id);
  const second = toggleCompanionWorkspace(first, b);
  expect(second.defaultTargetId).toBe(a.id);
  const removed = toggleCompanionWorkspace(second, a);
  expect(removed.targets.map((target) => target.id)).toEqual([b.id]);
  expect(removed.defaultTargetId).toBe(b.id);
  expect(toggleCompanionWorkspace(removed, b)).toEqual({ targets: [], defaultTargetId: null });
});
test('write-only remote shares cannot be selected as Companion workspaces', () => {
  expect(() =>
    toggleCompanionWorkspace({ targets: [], defaultTargetId: null }, { ...a, read: false }),
  ).toThrow('Read access');
});
