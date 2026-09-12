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

test('a delegated completion speaks once and retains its current Live delegation', async () => {
  const h = harness(); const live = h.live(); live.ready();
  try {
    delegate(live.conversation);
    await tick();
    h.finish();
    await Promise.resolve(); await Promise.resolve();
    expect(live.sent).toEqual([{ type: 'session.commentary.append', delegation_id: 'delegation', content: 'Done' }]);
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
    expect(current.sent).toEqual([{ type: 'session.commentary.append', delegation_id: null, content: 'Finished after reconnect' }]);
  } finally { current.stop(); await h.controller.close(); }
});

test('subscription completions speak without a voice request, including repeated identical notifications', async () => {
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
