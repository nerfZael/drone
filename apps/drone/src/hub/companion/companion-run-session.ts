import crypto from 'node:crypto';
import type { CompanionClientTelemetry, CompanionRunEvent } from '@drone/assistant-chat';

import type { CompanionBrowserCall, CompanionRuntime } from './companion-runtime';
import type { CompanionTelemetryTransport } from './companion-telemetry';
import {
  boundedCompanionActivityEvent,
  CompanionBrowserToolBroker,
} from './companion-transport-shared';

type CompanionPromptInput = {
  prompt: string;
  messageId?: string;
  telemetry?: CompanionClientTelemetry;
};

type QueuedCompanionPrompt = CompanionPromptInput & {
  messageId: string;
  receivedAtEpochMs: number;
  receivedAtMonotonicMs: number;
};

type CompanionRunSessionEvent = CompanionRunEvent & { messageId: string };

type CompanionRunSessionOptions = {
  clientRunId: string;
  runtimeRunId: string;
  transport: CompanionTelemetryTransport;
  runtime: Pick<CompanionRuntime, 'run' | 'deleteSession'>;
  emit(event: CompanionRunSessionEvent): void | Promise<void>;
  isAvailable(): boolean;
  unavailableMessage: string;
  onClose(): void;
};

export class CompanionRunSession {
  readonly clientRunId: string;

  private readonly prompts: QueuedCompanionPrompt[] = [];
  private readonly browserTools: CompanionBrowserToolBroker;
  private generation = 0;
  private activeMessageId = '';
  private active = false;
  private closed = false;

  constructor(private readonly options: CompanionRunSessionOptions) {
    this.clientRunId = options.clientRunId;
    this.browserTools = new CompanionBrowserToolBroker({
      available: () => this.isCurrentGeneration(this.generation) && Boolean(this.activeMessageId),
      unavailableMessage: options.unavailableMessage,
      dispatch: (call) =>
        this.options.emit({
          type: 'tool_call',
          messageId: this.activeMessageId,
          ...call,
        }),
    });
  }

  async enqueue(prompt: CompanionPromptInput): Promise<void> {
    if (this.closed) throw new Error(this.options.unavailableMessage);
    const queued = {
      ...prompt,
      messageId: prompt.messageId || crypto.randomUUID(),
      receivedAtEpochMs: Date.now(),
      receivedAtMonotonicMs: performance.now(),
    };
    if (this.active) {
      this.prompts.push(queued);
      return;
    }

    this.active = true;
    try {
      await this.beginPrompt(queued);
    } catch (error) {
      await this.close(this.options.unavailableMessage).catch(() => undefined);
      throw error;
    }
    void this.drain(queued);
  }

  resolveBrowserTool(input: {
    callId: string;
    generation: number;
    ok: boolean;
    result?: unknown;
    error?: unknown;
  }): boolean {
    if (!this.isCurrentGeneration(input.generation)) return false;
    return this.browserTools.resolve(input);
  }

  async close(message: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    this.prompts.length = 0;
    this.activeMessageId = '';
    this.browserTools.rejectAll(message);
    this.options.onClose();
    await this.options.runtime.deleteSession(this.options.runtimeRunId);
  }

  private async drain(queued: QueuedCompanionPrompt): Promise<void> {
    try {
      while (this.isAvailable()) {
        const { prompt, messageId } = queued;
        const runGeneration = this.generation;
        const callBrowser: CompanionBrowserCall = (tool, args, signal) => {
          if (!this.isCurrentGeneration(runGeneration)) {
            return Promise.reject(new Error('Companion run is no longer active'));
          }
          return this.browserTools.request(tool, args, runGeneration, signal);
        };

        try {
          const reply = await this.options.runtime.run({
            runId: this.options.runtimeRunId,
            messageId,
            prompt,
            transport: this.options.transport,
            queueWaitMs: performance.now() - queued.receivedAtMonotonicMs,
            receivedAtEpochMs: queued.receivedAtEpochMs,
            receivedAtMonotonicMs: queued.receivedAtMonotonicMs,
            clientTelemetry: queued.telemetry,
            callBrowser,
            onEvent: (event) => {
              if (!this.isCurrentGeneration(runGeneration)) return;
              const visibleEvent = boundedCompanionActivityEvent(event);
              if (!visibleEvent) return;
              void Promise.resolve(
                this.options.emit({ type: 'activity', messageId, event: visibleEvent }),
              ).catch(() => undefined);
            },
          });
          if (!this.isCurrentGeneration(runGeneration)) return;
          await this.options.emit({ type: 'reply', messageId, reply });
          if (!this.isCurrentGeneration(runGeneration)) return;
          await this.options.emit({ type: 'status', messageId, status: 'completed' });
        } catch (error) {
          if (!this.isCurrentGeneration(runGeneration)) return;
          await this.options.emit({
            type: 'error',
            messageId,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          if (this.generation === runGeneration) {
            this.browserTools.rejectAll('Companion run finished');
            this.activeMessageId = '';
          }
        }
        const next = this.prompts.shift();
        if (!next) break;
        await this.beginPrompt(next);
        queued = next;
      }
    } catch {
      await this.close(this.options.unavailableMessage).catch(() => undefined);
    } finally {
      this.active = false;
    }
  }

  private async beginPrompt(prompt: QueuedCompanionPrompt): Promise<void> {
    this.generation += 1;
    this.activeMessageId = prompt.messageId;
    await this.options.emit({ type: 'status', messageId: prompt.messageId, status: 'working' });
  }

  private isAvailable(): boolean {
    return !this.closed && this.options.isAvailable();
  }

  private isCurrentGeneration(generation: number): boolean {
    return this.isAvailable() && this.generation === generation;
  }
}
