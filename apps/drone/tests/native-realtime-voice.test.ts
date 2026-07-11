import { describe, expect, test } from 'bun:test';

import { createNativeRealtimeVoiceSession, nativeToolStatus, speechText, takeSpeechChunks } from '../src/hub/native-realtime-voice';
import { float32ToPcm16le, pcm16leToFloat32, sileroVadOptions, SileroVadStream } from '../src/hub/silero-vad-stream';

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('condition was not reached');
}

describe('native realtime voice', () => {
  test('cleans and chunks assistant text for speech', () => {
    expect(speechText('**Done.** See [the file](https://example.test).')).toBe('Done. See the file.');
    expect(takeSpeechChunks('First update. Second update')).toEqual({ chunks: ['First update.'], remainder: 'Second update' });
    expect(nativeToolStatus('drone_hub__web_search')).toBe('I’m looking that up.');
  });

  test('submits an initial utterance and steers while the assistant is working', async () => {
    let detectorCallbacks: any;
    let running = false;
    const submitted: string[] = [];
    const steered: string[] = [];
    const transcripts: string[] = [];
    const recognized = ['check the drones', 'focus on alpha'];

    const session = await createNativeRealtimeVoiceSession({
      callbacks: { onUserTranscript: (text) => transcripts.push(text) },
      transcribePcm: async () => recognized.shift() ?? '',
      synthesizeSpeech: async () => Buffer.from('wav'),
      isAssistantRunning: () => running,
      submitPrompt: async (prompt) => { submitted.push(prompt); },
      steerPrompt: (prompt) => { steered.push(prompt); },
      subscribeAssistantEvents: () => () => {},
      createSpeechDetector: async (callbacks) => {
        detectorCallbacks = callbacks;
        return { appendPcm: async () => {}, flush: async () => {}, close: async () => {} };
      },
    });

    detectorCallbacks.onSpeechStart();
    detectorCallbacks.onSpeechEnd(Buffer.alloc(1_024));
    await until(() => submitted.length === 1);
    running = true;
    detectorCallbacks.onSpeechStart();
    detectorCallbacks.onSpeechEnd(Buffer.alloc(1_024));
    await until(() => steered.length === 1);

    expect(transcripts).toEqual(['check the drones', 'focus on alpha']);
    expect(submitted).toEqual(['check the drones']);
    expect(steered).toEqual(['focus on alpha']);
    await session.cancel();
  });

  test('speaks one smooth clip after the assistant message is finalized', async () => {
    let assistantEvent: ((event: any) => void) | undefined;
    const spoken: string[] = [];
    const session = await createNativeRealtimeVoiceSession({
      synthesizeSpeech: async (text) => { spoken.push(text); return Buffer.from('wav'); },
      transcribePcm: async () => '',
      isAssistantRunning: () => false,
      submitPrompt: async () => {},
      steerPrompt: () => {},
      subscribeAssistantEvents: (listener) => { assistantEvent = listener; return () => {}; },
      createSpeechDetector: async () => ({ appendPcm: async () => {}, flush: async () => {}, close: async () => {} }),
    });

    assistantEvent?.({ type: 'assistant_delta', turnId: 'turn-1', text: 'I checked it. ' });
    assistantEvent?.({ type: 'assistant_delta', turnId: 'turn-1', text: 'Everything is ready' });
    assistantEvent?.({ type: 'assistant_message', turnId: 'turn-1', text: 'I checked it. Everything is ready' });
    await until(() => spoken.length === 1);
    expect(spoken).toEqual(['I checked it. Everything is ready']);
    await session.cancel();
  });

  test('serializes utterance transcription and aborts the active request on close', async () => {
    let detectorCallbacks: any;
    let activeTranscriptions = 0;
    let maxActiveTranscriptions = 0;
    let releaseFirst!: () => void;
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const submitted: string[] = [];
    let calls = 0;
    const session = await createNativeRealtimeVoiceSession({
      transcribePcm: async (_wav, signal) => {
        calls += 1;
        activeTranscriptions += 1;
        maxActiveTranscriptions = Math.max(maxActiveTranscriptions, activeTranscriptions);
        try {
          if (calls === 1) await firstRelease;
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          return `utterance ${calls}`;
        } finally {
          activeTranscriptions -= 1;
        }
      },
      synthesizeSpeech: async () => Buffer.from('wav'),
      isAssistantRunning: () => false,
      submitPrompt: async (prompt) => { submitted.push(prompt); },
      steerPrompt: () => {},
      subscribeAssistantEvents: () => () => {},
      createSpeechDetector: async (callbacks) => {
        detectorCallbacks = callbacks;
        return { appendPcm: async () => {}, flush: async () => {}, close: async () => {} };
      },
    });

    detectorCallbacks.onSpeechEnd(Buffer.alloc(1_024));
    detectorCallbacks.onSpeechEnd(Buffer.alloc(1_024));
    await until(() => calls === 1);
    expect(maxActiveTranscriptions).toBe(1);
    releaseFirst();
    await until(() => submitted.length === 2);
    expect(maxActiveTranscriptions).toBe(1);
    expect(submitted).toEqual(['utterance 1', 'utterance 2']);

    let aborted = false;
    let abortingTranscriptionStarted = false;
    const abortingSession = await createNativeRealtimeVoiceSession({
      transcribePcm: async (_wav, signal) => await new Promise<string>((_resolve, reject) => {
        abortingTranscriptionStarted = true;
        signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      }),
      synthesizeSpeech: async () => Buffer.from('wav'),
      isAssistantRunning: () => false,
      submitPrompt: async () => {},
      steerPrompt: () => {},
      subscribeAssistantEvents: () => () => {},
      createSpeechDetector: async (callbacks) => {
        detectorCallbacks = callbacks;
        return { appendPcm: async () => {}, flush: async () => {}, close: async () => {} };
      },
    });
    detectorCallbacks.onSpeechEnd(Buffer.alloc(1_024));
    await until(() => abortingTranscriptionStarted);
    await abortingSession.cancel();
    expect(aborted).toBe(true);
    await session.cancel();
  });

  test('can close reentrantly from a stop-transcript callback', async () => {
    let detectorCallbacks: any;
    let closed = false;
    let session!: Awaited<ReturnType<typeof createNativeRealtimeVoiceSession>>;
    session = await createNativeRealtimeVoiceSession({
      callbacks: {
        onUserTranscript: async () => await session.cancel(),
        onClose: () => { closed = true; },
      },
      transcribePcm: async () => "that's it",
      synthesizeSpeech: async () => Buffer.from('wav'),
      isAssistantRunning: () => false,
      submitPrompt: async () => {},
      steerPrompt: () => {},
      subscribeAssistantEvents: () => () => {},
      createSpeechDetector: async (callbacks) => {
        detectorCallbacks = callbacks;
        return { appendPcm: async () => {}, flush: async () => {}, close: async () => {} };
      },
    });

    detectorCallbacks.onSpeechEnd(Buffer.alloc(1_024));
    await until(() => closed);
    expect(closed).toBe(true);
  });

  test('falls back to host submission if a running turn ends before steering', async () => {
    const submitted: string[] = [];
    const session = await createNativeRealtimeVoiceSession({
      transcribePcm: async () => '',
      synthesizeSpeech: async () => Buffer.from('wav'),
      isAssistantRunning: () => true,
      submitPrompt: async (prompt) => { submitted.push(prompt); },
      steerPrompt: () => { throw new Error('turn ended'); },
      subscribeAssistantEvents: () => () => {},
      createSpeechDetector: async () => ({ appendPcm: async () => {}, flush: async () => {}, close: async () => {} }),
    });

    await session.sendText?.('keep this request');
    await until(() => submitted.length === 1);
    expect(submitted).toEqual(['keep this request']);
    await session.cancel();
  });

  test('hard-interrupts the active assistant turn before submitting barge-in speech', async () => {
    let detectorCallbacks: any;
    let interrupts = 0;
    const interruptedPrompts: string[] = [];
    const steered: string[] = [];
    const session = await createNativeRealtimeVoiceSession({
      transcribePcm: async () => 'stop and check beta instead',
      synthesizeSpeech: async () => Buffer.from('wav'),
      isAssistantRunning: () => true,
      submitPrompt: async () => {},
      interruptAssistant: () => { interrupts += 1; },
      interruptWithPrompt: async (prompt) => { interruptedPrompts.push(prompt); },
      steerPrompt: (prompt) => { steered.push(prompt); },
      subscribeAssistantEvents: () => () => {},
      createSpeechDetector: async (callbacks) => {
        detectorCallbacks = callbacks;
        return { appendPcm: async () => {}, flush: async () => {}, close: async () => {} };
      },
    });

    detectorCallbacks.onSpeechStart();
    expect(interrupts).toBe(1);
    detectorCallbacks.onSpeechEnd(Buffer.alloc(1_024));
    await until(() => interruptedPrompts.length === 1);
    expect(interruptedPrompts).toEqual(['stop and check beta instead']);
    expect(steered).toEqual([]);
    await session.cancel();
  });

  test('does not resume stale assistant speech while a user interruption is being transcribed', async () => {
    let detectorCallbacks: any;
    let assistantEvent: ((event: any) => void) | undefined;
    const spoken: string[] = [];
    const steered: string[] = [];
    const session = await createNativeRealtimeVoiceSession({
      transcribePcm: async () => 'change direction',
      synthesizeSpeech: async (text) => { spoken.push(text); return Buffer.from('wav'); },
      isAssistantRunning: () => true,
      submitPrompt: async () => {},
      steerPrompt: (text) => { steered.push(text); },
      subscribeAssistantEvents: (listener) => { assistantEvent = listener; return () => {}; },
      createSpeechDetector: async (callbacks) => {
        detectorCallbacks = callbacks;
        return { appendPcm: async () => {}, flush: async () => {}, close: async () => {} };
      },
    });

    detectorCallbacks.onSpeechStart();
    assistantEvent?.({ type: 'assistant_message', turnId: 'old-turn', text: 'This response is stale.' });
    detectorCallbacks.onSpeechEnd(Buffer.alloc(1_024));
    await until(() => steered.length > 0);
    expect(spoken).not.toContain('This response is stale.');
    expect(steered).toEqual(['change direction']);
    await session.cancel();
  });
});

describe('Silero VAD stream adapter', () => {
  test('uses the Silero v5 16 kHz defaults and honors threshold overrides', () => {
    expect(sileroVadOptions({ DRONE_HUB_SILERO_POSITIVE_THRESHOLD: '0.62' } as NodeJS.ProcessEnv)).toMatchObject({
      model: 'v5',
      sampleRate: 16_000,
      frameSamples: 512,
      positiveSpeechThreshold: 0.62,
    });
  });

  test('converts PCM and forwards detected speech from the engine', async () => {
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(-16_384, 0);
    pcm.writeInt16LE(16_383, 2);
    expect([...pcm16leToFloat32(pcm)]).toEqual([-0.5, 16_383 / 32_768]);
    const roundTrip = float32ToPcm16le(new Float32Array([-0.5, 0.5]));
    expect(roundTrip.readInt16LE(0)).toBe(-16_384);
    expect(roundTrip.readInt16LE(2)).toBe(16_384);

    let engineOptions: any;
    let started = false;
    const utterances: Buffer[] = [];
    const stream = await SileroVadStream.create({
      callbacks: { onSpeechEnd: (utterance) => utterances.push(utterance) },
      createEngine: async (options) => {
        engineOptions = options;
        return {
          start: () => { started = true; },
          processAudio: async () => {},
          flush: async () => {},
          reset: () => {},
          destroy: async () => {},
        };
      },
    });
    engineOptions.onSpeechEnd(new Float32Array([0.25, -0.25]));
    await until(() => utterances.length === 1);
    expect(started).toBe(true);
    expect(utterances[0]?.byteLength).toBe(4);
    await stream.close();
  });
});
