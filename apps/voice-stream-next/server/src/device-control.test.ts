import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { buildApp } from './app.js';
import { ControlChannelRegistry } from './control-channel.js';
import { VoiceStreamNextDb } from './db.js';
import { buildPairingPayload, pairingExpiresAt } from './pairing.js';

function tempDb(name: string): VoiceStreamNextDb {
  const dir = path.join(process.cwd(), 'server', 'data', 'tests');
  return new VoiceStreamNextDb(path.join(dir, `${name}-${crypto.randomUUID()}.sqlite`));
}

describe('device lifecycle', () => {
  const dbs: VoiceStreamNextDb[] = [];

  afterEach(() => {
    for (const db of dbs) db.db.close();
    dbs.length = 0;
  });

  test('rejects expired unclaimed pairing tokens and accepts after claim', () => {
    const db = tempDb('pairing-expiry');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_pairing',
      displayName: 'Pairing User',
      email: 'pairing@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' });
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    db.createPairingSession(user.id, registered.device.id, expiredAt);

    expect(db.verifyDeviceToken(registered.device.id, registered.token).ok).toBe(false);
    expect(db.listDevices(user.id).some((device) => device.id === registered.device.id)).toBe(false);
    expect(db.deviceForUser(user.id, registered.device.id)?.revokedAt).toBeTruthy();

    const fresh = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone 2' });
    const future = pairingExpiresAt();
    db.createPairingSession(user.id, fresh.device.id, future);
    const first = db.verifyDeviceToken(fresh.device.id, fresh.token, { clientVersion: 1, minClientVersion: 1 });
    expect(first.ok).toBe(true);
    const second = db.verifyDeviceToken(fresh.device.id, fresh.token, { clientVersion: 1, minClientVersion: 1 });
    expect(second.ok).toBe(true);
  });

  test('revokes devices and rotates tokens independently', () => {
    const db = tempDb('device-mgmt');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_devices',
      displayName: 'Device User',
      email: 'devices@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desktop' });
    expect(db.verifyDeviceToken(registered.device.id, registered.token).ok).toBe(true);

    const rotated = db.rotateDeviceToken(user.id, registered.device.id);
    expect(rotated?.token).not.toBe(registered.token);
    expect(db.verifyDeviceToken(registered.device.id, registered.token).ok).toBe(false);
    expect(db.verifyDeviceToken(registered.device.id, rotated!.token).ok).toBe(true);

    const revoked = db.revokeDevice(user.id, registered.device.id);
    expect(revoked?.revokedAt).toBeTruthy();
    expect(db.verifyDeviceToken(registered.device.id, rotated!.token).ok).toBe(false);
  });

  test('renames active devices without changing revoked devices', () => {
    const db = tempDb('device-rename');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_device_rename',
      displayName: 'Device Rename User',
      email: 'device-rename@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' });

    const renamed = db.updateDeviceName(user.id, registered.device.id, 'Kitchen phone');
    expect(renamed?.displayName).toBe('Kitchen phone');

    db.revokeDevice(user.id, registered.device.id);
    expect(db.updateDeviceName(user.id, registered.device.id, 'Old phone')).toBeNull();
  });

  test('backfills installation ids for existing desktop pairings', () => {
    const db = tempDb('installation-backfill');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_installation',
      displayName: 'Installation User',
      email: 'installation@example.local',
      admin: false,
    });
    const legacy = db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Desktop' });
    expect(legacy.device.installationId).toBeNull();

    const assigned = db.assignDeviceInstallationId(user.id, legacy.device.id, 'desktop_install_legacy');
    expect(assigned?.id).toBe(legacy.device.id);
    expect(assigned?.installationId).toBe('desktop_install_legacy');

    const reused = db.registerDevice(user.id, {
      deviceType: 'desktop',
      displayName: 'Desktop Renamed',
      installationId: 'desktop_install_legacy',
    });
    expect(reused.device.id).toBe(legacy.device.id);
    expect(reused.device.displayName).toBe('Desktop Renamed');
    expect(db.listDevices(user.id).filter((device) => device.installationId === 'desktop_install_legacy')).toHaveLength(1);
  });

  test('reuses Android device records by installation id', () => {
    const db = tempDb('android-installation');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_android_installation',
      displayName: 'Android Installation User',
      email: 'android-installation@example.local',
      admin: false,
    });

    const first = db.registerDevice(user.id, {
      deviceType: 'android',
      displayName: 'Android Phone',
      installationId: 'android_install_1',
    });
    const second = db.registerDevice(user.id, {
      deviceType: 'android',
      displayName: 'Android Phone Renamed',
      installationId: 'android_install_1',
    });

    expect(second.device.id).toBe(first.device.id);
    expect(second.device.displayName).toBe('Android Phone Renamed');
    expect(db.listDevices(user.id).filter((device) => device.installationId === 'android_install_1')).toHaveLength(1);
    expect(db.verifyDeviceToken(first.device.id, first.token).ok).toBe(false);
    expect(db.verifyDeviceToken(second.device.id, second.token).ok).toBe(true);
  });

  test('merges QR-created Android devices into an existing installation during bootstrap', () => {
    const db = tempDb('android-bootstrap-merge');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_android_bootstrap_merge',
      displayName: 'Android Bootstrap User',
      email: 'android-bootstrap@example.local',
      admin: false,
    });
    const existing = db.registerDevice(user.id, {
      deviceType: 'android',
      displayName: 'Existing Phone',
      installationId: 'android_install_merge_1',
    });
    const qrCreated = db.registerDevice(user.id, {
      deviceType: 'android',
      displayName: 'QR Phone',
    });
    db.createPairingSession(user.id, qrCreated.device.id, pairingExpiresAt());
    expect(db.verifyDeviceToken(qrCreated.device.id, qrCreated.token).ok).toBe(true);

    const merged = db.assignDeviceInstallationId(user.id, qrCreated.device.id, 'android_install_merge_1', qrCreated.token);

    expect(merged?.id).toBe(existing.device.id);
    expect(merged?.displayName).toBe('QR Phone');
    expect(db.listDevices(user.id).map((device) => device.id)).toEqual([existing.device.id]);
    expect(db.deviceForUser(user.id, qrCreated.device.id)?.revokedAt).toBeTruthy();
    expect(db.verifyDeviceToken(existing.device.id, existing.token).ok).toBe(false);
    expect(db.verifyDeviceToken(existing.device.id, qrCreated.token).ok).toBe(true);
  });

  test('hides revoked devices from client status lists', () => {
    const db = tempDb('revoked-status');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_revoked_status',
      displayName: 'Revoked Status User',
      email: 'revoked-status@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' });
    db.upsertClientStatus(user.id, registered.device.id, {
      mode: 'awake',
      status: 'Awake',
      protocolVersion: 1,
    });
    expect(db.listClientStatuses(user.id)).toHaveLength(1);

    db.revokeDevice(user.id, registered.device.id);
    expect(db.listClientStatuses(user.id)).toHaveLength(0);
    expect(db.listClientStatuses()).toHaveLength(0);
  });

  test('rejects clients below the configured minimum version', () => {
    const db = tempDb('client-version');
    dbs.push(db);
    const user = db.upsertUser({
      clerkUserId: 'clerk_version',
      displayName: 'Version User',
      email: 'version@example.local',
      admin: false,
    });
    const registered = db.registerDevice(user.id, { deviceType: 'android', displayName: 'Phone' });
    const result = db.verifyDeviceToken(registered.device.id, registered.token, { clientVersion: 0, minClientVersion: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('client_too_old');
  });
});

describe('control channel registry', () => {
  test('delivers commands and resolves pending acks', async () => {
    const registry = new ControlChannelRegistry();
    const messages: string[] = [];
    const socket = {
      readyState: 1,
      send(data: string) {
        messages.push(data);
      },
    };
    registry.register('dev_1', socket);
    const pending = registry.sendCommand('dev_1', 'query_status', 'test');
    expect(messages).toHaveLength(1);
    const payload = JSON.parse(messages[0]!);
    registry.handleCommandAck('dev_1', {
      type: 'command_ack',
      commandId: payload.commandId,
      ok: true,
      command: 'query_status',
      mode: 'awake',
      status: 'Ready',
    });
    const result = await pending;
    expect(result.delivered).toBe(true);
    expect(result.ack?.status).toBe('Ready');
  });
});

describe('pairing payload integration', () => {
  test('includes rotated token details for refreshed QR payloads', () => {
    const built = buildPairingPayload({
      serverUrl: 'http://127.0.0.1:3299',
      deviceId: 'dev_rotated',
      token: 'rotated-token',
      deviceType: 'android',
      displayName: 'Android',
      protocolVersion: 1,
      expiresAt: pairingExpiresAt(),
      pairingSessionId: 'pair_rotated',
    });
    expect(built.payload.token).toBe('rotated-token');
    expect(built.payload.minClientVersion).toBeGreaterThan(0);
  });
});

describe('voice session device validation', () => {
  test('allows paired devices to create sessions and logs with device tokens', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      const headers = {
        'content-type': 'application/json',
        'x-voice-dev-user-email': 'device-token@example.local',
        'x-voice-dev-user-name': 'Device Token',
        'x-voice-dev-admin': '0',
      };
      const registered = await built.app.inject({
        method: 'POST',
        url: '/api/devices',
        headers,
        payload: JSON.stringify({ deviceType: 'desktop', displayName: 'Token Desktop' }),
      }).then((response) => response.json());

      const sessionResponse = await built.app.inject({
        method: 'POST',
        url: '/api/voice/sessions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ deviceId: registered.device.id, token: registered.token, mode: 'assistant' }),
      });
      expect(sessionResponse.statusCode).toBe(200);
      expect(sessionResponse.json().session.deviceId).toBe(registered.device.id);

      const logResponse = await built.app.inject({
        method: 'POST',
        url: '/api/logs',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ deviceId: registered.device.id, token: registered.token, source: 'desktop', level: 'info', message: 'Device token log' }),
      });
      expect(logResponse.statusCode).toBe(200);
      expect(logResponse.json().log.message).toBe('Device token log');
    } finally {
      await built.app.close();
      built.db.db.close();
      delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
    }
  });

  test('normalizes public device registration types before reusing installation ids', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      const headers = {
        'content-type': 'application/json',
        'x-voice-dev-user-email': 'device-type-normalize@example.local',
        'x-voice-dev-user-name': 'Device Type Normalize',
        'x-voice-dev-admin': '0',
      };
      const first = await built.app.inject({
        method: 'POST',
        url: '/api/devices',
        headers,
        payload: JSON.stringify({ deviceType: 'Android', displayName: 'Phone', installationId: 'android_install_type_1' }),
      }).then((response) => response.json());

      const second = await built.app.inject({
        method: 'POST',
        url: '/api/devices',
        headers,
        payload: JSON.stringify({ deviceType: 'android', displayName: 'Phone Renamed', installationId: 'android_install_type_1' }),
      }).then((response) => response.json());

      expect(first.device.deviceType).toBe('android');
      expect(second.device.id).toBe(first.device.id);
      expect(second.device.displayName).toBe('Phone Renamed');
      expect(built.db.listDevices().filter((device) => device.installationId === 'android_install_type_1')).toHaveLength(1);
    } finally {
      await built.app.close();
      built.db.db.close();
      delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
    }
  });

  test('status updates return the resolved device after installation merge', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      const user = built.db.upsertUser({
        clerkUserId: 'dev_status_merge',
        displayName: 'Status Merge User',
        email: 'status-merge@example.local',
        admin: false,
      });
      const existing = built.db.registerDevice(user.id, {
        deviceType: 'android',
        displayName: 'Existing Phone',
        installationId: 'android_install_status_1',
      });
      const temporary = built.db.registerDevice(user.id, {
        deviceType: 'android',
        displayName: 'Temporary Phone',
      });

      const response = await built.app.inject({
        method: 'POST',
        url: `/api/devices/${encodeURIComponent(temporary.device.id)}/status`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          token: temporary.token,
          installationId: 'android_install_status_1',
          mode: 'awake',
          status: 'Awake',
          protocolVersion: 1,
        }),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.device.id).toBe(existing.device.id);
      expect(body.status.deviceId).toBe(existing.device.id);
      expect(built.db.deviceForUser(user.id, temporary.device.id)?.revokedAt).toBeTruthy();
      expect(built.db.verifyDeviceToken(existing.device.id, temporary.token).ok).toBe(true);
    } finally {
      await built.app.close();
      built.db.db.close();
      delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
    }
  });

  test('returns unknown device for stale desktop pairing', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      built.db.upsertUser({
        clerkUserId: 'dev_existing_release_admin',
        displayName: 'Existing Admin',
        email: 'existing-release-admin@example.local',
        admin: true,
      });
      const response = await built.app.inject({
        method: 'POST',
        url: '/api/voice/sessions',
        headers: {
          'content-type': 'application/json',
          'x-voice-dev-user-email': 'stale-desktop@example.local',
          'x-voice-dev-user-name': 'Stale Desktop',
          'x-voice-dev-admin': '0',
        },
        payload: JSON.stringify({ deviceId: 'dev_missing', mode: 'assistant' }),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('unknown device');
    } finally {
      await built.app.close();
      built.db.db.close();
      delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
    }
  });

  test('auto-connects desktop through browser-auth claim flow', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      const requestResponse = await built.app.inject({
        method: 'POST',
        url: '/api/desktop-auth/requests',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ displayName: 'Browser Desktop', installationId: 'desktop_install_1' }),
      });
      expect(requestResponse.statusCode).toBe(200);
      const request = requestResponse.json();
      expect(String(request.requestId).startsWith('dauth_')).toBe(true);
      expect(request.secret).toBeTruthy();
      expect(request.deviceToken).toBeTruthy();

      const claimResponse = await built.app.inject({
        method: 'POST',
        url: '/api/desktop-auth/claim',
        headers: {
          'content-type': 'application/json',
          'x-voice-dev-user-email': 'browser-desktop@example.local',
          'x-voice-dev-user-name': 'Browser Desktop User',
          'x-voice-dev-admin': '0',
        },
        payload: JSON.stringify({ requestId: request.requestId, secret: request.secret }),
      });
      expect(claimResponse.statusCode).toBe(200);
      const claimed = claimResponse.json();
      expect(claimed.device.deviceType).toBe('desktop');
      expect(claimed.device.displayName).toBe('Browser Desktop');

      const resultResponse = await built.app.inject({
        method: 'POST',
        url: '/api/desktop-auth/result',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ requestId: request.requestId, secret: request.secret }),
      });
      expect(resultResponse.statusCode).toBe(200);
      expect(resultResponse.json().status).toBe('claimed');

      const sessionResponse = await built.app.inject({
        method: 'POST',
        url: '/api/voice/sessions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ deviceId: claimed.device.id, token: request.deviceToken, mode: 'assistant' }),
      });
      expect(sessionResponse.statusCode).toBe(200);
      expect(sessionResponse.json().session.deviceId).toBe(claimed.device.id);

      const bootstrapResponse = await built.app.inject({
        method: 'GET',
        url: `/api/devices/${encodeURIComponent(claimed.device.id)}/bootstrap`,
        headers: { 'x-voice-device-token': request.deviceToken },
      });
      expect(bootstrapResponse.statusCode).toBe(200);
      expect(bootstrapResponse.json().device.id).toBe(claimed.device.id);
      expect(bootstrapResponse.json().settings.unlockPhrase).toBeTruthy();
      expect(bootstrapResponse.json().settings.shutdownPhrase).toBeTruthy();

      const secondRequestResponse = await built.app.inject({
        method: 'POST',
        url: '/api/desktop-auth/requests',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ displayName: 'Browser Desktop Renamed', installationId: 'desktop_install_1' }),
      });
      expect(secondRequestResponse.statusCode).toBe(200);
      const secondRequest = secondRequestResponse.json();

      const secondClaimResponse = await built.app.inject({
        method: 'POST',
        url: '/api/desktop-auth/claim',
        headers: {
          'content-type': 'application/json',
          'x-voice-dev-user-email': 'browser-desktop@example.local',
          'x-voice-dev-user-name': 'Browser Desktop User',
          'x-voice-dev-admin': '0',
        },
        payload: JSON.stringify({ requestId: secondRequest.requestId, secret: secondRequest.secret }),
      });
      expect(secondClaimResponse.statusCode).toBe(200);
      const secondClaimed = secondClaimResponse.json();
      expect(secondClaimed.device.id).toBe(claimed.device.id);
      expect(secondClaimed.device.displayName).toBe('Browser Desktop Renamed');
      expect(built.db.listDevices().filter((device) => device.installationId === 'desktop_install_1')).toHaveLength(1);
      expect(built.db.verifyDeviceToken(claimed.device.id, request.deviceToken).ok).toBe(false);
      expect(built.db.verifyDeviceToken(claimed.device.id, secondRequest.deviceToken).ok).toBe(true);
    } finally {
      await built.app.close();
      built.db.db.close();
      delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
    }
  });

  test('auto-connects Android through browser-auth claim flow with installation reuse', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      const requestResponse = await built.app.inject({
        method: 'POST',
        url: '/api/desktop-auth/requests',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ displayName: 'Browser Phone', deviceType: 'android', installationId: 'android_install_browser_1' }),
      });
      expect(requestResponse.statusCode).toBe(200);
      const request = requestResponse.json();

      const claimResponse = await built.app.inject({
        method: 'POST',
        url: '/api/desktop-auth/claim',
        headers: {
          'content-type': 'application/json',
          'x-voice-dev-user-email': 'browser-phone@example.local',
          'x-voice-dev-user-name': 'Browser Phone User',
          'x-voice-dev-admin': '0',
        },
        payload: JSON.stringify({ requestId: request.requestId, secret: request.secret }),
      });
      expect(claimResponse.statusCode).toBe(200);
      const claimed = claimResponse.json();
      expect(claimed.device.deviceType).toBe('android');
      expect(claimed.device.displayName).toBe('Browser Phone');

      const secondRequestResponse = await built.app.inject({
        method: 'POST',
        url: '/api/desktop-auth/requests',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ displayName: 'Browser Phone Renamed', deviceType: 'android', installationId: 'android_install_browser_1' }),
      });
      expect(secondRequestResponse.statusCode).toBe(200);
      const secondRequest = secondRequestResponse.json();

      const secondClaimResponse = await built.app.inject({
        method: 'POST',
        url: '/api/desktop-auth/claim',
        headers: {
          'content-type': 'application/json',
          'x-voice-dev-user-email': 'browser-phone@example.local',
          'x-voice-dev-user-name': 'Browser Phone User',
          'x-voice-dev-admin': '0',
        },
        payload: JSON.stringify({ requestId: secondRequest.requestId, secret: secondRequest.secret }),
      });
      expect(secondClaimResponse.statusCode).toBe(200);
      const secondClaimed = secondClaimResponse.json();
      expect(secondClaimed.device.id).toBe(claimed.device.id);
      expect(secondClaimed.device.deviceType).toBe('android');
      expect(secondClaimed.device.displayName).toBe('Browser Phone Renamed');
      expect(built.db.listDevices().filter((device) => device.installationId === 'android_install_browser_1')).toHaveLength(1);
      expect(built.db.verifyDeviceToken(claimed.device.id, request.deviceToken).ok).toBe(false);
      expect(built.db.verifyDeviceToken(claimed.device.id, secondRequest.deviceToken).ok).toBe(true);
    } finally {
      await built.app.close();
      built.db.db.close();
      delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
    }
  });

  test('voice session creation merges temporary Android pairing into existing installation', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      const user = built.db.upsertUser({
        clerkUserId: 'dev_voice_merge',
        displayName: 'Voice Merge User',
        email: 'voice-merge@example.local',
        admin: false,
      });
      const existing = built.db.registerDevice(user.id, {
        deviceType: 'android',
        displayName: 'Existing Phone',
        installationId: 'android_install_voice_1',
      });
      const temporary = built.db.registerDevice(user.id, {
        deviceType: 'android',
        displayName: 'Temporary Phone',
      });

      const sessionResponse = await built.app.inject({
        method: 'POST',
        url: '/api/voice/sessions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          deviceId: temporary.device.id,
          token: temporary.token,
          installationId: 'android_install_voice_1',
          mode: 'assistant',
          protocolVersion: 1,
        }),
      });

      expect(sessionResponse.statusCode).toBe(200);
      const body = sessionResponse.json();
      expect(body.device.id).toBe(existing.device.id);
      expect(body.session.deviceId).toBe(existing.device.id);
      expect(body.device.displayName).toBe('Temporary Phone');
      expect(built.db.deviceForUser(user.id, temporary.device.id)?.revokedAt).toBeTruthy();
      expect(built.db.verifyDeviceToken(existing.device.id, temporary.token).ok).toBe(true);
    } finally {
      await built.app.close();
      built.db.db.close();
      delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
    }
  });
});

describe('desktop app downloads', () => {
  afterEach(() => {
    delete process.env.VOICE_STREAM_NEXT_DATA_DIR;
  });

  test('serves the published desktop archive metadata and file', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    const desktopDir = path.join(dataDir, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'voice-stream-next-desktop-latest.tar.gz'), 'desktop archive');
    fs.writeFileSync(path.join(desktopDir, 'latest.json'), JSON.stringify({
      app: 'voice-stream-next',
      platform: 'desktop',
      variant: 'linux-x64',
      fileName: 'voice-stream-next-desktop-latest.tar.gz',
      builtAt: '2026-05-25T00:00:00.000Z',
    }));
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      const metadata = await built.app.inject({ method: 'GET', url: '/api/desktop' });
      expect(metadata.statusCode).toBe(200);
      expect(metadata.json().desktop.available).toBe(true);
      expect(metadata.json().desktop.downloadUrl).toContain('/api/desktop/download');

      expect(metadata.json().desktop.fileName).toBe('voice-stream-next-desktop-latest.tar.gz');
      expect(metadata.json().desktop.size).toBe('desktop archive'.length);
    } finally {
      await built.app.close();
      built.db.db.close();
    }
  });

  test('lets admins upload Android and desktop release artifacts', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      const adminHeaders = {
        'content-type': 'application/octet-stream',
        'x-voice-dev-user-email': 'release-admin@example.local',
        'x-voice-dev-user-name': 'Release Admin',
        'x-voice-dev-admin': '1',
      };
      const androidResponse = await built.app.inject({
        method: 'PUT',
        url: '/api/admin/releases/android',
        headers: {
          ...adminHeaders,
          'x-voice-release-file-name': 'voice-stream-next-android-release.apk',
          'x-voice-release-metadata': JSON.stringify({
            app: 'voice-stream-next',
            platform: 'android',
            variant: 'release',
            versionCode: 77,
            versionName: '1.2.3',
            builtAt: '2026-05-25T00:00:00.000Z',
          }),
        },
        payload: Buffer.from('apk bytes'),
      });
      expect(androidResponse.statusCode).toBe(200);
      expect(androidResponse.json().android.available).toBe(true);
      expect(androidResponse.json().android.versionCode).toBe(77);

      const desktopResponse = await built.app.inject({
        method: 'PUT',
        url: '/api/admin/releases/desktop',
        headers: {
          ...adminHeaders,
          'x-voice-release-file-name': 'VoiceStream-linux-x64.tar.gz',
          'x-voice-release-metadata': JSON.stringify({
            app: 'voice-stream-next',
            platform: 'desktop',
            variant: 'linux-x64',
            fileName: 'VoiceStream-linux-x64.tar.gz',
            builtAt: '2026-05-25T00:00:00.000Z',
          }),
        },
        payload: Buffer.from('desktop bytes'),
      });
      expect(desktopResponse.statusCode).toBe(200);
      expect(desktopResponse.json().desktop.available).toBe(true);
      expect(desktopResponse.json().desktop.fileName).toBe('voice-stream-next-desktop-latest.tar.gz');

      const androidMetadata = await built.app.inject({ method: 'GET', url: '/api/mobile/android' });
      expect(androidMetadata.json().android.downloadUrl).toContain('/api/mobile/android/apk');
      const desktopMetadata = await built.app.inject({ method: 'GET', url: '/api/desktop' });
      expect(desktopMetadata.json().desktop.downloadUrl).toContain('/api/desktop/download');
    } finally {
      await built.app.close();
      built.db.db.close();
    }
  });

  test('rejects release uploads from non-admin users', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      built.db.upsertUser({
        clerkUserId: 'dev_existing_release_admin',
        displayName: 'Existing Admin',
        email: 'existing-release-admin@example.local',
        admin: true,
      });
      const response = await built.app.inject({
        method: 'PUT',
        url: '/api/admin/releases/android?variant=release',
        headers: {
          'content-type': 'application/octet-stream',
          'x-voice-dev-user-email': 'release-user@example.local',
          'x-voice-dev-user-name': 'Release User',
          'x-voice-dev-admin': '0',
        },
        payload: Buffer.from('apk bytes'),
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe('admin access required');
    } finally {
      await built.app.close();
      built.db.db.close();
    }
  });

  test('rejects admin release uploads without companion metadata', async () => {
    const dataDir = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
    process.env.VOICE_STREAM_NEXT_DATA_DIR = dataDir;
    const built = await buildApp({ logger: false });
    try {
      const response = await built.app.inject({
        method: 'PUT',
        url: '/api/admin/releases/android',
        headers: {
          'content-type': 'application/octet-stream',
          'x-voice-dev-user-email': 'missing-metadata-admin@example.local',
          'x-voice-dev-user-name': 'Missing Metadata Admin',
          'x-voice-dev-admin': '1',
          'x-voice-release-file-name': 'voice-stream-next-android-release.apk',
        },
        payload: Buffer.from('apk bytes'),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('android release metadata file is required');
    } finally {
      await built.app.close();
      built.db.db.close();
    }
  });
});
