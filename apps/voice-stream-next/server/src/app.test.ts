import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { binaryChunk, binarySize, buildApp } from './app.js';
import type { VoiceRecordingRecord } from './db.js';
import { pcm16ToWav } from './wav.js';

const originalEnv = {
  PORT: process.env.PORT,
  VOICE_STREAM_NEXT_API_PORT: process.env.VOICE_STREAM_NEXT_API_PORT,
  VOICE_STREAM_NEXT_DATA_DIR: process.env.VOICE_STREAM_NEXT_DATA_DIR,
  VOICE_STREAM_NEXT_TEST_TRANSCRIPT: process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT,
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
  built.db.endVoiceSession(user.id, session.id);

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

  test('retranscribes saved recordings that do not have transcripts', async () => {
    process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = 'Recovered recording transcript';
    const { built, recording } = await buildAppWithRecording();
    try {
      const pcm = new Uint8Array(3200);
      for (let index = 0; index < pcm.length; index += 2) {
        pcm[index] = 0x20;
        pcm[index + 1] = index % 4 === 0 ? 0x03 : 0xfc;
      }
      const wav = Buffer.from(pcm16ToWav(pcm));
      writeFileSync(recording.filePath, wav);
      const updated = built.db.addVoiceRecording(recording.userId, {
        voiceSessionId: recording.voiceSessionId,
        deviceId: recording.deviceId,
        assistantThreadId: recording.assistantThreadId,
        mode: recording.mode,
        filePath: recording.filePath,
        mimeType: 'audio/wav',
        sizeBytes: wav.byteLength,
        durationMs: 100,
        sampleRateHz: 16_000,
        channels: 1,
      });

      const response = await built.app.inject({
        method: 'POST',
        url: `/api/voice/recordings/${updated.id}/transcribe`,
        headers: { ...devAuthHeaders, 'content-type': 'application/json' },
        payload: '{}',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().text).toBe('Recovered recording transcript');
      expect(built.db.voiceRecording(recording.userId, updated.id)?.transcriptText).toBe('Recovered recording transcript');

      const duplicate = await built.app.inject({
        method: 'POST',
        url: `/api/voice/recordings/${updated.id}/transcribe`,
        headers: { ...devAuthHeaders, 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(duplicate.statusCode).toBe(409);
    } finally {
      await closeBuiltApp(built);
    }
  });

  test('rejects retranscribing live recordings', async () => {
    const { built, recording } = await buildAppWithRecording();
    try {
      const liveSession = built.db.createVoiceSession(recording.userId, recording.deviceId, 'clipboard');
      const liveFilePath = path.join(path.dirname(recording.filePath), `${liveSession.id}.wav`);
      writeFileSync(liveFilePath, Buffer.from(pcm16ToWav(new Uint8Array(3200))));
      const liveRecording = built.db.addVoiceRecording(recording.userId, {
        voiceSessionId: liveSession.id,
        deviceId: recording.deviceId,
        assistantThreadId: liveSession.assistantThreadId,
        mode: 'clipboard',
        filePath: liveFilePath,
        mimeType: 'audio/wav',
        sizeBytes: 3244,
        durationMs: 100,
        sampleRateHz: 16_000,
        channels: 1,
      });

      const response = await built.app.inject({
        method: 'POST',
        url: `/api/voice/recordings/${liveRecording.id}/transcribe`,
        headers: { ...devAuthHeaders, 'content-type': 'application/json' },
        payload: '{}',
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe('recording is still live');
    } finally {
      await closeBuiltApp(built);
    }
  });
});
