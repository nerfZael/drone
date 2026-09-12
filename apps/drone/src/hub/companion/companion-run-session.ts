import crypto from 'node:crypto';
import type {
  CompanionClientTelemetry,
  CompanionProposalApplyResult,
  CompanionRunEvent,
} from '@drone/assistant-chat';

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
  kind: 'prompt';
  messageId: string;
  receivedAtEpochMs: number;
  receivedAtMonotonicMs: number;
};

type BufferedCompanionProposalResult = {
  kind: 'proposal_result';
  messageId: string;
  result: CompanionProposalApplyResult;
  receivedAtEpochMs: number;
  receivedAtMonotonicMs: number;
};

type BufferedCompanionWork = BufferedCompanionPrompt | BufferedCompanionProposalResult;

type CompanionRunSessionEvent =
  | (Exclude<CompanionRunEvent, { type: 'subscriptions' }> & { messageId: string })
  | Extract<CompanionRunEvent, { type: 'subscriptions' }>;

type CompanionRunSessionOptions = {
  clientRunId: string;
  runtimeRunId: string;
  transport: CompanionTelemetryTransport;
  runtime: Pick<CompanionRuntime, 'run' | 'steer' | 'deleteSession'> & Partial<
    Pick<CompanionRuntime, 'connectSubscriptions' | 'resumeWithProposalResult'>
  >;
  emit(event: CompanionRunSessionEvent): void | Promise<void>;
  isAvailable(): boolean;
  unavailableMessage: string;
  onClose(): void;
};

export class CompanionRunSession {
  readonly clientRunId: string;

  private readonly workQueue: BufferedCompanionWork[] = [];
  private readonly browserTools: CompanionBrowserToolBroker;
  private generation = 0;
  private activeMessageId = '';
  private active = false;
  private closed = false;
  private readonly subscriptionDeliveries = new Map<string, Promise<void>>();
  private readonly proposalResultMessageIds = new Set<string>();

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
    let lastSubscriptions = '';
    options.runtime.connectSubscriptions?.(options.runtimeRunId, (input) => this.deliverSubscription(input),
      (subscriptions) => {
        const snapshot = JSON.stringify(subscriptions);
        if (snapshot === lastSubscriptions) return;
        lastSubscriptions = snapshot;
        void Promise.resolve().then(() => {
          if (!this.closed && options.isAvailable()) return options.emit({ type: 'subscriptions', subscriptions });
        }).catch(() => undefined);
      });
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
      kind: 'prompt' as const,
      messageId: prompt.messageId || crypto.randomUUID(),
      receivedAtEpochMs: Date.now(),
      receivedAtMonotonicMs: performance.now(),
    };
    if (this.active) {
      this.workQueue.push(queued);
      this.flushSteering();
      return;
    }

    this.active = true;
    try {
      await this.beginWork(queued);
    } catch (error) {
      await this.close(this.options.unavailableMessage).catch(() => undefined);
      throw error;
    }
    void this.drain(queued);
  }

  async submitProposalResult(input: {
    messageId?: string;
    result: CompanionProposalApplyResult;
  }): Promise<void> {
    if (this.closed) throw new Error(this.options.unavailableMessage);
    if (input.messageId && this.proposalResultMessageIds.has(input.messageId)) return;
    const queued: BufferedCompanionProposalResult = {
      kind: 'proposal_result',
      messageId: input.messageId || crypto.randomUUID(),
      result: input.result,
      receivedAtEpochMs: Date.now(),
      receivedAtMonotonicMs: performance.now(),
    };
    this.proposalResultMessageIds.add(queued.messageId);
    if (this.active) {
      this.workQueue.push(queued);
      return;
    }
    this.active = true;
    try {
      await this.beginWork(queued);
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
    this.workQueue.length = 0;
    this.subscriptionDeliveries.clear();
    this.proposalResultMessageIds.clear();
    this.activeMessageId = '';
    this.browserTools.rejectAll(message);
    this.options.onClose();
    await this.options.runtime.deleteSession(this.options.runtimeRunId);
  }

  private async drain(queued: BufferedCompanionWork): Promise<void> {
    try {
      while (this.isAvailable()) {
        const { messageId } = queued;
        const runGeneration = this.generation;
        const callBrowser: CompanionBrowserCall = (tool, args, signal) => {
          if (!this.isCurrentGeneration(runGeneration)) {
            return Promise.reject(new Error('Companion run is no longer active'));
          }
          return this.browserTools.request(tool, args, runGeneration, signal);
        };

        try {
          const onEvent = (event: Parameters<Parameters<CompanionRuntime['run']>[0]['onEvent']>[0]) => {
            if (!this.isCurrentGeneration(runGeneration)) return;
            this.flushSteering();
            if (!this.isCurrentGeneration(runGeneration)) return;
            const visibleEvent = boundedCompanionActivityEvent(event);
            if (!visibleEvent) return;
            void Promise.resolve(
              this.options.emit({ type: 'activity', messageId: this.activeMessageId, event: visibleEvent }),
            ).catch(() => undefined);
          };
          const reply = queued.kind === 'prompt'
            ? await this.options.runtime.run({
                runId: this.options.runtimeRunId,
                messageId,
                prompt: queued.prompt,
                transport: this.options.transport,
                queueWaitMs: performance.now() - queued.receivedAtMonotonicMs,
                receivedAtEpochMs: queued.receivedAtEpochMs,
                receivedAtMonotonicMs: queued.receivedAtMonotonicMs,
                clientTelemetry: queued.telemetry,
                callBrowser,
                onEvent,
              })
            : await (() => {
                const resume = this.options.runtime.resumeWithProposalResult;
                if (!resume) throw new Error('Companion proposal continuation is unavailable');
                return resume.call(this.options.runtime, {
                  runId: this.options.runtimeRunId,
                  messageId,
                  result: queued.result,
                  transport: this.options.transport,
                  queueWaitMs: performance.now() - queued.receivedAtMonotonicMs,
                  receivedAtEpochMs: queued.receivedAtEpochMs,
                  receivedAtMonotonicMs: queued.receivedAtMonotonicMs,
                  callBrowser,
                  onEvent,
                });
              })();
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
        const next = this.workQueue.shift();
        if (!next) break;
        await this.beginWork(next);
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
    for (let index = 0; index < this.workQueue.length;) {
      const next = this.workQueue[index];
      if (next.kind !== 'prompt') {
        // Host action results preserve arrival order and must reach the model
        // before any later user prompt is steered into the active request.
        break;
      }
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
      this.workQueue.splice(index, 1);
      const afterMessageId = this.activeMessageId;
      this.activeMessageId = next.messageId;
      if (next.subscriptionDeliveryMode) {
        void Promise.resolve(this.options.emit({ type: 'subscription', messageId: next.messageId, afterMessageId }))
          .catch(() => this.close(this.options.unavailableMessage));
      }
      // Keep the generation: a browser tool already in flight must retain its result.
    }
  }

  private async beginWork(prompt: BufferedCompanionWork): Promise<void> {
    this.generation += 1;
    this.activeMessageId = prompt.messageId;
    if (prompt.kind === 'prompt' && prompt.subscriptionDeliveryMode) {
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
