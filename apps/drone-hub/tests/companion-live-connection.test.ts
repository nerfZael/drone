import { expect, test } from 'bun:test';
import { CompanionLiveConnection } from '../src/droneHub/companion/CompanionLiveConnection';
import { browserMicrophoneCoordinator } from '../src/droneHub/chat/browser-microphone-coordinator';
import { CompanionClientController, type CompanionServerMessage, type LivePcmCallbacks, type LivePcmAudio } from '@drone/assistant-chat';
import { waitForCompanionReply } from '../src/droneHub/companion/waitForCompanionReply';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(delayed = false) {
  const originalSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let socket: FakeSocket | undefined;
  class FakeSocket {
    static OPEN = 1;
    readyState = 0; bufferedAmount = 0; sent: any[] = [];
    failSend = false;
    onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (event: { data: string }) => void;
    constructor(_url: string) { socket = this; }
    open() { this.readyState = 1; this.onopen?.(); }
    send(data: string) { if (this.failSend) throw new Error('Socket failed'); this.sent.push(JSON.parse(data)); }
    message(event: unknown) { this.onmessage?.({ data: JSON.stringify(event) }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://localhost' } } });
  let capture!: LivePcmCallbacks; let finish!: (audio: LivePcmAudio) => void;
  let released = 0; let muted = false; let resumed = false;
  const played: string[] = []; const errors: string[] = []; const models: string[] = []; const events: unknown[] = [];
  const audio: LivePcmAudio = { mute: (value) => { muted = value; }, play: (value) => played.push(value),
    resume: async () => { resumed = true; }, release: async () => { released++; } };
  const connection = new CompanionLiveConnection({ onEvent: (event) => events.push(event), onReady: (model) => models.push(model),
    onError: (error) => errors.push(error), onPlaybackBlocked() {}, openAudio: async (callbacks) => {
      capture = callbacks;
      capture.onAudio('AQI='); // Capture may begin before native/browser setup resolves.
      return delayed ? new Promise((resolve) => { finish = resolve; }) : audio;
    } });
  return { connection, socket: () => socket!, capture: (value: string) => capture.onAudio(value),
    finish: () => finish(audio), errors, models, events, played, released: () => released, muted: () => muted, resumed: () => resumed,
    async cleanup() {
      connection.close(); socket?.message({ type: 'live_closed' }); await tick();
      for (const [name, value] of [['WebSocket', originalSocket], ['window', originalWindow]] as const) {
        if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name);
      }
    } };
}

test('desktop buffers from audio startup and flushes once before continuing live capture', async () => {
  const h = harness();
  try {
    await h.connection.start();
    h.capture('AwQ=');
    expect(h.muted()).toBe(false);
    h.socket().open();
    expect(h.socket().sent).toEqual([{ type: 'live_start', transport: 'pcm' }]);
    h.socket().message({ type: 'live_ready', transport: 'pcm', backendModel: 'chosen' });
    h.capture('BQY='); await tick();
    expect(h.socket().sent.slice(1).map((message) => message.event.audio)).toEqual(['AQIDBA==', 'BQY=']);
    h.socket().message({ type: 'live_ready', transport: 'pcm', backendModel: 'chosen' });
    expect(h.models).toEqual(['chosen']);
    h.socket().message({ type: 'live_event', event: { type: 'session.output_audio.delta', delta: 'Bwg=' } });
    h.socket().message({ type: 'live_event', event: { type: 'session.input_transcript.delta', delta: 'Hello' } });
    expect(h.played).toEqual(['Bwg=']); expect(h.events).toHaveLength(1);
    await h.connection.play(); expect(h.resumed()).toBe(true);
    expect(h.errors).toEqual([]);
  } finally { await h.cleanup(); }
  expect(h.released()).toBe(1);
  expect(browserMicrophoneCoordinator.getSnapshot()).toBeNull();
});

test('desktop startup mute discards queued speech and remains muted on connection', async () => {
  const h = harness();
  try {
    await h.connection.start(); h.connection.mute(true); h.capture('AwQ='); h.socket().open();
    h.socket().message({ type: 'live_ready', transport: 'pcm' }); await tick();
    expect(h.socket().sent.slice(1).map((message) => message.event.audio)).toEqual(['AAA=']);
    expect(h.muted()).toBe(true);
  } finally { await h.cleanup(); }
});

test('desktop cancel during microphone startup releases late audio without opening a session', async () => {
  const h = harness(true);
  try {
    const start = h.connection.start(); h.connection.close();
    expect(browserMicrophoneCoordinator.getSnapshot()).toBe('companion');
    h.finish(); await start; await tick();
    expect(h.socket()).toBeUndefined(); expect(h.released()).toBe(1);
    expect(browserMicrophoneCoordinator.getSnapshot()).toBeNull();
  } finally { await h.cleanup(); }
});

test('desktop drops queued speech after a startup error and ignores late readiness', async () => {
  const h = harness();
  try {
    await h.connection.start(); h.socket().open(); h.socket().message({ type: 'live_error', error: 'No credentials' });
    h.capture('AwQ='); h.socket().message({ type: 'live_ready', transport: 'pcm' }); await tick();
    expect(h.models).toEqual([]); expect(h.errors).toEqual(['No credentials']);
    expect(h.socket().sent.some((event) => event.type === 'live_event')).toBe(false);
    expect(h.released()).toBe(1);
  } finally { await h.cleanup(); }
});

test('desktop socket send failures report an error and still release the microphone', async () => {
  for (const phase of ['start', 'event', 'close']) {
    const h = harness();
    try {
      await h.connection.start();
      if (phase !== 'start') h.socket().open();
      h.socket().failSend = true;
      expect(() => {
        if (phase === 'start') h.socket().open();
        else if (phase === 'event') h.connection.send({ type: 'session.commentary.append' });
        else h.connection.close();
      }).not.toThrow();
      await tick();
      expect(h.released()).toBe(1);
      expect(h.socket().readyState).toBe(3);
      expect(h.errors).toHaveLength(phase === 'close' ? 0 : 1);
      expect(browserMicrophoneCoordinator.getSnapshot()).toBeNull();
    } finally { await h.cleanup(); }
  }
});

test('ending voice rejects the result waiter without cancelling an active Companion backend', async () => {
  let receive!: (message: CompanionServerMessage) => void;
  let cancelled = false;
  const controller = new CompanionClientController({ createId: () => 'test-id' });
  const abort = new AbortController();
  const reply = waitForCompanionReply(controller, () => controller.submitPrompt({
    prompt: 'work', executeTool: () => ({}), createTransport: () => ({
      open: async (input) => { receive = input.onMessage; return undefined; },
      sendPrompt: () => {}, sendToolResult: () => {}, cancel: () => { cancelled = true; }, close: () => {},
    }),
  }), abort.signal);
  await Promise.resolve();
  abort.abort();
  await expect(reply).rejects.toThrow('Voice conversation ended');
  expect(cancelled).toBe(false);
  receive({ type: 'reply', reply: 'Finished in the UI' });
  receive({ type: 'status', status: 'completed' });
  expect(controller.getSnapshot().reply).toBe('Finished in the UI');
  await controller.close();
});
