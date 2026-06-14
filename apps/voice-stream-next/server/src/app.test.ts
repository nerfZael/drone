import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { binaryChunk, binarySize, buildApp } from './app.js';
import type { VoiceRecordingRecord } from './db.js';

const originalEnv = {
  PORT: process.env.PORT,
  VOICE_STREAM_NEXT_API_PORT: process.env.VOICE_STREAM_NEXT_API_PORT,
  VOICE_STREAM_NEXT_DATA_DIR: process.env.VOICE_STREAM_NEXT_DATA_DIR,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const devAuthHeaders = {
  'x-voice-dev-user-email': 'recording-range@example.local',
  'x-voice-dev-user-name': 'Recording Range',
  'x-voice-dev-admin': '0',
};

async function buildAppWithRecording(): Promise<{
  built: Awaited<ReturnType<typeof buildApp>>;
  recording: VoiceRecordingRecord;
  audio: Buffer;
}> {
  process.env.VOICE_STREAM_NEXT_DATA_DIR = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());
  const built = await buildApp({ logger: false });
  const user = built.db.upsertUser({
    clerkUserId: 'dev_recording_range_example_local',
    displayName: 'Recording Range',
    email: 'recording-range@example.local',
    admin: false,
  });
  const device = built.db.registerDevice(user.id, { deviceType: 'desktop', displayName: 'Range Desktop' });
  const session = built.db.createVoiceSession(user.id, device.device.id, 'assistant');
  const audio = Buffer.from('0123456789abcdef');
  const recordingDir = path.join(path.dirname(built.db.path), 'voice-recordings', 'tests');
  mkdirSync(recordingDir, { recursive: true });
  const filePath = path.join(recordingDir, `${session.id}.wav`);
  writeFileSync(filePath, audio);
  const recording = built.db.addVoiceRecording(user.id, {
    voiceSessionId: session.id,
    deviceId: device.device.id,
    assistantThreadId: session.assistantThreadId,
    mode: 'assistant',
    filePath,
    mimeType: 'audio/wav',
    sizeBytes: audio.byteLength,
    durationMs: 1000,
    sampleRateHz: 16_000,
    channels: 1,
  });

  return { built, recording, audio };
}

async function closeBuiltApp(built: Awaited<ReturnType<typeof buildApp>>): Promise<void> {
  built.app.server.closeAllConnections?.();
  await built.app.close();
  built.db.db.close();
}

describe('app configuration', () => {
  afterEach(() => {
    restoreEnv();
  });

  test('uses PORT before the voice-specific API port', async () => {
    process.env.PORT = '43400';
    process.env.VOICE_STREAM_NEXT_API_PORT = '3299';
    process.env.VOICE_STREAM_NEXT_DATA_DIR = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());

    const built = await buildApp({ logger: false });
    try {
      expect(built.port).toBe(43400);
    } finally {
      await built.app.close();
      built.db.db.close();
    }
  });

  test('preserves fragmented binary websocket payloads', () => {
    const fragments = [Buffer.from([1, 2]), new Uint8Array([3, 4]).buffer, new Uint8Array([5, 6, 7]).subarray(1)];

    expect(binarySize(fragments)).toBe(6);
    expect(Array.from(binaryChunk(fragments) ?? [])).toEqual([1, 2, 3, 4, 6, 7]);
  });
});

describe('voice recording audio', () => {
  afterEach(() => {
    restoreEnv();
  });

  test('advertises byte range support on full recording audio responses', async () => {
    const { built, recording, audio } = await buildAppWithRecording();
    try {
      const response = await built.app.inject({
        method: 'GET',
        url: `/api/voice/recordings/${recording.id}/audio`,
        headers: devAuthHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['accept-ranges']).toBe('bytes');
      expect(response.headers['content-length']).toBe(String(audio.byteLength));
      expect(response.payload).toBe(audio.toString());
    } finally {
      await closeBuiltApp(built);
    }
  });

  test('serves requested recording audio byte ranges', async () => {
    const { built, recording, audio } = await buildAppWithRecording();
    try {
      const response = await built.app.inject({
        method: 'GET',
        url: `/api/voice/recordings/${recording.id}/audio`,
        headers: {
          ...devAuthHeaders,
          range: 'bytes=2-5',
        },
      });

      expect(response.statusCode).toBe(206);
      expect(response.headers['accept-ranges']).toBe('bytes');
      expect(response.headers['content-range']).toBe(`bytes 2-5/${audio.byteLength}`);
      expect(response.headers['content-length']).toBe('4');
      expect(response.payload).toBe('2345');
    } finally {
      await closeBuiltApp(built);
    }
  });

  test('rejects unsatisfiable recording audio ranges', async () => {
    const { built, recording, audio } = await buildAppWithRecording();
    try {
      const response = await built.app.inject({
        method: 'GET',
        url: `/api/voice/recordings/${recording.id}/audio`,
        headers: {
          ...devAuthHeaders,
          range: 'bytes=999-1000',
        },
      });

      expect(response.statusCode).toBe(416);
      expect(response.headers['content-range']).toBe(`bytes */${audio.byteLength}`);
      expect(response.headers['content-length']).toBe('0');
      expect(response.payload).toBe('');
    } finally {
      await closeBuiltApp(built);
    }
  });
});
