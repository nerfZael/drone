import type { IncomingMessage, ServerResponse } from 'node:http';

import type { PromptAutomationStopMode } from './chat-types';
import { DomainConflictError, InvalidRequestError } from './domain-errors';
import type { PromptAutomationBroadcaster } from './prompt-automation-broadcaster';
import type {
  CancelQueuedPromptAutomationStatus,
  PromptAutomationJobConfig,
  PromptAutomationLaneState,
  PromptAutomationManager,
} from './prompt-automation-manager';
import {
  promptAutomationQueueParamsSchema,
  promptAutomationStartBodySchema,
  promptAutomationStopBodySchema,
} from './prompt-automation-schemas';
import { parseRequestSchema } from './request-schema';

export interface PromptAutomationStartRequest {
  droneId: string;
  chatName: string;
  automationId: string;
  automationLabel: string;
  prompt: string;
  onFailurePrompt: string;
  runs: number;
  sleepBetweenRunsSeconds: number;
  stopPhrase: string;
  stopPhraseCaseSensitive: boolean;
}

export interface PromptAutomationServiceDependencies {
  manager: PromptAutomationManager;
  events: Pick<PromptAutomationBroadcaster, 'subscribe'>;
  normalizeDroneId(raw: string): string;
  normalizeChatName(raw: string): string;
  normalizeOnFailurePrompt(raw: unknown): string;
  normalizeRuns(raw: unknown): number;
  normalizeSleepBetweenRunsSecondsFromBody(raw: unknown): number;
  normalizeStopPhrase(raw: unknown): string;
  normalizeStopPhraseCaseSensitive(raw: unknown): boolean;
  ensureChatEntry(opts: { droneId: string; chatName: string }): Promise<unknown>;
  getChatEntry(opts: { droneId: string; chatName: string }): Promise<{ d: any; chat: any }>;
  inferChatAgent(chat: any, drone: any): { kind: string } | null;
  recoverStalledLane(lane: PromptAutomationLaneState | null | undefined): Promise<void>;
  activePendingPromptIds(opts: {
    droneId: string;
    chatName: string;
    jobKey?: string | null;
  }): Promise<string[]>;
}

export class PromptAutomationService {
  constructor(private readonly deps: PromptAutomationServiceDependencies) {}

  parseStartRequest(
    droneIdRaw: string,
    chatNameRaw: string,
    bodyRaw: unknown,
  ): PromptAutomationStartRequest {
    const body = parseRequestSchema(promptAutomationStartBodySchema, bodyRaw, 'automation body');
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw);
    const automationId = body.automationId;
    return {
      droneId,
      chatName,
      automationId,
      automationLabel: body.automationLabel || automationId || 'Automation',
      prompt: body.prompt,
      onFailurePrompt: this.deps.normalizeOnFailurePrompt(body.onFailurePrompt),
      runs: this.deps.normalizeRuns(body.runs),
      sleepBetweenRunsSeconds: this.deps.normalizeSleepBetweenRunsSecondsFromBody(body),
      stopPhrase: this.deps.normalizeStopPhrase(body.stopPhrase),
      stopPhraseCaseSensitive: this.deps.normalizeStopPhraseCaseSensitive(
        body.stopPhraseCaseSensitive,
      ),
    };
  }

  parseStopRequest(bodyRaw: unknown): {
    stopMode: PromptAutomationStopMode;
    clearQueued: boolean;
  } {
    const body = parseRequestSchema(
      promptAutomationStopBodySchema,
      bodyRaw ?? {},
      'automation body',
    );
    return {
      stopMode: body.stopMode === 'runs-only' || body.mode === 'runs-only' ? 'runs-only' : 'all',
      clearQueued: body.clearQueued !== false,
    };
  }

  async start(opts: PromptAutomationStartRequest): Promise<PromptAutomationLaneState> {
    if (!opts.droneId) throw new InvalidRequestError('missing drone id');
    if (!opts.automationId) throw new InvalidRequestError('missing automation id');
    if (!opts.prompt) throw new InvalidRequestError('missing prompt');

    await this.deps.ensureChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
    const { d, chat } = await this.deps.getChatEntry({
      droneId: opts.droneId,
      chatName: opts.chatName,
    });
    const agent = this.deps.inferChatAgent(chat, d);
    if (agent?.kind !== 'builtin' && agent?.kind !== 'native') {
      throw new DomainConflictError('automation requires Built-in or a transcript agent');
    }

    const lane = this.deps.manager.ensure(opts.droneId, opts.chatName);
    const config: PromptAutomationJobConfig = {
      automationId: opts.automationId,
      automationLabel: opts.automationLabel,
      prompt: opts.prompt,
      onFailurePrompt: opts.onFailurePrompt,
      runsTotal: opts.runs,
      sleepBetweenRunsSeconds: opts.sleepBetweenRunsSeconds,
      stopPhrase: opts.stopPhrase,
      stopPhraseCaseSensitive: opts.stopPhraseCaseSensitive,
    };
    this.deps.manager.start(lane, config);
    return lane;
  }

  async status(droneId: string, chatName: string): Promise<PromptAutomationLaneState | null> {
    let lane = this.deps.manager.get(droneId, chatName);
    await this.deps.recoverStalledLane(lane);
    lane = this.deps.manager.get(droneId, chatName);
    return lane;
  }

  getLane(droneId: string, chatName: string): PromptAutomationLaneState | null {
    return this.deps.manager.get(droneId, chatName);
  }

  response(lane: PromptAutomationLaneState | null) {
    return this.deps.manager.response(lane);
  }

  stop(opts: {
    droneId: string;
    chatName: string;
    stopMode?: PromptAutomationStopMode;
    clearQueued?: boolean;
  }): PromptAutomationLaneState | null {
    return this.deps.manager.stop(opts);
  }

  cancelQueued(opts: { droneId: string; chatName: string; queueId: string }): {
    lane: PromptAutomationLaneState | null;
    status: CancelQueuedPromptAutomationStatus;
  } {
    const parsed = parseRequestSchema(promptAutomationQueueParamsSchema, opts, 'automation queue');
    return this.deps.manager.cancelQueued(parsed);
  }

  activePendingPromptIds(opts: {
    droneId: string;
    chatName: string;
    jobKey?: string | null;
  }): Promise<string[]> {
    return this.deps.activePendingPromptIds(opts);
  }

  subscribe(opts: {
    req: IncomingMessage;
    res: ServerResponse;
    droneId: string;
    chatName: string;
    name: string;
  }): void {
    this.deps.events.subscribe(opts);
  }
}
