import { expect, test } from 'bun:test';
import { parseNearbyHub } from '../src/mesh/nearby-hub';

const hub = {
  key: 'DroneHub-123',
  id: 'device-123',
  name: 'Desktop',
  endpoint: 'https://desktop.tail.ts.net:8791',
};
test('nearby Hub metadata accepts only bounded exact HTTPS origins', () => {
  expect(parseNearbyHub(JSON.stringify(hub))).toEqual(hub);
  for (const endpoint of [
    'desktop.tail.ts.net',
    'http://desktop.local',
    'https://user:pass@hub.local',
    'https://hub.local/path',
    'https://hub.local?token=secret',
    'https://hub.local/#hash',
    'https://hub.local/',
  ]) {
    expect(() => parseNearbyHub(JSON.stringify({ ...hub, endpoint }))).toThrow();
  }
  for (const bad of [
    { id: '' },
    { name: '' },
    { key: 42 },
    { endpoint: null },
    { name: 'x'.repeat(81) },
  ]) {
    expect(() => parseNearbyHub(JSON.stringify({ ...hub, ...bad }))).toThrow();
  }
  expect(() => parseNearbyHub('x'.repeat(2049))).toThrow();
});
