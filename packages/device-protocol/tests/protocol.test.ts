import { describe, expect, test } from 'bun:test';
import { canonicalJson, isGranted, parsePairingPayload } from '../src';

describe('device protocol', () => {
  test('canonical JSON is stable across key order', () => {
    expect(canonicalJson({ z: 1, nested: { b: true, a: false } })).toBe(
      canonicalJson({ nested: { a: false, b: true }, z: 1 }),
    );
  });

  test('default membership only permits discovery', () => {
    expect(isGranted([], 'device-core', 1, 'devices.list')).toBe(true);
    expect(isGranted([], 'drone-control', 1, 'drones.list')).toBe(false);
  });

  test('public pairing endpoints require HTTPS', () => {
    expect(() =>
      parsePairingPayload({
        version: 1,
        endpoint: 'http://example.com',
        token: 'x',
        inviterDeviceId: 'a',
        expiresAt: 'now',
      }),
    ).toThrow('HTTPS');
  });
});
