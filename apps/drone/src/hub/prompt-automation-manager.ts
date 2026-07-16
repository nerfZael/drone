import crypto from 'node:crypto';

import type { PromptAutomationStopMode } from './chat-types';

export type PromptAutomationJobStatus = 'running' | 'completed' | 'failed' | 'stopped';

export interface PromptAutomationJobState {
  key: string;
  executionKey: string;
  queuedFromId?: string | null;
  droneId: string;
  chatName: string;
  automationId: string;
  automationLabel: string;
  prompt: string;
  onFailurePrompt: string;
  runsTotal: number;
  sleepBetweenRunsSeconds: number;
  stopPhrase: string;
  stopPhraseCaseSensitive: boolean;
  runsCompleted: number;
  finishedEarly: boolean;
  finishedEarlyReason: string | null;
  finishedEarlyRunIndex: number | null;
  status: PromptAutomationJobStatus;
  startedAt: string;
  updatedAt: string;
  lastPromptId: string | null;
  error: string | null;
  stopMode: PromptAutomationStopMode | null;
  abortController: AbortController | null;
  task: Promise<void> | null;
}

export interface PromptAutomationQueueEntry {
  queueId: string;
  automationId: string;
  automationLabel: string;
  prompt: string;
  onFailurePrompt: string;
  runsTotal: number;
  sleepBetweenRunsSeconds: number;
  stopPhrase: string;
  stopPhraseCaseSensitive: boolean;
  enqueuedAt: string;
}

export interface PromptAutomationLaneState {
  key: string;
  droneId: string;
  chatName: string;
  runningJob: PromptAutomationJobState | null;
  queued: PromptAutomationQueueEntry[];
  lastJob: PromptAutomationJobState | null;
  updatedAt: string;
}

export interface PromptAutomationJobConfig {
  automationId: string;
  automationLabel: string;
  prompt: string;
  onFailurePrompt: string;
  runsTotal: number;
  sleepBetweenRunsSeconds: number;
  stopPhrase: string;
  stopPhraseCaseSensitive: boolean;
}

export type CancelQueuedPromptAutomationStatus = 'cancelled' | 'already-submitted' | 'not-found';

export interface PromptAutomationManagerDependencies {
  normalizeDroneId(raw: string): string;
  normalizeChatName(raw: string): string;
  nowIso(): string;
  runJob(job: PromptAutomationJobState): Promise<void>;
  onLaneChanged(droneId: string, chatName: string): void;
  onLaneIdle(droneId: string, chatName: string): void;
}

export class PromptAutomationManager {
  readonly #lanes = new Map<string, PromptAutomationLaneState>();

  constructor(private readonly deps: PromptAutomationManagerDependencies) {}

  key(droneIdRaw: string, chatNameRaw: string): string {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw);
    return `${droneId}:${chatName}`;
  }

  get(droneIdRaw: string, chatNameRaw: string): PromptAutomationLaneState | null {
    return this.#lanes.get(this.key(droneIdRaw, chatNameRaw)) ?? null;
  }

  ensure(droneIdRaw: string, chatNameRaw: string): PromptAutomationLaneState {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw);
    const key = this.key(droneId, chatName);
    const existing = this.#lanes.get(key);
    if (existing) return existing;

    const lane: PromptAutomationLaneState = {
      key,
      droneId,
      chatName,
      runningJob: null,
      queued: [],
      lastJob: null,
      updatedAt: this.deps.nowIso(),
    };
    this.#lanes.set(key, lane);
    return lane;
  }

  isBusy(
    lane: PromptAutomationLaneState | null | undefined,
    opts?: { includeQueued?: boolean },
  ): boolean {
    if (!lane) return false;
    if (lane.runningJob) return true;
    if (opts?.includeQueued === false) return false;
    return lane.queued.length > 0;
  }

  anyBusyForDrone(droneIdRaw: string): boolean {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    if (!droneId) return false;
    for (const lane of this.#lanes.values()) {
      if (lane.droneId === droneId && this.isBusy(lane)) return true;
    }
    return false;
  }

  response(lane: PromptAutomationLaneState | null) {
    const runningJob = lane?.runningJob ?? null;
    const baseJob = runningJob ?? lane?.lastJob ?? null;
    const queued = (lane?.queued ?? []).map((item) => ({
      queueId: item.queueId,
      automationId: item.automationId,
      automationLabel: item.automationLabel,
      runsTotal: item.runsTotal,
      sleepBetweenRunsSeconds: item.sleepBetweenRunsSeconds,
      stopPhrase: item.stopPhrase,
      stopPhraseCaseSensitive: item.stopPhraseCaseSensitive,
      enqueuedAt: item.enqueuedAt,
    }));
    if (!baseJob) {
      return {
        status: 'idle' as const,
        running: false,
        jobKey: null,
        automationId: null,
        automationLabel: null,
        runsTotal: 0,
        sleepBetweenRunsSeconds: 0,
        stopPhrase: '',
        stopPhraseCaseSensitive: false,
        finishedEarly: false,
        finishedEarlyReason: null,
        finishedEarlyRunIndex: null,
        runsCompleted: 0,
        startedAt: null,
        updatedAt: lane?.updatedAt ?? null,
        lastPromptId: null,
        error: null,
        queuedCount: queued.length,
        queued,
      };
    }
    return {
      status: baseJob.status,
      running: Boolean(runningJob && runningJob.status === 'running'),
      jobKey: baseJob.executionKey,
      automationId: baseJob.automationId,
      automationLabel: baseJob.automationLabel,
      runsTotal: baseJob.runsTotal,
      sleepBetweenRunsSeconds: baseJob.sleepBetweenRunsSeconds,
      stopPhrase: baseJob.stopPhrase,
      stopPhraseCaseSensitive: baseJob.stopPhraseCaseSensitive,
      finishedEarly: baseJob.finishedEarly,
      finishedEarlyReason: baseJob.finishedEarlyReason,
      finishedEarlyRunIndex: baseJob.finishedEarlyRunIndex,
      runsCompleted: baseJob.runsCompleted,
      startedAt: baseJob.startedAt,
      updatedAt: baseJob.updatedAt,
      lastPromptId: baseJob.lastPromptId,
      error: baseJob.error,
      queuedCount: queued.length,
      queued,
    };
  }

  start(lane: PromptAutomationLaneState, config: PromptAutomationJobConfig): void {
    if (lane.runningJob) {
      lane.queued.push({
        queueId: this.#newQueueId(lane.key),
        ...config,
        enqueuedAt: this.deps.nowIso(),
      });
      lane.updatedAt = this.deps.nowIso();
      this.#notify(lane);
      return;
    }
    this.#startLaneJob(lane, config);
  }

  finalize(lane: PromptAutomationLaneState, job: PromptAutomationJobState): void {
    if (lane.runningJob !== job) return;
    lane.runningJob = null;
    lane.lastJob = job;
    lane.updatedAt = this.deps.nowIso();
    this.#notify(lane);

    const next = lane.queued.shift() ?? null;
    if (next) {
      lane.updatedAt = this.deps.nowIso();
      this.#startLaneJob(lane, next, { queuedFromId: next.queueId });
      return;
    }
    this.deps.onLaneIdle(lane.droneId, lane.chatName);
  }

  stop(opts: {
    droneId: string;
    chatName: string;
    stopMode?: PromptAutomationStopMode;
    clearQueued?: boolean;
  }): PromptAutomationLaneState | null {
    const lane = this.get(opts.droneId, opts.chatName);
    if (!lane) return null;
    const stopMode: PromptAutomationStopMode = opts.stopMode === 'runs-only' ? 'runs-only' : 'all';
    if (opts.clearQueued !== false) lane.queued = [];

    const running = lane.runningJob;
    if (running?.status === 'running') {
      running.stopMode = stopMode;
      running.abortController?.abort();
      running.status = 'stopped';
      running.error = null;
      running.updatedAt = this.deps.nowIso();
    }
    lane.updatedAt = this.deps.nowIso();
    if (!this.isBusy(lane)) this.deps.onLaneIdle(lane.droneId, lane.chatName);
    this.#notify(lane);
    return lane;
  }

  cancelQueued(opts: { droneId: string; chatName: string; queueId: string }): {
    lane: PromptAutomationLaneState | null;
    status: CancelQueuedPromptAutomationStatus;
  } {
    const lane = this.get(opts.droneId, opts.chatName);
    const queueId = String(opts.queueId ?? '').trim();
    if (!lane || !queueId) return { lane, status: 'not-found' };

    const index = lane.queued.findIndex((queued) => queued.queueId === queueId);
    if (index >= 0) {
      lane.queued.splice(index, 1);
      lane.updatedAt = this.deps.nowIso();
      if (!this.isBusy(lane)) this.deps.onLaneIdle(lane.droneId, lane.chatName);
      this.#notify(lane);
      return { lane, status: 'cancelled' };
    }
    if (lane.runningJob?.queuedFromId === queueId || lane.lastJob?.queuedFromId === queueId) {
      return { lane, status: 'already-submitted' };
    }
    return { lane, status: 'not-found' };
  }

  notifyChatChanged(droneIdRaw: string, chatNameRaw: string): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw);
    if (droneId && chatName) this.deps.onLaneChanged(droneId, chatName);
  }

  delete(droneId: string, chatName: string): boolean {
    const deleted = this.#lanes.delete(this.key(droneId, chatName));
    if (deleted) this.notifyChatChanged(droneId, chatName);
    return deleted;
  }

  migrate(droneId: string, fromChatName: string, toChatName: string): void {
    const fromKey = this.key(droneId, fromChatName);
    const toKey = this.key(droneId, toChatName);
    if (!fromKey || !toKey || fromKey === toKey) return;
    const lane = this.#lanes.get(fromKey);
    if (!lane) return;

    this.#lanes.delete(fromKey);
    this.notifyChatChanged(droneId, fromChatName);
    lane.key = toKey;
    lane.chatName = this.deps.normalizeChatName(toChatName);
    if (lane.runningJob) {
      lane.runningJob.key = toKey;
      lane.runningJob.chatName = lane.chatName;
    }
    if (lane.lastJob) {
      lane.lastJob.key = toKey;
      lane.lastJob.chatName = lane.chatName;
    }
    this.#lanes.set(toKey, lane);
    this.#notify(lane);
  }

  async reset(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const lane of this.#lanes.values()) {
      lane.queued = [];
      const running = lane.runningJob;
      if (!running) continue;
      running.stopMode = 'all';
      running.abortController?.abort();
      if (running.task) tasks.push(running.task.catch(() => {}));
    }
    await Promise.allSettled(tasks);
    this.#lanes.clear();
  }

  #startLaneJob(
    lane: PromptAutomationLaneState,
    config: PromptAutomationJobConfig,
    opts?: { queuedFromId?: string | null },
  ): void {
    const now = this.deps.nowIso();
    const job: PromptAutomationJobState = {
      key: lane.key,
      executionKey: this.#newExecutionKey(lane.key),
      queuedFromId: opts?.queuedFromId ?? null,
      droneId: lane.droneId,
      chatName: lane.chatName,
      ...config,
      runsCompleted: 0,
      finishedEarly: false,
      finishedEarlyReason: null,
      finishedEarlyRunIndex: null,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      lastPromptId: null,
      error: null,
      stopMode: null,
      abortController: new AbortController(),
      task: null,
    };
    lane.runningJob = job;
    lane.updatedAt = now;
    this.#notify(lane);
    job.task = this.deps.runJob(job).finally(() => this.finalize(lane, job));
    void job.task;
  }

  #notify(lane: PromptAutomationLaneState): void {
    this.deps.onLaneChanged(lane.droneId, lane.chatName);
  }

  #newExecutionKey(mapKeyRaw: string): string {
    const mapKey = String(mapKeyRaw ?? '').trim() || 'automation';
    return `${mapKey}:${Date.now().toString(36)}:${crypto.randomBytes(6).toString('hex')}`;
  }

  #newQueueId(mapKeyRaw: string): string {
    const mapKey = String(mapKeyRaw ?? '').trim() || 'automation';
    return `${mapKey}:queued:${Date.now().toString(36)}:${crypto.randomBytes(4).toString('hex')}`;
  }
}
