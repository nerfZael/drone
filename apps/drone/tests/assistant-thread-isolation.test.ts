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
    onPrompt?: (prompt: string) => Promise<void> | void;
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
    private subscribers: Array<(event: any) => Promise<void> | void> = [];

    constructor(opts: any) {
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
      await handlers.onPrompt?.(prompt);
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
    getModel: () => ({ reasoning: false }),
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
});
