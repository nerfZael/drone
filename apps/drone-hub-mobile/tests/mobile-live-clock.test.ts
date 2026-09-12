import { expect, test } from 'bun:test';
import { CompanionLiveConversation } from '../../../packages/assistant-chat/src/CompanionLiveConversation';
import { MobileLiveClock } from '../src/local-assistant/mobile-live-clock';

test('native tick and a delayed JS callback cannot fire a deadline twice', () => {
  let now = 0; const pending: Array<() => void> = [];
  const clock = new MobileLiveClock(() => now, (callback) => { pending.push(callback); return () => {}; });
  let count = 0;
  clock.schedule(() => { count++; }, 450);
  now = 250; clock.tick(); expect(count).toBe(0);
  now = 500; clock.tick(); expect(count).toBe(1);
  pending[0]!(); expect(count).toBe(1);
  const cancel = clock.schedule(() => { count++; }, 450); cancel();
  now = 1000; clock.tick(); pending[1]!(); expect(count).toBe(1);
  clock.schedule(() => { count++; }, 0); clock.close();
  clock.tick(); pending[2]!(); expect(count).toBe(1);
});

test('delegation dispatches and backend replies return while every JS timer is frozen', async () => {
  let now = 0;
  const clock = new MobileLiveClock(() => now, () => () => {});
  const prompts: string[] = []; const sent: Record<string, unknown>[] = [];
  const conversation = new CompanionLiveConversation({
    schedule: clock.schedule,
    runBackend: async (prompt) => { prompts.push(prompt); return 'Completed in the background.'; },
    send: (event) => sent.push(event), onQueue() {}, onTranscript() {},
  });
  try {
    conversation.receive({ type: 'session.input_transcript.delta', delta: 'Check the task status.' });
    conversation.receive({ type: 'session.delegation.created', delegation: { id: 'task', target: 'client' } });
    now = 250; clock.tick(); expect(prompts).toHaveLength(0);
    now = 500; clock.tick(); await Promise.resolve();
    expect(prompts).toHaveLength(1); expect(prompts[0]).toContain('Check the task status.');
    expect(sent).toEqual([{ type: 'session.commentary.append', delegation_id: 'task', content: 'Completed in the background.' }]);
    conversation.receive({ type: 'session.input_transcript.delta', delta: 'A second task.' });
    conversation.receive({ type: 'session.delegation.created', delegation: { id: 'cancelled', target: 'client' } });
    conversation.stop(); now = 1000; clock.tick();
    expect(prompts).toHaveLength(1);
  } finally { conversation.stop(); clock.close(); }
});
