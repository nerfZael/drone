import { EventEmitter } from 'node:events';
import { expect, test } from 'bun:test';
import { WebSocket } from 'ws';
import { CompanionLiveSocket } from '../src/hub/companion/CompanionLiveSocket';
import { DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT } from '../src/hub/companion/companion-live-settings';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING; bufferedAmount = 0; sent: any[] = []; terminated = false;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
  terminate() { this.terminated = true; this.close(); }
}
function harness(overrides: Record<string, unknown> = {}) {
  const upstream = new FakeSocket(); const messages: any[] = [];
  const session = new CompanionLiveSocket((event) => messages.push(event), {
    credentials: async () => ({ apiKey: 'private-key' }), enabled: async () => ({ enabled: true }),
    backend: async () => ({ model: 'chosen', provider: 'codex' }),
    connect: (url, key) => {
      expect(url).toBe('wss://api.openai.com/v1/live/sessions'); expect(key).toBe('private-key');
      return upstream as unknown as WebSocket;
    },
    fetch: async () => { throw new Error('PCM must not create a WebRTC session'); }, ...overrides,
  });
  const event = (value: unknown) => upstream.emit('message', Buffer.from(JSON.stringify(value)));
  return { session, upstream, messages, event };
}

test('PCM uses the primary socket, waits for session.started, validates audio and preserves client delegation', async () => {
  const h = harness();
  h.session.handle({ type: 'live_start', transport: 'pcm' }); await tick();
  h.upstream.readyState = WebSocket.OPEN; h.upstream.emit('open');
  expect(h.upstream.sent).toHaveLength(1);
  expect(h.upstream.sent[0]).toMatchObject({ type: 'session.start', session: {
    model: 'gpt-live-1', delegation: { type: 'client' }, audio: { format: { type: 'audio/pcm', rate: 24000 } }, store: false,
  } });
  const input = (audio: string) => h.session.handle({ type: 'live_event', event: { type: 'session.input_audio.append', audio } });
  input('AQI='); expect(h.upstream.sent).toHaveLength(1); expect(h.messages).toEqual([]);
  h.event({ type: 'session.started', session: { id: 'session' } });
  expect(h.messages).toEqual([{ type: 'live_ready', transport: 'pcm', backendModel: 'chosen' }]);
  input('AQI='); input('AwQ=');
  for (const invalid of ['bad!', 'AQ==', 'AQJ=', 'A'.repeat(32004)]) input(invalid);
  expect(h.upstream.sent.slice(1)).toEqual([
    { type: 'session.input_audio.append', audio: 'AQI=' }, { type: 'session.input_audio.append', audio: 'AwQ=' },
  ]);
  h.session.handle({ type: 'live_event', event: { type: 'session.update', session: { model: 'other' } } });
  expect(h.upstream.sent).toHaveLength(3);
  h.event({ type: 'session.output_audio.delta', delta: 'BQY=' });
  expect(h.messages.at(-1)).toMatchObject({ type: 'live_event', event: { type: 'session.output_audio.delta', delta: 'BQY=' } });
  expect(JSON.stringify(h.messages)).not.toContain('private-key');
  h.session.close(); expect(h.upstream.sent.at(-1)).toEqual({ type: 'session.close' });
  input('AQI='); expect(h.upstream.sent.at(-1)).toEqual({ type: 'session.close' });
  h.event({ type: 'session.closed' }); expect(h.messages.at(-1)).toEqual({ type: 'live_closed' });
});

test('PCM cancellation before credentials resolve never opens an upstream connection', async () => {
  let resolve!: (value: { apiKey: string }) => void;
  let connected = false;
  const h = harness({ credentials: () => new Promise((finish) => { resolve = finish; }), connect: () => { connected = true; throw new Error('late'); } });
  h.session.handle({ type: 'live_start', transport: 'pcm' }); h.session.close();
  resolve({ apiKey: 'private-key' }); await tick(); expect(connected).toBe(false); expect(h.messages).toEqual([]);
});

test('PCM cancellation during handshake terminates without starting a billable session', async () => {
  const h = harness(); h.session.handle({ type: 'live_start', transport: 'pcm' }); await tick(); h.session.close();
  expect(h.upstream.terminated).toBe(true); h.upstream.emit('open'); expect(h.upstream.sent).toEqual([]);
});

test('PCM startup send failure is contained and terminates the upstream socket', async () => {
  const h = harness(); h.session.handle({ type: 'live_start', transport: 'pcm' }); await tick();
  h.upstream.readyState = WebSocket.OPEN;
  h.upstream.send = () => { throw new Error('Socket failed'); };
  expect(() => h.upstream.emit('open')).not.toThrow();
  expect(h.upstream.terminated).toBe(true);
  expect(h.messages).toEqual([{ type: 'live_error', error: 'Live audio connection failed.' }]);
});

test('PCM enforces settings and bounds upstream backpressure', async () => {
  const disabled = harness({ enabled: async () => ({ enabled: false }) });
  disabled.session.handle({ type: 'live_start', transport: 'pcm' }); await tick();
  expect(disabled.messages[0].type).toBe('live_error');
  const h = harness(); h.session.handle({ type: 'live_start', transport: 'pcm' }); await tick();
  h.upstream.readyState = WebSocket.OPEN; h.upstream.emit('open'); h.event({ type: 'session.started' });
  h.upstream.bufferedAmount = 2_000_001;
  h.session.handle({ type: 'live_event', event: { type: 'session.input_audio.append', audio: 'AQI=' } });
  expect(h.messages.at(-1).type).toBe('live_error'); h.event({ type: 'session.closed' });
});

for (const systemPrompt of [undefined, '', '  Custom voice instructions.\nKeep this exact.  ']) {
  test(`PCM sends the saved prompt verbatim (${systemPrompt === undefined ? 'default' : systemPrompt === '' ? 'empty' : 'custom'})`, async () => {
    const h = harness({ enabled: async () => ({ enabled: true, systemPrompt }) });
    h.session.handle({ type: 'live_start', transport: 'pcm' }); await tick();
    h.upstream.readyState = WebSocket.OPEN; h.upstream.emit('open');
    expect(h.upstream.sent[0].session.instructions).toBe(systemPrompt ?? DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT);
    h.session.close();
  });
}
