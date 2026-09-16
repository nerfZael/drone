import { expect, test } from 'bun:test';
import { CompanionClientController, type CompanionClientTransport } from '../src/companion-client';
import type { CompanionServerMessage } from '../src/companion';
import { CompanionLiveConversation } from '../src/CompanionLiveConversation';
import { connectCompanionLiveReplies } from '../src/companion-live-replies';
import { waitForCompanionReply } from '../src/waitForCompanionReply';

function harness() {
  let nextId = 0;
  const controller = new CompanionClientController({ createId: () => String(++nextId) });
  let receive!: (message: CompanionServerMessage) => void;
  let messageId = '';
  const transport: CompanionClientTransport = {
    open: async (input) => { receive = input.onMessage; return undefined; },
    sendPrompt: (input) => { messageId = input.messageId; },
    sendToolResult: () => {}, cancel: () => {}, close: () => {},
  };
  const submit = () => controller.submitPrompt({ prompt: 'Do the work', createTransport: () => transport, executeTool: () => ({}) });
  function live() {
    const sent: Record<string, unknown>[] = [];
    const abort = new AbortController();
    const conversation = new CompanionLiveConversation({
      externalBackendReplies: true,
      runBackend: () => waitForCompanionReply(controller, submit, abort.signal),
      send: (event) => sent.push(event), onQueue: () => {}, onTranscript: () => {},
    });
    const replies = connectCompanionLiveReplies(controller, conversation);
    return { sent, conversation, ready: replies.ready, stop() { replies.stop(); abort.abort(); conversation.stop(); } };
  }
  return { controller, submit, live,
    receive: (message: CompanionServerMessage) => receive(message),
    finish(reply = 'Done', id = messageId) {
      receive({ type: 'reply', messageId: id, reply });
      receive({ type: 'status', messageId: id, status: 'completed' });
    },
  };
}

function delegate(conversation: CompanionLiveConversation, id = 'delegation') {
  conversation.receive({ type: 'session.input_transcript.delta', delta: 'Please do the work.' });
  conversation.receive({ type: 'session.delegation.created', delegation: { id, target: 'client' } });
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 500));

test('a delegated completion supplies quiet context once and retains its current Live delegation', async () => {
  const h = harness(); const live = h.live(); live.ready();
  try {
    delegate(live.conversation);
    await tick();
    expect(h.controller.getSnapshot().status).toBe('working');
    expect(live.sent).toEqual([]); // Starting a backend session must not narrate a failure.
    h.finish();
    await Promise.resolve(); await Promise.resolve();
    expect(live.sent).toEqual([{ type: 'session.thinking.append', delegation_id: 'delegation', content: 'Done' }]);
    h.receive({ type: 'status', status: 'completed' });
    expect(live.sent).toHaveLength(1);
  } finally { live.stop(); await h.controller.close(); }
});

test('a backend request outlives Live and finishes in the replacement session without an old delegation ID', async () => {
  const h = harness(); const old = h.live(); old.ready();
  delegate(old.conversation); await tick(); old.stop();
  const current = h.live(); current.ready();
  try {
    h.finish('Finished after reconnect');
    await Promise.resolve(); await Promise.resolve();
    expect(old.sent).toEqual([]);
    expect(current.sent).toEqual([{ type: 'session.thinking.append', delegation_id: null, content: 'Finished after reconnect' }]);
  } finally { current.stop(); await h.controller.close(); }
});

test('subscription completions request speech without a voice request, including repeated identical notifications', async () => {
  const h = harness(); await h.submit(); h.finish('Subscribed');
  const live = h.live(); live.ready();
  try {
    expect(live.sent).toEqual([]); // Do not replay the completed history on startup.
    for (const id of ['event-1', 'event-2']) {
      h.receive({ type: 'subscription', messageId: id });
      h.finish('The task finished', id);
    }
    expect(live.sent).toEqual(Array.from({ length: 2 }, () => ({
      type: 'session.commentary.append', delegation_id: null, content: 'The task finished',
    })));
  } finally { live.stop(); await h.controller.close(); }
});

test('completions during connection setup wait for ready, and stopped sessions discard queued results', async () => {
  const h = harness(); await h.submit(); const live = h.live();
  h.finish('During setup');
  expect(live.sent).toEqual([]);
  live.ready(); live.ready();
  expect(live.sent).toHaveLength(1);
  live.stop();
  await h.submit(); const abandoned = h.live(); h.finish(); abandoned.stop(); abandoned.ready();
  expect(abandoned.sent).toEqual([]);
  const current = h.live(); current.ready();
  expect(current.sent).toEqual([]);
  current.stop(); await h.controller.close();
});

test('queued subscription speech retains its source when a later ordinary reply completes', async () => {
  const h = harness(); await h.submit(); h.finish('Subscribed');
  const live = h.live();
  try {
    h.receive({ type: 'subscription', messageId: 'event' });
    h.finish('Chat finished', 'event');
    await h.submit(); h.finish('Ordinary reply');
    live.ready(); live.ready();
    expect(live.sent).toEqual([
      { type: 'session.commentary.append', delegation_id: null, content: 'Chat finished' },
      { type: 'session.thinking.append', delegation_id: null, content: 'Ordinary reply' },
    ]);
  } finally { live.stop(); await h.controller.close(); }
});

test('subscription failures request speech with the failure reason', async () => {
  const h = harness(); await h.submit(); h.finish('Subscribed');
  const live = h.live(); live.ready();
  try {
    h.receive({ type: 'subscription', messageId: 'event' });
    h.receive({ type: 'error', messageId: 'event', error: 'provider unavailable' });
    expect(live.sent).toHaveLength(1);
    expect(live.sent[0]).toMatchObject({ type: 'session.commentary.append', delegation_id: null });
    expect(String(live.sent[0].content)).toContain('provider unavailable');
  } finally { live.stop(); await h.controller.close(); }
});

test('an unrelated pending voice request does not suppress a subscription announcement', () => {
  const sent: Record<string, unknown>[] = [];
  const conversation = new CompanionLiveConversation({
    runBackend: async () => '', send: (event) => sent.push(event), schedule: () => () => {},
    onQueue: () => {}, onTranscript: () => {},
  });
  delegate(conversation);
  conversation.deliverBackendReply('Subscribed chat finished', true);
  expect(sent).toEqual([
    { type: 'session.commentary.append', delegation_id: null, content: 'Subscribed chat finished' },
  ]);
  conversation.stop();
});

test('superseded results and cancelled work are not narrated', async () => {
  const h = harness(); await h.submit(); const live = h.live(); live.ready();
  try {
    await h.submit();
    h.finish('Stale', '2');
    expect(live.sent).toEqual([]);
    await h.controller.cancel();
    expect(live.sent).toEqual([]);
  } finally { live.stop(); }
});

test('intermediate messages are quiet, deduplicated, and do not consume the final delegation', async () => {
  const h = harness(); const live = h.live(); live.ready();
  try {
    delegate(live.conversation); await tick();
    const progress = { type: 'assistant_update' as const, messageId: '2', updateId: 'progress-1', text: 'I found the chat; I am checking its latest reply.' };
    h.receive(progress); h.receive(progress);
    expect(live.sent).toEqual([{ type: 'session.thinking.append', delegation_id: 'delegation', content: progress.text }]);
    h.finish('Finished');
    expect(live.sent[1]).toEqual({ type: 'session.thinking.append', delegation_id: 'delegation', content: 'Finished' });
    h.receive({ ...progress, updateId: 'late' });
    expect(live.sent).toHaveLength(2);
  } finally { live.stop(); await h.controller.close(); }
});

test('progress during setup, from superseded requests, or after stop is discarded', async () => {
  const h = harness(); await h.submit(); const live = h.live();
  const progress = { type: 'assistant_update' as const, messageId: '2', updateId: 'update', text: 'Checking' };
  h.receive(progress); live.ready();
  expect(live.sent).toEqual([]);
  await h.submit();
  h.receive({ ...progress, updateId: 'stale' });
  expect(live.sent).toEqual([]);
  h.receive({ ...progress, messageId: '3', updateId: 'current' });
  expect(live.sent[0]?.type).toBe('session.thinking.append');
  live.stop();
  h.receive({ ...progress, messageId: '3', updateId: 'stopped' });
  expect(live.sent).toHaveLength(1);
  await h.controller.close();
});

test('pending spoken correction suppresses progress and oversized progress is skipped whole', () => {
  const sent: Record<string, unknown>[] = [];
  const conversation = new CompanionLiveConversation({
    runBackend: async () => '', send: (event) => sent.push(event), schedule: () => () => {},
    onQueue: () => {}, onTranscript: () => {},
  });
  conversation.deliverBackendUpdate('x'.repeat(1601));
  delegate(conversation);
  conversation.deliverBackendUpdate('Old request progress');
  expect(sent).toEqual([]);
  conversation.stop();
});

test('a delegated provider failure reaches the UI and Live once with its reason', async () => {
  const h = harness(); const live = h.live(); live.ready();
  try {
    delegate(live.conversation); await tick();
    h.receive({ type: 'error', error: 'cerebras: 402 status code (no body)' });
    await Promise.resolve(); await Promise.resolve();
    expect(h.controller.getSnapshot()).toMatchObject({ status: 'error', error: 'cerebras: 402 status code (no body)' });
    expect(live.sent).toHaveLength(1);
    expect(live.sent[0]).toMatchObject({ type: 'session.thinking.append', delegation_id: 'delegation' });
    expect(String(live.sent[0].content)).toContain('cerebras: 402');
    expect(String(live.sent[0].content)).toContain('did not complete');
    expect(String(live.sent[0].content)).not.toContain('Check Companion');
  } finally { live.stop(); await h.controller.close(); }
});

test('a failure after voice reconnect waits for readiness and uses no retired delegation', async () => {
  const h = harness(); const old = h.live(); old.ready();
  delegate(old.conversation); await tick(); old.stop();
  const current = h.live();
  try {
    h.receive({ type: 'error', error: 'provider: denied' });
    await Promise.resolve(); await Promise.resolve();
    expect(current.sent).toEqual([]);
    current.ready(); current.ready();
    expect(current.sent).toHaveLength(1);
    expect(current.sent[0].delegation_id).toBeNull();
    expect(String(current.sent[0].content)).toContain('provider: denied');
    expect(old.sent).toEqual([]);
  } finally { current.stop(); await h.controller.close(); }
});

test('a stale request failure does not cancel the newer request or announce its failure', async () => {
  const h = harness(); await h.submit();
  const live = h.live(); live.ready();
  try {
    h.receive({ type: 'subscription', messageId: 'old' });
    await h.submit();
    h.receive({ type: 'error', messageId: 'old', error: 'older request failed' });
    expect(h.controller.getSnapshot().status).toBe('working');
    expect(live.sent).toEqual([]);
    h.finish('Newer request succeeded');
    expect(live.sent).toHaveLength(1);
    expect(live.sent[0].content).toBe('Newer request succeeded');
  } finally { live.stop(); await h.controller.close(); }
});

test('a long provider error remains a failure, not the detailed-success fallback', async () => {
  const h = harness(); await h.submit(); const live = h.live(); live.ready();
  try {
    h.receive({ type: 'error', error: 'provider: 402 ' + 'long diagnostic '.repeat(1000) });
    expect(live.sent.length).toBeGreaterThan(0);
    expect(live.sent.length).toBeLessThanOrEqual(4);
    const text = live.sent.map(e => e.content).join('');
    expect(text).toContain('backend failed');
    expect(text).toContain('402');
    expect(text).not.toContain('detailed answer');
    expect(h.controller.getSnapshot().error.length).toBeGreaterThan(1000);
  } finally { live.stop(); await h.controller.close(); }
});

test('submission errors outside controller state still reach Live', async () => {
  const sent: Record<string, unknown>[] = [];
  const conversation = new CompanionLiveConversation({ externalBackendReplies: true,
    runBackend: async () => { throw new Error('Target workspace is unavailable'); },
    send: event => sent.push(event), onQueue() {}, onTranscript() {},
  });
  try {
    delegate(conversation); await tick();
    expect(sent).toHaveLength(1);
    expect(String(sent[0].content)).toContain('Target workspace is unavailable');
    expect(String(sent[0].content)).toContain('backend failed');
  } finally { conversation.stop(); }
});

test('an empty successful reply does not invent details or claim an action succeeded', async () => {
  const h = harness(); await h.submit(); const live = h.live(); live.ready();
  try {
    h.finish('');
    expect(live.sent).toHaveLength(1);
    expect(String(live.sent[0].content)).toContain('unconfirmed');
    expect(String(live.sent[0].content)).not.toContain('Check Companion');
  } finally { live.stop(); await h.controller.close(); }
});
