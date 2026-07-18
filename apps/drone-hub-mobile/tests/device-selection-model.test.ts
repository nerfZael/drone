import { describe, expect, test } from 'bun:test';
import { resolveAvailableDeviceSelection } from '../src/shell/device-selection-model';

describe('mobile selected device', () => {
  const devices = [
    { id: 'phone', connected: true },
    { id: 'desktop', connected: true },
    { id: 'laptop', connected: false },
  ];

  test('restores the remembered device while it is online', () => {
    expect(resolveAvailableDeviceSelection(devices, 'desktop')).toBe('desktop');
  });

  test('falls back to the first listed device when the remembered device is offline', () => {
    expect(resolveAvailableDeviceSelection(devices, 'laptop')).toBe('phone');
  });

  test('falls back when the remembered device is no longer listed', () => {
    expect(resolveAvailableDeviceSelection(devices, 'forgotten')).toBe('phone');
    expect(resolveAvailableDeviceSelection([], 'desktop')).toBe('');
  });
});
