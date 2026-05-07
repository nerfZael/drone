import { describe, expect, test } from 'bun:test';
import { HubAssistantService } from '../src/hub/assistant';
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
    setDroneGroup: async () => {
      throw new Error('not implemented');
    },
    messageDrone: async () => {
      throw new Error('not implemented');
    },
  });
}

describe('assistant thread isolation', () => {
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
});
