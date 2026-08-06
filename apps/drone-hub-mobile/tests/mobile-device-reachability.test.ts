import { describe, expect, test } from 'bun:test';
import {
  mobileDeviceConnectionLabel,
  mobileDeviceConnectionState,
} from '../src/drones/mobile-device-reachability';

describe('mobile device reachability', () => {
  test('reports reachability for the selected device rather than any connected device', () => {
    const input = {
      selfDeviceId: 'phone',
      connectionStatesByDevice: { 'desktop-a': 'connected' as const },
    };

    expect(mobileDeviceConnectionState({ ...input, targetDeviceId: 'phone' })).toBe('connected');
    expect(mobileDeviceConnectionState({ ...input, targetDeviceId: 'desktop-a' })).toBe(
      'connected',
    );
    expect(mobileDeviceConnectionState({ ...input, targetDeviceId: 'desktop-b' })).toBe('offline');
    expect(mobileDeviceConnectionState({ ...input, targetDeviceId: '' })).toBe('offline');
  });

  test('preserves reconnecting and suspended states instead of flattening them to offline', () => {
    const connectionStatesByDevice = {
      reconnecting: 'reconnecting' as const,
      suspended: 'suspended' as const,
      offline: 'offline' as const,
    };

    expect(
      mobileDeviceConnectionState({
        targetDeviceId: 'reconnecting',
        selfDeviceId: 'phone',
        connectionStatesByDevice,
      }),
    ).toBe('reconnecting');
    expect(
      mobileDeviceConnectionState({
        targetDeviceId: 'suspended',
        selfDeviceId: 'phone',
        connectionStatesByDevice,
      }),
    ).toBe('suspended');
    expect(
      mobileDeviceConnectionState({
        targetDeviceId: 'offline',
        selfDeviceId: 'phone',
        connectionStatesByDevice,
      }),
    ).toBe('offline');
    expect(
      mobileDeviceConnectionState({
        targetDeviceId: 'phone',
        selfDeviceId: 'phone',
        connectionStatesByDevice,
      }),
    ).toBe('connected');
    expect(mobileDeviceConnectionLabel('connected')).toBe('Online');
    expect(mobileDeviceConnectionLabel('reconnecting')).toBe('Reconnecting');
    expect(mobileDeviceConnectionLabel('suspended')).toBe('Paused');
    expect(mobileDeviceConnectionLabel('offline')).toBe('Offline');
  });
});
