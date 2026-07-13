import { describe, expect, test } from 'bun:test';
import { deviceEditorSourceKey } from '../src/droneHub/app/device-editor-state';
import type { MeshDevice } from '../src/droneHub/app/use-device-mesh';

function device(overrides: Partial<MeshDevice> = {}): MeshDevice {
  return {
    id: 'device_phone',
    name: 'Android phone',
    platform: 'android',
    administrator: false,
    grants: [],
    endpoints: [],
    revokedAt: null,
    ...overrides,
  };
}

describe('device editor source state', () => {
  test('ignores polling object identity when editable server values are unchanged', () => {
    expect(deviceEditorSourceKey(device())).toBe(deviceEditorSourceKey(device()));
  });

  test('changes when an editable server value changes', () => {
    expect(deviceEditorSourceKey(device({ name: 'Pocket Hub' }))).not.toBe(
      deviceEditorSourceKey(device()),
    );
  });
});
