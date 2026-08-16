import { describe, expect, test } from 'bun:test';

import { createCompanionCapability } from '../src/hub/device-mesh/companion-capability';

function context() {
  return {
    requestId: 'request-1',
    sourceDevice: {
      id: 'phone-1',
      name: 'Phone',
      platform: 'android' as const,
      publicKey: {},
      administrator: false,
      grants: [],
      endpoints: [],
      revokedAt: null,
      addedAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('expected Companion event was not emitted');
}

describe('Companion device mesh capability', () => {
  test('relays mobile tools and streams the completed reply', async () => {
    const events: any[] = [];
    const runtime = {
      cancel() {},
      async deleteSession() {},
      async run(input: any) {
        input.onEvent({
          type: 'tool_call_started',
          callId: 'activity-1',
          tool: 'get_app_context',
          args: {},
        });
        const appContext = await input.callBrowser('get_app_context', {});
        input.onEvent({
          type: 'tool_call_completed',
          callId: 'activity-1',
          tool: 'get_app_context',
          result: appContext,
        });
        return `Active drone: ${appContext.drone}`;
      },
    };
    const capability = createCompanionCapability(
      runtime as any,
      async (_capability, _event, payload) => {
        events.push(payload);
      },
    );

    await capability.invoke(
      'run.start',
      { runId: 'mobile-run-1', prompt: 'What is open?' },
      context(),
    );
    await waitFor(() => events.some((event) => event.type === 'tool_call'));
    const toolCall = events.find((event) => event.type === 'tool_call');

    await capability.invoke(
      'tool.result',
      {
        runId: 'mobile-run-1',
        generation: toolCall.generation,
        callId: toolCall.callId,
        ok: true,
        result: { drone: 'alpha' },
      },
      context(),
    );
    await waitFor(() => events.some((event) => event.status === 'completed'));

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'status', status: 'working' }),
        expect.objectContaining({ type: 'reply', reply: 'Active drone: alpha' }),
        expect.objectContaining({ type: 'status', status: 'completed' }),
      ]),
    );
    expect(events.filter((event) => event.type === 'activity')).toHaveLength(2);
  });

  test('cancels and removes a run when its phone closes the overlay', async () => {
    const cancelled: string[] = [];
    const runtime = {
      cancel(runId: string) {
        cancelled.push(runId);
      },
      async deleteSession(runId: string) {
        cancelled.push(runId);
      },
      async run() {
        return await new Promise<string>(() => undefined);
      },
    };
    const events: any[] = [];
    const capability = createCompanionCapability(
      runtime as any,
      async (_capability, _event, payload) => {
        events.push(payload);
      },
    );

    await capability.invoke('run.start', { runId: 'mobile-run-2', prompt: 'Wait' }, context());
    await capability.invoke('run.cancel', { runId: 'mobile-run-2' }, context());

    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toStartWith('mesh:');
    expect(events).toContainEqual(
      expect.objectContaining({ runId: 'mobile-run-2', type: 'status', status: 'cancelled' }),
    );
    await capability.close?.();
    expect(cancelled).toHaveLength(1);
  });

  test('does not retain a run when its first event cannot reach the phone', async () => {
    let attempts = 0;
    let runs = 0;
    const runtime = {
      cancel() {},
      async deleteSession() {},
      async run() {
        runs += 1;
        return 'done';
      },
    };
    const capability = createCompanionCapability(runtime as any, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('phone disconnected');
    });

    await expect(
      capability.invoke('run.start', { runId: 'mobile-run-3', prompt: 'Try once' }, context()),
    ).rejects.toThrow('phone disconnected');
    await capability.invoke('run.start', { runId: 'mobile-run-3', prompt: 'Try again' }, context());
    await waitFor(() => runs === 1);

    expect(runs).toBe(1);
    await capability.close?.();
  });

  test('queues follow-ups on the same mobile Companion session', async () => {
    const prompts: string[] = [];
    const runtimeRunIds: string[] = [];
    const messageIds: string[] = [];
    const completions: Array<(reply: string) => void> = [];
    const runtime = {
      cancel() {},
      async deleteSession() {},
      run(input: any) {
        prompts.push(input.prompt);
        runtimeRunIds.push(input.runId);
        messageIds.push(input.messageId);
        return new Promise<string>((resolve) => completions.push(resolve));
      },
    };
    const events: any[] = [];
    const capability = createCompanionCapability(
      runtime as any,
      async (_capability, _event, payload) => {
        events.push(payload);
      },
    );

    await capability.invoke(
      'run.start',
      {
        runId: 'conversation-1',
        messageId: 'mobile-message-1',
        prompt: 'First',
        telemetry: { version: 1, transcriptionMs: 80 },
      },
      context(),
    );
    await capability.invoke(
      'run.start',
      { runId: 'conversation-1', messageId: 'mobile-message-2', prompt: 'Second' },
      context(),
    );
    await waitFor(() => prompts.length === 1);
    expect(prompts).toEqual(['First']);

    completions[0]!('First reply');
    await waitFor(() => prompts.length === 2);
    expect(prompts).toEqual(['First', 'Second']);
    expect(runtimeRunIds[1]).toBe(runtimeRunIds[0]);
    expect(messageIds).toEqual(['mobile-message-1', 'mobile-message-2']);

    completions[1]!('Second reply');
    await waitFor(() => events.filter((event) => event.status === 'completed').length === 2);
    await capability.invoke('run.cancel', { runId: 'conversation-1' }, context());
  });
});
