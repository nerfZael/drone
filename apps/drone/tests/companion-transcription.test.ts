import { EventEmitter } from 'node:events';
import { expect, test } from 'bun:test';
import { WebSocket } from 'ws';
import { CompanionTranscriptionSocket } from '../src/hub/companion/CompanionTranscriptionSocket';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
class Socket extends EventEmitter {
  readyState = WebSocket.CONNECTING as number;
  bufferedAmount = 0;
  sent: any[] = [];
  closed = false;
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.closed = true; }
  terminate() { this.closed = true; }
  event(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value))); }
}
function harness() {
  const upstream = new Socket(); const events: any[] = []; const urls: string[] = [];
  const session = new CompanionTranscriptionSocket(event => events.push(event), {
    connect: url => { urls.push(url); return upstream as unknown as WebSocket; },
    credentials: async () => ({ apiKey: 'test-openai-key' }),
  });
  return { session, upstream, events, urls };
}

test('streams transcript deltas before any completed turn and never configures a delegated GPT-Live model', async () => {
  const h = harness();
  try {
    h.session.handle({ type: 'live_start' }); await tick();
    h.upstream.readyState = WebSocket.OPEN; h.upstream.emit('open');
    expect(h.urls).toEqual(['wss://api.openai.com/v1/realtime?intent=transcription']);
    expect(h.upstream.sent[0]).toMatchObject({ type: 'session.update', session: { type: 'transcription', audio: { input: {
      transcription: { model: 'gpt-live-transcribe', delay: 'minimal' },
      turn_detection: null,
    } } } });
    expect(h.upstream.sent[0].session.delegation).toBeUndefined();
    h.upstream.event({ type: 'session.updated', session: { apiKey: 'must-not-forward' } });
    h.session.handle({ type: 'live_event', event: { type: 'session.input_audio.append', audio: 'AQI=' } });
    expect(h.upstream.sent.at(-1)).toEqual({ type: 'input_audio_buffer.append', audio: 'AQI=' });
    h.upstream.event({ type: 'conversation.item.input_audio_transcription.delta', item_id: '1', delta: 'Open settings', event_id: 'e1' });
    expect(h.events.at(-1)).toMatchObject({ type: 'live_event', event: { type: 'conversation.item.input_audio_transcription.delta', delta: 'Open settings' } });
    expect(JSON.stringify(h.events)).not.toContain('must-not-forward');
    expect(JSON.stringify(h.events)).not.toContain('test-openai-key');
  } finally { h.session.close(); }
  expect(h.upstream.closed).toBe(true);
});

test('rejects browser session configuration and suppresses provider error details', async () => {
  const h = harness();
  h.session.handle({ type: 'live_start' }); await tick();
  h.upstream.readyState = WebSocket.OPEN; h.upstream.emit('open'); h.upstream.event({ type: 'session.updated' });
  h.session.handle({ type: 'live_event', event: { type: 'session.update', apiKey: 'browser-value' } });
  expect(h.upstream.sent).toHaveLength(1);
  h.upstream.event({ type: 'error', error: { message: 'test-openai-key' } });
  expect(h.upstream.closed).toBe(true);
  expect(h.events.some(event => event.type === 'live_error')).toBe(true);
  expect(JSON.stringify(h.events)).not.toContain('test-openai-key');
});

test('cancelling during credential resolution opens no transcription connection', async () => {
  let resolve!: (key: { apiKey: string }) => void;
  let connected = false;
  const session = new CompanionTranscriptionSocket(() => {}, {
    connect: () => { connected = true; return new Socket() as unknown as WebSocket; },
    credentials: () => new Promise(done => { resolve = done; }),
  });
  session.handle({ type: 'live_start' }); session.close(); resolve({ apiKey: 'test-openai-key' }); await tick();
  expect(connected).toBe(false);
});

test('reports rejected configuration without exposing provider messages', async () => {
  const h = harness();
  h.session.handle({ type: 'live_start' }); await tick();
  h.upstream.readyState = WebSocket.OPEN; h.upstream.emit('open');
  h.upstream.event({ type: 'error', error: {
    code: 'invalid_value', param: 'session.audio.input.turn_detection', message: 'test-openai-key',
  } });
  expect(h.events.find(event => event.type === 'live_error').error).toContain('rejected the turn detection setting');
  expect(JSON.stringify(h.events)).not.toContain('test-openai-key');
  expect(h.upstream.closed).toBe(true);
});

test('commits bounded audio turns while forwarding deltas immediately', async () => {
  const h = harness();
  try {
    h.session.handle({ type: 'live_start' }); await tick();
    h.upstream.readyState = WebSocket.OPEN; h.upstream.emit('open');
    h.upstream.event({ type: 'session.updated' });
    const audio = Buffer.alloc(24_000).toString('base64'); // half a second of PCM16
    for (let i = 0; i < 19; i++) h.session.handle({ type: 'live_event', event: { type: 'session.input_audio.append', audio } });
    expect(h.upstream.sent.some(event => event.type === 'input_audio_buffer.commit')).toBe(false);
    h.upstream.event({ type: 'conversation.item.input_audio_transcription.delta', item_id: '1', delta: 'Delegate now' });
    expect(h.events.at(-1).event.delta).toBe('Delegate now');
    h.session.handle({ type: 'live_event', event: { type: 'session.input_audio.append', audio } });
    expect(h.upstream.sent.at(-1)).toEqual({ type: 'input_audio_buffer.commit' });
    h.session.handle({ type: 'live_event', event: { type: 'session.input_audio.append', audio } });
    expect(h.upstream.sent.filter(event => event.type === 'input_audio_buffer.commit')).toHaveLength(1);
  } finally { h.session.close(); }
});
