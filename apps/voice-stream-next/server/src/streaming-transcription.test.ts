import { describe, expect, test } from 'bun:test';

import {
  StreamingTranscriptionManager,
  buildStreamingTranscriptionConfigFromEnv,
  hasTranscriptContent,
  stripTranscriptCommands,
} from './streaming-transcription.js';

describe('stripTranscriptCommands', () => {
  test('detects finish, sleep, and abort terminal phrases', () => {
    const finish = stripTranscriptCommands("Please summarize the notes, that's it.");
    expect(finish.finishDetected).toBe(true);
    expect(finish.finishPhrase).toBeTruthy();
    expect(finish.sleepDetected).toBe(false);
    expect(finish.abortDetected).toBe(false);
    expect(finish.text).toBe('Please summarize the notes,');

    const sleep = stripTranscriptCommands('Please summarize the notes, go to sleep.');
    expect(sleep.sleepDetected).toBe(true);
    expect(sleep.sleepPhrase).toBeTruthy();
    expect(sleep.finishDetected).toBe(false);
    expect(sleep.abortDetected).toBe(false);
    expect(sleep.text).toBe('Please summarize the notes,');

    const abort = stripTranscriptCommands('Never mind, okay stop now.');
    expect(abort.abortDetected).toBe(true);
    expect(abort.abortPhrase).toBeTruthy();
    expect(abort.sleepDetected).toBe(false);
    expect(abort.finishDetected).toBe(false);
    expect(abort.text).toBe('Never mind, now.');
  });

  test('detects cancel and abort aliases', () => {
    const cancel = stripTranscriptCommands('Scratch that, cancel this.');
    expect(cancel.abortDetected).toBe(true);
    expect(cancel.text).toBe('Scratch that,');
  });

  test('strips wake phrases without finishing the recording', () => {
    const wake = stripTranscriptCommands('Hey Sebastian, patch me in for the meeting.');
    expect(wake.wakeDetected).toBe(true);
    expect(wake.finishDetected).toBe(false);
    expect(wake.sleepDetected).toBe(false);
    expect(wake.abortDetected).toBe(false);
    expect(wake.text).toBe('for the meeting.');

    const alternateSpelling = stripTranscriptCommands('Hey Sebastien, what is next?');
    expect(alternateSpelling.wakeDetected).toBe(true);
    expect(alternateSpelling.text).toBe('what is next?');
  });
});

describe('hasTranscriptContent', () => {
  test('requires letters or numbers', () => {
    expect(hasTranscriptContent('')).toBe(false);
    expect(hasTranscriptContent('...')).toBe(false);
    expect(hasTranscriptContent('hello')).toBe(true);
  });
});

describe('StreamingTranscriptionManager', () => {
  test('auto-finishes on finish phrase using test transcript hook', async () => {
    const previous = process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
    process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = "Please capture this note, that's it.";
    const config = buildStreamingTranscriptionConfigFromEnv(process.env);
    const commands: Array<{ type: string; transcriptText: string }> = [];
    const detections: Array<{ type: string; partialTranscriptText: string }> = [];
    const manager = new StreamingTranscriptionManager(config, (command) => {
      commands.push({ type: command.type, transcriptText: command.transcriptText });
    }, (detection) => {
      detections.push({ type: detection.type, partialTranscriptText: detection.partialTranscriptText });
    });

    const speechChunk = speechLikeChunk();
    const silenceChunk = silentChunk();
    for (let index = 0; index < 8; index += 1) {
      manager.appendPcm(speechChunk);
    }
    for (let index = 0; index < 12; index += 1) {
      manager.appendPcm(silenceChunk);
    }
    manager.flushPending();

    const startedAt = Date.now();
    while (commands.length === 0 && Date.now() - startedAt < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    manager.stop();

    if (previous == null) delete process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
    else process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = previous;

    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe('finish');
    expect(commands[0]?.transcriptText).toContain('Please capture this note');
    expect(detections).toHaveLength(1);
    expect(detections[0]?.type).toBe('finish');
    expect(detections[0]?.partialTranscriptText).toContain('Please capture this note');
  });

  test('auto-sleeps on go to sleep phrase using test transcript hook', async () => {
    const previous = process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
    process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = 'Please capture this note, go to sleep.';
    const config = buildStreamingTranscriptionConfigFromEnv(process.env);
    const commands: Array<{ type: string; transcriptText: string }> = [];
    const manager = new StreamingTranscriptionManager(config, (command) => {
      commands.push({ type: command.type, transcriptText: command.transcriptText });
    });

    const speechChunk = speechLikeChunk();
    const silenceChunk = silentChunk();
    for (let index = 0; index < 8; index += 1) {
      manager.appendPcm(speechChunk);
    }
    for (let index = 0; index < 12; index += 1) {
      manager.appendPcm(silenceChunk);
    }
    manager.flushPending();

    const startedAt = Date.now();
    while (commands.length === 0 && Date.now() - startedAt < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    manager.stop();

    if (previous == null) delete process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
    else process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = previous;

    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe('sleep');
    expect(commands[0]?.transcriptText).toContain('Please capture this note');
  });

  test('auto-sleeps even when go to sleep has no transcript content', async () => {
    const previous = process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
    process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = 'Go to sleep.';
    const config = buildStreamingTranscriptionConfigFromEnv(process.env);
    const commands: Array<{ type: string; transcriptText: string }> = [];
    const manager = new StreamingTranscriptionManager(config, (command) => {
      commands.push({ type: command.type, transcriptText: command.transcriptText });
    });

    const speechChunk = speechLikeChunk();
    const silenceChunk = silentChunk();
    for (let index = 0; index < 8; index += 1) {
      manager.appendPcm(speechChunk);
    }
    for (let index = 0; index < 12; index += 1) {
      manager.appendPcm(silenceChunk);
    }
    manager.flushPending();

    const startedAt = Date.now();
    while (commands.length === 0 && Date.now() - startedAt < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    manager.stop();

    if (previous == null) delete process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
    else process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = previous;

    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe('sleep');
    expect(commands[0]?.transcriptText).toBe('');
  });

  test('auto-aborts on stop phrase using test transcript hook', async () => {
    const previous = process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
    process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = 'Scratch that, okay stop.';
    const config = buildStreamingTranscriptionConfigFromEnv(process.env);
    const commands: Array<{ type: string; transcriptText: string }> = [];
    const manager = new StreamingTranscriptionManager(config, (command) => {
      commands.push({ type: command.type, transcriptText: command.transcriptText });
    });

    const speechChunk = speechLikeChunk();
    const silenceChunk = silentChunk();
    for (let index = 0; index < 8; index += 1) {
      manager.appendPcm(speechChunk);
    }
    for (let index = 0; index < 12; index += 1) {
      manager.appendPcm(silenceChunk);
    }
    manager.flushPending();

    const startedAt = Date.now();
    while (commands.length === 0 && Date.now() - startedAt < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    manager.stop();

    if (previous == null) delete process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
    else process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = previous;

    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe('abort');
    expect(commands[0]?.transcriptText).toBe('');
  });

  test('emits transcript segments while terminal command detection stays enabled', async () => {
    const previous = process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
    process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = 'Keep this speech segment.';
    const config = {
      ...buildStreamingTranscriptionConfigFromEnv(process.env),
      finalTranscriptionMode: 'segments' as const,
    };
    const commands: Array<{ type: string; transcriptText: string }> = [];
    const segments: Array<{ text: string }> = [];
    const manager = new StreamingTranscriptionManager(config, (command) => {
      commands.push({ type: command.type, transcriptText: command.transcriptText });
    }, undefined, {
      onSegment: (segment) => {
        segments.push({ text: segment.text });
      },
    });

    const speechChunk = speechLikeChunk();
    const silenceChunk = silentChunk();
    for (let index = 0; index < 8; index += 1) {
      manager.appendPcm(speechChunk);
    }
    for (let index = 0; index < 12; index += 1) {
      manager.appendPcm(silenceChunk);
    }
    manager.flushPending();

    const startedAt = Date.now();
    while (segments.length === 0 && Date.now() - startedAt < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    manager.stop();

    if (previous == null) delete process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT;
    else process.env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT = previous;

    expect(commands).toHaveLength(0);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('Keep this speech segment.');
  });

  test('detects terminal command from a later segment while an earlier segment is still transcribing', async () => {
    const config = {
      ...buildStreamingTranscriptionConfigFromEnv({}),
      concurrency: 2,
      finalTranscriptionMode: 'segments' as const,
    };
    const commands: Array<{ type: string; transcriptText: string }> = [];
    const startedSequences: number[] = [];
    const pending: Array<{ resolve: (result: any) => void }> = [];
    const manager = new StreamingTranscriptionManager(config, (command) => {
      commands.push({ type: command.type, transcriptText: command.transcriptText });
    }, undefined, {
      beforeTranscription: (_pcm, source, context) => {
        if (source === 'segment' && context.segment) startedSequences.push(context.segment.sequence);
      },
      transcribe: (pcm) => new Promise((resolve) => {
        pending.push({ resolve: (result) => resolve({ audioDurationMs: Math.round(pcm.byteLength / 32), ...result }) });
      }),
    });

    appendSpeechSegment(manager);
    appendSpeechSegment(manager);

    const startedAt = Date.now();
    while (pending.length < 2 && Date.now() - startedAt < 2_000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(startedSequences).toEqual([1, 2]);
    pending[1]?.resolve({
      provider: 'fallback',
      credentialSource: null,
      model: null,
      text: "second segment, that's it.",
    });

    const commandStartedAt = Date.now();
    while (commands.length === 0 && Date.now() - commandStartedAt < 2_000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    pending[0]?.resolve({
      provider: 'fallback',
      credentialSource: null,
      model: null,
      text: 'first segment still running',
    });
    manager.stop();

    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe('finish');
    expect(commands[0]?.transcriptText).toBe('second segment,');
  });

  test('detects terminal command from delayed tail window when the live segment misses it', async () => {
    const config = {
      ...buildStreamingTranscriptionConfigFromEnv({}),
      finalTranscriptionMode: 'full-recording' as const,
      terminalTailDelayMs: 20,
      terminalTailRetryDelayMs: 20,
      terminalTailCooldownMs: 1,
      terminalTailWindowMs: 6_000,
    };
    const commands: Array<{ type: string; transcriptText: string }> = [];
    const detections: Array<{ type: string; source: string; segmentReason: string }> = [];
    const transcriptionSources: string[] = [];
    const manager = new StreamingTranscriptionManager(config, (command) => {
      commands.push({ type: command.type, transcriptText: command.transcriptText });
    }, (detection) => {
      detections.push({ type: detection.type, source: detection.source, segmentReason: detection.segmentReason });
    }, {
      beforeTranscription: (_pcm, source) => {
        transcriptionSources.push(source);
      },
      transcribe: async () => {
        const source = transcriptionSources[transcriptionSources.length - 1];
        const text = source === 'terminal_tail'
          ? "Hey Sebastian, can you say hello back? That's it."
          : source === 'final'
            ? "Hey Sebastian, can you say hello back? That's it."
            : 'Hey Sebastian. Can you see?';
        return {
          provider: 'fallback',
          credentialSource: null,
          model: null,
          audioDurationMs: 1_000,
          text,
        };
      },
    });

    appendSpeechSegment(manager);

    const startedAt = Date.now();
    while (commands.length === 0 && Date.now() - startedAt < 2_000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    manager.stop();

    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe('finish');
    expect(commands[0]?.transcriptText).toBe('can you say hello back?');
    expect(detections).toHaveLength(1);
    expect(detections[0]).toEqual({ type: 'finish', source: 'terminal_tail', segmentReason: 'terminal_tail' });
    expect(transcriptionSources).toContain('segment');
    expect(transcriptionSources).toContain('terminal_tail');
    expect(transcriptionSources).toContain('final');
  });

  test('retries terminal tail detection once when the first tail window misses', async () => {
    const config = {
      ...buildStreamingTranscriptionConfigFromEnv({}),
      finalTranscriptionMode: 'full-recording' as const,
      terminalTailDelayMs: 20,
      terminalTailRetryDelayMs: 20,
      terminalTailCooldownMs: 1,
      terminalTailWindowMs: 6_000,
    };
    const commands: Array<{ type: string; transcriptText: string }> = [];
    const transcriptionSources: string[] = [];
    let tailAttempts = 0;
    const manager = new StreamingTranscriptionManager(config, (command) => {
      commands.push({ type: command.type, transcriptText: command.transcriptText });
    }, undefined, {
      beforeTranscription: (_pcm, source) => {
        transcriptionSources.push(source);
      },
      transcribe: async () => {
        const source = transcriptionSources[transcriptionSources.length - 1];
        if (source === 'terminal_tail') {
          tailAttempts += 1;
        }
        const text = source === 'terminal_tail' && tailAttempts >= 2
          ? "Please capture this, that's it."
          : source === 'final'
            ? "Please capture this, that's it."
            : 'Please capture this';
        return {
          provider: 'fallback',
          credentialSource: null,
          model: null,
          audioDurationMs: 1_000,
          text,
        };
      },
    });

    appendSpeechSegment(manager);

    const startedAt = Date.now();
    while (commands.length === 0 && Date.now() - startedAt < 2_000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    manager.stop();

    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe('finish');
    expect(commands[0]?.transcriptText).toBe('Please capture this,');
    expect(tailAttempts).toBe(2);
  });
});

function appendSpeechSegment(manager: StreamingTranscriptionManager): void {
  const speechChunk = speechLikeChunk();
  const silenceChunk = silentChunk();
  for (let index = 0; index < 8; index += 1) {
    manager.appendPcm(speechChunk);
  }
  for (let index = 0; index < 12; index += 1) {
    manager.appendPcm(silenceChunk);
  }
}

function speechLikeChunk(): Uint8Array {
  const samples = new Int16Array(4096);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = index % 2 === 0 ? 2500 : -2500;
  }
  return new Uint8Array(samples.buffer);
}

function silentChunk(): Uint8Array {
  return new Uint8Array(4096 * 2);
}
