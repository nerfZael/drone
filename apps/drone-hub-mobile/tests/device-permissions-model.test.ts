import { describe, expect, test } from 'bun:test';
import {
  currentDeviceFirst,
  permissionChangeCount,
} from '../src/devices/device-permissions-model';

describe('device permissions model', () => {
  test('pins the current device first without reordering the remaining devices', () => {
    const devices = [
      { id: 'hub-a', name: 'Hub A' },
      { id: 'phone', name: 'Phone' },
      { id: 'hub-b', name: 'Hub B' },
    ] as any[];

    expect(currentDeviceFirst(devices, 'phone').map((device) => device.id)).toEqual([
      'phone',
      'hub-a',
      'hub-b',
    ]);
    expect(devices.map((device) => device.id)).toEqual(['hub-a', 'phone', 'hub-b']);
  });

  test('counts both enabled and disabled unsaved permission changes', () => {
    const saved = new Set(['assistant:read', 'drones:list']);
    const selected = new Set(['assistant:write', 'drones:list']);
    expect(permissionChangeCount(saved, selected)).toBe(2);
    expect(permissionChangeCount(saved, new Set(saved))).toBe(0);
  });
});
