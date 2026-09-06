import { expect, test } from 'bun:test';
import {
  allowBrowserNavigation,
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
