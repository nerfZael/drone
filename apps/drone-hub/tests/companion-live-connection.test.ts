import { expect, test } from 'bun:test';
import { CompanionLiveConnection } from '../src/droneHub/companion/CompanionLiveConnection';
import { browserMicrophoneCoordinator } from '../src/droneHub/chat/browser-microphone-coordinator';
import { CompanionClientController, type CompanionServerMessage } from '@drone/assistant-chat';
import { waitForCompanionReply } from '../src/droneHub/companion/waitForCompanionReply';

test('Live audio waits for startup, handles captions and autoplay, and releases all local resources', async () => {
  const h = browserHarness();
  const errors: string[] = [];
  const events: unknown[] = [];
  const models: string[] = [];
  const blocked: boolean[] = [];
  const connection = new CompanionLiveConnection({
    onEvent: (event) => events.push(event), onReady: (model) => models.push(model),
    onError: (error) => errors.push(error), onPlaybackBlocked: (value) => blocked.push(value),
  });
  try {
    await connection.start();
    expect(h.track.enabled).toBe(false);
    expect(browserMicrophoneCoordinator.getSnapshot()).toBe('companion');
    h.socket().open();
    expect(h.socket().sent[0]).toMatchObject({ type: 'live_start', sdp: 'v=0\r\n' });
    h.socket().message({ type: 'live_ready', sdp: 'answer', backendModel: 'selected-backend' });
    h.peer().channel.readyState = 'open';
    h.peer().channel.message(null);
    h.socket().message(null);
    h.peer().channel.message({ type: 'session.started' });
    expect(h.track.enabled).toBe(true);
    expect(models).toEqual(['selected-backend']);
    h.peer().ontrack?.({ streams: [{}] });
    await Promise.resolve();
    expect(blocked.at(-1)).toBe(true);
    h.audio.allowPlayback = true;
    await connection.play();
    expect(blocked.at(-1)).toBe(false);
    h.socket().message({ type: 'live_event', event: { type: 'session.input_transcript.delta', delta: 'Hello' } });
    expect(events).toHaveLength(1);
    connection.mute(true);
    expect(h.track.enabled).toBe(false);
    connection.mute(false);
    expect(h.track.enabled).toBe(true);
    connection.close();
    expect(h.track.stopped).toBe(true);
    expect(h.peer().closed).toBe(false);
    h.peer().ontrack?.({ streams: [{}] });
    expect(h.audio.srcObject).toBeNull();
    h.peer().channel.message({ type: 'session.closed' });
    expect(h.peer().closed).toBe(true);
    expect(h.socket().sent.at(-1)).toEqual({ type: 'live_close' });
    expect(h.audio.srcObject).toBeNull();
    expect(browserMicrophoneCoordinator.getSnapshot()).toBeNull();
    expect(errors).toEqual([]);
  } finally { connection.close(); h.restore(); }
});

test('Live overlaps negotiation with control attachment and preserves startup mute', async () => {
  const h = browserHarness();
  const models: string[] = [];
  const connection = new CompanionLiveConnection({ onEvent() {}, onReady: (model) => models.push(model), onError() {}, onPlaybackBlocked() {} });
  try {
    await connection.start();
    h.socket().open();
    h.socket().message({ type: 'live_answer', sdp: 'early-answer', backendModel: 'chosen' });
    expect(h.peer().answers).toEqual(['early-answer']);
    h.peer().channel.message({ type: 'session.started' });
    expect(models).toEqual([]);
    expect(h.track.enabled).toBe(false);
    connection.mute(true);
    h.socket().message({ type: 'live_ready', sdp: 'early-answer', backendModel: 'chosen' });
    expect(models).toEqual(['chosen']);
    expect(h.track.enabled).toBe(false);
    expect(h.peer().answers).toEqual(['early-answer']);
    connection.mute(false);
    expect(h.track.enabled).toBe(true);
  } finally { connection.close(); h.peer().channel.message({ type: 'session.closed' }); h.restore(); }
});

test('desktop opens its control socket while ICE is gathering and sends the offer once', async () => {
  const h = browserHarness(undefined, true);
  const connection = new CompanionLiveConnection({ onEvent() {}, onReady() {}, onError() {}, onPlaybackBlocked() {} });
  try {
    const starting = connection.start();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    h.socket().open();
    expect(h.socket().sent).toEqual([]);
    h.peer().iceGatheringState = 'complete';
    h.peer().dispatchEvent(new Event('icegatheringstatechange'));
    await starting;
    expect(h.socket().sent).toEqual([{ type: 'live_start', sdp: 'v=0\r\n' }]);
  } finally { connection.close(); h.peer().channel.message({ type: 'session.closed' }); h.restore(); }
});

test('cancelling microphone startup stops a late stream and never creates a session', async () => {
  let finish!: (stream: unknown) => void;
  const h = browserHarness(() => new Promise((resolve) => { finish = resolve; }));
  const connection = new CompanionLiveConnection({ onEvent: () => {}, onReady: () => {}, onError: () => {}, onPlaybackBlocked: () => {} });
  try {
    const starting = connection.start();
    connection.close();
    finish(h.stream);
    await starting;
    expect(h.track.stopped).toBe(true);
    expect(h.socket()).toBeUndefined();
    expect(browserMicrophoneCoordinator.getSnapshot()).toBeNull();
  } finally { connection.close(); h.restore(); }
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

function browserHarness(getUserMedia?: () => Promise<unknown>, gathering = false) {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  const track = { enabled: true, stopped: false, onended: null as null | (() => void), stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  const audio = { autoplay: false, srcObject: null as unknown, allowPlayback: false, pause() {},
    async play() { if (!this.allowPlayback) throw new Error('autoplay blocked'); } };
  let socket: FakeSocket;
  let peer: FakePeer;
  class FakeSocket {
    static OPEN = 1;
    readyState: number | string = 0;
    sent: any[] = [];
    onopen?: () => void;
    onclose?: () => void;
    onerror?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor(_url: string) { socket = this; }
    open() { this.readyState = 1; this.onopen?.(); }
    send(text: string) { this.sent.push(JSON.parse(text)); }
    message(event: unknown) { this.onmessage?.({ data: JSON.stringify(event) }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  class FakePeer extends EventTarget {
    iceGatheringState = gathering ? 'gathering' : 'complete';
    localDescription = { sdp: 'v=0\r\n' };
    connectionState = 'connected';
    closed = false;
    channel = new FakeSocket('channel');
    ontrack?: (event: any) => void;
    onconnectionstatechange?: () => void;
    constructor() { super(); peer = this; }
    addTrack() {}
    createDataChannel() { return this.channel; }
    async createOffer() { return this.localDescription; }
    async setLocalDescription() {}
    answers: string[] = [];
    async setRemoteDescription(answer: { sdp: string }) { this.answers.push(answer.sdp); }
    close() { this.closed = true; }
  }
  set('window', { location: { origin: 'http://localhost' } });
  set('navigator', { mediaDevices: { getUserMedia: getUserMedia ?? (async () => stream) } });
  set('document', { createElement: () => audio });
  set('RTCPeerConnection', FakePeer);
  set('WebSocket', FakeSocket);
  return { track, stream, audio, socket: () => socket, peer: () => peer, restore: () => {
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
  } };
}
