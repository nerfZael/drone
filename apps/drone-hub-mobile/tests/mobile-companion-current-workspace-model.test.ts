import { describe, expect, test } from 'bun:test';
import {
  grantMobileCompanionCurrentWorkspaceRead,
  resolveMobileCompanionCurrentWorkspaceAccess,
  type MobileCompanionCurrentWorkspace,
} from '../src/local-assistant/mobile-companion-current-workspace-model';

const target = { id: 'drone:one', name: 'one', deviceId: 'hub', deviceName: 'Hub', kind: 'drone', path: '/repo/one', read: true, write: true, execute: false } as MobileCompanionCurrentWorkspace['target'];
const other = { id: 'drone:two', name: 'two', deviceId: 'hub', deviceName: 'Hub', kind: 'drone', read: true, write: false, execute: false };

function current(access: MobileCompanionCurrentWorkspace['access']): MobileCompanionCurrentWorkspace {
  return { revision: 'r1', access, defaults: { targets: [], defaultTargetId: null }, workspaces: [target], devices: [], target, droneId: 'one' };
}
const base = { supported: true, droneId: 'one', loading: false, busy: false, error: '' };

describe('mobile Companion current workspace access', () => {
  test('mirrors the desktop Allow Read states', () => {
    expect(resolveMobileCompanionCurrentWorkspaceAccess({ ...base, supported: false, current: null })).toMatchObject({ enabled: false, detail: expect.stringContaining('Update the Hub') });
    expect(resolveMobileCompanionCurrentWorkspaceAccess({ ...base, droneId: '', current: null })).toMatchObject({ enabled: false, detail: 'Open a drone for workspace access.' });
    expect(resolveMobileCompanionCurrentWorkspaceAccess({ ...base, loading: true, current: null })).toMatchObject({ label: 'Loading workspace…', enabled: false });
    expect(resolveMobileCompanionCurrentWorkspaceAccess({ ...base, error: 'DRONE_UNAVAILABLE', current: null })).toMatchObject({ label: 'Workspace unavailable', detail: 'DRONE_UNAVAILABLE', enabled: true });
    expect(resolveMobileCompanionCurrentWorkspaceAccess({ ...base, current: current({ targets: [], defaultTargetId: null }) })).toMatchObject({ label: 'Allow read · one', detail: 'Hub · /repo/one', enabled: true, granted: false });
    expect(resolveMobileCompanionCurrentWorkspaceAccess({ ...base, current: current({ targets: [{ ...target, read: true }], defaultTargetId: other.id }) })).toMatchObject({ label: 'Use workspace · one', enabled: true, granted: false });
    expect(resolveMobileCompanionCurrentWorkspaceAccess({ ...base, current: current({ targets: [{ ...target, read: true }], defaultTargetId: target.id }) })).toMatchObject({ label: 'Read enabled · one', enabled: false, granted: true });
    expect(resolveMobileCompanionCurrentWorkspaceAccess({ ...base, busy: true, current: current({ targets: [], defaultTargetId: null }) })).toMatchObject({ label: 'Saving workspace access…', enabled: false });
  });

  test('grants read only, keeps other targets, and makes the workspace the default', () => {
    expect(grantMobileCompanionCurrentWorkspaceRead(current({ targets: [other], defaultTargetId: other.id }))).toEqual({
      targets: [other, { ...target, read: true, write: false, execute: false }],
      defaultTargetId: target.id,
    });
    const already = { ...target, read: true, write: true, execute: false };
    expect(grantMobileCompanionCurrentWorkspaceRead(current({ targets: [already], defaultTargetId: null }))).toEqual({
      targets: [already],
      defaultTargetId: target.id,
    });
  });
});
