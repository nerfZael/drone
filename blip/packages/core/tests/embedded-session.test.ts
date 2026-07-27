import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentMessage, AgentTool, StreamFn } from '@mariozechner/pi-agent-core';
import {
  AssistantMessageEventStream,
  Type,
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
} from '@mariozechner/pi-ai';
import { createProfileTools } from '@blip/tools';
import { createBlipSession, type BlipRuntimeEvent } from '../src/index';
import { SessionStore } from '../src/node';

async function tempWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'blip-embedded-'));
}

function userText(message: AgentMessage | undefined): string {
  if (message?.role !== 'user') return '';
  if (typeof message.content === 'string') return message.content;
  return message.content.map((item) => (item.type === 'text' ? item.text : '')).join('\n');
}

describe('Embedded Blip session', () => {
  test('stays alive across prompts, preserves images, and can delete its session', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({
      api: 'faux-embedded-session',
      provider: 'faux-embedded-session',
      tokensPerSecond: 0,
    });
    const observed: Array<{ systemPrompt: string; lastUser: AgentMessage | undefined }> = [];
    faux.setResponses([
      (context) => {
        observed.push({
          systemPrompt: context.systemPrompt,
          lastUser: context.messages.filter((message) => message.role === 'user').at(-1),
        });
        return fauxAssistantMessage('first response');
      },
      (context) => {
        observed.push({
          systemPrompt: context.systemPrompt,
          lastUser: context.messages.filter((message) => message.role === 'user').at(-1),
        });
        return fauxAssistantMessage('second response');
      },
      fauxAssistantMessage('embedded summary'),
    ]);
    const events: BlipRuntimeEvent[] = [];
    const providerResponses: Array<{ status: number; model: string }> = [];
    const repository = new SessionStore(workspace);
    const session = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: repository,
      promptProvider: () => 'Injected host prompt',
      onResponse: (response, model) =>
        providerResponses.push({ status: response.status, model: model.id }),
      eventSink: (event) => events.push(event),
    });

    const firstId = (await session.prompt('first prompt')).id;
    const secondState = await session.prompt({
      text: 'second prompt',
      images: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
    });

    expect(secondState.id).toBe(firstId);
    expect(events.filter((event) => event.type === 'session_started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'session_finished')).toHaveLength(2);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length);
    expect(
      events.filter((event) => event.type === 'transcript_changed' && event.role === 'assistant'),
    ).toHaveLength(2);
    expect(providerResponses).toEqual([
      { status: 200, model: faux.getModel().id },
      { status: 200, model: faux.getModel().id },
    ]);
    expect(observed.map((item) => item.systemPrompt)).toEqual([
      'Injected host prompt',
      'Injected host prompt',
    ]);
    const imagePrompt = observed[1]?.lastUser;
    expect(Array.isArray(imagePrompt?.content) ? imagePrompt.content : []).toContainEqual({
      type: 'image',
      data: 'aGVsbG8=',
      mimeType: 'image/png',
    });
    const messages = await repository.readMessages(secondState);
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(2);
    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(2);
    await session.compact({
      auto: true,
      reserveTokens: 10,
      keepRecentTokens: 1,
      keepRecentTurns: 1,
    });
    expect(events.some((event) => event.type === 'compaction_completed')).toBe(true);
    await session.delete();
    expect(await repository.exists(secondState.id)).toBe(false);
    faux.unregister();
  });

  test('processes steering before queued follow-up prompts', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({
      api: 'faux-embedded-queue',
      provider: 'faux-embedded-queue',
      tokensPerSecond: 0,
    });
    let signalStarted = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let releaseFirst = () => {};
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const latestUserPrompts: string[] = [];
    const captureLatestUser = (context: { messages: AgentMessage[] }) => {
      latestUserPrompts.push(
        userText(context.messages.filter((message) => message.role === 'user').at(-1)),
      );
    };
    faux.setResponses([
      async (context) => {
        captureLatestUser(context);
        signalStarted();
        await firstReleased;
        return fauxAssistantMessage('initial response');
      },
      (context) => {
        captureLatestUser(context);
        return fauxAssistantMessage('steered response');
      },
      (context) => {
        captureLatestUser(context);
        return fauxAssistantMessage('queued response');
      },
    ]);
    const events: BlipRuntimeEvent[] = [];
    const session = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: new SessionStore(workspace),
      eventSink: (event) => events.push(event),
    });

    const running = session.prompt('initial prompt');
    await started;
    session.steer('urgent steering');
    const queued = session.enqueue('queued follow-up');
    releaseFirst();
    await Promise.all([running, queued]);

    expect(latestUserPrompts).toEqual(['initial prompt', 'urgent steering', 'queued follow-up']);
    expect(events.filter((event) => event.type === 'turn_started')).toHaveLength(3);
    expect(
      events.filter((event) => event.type === 'turn_started' && event.prompt !== undefined),
    ).toHaveLength(1);
    session.close();
    faux.unregister();
  });

  test('loads tools and blocks validated calls through host preflight', async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, 'secret.txt'), 'secret\n');
    const faux = registerFauxProvider({
      api: 'faux-embedded-policy',
      provider: 'faux-embedded-policy',
      tokensPerSecond: 0,
    });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('read_file', { path: 'secret.txt' }, { id: 'call_blocked' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('The read was blocked.'),
    ]);
    const preflightCalls: Array<{ tool: string; callId: string; args: unknown }> = [];
    const events: BlipRuntimeEvent[] = [];
    const session = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: 'read-only',
      toolProfile: 'read-only',
      sessionRepository: new SessionStore(workspace),
      toolProviders: [
        {
          id: 'workspace',
          load: () =>
            createProfileTools({
              workspaceRoot: workspace,
              permissionMode: 'read-only',
              profile: 'read-only',
            }),
        },
      ],
      permissionPreflight(request) {
        preflightCalls.push({ tool: request.tool, callId: request.callId, args: request.args });
        return { status: 'deny', reason: 'Denied by host policy' };
      },
      eventSink: (event) => events.push(event),
    });

    await session.prompt('Read the secret');

    expect(preflightCalls).toEqual([
      { tool: 'read_file', callId: 'call_blocked', args: { path: 'secret.txt' } },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool_call_failed',
        callId: 'call_blocked',
        tool: 'read_file',
        error: 'Denied by host policy',
      }),
    );
    session.close();
    faux.unregister();
  });

  test('persists a suspended tool call across restart and resumes the exact call after approval', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({
      api: 'faux-durable-approval',
      provider: 'faux-durable-approval',
      tokensPerSecond: 0,
    });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('mutate', { value: 'original' }, { id: 'call_durable' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('Mutation completed after approval.'),
    ]);
    const executions: Array<{ callId: string; value: string }> = [];
    const tool: AgentTool<any> = {
      name: 'mutate',
      label: 'Mutate',
      description: 'Test mutation',
      parameters: Type.Object({ value: Type.String() }),
      execute: async (callId, args) => {
        executions.push({ callId, value: args.value });
        return { content: [{ type: 'text', text: 'done' }], details: { value: args.value } };
      },
    };
    const repository = new SessionStore(workspace);
    const firstEvents: BlipRuntimeEvent[] = [];
    const first = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: repository,
      tools: [tool],
      permissionPreflight: ({ phase }) =>
        phase === 'resume'
          ? { status: 'allow' }
          : {
              status: 'suspend',
              reason: 'Needs approval',
              details: { approval: { label: 'Mutate', args: { value: 'original' } } },
            },
      eventSink: (event) => firstEvents.push(event),
    });
    await first.prompt('Mutate something');
    const [pending] = await first.pendingToolSuspensions();

    expect(executions).toEqual([]);
    expect(pending).toEqual(
      expect.objectContaining({
        toolCallId: 'call_durable',
        toolName: 'mutate',
        args: { value: 'original' },
        status: 'pending',
      }),
    );
    expect(firstEvents).toContainEqual(
      expect.objectContaining({ type: 'session_finished', status: 'suspended' }),
    );
    first.close();

    const restoredEvents: BlipRuntimeEvent[] = [];
    const restored = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: repository,
      sessionId: first.state.id,
      tools: [tool],
      permissionPreflight: ({ phase }) =>
        phase === 'resume' ? { status: 'allow' } : { status: 'suspend', reason: 'Needs approval' },
      eventSink: (event) => restoredEvents.push(event),
    });
    expect(await restored.pendingToolSuspensions()).toHaveLength(1);
    expect(restoredEvents).toContainEqual(
      expect.objectContaining({
        type: 'tool_call_suspended',
        suspensionId: pending!.id,
        recoveryRequired: false,
      }),
    );

    await restored.resolveToolSuspension(pending!.id, 'approve');

    expect(executions).toEqual([{ callId: 'call_durable', value: 'original' }]);
    expect(await restored.pendingToolSuspensions()).toEqual([]);
    expect(
      (await repository.readToolSuspensions(restored.state)).find(
        (candidate) => candidate.id === pending!.id,
      )?.status,
    ).toBe('completed');
    restored.close();
    faux.unregister();
  });

  test('turns a denied suspension into a durable tool result and continues the model', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({
      api: 'faux-durable-denial',
      provider: 'faux-durable-denial',
      tokensPerSecond: 0,
    });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('mutate', { value: 'blocked' }, { id: 'call_denied' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('The mutation was denied.'),
    ]);
    let executions = 0;
    const repository = new SessionStore(workspace);
    const session = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: repository,
      tools: [
        {
          name: 'mutate',
          label: 'Mutate',
          description: 'Test mutation',
          parameters: Type.Object({ value: Type.String() }),
          execute: async () => {
            executions += 1;
            return { content: [{ type: 'text', text: 'done' }], details: {} };
          },
        },
      ],
      permissionPreflight: () => ({ status: 'suspend', reason: 'Needs approval' }),
    });
    await session.prompt('Mutate');
    const [pending] = await session.pendingToolSuspensions();

    await session.resolveToolSuspension(pending!.id, 'deny');

    expect(executions).toBe(0);
    expect(
      (await repository.readToolSuspensions(session.state)).find(
        (candidate) => candidate.id === pending!.id,
      )?.status,
    ).toBe('denied');
    expect(await repository.readMessages(session.state)).toContainEqual(
      expect.objectContaining({
        role: 'toolResult',
        toolCallId: 'call_denied',
        isError: true,
      }),
    );
    session.close();
    faux.unregister();
  });

  test('marks an uncertain in-flight mutation interrupted instead of replaying it on restart', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({
      api: 'faux-interrupted-approval',
      provider: 'faux-interrupted-approval',
      tokensPerSecond: 0,
    });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('mutate', { value: 'once' }, { id: 'call_uncertain' }), {
        stopReason: 'toolUse',
      }),
    ]);
    let executions = 0;
    const tool: AgentTool<any> = {
      name: 'mutate',
      label: 'Mutate',
      description: 'Test mutation',
      parameters: Type.Object({ value: Type.String() }),
      execute: async () => {
        executions += 1;
        return { content: [{ type: 'text', text: 'done' }], details: {} };
      },
    };
    const repository = new SessionStore(workspace);
    const first = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: repository,
      tools: [tool],
      permissionPreflight: () => ({ status: 'suspend', reason: 'Needs approval' }),
    });
    await first.prompt('Mutate');
    const [pending] = await first.pendingToolSuspensions();
    const at = new Date().toISOString();
    await repository.transitionToolSuspension(
      first.state,
      { ...pending!, status: 'executing', attempt: 1, updatedAt: at },
      ['pending'],
    );
    first.close();

    const events: BlipRuntimeEvent[] = [];
    const restored = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: repository,
      sessionId: first.state.id,
      tools: [tool],
      permissionPreflight: () => ({ status: 'suspend', reason: 'Needs approval' }),
      eventSink: (event) => events.push(event),
    });

    expect(executions).toBe(0);
    expect((await restored.pendingToolSuspensions())[0]?.status).toBe('interrupted');
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool_call_suspended',
        recoveryRequired: true,
      }),
    );
    restored.close();
    faux.unregister();
  });

  test('continues the model after restart when a durable tool result already proves completion', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({
      api: 'faux-completed-recovery',
      provider: 'faux-completed-recovery',
      tokensPerSecond: 0,
    });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('mutate', { value: 'done' }, { id: 'call_completed' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('Recovered from the persisted tool result.'),
    ]);
    let executions = 0;
    const tool: AgentTool<any> = {
      name: 'mutate',
      label: 'Mutate',
      description: 'Test mutation',
      parameters: Type.Object({ value: Type.String() }),
      execute: async () => {
        executions += 1;
        return { content: [{ type: 'text', text: 'done' }], details: {} };
      },
    };
    const repository = new SessionStore(workspace);
    const first = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: repository,
      tools: [tool],
      permissionPreflight: () => ({ status: 'suspend', reason: 'Needs approval' }),
    });
    await first.prompt('Mutate');
    const [pending] = await first.pendingToolSuspensions();
    const result = {
      role: 'toolResult' as const,
      toolCallId: pending!.toolCallId,
      toolName: pending!.toolName,
      content: [{ type: 'text' as const, text: 'already completed' }],
      details: {},
      isError: false,
      timestamp: Date.now(),
    };
    const at = new Date().toISOString();
    await repository.transitionToolSuspension(
      first.state,
      {
        ...pending!,
        status: 'completed',
        result,
        completedAt: at,
        updatedAt: at,
      },
      ['pending'],
    );
    await repository.appendMessage(first.state, result);
    first.close();

    const events: BlipRuntimeEvent[] = [];
    const restored = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: repository,
      sessionId: first.state.id,
      tools: [tool],
      permissionPreflight: () => ({ status: 'suspend', reason: 'Needs approval' }),
      eventSink: (event) => events.push(event),
    });

    expect(executions).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'assistant_message',
        text: 'Recovered from the persisted tool result.',
      }),
    );
    restored.close();
    faux.unregister();
  });

  test('compacts a large current-turn tool result before the next model request', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({
      api: 'faux-mid-loop-compaction',
      provider: 'faux-mid-loop-compaction',
      tokensPerSecond: 0,
    });
    let finalContext: AgentMessage[] = [];
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('large_output', {}, { id: 'call_large' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('Compacted current turn'),
      (context) => {
        finalContext = context.messages;
        return fauxAssistantMessage('Handled compacted output.');
      },
    ]);
    const events: BlipRuntimeEvent[] = [];
    const session = await createBlipSession({
      workspaceRoot: workspace,
      model: { ...faux.getModel(), contextWindow: 1_000, maxTokens: 200 },
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: new SessionStore(workspace),
      tools: [
        {
          name: 'large_output',
          label: 'Large output',
          description: 'Returns large output',
          parameters: Type.Object({}),
          execute: async () => ({
            content: [{ type: 'text', text: 'large '.repeat(2_000) }],
            details: {},
          }),
        },
      ],
      compactionSettings: {
        auto: true,
        reserveTokens: 200,
        keepRecentTokens: 100,
        keepRecentTurns: 1,
      },
      eventSink: (event) => events.push(event),
    });

    await session.prompt('Run the large output tool');

    expect(events.some((event) => event.type === 'compaction_completed')).toBe(true);
    expect(finalContext).toHaveLength(1);
    expect(userText(finalContext[0])).toContain('Summary of earlier conversation');
    session.close();
    faux.unregister();
  });

  test('retries one provider context overflow after durable compaction', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({
      api: 'faux-overflow-retry',
      provider: 'faux-overflow-retry',
      tokensPerSecond: 0,
    });
    const repository = new SessionStore(workspace);
    const seed = await createBlipSession({
      workspaceRoot: workspace,
      model: { ...faux.getModel(), contextWindow: 1_000, maxTokens: 200 },
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: repository,
      compactionSettings: {
        auto: false,
        reserveTokens: 200,
        keepRecentTokens: 10,
        keepRecentTurns: 1,
      },
    });
    await repository.appendMessage(seed.state, {
      role: 'user',
      content: 'Older goal that should be summarized.',
      timestamp: Date.now(),
    });
    await repository.appendMessage(
      seed.state,
      fauxAssistantMessage('Older response that should be summarized.'),
    );
    seed.close();

    faux.setResponses([
      fauxAssistantMessage('', {
        stopReason: 'error',
        errorMessage: 'input context_length_exceeded',
      }),
      fauxAssistantMessage('Overflow recovery summary'),
      fauxAssistantMessage('Emergency overflow recovery summary'),
      fauxAssistantMessage('Recovered after one retry.'),
    ]);
    const events: BlipRuntimeEvent[] = [];
    const session = await createBlipSession({
      workspaceRoot: workspace,
      model: { ...faux.getModel(), contextWindow: 1_000, maxTokens: 200 },
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: repository,
      sessionId: seed.state.id,
      compactionSettings: {
        auto: false,
        reserveTokens: 200,
        keepRecentTokens: 10,
        keepRecentTurns: 1,
      },
      eventSink: (event) => events.push(event),
    });

    await session.prompt('Current request');

    expect(events.filter((event) => event.type === 'model_retry')).toHaveLength(1);
    expect(events.some((event) => event.type === 'compaction_completed')).toBe(true);
    const assistants = (await repository.readMessages(session.state)).filter(
      (message) => message.role === 'assistant',
    );
    expect(assistants.some((message) => message.errorMessage?.includes('context_length'))).toBe(
      false,
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'assistant_message',
        text: 'Recovered after one retry.',
      }),
    );
    session.close();
    faux.unregister();
  });

  test('finishes an aborted prompt with cancelled status', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({
      api: 'faux-embedded-cancel',
      provider: 'faux-embedded-cancel',
      tokensPerSecond: 0,
    });
    let signalStarted = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    faux.setResponses([
      async () => {
        signalStarted();
        await released;
        return fauxAssistantMessage('response that should be aborted');
      },
    ]);
    const events: BlipRuntimeEvent[] = [];
    const session = await createBlipSession({
      workspaceRoot: workspace,
      model: faux.getModel(),
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: new SessionStore(workspace),
      eventSink: (event) => events.push(event),
    });

    const running = session.prompt('cancel this');
    await started;
    session.abort();
    release();
    await running;

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'session_finished', status: 'cancelled' }),
    );
    session.close();
    faux.unregister();
  });

  test('aborts an in-flight compaction summary with the rest of the session', async () => {
    const workspace = await tempWorkspace();
    const faux = registerFauxProvider({
      api: 'faux-embedded-compaction-cancel',
      provider: 'faux-embedded-compaction-cancel',
      tokensPerSecond: 0,
    });
    const repository = new SessionStore(workspace);
    const events: BlipRuntimeEvent[] = [];
    let signalCompactionStarted = () => {};
    const compactionStarted = new Promise<void>((resolve) => {
      signalCompactionStarted = resolve;
    });
    let compactionSignal: AbortSignal | undefined;
    const streamFn: StreamFn = (model, _context, options) => {
      const stream = new AssistantMessageEventStream();
      compactionSignal = options?.signal;
      signalCompactionStarted();
      const abort = () => {
        const message = fauxAssistantMessage('', {
          stopReason: 'aborted',
          errorMessage: 'Compaction was stopped',
        });
        stream.push({ type: 'error', reason: 'aborted', error: { ...message, model: model.id } });
      };
      if (options?.signal?.aborted) abort();
      else options?.signal?.addEventListener('abort', abort, { once: true });
      return stream;
    };
    const session = await createBlipSession({
      workspaceRoot: workspace,
      model: { ...faux.getModel(), contextWindow: 200 },
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: repository,
      streamFn,
      eventSink: (event) => events.push(event),
      compactionSettings: {
        auto: true,
        reserveTokens: 20,
        keepRecentTokens: 1,
        keepRecentTurns: 1,
      },
    });
    for (let index = 0; index < 3; index += 1) {
      await repository.appendMessage(session.state, {
        role: 'user',
        content: index === 0 ? 'old context '.repeat(100) : `recent prompt ${index}`,
        timestamp: Date.now() + index,
      });
    }

    const running = session.prompt('cancel during compaction');
    await compactionStarted;
    session.abort();
    await running;

    expect(compactionSignal?.aborted).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'session_finished', status: 'cancelled' }),
    );
    expect(events.some((event) => event.type === 'compaction_completed')).toBe(false);
    expect(
      (await repository.readTranscript(session.state)).some((entry) => entry.type === 'compaction'),
    ).toBe(false);
    session.close();
    faux.unregister();
  });
});
