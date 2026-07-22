import { describe, expect, test } from 'bun:test';
import { desktopDeviceRouteAvailable } from '../src/droneHub/app/DesktopDeviceProvider';

describe('desktop device connection status', () => {
  const status = {
    selfDeviceId: 'local',
    connectedDeviceIds: ['phone'],
  };

  test('reports status for the specific device instead of any connected remote', () => {
    expect(desktopDeviceRouteAvailable(status, { id: 'local' })).toBe(true);
    expect(desktopDeviceRouteAvailable(status, { id: 'phone' })).toBe(true);
    expect(desktopDeviceRouteAvailable(status, { id: 'offline-desktop' })).toBe(false);
    expect(desktopDeviceRouteAvailable(status, null)).toBe(false);
  });
});
