import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { HubAssistantService } from '../src/hub/assistant';
import { updateRegistry } from '../src/host/registry';
import { withTempDroneDataDir } from './test-helpers';

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakePromptText(input: any): string {
  if (typeof input === 'string') return input;
  if (typeof input?.content === 'string') return input.content;
  if (!Array.isArray(input?.content)) return '';
  return input.content
    .map((item: any) => (item?.type === 'text' ? String(item.text ?? '') : ''))
    .join('\n');
}

function installFakeRuntime(
  service: HubAssistantService,
  handlers: {
    onPrompt?: (
      prompt: string,
      run: { provider: string; model: string; thinkingLevel: string },
    ) => Promise<void> | void;
  },
): void {
  const Type = {
    Object: (value: unknown) => value,
    String: (value?: unknown) => value,
    Optional: (value: unknown) => value,
    Number: (value?: unknown) => value,
    Boolean: (value?: unknown) => value,
    Array: (value: unknown) => value,
  };

  class FakeAgent {
    state: { messages: any[]; streamingMessage: any };
    private readonly run: { provider: string; model: string; thinkingLevel: string };
    private readonly tools: any[];
    private subscribers: Array<(event: any) => Promise<void> | void> = [];

    constructor(opts: any) {
      this.run = {
        provider: String(opts?.initialState?.model?.provider ?? ''),
        model: String(opts?.initialState?.model?.id ?? ''),
        thinkingLevel: String(opts?.initialState?.thinkingLevel ?? ''),
      };
      this.state = {
        messages: [...(opts?.initialState?.messages ?? [])],
        streamingMessage: null,
      };
      this.tools = Array.isArray(opts?.initialState?.tools) ? opts.initialState.tools : [];
    }

    subscribe(callback: (event: any) => Promise<void> | void): void {
      this.subscribers.push(callback);
    }

    abort(): void {
      this.state.streamingMessage = null;
    }

    async prompt(input: any): Promise<void> {
      const prompt = fakePromptText(input);
      this.state.messages.push(
        typeof input === 'string' ? { role: 'user', content: input } : input,
      );
      this.state.streamingMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: `running ${prompt}` }],
      };
      await this.emit({ type: 'message_update', message: this.state.streamingMessage });
      await handlers.onPrompt?.(prompt, this.run);
      if (prompt.startsWith('speak:')) {
        const speak = this.tools.find((tool) => tool?.name === 'speak');
        await speak?.execute?.('tool_fake_speak', { text: prompt.slice('speak:'.length).trim() });
      }
      this.state.streamingMessage = null;
      this.state.messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: `done ${prompt}` }],
      });
      await this.emit({
        type: 'turn_end',
        message: this.state.messages[this.state.messages.length - 1],
      });
      await this.emit({ type: 'agent_end' });
    }

    private async emit(event: any): Promise<void> {
      for (const subscriber of this.subscribers) await subscriber(event);
    }
  }

  (service as any).runtime = async () => ({
    Agent: FakeAgent,
    Type,
    getModel: (provider: string, model: string) => ({ provider, id: model, reasoning: false }),
    getModels: () => [],
    getSupportedThinkingLevels: () => ['off'],
  });
}

function makeService(): HubAssistantService {
  return new HubAssistantService({
    listDrones: async () => [],
  });
}

async function markDroneReady(input: {
  id: string;
  name: string;
  runtime?: string;
  group?: string | null;
  repoPath?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await updateRegistry((reg: any) => {
    reg.pending = reg.pending ?? {};
    delete reg.pending[input.id];
    reg.drones = reg.drones ?? {};
    reg.drones[input.id] = {
      id: input.id,
      name: input.name,
      group: input.group ?? undefined,
      runtime: input.runtime ?? 'container',
      repoPath: input.repoPath ?? '',
      createdAt: now,
      chats: { default: { createdAt: now, turns: [] } },
    };
  });
}

describe('assistant thread isolation', () => {
  test('defaults new assistant threads to OpenAI when Codex is not connected', async () => {
    await withTempDroneDataDir('assistant-default-openai-', async (droneDataDir) => {
      const previousCodexAuthFile = process.env.DRONE_HUB_CODEX_AUTH_FILE;
      process.env.DRONE_HUB_CODEX_AUTH_FILE = path.join(droneDataDir, 'missing-codex-auth.json');
      try {
        const service = makeService();
        installFakeRuntime(service, {});

        const snapshot = await service.createThread({ title: 'default provider' });
        const thread = snapshot.threads.find((item) => item.id === snapshot.activeThreadId) as any;

        expect(thread.provider).toBe('openai');
        expect(thread.model).toBe('gpt-5.6-sol');
        expect(thread.thinkingLevel).toBe('off');
      } finally {
        if (previousCodexAuthFile == null) delete process.env.DRONE_HUB_CODEX_AUTH_FILE;
        else process.env.DRONE_HUB_CODEX_AUTH_FILE = previousCodexAuthFile;
      }
    });
  });

  test('stores assistant controls on the backend thread', async () => {
    await withTempDroneDataDir('assistant-thread-controls-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});

      const created = await service.createThread({ title: 'controls' });
      const threadId = created.activeThreadId;
      let thread = created.threads.find((item) => item.id === threadId) as any;
      expect(thread.autoApprove).toBe(false);
      expect(thread.promptDeliveryMode).toBe('queue');

      const updated = await service.updateThread(threadId, {
        autoApprove: true,
        promptDeliveryMode: 'asap',
      });
      thread = updated.threads.find((item) => item.id === threadId) as any;
      expect(thread.autoApprove).toBe(true);
      expect(thread.promptDeliveryMode).toBe('asap');
    });
  });

  test('auto approve does not bypass assistant write scope', async () => {
    await withTempDroneDataDir('assistant-auto-approve-scope-', async () => {
      await markDroneReady({ id: 'drone-a', name: 'Allowed' });
      await markDroneReady({ id: 'drone-b', name: 'Denied' });
      const service = new HubAssistantService({
        listDrones: async () => [
          {
            id: 'drone-a',
            name: 'Allowed',
            group: null,
            runtime: 'container',
            repoPath: '',
            status: 'ready',
            chats: ['default'],
          },
          {
            id: 'drone-b',
            name: 'Denied',
            group: null,
            runtime: 'container',
            repoPath: '',
            status: 'ready',
            chats: ['default'],
          },
        ],
      });
      const created = await service.createThread({ title: 'scope' });
      const threadId = created.activeThreadId;
      await service.updateAccessScope({
        threadId,
        readMode: 'selected',
        writeMode: 'selected',
        droneIds: ['drone-a'],
      });
      await service.updateThread(threadId, { autoApprove: true });

      const denied = await service.preflightBlipTool(threadId, 'message_drone', 'call-denied', {
        droneId: 'drone-b',
        chatName: 'default',
        message: 'no',
      });
      const allowed = await service.preflightBlipTool(threadId, 'message_drone', 'call-allowed', {
        droneId: 'drone-a',
        chatName: 'default',
        message: 'yes',
      });

      expect(denied?.block).toBe(true);
      expect(denied?.reason).toContain('scope does not include');
      expect(allowed).toBeUndefined();
    });
  });

  test('compact assistant snapshots omit archived thread message bodies', async () => {
    await withTempDroneDataDir('assistant-compact-snapshot-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});

      const first = await service.createThread({ title: 'first' });
      const firstThreadId = first.activeThreadId;
      const second = await service.createThread({ title: 'second' });
      const secondThreadId = second.activeThreadId;
      const largeText = 'x'.repeat(250_000);
      const threads = (service as any).threads as any[];
      threads.find((thread) => thread.id === firstThreadId).messages = [
        { role: 'assistant', content: [{ type: 'text', text: largeText }] },
      ];
      threads.find((thread) => thread.id === secondThreadId).messages = [
        { role: 'assistant', content: [{ type: 'text', text: largeText }] },
      ];
      (service as any).chatIdleSubscriptions = [
        {
          id: 'sub-fired',
          threadId: firstThreadId,
          toolCallId: null,
          mode: 'all',
          targets: [{ droneId: 'drone-1', chatName: 'default' }],
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          idleForMs: 0,
          status: 'fired',
          idleSince: null,
          firedAt: new Date().toISOString(),
          cancelledAt: null,
          expiredAt: null,
          lastResult: { ok: true, targets: [{ latest: { text: largeText } }] },
        },
      ];

      const compact = await service.snapshot('compact');
      expect(JSON.stringify(compact)).not.toContain(largeText);
      expect(compact.threads.every((thread: any) => thread.messages.length === 0)).toBe(true);
      expect(compact.threads.find((thread: any) => thread.id === firstThreadId)?.messageCount).toBe(
        1,
      );
      expect(
        compact.threads.find((thread: any) => thread.id === secondThreadId)?.messageCount,
      ).toBe(1);
      expect(compact.chatIdleSubscriptions).toEqual([]);

      const detail = await service.threadSnapshot(firstThreadId);
      const firstDetail = detail.threads.find((thread: any) => thread.id === firstThreadId) as any;
      const secondSummary = detail.threads.find(
        (thread: any) => thread.id === secondThreadId,
      ) as any;
      expect(detail.activeThreadId).toBe(firstThreadId);
      expect((await service.snapshot('compact')).activeThreadId).toBe(secondThreadId);
      expect(JSON.stringify(firstDetail)).toContain(largeText);
      expect(firstDetail.messageCount).toBe(1);
      expect(JSON.stringify(secondSummary)).not.toContain(largeText);
      expect(secondSummary.messageCount).toBe(1);
      expect(secondSummary.messages).toEqual([]);
      expect(detail.chatIdleSubscriptions).toEqual([]);

      const activated = await service.activateThread(firstThreadId);
      expect(activated.activeThreadId).toBe(firstThreadId);
      expect((await service.snapshot('compact')).activeThreadId).toBe(firstThreadId);
    });
  });

  test('approval pending snapshots omit inactive thread message bodies', async () => {
    await withTempDroneDataDir('assistant-approval-compact-snapshot-', async () => {
      await markDroneReady({ id: 'drone-1', name: 'Approval drone' });
      const service = makeService();
      installFakeRuntime(service, {});

      const archived = await service.createThread({ title: 'archived' });
      const archivedThreadId = archived.activeThreadId;
      const active = await service.createThread({ title: 'approval' });
      const activeThreadId = active.activeThreadId;
      await service.updateAccessScope({
        threadId: activeThreadId,
        readMode: 'all',
        writeMode: 'all',
        droneIds: [],
      });
      const largeText = 'approval-large-payload'.repeat(20_000);
      const activeText = 'active approval context';
      const threads = (service as any).threads as any[];
      threads.find((thread) => thread.id === archivedThreadId).messages = [
        { role: 'assistant', content: [{ type: 'text', text: largeText }] },
      ];
      threads.find((thread) => thread.id === activeThreadId).messages = [
        { role: 'assistant', content: [{ type: 'text', text: activeText }] },
      ];

      const events: any[] = [];
      const preflight = (service as any).beforeToolCall(
        activeThreadId,
        {
          toolCall: { id: 'message-call', name: 'message_drone' },
          args: { droneId: 'drone-1', chatName: 'default', prompt: 'hello' },
        },
        async (event: any) => {
          if (event.type !== 'approval_pending') return;
          events.push(event);
          await service.approve(event.approval.id, true);
        },
      );

      await expect(preflight).resolves.toBeUndefined();
      expect(events).toHaveLength(1);
      const eventSnapshot = events[0].snapshot;
      const archivedSummary = eventSnapshot.threads.find(
        (thread: any) => thread.id === archivedThreadId,
      ) as any;
      const activeDetail = eventSnapshot.threads.find(
        (thread: any) => thread.id === activeThreadId,
      ) as any;
      expect(JSON.stringify(eventSnapshot)).not.toContain(largeText);
      expect(JSON.stringify(activeDetail)).toContain(activeText);
      expect(archivedSummary.messages).toEqual([]);
      expect(archivedSummary.messageCount).toBe(1);
    });
  });

  test('keeps selected access even when no drones are selected', async () => {
    await withTempDroneDataDir('assistant-empty-selected-scope-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});

      const created = await service.createThread({ title: 'empty selected' });
      const threadId = created.activeThreadId;
      await service.updateAccessScope({
        threadId,
        readMode: 'selected',
        writeMode: 'selected',
        droneIds: [],
      });

      const snapshot = await service.snapshot();
      const thread = snapshot.threads.find((item) => item.id === threadId) as any;
      expect(thread.accessScope.readMode).toBe('selected');
      expect(thread.accessScope.writeMode).toBe('selected');
      expect(thread.accessScope.droneIds).toEqual([]);
    });
  });

  test('defaults new assistant and voice threads to limited write access', async () => {
    await withTempDroneDataDir('assistant-thread-access-defaults-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});

      const noActive = await service.createThread({ title: 'no active chat' });
      let thread = noActive.threads.find((item) => item.id === noActive.activeThreadId) as any;
      expect(thread.accessScope).toMatchObject({
        readMode: 'all',
        writeMode: 'selected',
        droneIds: [],
      });

      service.updateAppContext({
        activeDroneId: 'drone-a',
        activeDroneName: 'Drone A',
        activeChatName: 'default',
        appView: 'workspace',
      });
      const withActive = await service.createThread({ title: 'active chat' });
      thread = withActive.threads.find((item) => item.id === withActive.activeThreadId) as any;
      expect(thread.accessScope).toMatchObject({
        readMode: 'all',
        writeMode: 'selected',
        droneIds: ['drone-a'],
      });

      const voice = await service.ensureLatestVoiceThread();
      expect(voice.thread.accessScope).toMatchObject({
        readMode: 'all',
        writeMode: 'selected',
        droneIds: [],
      });
    });
  });

  test('voice assistant threads are tagged and get speak by default', async () => {
    await withTempDroneDataDir('assistant-voice-thread-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});

      const normal = await service.createThread({ title: 'normal' });
      let thread = normal.threads.find((item) => item.id === normal.activeThreadId) as any;
      expect(thread.voiceEnabled).toBe(false);
      expect(thread.enabledTools).not.toContain('speak');
      expect(thread.enabledTools).not.toContain('set_thinking_level');
      expect(thread.enabledTools).not.toContain('create_new_thread');

      const voice = await service.ensureLatestVoiceThread();
      expect(voice.created).toBe(true);
      expect(voice.thread.voiceEnabled).toBe(true);
      expect(voice.thread.enabledTools).toContain('speak');
      expect(voice.thread.enabledTools).toContain('set_thinking_level');
      expect(voice.thread.enabledTools).toContain('create_new_thread');

      const reused = await service.ensureLatestVoiceThread();
      expect(reused.created).toBe(false);
      expect(reused.threadId).toBe(voice.threadId);

      const disabled = await service.updateThread(voice.threadId, {
        enabledTools: voice.thread.enabledTools.filter(
          (name: string) => name !== 'set_thinking_level',
        ),
      });
      thread = disabled.threads.find((item) => item.id === voice.threadId) as any;
      expect(thread.enabledTools).not.toContain('set_thinking_level');
      expect(thread.enabledTools).toContain('speak');
      expect(thread.enabledTools).toContain('create_new_thread');

      const reloaded = makeService();
      const reloadedSnapshot = await reloaded.snapshot();
      thread = reloadedSnapshot.threads.find((item) => item.id === voice.threadId) as any;
      expect(thread.enabledTools).not.toContain('set_thinking_level');
      expect(thread.enabledTools).toContain('create_new_thread');
    });
  });

  test('realtime transcripts are delegated to canonical Blip history', async () => {
    await withTempDroneDataDir('assistant-realtime-transcripts-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});
      const history: any[] = [];
      service.setRealtimeHistoryDelegate(async (_threadId, message) => {
        history.push(message);
      });

      const config = await service.ensureLatestVoiceThread({ title: 'Desktop realtime thread' });
      await service.appendRealtimeMessage({
        threadId: config.threadId,
        role: 'user',
        text: 'show me the drone list',
      });
      await service.appendRealtimeMessage({
        threadId: config.threadId,
        role: 'assistant',
        text: 'I can do that.',
      });

      const snapshot = await service.threadSnapshot(config.threadId);
      const thread = snapshot.threads.find((item) => item.id === config.threadId) as any;
      expect(history.map((message) => message.role)).toEqual(['user', 'assistant']);
      expect(history[0].content[0].text).toBe('show me the drone list');
      expect(history[1].content[0].text).toBe('I can do that.');
      expect(thread.messages).toHaveLength(0);
      expect(thread.title).toBe('show me the drone list');
    });
  });

  test('realtime transcript deltas appear as streaming messages until final transcript is appended', async () => {
    await withTempDroneDataDir('assistant-realtime-streaming-transcripts-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});
      const history: any[] = [];
      service.setRealtimeHistoryDelegate(async (_threadId, message) => {
        history.push(message);
      });

      const config = await service.ensureLatestVoiceThread({ title: 'Desktop realtime thread' });
      await service.updateRealtimeStreamingMessage({
        threadId: config.threadId,
        role: 'user',
        text: 'show me',
      });

      const streaming = await service.threadSnapshot(config.threadId);
      expect((streaming as any).streamingMessage?.role).toBe('user');
      expect((streaming as any).streamingMessage?.content?.[0]?.text).toBe('show me');

      await service.appendRealtimeMessage({
        threadId: config.threadId,
        role: 'user',
        text: 'show me the drones',
      });
      const final = await service.threadSnapshot(config.threadId);
      expect((final as any).streamingMessage).toBeUndefined();
      const thread = final.threads.find((item) => item.id === config.threadId) as any;
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('user');
      expect(history[0].content[0].text).toBe('show me the drones');
      expect(thread.messages).toHaveLength(0);
    });
  });

  test('realtime user and assistant transcript deltas can stream at the same time', async () => {
    await withTempDroneDataDir('assistant-realtime-dual-streaming-transcripts-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});
      const history: any[] = [];
      service.setRealtimeHistoryDelegate(async (_threadId, message) => {
        history.push(message);
      });

      const config = await service.ensureLatestVoiceThread({ title: 'Desktop realtime thread' });
      await service.updateRealtimeStreamingMessage({
        threadId: config.threadId,
        role: 'user',
        text: 'count to ten',
      });
      await service.updateRealtimeStreamingMessage({
        threadId: config.threadId,
        role: 'assistant',
        text: 'one two',
      });

      const streaming = await service.threadSnapshot(config.threadId);
      expect((streaming as any).streamingMessages.map((message: any) => message.role)).toEqual([
        'user',
        'assistant',
      ]);
      expect(
        (streaming as any).streamingMessages.map((message: any) => message.content?.[0]?.text),
      ).toEqual(['count to ten', 'one two']);

      await service.appendRealtimeMessage({
        threadId: config.threadId,
        role: 'user',
        text: 'count to ten',
      });
      const userFinal = await service.threadSnapshot(config.threadId);
      expect((userFinal as any).streamingMessages.map((message: any) => message.role)).toEqual([
        'assistant',
      ]);

      await service.appendRealtimeMessage({
        threadId: config.threadId,
        role: 'assistant',
        text: 'one two three',
      });
      const assistantFinal = await service.threadSnapshot(config.threadId);
      expect((assistantFinal as any).streamingMessages).toBeUndefined();
      const thread = assistantFinal.threads.find((item) => item.id === config.threadId) as any;
      expect(history.map((message) => message.role)).toEqual(['user', 'assistant']);
      expect(thread.messages).toHaveLength(0);
    });
  });

  test('projects model runtime deltas and running state into thread snapshots', async () => {
    await withTempDroneDataDir('assistant-model-runtime-streaming-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});
      const initial = await service.snapshot('compact');
      const threadId = initial.activeThreadId;

      await service.notifyRuntimeEvent(threadId, { type: 'turn_started' });
      await service.notifyRuntimeEvent(threadId, { type: 'assistant_delta', text: 'Hel' });
      await service.notifyRuntimeEvent(threadId, { type: 'assistant_delta', text: 'lo' });

      const streaming = await service.threadSnapshot(threadId);
      expect(streaming.threads.find((thread) => thread.id === threadId)?.status).toBe('running');
      expect((streaming as any).streamingMessage?.content?.[0]?.text).toBe('Hello');

      await service.notifyRuntimeEvent(threadId, {
        type: 'transcript_changed',
        role: 'assistant',
      });
      const persisted = await service.threadSnapshot(threadId);
      expect((persisted as any).streamingMessage).toBeUndefined();
      expect(persisted.threads.find((thread) => thread.id === threadId)?.status).toBe('running');

      await service.notifyRuntimeEvent(threadId, { type: 'session_finished' });
      const finished = await service.threadSnapshot(threadId);
      expect(finished.threads.find((thread) => thread.id === threadId)?.status).toBe('idle');
    });
  });

  test('defaults new assistant threads to Codex GPT-5.6 Sol with no reasoning when Codex is connected', async () => {
    await withTempDroneDataDir('assistant-default-codex-', async (droneDataDir) => {
      const previousCodexAuthFile = process.env.DRONE_HUB_CODEX_AUTH_FILE;
      const authPath = path.join(droneDataDir, 'codex-auth.json');
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          tokens: { access_token: 'test-access-token', refresh_token: 'test-refresh-token' },
          last_refresh: '2026-05-08T00:00:00.000Z',
        }),
      );
      process.env.DRONE_HUB_CODEX_AUTH_FILE = authPath;
      try {
        const service = makeService();
        installFakeRuntime(service, {});

        const snapshot = await service.createThread({ title: 'default provider' });
        const thread = snapshot.threads.find((item) => item.id === snapshot.activeThreadId) as any;

        expect(thread.provider).toBe('codex');
        expect(thread.model).toBe('gpt-5.6-sol');
        expect(thread.thinkingLevel).toBe('off');
      } finally {
        if (previousCodexAuthFile == null) delete process.env.DRONE_HUB_CODEX_AUTH_FILE;
        else process.env.DRONE_HUB_CODEX_AUTH_FILE = previousCodexAuthFile;
      }
    });
  });

  test('redacts current app drone context outside the thread read scope', async () => {
    await withTempDroneDataDir('assistant-thread-scope-context-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});

      const snapshot = await service.createThread({ title: 'scoped thread' });
      const threadId = snapshot.activeThreadId;
      service.updateAppContext({
        activeDroneId: 'drone-b',
        activeDroneName: 'Drone B',
        activeChatName: 'default',
        appView: 'workspace',
      });
      await service.updateAccessScope({
        threadId,
        readMode: 'selected',
        writeMode: 'selected',
        droneIds: ['drone-a'],
      });

      const context = (service as any).scopedAppContext(threadId);
      expect(context.activeDroneId).toBeNull();
      expect(context.activeDroneName).toBeNull();
      expect(context.activeChatName).toBeNull();
      expect(context.appView).toBe('workspace');
    });
  });

  test('offers the same GPT-5.6 assistant model choices for Codex as OpenAI', async () => {
    await withTempDroneDataDir('assistant-codex-model-options-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});

      const snapshot = await service.createThread({ provider: 'codex', title: 'codex models' });
      const thread = snapshot.threads.find((item) => item.id === snapshot.activeThreadId) as any;
      const codexOptions = snapshot.models.filter((option) => option.provider === 'codex');

      expect(thread.model).toBe('gpt-5.6-sol');
      expect(thread.thinkingLevel).toBe('off');
      expect(
        codexOptions
          .filter((option) => option.id.startsWith('gpt-5.6-'))
          .map((option) => `${option.id}:${option.thinkingLevel}`),
      ).toEqual([
        'gpt-5.6-sol:off',
        'gpt-5.6-sol:low',
        'gpt-5.6-sol:medium',
        'gpt-5.6-sol:high',
        'gpt-5.6-terra:off',
        'gpt-5.6-terra:low',
        'gpt-5.6-terra:medium',
        'gpt-5.6-terra:high',
        'gpt-5.6-luna:off',
        'gpt-5.6-luna:low',
        'gpt-5.6-luna:medium',
        'gpt-5.6-luna:high',
      ]);
    });
  });

  test('keeps advertising configured models when one runtime lookup fails', async () => {
    await withTempDroneDataDir('assistant-partial-model-catalog-', async () => {
      const service = makeService();
      (service as any).runtime = async () => ({
        getModel: (_provider: string, model: string) => {
          if (model === 'gpt-5.6-luna') throw new Error('model is not installed');
          return { reasoning: model !== 'gpt-5.5' };
        },
      });

      const snapshot = await service.snapshot('compact');
      expect(snapshot.models.some((option) => option.id === 'gpt-5.6-terra')).toBe(true);
      expect(snapshot.models.some((option) => option.id === 'gpt-5.6-luna')).toBe(true);
      expect(snapshot.models.some((option) => option.id === 'gpt-5.5')).toBe(true);
    });
  });
});
