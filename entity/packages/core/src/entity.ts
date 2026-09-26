import { Levels, type Channel, type EffectSpec } from './channel.js';
import { JevService, type Evaluator, type JevOptions, type SenseInfo } from './jev.js';
import { EventLog, isEntityActor, matches } from './log.js';
import type { Mind, ModelUsage, ToolSpec } from './mind.js';
import { describeToolArgs, toolResultOk, type Summarizer, type WorkSummary } from './summary.js';
import { runProgram, type ProgramOutcome } from './program.js';
import { headSystemPrompt, reviewerSystemPrompt, taskSystemPrompt, voiceSystemPrompt } from './prompts.js';
import { initialRuntimeState, reduceRuntime, snapshotLimbs, WORKER_ACTIVE, type Claim, type LimbSnapshot, type CodeLimb, type LimbState, type LimbStatus, type LlmLimb, type OutputStop, type ReactiveLimb, type RuntimeSetup, type RuntimeState, type Usage, type WatchLimb, type WorkerLimb } from './runtime-state.js';
import { toJsonSchema, validate } from './schema.js';
import { mayUseEffect, runtimeTools, TOOL_DESCRIPTIONS, TOOL_SCHEMAS, type ToolName } from './tools.js';
import type { Caller, EntityEvent, EventMatcher } from './types.js';
import { conditionHolds, conditionSenses, eventMatchesTrigger, LevelTracker, levelHolds, senseHolds, templateArgs, watchSchema, type ConditionContext, type StopMode, type StopScope, type WatchSpec } from './watch.js';

export type SessionStatus = 'idle' | 'running' | 'paused';

/** What a limb needs that cannot live in the log: abort controllers, trackers, rate limits. Lost on restart, rebuilt as needed. */
interface LimbLive {
  aborts: Map<string, AbortController>;
  /** A program's sandbox. */
  program?: AbortController;
  tracker?: LevelTracker;
  sense?: SenseInfo;
  effectTimes: number[];
  /** Work view summaries: tool calls since the last one, and whether one is being written. */
  callsSinceSummary: number;
  lastSummaryAt: number;
  summarizing?: boolean;
  /** A wake that must wait for the run in flight to end (a worker finishing and continuing at once). */
  wakeAfterRun?: string;
  /** A worker's state sections as it was last shown them, so its next wake shows only what changed. */
  sent?: Record<string, string>;
}

export interface EntityConfig {
  /** Debounce before a user message wakes the head, so bursts arrive together. */
  messageDebounceMs: number;
  /** While the user is still typing after sending, wait until their draft has been quiet this long... */
  messageSettleMs: number;
  /** ...but at most this long after the message before waking anyway. */
  messageSettleMaxMs: number;
  /** How often levels are re-checked for duration triggers. */
  tickMs: number;
  /** How often the heartbeat may wake the head while workers are active. */
  headHeartbeatMs: number;
  headMaxSteps: number;
  taskMaxSteps: number;
  maxTasks: number;
  /** Second looks at the front limb's answers: by a separate reviewer on the head's model, by the head itself, or none. */
  review: 'off' | 'separate' | 'head';
  /** How long the front limb must be quiet before its answers are reviewed together. */
  reviewQuietMs: number;
  maxCodeLimbs: number;
  /** Code limb effect rate limits, per second. */
  reflexPerSecond: number;
  limbPerSecond: number;
  /** Grace period before a cancel becomes a kill. */
  cancelGraceMs: number;
  /** Restart cap: at most `restartMax` crashes in `restartWindowMs`. */
  restartMax: number;
  restartWindowMs: number;
  /** Longest a freeze holds a program or task limb before its action is rejected. */
  freezeMaxMs: number;
  /** With Jev available, watch the user's unsent draft and wake the head when it may need a response. */
  draftAttention: boolean;
  /** Allow watches and programs. Off only to test the floor: the entity as a plain chat agent. */
  codeLimbs: boolean;
  /** Most finished worker conversations kept for forks and follow-ups. */
  keptSessions: number;
  /** A task run that uses all its turns is continued this many times before the task is marked failed. */
  taskContinuations: number;
  /** Summarize a busy worker after this many tool calls, at most every summaryIntervalMs, at most summaryMax per session. */
  summaryEveryCalls: number;
  summaryIntervalMs: number;
  summaryMax: number;
  recentEvents: number;
}

export interface EntityOptions {
  mind: Mind;
  channels: Channel[];
  /** voice: an optional fast model that answers first and hands off to the head. Unset: the head is the voice. */
  models: { head: string; task: string; voice?: string };
  evaluator?: Evaluator;
  jev?: JevOptions;
  /** Writes Work view summaries of busy workers. Optional; everything else in the Work view comes from the log. */
  summarizer?: Summarizer;
  config?: Partial<EntityConfig>;
}

export interface EntitySnapshot {
  status: SessionStatus;
  t: number;
  world: Record<string, unknown>;
  self: { notes: string[] };
  levels: Record<string, { value: unknown; since: number; by?: string }>;
  stops: OutputStop[];
  health: { t: number; message: string }[];
  limbs: LimbSnapshot[];
  senses: SenseInfo[];
  jev: { available: boolean; calls: number; perMinute: number };
  /** What every model call in the session has used, and the part of it that went to work summaries and senses. */
  usage: Usage;
  usageBy: { summaries: Usage; senses: Usage };
}

/** Workers waiting for a slot, at most. */
const MAX_QUEUED = 500;

const DEFAULT_CONFIG: EntityConfig = {
  messageDebounceMs: 150, messageSettleMs: 1000, messageSettleMaxMs: 6000, tickMs: 50, headHeartbeatMs: 180_000, headMaxSteps: 8, taskMaxSteps: 24,
  maxTasks: 6, review: 'off', reviewQuietMs: 3000, maxCodeLimbs: 32, reflexPerSecond: 30, limbPerSecond: 5, cancelGraceMs: 3000,
  restartMax: 3, restartWindowMs: 60_000, freezeMaxMs: 600_000, draftAttention: true, codeLimbs: true, keptSessions: 12, taskContinuations: 4, summaryEveryCalls: 4, summaryIntervalMs: 20_000, summaryMax: 200, recentEvents: 40,
};

class Stopped extends Error {}

/**
 * The realtime entity: event log, limbs, code limbs, channels and user controls. See entity/docs.
 * Its state is a projection of the log (`reduceRuntime`): every change is an event first.
 */
export class Entity {
  private readonly config: EntityConfig;
  private readonly mind: Mind;
  private readonly channels: Channel[];
  private readonly effects = new Map<string, { spec: EffectSpec; channel?: Channel }>();
  private readonly listeners = new Set<(event: EntityEvent) => void>();

  status: SessionStatus = 'idle';
  private startedAt = performance.now();
  log!: EventLog;
  levels!: Levels;
  private world: Record<string, unknown> = {};
  private state!: RuntimeState;
  private live = new Map<string, LimbLive>();
  private jev!: JevService;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private messageTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pausedAt = 0;
  private pauseWaiters: (() => void)[] = [];
  private resumeWaiters: (() => void)[] = [];
  private summaries = 0;
  private eventWaiters = new Set<{ matcher: EventMatcher; resolve(e: EntityEvent | null): void; timer: ReturnType<typeof setTimeout> }>();
  private pausable = new Set<{ remaining: number; startedAt: number; timer: ReturnType<typeof setTimeout> | null; fire(): void }>();

  constructor(private readonly options: EntityOptions) {
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.mind = options.mind;
    this.channels = options.channels;
    for (const channel of this.channels) for (const spec of channel.effects) this.effects.set(spec.name, { spec, channel });
    this.init();
  }

  // ---------- lifecycle ----------

  /** A fresh session, or (restore) one that began at `sessionStart` (epoch ms): its clock carries on from there. */
  private init(sessionStart = Date.now()): void {
    this.startedAt = performance.now() - (Date.now() - sessionStart);
    this.log = new EventLog(() => this.now(), sessionStart);
    this.levels = new Levels(() => this.now());
    this.world = Object.fromEntries(this.channels.map(c => [c.name, c.init()]));
    const { head, task, voice } = this.options.models;
    const setup: RuntimeSetup = { models: { head, task, ...(voice ? { voice } : {}) }, review: this.config.review, codeLimbs: this.config.codeLimbs, keptSessions: this.config.keptSessions };
    this.state = initialRuntimeState(setup);
    this.live = new Map();
    this.summaries = 0;
    this.jev = new JevService(this.options.evaluator, this.log, () => this.renderForJev(), m => this.addHealth(m), this.options.jev);
    this.log.subscribe(event => this.onEvent(event));
  }

  now(): number { return Math.round((performance.now() - this.startedAt) * 100) / 100; }

  /** The runtime state, as projected from the log. Read-only for callers. */
  runtime(): Readonly<RuntimeState> { return this.state; }

  start(): void {
    if (this.status !== 'idle') return;
    this.status = 'running';
    this.log.append('session_started', 'user', { setup: this.state.setup as unknown as Record<string, unknown> });
    if (this.jev.available && this.config.draftAttention) {
      // The runtime's own default sense: Jev can add wakes, never suppress them.
      this.installWatch(this.llm(this.frontLimb())!, {
        name: 'draft attention',
        on: { sense: DRAFT_ATTENTION_QUESTION, above: 0.4 },
        // Only once the user pauses, so a half-typed question is not answered (M3, E3).
        when: { quiet: 'draft_changed', for_ms: DRAFT_PAUSE_MS },
        do: { wake: { reason: 'the user is typing something you may want to respond to before they send it' } },
      }, true);
    }
    this.tickTimer = setInterval(() => this.tick(), this.config.tickMs);
    this.wake(this.frontLimb(), 'session started');
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.pausedAt = this.now();
    if (this.messageTimer) { clearTimeout(this.messageTimer); this.messageTimer = null; }
    for (const live of this.live.values()) for (const abort of live.aborts.values()) abort.abort();
    for (const wait of this.pausable) if (wait.timer) { clearTimeout(wait.timer); wait.timer = null; wait.remaining -= performance.now() - wait.startedAt; }
    this.log.append('session_paused', 'user', {});
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.status = 'running';
    const pausedFor = Math.round(this.now() - this.pausedAt);
    this.log.append('session_resumed', 'user', { paused_for_ms: pausedFor });
    for (const wait of this.pausable) this.schedulePausable(wait);
    for (const resolve of this.pauseWaiters.splice(0)) resolve();
    this.wake('head', `resumed after ${Math.round(pausedFor / 1000)} s pause; workers carry on by themselves, so say nothing unless the user needs to know something that is not in the chat yet`);
    for (const limb of this.workers()) if (limb.status === 'running' && !limb.runs.length && limb.asking === undefined) this.wake(limb.id, 'resumed');
  }

  /** Aborts everything and starts a clean session. Returns the old log so the host can archive it. */
  reset(): EntityEvent[] {
    const archived = [...this.log.all()];
    this.shutdown();
    this.status = 'idle';
    this.init();
    for (const listener of this.listeners) listener({ seq: 0, t: 0, at: Date.now(), type: 'session_reset', by: 'user', data: {} });
    return archived;
  }

  close(): void { this.shutdown(); }

  private shutdown(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    if (this.messageTimer) clearTimeout(this.messageTimer);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const wait of this.pausable) if (wait.timer) clearTimeout(wait.timer);
    this.pausable.clear();
    for (const waiter of this.eventWaiters) { clearTimeout(waiter.timer); waiter.resolve(null); }
    this.eventWaiters.clear();
    for (const resolve of this.pauseWaiters.splice(0)) resolve();
    for (const live of this.live.values()) {
      live.program?.abort();
      for (const abort of live.aborts.values()) abort.abort();
    }
    this.jev.close();
  }

  subscribe(listener: (event: EntityEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Injects a user input event (chat message, draft change, key press). */
  input(type: string, data: Record<string, unknown>): EntityEvent {
    const channel = this.channels.find(c => c.inputs.includes(type));
    if (!channel) throw new Error(`Unknown input event "${type}"`);
    return this.log.append(type, 'user', this.enrich(type, data));
  }

  /** Injects a host event (game state changes and similar). */
  hostEvent(type: string, data: Record<string, unknown>): EntityEvent {
    return this.log.append(type, 'host', data);
  }

  // ---------- events ----------

  private onEvent(event: EntityEvent): void {
    this.applyState(event);
    for (const listener of this.listeners) listener(event);
    for (const waiter of [...this.eventWaiters]) {
      if (matches(event, waiter.matcher)) { this.eventWaiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(event); }
    }
    this.jev.observe(event);
    if (this.status !== 'running') return;
    this.runEventWatches(event);
    this.baselineWakes(event);
    this.queueReview(event);
  }

  /** Everything an event changes that a replay must rebuild: the runtime state, levels and each channel's world. Nothing else. */
  private applyState(event: EntityEvent): void {
    reduceRuntime(this.state, event);
    // Sensed levels come from the log like every other level, so a replay rebuilds them too.
    if (event.type === 'sensed') for (const [level, p] of Object.entries(event.data.answers as Record<string, number>)) this.levels.set(level, p, 'jev', event.t);
    if (event.type === 'senses_dropped') for (const level of event.data.levels as string[]) this.levels.clear(level);
    for (const channel of this.channels) channel.reduce(this.world[channel.name] as never, event, { levels: this.levels, now: event.t });
  }

  /**
   * Rebuilds a session from its log, e.g. after a Hub restart, and leaves it paused for the user to resume.
   * State, levels and channels are replayed. What cannot survive a restart is closed in the log: runs in flight
   * end as aborted, programs fail (their JavaScript state is gone), a worker being cancelled is cancelled, and a
   * review in progress is queued again. Watches and timers are armed again. Worker conversations are the mind's.
   */
  restore(events: readonly EntityEvent[]): void {
    if (this.status !== 'idle' || this.log.length) throw new Error('restore needs an entity that has not started');
    const first = events[0];
    const last = events[events.length - 1];
    if (!first || !events.some(e => e.type === 'session_started' && e.data.setup)) throw new Error('this log has no session_started with its setup, so it cannot be restored');
    this.shutdown();
    this.init(first.at - first.t);
    for (const event of events) { this.log.load(event); this.applyState(event); }
    const wasPaused = this.state.pausedSince !== undefined;
    this.status = 'paused';
    this.pausedAt = this.state.pausedSince ?? last.t;
    this.log.append('session_restored', 'system', { from_seq: last.seq, downtime_ms: Math.round(this.now() - last.t) });
    for (const limb of this.limbList()) {
      if (limb.kind === 'llm') for (const run of [...limb.runs]) this.log.append('run_finished', limb.id, { run: run.id, ms: Math.round(last.t - run.startedAt), aborted: true, restored: true });
    }
    for (const limb of this.limbList()) {
      if (limb.status !== 'running') continue;
      if (limb.role === 'program') this.endCodeLimb(limb, 'failed', 'the Hub restarted; programs do not survive a restart');
      else if (limb.role === 'watch') this.armWatch(limb.id, limb.watch);
      else if (limb.role === 'task' && limb.cancelRequested) this.finishTask(limb, 'cancelled: the Hub restarted while it was wrapping up', 'cancelled');
    }
    if (this.state.reviewing.length) this.log.append('review_requeued', 'system', { seqs: [...this.state.reviewing] });
    const runningNow = (this.state.pausedSince ?? last.t) - this.state.pausedMs;
    for (const timer of this.state.timers) this.armTimer(timer.id, timer.label, timer.limb, Math.max(0, timer.due - runningNow));
    if (!wasPaused) this.log.append('session_paused', 'system', { restored: true });
    this.tickTimer = setInterval(() => this.tick(), this.config.tickMs);
  }

  /** Every answer of the front limb gets a second look, not only the ones it thinks might be wrong. */
  private queueReview(event: EntityEvent): void {
    if (this.config.review === 'off' || event.type !== 'chat_message' || event.by !== this.frontLimb()) return;
    if (event.data.thread || event.data.group || event.data.corrects || event.data.expands) return;
    // The head reviewing its own answers adds nothing; with review 'head', only a separate voice is reviewed.
    if (this.config.review === 'head' && event.by === 'head') return;
    this.log.append('review_queued', 'system', { seq: event.seq });
  }

  private reviewerId(): string { return this.config.review === 'separate' ? 'reviewer' : 'head'; }

  /** Once the front limb has been quiet for a moment, one reviewer run looks at all its unreviewed answers. */
  private maybeReview(now: number): void {
    const { unreviewed, reviewing } = this.state;
    if (!unreviewed.length || reviewing.length) return;
    const front = this.llm(this.frontLimb())!;
    const reviewer = this.llm(this.reviewerId());
    if (!reviewer || reviewer.runs.length || front.runs.length) return;
    if (now - (this.state.lastEvents['entity:chat_message'] ?? -Infinity) < this.config.reviewQuietMs) return;
    const seqs = [...unreviewed];
    this.log.append('review_started', 'system', { seqs });
    // Each with how long ago it was said: a claim about work is judged as of then, not against what has happened since.
    const said = (seq: number) => { const e = this.log.all()[seq - 1]; return e ? ` (said ${this.ago(e.t)})` : ''; };
    this.wake(reviewer.id, `review ${seqs.map(seq => `#${seq}${said(seq)}`).join(', ')}`);
  }

  /** Answers the reviewer did not amend count as confirmed, so nothing stays "checking" forever. */
  private finishReview(limb: LlmLimb): void {
    if (limb.id !== this.reviewerId() || !this.state.reviewing.length || limb.runs.length) return;
    for (const seq of [...this.state.reviewing]) this.log.append('message_reviewed', limb.id, { seq, verdict: 'confirmed', implicit: true });
  }

  /** Answers of a review run that did not complete: requeued after a pause, otherwise marked unchecked. */
  private abandonReview(limb: LlmLimb, why: 'aborted' | 'failed' | 'retry'): void {
    if (limb.id !== this.reviewerId() || !this.state.reviewing.length || limb.runs.length || this.status === 'idle') return;
    const seqs = [...this.state.reviewing];
    if (why === 'retry' || (why === 'aborted' && this.status === 'paused')) { this.log.append('review_requeued', 'system', { seqs }); return; }
    for (const seq of seqs) this.log.append('message_reviewed', limb.id, { seq, verdict: 'unchecked', reason: why });
  }

  private amend(limb: LlmLimb, args: { seq: number; verdict: string; text?: string }): string {
    const original = this.log.all().find(e => e.seq === args.seq && e.type === 'chat_message');
    if (!original || !isEntityActor(original.by)) return `error: #${args.seq} is not one of the entity's messages`;
    const text = String(args.text ?? '').trim();
    if (args.verdict === 'withdraw') {
      // Only a correction or addition of the reviewer's own; the message it amended is restored.
      const amended = typeof original.data.corrects === 'number' ? original.data.corrects : typeof original.data.expands === 'number' ? original.data.expands : undefined;
      if (original.by !== limb.id || amended === undefined) return `error: #${args.seq} is not one of your corrections`;
      this.log.append('message_reviewed', limb.id, { seq: args.seq, verdict: 'withdrawn', ...(text ? { reason: text } : {}) });
      this.log.append('message_reviewed', limb.id, { seq: amended, verdict: 'confirmed', restored: true });
      return `#${args.seq} withdrawn; #${amended} restored`;
    }
    if (args.verdict === 'confirm') { this.log.append('message_reviewed', limb.id, { seq: args.seq, verdict: 'confirmed' }); return `#${args.seq} confirmed`; }
    if (!text) return `error: ${args.verdict} needs text`;
    const replyTo = typeof original.data.reply_to === 'number' ? { reply_to: original.data.reply_to } : {};
    const kind = args.verdict === 'correct' ? 'corrects' : 'expands';
    const posted = this.log.append('chat_message', limb.id, { text, [kind]: args.seq, ...replyTo });
    this.log.append('message_reviewed', limb.id, { seq: args.seq, verdict: args.verdict === 'correct' ? 'corrected' : 'expanded', by: posted.seq });
    return `#${args.seq} ${args.verdict === 'correct' ? 'corrected' : 'expanded'} with #${posted.seq}`;
  }

  private baselineWakes(event: EntityEvent): void {
    if (event.type === 'chat_message' && event.by === 'user') {
      if (this.messageTimer) clearTimeout(this.messageTimer);
      const sentAt = event.t;
      // Let the user finish: while they are still typing, hold the wake so a burst of messages is handled together,
      // but never longer than messageSettleMaxMs after the first unhandled message.
      const check = () => {
        this.messageTimer = null;
        const typing = this.levels.get('user.typing') !== undefined;
        const lastKey = this.state.lastEvents['user:draft_changed'] ?? -Infinity;
        const now = this.now();
        if (typing && now - lastKey < this.config.messageSettleMs && now - sentAt < this.config.messageSettleMaxMs) {
          this.messageTimer = setTimeout(check, Math.min(150, this.config.messageSettleMs));
          return;
        }
        this.wake(this.frontLimb(), 'user message');
      };
      this.messageTimer = setTimeout(check, this.config.messageDebounceMs);
    }
  }

  private tick(): void {
    if (this.status !== 'running') return;
    const now = this.now();
    for (const limb of this.watches()) {
      if (limb.status !== 'running') continue;
      if (limb.expiresAt !== undefined && now >= limb.expiresAt) { this.endCodeLimb(limb, 'done', 'expired'); continue; }
      this.checkLevelWatch(limb, now);
    }
    if (this.config.review !== 'off') this.maybeReview(now);
    // Standing watches and programs of the head (a mirror, the draft sense) need no heartbeat; only work in progress does.
    const active = this.workers().some(l => WORKER_ACTIVE.includes(l.status) && l.asking === undefined);
    const head = this.llm('head')!;
    if (active && !head.runs.length && now - (head.lastRunAt ?? 0) > this.config.headHeartbeatMs) this.wake('head', 'heartbeat');
  }

  // ---------- watches ----------

  private runEventWatches(event: EntityEvent): void {
    for (const limb of this.watches()) {
      if (limb.status !== 'running') continue;
      const on = limb.watch.on;
      if ('event' in on) {
        if (eventMatchesTrigger(event, on, isEntityActor) && this.whenHolds(limb, event.t)) this.fireWatch(limb, event);
      } else this.checkLevelWatch(limb, event.t);
    }
  }

  private checkLevelWatch(limb: WatchLimb, now: number): void {
    const on = limb.watch.on;
    if ('event' in on) return;
    const live = this.liveOf(limb.id);
    const triggered = 'level' in on ? levelHolds(on, this.levels, isEntityActor) : senseHolds(this.levels.get(live.sense!.level)?.value as number | undefined, on);
    if (live.tracker!.update(triggered && this.whenHolds(limb, now), now, on.for_ms ?? 0)) this.fireWatch(limb, undefined);
  }

  private whenHolds(limb: WatchLimb, now: number): boolean {
    const when = limb.watch.when;
    return !when || conditionHolds(when, this.conditionContext(now));
  }

  private conditionContext(now: number): ConditionContext {
    return {
      levels: this.levels,
      now,
      isEntity: isEntityActor,
      senseValue: question => { const info = this.jev.find(question); return info ? this.levels.get(info.level)?.value as number | undefined : undefined; },
      lastEvent: (type, by) => this.state.lastEvents[`${by}:${type}`],
    };
  }

  private fireWatch(limb: WatchLimb, event: EntityEvent | undefined): void {
    const watch = limb.watch;
    this.log.append('watch_fired', 'system', { id: limb.id });
    const caller: Caller = { limbId: limb.id, kind: 'code', readSeq: this.log.length };
    const action = watch.do;
    if ('effect' in action) {
      void this.commit(caller, action.effect, templateArgs(action.args, event)).then(result => {
        if (result.startsWith('error') || result.startsWith('rate limited')) this.addHealth(`watch "${limb.name}": ${result}`);
      });
    } else if ('stop_output' in action) {
      this.stopOutput(limb.parent ?? 'head', action.stop_output.scope ?? 'work', action.stop_output.mode ?? 'stop', action.stop_output.reason, limb.id);
    } else if ('resume_output' in action) {
      this.resumeOutput(limb.parent ?? 'head', limb.id);
    } else if ('wake' in action) {
      this.log.append('watch_woke', limb.id, { reason: action.wake.reason, limb: limb.parent });
      if (limb.parent) this.wake(limb.parent, `watch "${limb.name}": ${action.wake.reason}`);
    } else if ('run_program' in action) {
      this.startProgram(this.llm(limb.parent ?? 'head')!, action.run_program.name, action.run_program.code, limb.decidedAt, action.run_program.label);
    }
    if (watch.once) this.endCodeLimb(limb, 'done', 'fired once');
  }

  private installWatch(author: LlmLimb, spec: WatchSpec, builtin = false, decidedAt?: number): string {
    const error = validate(watchSchema, spec, 'watch');
    if (error) return `error: invalid watch: ${error}. Nothing installed.`;
    const action = spec.do;
    if ('effect' in action) {
      const effect = this.effects.get(action.effect);
      if (!effect) return `error: unknown effect "${action.effect}" (known: ${[...this.effects.keys()].join(', ')}). Nothing installed.`;
      if (!mayUseEffect(author.role, effect.spec)) return `error: you cannot give a watch "${action.effect}": you cannot use it yourself. Nothing installed.`;
    }
    const senses = [...('sense' in spec.on ? [spec.on.sense] : []), ...conditionSenses(spec.when)];
    if (senses.length && !this.jev.available) return 'error: sense watches need Jev, which is not configured in this session. Nothing installed.';
    if (this.countCode() >= this.config.maxCodeLimbs) return `error: too many watches and programs (max ${this.config.maxCodeLimbs}); cancel some first.`;
    const id = this.nextId('watch');
    // Ready before the install is logged: the new watch already sees that event.
    const live = this.armWatch(id, spec);
    this.log.append('watch_installed', author.id, { id, name: spec.name, watch: spec as unknown as Record<string, unknown>, ...(builtin ? { builtin } : {}), ...(decidedAt !== undefined ? { decided_at: decidedAt } : {}) });
    return `watch ${id} "${spec.name}" installed${live.sense ? ` (sense level ${live.sense.level})` : ''}`;
  }

  /** What a watch needs to run beyond its spec: a level tracker, and the senses it asks. */
  private armWatch(id: string, spec: WatchSpec): LimbLive {
    const live = this.liveOf(id);
    live.tracker = new LevelTracker();
    if ('sense' in spec.on) live.sense = this.jev.sense(spec.on.sense, id);
    for (const question of conditionSenses(spec.when)) this.jev.sense(question, id);
    return live;
  }

  // ---------- programs ----------

  private startProgram(author: LlmLimb, name: string, code: string, decidedAt?: number, label?: string): { limb?: CodeLimb; error?: string; done?: Promise<ProgramOutcome> } {
    if (this.countCode() >= this.config.maxCodeLimbs) return { error: `too many watches and programs (max ${this.config.maxCodeLimbs}); cancel some first.` };
    const id = this.nextId('program');
    const abort = new AbortController();
    this.liveOf(id).program = abort;
    this.log.append('program_started', author.id, { id, name, code, ...(label !== undefined ? { label } : {}), ...(decidedAt !== undefined ? { decided_at: decidedAt } : {}) });
    const limb = this.limb(id) as CodeLimb;
    const done = runProgram(code, this.programApi(limb), abort.signal).then(outcome => {
      if (limb.status !== 'running') return outcome;
      if (outcome.status === 'finished') {
        this.endCodeLimb(limb, 'done', 'finished', outcome.result);
        this.wake(author.id, `program "${name}" finished`);
      }
      else if (outcome.status === 'failed') {
        this.endCodeLimb(limb, 'failed', outcome.error);
        this.wake(author.id, `program "${name}" failed: ${outcome.error}`);
      }
      return outcome;
    });
    return { limb, done };
  }

  private programApi(limb: CodeLimb) {
    // Programs read the log in order from where they started: events that happen between two
    // nextEvent calls are buffered, never missed.
    let cursor = this.log.length;
    let lastWake = -Infinity;
    return {
      effect: async (name: string, args: Record<string, unknown>) => {
        await this.whileRunning();
        if (limb.status !== 'running') throw new Stopped('program was stopped');
        await this.throttle(limb, name);
        if (limb.status !== 'running') throw new Stopped('program was stopped');
        const result = await this.commit({ limbId: limb.id, kind: 'code', readSeq: this.log.length }, name, args);
        if (result.startsWith('output stopped')) throw new Stopped(result);
        return result;
      },
      effects: () => [...this.effects.values()].filter(e => !e.spec.readonly).map(e => ({ name: e.spec.name, shorthand: e.spec.shorthand })),
      wait: (ms: number) => this.pausableWait(ms),
      nextEvent: (matcher: EventMatcher, timeoutMs: number) => {
        const buffered = this.log.since(cursor).find(e => matches(e, matcher));
        if (buffered) { cursor = buffered.seq; return Promise.resolve(buffered); }
        cursor = this.log.length;
        return new Promise<EntityEvent | null>(resolve => {
          const waiter = {
            matcher,
            resolve: (event: EntityEvent | null) => { cursor = event ? event.seq : this.log.length; resolve(event); },
            timer: setTimeout(() => { this.eventWaiters.delete(waiter); waiter.resolve(null); }, Math.min(timeoutMs, 3_600_000)),
          };
          this.eventWaiters.add(waiter);
        });
      },
      judge: (question: string) => this.jev.judge(question, limb.id),
      sense: (question: string) => {
        const info = this.jev.sense(question, limb.id);
        return this.levels.get(info.level)?.value as number | undefined;
      },
      state: () => this.snapshotWorld(),
      log: (message: string) => { this.log.append('program_log', limb.id, { message: message.slice(0, 500) }); },
      now: () => this.now(),
      // A program cannot think; it can hand what it found to its author. At most once a second, so a loop cannot flood the author with runs.
      wake: (reason: string) => {
        const author = limb.parent ? this.limb(limb.parent) : undefined;
        if (!author || author.kind !== 'llm' || limb.status !== 'running') return 'error: no author to wake';
        if (this.now() - lastWake < 1000) return 'rate limited: at most one wake per second';
        lastWake = this.now();
        this.log.append('program_woke', limb.id, { reason: reason.slice(0, 500), limb: author.id });
        this.wake(author.id, `program "${limb.name}": ${reason.slice(0, 500)}`);
        return 'woken';
      },
    };
  }

  /** Programs are slowed down to their rate limit instead of losing effects. Watches drop instead. */
  private async throttle(limb: CodeLimb, name: string): Promise<void> {
    const spec = this.effects.get(name)?.spec;
    if (!spec || spec.readonly) return;
    const limit = spec.risk === 'reflex' ? this.config.reflexPerSecond : this.config.limbPerSecond;
    const live = this.liveOf(limb.id);
    for (;;) {
      const now = performance.now();
      live.effectTimes = live.effectTimes.filter(t => now - t < 1000);
      if (live.effectTimes.length < limit) return;
      await this.pausableWait(1000 - (now - live.effectTimes[0]) + 1);
    }
  }

  /** A set_timer timer: it counts only while the session runs, then logs `timer` and wakes whoever set it. */
  private armTimer(id: string, label: string, limbId: string, ms: number): void {
    const log = this.log;
    void this.pausableWait(ms).then(() => {
      if (this.status === 'idle' || this.log !== log) return;
      this.log.append('timer', 'system', { id, label, limb: limbId });
      this.wake(limbId, `timer "${label}"`);
    });
  }

  private whileRunning(): Promise<void> {
    return this.status === 'paused' ? new Promise(resolve => this.pauseWaiters.push(resolve)) : Promise.resolve();
  }

  private pausableWait(ms: number): Promise<void> {
    return new Promise(resolve => {
      const wait = { remaining: ms, startedAt: performance.now(), timer: null as ReturnType<typeof setTimeout> | null, fire: () => { this.pausable.delete(wait); resolve(); } };
      this.pausable.add(wait);
      if (this.status !== 'paused') this.schedulePausable(wait);
    });
  }

  private schedulePausable(wait: { remaining: number; startedAt: number; timer: ReturnType<typeof setTimeout> | null; fire(): void }): void {
    wait.startedAt = performance.now();
    wait.timer = setTimeout(wait.fire, Math.max(0, wait.remaining));
  }

  // ---------- output stops ----------

  private stopOutput(owner: string, scope: StopScope, mode: StopMode, reason: string, by: string): OutputStop {
    const id = this.nextId('stop');
    this.log.append('output_stopped', by, { id, owner, scope, mode, reason });
    if (mode === 'stop') {
      for (const limb of this.limbList()) {
        if (limb.role !== 'program' || limb.status !== 'running') continue;
        if (scope === 'entity' || this.isWithin(limb.id, owner)) this.endCodeLimb(limb, 'cancelled', `output stopped: ${reason}`);
      }
    }
    const ownerLimb = this.limb(owner);
    // Wake the owner so it can react, unless it stopped its own output and already knows.
    if (ownerLimb?.kind === 'llm' && by !== owner) this.wake(owner, `output stopped: ${reason}`);
    return this.state.stops.find(s => s.id === id)!;
  }

  private resumeOutput(limbId: string, by: string): number {
    const ids = this.state.stops.filter(stop => limbId === 'head' || this.isWithin(stop.owner, limbId)).map(stop => stop.id);
    if (ids.length) this.log.append('output_resumed', by, { count: ids.length, ids });
    for (const resolve of this.resumeWaiters.splice(0)) resolve();
    return ids.length;
  }

  private stoppedBy(caller: Caller): OutputStop | undefined {
    const limb = this.limb(caller.limbId);
    return this.state.stops.find(stop => {
      // A stop halts the work in flight when it was issued. Work a limb deliberately starts afterwards is a new decision.
      if (limb?.decidedAt !== undefined && limb.decidedAt > stop.since) return false;
      if (stop.scope === 'entity') return true;
      if (!this.isWithin(caller.limbId, stop.owner)) return false;
      // The voice is not the head's "work": only a subtree or entity stop silences it.
      return stop.scope === 'subtree' || (caller.limbId !== stop.owner && limb?.role !== 'voice');
    });
  }

  // ---------- effect gate ----------

  /** Every effect, from any limb, goes through here. Always resolves with text for the caller. */
  async commit(caller: Caller, name: string, args: Record<string, unknown>): Promise<string> {
    const entry = this.effects.get(name);
    if (!entry) return `error: unknown effect "${name}" (known: ${[...this.effects.keys()].join(', ')})`;
    const { spec, channel } = entry;
    const error = validate(spec.parameters, args, name);
    if (error) return `error: ${error}. Nothing was done.`;
    const limb = this.limb(caller.limbId);
    if (!limb || (limb.kind === 'code' && limb.status !== 'running')) return 'error: this limb is no longer running';
    if (this.status === 'paused' && !spec.readonly) return 'error: the session is paused';
    if (spec.risk === 'confirm') return `error: "${name}" needs the user's approval, which this session does not support yet`;
    // A watch or program acts with its author's permissions.
    const role = limb.kind === 'code' ? this.limb(limb.parent ?? 'head')?.role : limb.role;
    if (!role || !mayUseEffect(role, spec)) return `error: you cannot use "${name}".`;
    if (!spec.readonly && spec.output !== false) {
      // A freeze pauses programs and task limbs at this effect until it lifts; watches and the voice are rejected instead.
      for (let stop = this.stoppedBy(caller); stop; stop = this.stoppedBy(caller)) {
        const canWait = stop.mode === 'freeze' && (limb.role === 'program' || limb.role === 'task');
        if (!canWait) return `output stopped: ${stop.reason}. Nothing was done.`;
        const resumed = await Promise.race([
          new Promise<boolean>(resolve => this.resumeWaiters.push(() => resolve(true))),
          new Promise<boolean>(resolve => setTimeout(() => resolve(false), this.config.freezeMaxMs)),
        ]);
        if (!resumed || limb.status !== 'running' || this.status === 'idle') return `output stopped: ${stop.reason}. Nothing was done.`;
      }
    }
    if (spec.dependsOn) {
      const stale = this.log.since(caller.readSeq).find(event => spec.dependsOn!(args).some(m => matches(event, m)));
      if (stale) return `stale: "${stale.type}" happened after you read the state (#${stale.seq}). Nothing was done; re-check and retry if still right.`;
    }
    if (spec.paths) {
      const writer = limb.kind === 'code' ? this.llm(limb.parent ?? 'head')! : limb;
      const refused = this.claimPaths(writer, spec.paths(args), 'writing');
      if (refused) {
        // Logged, so views can show who blocks whom without reading the refusal text.
        this.log.append('write_refused', writer.id, { path: refused.path, holder: refused.holder.limb });
        this.wake('head', `claim conflict: ${caller.limbId} tried to write ${refused.text}`);
        return `refused: ${refused.text}. Nothing was written. Coordinate (share a note, wait, or work elsewhere) instead of overwriting.`;
      }
    }
    if (limb.kind === 'code' && !spec.readonly) {
      const limit = spec.risk === 'reflex' ? this.config.reflexPerSecond : this.config.limbPerSecond;
      const live = this.liveOf(limb.id);
      const now = performance.now();
      live.effectTimes = live.effectTimes.filter(t => now - t < 1000);
      if (live.effectTimes.length >= limit) return `rate limited: at most ${limit} "${spec.risk}" effects per second for a watch or program`;
      live.effectTimes.push(now);
    }
    try {
      return await spec.apply(args, {
        caller,
        world: channel ? this.world[channel.name] : undefined,
        emit: (type, data) => this.log.append(type, caller.limbId, this.enrich(type, data)),
        now: () => this.now(),
        events: () => this.log.all(),
      });
    } catch (err) {
      return `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ---------- LLM limbs ----------

  /**
   * Wakes an LLM limb with a fresh run. A busy limb gets a parallel run instead of a queue.
   * A worker's pending updates (steers, discoveries, claims) come with the wake.
   */
  wake(limbId: string, reason: string): void {
    const limb = this.llm(limbId);
    if (!limb || this.status !== 'running') return;
    const worker = limb.role === 'task' ? limb : undefined;
    if (worker && (worker.status !== 'running' || worker.runs.length)) return;
    const runId = this.nextId('run');
    const abort = new AbortController();
    const live = this.liveOf(limb.id);
    live.aborts.set(runId, abort);
    const notices = worker ? [...worker.notices] : [];
    const why = [reason, ...notices].filter(Boolean).join(' | ').slice(0, 3000);
    const readSeq = this.log.length;
    /** Where this run's new events begin, so a retry after a crash is shown them again. */
    const shownFrom = limb.seenSeq;
    const prompt = this.render(limb, why);
    this.log.append('run_started', limb.id, { run: runId, reason: why, ...(notices.length ? { notices: notices.length } : {}) });
    const startedAt = this.now();
    const tools = this.toolsFor(limb);
    const allowed = new Set(tools.map(t => t.name));
    /** Set when the limb ends its turn itself (finish_task, ask); the run then stops after this step. */
    let ended = false;
    this.mind.run({
      limbId: limb.id, runId, role: limb.role === 'head' || limb.role === 'reviewer' ? 'head' : limb.role === 'voice' ? 'voice' : 'task', model: limb.model,
      system: this.systemPrompt(limb), prompt, tools, signal: abort.signal, ended: () => ended,
      sessionKey: worker ? limb.id : undefined,
      maxSteps: worker ? this.config.taskMaxSteps : this.config.headMaxSteps,
      callTool: async (name, args) => {
        if (abort.signal.aborted) return 'error: this run was stopped';
        if (ended) return 'error: your turn is over; stop here.';
        if (!allowed.has(name)) return `error: you cannot use "${name}"; your tools are ${[...allowed].join(', ')}`;
        // A cancelled worker may still tell the user where it got to and finish; everything else is refused.
        if (worker?.cancelRequested && name !== 'say' && name !== 'finish_task' && name !== 'note' && !this.effects.get(name)?.spec.readonly) {
          return 'cancel requested: wrap up now: say briefly where you got to if useful, then call finish_task with what you have.';
        }
        // The front limb does not act on its reading of the conversation while the user is still typing:
        // the action waits for them to settle, and if they sent something new meanwhile, a newer run takes over.
        if (this.isFront(limb) && name !== 'note' && name !== 'amend' && !this.effects.get(name)?.spec.readonly) {
          await this.userSettled();
          // A user message this run has not read will wake a newer run; acting now would answer a stale picture.
          if (this.log.since(readSeq).some(e => e.type === 'chat_message' && e.by === 'user')) {
            return 'superseded: the user sent another message after you read the state; a newer run will handle both. Nothing was done. Leave a note if you know something it should, then stop.';
          }
        }
        // A verdict on a given message stays valid whatever newer run started, so amend is never superseded.
        if (runId !== limb.latestRun && name !== 'note' && name !== 'handoff' && name !== 'amend' && !this.effects.get(name)?.spec.readonly) {
          return 'superseded: a newer run of you has woken with newer events and is handling things now. Nothing was done. Leave a note if you know something it should, then stop.';
        }
        this.log.append('tool_called', limb.id, { run: runId, name, summary: describeToolArgs(name, args ?? {}) });
        const result = await this.callTool(limb, runId, readSeq, () => { ended = true; }, name, args ?? {});
        const ok = toolResultOk(result);
        // Busy workers hear about steers, discoveries and claims with their next tool result, without being stopped.
        const updates = worker && worker.status === 'running' && !ended ? [...worker.notices] : [];
        this.log.append('tool_done', limb.id, { run: runId, name, ok, ...(ok ? {} : { note: result.slice(0, 200) }), ...(updates.length ? { notices: updates.length } : {}) });
        if (worker) this.maybeSummarize(worker);
        return updates.length ? `${result}\n\n[updates while you worked]\n${updates.join('\n')}` : result;
      },
    }).then(result => {
      this.log.append('run_finished', limb.id, { run: runId, ms: Math.round(this.now() - startedAt), usage: result.usage ?? null });
      live.aborts.delete(runId);
      this.wakeIfPending(limb);
      this.finishReview(limb);
      // A worker that ended its turn itself (finished, or asked and waits) is already where it should be.
      if (worker && worker.status === 'running' && !abort.signal.aborted && !ended) {
        if (worker.notices.length) this.wake(worker.id, 'updates arrived');
        else if (result.stopReason === 'max_steps') {
          // Out of turns while still working: continue with the same conversation, up to a cap.
          if (worker.continuations < this.config.taskContinuations) {
            this.log.append('task_continued', worker.id, { continuations: worker.continuations + 1 });
            this.wake(worker.id, 'you ran out of turns in your last run; continue where you left off, and call finish_task when done');
          } else this.finishTask(worker, `stopped after ${worker.continuations} continuations without finishing (step limit)`, 'failed');
        } else if (worker.asking !== undefined && !worker.cancelRequested) {
          // It asked the user something it needs: it waits for the answer, which wakes it (see steer), instead of finishing.
        } else this.finishTask(worker, result.text?.trim() || this.lastSaidBy(worker.id) || 'ended without a summary', worker.cancelRequested ? 'cancelled' : 'done');
      }
    }, error => {
      const aborted = abort.signal.aborted;
      // What the steps before the failure used is spent all the same; a mind can attach it to the error.
      const used = (error as { usage?: ModelUsage } | null)?.usage;
      this.log.append('run_finished', limb.id, { run: runId, ms: Math.round(this.now() - startedAt), ...(aborted || this.status !== 'running' ? { aborted: true } : { failed: true }), ...(used ? { usage: used } : {}) });
      live.aborts.delete(runId);
      // The conversation may not hold what this run was shown, so the next wake shows everything again.
      live.sent = undefined;
      this.wakeIfPending(limb);
      const crashed = !aborted && this.status === 'running';
      const retry = crashed && this.recentCrashes(limb) < this.config.restartMax;
      // A review that crashed or was aborted checked nothing: never show its answers as confirmed. Retried, it looks again.
      this.abandonReview(limb, aborted ? 'aborted' : retry ? 'retry' : 'failed');
      if (!crashed) {
        // Paused mid-run: if the session was resumed before this run wound down, resume() found it still busy and skipped it.
        if (this.status === 'running' && worker && worker.status === 'running' && !worker.runs.length && worker.asking === undefined) this.wake(worker.id, 'resumed');
        return;
      }
      this.crashed(limb, error instanceof Error ? error.message : String(error), why, runId, shownFrom);
    });
  }

  private systemPrompt(limb: LlmLimb): string {
    const code = this.config.codeLimbs;
    switch (limb.role) {
      case 'reviewer': return reviewerSystemPrompt(this.channels);
      case 'voice': return voiceSystemPrompt(this.channels, this.config.review !== 'off');
      case 'task': return taskSystemPrompt(this.channels, limb.group ? this.state.batches[limb.group]?.title : undefined, code);
      default: return headSystemPrompt(this.channels, !!this.limb('voice'), this.config.review === 'head', this.config.review === 'separate', code);
    }
  }

  private wakeIfPending(limb: LlmLimb): void {
    const live = this.liveOf(limb.id);
    if (!live.wakeAfterRun || limb.runs.length || limb.status !== 'running') return;
    const reason = live.wakeAfterRun;
    live.wakeAfterRun = undefined;
    this.wake(limb.id, reason);
  }

  private recentCrashes(limb: LlmLimb): number {
    const now = this.now();
    return limb.crashes.filter(t => now - t < this.config.restartWindowMs).length;
  }

  /**
   * A run that failed (a provider error, say) is retried, at most restartMax times in restartWindowMs. A worker
   * continues its conversation; the head and voice run again for what woke them, unless a newer run already took
   * over; a review goes back to the queue. Past the cap a worker fails, and the others wait for the next event.
   */
  private crashed(limb: LlmLimb, message: string, reason: string, runId: string, shownFrom: number): void {
    const retry = this.recentCrashes(limb) < this.config.restartMax;
    this.log.append('limb_failed', limb.id, { error: message.slice(0, 500), retry, ...(retry ? { shown_from: shownFrom } : {}) });
    this.addHealth(`${limb.id} crashed: ${message.slice(0, 200)}`);
    if (!retry) {
      if (limb.role === 'task') this.finishTask(limb, `failed: ${message}`, 'failed');
      return;
    }
    const why = `retry after a crash (${message.slice(0, 120)}): ${reason}`;
    if (limb.role === 'task') { if (limb.status === 'running') this.wake(limb.id, why); }
    else if (limb.role !== 'reviewer' && limb.latestRun === runId) this.wake(limb.id, why);
  }

  private finishTask(limb: WorkerLimb, result: string, status: 'done' | 'failed' | 'cancelled' | 'killed'): void {
    if (!WORKER_ACTIVE.includes(limb.status)) return;
    const keptBefore = [...this.state.kept];
    this.log.append('task_done', limb.id, { status, result: result.slice(0, 4000), task: limb.task ?? '' });
    // Conversations are kept for the most recent finished workers only; failed and stopped ones are dropped at once.
    for (const id of keptBefore) if (!this.state.kept.includes(id) && id !== limb.id) this.mind.forget?.(id);
    if (status !== 'done') this.mind.forget?.(limb.id);
    for (const child of this.children(limb.id)) this.stopLimb(child.id, limb.id);
    this.releaseClaims(limb.id);
    // Workers answer the user themselves; the head is only woken to orchestrate.
    for (const waiting of this.workers()) {
      if (waiting.waitFor !== limb.id || waiting.status !== 'waiting') continue;
      const released = `${limb.id} finished (${status}): ${result.slice(0, 500)}`;
      if (this.workerSlots() <= 0) { this.log.append('limb_queued', 'system', { id: waiting.id, after: limb.id, note: released }); continue; }
      this.log.append('limb_started', 'system', { id: waiting.id, after: limb.id });
      this.wake(waiting.id, released);
    }
    this.startQueued();
    this.updateBatch(limb.group);
    if (status === 'done' && limb.later.length) {
      this.log.append('limb_revived', 'system', { id: limb.id, later: limb.later.length });
      const reason = 'you finished; next, continue with what was queued for after that';
      if (limb.runs.length) this.liveOf(limb.id).wakeAfterRun = reason; else this.wake(limb.id, reason);
    }
  }

  /** A worker for one user message, started at once (or when the worker it waits for finishes). */
  private dispatch(by: LlmLimb, args: { task: string; name?: string; model?: string; after?: string; reply_to?: number; fork_of?: string; group?: string }): string {
    const queued = this.workers().filter(l => l.status === 'queued').length;
    if (queued >= MAX_QUEUED) return `error: ${queued} workers are already queued (max ${MAX_QUEUED}); cancel some first`;
    if (args.after && !this.workerOf(args.after)) return `error: no worker "${args.after}" to wait for`;
    const source = args.fork_of ? this.workerOf(args.fork_of) : undefined;
    if (args.fork_of && !source) return `error: no worker "${args.fork_of}" to fork`;
    const id = this.nextId('worker');
    if (source && !this.mind.fork?.(source.id, id)) return `error: ${source.id}'s conversation is no longer kept; dispatch a fresh worker instead`;
    const model = args.model === 'head' ? this.options.models.head : this.options.models.task;
    const name = args.name ?? (source ? `${source.name} (fork)` : 'worker');
    const target = args.after ? this.workerOf(args.after) : undefined;
    const gated = !!target && WORKER_ACTIVE.includes(target.status);
    // Workers past the concurrency limit wait in a queue and start, oldest first, as others finish.
    const status: LimbStatus = gated ? 'waiting' : this.workerSlots() > 0 ? 'running' : 'queued';
    this.log.append('limb_spawned', by.id, {
      id, name, task: args.task, model, status, reply_to: args.reply_to ?? this.lastUserMessageSeq() ?? null,
      fork_of: source?.id ?? null, after: args.after ?? null, group: args.group ?? null,
    });
    if (gated) return `worker ${id} "${name}" will start when ${target.id} finishes`;
    if (status === 'queued') return `worker ${id} "${name}" queued: ${this.config.maxTasks} workers are running; it starts when one finishes`;
    this.wake(id, source ? `forked from ${source.id} for a new request` : 'task assigned');
    return `worker ${id} "${name}" started${source ? ` from ${source.id}'s conversation` : ''}`;
  }

  /** Many workers at once, one per item, as one batch that views can show together. */
  private dispatchMany(by: LlmLimb, args: { title?: string; batch?: string; reply_to?: number; items: { task: string; name?: string }[]; model?: string }): string {
    if (!args.items.length) return 'error: items is empty';
    const extending = args.batch !== undefined;
    if (extending && !this.state.batches[args.batch!]) return `error: no batch "${args.batch}"; batches: ${Object.keys(this.state.batches).join(', ') || 'none'}`;
    if (!extending && !args.title?.trim()) return 'error: a new batch needs a title';
    const group = args.batch ?? this.nextId('group');
    const replyTo = args.reply_to ?? this.lastUserMessageSeq();
    // More items for a batch keep its one progress line; a batch that had ended is running again.
    if (extending) this.log.append('group_extended', by.id, { id: group, count: args.items.length, reply_to: replyTo ?? null });
    else this.log.append('group_started', by.id, { id: group, title: args.title, count: args.items.length, reply_to: replyTo ?? null });
    const results = args.items.map(item => this.dispatch(by, { task: item.task, name: item.name, model: args.model, group, reply_to: replyTo }));
    // One line in the chat for the whole batch, updated as its workers start and finish.
    if (extending) this.updateBatch(group);
    else {
      this.log.append('chat_message', by.id, { text: this.batchProgress(group), group, ...(replyTo !== undefined ? { reply_to: replyTo } : {}) });
      // Workers that finished before the line existed were not counted as the batch's end; count them now.
      this.updateBatch(group);
    }
    const errors = results.filter(r => r.startsWith('error'));
    const queued = results.filter(r => r.includes(' queued')).length;
    const title = this.state.batches[group]?.title ?? args.title;
    return `${group} "${title}": ${extending ? 'added ' : ''}${results.length - errors.length} workers (${results.length - errors.length - queued} started, ${queued} queued)${errors.length ? `; ${errors.length} failed: ${errors[0]}` : ''}`;
  }

  private batchProgress(group: string): string {
    const batch = this.state.batches[group];
    const members = this.workers().filter(l => l.group === group);
    const count = (...statuses: LimbStatus[]) => members.filter(l => statuses.includes(l.status)).length;
    const failed = members.filter(l => l.status === 'failed' || l.status === 'killed');
    const parts = [`${count('done')} of ${members.length} done`];
    if (count('running')) parts.push(`${count('running')} running`);
    if (count('queued')) parts.push(`${count('queued')} queued`);
    if (failed.length) parts.push(`${failed.length} failed${failed.length <= 3 ? ` (${failed.map(l => l.name).join(', ')})` : ''}`);
    if (count('cancelled')) parts.push(`${count('cancelled')} cancelled`);
    return `${batch.title}: ${parts.join(', ')}.`;
  }

  /** Keeps a batch's progress line current; when the last worker ends, wakes the front limb with the results. */
  private updateBatch(group: string | undefined): void {
    const batch = group ? this.state.batches[group] : undefined;
    if (!group || !batch || batch.message === undefined || batch.ended) return;
    const text = this.batchProgress(group);
    if (text !== batch.text) this.log.append('chat_message_updated', 'system', { seq: batch.message, text, group });
    const members = this.workers().filter(l => l.group === group);
    if (members.some(l => WORKER_ACTIVE.includes(l.status))) return;
    this.log.append('group_finished', 'system', { id: group });
    const results = members.map(l => `${l.name}: ${l.status}${l.result ? `: ${l.result.slice(0, 160)}` : ''}`).slice(0, 60).join('\n');
    this.wake(this.frontLimb(), `batch "${batch.title}" finished. ${text}\nResults:\n${results}`);
  }

  /** Running workers take a slot; queued and waiting ones don't. */
  private workerSlots(): number {
    return this.config.maxTasks - this.workers().filter(l => l.status === 'running').length;
  }

  private startQueued(): void {
    const queue = this.workers().filter(l => l.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
    for (const limb of queue) {
      if (this.workerSlots() <= 0) return;
      this.log.append('limb_started', 'system', { id: limb.id });
      this.updateBatch(limb.group);
      this.wake(limb.id, 'task assigned');
    }
  }

  /** A message for one worker, delivered with its next tool result (or reviving it if idle). */
  private steer(by: string, id: string, text: string, when: 'now' | 'after' = 'now'): string {
    const limb = this.workerOf(id);
    if (!limb) return `error: no worker "${id}"`;
    const active = WORKER_ACTIVE.includes(limb.status);
    if (!active && (limb.status !== 'done' || !this.state.kept.includes(limb.id))) return `error: ${id} is ${limb.status} and its conversation is gone; dispatch a fresh worker instead`;
    this.log.append('steered', by, { id, text, ...(when === 'after' ? { when } : {}) });
    // More work for later: the worker finishes what it is doing first, then continues in the same conversation.
    if (when === 'after' && active) return `${id} will continue with this once it finishes its current work`;
    if (limb.status === 'queued' || limb.status === 'waiting') return `${id} is ${limb.status === 'queued' ? 'queued' : `waiting for ${limb.waitFor}`}; it gets this when it starts`;
    if (limb.status === 'running' && limb.runs.length) return `${id} will get it with its next tool result`;
    if (limb.status === 'running') { this.wake(limb.id, ''); return `${id} woken with it`; }
    this.log.append('limb_revived', by, { id, reply_to: this.lastUserMessageSeq() ?? null });
    this.wake(limb.id, '');
    return `${id} picked the conversation back up`;
  }

  /** Resolves once the user is not typing (draft quiet for messageSettleMs), or after messageSettleMaxMs. */
  private async userSettled(): Promise<void> {
    const started = this.now();
    for (;;) {
      const typing = this.levels.get('user.typing') !== undefined;
      const quietFor = this.now() - (this.state.lastEvents['user:draft_changed'] ?? -Infinity);
      if (!typing || quietFor >= this.config.messageSettleMs || this.now() - started >= this.config.messageSettleMaxMs || this.status !== 'running') return;
      await new Promise(resolve => setTimeout(resolve, Math.min(100, this.config.messageSettleMs - quietFor + 5)));
    }
  }

  /**
   * The user overrides how a message was routed: it gets its own fresh worker, or a fork of the worker it was steered to.
   * A worker that was steered with it is told to leave it to the new one.
   */
  reroute(seq: number, how: 'separate' | 'fork'): string {
    const message = this.log.all().find(e => e.seq === seq && e.type === 'chat_message' && e.by === 'user');
    if (!message) return `error: #${seq} is not a message from the user`;
    const next = this.log.all().find(e => e.type === 'chat_message' && e.by === 'user' && e.seq > seq);
    const steer = this.log.all().find(e => e.type === 'steered' && e.by !== 'user' && e.seq > seq && (!next || e.seq < next.seq));
    const steered = steer ? this.workerOf(String(steer.data.id)) : undefined;
    if (how === 'fork' && !steered) return `error: #${seq} was not sent to a worker, so there is nothing to fork`;
    const text = String(message.data.text);
    const result = this.dispatch(this.llm('head')!, {
      task: `${text}\n\n(The user asked for this to be handled by its own worker${how === 'fork' ? `, continuing from ${steered!.id}'s conversation` : ''}.)`,
      name: text.slice(0, 40), reply_to: seq, fork_of: how === 'fork' ? steered!.id : undefined,
    });
    if (result.startsWith('error')) return result;
    this.log.append('rerouted', 'user', { seq, how, from: steered?.id ?? null, text: text.slice(0, 200) });
    return result;
  }

  /** A message from the user straight to one worker (the Work view's "Message"). */
  messageWorker(id: string, text: string): string { return this.steer('user', id, text); }

  /** The user renames a worker; every view and every limb's state use the new name. */
  renameWorker(id: string, name: string): string {
    const worker = this.workerOf(id);
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!worker) return `error: no worker "${id}"`;
    if (!clean) return 'error: the name is empty';
    if (clean !== worker.name) this.log.append('limb_renamed', 'user', { id, name: clean });
    return `${id} is now "${clean}"`;
  }

  /** Stops a worker on the user's request (the Work view's "Stop"). */
  stopWorker(id: string): string {
    if (!this.workerOf(id)) return `error: no worker "${id}"`;
    return this.stopLimb(id, 'user');
  }

  private maybeSummarize(limb: WorkerLimb): void {
    const summarizer = this.options.summarizer;
    const live = this.liveOf(limb.id);
    live.callsSinceSummary++;
    if (!summarizer || live.summarizing || limb.status !== 'running' || this.summaries >= this.config.summaryMax) return;
    if (live.callsSinceSummary < this.config.summaryEveryCalls || this.now() - live.lastSummaryAt < this.config.summaryIntervalMs) return;
    live.summarizing = true;
    live.callsSinceSummary = 0;
    live.lastSummaryAt = this.now();
    this.summaries++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    summarizer.summarize({ task: limb.task ?? '', activity: this.activityOf(limb) }, controller.signal)
      .then(summary => {
        if (this.status === 'idle') return;
        this.log.append('work_summary', 'system', { limb: limb.id, ...clean(summary) });
        if (summary.usage) this.log.append('usage', 'system', { kind: 'summaries', limb: limb.id, ...summary.usage });
      })
      .catch(error => { if (this.status !== 'idle') this.addHealth(`summary for ${limb.id} failed: ${error instanceof Error ? error.message : String(error)}`); })
      .finally(() => { clearTimeout(timer); live.summarizing = false; });
  }

  /** What a worker has done so far, in order, for the summarizer. */
  private activityOf(limb: WorkerLimb): string {
    const lines: string[] = [];
    for (const e of this.log.all()) {
      if (e.by === limb.id && e.type === 'tool_called') lines.push(`called ${e.data.name}${e.data.summary ? `: ${e.data.summary}` : ''}`);
      else if (e.by === limb.id && e.type === 'tool_done' && !e.data.ok) lines.push(`  -> not done: ${e.data.note}`);
      else if (e.by === limb.id && e.type === 'chat_message') lines.push(`said to the user: ${String(e.data.text).slice(0, 300)}`);
      else if (e.type === 'steered' && e.data.id === limb.id) lines.push(`the user said: ${String(e.data.text).slice(0, 300)}`);
    }
    return lines.slice(-60).join('\n');
  }

  /** The last thing a limb said to the user, as a fallback result. */
  private lastSaidBy(id: string): string | undefined {
    const all = this.log.all();
    for (let i = all.length - 1; i >= 0; i--) if (all[i].type === 'chat_message' && all[i].by === id) return String(all[i].data.text).slice(0, 500);
    return undefined;
  }

  private lastUserMessageSeq(): number | undefined {
    const all = this.log.all();
    for (let i = all.length - 1; i >= 0; i--) if (all[i].type === 'chat_message' && all[i].by === 'user') return all[i].seq;
    return undefined;
  }

  /** Claims the paths for a limb, or says which one another limb holds. */
  private claimPaths(limb: LlmLimb, paths: string[], note: string): { path: string; holder: Claim; text: string } | null {
    for (const path of paths) {
      const holder = this.claimHolder(path, limb.id);
      if (holder) return { path, holder, text: `"${path}" is claimed by ${holder.limb} (${holder.note || 'no note'}) since ${this.ago(holder.since)}` };
    }
    for (const path of paths) if (this.state.claims[path]?.limb !== limb.id) this.log.append('claimed', limb.id, { path, note });
    return null;
  }

  /** Another running limb's claim that overlaps this path (same path, or one contains the other). */
  private claimHolder(path: string, self: string): Claim | undefined {
    const norm = (p: string) => p.replace(/^\.?\/+/, '').replace(/\/+$/, '');
    const target = norm(path);
    for (const claim of Object.values(this.state.claims)) {
      if (claim.limb === self || this.limb(claim.limb)?.status !== 'running') continue;
      const held = norm(claim.path);
      if (held === target || target.startsWith(`${held}/`) || held.startsWith(`${target}/`) || held === '') return claim;
    }
    return undefined;
  }

  private releaseClaims(limbId: string, paths?: string[]): number {
    const released = Object.values(this.state.claims).filter(c => c.limb === limbId && (!paths || paths.includes(c.path))).map(c => c.path);
    if (released.length) this.log.append('released', limbId, { count: released.length, paths: released });
    return released.length;
  }

  /**
   * Stops a worker or a code limb. A worker gets cancelGraceMs to wrap up and is then killed;
   * `now` kills it at once, dropping partial work. Everything up to then stays in the log.
   */
  stopLimb(id: string, by: string, now = false): string {
    const ended = now ? 'killed' : 'cancelled';
    const code = this.limb(id);
    if (code?.kind === 'code') {
      if (code.status !== 'running') return `${id} is already ${code.status}`;
      this.endCodeLimb(code, ended, `${ended} by ${by}`);
      return `${id} ${ended}`;
    }
    const limb = this.workerOf(id);
    if (!limb) return `error: no limb "${id}" to stop`;
    if (limb.status === 'queued' || limb.status === 'waiting') { this.finishTask(limb, `${ended} by ${by} before it started`, ended); return `${id} ${ended} before it started`; }
    if (limb.status !== 'running') return `${id} is already ${limb.status}`;
    if (now || !limb.runs.length) {
      for (const abort of this.liveOf(limb.id).aborts.values()) abort.abort();
      this.finishTask(limb, `${ended} by ${by}`, ended);
      return `${id} ${ended}`;
    }
    if (limb.cancelRequested) return `${id} is already wrapping up`;
    this.log.append('cancel_requested', by, { id });
    const timer = setTimeout(() => { this.timers.delete(timer); if (limb.status === 'running') this.stopLimb(id, `${by} (grace period over)`, true); }, this.config.cancelGraceMs);
    this.timers.add(timer);
    return `${id}: cancel requested; it will be stopped in ${this.config.cancelGraceMs / 1000} s if it does not finish`;
  }

  private endCodeLimb(limb: CodeLimb, status: LimbStatus, reason: string, result?: unknown): void {
    if (limb.status !== 'running') return;
    const live = this.liveOf(limb.id);
    live.program?.abort();
    // Every sense it asked, as a trigger, a condition or from code; the ones nobody asks any more are cleared through the log.
    const dropped = this.jev.release(limb.id);
    if (dropped.length) this.log.append('senses_dropped', 'system', { levels: dropped });
    const type = limb.role === 'program'
      ? status === 'done' ? 'program_finished' : status === 'failed' ? 'program_failed' : 'program_cancelled'
      : 'watch_removed';
    this.log.append(type, limb.id, { id: limb.id, name: limb.name, status, reason, ...(result !== undefined ? { result: result as never } : {}) });
  }

  /** A runtime tool or channel effect called by an LLM limb. Whether it may use it was checked against runtimeTools already. */
  private callTool(limb: LlmLimb, runId: string, readSeq: number, endTurn: () => void, name: string, args: Record<string, unknown>): Promise<string> | string {
    const caller: Caller = { limbId: limb.id, kind: 'llm', runId, readSeq };
    const worker = limb.role === 'task' ? limb : undefined;
    const schema = TOOL_SCHEMAS[name as ToolName];
    // The simple tools read their arguments leniently; the ones that start things are validated.
    if (schema && ['run_program', 'dispatch', 'dispatch_many', 'fork', 'amend'].includes(name)) {
      const error = validate(schema, args, 'args');
      if (error) return `error: ${error}`;
    }
    switch (name as ToolName) {
      case 'set_watch':
        return this.installWatch(limb, (args.watch ?? args) as WatchSpec, false, this.now());
      case 'run_program': {
        const started = this.startProgram(limb, String(args.name), String(args.code), this.now(), args.label === undefined ? undefined : String(args.label));
        if (started.error || !started.limb || !started.done) return `error: ${started.error}`;
        const program = started.limb;
        // Surface compile errors and instant crashes directly in the tool result.
        return Promise.race([started.done, new Promise<null>(r => setTimeout(() => r(null), 60))]).then(outcome =>
          outcome && outcome.status === 'failed' ? `error: program failed immediately: ${outcome.error}` : `program ${program.id} "${program.name}" running`);
      }
      case 'stop_output': {
        const stop = this.stopOutput(limb.id, (args.scope as StopScope) ?? 'work', (args.mode as StopMode) ?? 'stop', String(args.reason ?? 'stopped'), limb.id);
        return `output ${stop.mode === 'freeze' ? 'frozen' : 'stopped'} (${stop.scope})`;
      }
      case 'resume_output': return `resumed ${this.resumeOutput(limb.id, limb.id)} stop(s)`;
      case 'note': this.log.append('note', limb.id, { text: String(args.text ?? '').slice(0, 500) }); return 'noted';
      case 'set_timer': {
        const ms = Math.max(0, Math.min(Number(args.after_ms) || 0, 3_600_000));
        const label = String(args.label ?? 'timer');
        const id = this.nextId('timer');
        this.log.append('timer_set', limb.id, { id, label, limb: limb.id, after_ms: ms });
        this.armTimer(id, label, limb.id, ms);
        return `timer "${label}" set for ${ms} ms`;
      }
      case 'cancel': {
        const target = String(args.id ?? '');
        // The front limb and the head may stop any worker; every limb may stop its own watches and programs.
        const anyWorker = (this.isFront(limb) || limb.id === 'head') && !!this.workerOf(target);
        if (!anyWorker && (!this.isWithin(target, limb.id) || target === limb.id)) return `error: ${target} is not one of your children`;
        const code = this.limb(target);
        if (code?.role === 'watch' && code.builtin) return `error: ${target} is built into the runtime and cannot be cancelled`;
        return this.stopLimb(target, limb.id, args.now === true);
      }
      case 'dispatch':
      case 'fork':
        return this.dispatch(limb, { ...(args as { task: string }), fork_of: name === 'fork' ? String(args.worker) : undefined });
      case 'dispatch_many':
        return this.dispatchMany(limb, args as { title?: string; batch?: string; reply_to?: number; items: { task: string; name?: string }[]; model?: string });
      case 'steer':
        return this.steer(limb.id, String(args.worker ?? ''), String(args.text ?? ''), args.when === 'after' ? 'after' : 'now');
      case 'claim': {
        const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
        const refused = this.claimPaths(limb, paths, String(args.note ?? ''));
        return refused ? `refused: ${refused.text}` : `claimed ${paths.join(', ')}`;
      }
      case 'release': return `released ${this.releaseClaims(limb.id, Array.isArray(args.paths) ? args.paths.map(String) : undefined)} claim(s)`;
      case 'share':
        this.log.append('discovery', limb.id, { text: String(args.text ?? '').slice(0, 1000) });
        return 'shared with the other workers';
      case 'amend':
        return this.amend(limb, args as { seq: number; verdict: string; text?: string });
      case 'handoff':
        this.log.append('handoff', limb.id, { note: String(args.note ?? '').slice(0, 2000) });
        this.wake('head', `${limb.role} handed off: ${String(args.note ?? '').slice(0, 300)}`);
        return 'handed off to the head';
      case 'ask': {
        if (!worker) return 'error: only workers ask';
        // Posted in the main chat even for a batch worker: the user must see it to answer.
        return this.commit(caller, 'say', { text: String(args.question ?? ''), question: true, thread: false, ...(worker.replyTo !== undefined ? { reply_to: worker.replyTo } : {}) }).then(result => {
          if (!result.startsWith('sent')) return result;
          endTurn();
          return 'asked; you wait for the answer, which wakes you';
        });
      }
      case 'finish_task':
        if (!worker) return 'error: only workers finish tasks';
        endTurn();
        this.finishTask(worker, String(args.result ?? ''), worker.cancelRequested ? 'cancelled' : 'done');
        return 'task finished';
      default:
        if (worker && name === 'say' && args.reply_to === undefined && worker.replyTo !== undefined) args = { ...args, reply_to: worker.replyTo };
        if (worker && name === 'say' && worker.group && args.thread === undefined) args = { ...args, thread: true };
        return this.commit(caller, name, args);
    }
  }

  /** Channel effects the limb may use, then its runtime tools from the per-role table (tools.ts). */
  private toolsFor(limb: LlmLimb): ToolSpec[] {
    const tools: ToolSpec[] = [];
    for (const { spec } of this.effects.values()) {
      if (!mayUseEffect(limb.role, spec)) continue;
      tools.push({ name: spec.name, description: `${spec.description}${spec.risk === 'reflex' ? ' (reflex-safe)' : ''}`, parameters: toJsonSchema(spec.parameters) });
    }
    for (const name of runtimeTools({ role: limb.role, codeLimbs: this.config.codeLimbs, review: this.config.review })) {
      const description = TOOL_DESCRIPTIONS[name];
      tools.push({ name, description: typeof description === 'function' ? description(limb.role) : description, parameters: toJsonSchema(TOOL_SCHEMAS[name]) });
    }
    return tools;
  }

  // ---------- rendering ----------

  private ago = (t: number) => `${((this.now() - t) / 1000).toFixed(1)}s ago`;

  /**
   * A limb's context for one wake, ordered for prompt caching: what rarely changes first, then live state, new events and time.
   * Reactive limbs get it whole every time. A worker keeps its conversation, so after its first wake it only gets
   * the parts that changed.
   */
  private render(limb: LlmLimb, reason: string): string {
    const now = this.now();
    const ctx = { now, ago: this.ago, levels: this.levels };
    const stable: Record<string, unknown> = { you: `${limb.id} (${limb.role})` };
    if (limb.role === 'task') stable.task = limb.task;
    const volatile: Record<string, unknown> = {};
    for (const channel of this.channels) {
      const rendered = channel.render(this.world[channel.name] as never, ctx);
      if (rendered.stable !== undefined) stable[channel.name] = rendered.stable;
      if (rendered.volatile !== undefined) volatile[channel.name] = rendered.volatile;
    }
    stable.notes = this.state.notes;
    if (this.state.discoveries.length) stable.discoveries = this.state.discoveries.map(d => `${d.by}: ${d.text}`);
    // Workers have their own section; this lists the rest: the head, voice and reviewer, and watches and programs.
    const others = this.limbList().filter((l): l is ReactiveLimb | CodeLimb => l.role !== 'task' && (l.status === 'running' || now - l.createdAt < 60_000));
    if (others.length) stable.limbs = others.map(l => this.describeLimb(l));
    const workers = this.workerLines(limb);
    if (workers.length) stable.workers = workers;
    const busy = this.limbList().filter(l => l.kind === 'llm' && l.runs.length).map(l => l.id);
    if (busy.length) volatile.working_now = busy;
    const fires = Object.fromEntries(others.flatMap(l => (l.role === 'watch' && l.fires ? [[l.id, l.fires]] : [])));
    if (Object.keys(fires).length) volatile.watch_fires = fires;
    const levels = this.levels.entries();
    if (levels.length) volatile.levels = Object.fromEntries(levels.map(([name, level]) => [name, `${JSON.stringify(level.value)} for ${((now - level.since) / 1000).toFixed(1)}s`]));
    if (this.state.stops.length) volatile.output_stops = this.state.stops.map(s => ({ ...s, since: this.ago(s.since) }));
    if (this.state.health.length) volatile.health = this.state.health.slice(-5).map(h => `${h.message} (${this.ago(h.t)})`);

    let stableOut = stable;
    let volatileOut = volatile;
    let note = '';
    if (limb.role === 'task') {
      const live = this.liveOf(limb.id);
      const sections: Record<string, string> = {};
      for (const [key, value] of Object.entries(stable)) sections[`stable.${key}`] = JSON.stringify(value);
      for (const [key, value] of Object.entries(volatile)) sections[`live.${key}`] = JSON.stringify(value);
      if (live.sent) {
        const changed = (prefix: string, part: Record<string, unknown>) => {
          const out: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(part)) if (live.sent![`${prefix}.${key}`] !== sections[`${prefix}.${key}`]) out[key] = value;
          for (const key of Object.keys(live.sent!)) if (key.startsWith(`${prefix}.`) && !(key in sections)) out[key.slice(prefix.length + 1)] = null;
          return out;
        };
        stableOut = changed('stable', stable);
        volatileOut = changed('live', volatile);
        note = ', only what changed since your last wake';
      }
      live.sent = sections;
    }
    const fresh = this.log.since(limb.seenSeq).filter(e => !HIDDEN_EVENTS.has(e.type)).slice(-this.config.recentEvents);
    const time = { now_s: +(now / 1000).toFixed(1), last_spoke: this.lastSpoke(), woken_because: reason };
    return [
      `STATE (stable${note})`, JSON.stringify(stableOut),
      `STATE (live${note})`, JSON.stringify(volatileOut),
      'NEW EVENTS since your last wake', fresh.map(e => `#${e.seq} ${this.ago(e.t)} ${e.by} ${e.type} ${eventData(e)}`).join('\n') || '(none)',
      'TIME', JSON.stringify(time),
    ].join('\n');
  }

  /**
   * One line per worker. The front limb and head see every active worker with its task, and recent and kept finished
   * ones with their result. A worker sees its active siblings without their tasks, and only the last few finished.
   */
  private workerLines(viewer: LlmLimb): string[] {
    const tasks = this.workers().filter(l => l.id !== viewer.id);
    const active = tasks.filter(l => WORKER_ACTIVE.includes(l.status));
    const finished = tasks.filter(l => !WORKER_ACTIVE.includes(l.status)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
    const worker = viewer.role === 'task';
    const shownFinished = worker ? finished.slice(0, 5) : finished.filter((l, i) => i < 10 || this.state.kept.includes(l.id));
    const shownActive = worker ? active.slice(0, 30) : active;
    const line = (l: WorkerLimb) => {
      const claims = this.claimsOf(l.id);
      const batch = l.group ? this.state.batches[l.group]?.title : undefined;
      return [
        `${l.id} "${l.name}" ${l.status}${l.waitFor ? ` for ${l.waitFor}` : ''}`,
        !worker && l.replyTo !== undefined ? `re #${l.replyTo}` : '',
        batch ? `batch ${l.group} "${batch}"` : '',
        !worker && !batch && l.task && WORKER_ACTIVE.includes(l.status) ? `task: ${clip(l.task, 240)}` : '',
        l.result ? `result: ${clip(l.result, 240)}` : '',
        claims.length ? `claims: ${claims.join(', ')}` : '',
      ].filter(Boolean).join(' · ');
    };
    const lines = [...shownActive, ...shownFinished].map(line);
    const hidden = active.length - shownActive.length + finished.length - shownFinished.length;
    if (hidden) lines.push(`(${hidden} more not shown)`);
    return lines;
  }

  private describeLimb(limb: ReactiveLimb | CodeLimb): string {
    const base = `${limb.id} ${limb.role === 'watch' && limb.builtin ? 'built-in ' : ''}${limb.role} "${limb.name}" ${limb.status}${limb.parent ? ` (parent ${limb.parent})` : ''}`;
    if (limb.role === 'watch') return `${base}: on ${JSON.stringify(limb.watch.on)} do ${JSON.stringify(limb.watch.do)}`;
    if (limb.role === 'program') return `${base}, started at ${(limb.createdAt / 1000).toFixed(1)}s`;
    return base;
  }

  private lastSpoke(): string | null {
    const all = this.log.all();
    for (let i = all.length - 1; i >= 0; i--) if (all[i].type === 'chat_message' && isEntityActor(all[i].by)) return this.ago(all[i].t);
    return null;
  }

  private renderForJev(): string {
    const ctx = { now: this.now(), ago: this.ago, levels: this.levels };
    return JSON.stringify(Object.fromEntries(this.channels.map(c => [c.name, c.render(this.world[c.name] as never, ctx)])));
  }

  // ---------- helpers ----------

  private enrich(type: string, data: Record<string, unknown>): Record<string, unknown> {
    let result = data;
    for (const channel of this.channels) if (channel.enrich) result = channel.enrich(this.world[channel.name] as never, type, result, this.now());
    return result;
  }

  /** The next id with this prefix. Ids count up across all kinds, and the log is what advances the counter. */
  private nextId(prefix: string): string { return `${prefix}-${this.state.counter + 1}`; }

  private limb(id: string): LimbState | undefined { return this.state.limbs[id]; }
  private llm(id: string): LlmLimb | undefined { const l = this.state.limbs[id]; return l?.kind === 'llm' ? l : undefined; }
  private workerOf(id: string): WorkerLimb | undefined { const l = this.state.limbs[id]; return l?.role === 'task' ? l : undefined; }
  private limbList(): LimbState[] { return Object.values(this.state.limbs); }
  private workers(): WorkerLimb[] { return this.limbList().filter((l): l is WorkerLimb => l.role === 'task'); }
  private watches(): WatchLimb[] { return this.limbList().filter((l): l is WatchLimb => l.role === 'watch'); }
  private children(id: string): LimbState[] { return this.limbList().filter(l => l.parent === id); }
  private claimsOf(id: string): string[] { return Object.values(this.state.claims).filter(c => c.limb === id).map(c => c.path); }

  private liveOf(id: string): LimbLive {
    let live = this.live.get(id);
    if (!live) { live = { aborts: new Map(), effectTimes: [], callsSinceSummary: 0, lastSummaryAt: -Infinity }; this.live.set(id, live); }
    return live;
  }

  private isFront(limb: LimbState): boolean { return limb.id === this.frontLimb(); }

  /** Who answers first: the voice limb when configured, otherwise the head. */
  private frontLimb(): string { return this.limb('voice') ? 'voice' : 'head'; }

  private isWithin(id: string, ancestor: string): boolean {
    for (let current: string | undefined = id; current; current = this.limb(current)?.parent) if (current === ancestor) return true;
    return false;
  }

  private countCode(): number { return this.limbList().filter(l => l.kind === 'code' && l.status === 'running').length; }

  private addHealth(message: string): void {
    // The same warning over and over (a Jev cap, a failing watch) is logged once every few seconds, not per occurrence.
    const last = this.state.health[this.state.health.length - 1];
    if (last && last.message === message && this.now() - last.t < 5000) return;
    this.log.append('health', 'system', { message });
  }

  private snapshotWorld(): Record<string, unknown> {
    return JSON.parse(JSON.stringify({ world: this.world, levels: Object.fromEntries(this.levels.entries()), notes: this.state.notes }));
  }

  snapshot(): EntitySnapshot {
    const jev = this.jev.stats;
    return {
      status: this.status,
      t: this.now(),
      world: JSON.parse(JSON.stringify(this.world)),
      self: { notes: [...this.state.notes] },
      levels: Object.fromEntries(this.levels.entries()),
      stops: [...this.state.stops],
      health: [...this.state.health],
      limbs: snapshotLimbs(this.state),
      senses: this.jev.list(),
      jev: { available: this.jev.available, calls: jev.calls, perMinute: jev.perMinute },
      usage: { ...this.state.usage },
      usageBy: { summaries: { ...this.state.usageBy.summaries }, senses: { ...this.state.usageBy.senses } },
    };
  }
}

/** Tuned on Jev: complete requests score about 0.4-0.85; fragments, asides and "can you" 0.18 or less. */
export const DRAFT_PAUSE_MS = 700;
export const DRAFT_ATTENTION_QUESTION = 'Does the unsent draft already contain a question or request to the entity that is clear enough to answer or act on?';

const HIDDEN_EVENTS = new Set(['run_started', 'run_finished', 'draft_changed', 'sensed', 'senses_dropped', 'judged', 'program_log', 'tool_called', 'tool_done', 'work_summary', 'usage', 'watch_fired', 'health', 'timer_set', 'review_started', 'review_requeued']);



const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * An event's data for a context. Long text is clipped, except what the user wrote and a handoff's note, which are the point;
 * a new worker's task is left out, since the workers in state already show it.
 */
function eventData(event: EntityEvent): string {
  if ((event.type === 'chat_message' && event.by === 'user') || event.type === 'handoff') return JSON.stringify(event.data);
  const data = event.type === 'limb_spawned' ? { ...event.data, task: undefined } : event.data;
  return JSON.stringify(data, (_key, value) => (typeof value === 'string' ? clip(value, 300) : value));
}

function clean(summary: WorkSummary): Record<string, unknown> {
  const list = (items: unknown) => (Array.isArray(items) ? items : []).map(String).map(s => s.trim()).filter(Boolean).slice(0, 5).map(s => s.slice(0, 160));
  return { done: list(summary.done), doing: list(summary.doing), next: list(summary.next), ...(summary.blocker ? { blocker: String(summary.blocker).slice(0, 200) } : {}) };
}
