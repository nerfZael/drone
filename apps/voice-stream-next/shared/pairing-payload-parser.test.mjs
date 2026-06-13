import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(scriptDir, 'pairing-payload-parser.js'), 'utf8');
const module = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', source)(module, module.exports);
const {
  clientVersionSupported,
  isUpdatePayload,
  parsePairingPayload,
  parseUpdatePayload,
  pairingPayloadExpired,
  webSocketToHttpUrl,
} = module.exports;

describe('pairing-payload-parser', () => {
  test('parses voicestream pairing payloads', () => {
    const payload =
      'voicestream://pair?serverUrl=https%3A%2F%2Fexample.test&deviceId=device-1&token=abc123&displayName=Desktop&deviceType=desktop&minClientVersion=2&expiresAt=2099-01-01T00%3A00%3A00.000Z&pairingSessionId=session-1&apk=https%3A%2F%2Fexample.test%2Fapi%2Fmobile%2Fandroid%2Fapk';

    const config = parsePairingPayload(payload);

    expect(config.serverUrl).toBe('https://example.test');
    expect(config.deviceId).toBe('device-1');
    expect(config.token).toBe('abc123');
    expect(config.deviceName).toBe('Desktop');
    expect(config.minClientVersion).toBe(2);
    expect(config.pairingSessionId).toBe('session-1');
    expect(config.apkUrl).toBe('https://example.test/api/mobile/android/apk');
  });

  test('parses direct websocket URLs with token', () => {
    const config = parsePairingPayload('ws://192.168.1.20:3299/audio?token=abc123');

    expect(config.serverUrl).toBe('http://192.168.1.20:3299');
    expect(config.token).toBe('abc123');
    expect(config.deviceId).toBe('');
  });

  test('parses websocket URLs with device id', () => {
    const config = parsePairingPayload('wss://example.test/audio?token=abc123&deviceId=device-9');

    expect(config.serverUrl).toBe('https://example.test');
    expect(config.deviceId).toBe('device-9');
    expect(config.token).toBe('abc123');
  });

  test('converts websocket URLs to HTTP base URLs', () => {
    expect(webSocketToHttpUrl('wss://example.test:3299/audio?token=abc')).toBe('https://example.test:3299');
    expect(webSocketToHttpUrl('ws://10.0.0.5:3299')).toBe('http://10.0.0.5:3299');
  });

  test('detects update payloads', () => {
    const payload = 'voicestream://update?versionCode=28&apk=https%3A%2F%2Fexample.test%2Fapp.apk';
    expect(isUpdatePayload(payload)).toBe(true);
    expect(parseUpdatePayload(payload)).toEqual({
      versionCode: 28,
      apkUrl: 'https://example.test/app.apk',
    });
  });

  test('rejects invalid payloads', () => {
    expect(() => parsePairingPayload('')).toThrow('Pairing text is empty');
    expect(() => parsePairingPayload('https://example.test/')).toThrow('VoiceStream pairing payload');
    expect(() => parsePairingPayload('wss://example.test/audio')).toThrow('pairing token');
    expect(() => parseUpdatePayload('voicestream://update?apk=https%3A%2F%2Fexample.test%2Fapp.apk')).toThrow('app version');
  });

  test('checks expiry and minimum client version', () => {
    expect(pairingPayloadExpired('2000-01-01T00:00:00.000Z')).toBe(true);
    expect(pairingPayloadExpired('2099-01-01T00:00:00.000Z')).toBe(false);
    expect(clientVersionSupported(1)).toBe(true);
    expect(clientVersionSupported(2)).toBe(false);
  });
});
