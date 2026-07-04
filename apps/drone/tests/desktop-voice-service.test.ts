import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';

import { DesktopVoiceService, __desktopVoiceTestInternals } from '../src/hub/desktop-voice-service';
import { VOICE_APPROVAL_SETTINGS_DEFAULT } from '../src/hub/hub-settings';

function createFakeClipboardRecorder(opts: {
  start?: () => Promise<void>;
  stop?: (tailPadMs: number) => Promise<Buffer>;
  cancel?: () => void;
  active?: boolean;
} = {}) {
  let active = opts.active ?? false;
  return {
    recorder: {
      snapshot: () => ({
        active,
        backend: 'fake',
        tmp: active ? '/tmp/fake.wav' : null,
        error: null,
        firstDataElapsedMs: active ? 0 : null,
        lastObservedSize: active ? 128 : null,
      }),
      start: async () => {
        await opts.start?.();
        active = true;
      },
      stop: async (tailPadMs: number) => {
        active = false;
        return opts.stop ? await opts.stop(tailPadMs) : Buffer.from('wav-bytes');
      },
      cancel: () => {
        active = false;
        opts.cancel?.();
      },
    },
  };
}

describe('DesktopVoiceService', () => {
  const originalClipboardPrewarm = process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_PREWARM;

  beforeEach(() => {
    process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_PREWARM = '0';
  });

  afterEach(() => {
    if (originalClipboardPrewarm == null) delete process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_PREWARM;
    else process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_PREWARM = originalClipboardPrewarm;
  });

  test('uses a final full-recording transcript when transcript sleep command finishes recording', async () => {
    let resolveSubmit!: () => void;
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    let submittedPrompt = '';
    let transcribedWav: Buffer | null = null;
    const service = new DesktopVoiceService({
      transcribeWav: async (wav) => {
        transcribedWav = wav;
        return { text: 'final check the build that is it', model: 'test' };
      },
      submitAssistantPrompt: async (prompt) => {
        submittedPrompt = prompt;
        await submitPromise;
      },
    });

    (service as any).mode = 'recording';
    (service as any).promptTranscriptText = 'rough chunk text';
    (service as any).promptChunks = [Buffer.alloc(3200, 1), Buffer.alloc(3200, 2)];

    const finishPromise = (service as any).finishAssistantPromptRecordingFromTranscript() as Promise<void>;
    await Promise.resolve();
    await Promise.resolve();

    expect(service.snapshot().mode).toBe('awake');
    expect(service.snapshot().message).toBe('Awake: sending assistant voice prompt.');
    expect(submittedPrompt).toBe('final check the build');
    expect(transcribedWav?.byteLength).toBeGreaterThan(6400);

    resolveSubmit();
    await finishPromise;

    expect(service.snapshot().mode).toBe('awake');
    expect(service.snapshot().message).toBe('Awake: sent assistant voice prompt.');
  });

  test('can use chunk transcript as the final desktop voice text', async () => {
    let transcribeCalls = 0;
    let submittedPrompt = '';
    const service = new DesktopVoiceService({
      voiceTranscription: { finalMode: 'segments' },
      transcribeWav: async () => {
        transcribeCalls += 1;
        return { text: 'final text should not be used', model: 'test' };
      },
      submitAssistantPrompt: async (prompt) => {
        submittedPrompt = prompt;
      },
    });

    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'assistant';
    (service as any).promptTranscriptText = 'rough chunk text';
    (service as any).promptChunks = [Buffer.alloc(3200, 1)];
    const events: any[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));

    await (service as any).finishPromptRecordingFromTranscript();
    unsubscribe();

    expect(transcribeCalls).toBe(0);
    expect(submittedPrompt).toBe('rough chunk text');
    expect(service.snapshot().mode).toBe('awake');
    expect(events.some((event) => event.type === 'desktop_voice_status' && event.status.mode === 'transcribing')).toBe(false);
  });

  test('reports desktop voice as starting before loading capture backends', async () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });
    let recognizerStarted = false;
    let captureStarted = false;
    (service as any).recognizer.start = () => {
      recognizerStarted = true;
    };
    (service as any).capture.start = () => {
      captureStarted = true;
    };

    const status = service.start();

    expect(status.mode).toBe('awake');
    expect(status.message).toBe('Awake: waiting for hey Sebastian.');
    expect(recognizerStarted).toBe(false);
    expect(captureStarted).toBe(false);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(recognizerStarted).toBe(true);
    expect(captureStarted).toBe(true);
  });

  test('still starts recognition when sleep is entered before deferred startup runs', async () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });
    let recognizerStarts = 0;
    let captureStarts = 0;
    (service as any).recognizer.start = () => {
      recognizerStarts += 1;
    };
    (service as any).capture.start = () => {
      captureStarts += 1;
    };

    service.start();
    const sleepingStatus = service.toggle();

    expect(sleepingStatus.mode).toBe('sleeping');
    expect(recognizerStarts).toBe(1);
    expect(captureStarts).toBe(1);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(recognizerStarts).toBe(1);
    expect(captureStarts).toBe(1);
  });

  test('go to sleep puts desktop voice to sleep while awake', () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });

    (service as any).mode = 'awake';
    (service as any).handleRecognizedText('go to sleep', true);

    expect(service.snapshot().mode).toBe('sleeping');
    expect(service.snapshot().message).toContain('Sleep:');
  });

  test('ignores recognizer commands while a prompt is already recording', () => {
    let realtimeStarts = 0;
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
      realtimeAssistantEnabled: true,
      startRealtimeAssistant: async () => {
        realtimeStarts += 1;
        return {
          appendPcm: () => {},
          stop: async () => {},
          cancel: async () => {},
        };
      },
    });
    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'assistant';
    (service as any).message = 'Awake: recording assistant voice prompt.';

    (service as any).handleRecognizedText('hey sebastian', true);
    (service as any).handleRecognizedText('status', true);
    (service as any).handleRecognizedText(`approval code ${VOICE_APPROVAL_SETTINGS_DEFAULT.lockedOffCode}`, true);
    (service as any).handleRecognizedText('go to sleep', true);

    const status = service.snapshot();
    expect(status.mode).toBe('recording');
    expect(status.transcript.target).toBe('assistant');
    expect(status.message).toBe('Awake: recording assistant voice prompt.');
    expect(status.lastApprovalCode).toBeUndefined();
    expect(realtimeStarts).toBe(0);
  });

  test('awake legacy lock code no longer changes desktop voice mode', () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });

    (service as any).mode = 'awake';
    (service as any).handleApprovalCode(VOICE_APPROVAL_SETTINGS_DEFAULT.lockCode);

    expect(service.snapshot().mode).toBe('awake');
    expect(service.snapshot().message).toBe(`Approval code detected: ${VOICE_APPROVAL_SETTINGS_DEFAULT.lockCode}`);
  });

  test('manual wake from sleep clears stale approval code', () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });

    (service as any).mode = 'sleeping';
    (service as any).lastApprovalCode = '9999';
    (service as any).recognizer.start = () => {};
    (service as any).capture.start = () => {};
    const status = service.toggle();

    expect(status.mode).toBe('awake');
    expect(status.lastApprovalCode).toBeUndefined();
  });

  test('awake off code turns desktop voice off', () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });

    (service as any).mode = 'awake';
    (service as any).handleApprovalCode(VOICE_APPROVAL_SETTINGS_DEFAULT.lockedOffCode);

    expect(service.snapshot().mode).toBe('off');
    expect(service.snapshot().message).toBe('Desktop voice is off.');
  });

  test('go to sleep puts desktop voice to sleep from full prompt transcription', async () => {
    let submittedPrompt = '';
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'go to sleep', model: 'test' }),
      submitAssistantPrompt: async (prompt) => {
        submittedPrompt = prompt;
      },
    });

    (service as any).mode = 'recording';
    (service as any).promptChunks = [Buffer.alloc(2)];

    await (service as any).finishAssistantPromptRecording();

    expect(service.snapshot().mode).toBe('sleeping');
    expect(submittedPrompt).toBe('');
  });

  test('keeps embedded go to sleep text while recording a patch', async () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'if you say go to sleep it should enter sleep mode', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });

    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'patch';

    await (service as any).transcribePromptSegment({
      pcm: Buffer.alloc(3200),
      audioMs: 100,
      speechMs: 100,
      trailingSilenceMs: 0,
      reason: 'flush',
      sequence: 1,
    });

    expect(service.snapshot().mode).toBe('recording');
    expect(service.snapshot().message).toBe('Awake: patching into current drone chat.');
    expect(service.snapshot().transcript.text).toBe('if you say go to sleep it should enter sleep mode');
  });

  test('does not start deferred capture backends after immediate stop', async () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });
    let recognizerStarted = false;
    let captureStarted = false;
    (service as any).recognizer.start = () => {
      recognizerStarted = true;
    };
    (service as any).capture.start = () => {
      captureStarted = true;
    };

    service.start();
    service.stop();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(service.snapshot().mode).toBe('off');
    expect(recognizerStarted).toBe(false);
    expect(captureStarted).toBe(false);
  });

  test('aborts normal assistant voice recording without submitting prompt text', async () => {
    let submitCalls = 0;
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {
        submitCalls += 1;
      },
    });

    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'assistant';
    (service as any).promptTranscriptText = 'do not send this';

    await (service as any).abortPromptRecordingFromTranscript();

    expect(service.snapshot().mode).toBe('awake');
    expect(service.snapshot().message).toBe('Awake: assistant voice prompt cancelled.');
    expect(service.snapshot().transcript.text).toBe('');
    expect(submitCalls).toBe(0);
  });

  test('does not emit transcript text when abort phrase is in the same segment', async () => {
    const phrases = ['ok stop', 'ok, stop', 'okay stop', 'okay, stop'];
    for (const phrase of phrases) {
      let submitCalls = 0;
      const service = new DesktopVoiceService({
        transcribeWav: async () => ({ text: `do not leak this ${phrase}`, model: 'test' }),
        submitAssistantPrompt: async () => {
          submitCalls += 1;
        },
      });
      const events: any[] = [];
      const unsubscribe = service.subscribe((event) => events.push(event));

      (service as any).mode = 'recording';
      (service as any).promptCaptureTarget = 'assistant';
      await (service as any).transcribePromptSegment({
        pcm: Buffer.alloc(3200),
        audioMs: 100,
        speechMs: 100,
        trailingSilenceMs: 0,
        reason: 'flush',
        sequence: 1,
      });

      unsubscribe();

      expect(service.snapshot().mode).toBe('awake');
      expect(service.snapshot().message).toBe('Awake: assistant voice prompt cancelled.');
      expect(service.snapshot().transcript.text).toBe('');
      expect(submitCalls).toBe(0);
      expect(events.some((event) => event.type === 'desktop_voice_transcript_segment')).toBe(false);
    }
  });

  test('does not emit transcript text when abort phrase follows dictated text', async () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'do not leak this okay stop', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });
    const events: any[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));

    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'assistant';
    await (service as any).transcribePromptSegment({
      pcm: Buffer.alloc(3200),
      audioMs: 100,
      speechMs: 100,
      trailingSilenceMs: 0,
      reason: 'flush',
      sequence: 1,
    });

    unsubscribe();

    expect(service.snapshot().mode).toBe('awake');
    expect(service.snapshot().transcript.text).toBe('');
    expect(events.some((event) => event.type === 'desktop_voice_transcript_segment')).toBe(false);
  });

  test('does not emit transcript segments for patch or clipboard captures', async () => {
    const texts = ['patch text', 'clipboard text'];
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: texts.shift() ?? '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });
    const events: any[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));
    const segment = {
      pcm: Buffer.alloc(3200),
      audioMs: 100,
      speechMs: 100,
      trailingSilenceMs: 0,
      reason: 'flush',
      sequence: 1,
    };

    (service as any).promptCaptureTarget = 'patch';
    (service as any).promptTranscriptText = '';
    (service as any).mode = 'recording';
    await (service as any).transcribePromptSegment(segment);

    (service as any).promptCaptureTarget = 'clipboard';
    (service as any).promptTranscriptText = '';
    (service as any).mode = 'recording';
    await (service as any).transcribePromptSegment(segment);

    unsubscribe();

    expect(events.some((event) => event.type === 'desktop_voice_transcript_segment')).toBe(false);
  });

  test('does not cancel a patch when a segment is a thank-you artifact', async () => {
    let abortCalls = 0;
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'thank you', model: 'test' }),
      submitAssistantPrompt: async () => {},
      abortChatPatch: async () => {
        abortCalls += 1;
      },
    });

    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'patch';
    await (service as any).transcribePromptSegment({
      pcm: Buffer.alloc(3200),
      audioMs: 100,
      speechMs: 100,
      trailingSilenceMs: 0,
      reason: 'flush',
      sequence: 1,
    });

    expect(service.snapshot().mode).toBe('recording');
    expect(service.snapshot().message).toBe('Awake: patching into current drone chat.');
    expect(abortCalls).toBe(0);
  });

  test('does not finish or submit an assistant prompt when a segment is a thank-you artifact', async () => {
    let submitCalls = 0;
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'thank you', model: 'test' }),
      submitAssistantPrompt: async () => {
        submitCalls += 1;
      },
    });

    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'assistant';
    (service as any).promptChunks = [Buffer.alloc(3200)];
    await (service as any).transcribePromptSegment({
      pcm: Buffer.alloc(3200),
      audioMs: 100,
      speechMs: 100,
      trailingSilenceMs: 0,
      reason: 'flush',
      sequence: 1,
    });

    expect(service.snapshot().mode).toBe('recording');
    expect(service.snapshot().message).toBe('Awake: recording assistant voice prompt.');
    expect(service.snapshot().transcript.text).toBe('thank you');
    expect(submitCalls).toBe(0);
  });

  test('does not treat a thank-you artifact as stop after prior assistant transcript content', async () => {
    let submittedPrompt = '';
    const service = new DesktopVoiceService({
      voiceTranscription: { finalMode: 'segments' },
      transcribeWav: async () => ({ text: 'thank you', model: 'test' }),
      submitAssistantPrompt: async (prompt) => {
        submittedPrompt = prompt;
      },
    });

    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'assistant';
    (service as any).promptTranscriptText = 'run the tests';
    await (service as any).transcribePromptSegment({
      pcm: Buffer.alloc(3200),
      audioMs: 100,
      speechMs: 100,
      trailingSilenceMs: 0,
      reason: 'flush',
      sequence: 1,
    });

    expect(service.snapshot().mode).toBe('recording');
    expect(service.snapshot().message).toBe('Awake: recording assistant voice prompt.');
    expect(service.snapshot().transcript.text).toBe('run the tests\nthank you');
    expect(submittedPrompt).toBe('');
  });

  test('briefly suppresses wake commands after desktop voice transcription stops', async () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });

    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'clipboard';
    (service as any).promptTranscriptText = 'copy this';

    await (service as any).finishPromptRecordingFromTranscript();
    expect(service.snapshot().mode).toBe('awake');

    (service as any).handleRecognizedText('can you transcribe', true);
    expect(service.snapshot().mode).toBe('awake');

    (service as any).promptCommandSuppressedUntil = Date.now() - 1;
    (service as any).handleRecognizedText('can you transcribe', true);
    expect(service.snapshot().mode).toBe('recording');
    expect(service.snapshot().transcript.target).toBe('clipboard');
  });

  test('uses configured post-prompt command suppression delay', async () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });
    service.setApprovalSettings({
      ...VOICE_APPROVAL_SETTINGS_DEFAULT,
      postPromptCommandSuppressionMs: 0,
    });

    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'clipboard';
    (service as any).promptTranscriptText = 'copy this';

    await (service as any).finishPromptRecordingFromTranscript();
    (service as any).handleRecognizedText('can you transcribe', true);

    expect(service.snapshot().mode).toBe('recording');
    expect(service.snapshot().transcript.target).toBe('clipboard');
  });

  test('emits synthesized audio for desktop speak when a TTS synthesizer is configured', async () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
      synthesizeSpeechWav: async () => Buffer.from('wav-bytes'),
    });
    const events: any[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));

    await expect(service.speak('hello')).resolves.toBe(true);
    unsubscribe();

    const speakEvent = events.find((event) => event.type === 'desktop_voice_speak_audio');
    expect(speakEvent?.contentType).toBe('audio/wav');
    expect(speakEvent?.audioBase64).toBe(Buffer.from('wav-bytes').toString('base64'));
  });

  test('starts realtime assistant capture and forwards transcripts and audio events', async () => {
    const appended: Buffer[] = [];
    const submitted: string[] = [];
    let callbacks: any = null;
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async (prompt) => {
        submitted.push(prompt);
      },
      realtimeAssistantEnabled: true,
      startRealtimeAssistant: async (cb) => {
        callbacks = cb;
        return {
          appendPcm: (pcm: Buffer) => {
            appended.push(Buffer.from(pcm));
          },
          stop: async () => {},
          cancel: async () => {},
        };
      },
    });
    const events: any[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));
    const preRoll = Buffer.alloc(320, 3);
    const liveAudio = Buffer.alloc(320, 4);
    (service as any).promptPreRollBuffer.push(preRoll);
    (service as any).mode = 'awake';

    await (service as any).startPromptRecording('assistant');
    (service as any).handleAudio(liveAudio);
    await callbacks.onUserTranscript('check the build');
    await callbacks.onAssistantAudio({ wav: Buffer.from('assistant-wav'), text: 'On it.' });
    await callbacks.onUserSpeechStarted();
    unsubscribe();

    expect(service.snapshot().mode).toBe('recording');
    expect(service.snapshot().transcript.target).toBe('assistant');
    expect(appended).toEqual([preRoll, liveAudio]);
    expect(submitted).toEqual([]);
    expect(events.some((event) => event.type === 'desktop_voice_transcript_segment' && event.text === 'check the build')).toBe(true);
    const audioEvent = events.find((event) => event.type === 'desktop_voice_speak_audio');
    expect(audioEvent?.audioBase64).toBe(Buffer.from('assistant-wav').toString('base64'));
    expect(events.some((event) => event.type === 'desktop_voice_stop_audio')).toBe(true);
  });

  test('starts browser WebRTC realtime capture when available', async () => {
    let websocketStarts = 0;
    let webrtcCancels = 0;
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'should not transcribe', model: 'test' }),
      submitAssistantPrompt: async () => {},
      realtimeAssistantEnabled: true,
      realtimeWebRtcAvailable: true,
      cancelRealtimeWebRtcAssistant: async () => {
        webrtcCancels += 1;
      },
      startRealtimeAssistant: async () => {
        websocketStarts += 1;
        return {
          appendPcm: () => {},
          stop: async () => {},
          cancel: async () => {},
        };
      },
    });
    const events: any[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));
    (service as any).mode = 'awake';

    await (service as any).startPromptRecording('assistant');
    (service as any).handleAudio(Buffer.alloc(320, 7));
    await (service as any).abortPromptRecordingFromTranscript();
    unsubscribe();

    expect(websocketStarts).toBe(0);
    expect(webrtcCancels).toBe(1);
    expect(service.snapshot().mode).toBe('awake');
    expect(events.some((event) => event.type === 'desktop_voice_webrtc_start')).toBe(true);
    expect(events.some((event) => event.type === 'desktop_voice_webrtc_stop')).toBe(true);
  });

  test('that is it stops realtime capture without submitting a prompt', async () => {
    let webrtcCancels = 0;
    let submitted = 0;
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'should not transcribe', model: 'test' }),
      submitAssistantPrompt: async () => {
        submitted += 1;
      },
      realtimeAssistantEnabled: true,
      realtimeWebRtcAvailable: true,
      cancelRealtimeWebRtcAssistant: async () => {
        webrtcCancels += 1;
      },
    });
    const events: any[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));
    (service as any).mode = 'recording';
    (service as any).promptCaptureTarget = 'assistant';
    (service as any).realtimeTransport = 'webrtc';
    (service as any).realtimeStarting = true;

    await service.createRealtimeAssistantCallbacks().onUserTranscript("that's it");
    unsubscribe();

    expect(webrtcCancels).toBe(1);
    expect(submitted).toBe(0);
    expect(service.snapshot().mode).toBe('awake');
    expect(service.snapshot().transcript.target).toBe(null);
    expect(service.snapshot().message).toBe('Awake: realtime assistant stopped.');
    expect(events.some((event) => event.type === 'desktop_voice_webrtc_stop')).toBe(true);
    expect(events.some((event) => event.type === 'desktop_voice_transcript_segment')).toBe(false);
  });

  test('cancels browser WebRTC realtime capture when setup never connects', async () => {
    let webrtcCancels = 0;
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'should not transcribe', model: 'test' }),
      submitAssistantPrompt: async () => {},
      realtimeAssistantEnabled: true,
      realtimeWebRtcAvailable: true,
      realtimeWebRtcStartTimeoutMs: 5,
      cancelRealtimeWebRtcAssistant: async () => {
        webrtcCancels += 1;
      },
    });
    const events: any[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));
    (service as any).mode = 'awake';

    await (service as any).startPromptRecording('assistant');
    await new Promise((resolve) => setTimeout(resolve, 25));
    unsubscribe();

    expect(webrtcCancels).toBe(1);
    expect(service.snapshot().mode).toBe('awake');
    expect(service.snapshot().transcript.target).toBe(null);
    expect(service.snapshot().message).toBe('Awake: realtime assistant WebRTC setup timed out.');
    expect(events.some((event) => event.type === 'desktop_voice_webrtc_start')).toBe(true);
    expect(events.some((event) => event.type === 'desktop_voice_webrtc_stop')).toBe(true);
  });

  test('keeps browser WebRTC realtime capture active after setup connects', async () => {
    let webrtcCancels = 0;
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'should not transcribe', model: 'test' }),
      submitAssistantPrompt: async () => {},
      realtimeAssistantEnabled: true,
      realtimeWebRtcAvailable: true,
      realtimeWebRtcStartTimeoutMs: 5,
      cancelRealtimeWebRtcAssistant: async () => {
        webrtcCancels += 1;
      },
    });
    (service as any).mode = 'awake';

    await (service as any).startPromptRecording('assistant');
    service.markRealtimeWebRtcAssistantConnected();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(webrtcCancels).toBe(0);
    expect(service.snapshot().mode).toBe('recording');
    expect(service.snapshot().transcript.target).toBe('assistant');
    expect(service.snapshot().message).toBe('Awake: realtime assistant is listening.');
  });

  test('cancel active recording keeps desktop voice awake instead of off', async () => {
    let webrtcCancels = 0;
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'should not transcribe', model: 'test' }),
      submitAssistantPrompt: async () => {},
      realtimeAssistantEnabled: true,
      realtimeWebRtcAvailable: true,
      cancelRealtimeWebRtcAssistant: async () => {
        webrtcCancels += 1;
      },
    });
    (service as any).mode = 'awake';

    await (service as any).startPromptRecording('assistant');
    const status = await service.cancelActiveRecording();

    expect(webrtcCancels).toBe(1);
    expect(status.mode).toBe('awake');
    expect(status.transcript.target).toBe(null);
    expect(status.supportsWakeWords).toBe(false);
  });

  test('uses normal assistant prompt capture when realtime assistant is disabled', async () => {
    let realtimeStarts = 0;
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
      startRealtimeAssistant: async () => {
        realtimeStarts += 1;
        return {
          appendPcm: () => {},
          stop: async () => {},
          cancel: async () => {},
        };
      },
    });
    (service as any).mode = 'awake';

    await (service as any).startPromptRecording('assistant');

    expect(realtimeStarts).toBe(0);
    expect(service.snapshot().mode).toBe('recording');
    expect(service.snapshot().realtime).toEqual({ available: true, enabled: false });
  });

  test('can suppress normal assistant prompt submit for direct realtime tools', async () => {
    const submitted: string[] = [];
    let callbacks: any = null;
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async (prompt) => {
        submitted.push(prompt);
      },
      realtimeAssistantEnabled: true,
      startRealtimeAssistant: async (cb) => {
        callbacks = cb;
        return {
          appendPcm: () => {},
          stop: async () => {},
          cancel: async () => {},
        };
      },
    });
    const events: any[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));
    (service as any).mode = 'awake';

    await (service as any).startPromptRecording('assistant');
    await callbacks.onUserTranscript('list my drones');
    unsubscribe();

    expect(submitted).toEqual([]);
    expect(events.some((event) => event.type === 'desktop_voice_transcript_segment' && event.text === 'list my drones')).toBe(true);
  });

  test('cancels realtime assistant capture without transcribing buffered audio', async () => {
    let transcribeCalls = 0;
    let cancelCalls = 0;
    const service = new DesktopVoiceService({
      transcribeWav: async () => {
        transcribeCalls += 1;
        return { text: 'ignored', model: 'test' };
      },
      submitAssistantPrompt: async () => {},
      realtimeAssistantEnabled: true,
      startRealtimeAssistant: async () => ({
        appendPcm: () => {},
        stop: async () => {},
        cancel: async () => {
          cancelCalls += 1;
        },
      }),
    });
    (service as any).mode = 'awake';
    await (service as any).startPromptRecording('assistant');
    (service as any).handleAudio(Buffer.alloc(320, 5));

    await (service as any).abortPromptRecordingFromTranscript();

    expect(cancelCalls).toBe(1);
    expect(transcribeCalls).toBe(0);
    expect(service.snapshot().mode).toBe('awake');
    expect(service.snapshot().message).toBe('Awake: assistant voice prompt cancelled.');
  });

  test('cancels clipboard recording without transcribing buffered audio', () => {
    let transcribeCalls = 0;
    let cancelCalls = 0;
    const fake = createFakeClipboardRecorder({
      active: true,
      cancel: () => {
        cancelCalls += 1;
      },
    });
    const service = new DesktopVoiceService({
      transcribeWav: async () => {
        transcribeCalls += 1;
        return { text: 'ignored', model: 'test' };
      },
      submitAssistantPrompt: async () => {},
      clipboardRecorder: fake.recorder,
    });

    (service as any).clipboardMode = 'recording';
    (service as any).clipboardMessage = 'Voice transcription recording.';

    const status = service.cancelClipboardRecording();

    expect(status.clipboard.mode).toBe('idle');
    expect(status.clipboard.message).toBe('Voice transcription cancelled.');
    expect(cancelCalls).toBe(1);
    expect(transcribeCalls).toBe(0);
  });

  test('suppresses a late clipboard start after cancel', async () => {
    let startCalls = 0;
    const fake = createFakeClipboardRecorder({
      start: async () => {
        startCalls += 1;
      },
    });
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'ignored', model: 'test' }),
      submitAssistantPrompt: async () => {},
      clipboardRecorder: fake.recorder,
    });

    service.cancelClipboardRecording();
    const status = await service.toggleClipboardRecording();

    expect(status.clipboard.mode).toBe('idle');
    expect(startCalls).toBe(0);
  });

  test('clipboard recording transcribes recorder wav bytes with tail padding', async () => {
    let transcribed: Buffer | null = null;
    let tailPadMs = 0;
    const fake = createFakeClipboardRecorder({
      stop: async (nextTailPadMs) => {
        tailPadMs = nextTailPadMs;
        return Buffer.from('fake-wav');
      },
    });
    const service = new DesktopVoiceService({
      transcribeWav: async (wav) => {
        transcribed = wav;
        return { text: 'hello world', model: 'test' };
      },
      submitAssistantPrompt: async () => {},
      clipboardRecorder: fake.recorder,
    });

    await service.toggleClipboardRecording();
    const status = await service.toggleClipboardRecording();

    expect(status.clipboard.mode).toBe('idle');
    expect(status.clipboard.message).toBe('Transcribed 11 characters.');
    expect(status.clipboardResultText).toBe('hello world');
    expect(transcribed?.toString('utf8')).toBe('fake-wav');
    expect(tailPadMs).toBe(400);
  });

  test('treats pw-record interrupted exit as a completed stop', async () => {
    const recorder = new __desktopVoiceTestInternals.ClipboardWavRecorder();
    const child = new EventEmitter() as any;
    child.exitCode = null;
    child.signalCode = null;
    child.stdin = null;
    child.kill = () => {
      child.exitCode = 1;
      setTimeout(() => child.emit('close', 1, null), 0);
      return true;
    };

    await expect((recorder as any).stopChild(child, {
      kind: 'pw-record',
      label: 'clipboard-pw-record',
      command: 'pw-record',
      args: [],
      tmp: '/tmp/test.wav',
    }, 0)).resolves.toBeUndefined();
  });

  test('treats arecord quiet interrupt as completed after audio data arrives', async () => {
    const recorder = new __desktopVoiceTestInternals.ClipboardWavRecorder();
    const child = new EventEmitter() as any;
    child.exitCode = null;
    child.signalCode = null;
    child.stdin = null;
    child.kill = () => {
      child.exitCode = 1;
      setTimeout(() => child.emit('close', 1, null), 0);
      return true;
    };
    (recorder as any).firstDataElapsedMs = 25;

    await expect((recorder as any).stopChild(child, {
      kind: 'arecord',
      label: 'clipboard-arecord',
      command: 'arecord',
      args: [],
      tmp: '/tmp/test.wav',
    }, 0)).resolves.toBeUndefined();
  });

  test('suspends awake desktop voice while shortcut clipboard recording runs', async () => {
    let recognizerStarts = 0;
    let recognizerStops = 0;
    let captureStarts = 0;
    let captureStops = 0;
    const fake = createFakeClipboardRecorder({
      stop: async () => Buffer.from('fake-wav'),
    });
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'hello clipboard', model: 'test' }),
      submitAssistantPrompt: async () => {},
      clipboardRecorder: fake.recorder,
    });
    (service as any).mode = 'awake';
    (service as any).message = 'Awake: waiting for hey Sebastian.';
    (service as any).recognizer.start = () => {
      recognizerStarts += 1;
    };
    (service as any).recognizer.stop = () => {
      recognizerStops += 1;
    };
    (service as any).capture.start = () => {
      captureStarts += 1;
    };
    (service as any).capture.stop = () => {
      captureStops += 1;
    };

    const recordingStatus = await service.toggleClipboardRecording();

    expect(recordingStatus.clipboard.mode).toBe('recording');
    expect(recordingStatus.suspended.active).toBe(true);
    expect(recordingStatus.suspended.reason).toBe('clipboard');
    expect(recordingStatus.suspended.previousMode).toBe('awake');
    expect(recognizerStops).toBe(1);
    expect(captureStops).toBe(1);

    const finishedStatus = await service.toggleClipboardRecording();

    expect(finishedStatus.clipboard.mode).toBe('idle');
    expect(finishedStatus.suspended.active).toBe(false);
    expect(finishedStatus.mode).toBe('awake');
    expect(finishedStatus.message).toBe('Awake: waiting for hey Sebastian.');
    expect(recognizerStarts).toBe(1);
    expect(captureStarts).toBe(1);
  });

  test('resumes suspended desktop voice when shortcut clipboard recording is cancelled', async () => {
    let recognizerStarts = 0;
    let captureStarts = 0;
    let cancelCalls = 0;
    const fake = createFakeClipboardRecorder({
      cancel: () => {
        cancelCalls += 1;
      },
    });
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: 'ignored', model: 'test' }),
      submitAssistantPrompt: async () => {},
      clipboardRecorder: fake.recorder,
    });
    (service as any).mode = 'awake';
    (service as any).message = 'Awake: waiting for hey Sebastian.';
    (service as any).recognizer.start = () => {
      recognizerStarts += 1;
    };
    (service as any).recognizer.stop = () => {};
    (service as any).capture.start = () => {
      captureStarts += 1;
    };
    (service as any).capture.stop = () => {};

    await service.toggleClipboardRecording();
    const status = service.cancelClipboardRecording();

    expect(status.clipboard.mode).toBe('idle');
    expect(status.suspended.active).toBe(false);
    expect(status.mode).toBe('awake');
    expect(cancelCalls).toBe(1);
    expect(recognizerStarts).toBe(1);
    expect(captureStarts).toBe(1);
  });

  test('emits local wake cue when prompt recording starts', () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });
    const events: any[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));

    (service as any).mode = 'awake';
    void (service as any).startPromptRecording('assistant');
    unsubscribe();

    expect(events.some((event) => event.type === 'desktop_voice_local_cue' && event.cue === 'wake')).toBe(true);
  });

  test('seeds prompt recording with buffered pre-roll audio', () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });
    const preRoll = Buffer.alloc(640, 7);
    (service as any).promptPreRollBuffer.push(preRoll);
    (service as any).mode = 'awake';

    void (service as any).startPromptRecording('assistant');

    expect((service as any).promptChunks).toEqual([preRoll]);
    expect((service as any).promptPreRollBuffer.byteLength).toBe(0);
  });

  test('replays recent desktop voice events to new subscribers', () => {
    const service = new DesktopVoiceService({
      transcribeWav: async () => ({ text: '', model: 'test' }),
      submitAssistantPrompt: async () => {},
    });

    (service as any).emitLocalCue('status');
    (service as any).emitDesktopVoiceEvent({ type: 'desktop_voice_transcript_segment', text: 'hello' });

    const events: any[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));
    unsubscribe();

    expect(events.some((event) => event.type === 'desktop_voice_local_cue' && event.cue === 'status')).toBe(true);
    expect(events.some((event) => event.type === 'desktop_voice_transcript_segment' && event.text === 'hello')).toBe(true);
  });
});
