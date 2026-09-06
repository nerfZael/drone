import { describe, expect, it, test } from 'bun:test';
import {
  allowBrowserNavigation,
  browserAddress,
  parseBrowserAddress,
  browserAccessDialog,
  browserPath,
  browserPort,
  browserPreferenceKey,
  defaultBrowserPort,
} from '../src/drones/mobile-browser-model';

test('browser paths remain on the selected service', () => {
  expect(browserPath(' /dashboard?q=1#panel ')).toBe('/dashboard?q=1#panel');
  expect(browserPath('')).toBe('/');
  expect(browserPath('/hello world?name=Ž')).toBe('/hello%20world?name=%C5%BD');
  for (const path of [
    'https://example.com',
    '//example.com',
    '/\\example.com',
    '/ok\r\nHost: other',
  ])
    expect(() => browserPath(path)).toThrow();
  const origin = 'http://127.0.0.23:45000';
  expect(allowBrowserNavigation(`${origin}/assets/main.js`, origin)).toBe(true);
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://example.com',
    'http://127.0.0.23:45001/',
    `${origin}@example.com/`,
  ])
    expect(allowBrowserNavigation(url, origin)).toBe(false);
});

test('browser preferences are device scoped and ports are valid integers', () => {
  expect(defaultBrowserPort([{ port: 22 }, { port: 7777 }, { port: 5173 }])).toBe(5173);
  expect(defaultBrowserPort([])).toBeNull();
  expect(browserPreferenceKey('a:b', 'c')).not.toBe(browserPreferenceKey('a', 'b:c'));
  expect(browserPort('3000')).toBe(3000);
  for (const port of ['0', '65536', '-1', '3e3', '1.5', ''])
    expect(() => browserPort(port)).toThrow();
});

test('browser permission errors identify the destination settings and this phone', () => {
  const denied = Object.assign(new Error('this device has not granted that operation'), {
    code: 'PERMISSION_DENIED',
  });
  const dialog = browserAccessDialog(denied, 'Office Desktop', 'My Phone');
  expect(dialog?.title).toBe('Browser access needed');
  expect(dialog?.message).toContain('On Office Desktop');
  expect(dialog?.message).toContain('Settings → Devices');
  expect(dialog?.message).toContain('Select My Phone');
  for (const operation of ['browser.targets', 'browser.open', 'browser.close'])
    expect(dialog?.message).toContain(operation);
  expect(dialog?.message).toContain('Try again');
  expect(
    browserAccessDialog(
      new Error('Browser access is not permitted for this device'),
      'Desktop',
      'Phone',
    )?.title,
  ).toBe('Browser access needed');
});

test('browser connectivity failures do not tell the user to change permissions', () => {
  expect(
    browserAccessDialog(
      Object.assign(new Error('Timed out'), { code: 'TIMEOUT' }),
      'Desktop',
      'Phone',
    ),
  ).toBeNull();
  expect(
    browserAccessDialog(
      Object.assign(new Error('Not supported'), { code: 'UNSUPPORTED_OPERATION' }),
      'Office Desktop',
      'Phone',
    )?.message,
  ).toContain('Update Drone Hub on Office Desktop');
});

describe('parseBrowserAddress', () => {
  it('reads a bare port', () => {
    expect(parseBrowserAddress('3000', null)).toEqual({ port: 3000, path: '/' });
    expect(parseBrowserAddress(' :8080 ', null)).toEqual({ port: 8080, path: '/' });
  });
  it('reads a port with a path', () => {
    expect(parseBrowserAddress(':3000/dashboard?x=1#top', null)).toEqual({
      port: 3000,
      path: '/dashboard?x=1#top',
    });
  });
  it('reuses the current port for a path-only address', () => {
    expect(parseBrowserAddress('/settings', 5173)).toEqual({ port: 5173, path: '/settings' });
    expect(() => parseBrowserAddress('/settings', null)).toThrow(/port/);
  });
  it('reads host style and full URLs', () => {
    expect(parseBrowserAddress('localhost:4173/app', null)).toEqual({ port: 4173, path: '/app' });
    expect(parseBrowserAddress('http://127.0.0.1:3001/', null)).toEqual({ port: 3001, path: '/' });
    expect(parseBrowserAddress('https://example.test/x', null)).toEqual({ port: 443, path: '/x' });
  });
  it('rejects garbage', () => {
    expect(() => parseBrowserAddress('', null)).toThrow(/port/);
    expect(() => parseBrowserAddress('70000', null)).toThrow(/65535/);
    expect(() => parseBrowserAddress('3000/../x', null)).not.toThrow();
  });
  it('formats the address bar', () => {
    expect(browserAddress(3000, '/a')).toBe(':3000/a');
  });
});
