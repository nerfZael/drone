import { expect, test } from 'bun:test';
import { LiveTranscript } from '../src/live-transcript';

test('a backchannel does not split the user sentence and late text joins by timestamp', () => {
  const t = new LiveTranscript();
  t.append('user', 'Put one', 0, 400);
  const id = t.rows()[0].id;
  t.append('assistant', 'Mhm.', 450, 650);
  t.append('user', ' the first line.', 800, 1200);
  t.append('user', ' on', 400, 800);
  expect(t.rows()).toEqual([
    { id, role: 'user', text: 'Put one on the first line.', startMs: 0, endMs: 1200 },
    { id: 2, role: 'assistant', text: 'Mhm.', startMs: 450, endMs: 650 },
  ]);
});

test('separate speech groups remain separate; late bridging preserves the first ID', () => {
  const t = new LiveTranscript();
  t.append('user', 'A', 0, 100);
  t.append('user', ' C', 2600, 3000);
  expect(t.rows()).toHaveLength(2);
  t.append('user', ' B', 1000, 1800);
  expect(t.rows()).toEqual([{ id: 1, role: 'user', text: 'A B C', startMs: 0, endMs: 3000 }]);
});

test('repeated words and whitespace are preserved; malformed timestamps use legacy grouping', () => {
  const t = new LiveTranscript();
  t.append('user', 'I ', undefined, undefined);
  t.append('user', 'I want', NaN, 10);
  t.append('assistant', 'Okay', -1, 5);
  t.append('user', ' this', 10, 5);
  expect(t.rows().map(r => r.text)).toEqual(['I I want', 'Okay', ' this']);
});

test('bounds retain the latest content without changing surviving row identity', () => {
  const t = new LiveTranscript();
  for (let i = 0; i < 3000; i++) t.append('user', 'word ', i * 100, i * 100 + 100);
  expect(t.rows()[0].text.length).toBeLessThanOrEqual(10000);
  t.append('assistant', 'x'.repeat(20000) + 'LATEST', 400000, 401000);
  expect(t.rows()).toHaveLength(1);
  expect(t.rows()[0].text.length).toBe(17980);
  expect(t.rows()[0].text).toEndWith('LATEST');
});

test('delegation includes overlap timestamps and one coherent user sentence', async () => {
  const { CompanionLiveConversation } = await import('../src/CompanionLiveConversation');
  let dispatch!: () => void;
  const prompts: string[] = [];
  const conversation = new CompanionLiveConversation({
    runBackend: async prompt => { prompts.push(prompt); return ''; }, send() {}, onQueue() {}, onTranscript() {},
    schedule: callback => { dispatch = callback; return () => {}; },
  });
  conversation.receive({ type: 'session.input_transcript.delta', delta: 'Put one', start_ms: 0, end_ms: 400 });
  conversation.receive({ type: 'session.output_transcript.delta', delta: 'Mhm.', start_ms: 450, end_ms: 650 });
  conversation.receive({ type: 'session.input_transcript.delta', delta: ' on the first line.', start_ms: 400, end_ms: 1200 });
  conversation.receive({ type: 'session.delegation.created', delegation: { id: 'd', target: 'client' } });
  dispatch();
  expect(prompts[0]).toContain('User [0.00–1.20s]: Put one on the first line.');
  expect(prompts[0]).toContain('Voice assistant [0.45–0.65s]: Mhm.');
  conversation.stop();
});
