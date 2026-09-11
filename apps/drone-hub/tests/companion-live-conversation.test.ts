import { expect, test } from 'bun:test';
import { CompanionLiveConversation, splitLiveCommentary } from '../src/droneHub/companion/CompanionLiveConversation';

test('delegation waits for transcript, deduplicates notifications, and preserves conversation context', async () => {
  const prompts: string[] = [];
  const sent: any[] = [];
  const conversation = new CompanionLiveConversation({
    runBackend: async (prompt) => { prompts.push(prompt); return 'Found it.'; },
    send: (event) => sent.push(event), onTranscript: () => {}, onQueue: () => {},
  });
  conversation.receive(delegation('first'));
  await delay(500);
  expect(prompts).toHaveLength(0);
  conversation.receive(transcript('user', 'Find the earlier chat about voice.'));
  conversation.receive(transcript('assistant', 'Which project?'));
  conversation.receive(transcript('user', 'Companion.'));
  conversation.receive(delegation('first'));
  await delay(550);
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain('User: Companion.');
  expect(prompts[0]).toContain('Voice assistant: Which project?');
  expect(sent).toEqual([{ type: 'session.commentary.append', delegation_id: 'first', content: 'Found it.' }]);
  conversation.stop();
});

test('follow-ups dispatch while the backend is running and suppress late results in either completion order', async () => {
  const pending: Array<(reply: string) => void> = [];
  const prompts: string[] = [];
  const sent: any[] = [];
  let captions = '';
  const conversation = new CompanionLiveConversation({
    runBackend: (prompt) => { prompts.push(prompt); return new Promise((resolve) => pending.push(resolve)); },
    send: (event) => sent.push(event), onTranscript: (rows) => { captions = rows.map((row) => row.text).join(' '); }, onQueue: () => {},
  });
  conversation.receive(transcript('user', 'Find chat A.'));
  conversation.receive(delegation('a'));
  await delay(550);
  conversation.receive(transcript('user', ' Actually, find chat B.'));
  conversation.receive(delegation('b'));
  expect(captions).toContain('chat B');
  expect(prompts).toHaveLength(1);
  await delay(550);
  expect(prompts).toHaveLength(2);
  expect(sent).toHaveLength(0);
  pending[1]('Found chat B.');
  await delay(0);
  expect(sent[0].content).toBe('Found chat B.');
  pending[0]('Late result for chat A.');
  await delay(0);
  expect(sent).toHaveLength(1);
  conversation.stop();
});

test('a new notification without new speech does not suppress the active answer or lose late speech', async () => {
  const pending: Array<(reply: string) => void> = [];
  const prompts: string[] = [];
  const sent: any[] = [];
  const conversation = new CompanionLiveConversation({
    runBackend: (prompt) => { prompts.push(prompt); return new Promise((resolve) => pending.push(resolve)); },
    send: (event) => sent.push(event), onTranscript: () => {}, onQueue: () => {},
  });
  try {
    conversation.receive(transcript('user', 'Find chat A.'));
    conversation.receive(delegation('a'));
    await delay(550);
    conversation.receive(delegation('possible-duplicate'));
    pending[0]('Found chat A.');
    await delay(0);
    expect(sent).toMatchObject([{ delegation_id: 'a', content: 'Found chat A.' }]);
    expect(prompts).toHaveLength(1);
    conversation.receive(transcript('user', ' Now find chat B.'));
    await delay(550);
    expect(prompts).toHaveLength(2);
    pending[1]('Found chat B.');
    await delay(0);
    expect(sent.at(-1).content).toBe('Found chat B.');
  } finally { conversation.stop(); }
});

test('continuous transcript fragments cannot postpone delegated work indefinitely', async () => {
  const prompts: string[] = [];
  const conversation = new CompanionLiveConversation({
    runBackend: async (prompt) => { prompts.push(prompt); return 'Done.'; },
    send: () => {}, onTranscript: () => {}, onQueue: () => {},
  });
  try {
    conversation.receive(delegation('continuous'));
    for (let index = 0; index < 6; index++) {
      conversation.receive(transcript('user', 'more words '));
      await delay(200);
    }
    expect(prompts).toHaveLength(1);
  } finally { conversation.stop(); }
});

test('a long answer is referred to the UI instead of losing its final qualification', async () => {
  const sent: any[] = [];
  const conversation = new CompanionLiveConversation({
    runBackend: async () => 'Detailed findings. '.repeat(200) + 'However, the operation failed.',
    send: (event) => sent.push(event), onTranscript: () => {}, onQueue: () => {},
  });
  try {
    conversation.receive(transcript('user', 'Give me the details.'));
    conversation.receive(delegation('long-result'));
    await delay(550);
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContain('read the full answer');
    expect(sent[0].content).not.toContain('Detailed findings');
  } finally { conversation.stop(); }
});

test('ending voice discards queued delegation and never narrates a late result', async () => {
  let finish!: (reply: string) => void;
  let calls = 0;
  const sent: any[] = [];
  const conversation = new CompanionLiveConversation({
    runBackend: () => { calls++; return new Promise((resolve) => { finish = resolve; }); },
    send: (event) => sent.push(event), onTranscript: () => {}, onQueue: () => {},
  });
  conversation.receive(transcript('user', 'Do task A.'));
  conversation.receive(delegation('a'));
  await delay(550);
  conversation.receive(transcript('user', ' Also task B.'));
  conversation.receive(delegation('b'));
  conversation.stop();
  finish('Done.');
  await delay(550);
  expect(calls).toBe(1);
  expect(sent).toHaveLength(0);
});

test('speakable chunks preserve Unicode within a conservative token bound', () => {
  const text = 'Hello 🛰️ 世界 '.repeat(100) + ' ' + 'a'.repeat(399) + '🛰️';
  const chunks = splitLiveCommentary(text);
  expect(chunks.join('')).toBe(text);
  expect(chunks.every((chunk) => new TextEncoder().encode(chunk).length <= 400)).toBe(true);
});

test('long conversations stay within the existing backend prompt limit', async () => {
  let prompt = '';
  const conversation = new CompanionLiveConversation({
    runBackend: async (value) => { prompt = value; return 'Done'; },
    send: () => {}, onTranscript: () => {}, onQueue: () => {},
  });
  for (let index = 0; index < 500; index++) {
    conversation.receive(transcript('user', 'Earlier context '.repeat(10)));
    conversation.receive(transcript('assistant', 'Okay.'));
  }
  conversation.receive(transcript('user', 'Current request '.repeat(2_000) + 'LATEST'));
  conversation.receive(delegation('long'));
  await delay(550);
  expect(prompt.length).toBeLessThanOrEqual(20_000);
  expect(prompt).toEndWith('LATEST');
  conversation.stop();
});

function transcript(role: 'user' | 'assistant', delta: string) {
  return { type: role === 'user' ? 'session.input_transcript.delta' : 'session.output_transcript.delta', delta };
}
function delegation(id: string) { return { type: 'session.delegation.created', delegation: { id, target: 'client' } }; }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
