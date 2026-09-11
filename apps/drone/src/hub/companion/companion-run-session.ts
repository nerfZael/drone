import crypto from 'node:crypto';
import type { CompanionClientTelemetry, CompanionRunEvent } from '@drone/assistant-chat';

import type { CompanionBrowserCall, CompanionRuntime } from './companion-runtime';
import type { CompanionTelemetryTransport } from './companion-telemetry';
import type { SessionSubscriptionDelivery } from '../subscriptions/resource-subscription-service';
import {
  boundedCompanionActivityEvent,
  CompanionBrowserToolBroker,
} from './companion-transport-shared';

type CompanionPromptInput = {
  prompt: string;
  messageId?: string;
  telemetry?: CompanionClientTelemetry;
  subscriptionDeliveryMode?: 'queue' | 'asap';
};

type BufferedCompanionPrompt = CompanionPromptInput & {
  messageId: string;
  receivedAtEpochMs: number;
  receivedAtMonotonicMs: number;
};

type CompanionRunSessionEvent = CompanionRunEvent & { messageId: string };

type CompanionRunSessionOptions = {
  clientRunId: string;
  runtimeRunId: string;
  transport: CompanionTelemetryTransport;
  runtime: Pick<CompanionRuntime, 'run' | 'steer' | 'deleteSession'> & Partial<Pick<CompanionRuntime, 'connectSubscriptions'>>;
  emit(event: CompanionRunSessionEvent): void | Promise<void>;
  isAvailable(): boolean;
  unavailableMessage: string;
  onClose(): void;
};

export class CompanionRunSession {
  readonly clientRunId: string;

  private readonly prompts: BufferedCompanionPrompt[] = [];
  private readonly browserTools: CompanionBrowserToolBroker;
  private generation = 0;
  private activeMessageId = '';
  private active = false;
  private closed = false;
  private readonly subscriptionDeliveries = new Map<string, Promise<void>>();

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
    options.runtime.connectSubscriptions?.(options.runtimeRunId, (input) => this.deliverSubscription(input));
  }

  private async deliverSubscription(input: SessionSubscriptionDelivery): Promise<void> {
    if (!this.isAvailable()) throw new Error(this.options.unavailableMessage);
    const existing = this.subscriptionDeliveries.get(input.messageId);
    if (existing) return existing;
    const delivery = Promise.resolve()
      .then(() => this.submit({ ...input, subscriptionDeliveryMode: input.deliveryMode }))
      .catch((error) => {
        this.subscriptionDeliveries.delete(input.messageId);
        throw error;
      });
    this.subscriptionDeliveries.set(input.messageId, delivery);
    return delivery;
  }

  async submit(prompt: CompanionPromptInput): Promise<void> {
    if (this.closed) throw new Error(this.options.unavailableMessage);
    const queued = {
      ...prompt,
      messageId: prompt.messageId || crypto.randomUUID(),
      receivedAtEpochMs: Date.now(),
      receivedAtMonotonicMs: performance.now(),
    };
    if (this.active) {
      this.prompts.push(queued);
      this.flushSteering();
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
    this.subscriptionDeliveries.clear();
    this.activeMessageId = '';
    this.browserTools.rejectAll(message);
    this.options.onClose();
    await this.options.runtime.deleteSession(this.options.runtimeRunId);
  }

  private async drain(queued: BufferedCompanionPrompt): Promise<void> {
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
              this.flushSteering();
              if (!this.isCurrentGeneration(runGeneration)) return;
              const visibleEvent = boundedCompanionActivityEvent(event);
              if (!visibleEvent) return;
              void Promise.resolve(
                this.options.emit({ type: 'activity', messageId: this.activeMessageId, event: visibleEvent }),
              ).catch(() => undefined);
            },
          });
          if (!this.isCurrentGeneration(runGeneration)) return;
          const replyMessageId = this.activeMessageId;
          await this.options.emit({ type: 'reply', messageId: replyMessageId, reply });
          if (!this.isCurrentGeneration(runGeneration)) return;
          await this.options.emit({ type: 'status', messageId: replyMessageId, status: 'completed' });
        } catch (error) {
          if (!this.isCurrentGeneration(runGeneration)) return;
          await this.options.emit({
            type: 'error',
            messageId: this.activeMessageId,
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

  private flushSteering(): void {
    if (!this.isAvailable()) return;
    // The runtime uses the delivery setting captured for this run. Queue mode
    // keeps follow-ups buffered; ASAP flushes them once the agent can accept steering.
    for (let index = 0; index < this.prompts.length;) {
      const next = this.prompts[index];
      try {
        if (next.subscriptionDeliveryMode === 'queue' ||
          !this.options.runtime.steer(this.options.runtimeRunId, next.prompt, next.subscriptionDeliveryMode)) {
          index += 1;
          continue;
        }
      } catch (error) {
        void Promise.resolve().then(() => this.options.emit({
          type: 'error', messageId: next.messageId,
          error: error instanceof Error ? error.message : String(error),
        })).catch(() => undefined);
        void this.close('Companion steering failed').catch(() => undefined);
        return;
      }
      this.prompts.splice(index, 1);
      const afterMessageId = this.activeMessageId;
      this.activeMessageId = next.messageId;
      if (next.subscriptionDeliveryMode) {
        void Promise.resolve(this.options.emit({ type: 'subscription', messageId: next.messageId, afterMessageId }))
          .catch(() => this.close(this.options.unavailableMessage));
      }
      // Keep the generation: a browser tool already in flight must retain its result.
    }
  }

  private async beginPrompt(prompt: BufferedCompanionPrompt): Promise<void> {
    this.generation += 1;
    this.activeMessageId = prompt.messageId;
    if (prompt.subscriptionDeliveryMode) {
      await this.options.emit({ type: 'subscription', messageId: prompt.messageId });
      if (!this.isAvailable()) throw new Error(this.options.unavailableMessage);
    }
    await this.options.emit({ type: 'status', messageId: prompt.messageId, status: 'working' });
  }

  private isAvailable(): boolean {
    return !this.closed && this.options.isAvailable();
  }

  private isCurrentGeneration(generation: number): boolean {
    return this.isAvailable() && this.generation === generation;
  }
}
