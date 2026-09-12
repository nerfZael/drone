import { expect, test } from 'bun:test';
import {
  decodeLiveAudioFrame,
  encodeLiveAudioFrame,
  LiveAudioBudget,
  pcmFromBase64,
  pcmToBase64,
  type LiveAudioFrame,
  type LiveAudioSocket,
} from '../src/live-audio-stream';
import { LiveAudioClient } from '../src/live-audio-client';
import { createLiveAudioOffer, answerLiveAudioOffer } from '../src/live-audio-auth';
import { randomBytes } from 'node:crypto';

function negotiate(sessionId: string) {
  const ids = { sourceDeviceId: 'phone', targetDeviceId: 'hub', sessionId };
  const phone = createLiveAudioOffer(ids, randomBytes(48), () => true);
  return { phone, hub: answerLiveAudioOffer(ids, phone.offer, randomBytes(48), () => 'test') };
}

const frame = (sequence = 0): LiveAudioFrame => ({
  sourceDeviceId: 'hub',
  targetDeviceId: 'phone',
  sessionId: 'live',
  sequence,
  pcm: new Uint8Array(4_800),
});

test('binary audio round trips PCM and rejects malformed frames', () => {
  const pcm = new Uint8Array([0, 255, 12, 34, 55, 66]);
  expect(pcmFromBase64(pcmToBase64(pcm))).toEqual(pcm);
  expect(decodeLiveAudioFrame(encodeLiveAudioFrame({ ...frame(), pcm }))).toEqual({
    ...frame(),
    pcm,
  });
  expect(() => decodeLiveAudioFrame(new Uint8Array(10))).toThrow();
  expect(() => encodeLiveAudioFrame({ ...frame(), pcm: new Uint8Array(3) })).toThrow();
  const invalid = encodeLiveAudioFrame(frame());
  new DataView(invalid.buffer).setUint32(0, 5000);
  expect(() => decodeLiveAudioFrame(invalid)).toThrow();
});

test('audio budgets sustain both mobile capture rates for minutes, reject replays and bound floods', () => {
  let now = 0;
  for (const fps of [10, 25, 50]) {
    const budget = new LiveAudioBudget(() => now);
    for (let i = 0; i < fps * 180; i++) {
      now += 1000 / fps;
      expect(budget.accept({ ...frame(i), pcm: new Uint8Array(48_000 / fps) })).toBe(true);
    }
    expect(budget.accept(frame(fps * 180 - 1))).toBe(false);
  }
  const frames = new LiveAudioBudget(() => 0);
  for (let i = 0; i < 200; i++)
    expect(frames.accept({ ...frame(i), pcm: new Uint8Array(2) })).toBe(true);
  expect(frames.accept({ ...frame(200), pcm: new Uint8Array(2) })).toBe(false);
  const bytes = new LiveAudioBudget(() => 0);
  for (let i = 0; i < 80; i++)
    expect(bytes.accept({ ...frame(i), pcm: new Uint8Array(24_000) })).toBe(true);
  expect(bytes.accept(frame(80))).toBe(false);
});

test('mobile playback bypasses SSE event counters, ignores retired sessions, and fails on sequence gaps', () => {
  let now = 0;
  const original = Date.now;
  Date.now = () => now;
  try {
    const sent: Uint8Array[] = [];
    const socket: LiveAudioSocket = {
      readyState: 1,
      bufferedAmount: 0,
      binaryType: 'arraybuffer',
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: (data) => sent.push(data),
      close() {
        this.readyState = 3;
      },
    };
    const client = new LiveAudioClient(socket, 'phone');
    let played = 0;
    const errors: string[] = [];
    const exchange = negotiate('live');
    const stream = client.open(
      'hub',
      'live',
      () => played++,
      (error) => errors.push(error),
      exchange.phone,
    );
    stream.accept(exchange.hub.answer);
    for (let i = 0; i < 2_000; i++) {
      now += 100;
      socket.onmessage!({ data: encodeLiveAudioFrame(exchange.hub.auth.protect(frame(i))) });
    }
    expect(played).toBe(2_000);
    expect(errors).toEqual([]);
    stream.close();
    socket.onmessage!({ data: encodeLiveAudioFrame(frame(2_000)) });
    expect(played).toBe(2_000);
    const next = negotiate('new');
    const replacement = client.open(
      'hub',
      'new',
      () => played++,
      (error) => errors.push(error),
      next.phone,
    );
    replacement.accept(next.hub.answer);
    socket.onmessage!({
      data: encodeLiveAudioFrame(next.hub.auth.protect({ ...frame(1), sessionId: 'new' })),
    });
    expect(errors).toHaveLength(1);
    expect(socket.readyState).toBe(1);
  } finally {
    Date.now = original;
  }
});
