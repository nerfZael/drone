import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { buildApp } from './app.js';
import { VoiceStreamNextDb } from './db.js';
import {
  VOICE_APPROVAL_SETTINGS_DEFAULT,
  parseVoiceApprovalSettings,
} from './voice-approval-settings.js';

const devHeaders = {
  'content-type': 'application/json',
  'x-voice-dev-user-email': 'approval-settings@example.local',
  'x-voice-dev-user-name': 'Approval Settings',
  'x-voice-dev-admin': '0',
};

function tempDataDir(): string {
  return path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
}

describe('parseVoiceApprovalSettings', () => {
  test('rejects duplicate phrases', () => {
    expect(
      parseVoiceApprovalSettings({
        ...VOICE_APPROVAL_SETTINGS_DEFAULT,
        unlockPhrase: 'approval code',
      }),
    ).toBeNull();
  });

  test('normalizes phrase punctuation and casing', () => {
    const parsed = parseVoiceApprovalSettings({
      ...VOICE_APPROVAL_SETTINGS_DEFAULT,
      unlockPhrase: '  Wake Up Now!  ',
      shutdownPhrase: 'Shut Down, Completely.',
    });
    expect(parsed?.unlockPhrase).toBe('wake up now');
    expect(parsed?.shutdownPhrase).toBe('shut down completely');
  });

  test('accepts custom timing and phrase settings', () => {
    const parsed = parseVoiceApprovalSettings({
      triggerPhrase: 'access code',
      unlockPhrase: 'wake up now',
      shutdownPhrase: 'shut down completely',
      lockCode: '2222',
      minDigits: 3,
      maxDigits: 6,
      stableMs: 500,
      collectTimeoutMs: 2000,
      duplicateCooldownMs: 1000,
      finalizeCheckIntervalMs: 400,
      postPromptCommandSuppressionMs: 900,
    });
    expect(parsed).toEqual({
      triggerPhrase: 'access code',
      unlockPhrase: 'wake up now',
      shutdownPhrase: 'shut down completely',
      lockCode: '2222',
      minDigits: 3,
      maxDigits: 6,
      stableMs: 500,
      collectTimeoutMs: 2000,
      duplicateCooldownMs: 1000,
      finalizeCheckIntervalMs: 400,
      postPromptCommandSuppressionMs: 900,
    });
  });
});

describe('voice approval settings API', () => {
  let dataDir = '';
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let db: VoiceStreamNextDb;

  beforeEach(async () => {
    dataDir = tempDataDir();
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    app = built.app;
    db = built.db;
  });

  afterEach(async () => {
    app.server.closeAllConnections?.();
    await app.close();
    db.db.close();
    delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
  });

  test('returns persisted defaults for new users', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/voice-approval',
      headers: devHeaders,
    });
    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.payload);
    expect(data.settings).toMatchObject(VOICE_APPROVAL_SETTINGS_DEFAULT);
    expect(data.defaults).toEqual(VOICE_APPROVAL_SETTINGS_DEFAULT);
    expect(data.limits.minDigitsMax).toBe(8);
  });

  test('persists custom settings via POST and reloads them on GET', async () => {
    const custom = {
      triggerPhrase: 'gate code',
      unlockPhrase: 'please wake up now',
      shutdownPhrase: 'power down completely',
      lockCode: '8765',
      minDigits: 4,
      maxDigits: 6,
      stableMs: 700,
      collectTimeoutMs: 4000,
      duplicateCooldownMs: 2000,
      finalizeCheckIntervalMs: 300,
      postPromptCommandSuppressionMs: 1200,
    };

    const savedResponse = await app.inject({
      method: 'POST',
      url: '/api/settings/voice-approval',
      headers: devHeaders,
      body: JSON.stringify({ settings: custom }),
    });
    const saved = JSON.parse(savedResponse.payload);
    expect(saved.settings).toMatchObject(custom);

    const loadedResponse = await app.inject({
      method: 'GET',
      url: '/api/settings/voice-approval',
      headers: devHeaders,
    });
    const loaded = JSON.parse(loadedResponse.payload);
    expect(loaded.settings).toMatchObject(custom);
  });

  test('rejects invalid POST payloads', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/voice-approval',
      headers: devHeaders,
      body: JSON.stringify({ settings: { triggerPhrase: '', lockCode: '1' } }),
    });
    expect(response.statusCode).toBe(400);
  });

  test('accepts approval codes authenticated with a device token', async () => {
    const pairingResponse = await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: devHeaders,
      body: JSON.stringify({ deviceType: 'android', displayName: 'Android voice client' }),
    });
    const pairing = JSON.parse(pairingResponse.payload);

    const response = await app.inject({
      method: 'POST',
      url: '/api/voice/approval-codes',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: pairing.device.id,
        token: pairing.token,
        code: '4321',
        source: 'android',
        protocolVersion: 1,
      }),
    });

    expect(response.statusCode).toBe(200);
    const user = db.userByClerkId('dev_approval_settings_example_local');
    expect(user).not.toBeNull();
    expect(db.listApprovalCodes(user!.id, 1)[0]).toMatchObject({
      code: '4321',
      source: 'android',
    });
  });
});
