import { describe, expect, test } from 'bun:test';
import {
  ContinuousVoiceSession,
  type ContinuousVoiceSessionSnapshot,
} from '../src/continuous-voice-session';

function pcm(milliseconds: number, amplitude: number): Int16Array {
  const output = new Int16Array(Math.round((milliseconds * 16_000) / 1_000));
  for (let index = 0; index < output.length; index += 1) {
    output[index] = index % 2 === 0 ? amplitude : -amplitude;
  }
  return output;
}

function thought(): Int16Array {
  const speech = pcm(120, 8_000);
  const silence = pcm(300, 10);
  const output = new Int16Array(speech.length + silence.length);
  output.set(speech);
  output.set(silence, speech.length);
  return output;
}

async function waitFor(check: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > 2_000) throw new Error('timed out waiting for voice session');
    await Bun.sleep(5);
  }
}

describe('ContinuousVoiceSession', () => {
  test('serializes transcription, context, delivery ids, and confirmation', async () => {
    const snapshots: ContinuousVoiceSessionSnapshot[] = [];
    const transcriptionContexts: string[] = [];
    const deliveries: Array<{ text: string; id: string }> = [];
    let confirmationCount = 0;
    const session = new ContinuousVoiceSession({
      onChange: (snapshot) => snapshots.push(snapshot),
      onError: (message) => {
        throw new Error(message);
      },
    });
    let transcriptSequence = 0;
    session.start({
      sessionId: 'voice-session',
      endpointConfig: {
        silenceMillis: 250,
        minimumSpeechMillis: 40,
        preRollMillis: 0,
        trailingMillis: 40,
      },
      transcribe: async ({ context }) => {
        transcriptionContexts.push(context);
        transcriptSequence += 1;
        return transcriptSequence === 1 ? 'first thought' : 'second thought';
      },
      deliver: async (text, id) => {
        deliveries.push({ text, id });
        return true;
      },
      confirm: () => {
        confirmationCount += 1;
      },
    });
    session.listen();
    session.push(thought());
    await waitFor(() => deliveries.length === 1);
    session.push(thought());
    await waitFor(() => deliveries.length === 2);

    expect(transcriptionContexts).toEqual(['', 'first thought']);
    expect(deliveries).toEqual([
      { text: 'first thought', id: 'voice-session.0' },
      { text: 'second thought', id: 'voice-session.1' },
    ]);
    expect(confirmationCount).toBe(2);
    expect(snapshots[snapshots.length - 1]).toMatchObject({
      status: 'listening',
      pendingCount: 0,
      durationMillis: 840,
    });
  });

  test('retains a failed segment and finishes after retry', async () => {
    const errors: string[] = [];
    let attempts = 0;
    const delivered: string[] = [];
    const session = new ContinuousVoiceSession({
      onChange: () => undefined,
      onError: (message) => errors.push(message),
    });
    session.start({
      sessionId: 'retry-session',
      endpointConfig: { silenceMillis: 250, minimumSpeechMillis: 40 },
      transcribe: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary transcription failure');
        return 'recovered thought';
      },
      deliver: async (text) => {
        delivered.push(text);
        return true;
      },
    });
    session.listen();
    session.push(thought());
    await waitFor(() => session.status === 'error');
    expect(errors).toEqual(['temporary transcription failure']);

    expect(await session.finish()).toBe(true);
    expect(session.status).toBe('idle');
    expect(delivered).toEqual(['recovered thought']);
  });

  test('aborts in-flight transcription and clears retained audio on cancel', async () => {
    let transcriptionSignal: AbortSignal | null = null;
    const session = new ContinuousVoiceSession({
      onChange: () => undefined,
      onError: () => undefined,
    });
    session.start({
      sessionId: 'cancel-session',
      endpointConfig: { silenceMillis: 250, minimumSpeechMillis: 40 },
      transcribe: async ({ signal }) => {
        transcriptionSignal = signal;
        return await new Promise<string>(() => undefined);
      },
      deliver: async () => true,
    });
    session.listen();
    session.push(thought());
    await waitFor(() => transcriptionSignal !== null);
    session.cancel();

    expect(session.status).toBe('idle');
    expect(transcriptionSignal?.aborted).toBe(true);
  });

  test('does not confirm a delivery that finishes after cancellation', async () => {
    let finishDelivery: ((accepted: boolean) => void) | null = null;
    let confirmationCount = 0;
    const session = new ContinuousVoiceSession({
      onChange: () => undefined,
      onError: (message) => {
        throw new Error(message);
      },
    });
    session.start({
      sessionId: 'cancel-delivery-session',
      endpointConfig: { silenceMillis: 250, minimumSpeechMillis: 40 },
      transcribe: async () => 'late delivery',
      deliver: async () =>
        await new Promise<boolean>((resolve) => {
          finishDelivery = resolve;
        }),
      confirm: () => {
        confirmationCount += 1;
      },
    });
    session.listen();
    session.push(thought());
    await waitFor(() => finishDelivery !== null);
    session.cancel();
    finishDelivery!(true);
    await Bun.sleep(0);

    expect(session.status).toBe('idle');
    expect(confirmationCount).toBe(0);
  });

  test('coalesces unchanged snapshots between duration updates', () => {
    const snapshots: ContinuousVoiceSessionSnapshot[] = [];
    const session = new ContinuousVoiceSession({
      onChange: (snapshot) => snapshots.push(snapshot),
      onError: () => undefined,
    });
    session.start({
      sessionId: 'snapshot-session',
      endpointConfig: {},
      transcribe: async () => '',
      deliver: async () => true,
    });
    session.listen();
    const initialSnapshotCount = snapshots.length;
    for (let index = 0; index < 20; index += 1) session.push(pcm(10, 10));
    expect(snapshots).toHaveLength(initialSnapshotCount);

    session.push(pcm(300, 10));
    expect(snapshots).toHaveLength(initialSnapshotCount + 1);
    expect(snapshots[snapshots.length - 1]?.durationMillis).toBe(500);
  });

  test('bounds retained audio when transcription falls behind', async () => {
    const errors: string[] = [];
    let latestSnapshot: ContinuousVoiceSessionSnapshot | null = null;
    const session = new ContinuousVoiceSession({
      maximumPendingSegments: 1,
      onChange: (snapshot) => {
        latestSnapshot = snapshot;
      },
      onError: (message) => errors.push(message),
    });
    session.start({
      sessionId: 'backlog-session',
      endpointConfig: { maximumSegmentMillis: 1_000, minimumSpeechMillis: 40 },
      transcribe: async () => await new Promise<string>(() => undefined),
      deliver: async () => true,
    });
    session.listen();
    session.push(pcm(3_500, 8_000));

    expect(session.status).toBe('error');
    expect(latestSnapshot).toMatchObject({ pendingCount: 2 });
    expect(errors).toEqual([
      'Continuous voice stopped accepting audio because its retained backlog is full.',
    ]);
    session.cancel();
  });

  test('checkpoints speech across a native interruption', async () => {
    const delivered: string[] = [];
    const session = new ContinuousVoiceSession({
      onChange: () => undefined,
      onError: (message) => {
        throw new Error(message);
      },
    });
    session.start({
      sessionId: 'recovery-session',
      endpointConfig: { minimumSpeechMillis: 40 },
      transcribe: async () => 'checkpointed thought',
      deliver: async (text) => {
        delivered.push(text);
        return true;
      },
    });
    session.listen();
    session.push(pcm(120, 8_000));
    session.interrupt();
    expect(session.status).toBe('recovering');
    session.recover();
    expect(session.status).toBe('listening');
    await waitFor(() => delivered.length === 1);
  });
});
