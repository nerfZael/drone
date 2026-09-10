import { describe, expect, test } from 'bun:test';

import {
  COMPANION_BROWSER_TOOL_NAMES,
  COMPANION_MAX_PROMPT_CHARS,
  CompanionClientController,
  companionToolActivityLabel,
  groupCompanionToolActivity,
  reduceCompanionToolActivity,
  resolveCompanionChatName,
  type CompanionClientTransport,
  type CompanionServerMessage,
  validateCompanionRunInput,
} from '../src';

function clientTransport() {
  let onMessage: ((message: CompanionServerMessage) => void) | null = null;
  let onDisconnect: ((message: string) => void) | null = null;
  const toolResults: unknown[] = [];
  const prompts: unknown[] = [];
  const cancelled: string[] = [];
  let closes = 0;
  let opens = 0;
  const transport: CompanionClientTransport = {
    async open(input) {
      opens += 1;
      onMessage = input.onMessage;
      onDisconnect = input.onDisconnect;
      return { connectionMs: 12, connectionReused: false };
    },
    sendPrompt(input) {
      prompts.push(input);
    },
    sendToolResult(input) {
      toolResults.push(input);
    },
    cancel(runId) {
      cancelled.push(runId);
    },
    close() {
      closes += 1;
    },
  };
  return {
    transport,
    message(message: CompanionServerMessage) {
      onMessage?.(message);
    },
    disconnect(message: string) {
      onDisconnect?.(message);
    },
    toolResults,
    prompts,
    cancelled,
    get opens() {
      return opens;
    },
    get closes() {
      return closes;
    },
  };
}

describe('Companion contracts', () => {
  test('allows proposal editing and chat navigation without the legacy draft action', () => {
    expect(COMPANION_BROWSER_TOOL_NAMES).toContain('open_drone_chat');
    expect(COMPANION_BROWSER_TOOL_NAMES).toContain('read_companion_proposal');
    expect(COMPANION_BROWSER_TOOL_NAMES).toContain('apply_companion_proposal_patch');
    expect([...COMPANION_BROWSER_TOOL_NAMES]).not.toContain('prepare_drone_draft');
  });

  test('resolves Companion navigation only to an existing chat', () => {
    expect(resolveCompanionChatName(['planning', 'default'], undefined)).toBe('default');
    expect(resolveCompanionChatName(['planning', 'review'], '  review  ')).toBe('review');
    expect(resolveCompanionChatName(['planning', 'review'], undefined)).toBe('planning');
    expect(resolveCompanionChatName(['planning'], 'default')).toBeNull();
    expect(resolveCompanionChatName([], undefined)).toBeNull();
  });

  test('normalizes valid run input and rejects invalid input consistently', () => {
    expect(validateCompanionRunInput({ runId: ' run-1 ', prompt: ' hello ' })).toEqual({
      ok: true,
      runId: 'run-1',
      prompt: 'hello',
    });
    expect(validateCompanionRunInput({ runId: 'bad\nrun', prompt: 'hello' })).toMatchObject({
      ok: false,
      error: 'A valid runId is required.',
    });
    expect(validateCompanionRunInput({ runId: 'run-1', prompt: ' ' })).toEqual({
      ok: false,
      runId: 'run-1',
      error: 'A non-empty prompt is required.',
    });
    expect(
      validateCompanionRunInput({
        runId: 'run-1',
        prompt: 'x'.repeat(COMPANION_MAX_PROMPT_CHARS + 1),
      }),
    ).toMatchObject({ ok: false, runId: 'run-1' });
  });

  test('accepts only bounded privacy-safe Companion telemetry', () => {
    expect(
      validateCompanionRunInput({
        runId: 'run-1',
        messageId: 'message-1',
        prompt: 'hello',
        telemetry: {
          version: 1,
          transcriptionMs: 123.456,
          audioDurationMs: 9_000,
          connectionMs: 100_000,
          connectionReused: false,
          prompt: 'must not pass through',
        },
      }),
    ).toEqual({
      ok: true,
      runId: 'run-1',
      messageId: 'message-1',
      prompt: 'hello',
      telemetry: {
        version: 1,
        transcriptionMs: 123.5,
        audioDurationMs: 9_000,
        connectionMs: 60_000,
        connectionReused: false,
      },
    });
    expect(
      validateCompanionRunInput({
        runId: 'run-1',
        messageId: 'bad\nmessage',
        prompt: 'hello',
      }),
    ).toMatchObject({ ok: false, error: 'A valid messageId is required.' });
  });

  test('reduces tool activity from start through completion', () => {
    const started = reduceCompanionToolActivity([], {
      type: 'tool_call_started',
      callId: 'call-1',
      tool: 'list_drones',
      args: { limit: 5 },
    });
    expect(started).toEqual([
      {
        callId: 'call-1',
        tool: 'list_drones',
        args: { limit: 5 },
        status: 'running',
      },
    ]);
    expect(
      reduceCompanionToolActivity(started, {
        type: 'tool_call_completed',
        callId: 'call-1',
        result: { count: 2 },
      }),
    ).toEqual([
      {
        callId: 'call-1',
        tool: 'list_drones',
        args: { limit: 5 },
        result: { count: 2 },
        status: 'completed',
      },
    ]);
  });

  test('describes Companion tool activity using its scope and result count', () => {
    expect(companionToolActivityLabel({
      callId: 'call-1',
      tool: 'list_drones',
      args: { names: ['Stories.prog.drone'], limit: 20 },
      result: { ok: true, count: 0, drones: [] },
      status: 'completed',
    })).toBe('Find drone “Stories.prog.drone” · 0 drones');
    expect(companionToolActivityLabel({
      callId: 'call-2',
      tool: 'list_drones',
      args: { repoPath: '/home/zael/dev/mojo/StorySpark', limit: 100 },
      result: { ok: true, count: 40 },
      status: 'completed',
    })).toBe('List drones in StorySpark · 40 drones');
    expect(companionToolActivityLabel({
      callId: 'call-3',
      tool: 'search_chat_messages',
      args: { query: 'source of truth', repoPath: '/home/zael/dev/mojo/StorySpark' },
      result: { ok: true, count: 2 },
      status: 'completed',
    })).toBe('Search chats for “source of truth” in StorySpark · 2 matches');
    expect(companionToolActivityLabel({
      callId: 'call-4',
      tool: 'open_drone_chat',
      args: { droneId: 'drone-1', chatName: 'default' },
      result: {
        ok: true,
        droneId: 'drone-1',
        droneName: 'Review Prompt and Shot Architecture',
        repoPath: '/home/zael/dev/mojo/StorySpark',
        chatName: 'default',
      },
      status: 'completed',
    })).toBe('Open “default” in Review Prompt and Shot Architecture');
  });

  test('groups only overlapping calls from the same turn as parallel', () => {
    const first = reduceCompanionToolActivity([], {
      type: 'tool_call_started',
      turnId: 'turn-1',
      callId: 'call-1',
      tool: 'read_chat',
    });
    const overlapping = reduceCompanionToolActivity(first, {
      type: 'tool_call_started',
      turnId: 'turn-1',
      callId: 'call-2',
      tool: 'list_drones',
    });
    const firstCompleted = reduceCompanionToolActivity(overlapping, {
      type: 'tool_call_completed',
      turnId: 'turn-1',
      callId: 'call-1',
      tool: 'read_chat',
    });
    const secondCompleted = reduceCompanionToolActivity(firstCompleted, {
      type: 'tool_call_completed',
      turnId: 'turn-1',
      callId: 'call-2',
      tool: 'list_drones',
    });
    const sequential = reduceCompanionToolActivity(secondCompleted, {
      type: 'tool_call_started',
      turnId: 'turn-1',
      callId: 'call-3',
      tool: 'read_chat',
    });

    expect(groupCompanionToolActivity(sequential)).toEqual([
      {
        key: 'parallel:turn-1:call-1',
        parallel: true,
        items: sequential.slice(0, 2),
      },
      {
        key: 'call-3',
        parallel: false,
        items: [sequential[2]],
      },
    ]);
  });

  test('runs one shared client lifecycle through tools and completion', async () => {
    const connection = clientTransport();
    const ids = ['run-1', 'message-1', 'message-2'];
    const controller = new CompanionClientController({
      createId: () => ids.shift()!,
      now: () => 42,
    });

    await controller.submitPrompt({
      prompt: ' Hello ',
      createTransport: () => connection.transport,
      executeTool: async (tool) => ({ tool, active: true }),
    });
    expect(controller.getSnapshot()).toMatchObject({
      status: 'working',
      transcript: 'Hello',
      startedAt: 42,
    });
    expect(connection.prompts).toContainEqual({
      runId: 'run-1',
      messageId: 'message-1',
      prompt: 'Hello',
      telemetry: { version: 1, connectionMs: 12, connectionReused: false },
    });

    connection.message({
      type: 'tool_call',
      runId: 'run-1',
      generation: 3,
      callId: 'call-1',
      tool: 'get_app_context',
      args: {},
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(connection.toolResults).toContainEqual({
      runId: 'run-1',
      generation: 3,
      callId: 'call-1',
      ok: true,
      result: { tool: 'get_app_context', active: true },
    });

    connection.message({ type: 'reply', runId: 'run-1', reply: 'Done' });
    connection.message({ type: 'status', runId: 'run-1', status: 'completed' });
    expect(controller.getSnapshot()).toMatchObject({
      status: 'completed',
      reply: 'Done',
      endedAt: 42,
    });

    await controller.submitPrompt({
      prompt: 'Again',
      createTransport: () => connection.transport,
      executeTool: () => ({}),
    });
    expect(connection.opens).toBe(1);
    expect(connection.prompts).toContainEqual({
      runId: 'run-1',
      messageId: 'message-2',
      prompt: 'Again',
      telemetry: { version: 1, connectionMs: 0, connectionReused: true },
    });
    expect(connection.closes).toBe(0);
  });

  test.each([false, true])('keeps footer metrics per request when a follow-up is queued: %s', async (queued) => {
    const connection = clientTransport();
    let now = 0;
    const controller = new CompanionClientController({ createId: () => 'run', now: () => now });
    const submit = (messageId: string) => controller.submitPrompt({
      prompt: messageId,
      messageId,
      createTransport: () => connection.transport,
      executeTool: () => ({ ok: true }),
    });
    await submit('first');
    connection.message({
      type: 'activity', messageId: 'first',
      event: { type: 'tool_call_started', callId: 'first-tool', tool: 'list_drones', args: {} },
    });
    now = 2_000;
    if (!queued) {
      connection.message({ type: 'reply', messageId: 'first', reply: 'First reply' });
      connection.message({ type: 'status', messageId: 'first', status: 'completed' });
      expect(controller.getSnapshot()).toMatchObject({ startedAt: 0, endedAt: 2_000 });
    }

    now = 10_000_000;
    await submit('second');
    const second = controller.getSnapshot();
    expect(second).toMatchObject({
      status: 'working', transcript: 'second', reply: '',
      startedAt: now, endedAt: null, activity: [],
    });
    // Old completion/activity must not stop the new timer or inflate its count.
    connection.message({
      type: 'activity', messageId: 'first',
      event: { type: 'tool_call_completed', callId: 'first-tool', result: {} },
    });
    connection.message({ type: 'reply', messageId: 'first', reply: 'Late first reply' });
    connection.message({ type: 'status', messageId: 'first', status: 'completed' });
    expect(controller.getSnapshot()).toEqual(second);

    // A late tool for a completed request gets an error instead of the new message context.
    connection.message({
      type: 'tool_call', messageId: 'first', generation: 1,
      callId: 'browser', tool: 'get_app_context', args: {},
    });
    await Promise.resolve();
    expect(connection.toolResults).toHaveLength(1);
    expect(connection.toolResults[0]).toMatchObject({ ok: false, error: 'COMPANION_MESSAGE_CONTEXT_UNAVAILABLE' });
    connection.message({
      type: 'activity', messageId: 'second',
      event: { type: 'tool_call_started', callId: 'second-tool', tool: 'list_drones', args: {} },
    });
    now += 3_000;
    connection.message({ type: 'reply', messageId: 'second', reply: 'Second reply' });
    connection.message({ type: 'status', messageId: 'second', status: 'completed' });
    const finished = controller.getSnapshot();
    expect(finished.endedAt! - finished.startedAt!).toBe(3_000);
    expect(finished.activity.map((item) => item.callId)).toEqual(['second-tool']);
    expect(finished.reply).toBe('Second reply');
    expect(connection.opens).toBe(1);
    now += 60_000;
    expect(controller.getSnapshot().endedAt).toBe(finished.endedAt);
  });

  test('invalidates late run events when the client closes', async () => {
    const connection = clientTransport();
    const ids = ['run-2', 'message-2'];
    const controller = new CompanionClientController({ createId: () => ids.shift()! });
    await controller.submitPrompt({
      prompt: 'Wait',
      createTransport: () => connection.transport,
      executeTool: () => ({}),
    });

    await controller.close();
    connection.message({ type: 'reply', runId: 'run-2', reply: 'Too late' });
    connection.disconnect('Too late');

    expect(controller.getSnapshot()).toEqual({
      status: 'idle',
      error: '',
      reply: '',
      transcript: '',
      startedAt: null,
      endedAt: null,
      activity: [],
      compaction: null,
    });
    expect(connection.cancelled).toEqual(['run-2']);
  });

  test('cancels an active run without erasing its visible state', async () => {
    const connection = clientTransport();
    const ids = ['run-3', 'message-3'];
    const controller = new CompanionClientController({
      createId: () => ids.shift()!,
      now: () => 84,
    });
    await controller.submitPrompt({
      prompt: 'Keep this transcript',
      createTransport: () => connection.transport,
      executeTool: () => ({}),
    });

    await controller.cancel();
    connection.message({ type: 'reply', runId: 'run-3', reply: 'Too late' });

    expect(controller.getSnapshot()).toMatchObject({
      status: 'cancelled',
      transcript: 'Keep this transcript',
      endedAt: 84,
    });
    expect(connection.cancelled).toEqual(['run-3']);
    expect(connection.closes).toBe(1);
  });
});

test('queued messages use their own tool executor and reject expired or ambiguous contexts', async () => {
  const connection = clientTransport();
  const controller = new CompanionClientController({ createId: () => 'session' });
  for (const messageId of ['a', 'b']) {
    await controller.submitPrompt({
      messageId, prompt: 'same repo', createTransport: () => connection.transport,
      executeTool: () => ({ repo: messageId }),
    });
  }
  const call = async (callId: string, messageId?: string) => {
    connection.message({
      type: 'tool_call', messageId, generation: 1, callId, tool: 'get_app_context', args: {},
    });
    await Promise.resolve();
    await Promise.resolve();
    return connection.toolResults.at(-1);
  };
  expect(await call('first', 'a')).toMatchObject({ ok: true, result: { repo: 'a' } });
  expect(await call('second', 'b')).toMatchObject({ ok: true, result: { repo: 'b' } });
  expect(await call('ambiguous')).toMatchObject({ ok: false, error: 'COMPANION_MESSAGE_CONTEXT_UNAVAILABLE' });
  connection.message({ type: 'status', messageId: 'a', status: 'completed' });
  expect(await call('expired', 'a')).toMatchObject({ ok: false, error: 'COMPANION_MESSAGE_CONTEXT_UNAVAILABLE' });
  expect(await call('remaining', 'b')).toMatchObject({ ok: true, result: { repo: 'b' } });
  await controller.close();
  const count = connection.toolResults.length;
  await call('closed', 'b');
  expect(connection.toolResults).toHaveLength(count);
});


test('Companion compaction follows the latest request and does not inflate tool counts', async () => {
  const connection = clientTransport();
  const controller = new CompanionClientController({ createId: () => 'session' });
  const submit = (messageId: string) => controller.submitPrompt({
    prompt: messageId, messageId, createTransport: () => connection.transport, executeTool: () => ({}),
  });
  const activity = (type: string, messageId = 'first', fields = {}) => connection.message({
    type: 'activity', messageId, event: { type, ...fields },
  });
  await submit('first');
  activity('compaction_started');
  expect(controller.getSnapshot().compaction?.status).toBe('running');
  activity('compaction_completed', 'first', { tokensBefore: 9000, tokensAfter: 2000, fallbackUsed: true });
  expect(controller.getSnapshot().compaction).toEqual({
    status: 'completed', tokensBefore: 9000, tokensAfter: 2000, fallbackUsed: true,
  });
  expect(controller.getSnapshot().activity).toEqual([]);
  activity('compaction_started');
  activity('compaction_skipped');
  expect(controller.getSnapshot().compaction).toEqual({ status: 'skipped' });
  await submit('second');
  expect(controller.getSnapshot().compaction).toBeNull();
  activity('compaction_started');
  expect(controller.getSnapshot().compaction).toBeNull();
  activity('compaction_started', 'second');
  activity('compaction_failed', 'second', { reason: 'cancelled' });
  expect(controller.getSnapshot().compaction?.status).toBe('cancelled');
  await controller.close();
});

test.each(['completed', 'cancelled', 'error', 'disconnect', 'local-cancel'])(
  'Companion clears the compaction indicator on %s', async (terminal) => {
    const connection = clientTransport();
    const controller = new CompanionClientController({ createId: () => 'session' });
    await controller.submitPrompt({ prompt: 'Continue', createTransport: () => connection.transport, executeTool: () => ({}) });
    connection.message({ type: 'activity', event: { type: 'compaction_started' } });
    if (terminal === 'disconnect') connection.disconnect('Disconnected');
    else if (terminal === 'local-cancel') await controller.cancel();
    else if (terminal === 'error') connection.message({ type: 'error', error: 'Failed' });
    else connection.message({ type: 'status', status: terminal });
    expect(controller.getSnapshot().compaction?.status).toBe(
      terminal === 'completed' ? 'interrupted' : terminal === 'cancelled' || terminal === 'local-cancel' ? 'cancelled' : 'failed',
    );
    connection.message({ type: 'activity', event: { type: 'compaction_started' } });
    expect(controller.getSnapshot().compaction?.status).not.toBe('running');
    await controller.close();
    expect(controller.getSnapshot().compaction).toBeNull();
  },
);
