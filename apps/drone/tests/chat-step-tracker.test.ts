import { expect, test } from 'bun:test';
import type { AgentRunActivity } from '@drone/assistant-chat';
import { ChatStepTracker, activityText, countToolCalls, type ChatTurnActivity } from '../src/hub/chat-steps/ChatStepTracker';

const call = (name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, arguments: args });
function activity(calls: number): AgentRunActivity {
  return {
    version: 1, source: 'codex', updatedAt: new Date(0).toISOString(),
    messages: [
      { role: 'assistant', content: [{ type: 'text', text: 'Looking at the parser' }, ...Array.from({ length: calls }, (_, i) => call('read_file', { path: `src/file-${i}.ts` }))] },
      { role: 'toolResult', isError: true, content: [{ type: 'text', text: 'error: no such file' }] },
    ] as never,
  };
}

function setup() {
  let now = 1_000_000;
  let enabled = true;
  let running: Array<{ droneId: string; chatName: string; chatId: string | null }> = [{ droneId: 'd1', chatName: 'plan', chatId: 'c1' }];
  let turn: ChatTurnActivity = { turnId: 't1', prompt: 'Refactor the parser', activity: activity(1) };
  let lastTurn: ChatTurnActivity | null = null;
  const calls: Array<{ task: string; activity: string; attribution: unknown; reasoning: string }> = [];
  const saved: unknown[] = [];
  const tracker = new ChatStepTracker({
    settings: async () => ({ enabled, model: 'openai-codex/gpt-6-luna', reasoning: 'low' }),
    runningChats: () => running,
    readRunningTurn: () => turn,
    readLastTurn: () => lastTurn ?? turn,
    summarize: async ({ input, attribution, reasoning }) => {
      calls.push({ ...input, attribution, reasoning });
      return { done: [`step ${calls.length}`], doing: ['editing the parser'], next: ['run tests'] };
    },
    save: (steps) => saved.push(steps),
    now: () => now,
  });
  return {
    tracker, calls, saved,
    advance: (ms: number) => { now += ms; },
    setTurn: (next: ChatTurnActivity) => { turn = next; },
    setLastTurn: (next: ChatTurnActivity | null) => { lastTurn = next; },
    stop: () => { running = []; },
    disable: () => { enabled = false; },
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}

test('activity turns into short lines of calls, failures and what the agent said', () => {
  expect(countToolCalls(activity(3))).toBe(3);
  expect(activityText(activity(2)).split('\n')).toEqual([
    'said: Looking at the parser', 'called read_file: src/file-0.ts', 'called read_file: src/file-1.ts', '  -> not done: error: no such file',
  ]);
});

test('a running chat is summarized every few tool calls, at most every 20 seconds, and billed to the chat', async () => {
  const t = setup();
  await t.tracker.tick();
  expect(t.calls).toHaveLength(0); // One call is not enough to say anything yet.
  t.setTurn({ turnId: 't1', prompt: 'Refactor the parser', activity: activity(4) });
  await t.tracker.tick(); await t.settle();
  expect(t.calls).toHaveLength(1);
  expect(t.calls[0]).toMatchObject({ task: 'Refactor the parser', reasoning: 'low', attribution: { purpose: 'steps', droneId: 'd1', chatName: 'plan', chatId: 'c1' } });
  expect(t.tracker.steps()).toMatchObject([{ droneId: 'd1', chatName: 'plan', turnId: 't1', doing: ['editing the parser'], final: false }]);
  expect(t.saved).toHaveLength(1);
  t.setTurn({ turnId: 't1', prompt: 'Refactor the parser', activity: activity(9) });
  await t.tracker.tick(); await t.settle();
  expect(t.calls).toHaveLength(1); // Too soon after the last one.
  t.advance(20_000);
  await t.tracker.tick(); await t.settle();
  expect(t.calls).toHaveLength(2);
});

test('a turn that ends gets one final summary, and nothing runs while step tracking is off', async () => {
  const t = setup();
  t.setTurn({ turnId: 't1', prompt: 'Refactor the parser', activity: activity(2) });
  await t.tracker.tick();
  t.stop();
  await t.tracker.tick(); await t.settle();
  expect(t.calls).toHaveLength(1);
  // Told the turn is over, and nothing is left in progress whatever the model says.
  expect(t.calls[0].task).toContain('The agent has finished this turn');
  expect(t.tracker.steps()[0]).toMatchObject({ turnId: 't1', final: true, doing: [] });
  await t.tracker.tick(); await t.settle();
  expect(t.calls).toHaveLength(1);

  const off = setup();
  off.disable();
  off.setTurn({ turnId: 't1', prompt: 'x', activity: activity(8) });
  await off.tracker.tick(); await off.settle();
  expect(off.calls).toHaveLength(0);
});

test('the final summary waits for the finished turn to be stored, which lands after the run is marked done', async () => {
  const t = setup();
  t.setTurn({ turnId: 't2', prompt: 'Tune the mechs', activity: activity(5) });
  await t.tracker.tick(); await t.settle();
  expect(t.calls).toHaveLength(1);
  // The run is done, but the chat's history still ends with the turn before.
  t.setLastTurn({ turnId: 't1', prompt: 'Earlier', activity: activity(3) });
  t.stop();
  t.advance(5_000);
  await t.tracker.tick(); await t.settle();
  expect(t.calls).toHaveLength(1);
  t.setLastTurn(null);
  t.advance(5_000);
  await t.tracker.tick(); await t.settle();
  expect(t.calls).toHaveLength(2);
  expect(t.tracker.steps()[0]).toMatchObject({ turnId: 't2', final: true });

  // A turn that never shows up is given up on after a minute.
  const late = setup();
  late.setTurn({ turnId: 't2', prompt: 'x', activity: activity(5) });
  await late.tracker.tick(); await late.settle();
  late.setLastTurn({ turnId: 't1', prompt: 'Earlier', activity: activity(3) });
  late.stop();
  await late.tracker.tick();
  late.advance(61_000);
  await late.tracker.tick();
  late.setLastTurn(null);
  await late.tracker.tick(); await late.settle();
  expect(late.calls).toHaveLength(1);
});
