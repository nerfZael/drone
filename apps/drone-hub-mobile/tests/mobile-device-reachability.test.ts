import { describe, expect, test } from 'bun:test';
import { mobileDeviceReachable } from '../src/drones/mobile-device-reachability';

describe('mobile device reachability', () => {
  test('reports reachability for the selected device rather than any connected device', () => {
    const input = { selfDeviceId: 'phone', connectedDeviceIds: ['desktop-a'] };

    expect(mobileDeviceReachable({ ...input, targetDeviceId: 'phone' })).toBe(true);
    expect(mobileDeviceReachable({ ...input, targetDeviceId: 'desktop-a' })).toBe(true);
    expect(mobileDeviceReachable({ ...input, targetDeviceId: 'desktop-b' })).toBe(false);
    expect(mobileDeviceReachable({ ...input, targetDeviceId: '' })).toBe(false);
  });
});
