import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { binaryChunk, binarySize, buildApp, mergeTimestampedTranscriptText, mergeTranscriptText, openAiRealtimeAudioConfig, openAiSafetyIdentifier } from './app.js';
import type { VoiceRecordingRecord } from './db.js';
import { openAiRealtimeWebRtcSessionConfig, realtimeCallIdFromLocation } from './openai-realtime-webrtc.js';
import { realtimeStopTranscript, realtimeStreamingTranscript } from './realtime-transcript.js';
import { pcm16ToWav } from './wav.js';

const originalEnv = {
  PORT: process.env.PORT,
  VOICE_STREAM_NEXT_API_PORT: process.env.VOICE_STREAM_NEXT_API_PORT,
  VOICE_STREAM_NEXT_DATA_DIR: process.env.VOICE_STREAM_NEXT_DATA_DIR,
  VOICE_STREAM_NEXT_TEST_TRANSCRIPT: process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT,
  VOICE_STREAM_NEXT_FFMPEG_PATH: process.env.VOICE_STREAM_NEXT_FFMPEG_PATH,
  VOICE_STREAM_NEXT_SECRETS_KEY: process.env.VOICE_STREAM_NEXT_SECRETS_KEY,
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

  test('keeps OpenAI Realtime safety identifiers below the header limit', () => {
    const id = openAiSafetyIdentifier(
      'usr_1234567890abcdefghijklmnopqrstuvwxyz_1234567890abcdefghijklmnopqrstuvwxyz',
      'dev_1234567890abcdefghijklmnopqrstuvwxyz_1234567890abcdefghijklmnopqrstuvwxyz',
    );

    expect(id.length).toBeLessThanOrEqual(64);
    expect(id).toMatch(/^vsn_[a-f0-9]{32}$/);
    expect(id).toBe(openAiSafetyIdentifier(
      'usr_1234567890abcdefghijklmnopqrstuvwxyz_1234567890abcdefghijklmnopqrstuvwxyz',
      'dev_1234567890abcdefghijklmnopqrstuvwxyz_1234567890abcdefghijklmnopqrstuvwxyz',
    ));
    expect(id).not.toBe(openAiSafetyIdentifier(
      'usr_1234567890abcdefghijklmnopqrstuvwxyz_1234567890abcdefghijklmnopqrstuvwxyz',
      'dev_different',
    ));
  });

  test('includes required sample rates in OpenAI Realtime audio config', () => {
    expect(openAiRealtimeAudioConfig()).toMatchObject({
      input: {
        format: {
          type: 'audio/pcm',
          rate: 24_000,
        },
      },
      output: {
        format: {
          type: 'audio/pcm',
          rate: 24_000,
        },
      },
    });
  });

  test('builds OpenAI Realtime WebRTC config without PCM transport formats', () => {
    const config = openAiRealtimeWebRtcSessionConfig({
      env: {},
      instructions: 'Voice Stream realtime instructions',
      tools: [{
        type: 'function',
        name: 'list_threads',
        parameters: { type: 'object', properties: {} },
      }],
    });

    expect(config).toMatchObject({
      type: 'realtime',
      model: 'gpt-realtime-2',
      instructions: 'Voice Stream realtime instructions',
      output_modalities: ['audio'],
      tool_choice: 'auto',
      audio: {
        input: {
          transcription: {
            model: 'gpt-realtime-whisper',
            delay: 'high',
          },
          turn_detection: {
            type: 'semantic_vad',
            eagerness: 'low',
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          voice: 'cedar',
        },
      },
    });
    expect(JSON.stringify(config)).not.toContain('audio/pcm');
  });

  test('parses OpenAI Realtime WebRTC call ids from Location headers', () => {
    expect(realtimeCallIdFromLocation('/v1/realtime/calls/rtc_123456')).toBe('rtc_123456');
    expect(realtimeCallIdFromLocation('https://api.openai.com/v1/realtime/calls/rtc_abcdef?source=test')).toBe('rtc_abcdef');
    expect(realtimeCallIdFromLocation('')).toBe('');
  });

  test('detects realtime stop transcript phrases without persisting the command', () => {
    expect(realtimeStopTranscript("that's it")).toEqual({ stop: true, text: '', hasText: false });
    expect(realtimeStopTranscript('That is it.')).toEqual({ stop: true, text: '', hasText: false });
    expect(realtimeStopTranscript('Please remember Julio, thats it.')).toEqual({
      stop: true,
      text: 'Please remember Julio',
      hasText: true,
    });
    expect(realtimeStreamingTranscript('Please remember Julio, that is it.')).toEqual({
      stop: true,
      text: 'Please remember Julio',
      hasText: true,
    });
  });

  test('merges overlapping transcript text when wording is not identical', () => {
    expect(
      mergeTranscriptText(
        'We should save the recording before final transcription so recovery still works',
        'the recording before final transcription, so recovery still works even if Groq fails',
      ),
    ).toBe('We should save the recording before final transcription so recovery still works even if Groq fails');

    expect(
      mergeTranscriptText(
        'The chunk boundary can land inside a sentence and Whisper may rewrite a few words there',
        'boundary could land inside the sentence, and whisper may rewrite a few words there when context changes',
      ),
    ).toBe('The chunk boundary can land inside a sentence and Whisper may rewrite a few words there when context changes');

    expect(mergeTranscriptText('This is a complete first thought', 'This is a different second thought')).toBe(
      'This is a complete first thought This is a different second thought',
    );
  });

  test('merges timestamped transcript segments without duplicating covered overlap', () => {
    const segments = [
      { startMs: 0, endMs: 2000, text: 'The first chunk ends with context', avgLogprob: null, compressionRatio: null, noSpeechProb: null },
      { startMs: 2000, endMs: 4000, text: 'that should not be duplicated', avgLogprob: null, compressionRatio: null, noSpeechProb: null },
    ];

    const merged = mergeTimestampedTranscriptText('The first chunk ends with context that should not be duplicated', segments, [
      { startMs: 2500, endMs: 3800, text: 'that should not be duplicated', avgLogprob: null, compressionRatio: null, noSpeechProb: null },
      { startMs: 3800, endMs: 5600, text: 'and then continues normally', avgLogprob: null, compressionRatio: null, noSpeechProb: null },
    ]);

    expect(merged).toBe('The first chunk ends with context that should not be duplicated and then continues normally');
  });

  test('keeps short timestamped segments that start after the covered overlap', () => {
    const segments = [
      { startMs: 0, endMs: 4000, text: 'The first chunk is complete', avgLogprob: null, compressionRatio: null, noSpeechProb: null },
    ];

    const merged = mergeTimestampedTranscriptText('The first chunk is complete', segments, [
      { startMs: 4250, endMs: 5200, text: 'before the final words', avgLogprob: null, compressionRatio: null, noSpeechProb: null },
      { startMs: 4050, endMs: 4200, text: 'and', avgLogprob: null, compressionRatio: null, noSpeechProb: null },
    ]);

    expect(merged).toBe('The first chunk is complete and before the final words');
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

  test('retranscribes long saved recordings in windows when whole-file upload is too large', async () => {
    process.env.VOICE_STREAM_NEXT_FFMPEG_PATH = 'voice-stream-next-test-missing-ffmpeg';
    process.env.VOICE_STREAM_NEXT_SECRETS_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({
        text: `Recovered recording transcript part ${fetchCalls}`,
        segments: [
          {
            start: 0,
            end: 1,
            text: `Recovered recording transcript part ${fetchCalls}`,
            avg_logprob: -0.1,
            compression_ratio: 1.2,
            no_speech_prob: 0.01,
          },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    let built: Awaited<ReturnType<typeof buildApp>> | null = null;
    try {
      const setup = await buildAppWithRecording();
      built = setup.built;
      const recording = setup.recording;
      built.db.upsertAssistantApiKey(recording.userId, 'groq', 'test-groq-key');
      const pcm = new Uint8Array(25_500_000);
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
        durationMs: 796_875,
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
      expect(response.json().text).toContain('Recovered recording transcript part 1');
      expect(response.json().text).toContain('Recovered recording transcript part 2');
      expect(response.json().audioDurationMs).toBe(796875);
      expect(built.db.voiceRecording(recording.userId, updated.id)?.transcriptText).toBe(response.json().text);
      expect(fetchCalls).toBeGreaterThan(1);
      const skipLogs = built.db.listLogs(recording.userId, 20).filter((log) => log.message === 'Voice recording retranscription whole-file skipped');
      expect(skipLogs.length).toBe(1);
      const chunkLogs = built.db.listLogs(recording.userId, 20).filter((log) => log.message === 'Voice recording retranscription chunk completed');
      expect(chunkLogs.length).toBeGreaterThan(1);
    } finally {
      globalThis.fetch = originalFetch;
      if (built) await closeBuiltApp(built);
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
