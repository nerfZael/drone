import type {
  AgentMessage,
  AgentTool,
  BeforeModelCallContext,
  BeforeModelCallResult,
  StreamFn,
  ThinkingLevel,
} from '@mariozechner/pi-agent-core/portable';
import { estimateContextTokens, type Model } from '@mariozechner/pi-ai/agent-core';
import {
  createCompaction,
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionSettings,
} from './compaction.js';
import { modelMessagesFromTranscript } from './model-context.js';
import { createPortableId } from './platform.js';
import type { SessionRepository } from './session-repository.js';
import type { BlipContextUsage, BlipRuntimeEvent, BlipSessionState } from './types.js';

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
  replaceAgentMessages: (messages: AgentMessage[]) => void;
};

function nowIso(): string {
  return new Date().toISOString();
}

function eventBase(
  sessionId: string,
  turnId?: string,
): Pick<BlipRuntimeEvent, 'version' | 'eventId' | 'sessionId' | 'timestamp'> & {
  turnId?: string;
} {
  return {
    version: 1,
    eventId: createPortableId(),
    sessionId,
    timestamp: nowIso(),
    ...(turnId ? { turnId } : {}),
  };
}

/**
 * Owns durable model-context management for one Blip session.
 *
 * The generic agent loop decides when preflight runs. This class decides when
 * Blip must compact, persists the selected boundary, and exposes request-level
 * accounting without coupling those concerns to the session lifecycle.
 */
export class BlipContextManager {
  private abortController?: AbortController;

  constructor(private readonly options: ContextManagerOptions) {}

  get running(): boolean {
    return this.abortController !== undefined;
  }

  abort(): void {
    this.abortController?.abort();
  }

  async beforeModelCall(
    context: BeforeModelCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeModelCallResult | undefined> {
    const settings = this.options.settings ?? DEFAULT_COMPACTION_SETTINGS;
    const estimate = await context.estimate();
    const contextWindow = this.options.model.contextWindow;
    if (!contextWindow || contextWindow <= 0) return undefined;
    const hardLimit = Math.max(1, contextWindow - settings.reserveTokens);
    if (context.reason === 'preflight' && (!settings.auto || estimate.inputTokens <= hardLimit)) {
      return undefined;
    }

    const replacement = await this.compactForModelCall(context, settings, signal);
    if (!replacement) {
      if (context.reason === 'overflow') {
        throw new Error('Model context overflowed, but no safe compaction boundary was available');
      }
      return undefined;
    }
    return {
      messages: replacement,
      replaceContext: true,
      reason: context.reason === 'overflow' ? 'context overflow recovery' : 'automatic compaction',
    };
  }

  async compact(settings?: CompactionSettings): Promise<void> {
    if (this.abortController) throw new Error('Blip session is already compacting');
    const abortController = new AbortController();
    this.abortController = abortController;
    try {
      await this.performManualCompaction(
        settings ?? this.options.settings ?? DEFAULT_COMPACTION_SETTINGS,
        abortController.signal,
      );
    } catch (error) {
      if (abortController.signal.aborted) {
        throw Object.assign(new Error('Compaction was aborted'), {
          name: 'AbortError',
          cause: error,
        });
      }
      throw error;
    } finally {
      if (this.abortController === abortController) this.abortController = undefined;
    }
  }

  async contextUsage(): Promise<BlipContextUsage | undefined> {
    const contextWindow = this.options.model.contextWindow;
    if (!contextWindow || contextWindow <= 0) return undefined;
    const estimate = estimateContextTokens(this.options.model, {
      systemPrompt: this.options.systemPrompt(),
      messages: await this.options.repository.readModelMessages(this.options.state),
      tools: this.options.tools(),
    });
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

  private async compactForModelCall(
    context: BeforeModelCallContext,
    settings: CompactionSettings,
    signal?: AbortSignal,
  ): Promise<AgentMessage[] | undefined> {
    if (this.abortController) throw new Error('Blip session is already compacting');
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.abortController = abortController;
    try {
      const entries = await this.options.repository.readTranscript(this.options.state);
      const turnId = this.options.activeTurnId() ?? `t_${createPortableId().slice(0, 8)}`;
      await this.options.emit({
        ...eventBase(this.options.state.id, turnId),
        type: 'compaction_started',
        reason: context.reason === 'overflow' ? 'context_overflow' : 'auto',
      });
      const apiKey = await this.options.getApiKey?.(this.options.model.provider);
      let compaction = await createCompaction({
        session: this.options.state,
        entries,
        trigger: 'auto',
        settings,
        model: this.options.model,
        reasoning: this.options.reasoning,
        apiKey,
        streamFn: this.options.streamFn,
        signal: abortController.signal,
      });
      if (!compaction) {
        compaction = await this.createEmergencyCompaction(
          entries,
          settings,
          apiKey,
          abortController.signal,
        );
        if (!compaction) {
          await this.options.emit({
            ...eventBase(this.options.state.id, turnId),
            type: 'compaction_skipped',
            reason: 'nothing to compact yet',
          });
          return undefined;
        }
      }

      const before = await context.estimate();
      let candidate = modelMessagesFromTranscript([...entries, compaction]);
      let after = await context.estimate(candidate);
      const hardLimit = Math.max(1, this.options.model.contextWindow - settings.reserveTokens);
      let materiallySmaller = after.inputTokens < before.inputTokens;
      let safe = after.inputTokens <= hardLimit;
      if (!materiallySmaller || !safe) {
        const emergency = await this.createEmergencyCompaction(
          entries,
          settings,
          apiKey,
          abortController.signal,
        );
        if (emergency) {
          const emergencyCandidate = modelMessagesFromTranscript([...entries, emergency]);
          const emergencyEstimate = await context.estimate(emergencyCandidate);
          if (
            emergencyEstimate.inputTokens < before.inputTokens &&
            emergencyEstimate.inputTokens <= hardLimit
          ) {
            compaction = emergency;
            candidate = emergencyCandidate;
            after = emergencyEstimate;
            materiallySmaller = true;
            safe = true;
          }
        }
      }
      if (!materiallySmaller || !safe) {
        const reason = !materiallySmaller
          ? 'candidate context was not smaller'
          : `candidate still exceeded safe limit (${after.inputTokens} > ${hardLimit})`;
        await this.options.emit({
          ...eventBase(this.options.state.id, turnId),
          type: 'compaction_skipped',
          reason,
        });
        if (context.reason === 'overflow') throw new Error(`Compaction failed: ${reason}`);
        return undefined;
      }

      compaction.tokensBefore = before.inputTokens;
      compaction.tokensAfterEstimate = after.inputTokens;
      await this.persistCompaction(compaction);
      await this.options.emit({
        ...eventBase(this.options.state.id, turnId),
        type: 'compaction_completed',
        summaryId: compaction.id,
        tokensBefore: before.inputTokens,
        tokensAfter: after.inputTokens,
        fallbackUsed: compaction.fallbackUsed,
        fallbackReason: compaction.fallbackReason,
      });
      return candidate;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.abortController === abortController) this.abortController = undefined;
    }
  }

  private createEmergencyCompaction(
    entries: Awaited<ReturnType<SessionRepository['readTranscript']>>,
    settings: CompactionSettings,
    apiKey: string | undefined,
    signal: AbortSignal,
  ) {
    return createCompaction({
      session: this.options.state,
      entries,
      trigger: 'auto',
      settings: { ...settings, keepRecentTokens: 0, keepRecentTurns: 0 },
      model: this.options.model,
      reasoning: this.options.reasoning,
      apiKey,
      streamFn: this.options.streamFn,
      signal,
    });
  }

  private async performManualCompaction(
    settings: CompactionSettings,
    signal: AbortSignal,
  ): Promise<void> {
    const entries = await this.options.repository.readTranscript(this.options.state);
    const turnId = `t_${createPortableId().slice(0, 8)}`;
    await this.options.emit({
      ...eventBase(this.options.state.id, turnId),
      type: 'compaction_started',
      reason: 'manual',
    });
    const compaction = await createCompaction({
      session: this.options.state,
      entries,
      trigger: 'manual',
      settings,
      model: this.options.model,
      reasoning: this.options.reasoning,
      apiKey: await this.options.getApiKey?.(this.options.model.provider),
      streamFn: this.options.streamFn,
      signal,
    });
    if (signal.aborted) {
      throw Object.assign(new Error('Compaction was aborted'), { name: 'AbortError' });
    }
    if (!compaction) {
      await this.options.emit({
        ...eventBase(this.options.state.id, turnId),
        type: 'compaction_skipped',
        reason: 'nothing to compact yet',
      });
      return;
    }
    await this.persistCompaction(compaction);
    const messages = await this.options.repository.readModelMessages(this.options.state);
    this.options.replaceAgentMessages(messages);
    await this.options.emit({
      ...eventBase(this.options.state.id, turnId),
      type: 'compaction_completed',
      summaryId: compaction.id,
      tokensBefore: compaction.tokensBefore,
      tokensAfter: compaction.tokensAfterEstimate ?? 0,
      fallbackUsed: compaction.fallbackUsed,
      fallbackReason: compaction.fallbackReason,
    });
  }

  private async persistCompaction(
    compaction: Extract<Awaited<ReturnType<typeof createCompaction>>, { type: 'compaction' }>,
  ): Promise<void> {
    await this.options.repository.appendEntry(this.options.state, compaction);
    this.options.state.compactedSummary = compaction.summary;
    await this.options.repository.save(this.options.state);
  }
}
