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

  test('keeps the remembered device selected while it is temporarily offline', () => {
    expect(resolveAvailableDeviceSelection(devices, 'laptop')).toBe('laptop');
  });

  test('keeps device identity stable across disconnect and reconnect transitions', () => {
    const disconnected = devices.map((device) =>
      device.id === 'desktop' ? { ...device, connected: false } : device,
    );
    expect(resolveAvailableDeviceSelection(disconnected, 'desktop')).toBe('desktop');
    expect(resolveAvailableDeviceSelection(devices, 'desktop')).toBe('desktop');
  });

  test('falls back when the remembered device is no longer listed', () => {
    expect(resolveAvailableDeviceSelection(devices, 'forgotten')).toBe('phone');
    expect(resolveAvailableDeviceSelection([], 'desktop')).toBe('');
  });
});
