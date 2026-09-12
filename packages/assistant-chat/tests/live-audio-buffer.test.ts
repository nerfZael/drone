import { expect, test } from 'bun:test';
import { LiveAudioBuffer, joinLiveAudioChunks } from '../src/live-audio-buffer';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('opening speech drains in order before audio captured while the send is pending', async () => {
  const sent: string[] = [];
  let finish!: () => void;
  const buffer = new LiveAudioBuffer(async (audio) => {
    sent.push(audio);
    if (sent.length === 1) await new Promise<void>((resolve) => { finish = resolve; });
  }, () => { throw new Error('unexpected error'); }, undefined, 2);
  buffer.append('AQI='); buffer.append('AwQ=');
  expect(sent).toEqual([]);
  buffer.connect();
  buffer.append('BQY=');
  expect(sent).toEqual(['AQI=']);
  finish(); await tick();
  expect(sent).toEqual(['AQI=', 'AwQ=', 'BQY=']);
  buffer.connect(); await tick();
  expect(sent).toHaveLength(3);
  buffer.close();
});

test('mute discards unsent speech and supplies silence; unmute resumes capture', async () => {
  const sent: string[] = [];
  const buffer = new LiveAudioBuffer(async (audio) => { sent.push(audio); }, () => {});
  buffer.append('AQI='); buffer.mute(true); buffer.append('AwQ='); buffer.connect();
  await tick(); expect(sent).toEqual(['AAA=']);
  buffer.mute(false); buffer.append('BQY='); await tick();
  expect(sent).toEqual(['AAA=', 'BQY=']); buffer.close();
});

test('close during flush discards the remaining and late microphone frames', async () => {
  const sent: string[] = [];
  let finish!: () => void;
  const buffer = new LiveAudioBuffer(async (audio) => { sent.push(audio); await new Promise<void>((resolve) => { finish = resolve; }); }, () => {}, undefined, 2);
  buffer.append('AQI='); buffer.append('AwQ='); buffer.connect(); buffer.close();
  buffer.append('BQY='); finish(); await tick(); expect(sent).toEqual(['AQI=']);
});

test('overflow fails explicitly instead of dropping the opening words or growing without bound', async () => {
  const errors: string[] = []; const sent: string[] = [];
  const buffer = new LiveAudioBuffer(async (audio) => { sent.push(audio); }, (error) => errors.push(error), 4);
  buffer.append('AQI='); buffer.append('AwQ='); buffer.append('BQY=');
  buffer.connect(); await tick(); expect(errors).toHaveLength(1); expect(sent).toEqual([]);
});

test('send rejection fails once and drops queued audio', async () => {
  const errors: string[] = [];
  const buffer = new LiveAudioBuffer(async () => { throw new Error('offline'); }, (error) => errors.push(error));
  buffer.append('AQI='); buffer.append('AwQ='); buffer.connect(); await tick();
  buffer.append('BQY='); expect(errors).toHaveLength(1);
});

test('batched base64 preserves bytes across differently padded PCM frame boundaries', () => {
  const chunks = Array.from({ length: 50 }, (_, i) => Buffer.from(Array.from({ length: (i + 1) * 2 }, (_, n) => (i + n * 37) % 256)));
  expect(joinLiveAudioChunks(chunks.map((chunk) => chunk.toString('base64')))).toBe(Buffer.concat(chunks).toString('base64'));
});

test('startup backlog batches at most 500 ms of PCM to avoid one mesh round trip per frame', async () => {
  const sent: string[] = [];
  const buffer = new LiveAudioBuffer(async (audio) => { sent.push(audio); }, () => {});
  const frame = Buffer.alloc(4800, 1).toString('base64');
  for (let i = 0; i < 12; i++) buffer.append(frame);
  buffer.connect(); await tick();
  expect(sent.map((chunk) => Buffer.from(chunk, 'base64').length)).toEqual([24000, 24000, 9600]);
  expect(Buffer.concat(sent.map((chunk) => Buffer.from(chunk, 'base64')))).toEqual(Buffer.alloc(12 * 4800, 1));
  buffer.close();
});
