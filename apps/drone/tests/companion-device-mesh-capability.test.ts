import { withTempDroneDataDir } from './test-helpers';
import { resetHubSettingsRepositoryForTests } from '../src/host/hub-settings-repository';
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
        input.onEvent({ type: 'compaction_started', reason: 'auto' });
        input.onEvent({ type: 'compaction_completed', tokensBefore: 5000, tokensAfter: 1000 });
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
    expect(events.filter((event) => event.type === 'activity')).toHaveLength(4);
    expect(events.filter((event) => event.type === 'activity').map((event) => event.event)).toEqual(
      expect.arrayContaining([
        { type: 'compaction_started' },
        { type: 'compaction_completed', tokensBefore: 5000, tokensAfter: 1000, fallbackUsed: false },
      ]),
    );
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
    await capability.invoke('run.cancel', { runId: 'another-run' }, context());
    expect(cancelled).toHaveLength(0);
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

  test('replaces a stale session when the phone starts a new conversation', async () => {
    const cancelled: string[] = [];
    const prompts: string[] = [];
    const runtime = {
      cancel(runId: string) {
        cancelled.push(runId);
      },
      async deleteSession(runId: string) {
        cancelled.push(runId);
      },
      run(input: any) {
        prompts.push(input.prompt);
        return new Promise<string>(() => undefined);
      },
    };
    const events: any[] = [];
    const capability = createCompanionCapability(
      runtime as any,
      async (_capability, _event, payload) => {
        events.push(payload);
      },
    );

    await capability.invoke('run.start', { runId: 'before-reload', prompt: 'Old' }, context());
    await waitFor(() => prompts.length === 1);
    // The phone reloaded and lost its client state; its next run id must win.
    await capability.invoke('run.start', { runId: 'after-reload', prompt: 'Fresh' }, context());
    await waitFor(() => prompts.length === 2);

    expect(prompts).toEqual(['Old', 'Fresh']);
    expect(cancelled).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({ runId: 'before-reload', type: 'status', status: 'cancelled' }),
    );
    await capability.invoke('run.cancel', { runId: 'before-reload' }, context());
    expect(cancelled).toHaveLength(1);
    await capability.invoke('run.cancel', { runId: 'after-reload' }, context());
    expect(cancelled).toHaveLength(2);
  });

  test('steers follow-ups on the same mobile Companion session', async () => {
    const prompts: string[] = [];
    const runtimeRunIds: string[] = [];
    const steering: Array<{ runId: string; prompt: string }> = [];
    const messageIds: string[] = [];
    const completions: Array<(reply: string) => void> = [];
    const runtime = {
      steer: (runId: string, prompt: string) => { steering.push({ runId, prompt }); return true; },
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

    expect(steering).toEqual([{ runId: runtimeRunIds[0], prompt: 'Second' }]);
    expect(messageIds).toEqual(['mobile-message-1']);
    completions[0]!('Steered reply');
    await waitFor(() => events.some((event) => event.status === 'completed'));
    expect(events.filter((event) => event.type === 'reply')).toMatchObject([{
      messageId: 'mobile-message-2', reply: 'Steered reply',
    }]);
    await capability.invoke('run.cancel', { runId: 'conversation-1' }, context());
  });
});

test('mobile workspace operations use the same catalog and revision-checked save as desktop', async () => {
  const calls: unknown[] = [];
  const catalog = { revision: 'current', access: { targets: [], defaultTargetId: null }, defaults: { targets: [], defaultTargetId: null }, workspaces: [], devices: [] };
  const target = { id: 'drone:drone-1', name: 'Drone 1', deviceId: 'hub', deviceName: 'Hub', kind: 'drone', read: true, write: false, execute: false };
  const capability = createCompanionCapability({} as any, async () => {}, {
    catalog: async (deviceId) => { calls.push(['list', deviceId]); return catalog; },
    current: async (droneId) => { calls.push(['current', droneId]); return { ...catalog, target } as any; },
    save: async (access, revision) => {
      calls.push(['save', access, revision]);
      if (revision !== 'current') throw new Error('Workspace access changed elsewhere');
      return catalog;
    },
  });
  expect(capability.descriptor.operations).toContain('workspaces.list');
  expect(capability.descriptor.operations).toContain('workspaces.update');
  expect(capability.descriptor.operations).toContain('workspaces.current');
  expect(await capability.invoke('workspaces.list', { deviceId: 'remote' }, context())).toEqual(catalog);
  expect(await capability.invoke('workspaces.current', { droneId: 'drone-1' }, context())).toEqual({ ...catalog, target });
  await expect(capability.invoke('workspaces.current', {}, context())).rejects.toThrow('droneId');
  expect(await capability.invoke('workspaces.update', { access: catalog.access, revision: 'current' }, context())).toEqual(catalog);
  await expect(capability.invoke('workspaces.update', { access: catalog.access, revision: 'stale' }, context())).rejects.toThrow('changed elsewhere');
  await expect(capability.invoke('workspaces.update', { access: catalog.access }, context())).rejects.toThrow('revision');
  expect(calls.slice(0, 3)).toEqual([['list', 'remote'], ['current', 'drone-1'], ['save', catalog.access, 'current']]);
});

test('existing Companion run grants do not authorize workspace settings', async () => {
  const { COMPANION_CAPABILITY, COMPANION_RUN_OPERATIONS, COMPANION_WORKSPACE_OPERATIONS, isGranted } = await import('@drone/device-protocol');
  const grants = [{ capability: COMPANION_CAPABILITY.id, version: 1, operations: [...COMPANION_RUN_OPERATIONS] }];
  expect(COMPANION_RUN_OPERATIONS.every((operation) => isGranted(grants, 'companion', 1, operation))).toBe(true);
  expect(COMPANION_WORKSPACE_OPERATIONS.some((operation) => isGranted(grants, 'companion', 1, operation))).toBe(false);
});


test('mobile auto-approval settings survive capability and storage restarts', async () => {
  await withTempDroneDataDir('companion-mobile-auto-approve-', async () => {
    let capability = createCompanionCapability({} as any, async () => {});
    expect(await capability.invoke('auto-approve.settings.get', {}, context())).toEqual({ enabled: false });
    await capability.invoke('auto-approve.settings.update', { enabled: true }, context());
    await capability.close?.();
    resetHubSettingsRepositoryForTests();
    capability = createCompanionCapability({} as any, async () => {});
    expect(await capability.invoke('auto-approve.settings.get', {}, context())).toEqual({ enabled: true });
    await expect(capability.invoke('auto-approve.settings.update', { enabled: 'false' }, context())).rejects.toThrow('boolean');
    await capability.close?.();
  });
});

test.each(['disconnectDevice', 'accessChanged', 'revokeDevice'] as const)(
  'mobile subscriptions resume idle conversations and stop on %s', async (lifecycle) => {
  const events: any[] = [];
  const deleted: string[] = [];
  let deliver!: (input: any) => Promise<void>;
  const capability = createCompanionCapability({
    connectSubscriptions: (_id: string, callback: typeof deliver, changed: (rows: unknown[]) => void) => {
      deliver = callback;
      changed([{ id: 'watch', status: 'active' }]);
    },
    run: async (input: any) => `Reply to ${input.prompt}`,
    steer: () => false,
    deleteSession: async (id: string) => { deleted.push(id); },
  } as any, async (_capability, _event, payload) => { events.push(payload); });
  try {
    await capability.invoke('run.start', { runId: 'mobile', messageId: 'user', prompt: 'watch' }, context());
    await waitFor(() => events.some((event) => event.status === 'completed'));
    await deliver({ prompt: 'event', messageId: 'event', deliveryMode: 'queue' });
    await waitFor(() => events.some((event) => event.messageId === 'event' && event.status === 'completed'));
    expect(events.find((event) => event.type === 'subscriptions')).toMatchObject({ runId: 'mobile', subscriptions: [{ id: 'watch', status: 'active' }] });
    expect(events.find((event) => event.type === 'subscription')).toMatchObject({ runId: 'mobile', messageId: 'event' });
    expect(events.find((event) => event.reply === 'Reply to event')).toMatchObject({ runId: 'mobile', messageId: 'event' });
    await capability[lifecycle]?.('phone-1');
    expect(deleted).toHaveLength(1);
    await expect(deliver({ prompt: 'late', messageId: 'late', deliveryMode: 'asap' })).rejects.toThrow('disconnected');
  } finally { await capability.close?.(); }
});
