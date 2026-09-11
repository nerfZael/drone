import { expect, test } from 'bun:test';
import { CompanionRunSession } from '../src/hub/companion/companion-run-session';
import { CompanionRuntime } from '../src/hub/companion/companion-runtime';
import { BlipAssistantHost } from '../src/hub/assistant/blip-assistant-host';
import { fauxAssistantMessage, registerFauxProvider } from '@mariozechner/pi-ai';
import { withTempDroneDataDir } from './test-helpers';

test('Companion routes ASAP to the running host and buffers only when it cannot steer', () => {
  const runtime = Object.create(CompanionRuntime.prototype);
  let running = false;
  const steered: unknown[] = [];
  Object.assign(runtime, {
    contexts: new Map([['companion:run', { acceptsSteering: true, settings: { promptDeliveryMode: 'asap' } }]]),
    activeRunIds: new Set(['run']), cancelledRunIds: new Set(), closing: false,
    host: { isThreadRunning: () => running, steerThread: (...args: unknown[]) => steered.push(args) },
  });
  expect(runtime.steer('run', 'correction')).toBe(false);
  running = true;
  expect(runtime.steer('run', 'correction')).toBe(true);
  expect(steered).toEqual([['companion:run', 'correction']]);
  runtime.contexts.get('companion:run').settings.promptDeliveryMode = 'queue';
  expect(runtime.steer('run', 'queued correction')).toBe(false);
  expect(steered).toHaveLength(1);
  runtime.contexts.get('companion:run').acceptsSteering = false;
  expect(runtime.steer('run', 'arrived while saving the final state')).toBe(false);
  runtime.cancelledRunIds.add('run');
  expect(() => runtime.steer('run', 'late')).toThrow('cancelled');
  expect(steered).toHaveLength(1);
});

test('Companion ASAP is consumed by the real agent loop before the active request settles', async () => {
  await withTempDroneDataDir('companion-asap-agent-', async () => {
    const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const prompts: string[] = [];
    const context = { acceptsSteering: false, settings: { promptDeliveryMode: 'asap' } };
    faux.setResponses([
      async () => { started.resolve(); await resume.promise; return fauxAssistantMessage('initial answer'); },
      (input) => {
        prompts.push(String((input.messages.at(-1) as any)?.content ?? ''));
        return fauxAssistantMessage('corrected answer');
      },
    ]);
    const host = new BlipAssistantHost(async () => ({
      provider: 'faux', model: faux.getModel().id, thinkingLevel: 'off', systemPrompt: 'Test', tools: [],
      beforePrompt: () => { context.acceptsSteering = true; },
      afterPrompt: () => { context.acceptsSteering = false; },
    }));
    const runtime = Object.create(CompanionRuntime.prototype);
    Object.assign(runtime, {
      host, contexts: new Map([['companion:run', context]]),
      activeRunIds: new Set(['run']), cancelledRunIds: new Set(), closing: false,
    });
    let finished = false;
    const run = host.promptThread('companion:run', 'initial request').then(() => { finished = true; });
    try {
      await started.promise;
      expect(runtime.steer('run', 'latest correction')).toBe(true);
      expect(finished).toBe(false);
      resume.resolve();
      await run;
      expect(prompts).toEqual(['latest correction']);
      expect(await host.latestAssistantVisibleText('companion:run')).toBe('corrected answer');
      expect(context.acceptsSteering).toBe(false);
    } finally {
      resume.resolve();
      await run;
      await host.close();
      faux.unregister();
    }
  });
});

test('follow-ups arriving during startup steer as soon as the agent starts', async () => {
  const h = harness();
  try {
    await h.session.submit({ prompt: 'initial', messageId: 'a' });
    await h.session.submit({ prompt: 'correction one', messageId: 'b' });
    await h.session.submit({ prompt: 'correction two', messageId: 'c' });
    expect(h.steered).toEqual([]);
    h.ready = true;
    h.runs[0].onEvent({ type: 'turn_started' });
    expect(h.steered).toEqual(['correction one', 'correction two']);
    expect(h.runs).toHaveLength(1);
    h.finish[0]('Updated answer');
    await tick();
    expect(h.messages.filter((m) => m.type === 'reply')).toEqual([
      { type: 'reply', messageId: 'c', reply: 'Updated answer' },
    ]);
  } finally { await h.session.close('test complete'); }
});

test('ASAP keeps an in-flight browser result valid and routes new tools and activity to the latest request', async () => {
  const h = harness();
  try {
    await h.session.submit({ prompt: 'initial', messageId: 'a' });
    const firstResult = h.runs[0].callBrowser('get_app_context', {});
    const firstCall = h.messages.at(-1);
    h.ready = true;
    await h.session.submit({ prompt: 'correction', messageId: 'b' });
    expect(h.steered).toEqual(['correction']);
    const secondResult = h.runs[0].callBrowser('get_app_context', {});
    const secondCall = h.messages.at(-1);
    expect(firstCall.messageId).toBe('a');
    expect(secondCall.messageId).toBe('b');
    expect(secondCall.generation).toBe(firstCall.generation);
    for (const call of [firstCall, secondCall]) {
      expect(h.session.resolveBrowserTool({ ...call, ok: true, result: call.messageId })).toBe(true);
    }
    expect(await firstResult).toBe('a');
    expect(await secondResult).toBe('b');
    h.runs[0].onEvent({ type: 'tool_call_completed', callId: 'tool', result: {} });
    expect(h.messages.at(-1)).toMatchObject({ type: 'activity', messageId: 'b' });
    await h.session.close('cancelled');
    h.finish[0]('late answer');
    await tick();
    expect(h.messages.some((m) => m.type === 'reply')).toBe(false);
    await expect(h.runs[0].callBrowser('get_app_context', {})).rejects.toThrow('no longer active');
  } finally { await h.session.close('test complete'); }
});

test('a follow-up during teardown starts a new run instead of being lost', async () => {
  const h = harness();
  try {
    await h.session.submit({ prompt: 'initial', messageId: 'a' });
    await h.session.submit({ prompt: 'after finish', messageId: 'b' });
    h.finish[0]('first');
    await tick();
    expect(h.runs.map((run) => run.prompt)).toEqual(['initial', 'after finish']);
    h.finish[1]('second');
    await tick();
    expect(h.messages.at(-1)).toMatchObject({ messageId: 'b', status: 'completed' });
  } finally { await h.session.close('test complete'); }
});

test('steering failure is reported and cannot leave a buffered task that restarts after cancellation', async () => {
  const h = harness();
  await h.session.submit({ prompt: 'initial', messageId: 'a' });
  h.steerError = true;
  await h.session.submit({ prompt: 'correction', messageId: 'b' });
  await tick();
  expect(h.messages.at(-1)).toMatchObject({ type: 'error', messageId: 'b', error: 'Steering failed' });
  h.finish[0]('late');
  await tick();
  expect(h.runs).toHaveLength(1);
  expect(h.messages.some((message) => message.type === 'reply')).toBe(false);
});

test('Queue mode keeps follow-ups in order until the current request finishes', async () => {
  const h = harness('queue');
  try {
    await h.session.submit({ prompt: 'initial', messageId: 'a' });
    h.ready = true;
    await h.session.submit({ prompt: 'second', messageId: 'b' });
    await h.session.submit({ prompt: 'third', messageId: 'c' });
    h.runs[0].onEvent({ type: 'turn_started' });
    expect(h.steered).toEqual([]);
    expect(h.runs).toHaveLength(1);
    h.finish[0]('first answer');
    await tick();
    expect(h.runs.map((run) => run.prompt)).toEqual(['initial', 'second']);
    h.finish[1]('second answer');
    await tick();
    expect(h.runs.map((run) => run.prompt)).toEqual(['initial', 'second', 'third']);
    expect(h.steered).toEqual([]);
    h.finish[2]('third answer');
    await tick();
    expect(h.messages.filter((message) => message.type === 'reply').map((message) => message.messageId)).toEqual(['a', 'b', 'c']);
  } finally { await h.session.close('test complete'); }
});

function harness(promptDeliveryMode: 'asap' | 'queue' = 'asap') {
  const h = { ready: false, steerError: false, steered: [] as string[], runs: [] as any[], messages: [] as any[], finish: [] as Array<(reply: string) => void> };
  const steeringRuntime = Object.create(CompanionRuntime.prototype);
  Object.assign(steeringRuntime, {
    activeRunIds: new Set(['run']), cancelledRunIds: new Set(), closing: false,
    contexts: new Map([['companion:run', { acceptsSteering: true, settings: { promptDeliveryMode } }]]),
    host: { isThreadRunning: () => h.ready, steerThread: (_threadId: string, prompt: string) => h.steered.push(prompt) },
  });
  const session = new CompanionRunSession({
    clientRunId: 'run', runtimeRunId: 'run', transport: 'websocket',
    runtime: {
      run: (input) => { h.runs.push(input); return new Promise<string>((resolve) => h.finish.push(resolve)); },
      steer: (runId, prompt) => { if (h.steerError) throw new Error('Steering failed'); return steeringRuntime.steer(runId, prompt); },
      deleteSession: async () => {},
    },
    emit: (message) => { h.messages.push(message); }, isAvailable: () => true,
    unavailableMessage: 'closed', onClose: () => {},
  });
  return Object.assign(h, { session });
}

function tick() { return new Promise((resolve) => setTimeout(resolve, 0)); }
