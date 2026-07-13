import { describe, expect, test } from 'bun:test';
import {
  canonicalJson,
  isGranted,
  parsePairingPayload,
  PROVIDER_CREDENTIALS_CAPABILITY,
} from '../src';

describe('device protocol', () => {
  test('canonical JSON is stable across key order', () => {
    expect(canonicalJson({ z: 1, nested: { b: true, a: false } })).toBe(
      canonicalJson({ nested: { a: false, b: true }, z: 1 }),
    );
  });

  test('default membership only permits discovery', () => {
    expect(isGranted([], 'device-core', 1, 'devices.list')).toBe(true);
    expect(isGranted([], 'drone-control', 1, 'drones.list')).toBe(false);
    expect(isGranted([], 'provider-credentials', 1, 'openai.export')).toBe(false);
  });

  test('advertises GROQ credential export as an explicit permission', () => {
    expect(PROVIDER_CREDENTIALS_CAPABILITY.operations).toContain('groq.export');
    expect(
      isGranted(
        [
          {
            capability: 'provider-credentials',
            version: 1,
            operations: ['groq.export'],
          },
        ],
        'provider-credentials',
        1,
        'groq.export',
      ),
    ).toBe(true);
  });

  test('public pairing endpoints require a safe HTTPS origin', () => {
    expect(() =>
      parsePairingPayload({
        version: 1,
        endpoint: 'http://example.com',
        token: 'x',
        inviterDeviceId: 'a',
        expiresAt: 'now',
      }),
    ).toThrow('HTTPS');
    expect(() =>
      parsePairingPayload({
        version: 1,
        endpoint: 'ftp://localhost:8791',
        token: 'x',
        inviterDeviceId: 'a',
        expiresAt: 'now',
      }),
    ).toThrow('HTTPS');
    expect(() =>
      parsePairingPayload({
        version: 1,
        endpoint: 'https://example.com/private/path',
        token: 'x',
        inviterDeviceId: 'a',
        expiresAt: 'now',
      }),
    ).toThrow('origin');
  });
});
