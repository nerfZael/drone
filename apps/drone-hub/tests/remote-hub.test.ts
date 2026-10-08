import { afterEach, describe, expect, test } from 'bun:test';
import {
  homeUrlForDevice,
  remoteHubRuntime,
  supportsFullRemoteHub,
  viewerUrlForServiceUrl,
} from '../src/droneHub/app/remote-hub';

const originalWindow = (globalThis as any).window;

function stubWindow(remoteHub: unknown, href = 'http://127.0.0.1:41000/') {
  const location = new URL(href);
  (globalThis as any).window = {
    __DRONE_HUB_RUNTIME_CONFIG__: remoteHub ? { remoteHub } : {},
    location: { href: location.href, origin: location.origin, port: location.port },
  };
}

afterEach(() => {
  (globalThis as any).window = originalWindow;
});

const remote = {
  deviceId: 'desk-b',
  deviceName: 'Desk B',
  homeDeviceId: 'desk-a',
  homeOrigin: 'http://127.0.0.1:5174',
};

describe('remote Hub pages', () => {
  test('are recognised only with a complete runtime description', () => {
    stubWindow(null);
    expect(remoteHubRuntime()).toBeNull();
    stubWindow({ ...remote, homeOrigin: '' });
    expect(remoteHubRuntime()).toBeNull();
    stubWindow(remote);
    expect(remoteHubRuntime()).toEqual(remote);
  });

  test('send other device choices back to the home page', () => {
    expect(homeUrlForDevice(remote, 'phone 1')).toBe('http://127.0.0.1:5174/?device=phone+1');
  });

  test('open only desktop Hubs in full', () => {
    expect(supportsFullRemoteHub({ platform: 'desktop' })).toBe(true);
    expect(supportsFullRemoteHub({ platform: 'server' })).toBe(true);
    expect(supportsFullRemoteHub({ platform: 'android' })).toBe(false);
    expect(supportsFullRemoteHub(null)).toBe(false);
  });
});

describe('viewerUrlForServiceUrl', () => {
  test('leaves addresses unchanged on the local Hub', () => {
    stubWindow(null);
    expect(viewerUrlForServiceUrl('http://localhost:3000/app')).toBe('http://localhost:3000/app');
  });

  test('reaches remote localhost services through the viewer origin', () => {
    stubWindow(remote);
    expect(viewerUrlForServiceUrl('http://localhost:3000/app?x=1#top')).toBe(
      'http://p3000.localhost:41000/app?x=1#top',
    );
    expect(viewerUrlForServiceUrl('http://127.0.0.1:5173')).toBe('http://p5173.localhost:41000/');
    expect(viewerUrlForServiceUrl('http://[::1]:8080/')).toBe('http://p8080.localhost:41000/');
  });

  test('keeps the page itself, HTTPS, other hosts and relative addresses', () => {
    stubWindow(remote);
    expect(viewerUrlForServiceUrl('http://localhost:41000/api/x')).toBe('http://localhost:41000/api/x');
    expect(viewerUrlForServiceUrl('https://localhost:3000/')).toBe('https://localhost:3000/');
    expect(viewerUrlForServiceUrl('https://example.com/')).toBe('https://example.com/');
    expect(viewerUrlForServiceUrl('/api/drones/a/preview/3000/')).toBe('/api/drones/a/preview/3000/');
    expect(viewerUrlForServiceUrl(null)).toBeNull();
  });
});
