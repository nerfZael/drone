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

function installFakeRuntime(
  service: HubAssistantService,
  handlers: {
    onPrompt?: (prompt: string, run: { provider: string; model: string; thinkingLevel: string }) => Promise<void> | void;
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

    async prompt(prompt: string): Promise<void> {
      this.state.messages.push({ role: 'user', content: prompt });
      this.state.streamingMessage = { role: 'assistant', content: [{ type: 'text', text: `running ${prompt}` }] };
      await this.emit({ type: 'message_update', message: this.state.streamingMessage });
      await handlers.onPrompt?.(prompt, this.run);
      if (prompt.startsWith('speak:')) {
        const speak = this.tools.find((tool) => tool?.name === 'speak');
        await speak?.execute?.('tool_fake_speak', { text: prompt.slice('speak:'.length).trim() });
      }
      this.state.streamingMessage = null;
      this.state.messages.push({ role: 'assistant', content: [{ type: 'text', text: `done ${prompt}` }] });
      await this.emit({ type: 'turn_end', message: this.state.messages[this.state.messages.length - 1] });
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
    createDrone: async () => {
      throw new Error('not implemented');
    },
    createChat: async () => {
      throw new Error('not implemented');
    },
    setDroneGroup: async () => {
      throw new Error('not implemented');
    },
    messageDrone: async () => {
      throw new Error('not implemented');
    },
  });
}

async function markDroneReady(input: { id: string; name: string; runtime?: string; group?: string | null; repoPath?: string }): Promise<void> {
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
        expect(thread.model).toBe('gpt-5.5');
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

      const updated = await service.updateThread(threadId, { autoApprove: true, promptDeliveryMode: 'asap' });
      thread = updated.threads.find((item) => item.id === threadId) as any;
      expect(thread.autoApprove).toBe(true);
      expect(thread.promptDeliveryMode).toBe('asap');
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
      threads.find((thread) => thread.id === firstThreadId).messages = [{ role: 'assistant', content: [{ type: 'text', text: largeText }] }];
      threads.find((thread) => thread.id === secondThreadId).messages = [{ role: 'assistant', content: [{ type: 'text', text: largeText }] }];
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
      expect(compact.threads.find((thread: any) => thread.id === firstThreadId)?.messageCount).toBe(1);
      expect(compact.threads.find((thread: any) => thread.id === secondThreadId)?.messageCount).toBe(1);
      expect(compact.chatIdleSubscriptions).toEqual([]);

      const detail = await service.threadSnapshot(firstThreadId);
      const firstDetail = detail.threads.find((thread: any) => thread.id === firstThreadId) as any;
      const secondSummary = detail.threads.find((thread: any) => thread.id === secondThreadId) as any;
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
      const service = makeService();
      installFakeRuntime(service, {});

      const archived = await service.createThread({ title: 'archived' });
      const archivedThreadId = archived.activeThreadId;
      const active = await service.createThread({ title: 'approval' });
      const activeThreadId = active.activeThreadId;
      const largeText = 'approval-large-payload'.repeat(20_000);
      const activeText = 'active approval context';
      const threads = (service as any).threads as any[];
      threads.find((thread) => thread.id === archivedThreadId).messages = [{ role: 'assistant', content: [{ type: 'text', text: largeText }] }];
      threads.find((thread) => thread.id === activeThreadId).messages = [{ role: 'assistant', content: [{ type: 'text', text: activeText }] }];

      const events: any[] = [];
      const preflight = (service as any).beforeToolCall(
        activeThreadId,
        { toolCall: { id: 'message-call', name: 'message_drone' }, args: { droneId: 'drone-1', chatName: 'default', prompt: 'hello' } },
        async (event: any) => {
          if (event.type !== 'approval_pending') return;
          events.push(event);
          await service.approve(event.approval.id, true);
        },
      );

      await expect(preflight).resolves.toBeUndefined();
      expect(events).toHaveLength(1);
      const eventSnapshot = events[0].snapshot;
      const archivedSummary = eventSnapshot.threads.find((thread: any) => thread.id === archivedThreadId) as any;
      const activeDetail = eventSnapshot.threads.find((thread: any) => thread.id === activeThreadId) as any;
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
      expect(thread.accessScope).toMatchObject({ readMode: 'all', writeMode: 'selected', droneIds: [] });

      service.updateAppContext({
        activeDroneId: 'drone-a',
        activeDroneName: 'Drone A',
        activeChatName: 'default',
        appView: 'workspace',
      });
      const withActive = await service.createThread({ title: 'active chat' });
      thread = withActive.threads.find((item) => item.id === withActive.activeThreadId) as any;
      expect(thread.accessScope).toMatchObject({ readMode: 'all', writeMode: 'selected', droneIds: ['drone-a'] });

      const voice = await service.ensureLatestVoiceThread();
      expect(voice.thread.accessScope).toMatchObject({ readMode: 'all', writeMode: 'selected', droneIds: [] });
    });
  });

  test('adds newly created drones to selected assistant access', async () => {
    await withTempDroneDataDir('assistant-created-drone-scope-', async () => {
      const service = new HubAssistantService({
        listDrones: async () => [],
        createDrone: async () => {
          await markDroneReady({ id: 'drone-new', name: 'Drone New' });
          return { id: 'drone-new', name: 'Drone New', runtime: 'container' };
        },
        createChat: async () => {
          throw new Error('not implemented');
        },
        setDroneGroup: async () => {
          throw new Error('not implemented');
        },
        messageDrone: async () => {
          throw new Error('not implemented');
        },
      });
      installFakeRuntime(service, {});

      const created = await service.createThread({ title: 'create drone scope' });
      const threadId = created.activeThreadId;
      await service.updateAccessScope({
        threadId,
        readMode: 'selected',
        writeMode: 'selected',
        droneIds: [],
      });

      const runtime = await (service as any).runtime();
      const tools = (service as any).buildTools(runtime, threadId, null);
      const createDrone = tools.find((tool: any) => tool.name === 'create_drone');
      await createDrone.execute('create-new', { name: 'Drone New' });

      const snapshot = await service.snapshot();
      const thread = snapshot.threads.find((item) => item.id === threadId) as any;
      expect(thread.accessScope).toMatchObject({ readMode: 'selected', writeMode: 'selected', droneIds: ['drone-new'] });
    });
  });

  test('creates assistant drones without approval and forces container runtime', async () => {
    await withTempDroneDataDir('assistant-create-drone-container-', async () => {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = {
          'source-host': {
            id: 'source-host',
            name: 'Source Host',
            group: 'Review',
            runtime: 'host',
            repoPath: '/tmp/source-host',
            createdAt: now,
            chats: {
              default: {
                createdAt: now,
                agent: { kind: 'builtin', id: 'codex' },
                model: 'gpt-5.5',
                turns: [],
              },
            },
          },
        };
      });
      const requests: any[] = [];
      const service = new HubAssistantService({
        listDrones: async () => [{ id: 'source-host', name: 'Source Host', group: 'Review', runtime: 'host', repoPath: '/tmp/source-host', status: 'ready', chats: ['default'] }],
        createDrone: async (request) => {
          requests.push(request);
          setTimeout(() => {
            void markDroneReady({ id: 'drone-new', name: request.name, runtime: request.runtime, group: 'Review', repoPath: '/tmp/source-host' });
          }, 10);
          return { id: 'drone-new', name: request.name, runtime: request.runtime, phase: 'starting' };
        },
        createChat: async () => {
          throw new Error('not implemented');
        },
        setDroneGroup: async () => {
          throw new Error('not implemented');
        },
        messageDrone: async () => {
          throw new Error('not implemented');
        },
      });
      installFakeRuntime(service, {});
      service.updateAppContext({ activeDroneId: 'source-host', activeDroneName: 'Source Host', activeChatName: 'default', appView: 'workspace' });
      const snapshot = await service.createThread({ title: 'create container' });
      const threadId = snapshot.activeThreadId;
      const approvals: any[] = [];

      const preflight = await (service as any).beforeToolCall(
        threadId,
        { toolCall: { id: 'create-call', name: 'create_drone' }, args: { name: 'New Drone' } },
        async (event: any) => {
          if (event.type === 'approval_pending') approvals.push(event.approval);
        },
      );
      const runtime = await (service as any).runtime();
      const tools = (service as any).buildTools(runtime, threadId, null);
      const createDrone = tools.find((tool: any) => tool.name === 'create_drone');
      const result = await createDrone.execute('create-call', { name: 'New Drone' });

      expect(preflight).toBeUndefined();
      expect(approvals).toHaveLength(0);
      expect(requests[0]).toMatchObject({
        name: 'New Drone',
        runtime: 'container',
        group: 'Review',
        repoPath: '/tmp/source-host',
        seedAgent: { kind: 'builtin', id: 'codex' },
        seedModel: 'gpt-5.5',
      });
      expect(result.details).toMatchObject({ phase: 'ready', ready: { id: 'drone-new', name: 'New Drone', runtime: 'container' } });
      await expect(createDrone.execute('create-host', { name: 'Host Drone', runtime: 'host' })).rejects.toThrow('assistant-created drones must use container runtime');
    });
  });

  test('aborts assistant create drone readiness waits', async () => {
    await withTempDroneDataDir('assistant-create-drone-abort-', async () => {
      const service = new HubAssistantService({
        listDrones: async () => [],
        createDrone: async (request) => {
          await updateRegistry((reg: any) => {
            reg.pending = {
              'drone-pending': {
                id: 'drone-pending',
                name: request.name,
                runtime: 'container',
                phase: 'starting',
                createdAt: new Date().toISOString(),
              },
            };
          });
          return { id: 'drone-pending', name: request.name, runtime: 'container', phase: 'starting' };
        },
        createChat: async () => {
          throw new Error('not implemented');
        },
        setDroneGroup: async () => {
          throw new Error('not implemented');
        },
        messageDrone: async () => {
          throw new Error('not implemented');
        },
      });
      installFakeRuntime(service, {});
      const snapshot = await service.createThread({ title: 'create abort' });
      const runtime = await (service as any).runtime();
      const tools = (service as any).buildTools(runtime, snapshot.activeThreadId, null);
      const createDrone = tools.find((tool: any) => tool.name === 'create_drone');
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 10);

      await expect(createDrone.execute('create-abort', { name: 'Pending Drone' }, controller.signal)).rejects.toThrow('aborted');
    });
  });

  test('clones container drones without approval and rejects host clone sources', async () => {
    await withTempDroneDataDir('assistant-clone-drone-', async () => {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = {
          'source-container': {
            id: 'source-container',
            name: 'Source Container',
            group: 'Build',
            runtime: 'container',
            repoPath: '/tmp/source-container',
            createdAt: now,
            chats: { default: { createdAt: now, turns: [] } },
          },
          'source-host': {
            id: 'source-host',
            name: 'Source Host',
            group: 'Build',
            runtime: 'host',
            repoPath: '/tmp/source-host',
            createdAt: now,
            chats: { default: { createdAt: now, turns: [] } },
          },
        };
        reg.pending = {
          'source-pending': {
            id: 'source-pending',
            name: 'Source Pending',
            group: 'Build',
            runtime: 'container',
            repoPath: '/tmp/source-pending',
            createdAt: now,
            phase: 'starting',
          },
        };
      });
      const requests: any[] = [];
      const service = new HubAssistantService({
        listDrones: async () => [
          { id: 'source-container', name: 'Source Container', group: 'Build', runtime: 'container', repoPath: '/tmp/source-container', status: 'ready', chats: ['default'] },
          { id: 'source-host', name: 'Source Host', group: 'Build', runtime: 'host', repoPath: '/tmp/source-host', status: 'ready', chats: ['default'] },
        ],
        createDrone: async (request) => {
          requests.push(request);
          await markDroneReady({ id: 'clone-new', name: request.name, runtime: request.runtime, group: 'Build', repoPath: '/tmp/source-container' });
          return { id: 'clone-new', name: request.name, runtime: request.runtime, phase: 'starting' };
        },
        createChat: async () => {
          throw new Error('not implemented');
        },
        setDroneGroup: async () => {
          throw new Error('not implemented');
        },
        messageDrone: async () => {
          throw new Error('not implemented');
        },
      });
      installFakeRuntime(service, {});
      const snapshot = await service.createThread({ title: 'clone container' });
      const threadId = snapshot.activeThreadId;
      const approvals: any[] = [];

      const preflight = await (service as any).beforeToolCall(
        threadId,
        { toolCall: { id: 'clone-call', name: 'clone_drone' }, args: { sourceDroneId: 'source-container', name: 'Clone New' } },
        async (event: any) => {
          if (event.type === 'approval_pending') approvals.push(event.approval);
        },
      );
      const runtime = await (service as any).runtime();
      const tools = (service as any).buildTools(runtime, threadId, null);
      const cloneDrone = tools.find((tool: any) => tool.name === 'clone_drone');
      const result = await cloneDrone.execute('clone-call', { sourceDroneId: 'source-container', name: 'Clone New' });

      expect(preflight).toBeUndefined();
      expect(approvals).toHaveLength(0);
      expect(requests[0]).toMatchObject({
        name: 'Clone New',
        runtime: 'container',
        cloneFrom: 'source-container',
        cloneChats: true,
        group: 'Build',
      });
      expect(result.details).toMatchObject({ phase: 'ready', ready: { id: 'clone-new', name: 'Clone New', runtime: 'container' } });
      await expect(cloneDrone.execute('clone-host', { sourceDroneId: 'source-host', name: 'Clone Host' })).rejects.toThrow(
        'clone source must use container runtime: source-host',
      );
      await expect(cloneDrone.execute('clone-pending', { sourceDroneId: 'source-pending', name: 'Clone Pending' })).rejects.toThrow(
        'clone source must be a ready drone: source-pending',
      );
    });
  });

  test('creates drone chats without approval using target drone write scope', async () => {
    await withTempDroneDataDir('assistant-create-chat-', async () => {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = {
          target: {
            id: 'target',
            name: 'Target Drone',
            group: 'Build',
            runtime: 'container',
            repoPath: '/tmp/target',
            createdAt: now,
            chats: { default: { createdAt: now, turns: [] } },
          },
        };
      });
      const requests: Array<{ droneId: string; chatName: string }> = [];
      const service = new HubAssistantService({
        listDrones: async () => [
          { id: 'target', name: 'Target Drone', group: 'Build', runtime: 'container', repoPath: '/tmp/target', status: 'ready', chats: ['default'] },
        ],
        createDrone: async () => {
          throw new Error('not implemented');
        },
        createChat: async (request) => {
          requests.push(request);
          return {
            droneId: request.droneId,
            droneName: 'Target Drone',
            chatName: request.chatName,
            chats: ['default', request.chatName],
          };
        },
        setDroneGroup: async () => {
          throw new Error('not implemented');
        },
        messageDrone: async () => {
          throw new Error('not implemented');
        },
      });
      installFakeRuntime(service, {});
      const snapshot = await service.createThread({ title: 'create chat', activeDroneId: 'target', activeChatName: 'default' });
      const approvals: any[] = [];

      const preflight = await (service as any).beforeToolCall(
        snapshot.activeThreadId,
        { toolCall: { id: 'chat-call', name: 'create_chat' }, args: { targetDroneId: 'Target Drone', name: 'Plan' } },
        async (event: any) => {
          if (event.type === 'approval_pending') approvals.push(event.approval);
        },
      );
      const runtime = await (service as any).runtime();
      const tools = (service as any).buildTools(runtime, snapshot.activeThreadId, null);
      const createChat = tools.find((tool: any) => tool.name === 'create_chat');
      const result = await createChat.execute('chat-call', { targetDroneId: 'Target Drone', name: 'Plan' });

      expect(preflight).toBeUndefined();
      expect(approvals).toHaveLength(0);
      expect(requests).toEqual([{ droneId: 'target', chatName: 'Plan' }]);
      expect(result.details).toMatchObject({ droneId: 'target', droneName: 'Target Drone', chatName: 'Plan' });
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
        enabledTools: voice.thread.enabledTools.filter((name: string) => name !== 'set_thinking_level'),
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

  test('create new thread tool starts a fresh default voice thread', async () => {
    await withTempDroneDataDir('assistant-voice-create-new-thread-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});

      const voice = await service.ensureLatestVoiceThread();
      const runtime = await (service as any).runtime();
      const tools = (service as any).buildTools(runtime, voice.threadId);
      const createNewThread = tools.find((tool: any) => tool.name === 'create_new_thread');
      expect(createNewThread).toBeTruthy();

      const result = await createNewThread.execute('tool_create_new_thread', {});
      expect(result.details.previousThreadId).toBe(voice.threadId);
      expect(result.details.threadId).not.toBe(voice.threadId);
      expect(result.details.thread.voiceEnabled).toBe(true);
      expect(result.details.thread.enabledTools).toContain('create_new_thread');

      await new Promise((resolve) => setTimeout(resolve, 5));
      await service.updateThread(voice.threadId, { title: 'old voice thread updated after tool call' });

      const routed = await service.ensureLatestVoiceThread();
      expect(routed.threadId).toBe(result.details.threadId);
    });
  });

  test('realtime session exposes enabled voice tools and executes them through assistant service', async () => {
    await withTempDroneDataDir('assistant-realtime-tools-', async () => {
      const service = new HubAssistantService({
        listDrones: async () => [
          { id: 'drone-a', name: 'Drone A', group: null, runtime: 'container', repoPath: '/tmp/drone-a', status: 'ready', chats: ['default'] },
        ],
        createDrone: async () => {
          throw new Error('not implemented');
        },
        createChat: async () => {
          throw new Error('not implemented');
        },
        setDroneGroup: async () => {
          throw new Error('not implemented');
        },
        messageDrone: async () => {
          throw new Error('not implemented');
        },
      });
      installFakeRuntime(service, {});

      const config = await service.realtimeSessionConfig({ source: 'desktop' });
      const toolNames = config.tools.map((tool) => tool.name);

      expect(config.threadId).toBeTruthy();
      expect(config.instructions).toContain('OpenAI Realtime audio');
      expect(toolNames).toContain('list_drones');
      expect(toolNames).not.toContain('speak');
      expect(config.tools.some((tool: any) => Object.prototype.hasOwnProperty.call(tool, 'strict'))).toBe(false);

      const result = await service.executeRealtimeTool({
        threadId: config.threadId,
        toolCallId: 'call_list_drones',
        toolName: 'list_drones',
        arguments: {},
        source: 'desktop',
      });

      expect(result.output).toContain('Drone A');
      expect((result.result as any).drones[0].id).toBe('drone-a');

      const afterTool = await service.threadSnapshot(config.threadId);
      const thread = afterTool.threads.find((item) => item.id === config.threadId) as any;
      expect(thread.messages.some((message: any) =>
        message.role === 'assistant' &&
        Array.isArray(message.content) &&
        message.content.some((part: any) => part.type === 'toolCall' && part.id === 'call_list_drones' && part.name === 'list_drones'),
      )).toBe(true);
      expect(thread.messages.some((message: any) =>
        message.role === 'toolResult' &&
        message.toolCallId === 'call_list_drones' &&
        message.toolName === 'list_drones',
      )).toBe(true);
    });
  });

  test('realtime transcripts are appended as normal assistant thread messages', async () => {
    await withTempDroneDataDir('assistant-realtime-transcripts-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});

      const config = await service.realtimeSessionConfig({ source: 'desktop' });
      await service.appendRealtimeMessage({ threadId: config.threadId, role: 'user', text: 'show me the drone list' });
      await service.appendRealtimeMessage({ threadId: config.threadId, role: 'assistant', text: 'I can do that.' });

      const snapshot = await service.threadSnapshot(config.threadId);
      const thread = snapshot.threads.find((item) => item.id === config.threadId) as any;
      expect(thread.messages.map((message: any) => message.role)).toEqual(['user', 'assistant']);
      expect(thread.messages[0].content[0].text).toBe('show me the drone list');
      expect(thread.messages[1].content[0].text).toBe('I can do that.');
      expect(thread.title).toBe('show me the drone list');
    });
  });

  test('realtime transcript deltas appear as streaming messages until final transcript is appended', async () => {
    await withTempDroneDataDir('assistant-realtime-streaming-transcripts-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});

      const config = await service.realtimeSessionConfig({ source: 'desktop' });
      await service.updateRealtimeStreamingMessage({ threadId: config.threadId, role: 'user', text: 'show me' });

      const streaming = await service.threadSnapshot(config.threadId);
      expect((streaming as any).streamingMessage?.role).toBe('user');
      expect((streaming as any).streamingMessage?.content?.[0]?.text).toBe('show me');

      await service.appendRealtimeMessage({ threadId: config.threadId, role: 'user', text: 'show me the drones' });
      const final = await service.threadSnapshot(config.threadId);
      expect((final as any).streamingMessage).toBeUndefined();
      const thread = final.threads.find((item) => item.id === config.threadId) as any;
      expect(thread.messages).toHaveLength(1);
      expect(thread.messages[0].role).toBe('user');
      expect(thread.messages[0].content[0].text).toBe('show me the drones');
    });
  });

  test('realtime user and assistant transcript deltas can stream at the same time', async () => {
    await withTempDroneDataDir('assistant-realtime-dual-streaming-transcripts-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});

      const config = await service.realtimeSessionConfig({ source: 'desktop' });
      await service.updateRealtimeStreamingMessage({ threadId: config.threadId, role: 'user', text: 'count to ten' });
      await service.updateRealtimeStreamingMessage({ threadId: config.threadId, role: 'assistant', text: 'one two' });

      const streaming = await service.threadSnapshot(config.threadId);
      expect((streaming as any).streamingMessages.map((message: any) => message.role)).toEqual(['user', 'assistant']);
      expect((streaming as any).streamingMessages.map((message: any) => message.content?.[0]?.text)).toEqual(['count to ten', 'one two']);

      await service.appendRealtimeMessage({ threadId: config.threadId, role: 'user', text: 'count to ten' });
      const userFinal = await service.threadSnapshot(config.threadId);
      expect((userFinal as any).streamingMessages.map((message: any) => message.role)).toEqual(['assistant']);

      await service.appendRealtimeMessage({ threadId: config.threadId, role: 'assistant', text: 'one two three' });
      const assistantFinal = await service.threadSnapshot(config.threadId);
      expect((assistantFinal as any).streamingMessages).toBeUndefined();
      const thread = assistantFinal.threads.find((item) => item.id === config.threadId) as any;
      expect(thread.messages.map((message: any) => message.role)).toEqual(['user', 'assistant']);
    });
  });

  test('create new thread tool can be enabled for normal assistant threads', async () => {
    await withTempDroneDataDir('assistant-normal-create-new-thread-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});

      const snapshot = await service.createThread({ title: 'normal' });
      const thread = snapshot.threads.find((item) => item.id === snapshot.activeThreadId) as any;
      expect(thread.enabledTools).not.toContain('create_new_thread');

      await service.updateThread(thread.id, { enabledTools: [...thread.enabledTools, 'create_new_thread'] });
      const runtime = await (service as any).runtime();
      const tools = (service as any).buildTools(runtime, thread.id);
      const createNewThread = tools.find((tool: any) => tool.name === 'create_new_thread');
      expect(createNewThread).toBeTruthy();

      const result = await createNewThread.execute('tool_create_new_thread', { title: 'fresh normal' });
      expect(result.details.previousThreadId).toBe(thread.id);
      expect(result.details.threadId).not.toBe(thread.id);
      expect(result.details.thread.title).toBe('fresh normal');
      expect(result.details.thread.voiceEnabled).toBe(false);
    });
  });

  test('routes voice speak replies by queued prompt source instead of latest thread source', async () => {
    await withTempDroneDataDir('assistant-voice-source-routing-', async () => {
      const previousKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key';
      try {
        const firstStarted = deferred();
        const releaseFirst = deferred();
        const spoken: Array<{ text: string; source: string | null }> = [];
        const secondSpoken = deferred();
        const service = new HubAssistantService({
          listDrones: async () => [],
          createDrone: async () => {
            throw new Error('not implemented');
          },
          createChat: async () => {
            throw new Error('not implemented');
          },
          setDroneGroup: async () => {
            throw new Error('not implemented');
          },
          messageDrone: async () => {
            throw new Error('not implemented');
          },
          speak: async ({ text, source }) => {
            spoken.push({ text, source: source ?? null });
            if (text === 'second') secondSpoken.resolve();
            return { ok: true };
          },
        });
        installFakeRuntime(service, {
          onPrompt: async (prompt) => {
            if (prompt === 'speak:first') {
              firstStarted.resolve();
              await releaseFirst.promise;
            }
          },
        });

        await service.ensureLatestVoiceThread();
        await service.submitVoicePrompt({ prompt: 'speak:first', source: 'desktop' });
        await firstStarted.promise;
        await service.submitVoicePrompt({ prompt: 'speak:second', source: 'android' });

        releaseFirst.resolve();
        await secondSpoken.promise;

        expect(spoken).toEqual([
          { text: 'first', source: 'desktop' },
          { text: 'second', source: 'android' },
        ]);
      } finally {
        if (previousKey == null) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previousKey;
      }
    });
  });

  test('defaults new assistant threads to Codex GPT-5.5 instant when Codex is connected', async () => {
    await withTempDroneDataDir('assistant-default-codex-', async (droneDataDir) => {
      const previousCodexAuthFile = process.env.DRONE_HUB_CODEX_AUTH_FILE;
      const authPath = path.join(droneDataDir, 'codex-auth.json');
      fs.writeFileSync(
        authPath,
        JSON.stringify({ tokens: { access_token: 'test-access-token', refresh_token: 'test-refresh-token' }, last_refresh: '2026-05-08T00:00:00.000Z' }),
      );
      process.env.DRONE_HUB_CODEX_AUTH_FILE = authPath;
      try {
        const service = makeService();
        installFakeRuntime(service, {});

        const snapshot = await service.createThread({ title: 'default provider' });
        const thread = snapshot.threads.find((item) => item.id === snapshot.activeThreadId) as any;

        expect(thread.provider).toBe('codex');
        expect(thread.model).toBe('gpt-5.5');
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

  test('runs prompts for different threads independently instead of using one global queue', async () => {
    await withTempDroneDataDir('assistant-thread-isolation-', async () => {
      const previousKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key';
      try {
        const slowStarted = deferred();
        const releaseSlow = deferred();
        const completions: string[] = [];
        const service = makeService();
        installFakeRuntime(service, {
          onPrompt: async (prompt) => {
            if (prompt === 'slow') {
              slowStarted.resolve();
              await releaseSlow.promise;
            }
            completions.push(prompt);
          },
        });

        const first = await service.createThread({ title: 'thread A' });
        const threadA = first.activeThreadId;
        const second = await service.createThread({ title: 'thread B' });
        const threadB = second.activeThreadId;

        const slowRun = service.promptThread(threadB, { prompt: 'slow' });
        await slowStarted.promise;

        await service.promptThread(threadA, { prompt: 'fast' });
        expect(completions).toEqual(['fast']);

        releaseSlow.resolve();
        await slowRun;
        expect(completions).toEqual(['fast', 'slow']);
      } finally {
        if (previousKey == null) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previousKey;
      }
    });
  });

  test('keeps selected next model separate from running and queued prompt models', async () => {
    await withTempDroneDataDir('assistant-thread-model-selection-', async () => {
      const previousKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key';
      try {
        const slowStarted = deferred();
        const releaseSlow = deferred();
        const runs: Array<{ prompt: string; thinkingLevel: string }> = [];
        const service = makeService();
        installFakeRuntime(service, {
          onPrompt: async (prompt, run) => {
            runs.push({ prompt, thinkingLevel: run.thinkingLevel });
            if (prompt === 'slow') {
              slowStarted.resolve();
              await releaseSlow.promise;
            }
          },
        });

        const created = await service.createThread({ title: 'model thread' });
        const threadId = created.activeThreadId;
        await service.updateThread(threadId, { provider: 'openai', model: 'gpt-5.5', thinkingLevel: 'off' });

        const slowRun = service.promptThread(threadId, { prompt: 'slow', deliveryMode: 'queue' });
        await slowStarted.promise;

        await service.promptThread(threadId, { prompt: 'queued-old', deliveryMode: 'queue' });
        await service.updateThread(threadId, { provider: 'openai', model: 'gpt-5.5', thinkingLevel: 'high' });

        let snapshot = await service.snapshot();
        let thread = snapshot.threads.find((item) => item.id === threadId) as any;
        expect(thread.thinkingLevel).toBe('high');
        expect(snapshot.runningModels[threadId]?.thinkingLevel).toBe('off');
        expect(thread.queuedPrompts.find((prompt: any) => prompt.prompt === 'queued-old')?.thinkingLevel).toBe('off');

        releaseSlow.resolve();
        await slowRun;

        snapshot = await service.snapshot();
        thread = snapshot.threads.find((item) => item.id === threadId) as any;
        expect(runs).toEqual([
          { prompt: 'slow', thinkingLevel: 'off' },
          { prompt: 'queued-old', thinkingLevel: 'off' },
        ]);
        expect(thread.thinkingLevel).toBe('high');
        expect(snapshot.runningModels[threadId]).toBeUndefined();
      } finally {
        if (previousKey == null) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previousKey;
      }
    });
  });

  test('offers the same GPT-5.5 assistant model choices for Codex as OpenAI', async () => {
    await withTempDroneDataDir('assistant-codex-model-options-', async () => {
      const service = makeService();
      installFakeRuntime(service, {});

      const snapshot = await service.createThread({ provider: 'codex', title: 'codex models' });
      const thread = snapshot.threads.find((item) => item.id === snapshot.activeThreadId) as any;
      const codexOptions = snapshot.models.filter((option) => option.provider === 'codex');

      expect(thread.model).toBe('gpt-5.5');
      expect(thread.thinkingLevel).toBe('off');
      expect(codexOptions.map((option) => `${option.id}:${option.thinkingLevel}`)).toEqual([
        'gpt-5.5:off',
        'gpt-5.5:low',
        'gpt-5.5:medium',
        'gpt-5.5:high',
      ]);
    });
  });
});
