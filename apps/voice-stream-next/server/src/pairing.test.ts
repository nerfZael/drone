import { describe, expect, test } from 'bun:test';

import {
  buildPairingPayload,
  buildUpdatePayload,
  clientVersionSupported,
  minClientVersion,
  pairingExpiresAt,
  parseClientVersion,
  parsePairingPayload,
} from './pairing.js';

describe('pairing payload', () => {
  test('builds a versioned voicestream URI with expiry and session metadata', () => {
    const expiresAt = '2026-05-21T20:00:00.000Z';
    const built = buildPairingPayload({
      serverUrl: 'http://127.0.0.1:3299',
      deviceId: 'dev_test',
      token: 'abc123',
      deviceType: 'android',
      displayName: 'Android voice client',
        protocolVersion: 1,
        expiresAt,
        pairingSessionId: 'pair_test',
        apkUrl: 'https://example.test/api/mobile/android/apk',
      });

    expect(built.payload.version).toBe(1);
    expect(built.payload.minClientVersion).toBe(minClientVersion());
    expect(built.payload.expiresAt).toBe(expiresAt);
    expect(built.payloadUri).toContain('voicestream://pair?');
    expect(built.payloadUri).toContain('deviceId=dev_test');
    expect(built.payloadUri).toContain('pairingSessionId=pair_test');
    expect(built.payloadUri).toContain('apk=https%3A%2F%2Fexample.test%2Fapi%2Fmobile%2Fandroid%2Fapk');
  });

  test('derives future expiry timestamps from ttl configuration', () => {
    const now = Date.parse('2026-05-21T19:00:00.000Z');
    expect(pairingExpiresAt(now)).toBe('2026-05-21T19:15:00.000Z');
  });

  test('parses numeric client versions from strings and enforces minimum', () => {
    expect(parseClientVersion('2')).toBe(2);
    expect(parseClientVersion('0.1.1', 1)).toBe(0);
    expect(clientVersionSupported(1)).toBe(true);
    expect(clientVersionSupported(0)).toBe(false);
  });

  test('round-trips generated pairing payload URIs', () => {
    const built = buildPairingPayload({
      serverUrl: 'http://127.0.0.1:3299',
      deviceId: 'dev_roundtrip',
      token: 'secret-token',
      deviceType: 'android',
      displayName: 'Android voice client',
      protocolVersion: 1,
      expiresAt: '2026-05-21T20:00:00.000Z',
      pairingSessionId: 'pair_roundtrip',
      apkUrl: 'https://example.test/api/mobile/android/apk',
    });
    const parsed = parsePairingPayload(built.payloadUri);
    expect(parsed.serverUrl).toBe('http://127.0.0.1:3299');
    expect(parsed.deviceId).toBe('dev_roundtrip');
    expect(parsed.token).toBe('secret-token');
    expect(parsed.displayName).toBe('Android voice client');
    expect(parsed.pairingSessionId).toBe('pair_roundtrip');
    expect(parsed.minClientVersion).toBe(minClientVersion());
    expect(parsed.apkUrl).toBe('https://example.test/api/mobile/android/apk');
  });

  test('builds android update payloads', () => {
    expect(buildUpdatePayload({ versionCode: 28, apkUrl: 'https://example.test/app.apk' })).toBe(
      'voicestream://update?versionCode=28&apk=https%3A%2F%2Fexample.test%2Fapp.apk',
    );
  });

  test('rejects malformed pairing payloads', () => {
    expect(() => parsePairingPayload('')).toThrow('pairing payload is empty');
    expect(() => parsePairingPayload('https://example.com/pair')).toThrow('voicestream://pair');
  });
});
