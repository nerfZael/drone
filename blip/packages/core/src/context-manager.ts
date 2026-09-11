import { CompactionEventObserver } from './CompactionEventObserver.js';
import type {
  AgentMessage,
  AgentTool,
  BeforeModelCallContext,
  BeforeModelCallResult,
  StreamFn,
  ThinkingLevel,
} from '@mariozechner/pi-agent-core/portable';
import {
  estimateContextTokens,
  type ContextTokenEstimate,
  type Model,
  type Message,
} from '@mariozechner/pi-ai/agent-core';
import { createCompaction, prepareCompaction, type CompactionSettings } from './compaction.js';
import { compactionBudget, resolveCompactionSettings } from './compaction-settings.js';
import { modelMessagesFromTranscript } from './model-context.js';
import { readActiveTranscript } from './readActiveTranscript.js';
import { createPortableId } from './platform.js';
import type { SessionRepository } from './session-repository.js';
import type {
  BlipContextUsage,
  BlipRuntimeEvent,
  BlipSessionState,
  TranscriptEntry,
} from './types.js';

type Estimate = (messages: AgentMessage[]) => Promise<ContextTokenEstimate>;
type ContextManagerOptions = {
  state: BlipSessionState;
  repository: SessionRepository;
  model: Model<any>;
  reasoning?: ThinkingLevel;
  settings?: CompactionSettings;
  streamFn?: StreamFn;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  emit: (event: BlipRuntimeEvent) => Promise<void>;
  activeTurnId: () => string | undefined;
  systemPrompt: () => string;
  tools: () => AgentTool<any>[];
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  replaceAgentMessages: (messages: AgentMessage[]) => void;
};

/** One planning, validation, cancellation, and persistence path for every trigger. */
export class BlipContextManager {
  private abortController?: AbortController;

  private readonly observer: CompactionEventObserver;

  constructor(private readonly options: ContextManagerOptions) {
    this.observer = new CompactionEventObserver(options.emit);
  }

  abort(): void {
    this.abortController?.abort();
  }

  async beforeModelCall(
    context: BeforeModelCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeModelCallResult | undefined> {
    const settings = resolveCompactionSettings(this.options.settings);
    if (!Number.isFinite(this.options.model.contextWindow) || this.options.model.contextWindow <= 0)
      return undefined;
    const budget = compactionBudget(this.options.model, settings);
    const before = await context.estimate();
    if (
      context.reason === 'preflight' &&
      (!settings.auto || before.inputTokens <= budget.hardLimit)
    )
      return { maxTokens: budget.outputTokens };
    const messages = await this.runCompaction({
      settings,
      reason: context.reason === 'overflow' ? 'context_overflow' : 'auto',
      estimate: context.estimate,
      before,
      signal,
    });
    if (!messages)
      throw new Error(
        'Compaction could not produce a smaller context within the model budget. Reduce the request, tools, or reserved output.',
      );
    return {
      messages,
      maxTokens: budget.outputTokens,
      replaceContext: true,
      reason: context.reason === 'overflow' ? 'context overflow recovery' : 'automatic compaction',
    };
  }

  async compact(
    settings?: CompactionSettings,
    signal?: AbortSignal,
    trigger: 'manual' | 'auto' = 'manual',
  ): Promise<void> {
    const messages = await this.runCompaction({
      settings: resolveCompactionSettings(settings ?? this.options.settings),
      reason: trigger,
      estimate: (messages) => this.estimate(messages, signal),
      signal,
    });
    if (messages) this.options.replaceAgentMessages(messages);
  }

  async contextUsage(): Promise<BlipContextUsage | undefined> {
    const contextWindow = this.options.model.contextWindow;
    if (!Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;
    const estimate = await this.estimate(
      await this.options.repository.readModelMessages(this.options.state),
    );
    return {
      tokens: estimate.inputTokens,
      contextWindow,
      percent: (estimate.inputTokens / contextWindow) * 100,
      confidence: estimate.confidence,
      breakdown: {
        systemPrompt: estimate.systemPromptTokens,
        messages: estimate.messageTokens,
        toolDefinitions: estimate.toolDefinitionTokens,
        images: estimate.imageTokens,
        providerOverhead: estimate.providerOverheadTokens,
      },
    };
  }

  private async estimate(
    messages: AgentMessage[],
    signal?: AbortSignal,
  ): Promise<ContextTokenEstimate> {
    const transformed = this.options.transformContext
      ? await this.options.transformContext(messages, signal)
      : messages;
    const converted = this.options.convertToLlm
      ? await this.options.convertToLlm(transformed)
      : transformed.filter((message): message is Message =>
          ['user', 'assistant', 'toolResult'].includes(message.role),
        );
    return estimateContextTokens(this.options.model, {
      systemPrompt: this.options.systemPrompt(),
      messages: converted,
      tools: this.options.tools(),
    });
  }

  private async runCompaction(input: {
    settings: Required<CompactionSettings>;
    reason: 'manual' | 'auto' | 'context_overflow';
    estimate: Estimate;
    before?: ContextTokenEstimate;
    signal?: AbortSignal;
  }): Promise<AgentMessage[] | undefined> {
    if (this.abortController) throw new Error('Blip session is already compacting');
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) abort();
    this.abortController = controller;
    const base = {
      version: 1 as const,
      sessionId: this.options.state.id,
      turnId: this.options.activeTurnId() ?? `t_${createPortableId().slice(0, 8)}`,
    };
    const emit = (
      event: Omit<
        Extract<BlipRuntimeEvent, { type: 'compaction_skipped' }>,
        keyof typeof base | 'timestamp' | 'eventId'
      >,
    ) =>
      this.observer.emit({
        ...base,
        timestamp: new Date().toISOString(),
        eventId: createPortableId(),
        ...event,
      });
    try {
      controller.signal.throwIfAborted();
      await this.observer.emit({
        ...base,
        timestamp: new Date().toISOString(),
        eventId: createPortableId(),
        type: 'compaction_started',
        reason: input.reason,
      });
      await this.observer.stage('preparing');
      const entries = await readActiveTranscript(this.options.repository, this.options.state);
      const before = input.before ?? (await input.estimate(modelMessagesFromTranscript(entries)));
      const budget = compactionBudget(this.options.model, input.settings);
      const overhead = await input.estimate([]);
      const settings = { ...input.settings, summaryMaxTokens: budget.summaryTokens };
      let tailBudget = Math.max(
        0,
        Math.min(
          settings.keepRecentTokens,
          budget.targetLimit - overhead.inputTokens - budget.summaryTokens - 32,
        ),
      );
      let plan = prepareCompaction({ session: this.options.state, entries, settings, tailBudget });
      if (!plan) {
        await emit({ type: 'compaction_skipped', reason: 'nothing to compact at a safe boundary' });
        return undefined;
      }
      // Test the retained context with space reserved for the summary BEFORE the
      // model call. Replanning here costs no model calls, even for a long turn.
      const candidateFor = (summary: string) =>
        modelMessagesFromTranscript([
          ...entries,
          {
            type: 'compaction',
            id: 'preview',
            createdAt: new Date().toISOString(),
            trigger: 'auto',
            firstKeptEntryId: plan!.firstKeptEntryId,
            retainedUserEntryId: plan!.retainedUserEntryId,
            summary,
            tokensBefore: before.inputTokens,
            details: plan!.details,
          },
        ]);
      let retained = await input.estimate(candidateFor(''));
      if (retained.inputTokens + budget.summaryTokens > budget.hardLimit && tailBudget > 0) {
        tailBudget = 0;
        plan = prepareCompaction({ session: this.options.state, entries, settings, tailBudget });
        if (!plan) {
          await emit({
            type: 'compaction_skipped',
            reason: 'no complete tool boundary fits the model budget',
          });
          return undefined;
        }
        retained = await input.estimate(candidateFor(''));
      }
      if (retained.inputTokens + budget.summaryTokens > budget.hardLimit) {
        await emit({
          type: 'compaction_skipped',
          reason: 'latest user request and fixed context leave insufficient room for a summary',
        });
        return undefined;
      }
      controller.signal.throwIfAborted();
      await this.observer.stage('credentials');
      const apiKey = await this.options.getApiKey?.(this.options.model.provider);
      await this.observer.stage('summarizing');
      const compaction = await createCompaction({
        session: this.options.state,
        entries,
        plan,
        settings,
        trigger: input.reason === 'manual' ? 'manual' : 'auto',
        model: this.options.model,
        reasoning: this.options.reasoning,
        apiKey,
        streamFn: this.options.streamFn,
        signal: controller.signal,
        onModelCall: this.observer.modelCall,
        onModelActivity: this.observer.modelActivity,
        onUsage: async (response) =>
          this.observer.emit({
            ...base,
            timestamp: new Date().toISOString(),
            eventId: createPortableId(),
            type: 'usage_observed',
            purpose: 'compaction',
            model: response.model,
            provider: response.provider,
            complete: response.stopReason !== 'error' && response.stopReason !== 'aborted',
            usage: response.usage,
          }),
      });
      controller.signal.throwIfAborted();
      if (!compaction) return undefined;
      await this.observer.stage('validating');
      const candidate = modelMessagesFromTranscript([...entries, compaction]);
      const after = await input.estimate(candidate);
      const summaryTokens =
        estimateContextTokens(this.options.model, {
          messages: [{ role: 'user', content: compaction.summary, timestamp: 0 }],
        }).inputTokens - 7;
      const reduction = before.inputTokens - after.inputTokens;
      const failure =
        summaryTokens > budget.summaryTokens
          ? 'summary exceeded its token budget'
          : after.inputTokens > budget.hardLimit
            ? 'candidate still exceeded the safe context limit'
            : reduction < Math.max(1, Math.ceil(before.inputTokens * settings.minimumReduction))
              ? 'candidate did not reduce context enough'
              : undefined;
      if (failure) {
        await emit({ type: 'compaction_skipped', reason: failure });
        return undefined;
      }
      // Abort or a newly appended message must never install a stale checkpoint.
      controller.signal.throwIfAborted();
      const current = await readActiveTranscript(this.options.repository, this.options.state);
      const historyIds = (items: TranscriptEntry[]) =>
        items
          .filter((entry) => entry.type === 'message' || entry.type === 'compaction')
          .map((entry) => entry.id)
          .join('\n');
      if (historyIds(current) !== historyIds(entries))
        throw new Error('Session history changed during compaction; retry when idle');
      controller.signal.throwIfAborted();
      compaction.tokensBefore = before.inputTokens;
      compaction.tokensAfterEstimate = after.inputTokens;
      await this.observer.stage('saving');
      await this.options.repository.appendEntry(this.options.state, compaction);
      this.options.state.compactedSummary = compaction.summary;
      await this.options.repository.save(this.options.state);
      await this.observer.emit({
        ...base,
        timestamp: new Date().toISOString(),
        eventId: createPortableId(),
        type: 'compaction_completed',
        summaryId: compaction.id,
        tokensBefore: before.inputTokens,
        tokensAfter: after.inputTokens,
        fallbackUsed: compaction.fallbackUsed,
        fallbackReason: compaction.fallbackReason,
      });
      return candidate;
    } catch (error) {
      await this.observer
        .fail(controller.signal.aborted || (error instanceof Error && error.name === 'AbortError'))
        .catch(() => undefined);
      if (controller.signal.aborted)
        throw Object.assign(new Error('Compaction was aborted'), {
          name: 'AbortError',
          cause: error,
        });
      throw error;
    } finally {
      input.signal?.removeEventListener('abort', abort);
      if (this.abortController === controller) this.abortController = undefined;
    }
  }
}
