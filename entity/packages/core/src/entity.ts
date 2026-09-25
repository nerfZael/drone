import { Levels, type Channel, type EffectSpec } from './channel.js';
import { JevService, type Evaluator, type JevOptions, type SenseInfo } from './jev.js';
import { EventLog, isEntityActor, matches } from './log.js';
import type { Mind, ToolSpec } from './mind.js';
import { describeToolArgs, toolResultOk, type Summarizer, type WorkSummary } from './summary.js';
import { runProgram, type ProgramOutcome } from './program.js';
import { headSystemPrompt, reviewerSystemPrompt, taskSystemPrompt, voiceSystemPrompt } from './prompts.js';
import { initialRuntimeState, reduceRuntime, WORKER_ACTIVE, type Claim, type LimbRole, type LimbState, type LimbStatus, type OutputStop, type RuntimeSetup, type RuntimeState } from './runtime-state.js';
import { toJsonSchema, validate } from './schema.js';
import type { Caller, Capability, EntityEvent, EventMatcher, Schema } from './types.js';
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
  limbs: {
    id: string; kind: string; role: LimbRole; name: string; parent?: string; model?: string; status: LimbStatus;
    runs: { id: string; reason: string; startedAt: number; firstToolAt?: number }[];
    task?: string; result?: string; watch?: WatchSpec; code?: string; fires?: number; label?: string; group?: string;
    createdAt: number; endedAt?: number; replyTo?: number; waitFor?: string; claims: string[];
  }[];
  senses: SenseInfo[];
  jev: { available: boolean; calls: number; perMinute: number };
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

  private init(): void {
    this.startedAt = performance.now();
    this.log = new EventLog(() => this.now());
    this.levels = new Levels(() => this.now());
    this.world = Object.fromEntries(this.channels.map(c => [c.name, c.init()]));
    const { head, task, voice } = this.options.models;
    const setup: RuntimeSetup = { models: { head, task, ...(voice ? { voice } : {}) }, review: this.config.review, codeLimbs: this.config.codeLimbs, keptSessions: this.config.keptSessions };
    this.state = initialRuntimeState(setup);
    this.live = new Map();
    this.summaries = 0;
    this.jev = new JevService(this.options.evaluator, this.log, this.levels, () => this.renderForJev(), m => this.addHealth(m), this.options.jev);
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
      this.installWatch(this.limb(this.frontLimb())!, {
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
    this.wake('head', `resumed after ${Math.round(pausedFor / 1000)} s pause`);
    for (const limb of this.limbList()) if (limb.role === 'task' && limb.status === 'running' && !limb.runs.length) this.wake(limb.id, 'resumed');
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
    reduceRuntime(this.state, event);
    for (const channel of this.channels) channel.reduce(this.world[channel.name] as never, event, { levels: this.levels, now: event.t });
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
    const front = this.limb(this.frontLimb())!;
    const reviewer = this.limb(this.reviewerId());
    if (!reviewer || reviewer.runs.length || front.runs.length) return;
    if (now - (this.state.lastEvents['entity:chat_message'] ?? -Infinity) < this.config.reviewQuietMs) return;
    const seqs = [...unreviewed];
    this.log.append('review_started', 'system', { seqs });
    this.wake(reviewer.id, `review ${seqs.map(seq => `#${seq}`).join(', ')}`);
  }

  /** Answers the reviewer did not amend count as confirmed, so nothing stays "checking" forever. */
  private finishReview(limb: LimbState): void {
    if (limb.id !== this.reviewerId() || !this.state.reviewing.length || limb.runs.length) return;
    for (const seq of [...this.state.reviewing]) this.log.append('message_reviewed', limb.id, { seq, verdict: 'confirmed', implicit: true });
  }

  /** Answers of a review run that did not complete: requeued after a pause, otherwise marked unchecked. */
  private abandonReview(limb: LimbState, why: 'aborted' | 'failed'): void {
    if (limb.id !== this.reviewerId() || !this.state.reviewing.length || limb.runs.length || this.status === 'idle') return;
    const seqs = [...this.state.reviewing];
    if (why === 'aborted' && this.status === 'paused') { this.log.append('review_requeued', 'system', { seqs }); return; }
    for (const seq of seqs) this.log.append('message_reviewed', limb.id, { seq, verdict: 'unchecked', reason: why });
  }

  private amend(limb: LimbState, args: { seq: number; verdict: string; text?: string }): string {
    const original = this.log.all().find(e => e.seq === args.seq && e.type === 'chat_message');
    if (!original || !isEntityActor(original.by)) return `error: #${args.seq} is not one of the entity's messages`;
    const text = String(args.text ?? '').trim();
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
    for (const limb of this.limbList()) {
      if (limb.role !== 'watch' || limb.status !== 'running' || !limb.watch) continue;
      if (limb.expiresAt !== undefined && now >= limb.expiresAt) { this.endCodeLimb(limb, 'done', 'expired'); continue; }
      this.checkLevelWatch(limb, now);
    }
    if (this.config.review !== 'off') this.maybeReview(now);
    // Standing watches and programs of the head (a mirror, the draft sense) need no heartbeat; only work in progress does.
    const active = this.limbList().some(l => l.role === 'task' && WORKER_ACTIVE.includes(l.status));
    const head = this.limb('head')!;
    if (active && !head.runs.length && now - (head.lastRunAt ?? 0) > this.config.headHeartbeatMs) this.wake('head', 'heartbeat');
  }

  // ---------- watches ----------

  private runEventWatches(event: EntityEvent): void {
    for (const limb of this.limbList()) {
      if (limb.role !== 'watch' || limb.status !== 'running' || !limb.watch) continue;
      const on = limb.watch.on;
      if ('event' in on) {
        if (eventMatchesTrigger(event, on, isEntityActor) && this.whenHolds(limb, event.t)) this.fireWatch(limb, event);
      } else this.checkLevelWatch(limb, event.t);
    }
  }

  private checkLevelWatch(limb: LimbState, now: number): void {
    const on = limb.watch!.on;
    if ('event' in on) return;
    const live = this.liveOf(limb.id);
    const triggered = 'level' in on ? levelHolds(on, this.levels, isEntityActor) : senseHolds(this.levels.get(live.sense!.level)?.value as number | undefined, on);
    if (live.tracker!.update(triggered && this.whenHolds(limb, now), now, on.for_ms ?? 0)) this.fireWatch(limb, undefined);
  }

  private whenHolds(limb: LimbState, now: number): boolean {
    const when = limb.watch?.when;
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

  private fireWatch(limb: LimbState, event: EntityEvent | undefined): void {
    const watch = limb.watch!;
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
      this.startProgram(this.limb(limb.parent ?? 'head')!, action.run_program.name, action.run_program.code, limb.decidedAt, action.run_program.label);
    }
    if (watch.once) this.endCodeLimb(limb, 'done', 'fired once');
  }

  private installWatch(author: LimbState, spec: WatchSpec, builtin = false, decidedAt?: number): string {
    const error = validate(watchSchema, spec, 'watch');
    if (error) return `error: invalid watch: ${error}. Nothing installed.`;
    const action = spec.do;
    if ('effect' in action) {
      const effect = this.effects.get(action.effect);
      if (!effect) return `error: unknown effect "${action.effect}" (known: ${[...this.effects.keys()].join(', ')}). Nothing installed.`;
      if (effect.spec.voice && !author.capabilities.includes('speak')) return `error: you cannot give a watch "${action.effect}": you don't have the speak capability. Nothing installed.`;
    }
    const senses = [...('sense' in spec.on ? [spec.on.sense] : []), ...conditionSenses(spec.when)];
    if (senses.length && !this.jev.available) return 'error: sense watches need Jev, which is not configured in this session. Nothing installed.';
    if (this.countCode() >= this.config.maxCodeLimbs) return `error: too many watches and programs (max ${this.config.maxCodeLimbs}); cancel some first.`;
    const id = this.nextId('watch');
    // Ready before the install is logged: the new watch already sees that event.
    const live = this.liveOf(id);
    live.tracker = new LevelTracker();
    if ('sense' in spec.on) live.sense = this.jev.sense(spec.on.sense, id);
    for (const question of conditionSenses(spec.when)) this.jev.sense(question, id);
    this.log.append('watch_installed', author.id, { id, name: spec.name, watch: spec as unknown as Record<string, unknown>, ...(builtin ? { builtin } : {}), ...(decidedAt !== undefined ? { decided_at: decidedAt } : {}) });
    return `watch ${id} "${spec.name}" installed${live.sense ? ` (sense level ${live.sense.level})` : ''}`;
  }

  // ---------- programs ----------

  private startProgram(author: LimbState, name: string, code: string, decidedAt?: number, label?: string): { limb?: LimbState; error?: string; done?: Promise<ProgramOutcome> } {
    if (this.countCode() >= this.config.maxCodeLimbs) return { error: `too many watches and programs (max ${this.config.maxCodeLimbs}); cancel some first.` };
    const id = this.nextId('program');
    const abort = new AbortController();
    this.liveOf(id).program = abort;
    this.log.append('program_started', author.id, { id, name, code, ...(label !== undefined ? { label } : {}), ...(decidedAt !== undefined ? { decided_at: decidedAt } : {}) });
    const limb = this.limb(id)!;
    const done = runProgram(code, this.programApi(limb), abort.signal).then(outcome => {
      if (limb.status !== 'running') return outcome;
      if (outcome.status === 'finished') {
        this.endCodeLimb(limb, 'done', 'finished', outcome.result);
        if (author.kind === 'llm') this.wake(author.id, `program "${name}" finished`);
      }
      else if (outcome.status === 'failed') {
        this.endCodeLimb(limb, 'failed', outcome.error);
        if (author.kind === 'llm') this.wake(author.id, `program "${name}" failed: ${outcome.error}`);
      }
      return outcome;
    });
    return { limb, done };
  }

  private programApi(limb: LimbState) {
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
  private async throttle(limb: LimbState, name: string): Promise<void> {
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
    if (spec.voice && !limb.capabilities.includes('speak')) return `error: you cannot use "${name}": only limbs that talk to the user can.`;
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
      const refused = this.claimPaths(limb.kind === 'code' && limb.parent ? this.limb(limb.parent)! : limb, spec.paths(args), 'writing');
      if (refused) {
        this.wake('head', `claim conflict: ${caller.limbId} tried to write ${refused}`);
        return `refused: ${refused}. Nothing was written. Coordinate (share a note, wait, or work elsewhere) instead of overwriting.`;
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
    const limb = this.limb(limbId);
    if (!limb || limb.kind !== 'llm' || this.status !== 'running') return;
    if (limb.role === 'task' && (limb.status !== 'running' || limb.runs.length)) return;
    const runId = this.nextId('run');
    const abort = new AbortController();
    const live = this.liveOf(limb.id);
    live.aborts.set(runId, abort);
    const notices = limb.role === 'task' ? [...limb.notices] : [];
    const why = [reason, ...notices].filter(Boolean).join(' | ').slice(0, 3000);
    const readSeq = this.log.length;
    const prompt = this.render(limb, why);
    this.log.append('run_started', limb.id, { run: runId, reason: why, ...(notices.length ? { notices: notices.length } : {}) });
    const startedAt = this.now();
    const system = limb.role === 'reviewer' ? reviewerSystemPrompt(this.channels) : limb.role === 'head' ? headSystemPrompt(this.channels, !!this.limb('voice'), this.config.review === 'head', this.config.review === 'separate') : limb.role === 'voice' ? voiceSystemPrompt(this.channels, this.config.review !== 'off') : taskSystemPrompt(this.channels, limb.group ? this.state.batches[limb.group]?.title : undefined);
    this.mind.run({
      limbId: limb.id, runId, role: limb.role === 'head' || limb.role === 'reviewer' ? 'head' : limb.role === 'voice' ? 'voice' : 'task', model: limb.model!, system, prompt,
      tools: this.toolsFor(limb), signal: abort.signal,
      sessionKey: limb.role === 'task' ? limb.id : undefined,
      maxSteps: limb.role === 'task' ? this.config.taskMaxSteps : this.config.headMaxSteps,
      callTool: async (name, args) => {
        if (abort.signal.aborted) return 'error: this run was stopped';
        // A cancelled worker may still tell the user where it got to and finish; everything else is refused.
        if (limb.cancelRequested && name !== 'say' && name !== 'finish_task' && name !== 'note' && !this.effects.get(name)?.spec.readonly) {
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
        const result = await this.callTool(limb, runId, readSeq, abort, name, args ?? {});
        const ok = toolResultOk(result);
        // Busy workers hear about steers, discoveries and claims with their next tool result, without being stopped.
        const notices = limb.role === 'task' && limb.status === 'running' && !abort.signal.aborted ? [...limb.notices] : [];
        this.log.append('tool_done', limb.id, { run: runId, name, ok, ...(ok ? {} : { note: result.slice(0, 200) }), ...(notices.length ? { notices: notices.length } : {}) });
        if (limb.role === 'task') this.maybeSummarize(limb);
        return notices.length ? `${result}\n\n[updates while you worked]\n${notices.join('\n')}` : result;
      },
    }).then(result => {
      this.log.append('run_finished', limb.id, { run: runId, ms: Math.round(this.now() - startedAt), usage: result.usage ?? null });
      live.aborts.delete(runId);
      this.wakeIfPending(limb);
      this.finishReview(limb);
      if (limb.role === 'task' && limb.status === 'running' && !abort.signal.aborted) {
        if (limb.notices.length) this.wake(limb.id, 'updates arrived');
        else if (result.stopReason === 'max_steps') {
          // Out of turns while still working: continue with the same conversation, up to a cap.
          if (limb.continuations < this.config.taskContinuations) {
            this.log.append('task_continued', limb.id, { continuations: limb.continuations + 1 });
            this.wake(limb.id, 'you ran out of turns in your last run; continue where you left off, and call finish_task when done');
          } else this.finishTask(limb, `stopped after ${limb.continuations} continuations without finishing (step limit)`, 'failed');
        } else this.finishTask(limb, result.text?.trim() || this.lastSaidBy(limb.id) || 'ended without a summary', limb.cancelRequested ? 'cancelled' : 'done');
      }
    }, error => {
      const aborted = abort.signal.aborted;
      this.log.append('run_finished', limb.id, { run: runId, ms: Math.round(this.now() - startedAt), ...(aborted || this.status !== 'running' ? { aborted: true } : { failed: true }) });
      live.aborts.delete(runId);
      this.wakeIfPending(limb);
      // A review that crashed or was aborted checked nothing: never show its answers as confirmed.
      this.abandonReview(limb, aborted ? 'aborted' : 'failed');
      if (aborted || this.status !== 'running') {
        // Paused mid-run: if the session was resumed before this run wound down, resume() found it still busy and skipped it.
        if (this.status === 'running' && limb.role === 'task' && limb.status === 'running' && !limb.runs.length) this.wake(limb.id, 'resumed');
        return;
      }
      this.crashed(limb, error instanceof Error ? error.message : String(error));
    });
  }

  private wakeIfPending(limb: LimbState): void {
    const live = this.liveOf(limb.id);
    if (!live.wakeAfterRun || limb.runs.length || limb.status !== 'running') return;
    const reason = live.wakeAfterRun;
    live.wakeAfterRun = undefined;
    this.wake(limb.id, reason);
  }

  private crashed(limb: LimbState, message: string): void {
    this.log.append('limb_failed', limb.id, { error: message.slice(0, 500) });
    this.addHealth(`${limb.id} crashed: ${message.slice(0, 200)}`);
    const now = this.now();
    if (limb.crashes.filter(t => now - t < this.config.restartWindowMs).length > this.config.restartMax) {
      if (limb.role === 'task') this.finishTask(limb, `failed: ${message}`, 'failed');
      return; // the head stays up but is not retried; the next event wakes it again
    }
    if (limb.role === 'task' && limb.status === 'running') this.wake(limb.id, `restart after crash: ${message.slice(0, 200)}`);
  }

  private finishTask(limb: LimbState, result: string, status: 'done' | 'failed' | 'cancelled' | 'killed'): void {
    if (!WORKER_ACTIVE.includes(limb.status)) return;
    const keptBefore = [...this.state.kept];
    this.log.append('task_done', limb.id, { status, result: result.slice(0, 4000), task: limb.task ?? '' });
    // Conversations are kept for the most recent finished workers only; failed and stopped ones are dropped at once.
    for (const id of keptBefore) if (!this.state.kept.includes(id) && id !== limb.id) this.mind.forget?.(id);
    if (status !== 'done') this.mind.forget?.(limb.id);
    for (const child of this.children(limb.id)) this.stopLimb(child.id, 'cancel', limb.id);
    this.releaseClaims(limb.id);
    // Workers answer the user themselves; the head is only woken to orchestrate.
    for (const waiting of this.limbList()) {
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
  private dispatch(by: LimbState, args: { task: string; name?: string; model?: string; after?: string; reply_to?: number; fork_of?: string; group?: string }): string {
    const queued = this.limbList().filter(l => l.role === 'task' && l.status === 'queued').length;
    if (queued >= MAX_QUEUED) return `error: ${queued} workers are already queued (max ${MAX_QUEUED}); cancel some first`;
    if (args.after && !this.limb(args.after)) return `error: no worker "${args.after}" to wait for`;
    const source = args.fork_of ? this.limb(args.fork_of) : undefined;
    if (args.fork_of && (!source || source.role !== 'task')) return `error: no worker "${args.fork_of}" to fork`;
    const id = this.nextId('worker');
    if (source && !this.mind.fork?.(source.id, id)) return `error: ${source.id}'s conversation is no longer kept; dispatch a fresh worker instead`;
    const model = args.model === 'head' ? this.options.models.head : this.options.models.task;
    const name = args.name ?? (source ? `${source.name} (fork)` : 'worker');
    const target = args.after ? this.limb(args.after) : undefined;
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
  private dispatchMany(by: LimbState, args: { title: string; items: { task: string; name?: string }[]; model?: string }): string {
    if (!args.items.length) return 'error: items is empty';
    const group = this.nextId('group');
    const replyTo = this.lastUserMessageSeq();
    this.log.append('group_started', by.id, { id: group, title: args.title, count: args.items.length, reply_to: replyTo ?? null });
    const results = args.items.map(item => this.dispatch(by, { task: item.task, name: item.name, model: args.model, group }));
    // One line in the chat for the whole batch, updated as its workers start and finish.
    this.log.append('chat_message', by.id, { text: this.batchProgress(group), group, ...(replyTo !== undefined ? { reply_to: replyTo } : {}) });
    const errors = results.filter(r => r.startsWith('error'));
    const queued = results.filter(r => r.includes(' queued')).length;
    return `${group} "${args.title}": ${results.length - errors.length} workers (${results.length - errors.length - queued} started, ${queued} queued)${errors.length ? `; ${errors.length} failed: ${errors[0]}` : ''}`;
  }

  private batchProgress(group: string): string {
    const batch = this.state.batches[group];
    const members = this.limbList().filter(l => l.group === group);
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
    const members = this.limbList().filter(l => l.group === group);
    if (members.some(l => WORKER_ACTIVE.includes(l.status))) return;
    this.log.append('group_finished', 'system', { id: group });
    const results = members.map(l => `${l.name}: ${l.status}${l.result ? `: ${l.result.slice(0, 160)}` : ''}`).slice(0, 60).join('\n');
    this.wake(this.frontLimb(), `batch "${batch.title}" finished. ${text}\nResults:\n${results}`);
  }

  /** Running workers take a slot; queued and waiting ones don't. */
  private workerSlots(): number {
    return this.config.maxTasks - this.limbList().filter(l => l.role === 'task' && l.status === 'running').length;
  }

  private startQueued(): void {
    const queue = this.limbList().filter(l => l.role === 'task' && l.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
    for (const limb of queue) {
      if (this.workerSlots() <= 0) return;
      this.log.append('limb_started', 'system', { id: limb.id });
      this.updateBatch(limb.group);
      this.wake(limb.id, 'task assigned');
    }
  }

  /** A message for one worker, delivered with its next tool result (or reviving it if idle). */
  private steer(by: string, id: string, text: string, when: 'now' | 'after' = 'now'): string {
    const limb = this.limb(id);
    if (!limb || limb.role !== 'task') return `error: no worker "${id}"`;
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
    const steered = steer ? this.limb(String(steer.data.id)) : undefined;
    if (how === 'fork' && !steered) return `error: #${seq} was not sent to a worker, so there is nothing to fork`;
    const text = String(message.data.text);
    const result = this.dispatch(this.limb('head')!, {
      task: `${text}\n\n(The user asked for this to be handled by its own worker${how === 'fork' ? `, continuing from ${steered!.id}'s conversation` : ''}.)`,
      name: text.slice(0, 40), reply_to: seq, fork_of: how === 'fork' ? steered!.id : undefined,
    });
    if (result.startsWith('error')) return result;
    this.log.append('rerouted', 'user', { seq, how, from: steered?.id ?? null, text: text.slice(0, 200) });
    return result;
  }

  /** A message from the user straight to one worker (the Work view's "Message"). */
  messageWorker(id: string, text: string): string { return this.steer('user', id, text); }

  /** Stops a worker on the user's request (the Work view's "Stop"). */
  stopWorker(id: string): string {
    if (this.limb(id)?.role !== 'task') return `error: no worker "${id}"`;
    return this.stopLimb(id, 'cancel', 'user');
  }

  private maybeSummarize(limb: LimbState): void {
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
      .then(summary => { if (this.status !== 'idle') this.log.append('work_summary', 'system', { limb: limb.id, ...clean(summary) }); })
      .catch(error => { if (this.status !== 'idle') this.addHealth(`summary for ${limb.id} failed: ${error instanceof Error ? error.message : String(error)}`); })
      .finally(() => { clearTimeout(timer); live.summarizing = false; });
  }

  /** What a worker has done so far, in order, for the summarizer. */
  private activityOf(limb: LimbState): string {
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

  private claimPaths(limb: LimbState, paths: string[], note: string): string | null {
    for (const path of paths) {
      const holder = this.claimHolder(path, limb.id);
      if (holder) return `"${path}" is claimed by ${holder.limb} (${holder.note || 'no note'}) since ${this.ago(holder.since)}`;
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

  /** Cancel (graceful, then kill after a grace period) or kill (immediate). */
  stopLimb(id: string, mode: 'cancel' | 'kill', by: string): string {
    const limb = this.limb(id);
    if (!limb || limb.id === 'head') return `error: no limb "${id}" to stop`;
    const ended = mode === 'kill' ? 'killed' : 'cancelled';
    if (limb.status === 'queued' || limb.status === 'waiting') { this.finishTask(limb, `${ended} by ${by} before it started`, ended); return `${id} ${ended} before it started`; }
    if (limb.status !== 'running') return `${id} is already ${limb.status}`;
    if (limb.kind === 'code') { this.endCodeLimb(limb, ended, `${mode} by ${by}`); return `${id} ${ended}`; }
    if (mode === 'kill' || !limb.runs.length) {
      for (const abort of this.liveOf(limb.id).aborts.values()) abort.abort();
      this.finishTask(limb, limb.result ?? `${ended} by ${by}`, ended);
      return `${id} ${ended}`;
    }
    this.log.append('cancel_requested', by, { id });
    const timer = setTimeout(() => { this.timers.delete(timer); if (limb.status === 'running') this.stopLimb(id, 'kill', `${by} (grace period over)`); }, this.config.cancelGraceMs);
    this.timers.add(timer);
    return `${id}: cancel requested; it will be killed in ${this.config.cancelGraceMs / 1000} s if it does not finish`;
  }

  private endCodeLimb(limb: LimbState, status: LimbStatus, reason: string, result?: unknown): void {
    if (limb.status !== 'running') return;
    const live = this.liveOf(limb.id);
    live.program?.abort();
    if (live.sense || limb.role === 'program') this.jev.release(limb.id);
    const type = limb.role === 'program'
      ? status === 'done' ? 'program_finished' : status === 'failed' ? 'program_failed' : 'program_cancelled'
      : 'watch_removed';
    this.log.append(type, limb.id, { id: limb.id, name: limb.name, status, reason, ...(result !== undefined ? { result: result as never } : {}) });
  }

  private callTool(limb: LimbState, runId: string, readSeq: number, abort: AbortController, name: string, args: Record<string, unknown>): Promise<string> | string {
    const caller: Caller = { limbId: limb.id, kind: 'llm', runId, readSeq };
    const has = (cap: Capability) => limb.capabilities.includes(cap);
    switch (name) {
      case 'set_watch':
        if (!has('set_watch')) return 'error: you cannot install watches';
        return this.installWatch(limb, (args.watch ?? args) as WatchSpec, false, this.now());
      case 'run_program': {
        if (!has('run_program')) return 'error: you cannot run programs';
        const error = validate(TOOL_SCHEMAS.run_program, args, 'args');
        if (error) return `error: ${error}`;
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
        void this.pausableWait(ms).then(() => {
          if (this.status === 'idle') return;
          this.log.append('timer', 'system', { label, limb: limb.id });
          this.wake(limb.id, `timer "${label}"`);
        });
        return `timer "${label}" set for ${ms} ms`;
      }
      case 'cancel':
      case 'kill': {
        if (!has(name)) return `error: you cannot ${name} limbs`;
        const target = String(args.id ?? '');
        const frontOnWorker = (this.isFront(limb) || limb.id === 'head') && this.limb(target)?.role === 'task';
        if (!frontOnWorker && (!this.isWithin(target, limb.id) || target === limb.id)) return `error: ${target} is not one of your children`;
        if (this.limb(target)?.builtin) return `error: ${target} is built into the runtime and cannot be cancelled`;
        return this.stopLimb(target, name, limb.id);
      }
      case 'dispatch':
      case 'fork': {
        if (!this.isFront(limb) && limb.id !== 'head') return 'error: only the front limb dispatches workers';
        const error = validate(TOOL_SCHEMAS[name], args, 'args');
        if (error) return `error: ${error}`;
        return this.dispatch(limb, { ...(args as { task: string }), fork_of: name === 'fork' ? String(args.worker) : undefined });
      }
      case 'dispatch_many': {
        if (!this.isFront(limb) && limb.id !== 'head') return 'error: only the front limb dispatches workers';
        const error = validate(TOOL_SCHEMAS.dispatch_many, args, 'args');
        if (error) return `error: ${error}`;
        return this.dispatchMany(limb, args as { title: string; items: { task: string; name?: string }[]; model?: string });
      }
      case 'steer': {
        if (!this.isFront(limb) && limb.id !== 'head') return 'error: only the front limb steers workers';
        return this.steer(limb.id, String(args.worker ?? ''), String(args.text ?? ''), args.when === 'after' ? 'after' : 'now');
      }
      case 'claim': {
        const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
        const refused = this.claimPaths(limb, paths, String(args.note ?? ''));
        return refused ? `refused: ${refused}` : `claimed ${paths.join(', ')}`;
      }
      case 'release': return `released ${this.releaseClaims(limb.id, Array.isArray(args.paths) ? args.paths.map(String) : undefined)} claim(s)`;
      case 'share':
        this.log.append('discovery', limb.id, { text: String(args.text ?? '').slice(0, 1000) });
        return 'shared with the other workers';
      case 'amend': {
        if (limb.id !== this.reviewerId() || this.config.review === 'off') return 'error: you do not review answers';
        const error = validate(TOOL_SCHEMAS.amend, args, 'args');
        if (error) return `error: ${error}`;
        return this.amend(limb, args as { seq: number; verdict: string; text?: string });
      }
      case 'handoff':
        if (limb.role !== 'voice' && limb.role !== 'reviewer') return 'error: only the voice and the reviewer hand off';
        this.log.append('handoff', limb.id, { note: String(args.note ?? '').slice(0, 2000) });
        this.wake('head', `voice handed off: ${String(args.note ?? '').slice(0, 300)}`);
        return 'handed off to the head';
      case 'finish_task':
        if (limb.role !== 'task') return 'error: only task limbs finish tasks';
        abort.abort();
        this.finishTask(limb, String(args.result ?? ''), limb.cancelRequested ? 'cancelled' : 'done');
        return 'task finished';
      default:
        if (limb.role === 'task' && name === 'say' && args.reply_to === undefined && limb.replyTo !== undefined) args = { ...args, reply_to: limb.replyTo };
        if (limb.role === 'task' && name === 'say' && limb.group && args.thread === undefined) args = { ...args, thread: true };
        return this.commit(caller, name, args);
    }
  }

  private toolsFor(limb: LimbState): ToolSpec[] {
    const tools: ToolSpec[] = [];
    const has = (cap: Capability) => limb.capabilities.includes(cap);
    const add = (name: keyof typeof TOOL_SCHEMAS, description: string) => tools.push({ name, description, parameters: toJsonSchema(TOOL_SCHEMAS[name]) });
    for (const { spec } of this.effects.values()) {
      if (spec.voice && !has('speak')) continue;
      tools.push({ name: spec.name, description: `${spec.description}${spec.risk === 'reflex' ? ' (reflex-safe)' : ''}`, parameters: toJsonSchema(spec.parameters) });
    }
    const router = () => {
      add('dispatch', 'Start a worker (a capable model) on a user request right away. It replies to the user itself. Use "after" to start it only when another worker finishes.');
      add('dispatch_many', 'Start one worker per item as one batch with a title, for many independent items of the same kind (one per issue, per file). Past the running limit, workers queue.');
      add('fork', 'Start a worker from another worker\'s conversation, for a request that builds on its context.');
      add('steer', 'Send a message to one worker: it gets it with its next tool result (or wakes up with it).');
      add('cancel', 'Cancel a worker by id.');
    };
    if (limb.role === 'reviewer') {
      tools.splice(0, tools.length, ...tools.filter(t => this.effects.get(t.name)?.spec.readonly));
      add('amend', 'Your verdict on one of the answers under review: confirm it, correct it (the original is shown struck through, your text below it), or expand it.');
      add('handoff', 'Wake the head for work a correction needs (starting a worker, fixing something promised but not done). The note says what.');
      add('note', 'Keep a short note in your state; you remember nothing else between wakes.');
      return tools;
    }
    if (limb.role === 'voice') {
      add('note', 'Keep a short note in your state; you remember nothing else between wakes.');
      router();
      add('handoff', 'Wake the head (slower, smarter) for anything you should not handle yourself. The note says what is needed.');
      return tools;
    }
    if (limb.role === 'head' && this.config.review === 'head') add('amend', 'Your verdict on one of the voice\'s answers under review: confirm, correct (shown struck through, your text below), or expand.');
    // The head dispatches and steers workers too: as the front limb, or to act on the voice's handoffs.
    if (limb.role === 'head') { router(); tools.splice(tools.findIndex(t => t.name === 'cancel'), 1); }
    if (has('set_watch')) add('set_watch', 'Install a watch: a code reflex that reacts in ~0 ms without you.');
    if (has('run_program')) add('run_program', 'Run a JavaScript program (the body of an async function) as a code limb.');
    add('stop_output', 'Stop output. scope "work" (default): your programs, watches and task limbs, not you; "subtree": you too. mode "stop" (default) cancels programs; "freeze" pauses everything at its next action until resume_output.');
    add('resume_output', 'Resume output after a stop.');
    add('note', 'Keep a short note in your state; you remember nothing else between wakes.');
    add('set_timer', 'Be woken after a delay.');
    if (has('cancel')) add('cancel', 'Cancel one of your watches, programs or task limbs by id.');
    if (has('kill')) add('kill', 'Stop one of your children immediately, dropping partial work.');
    if (limb.role === 'task') {
      add('claim', 'Claim files or folders you are working on, so other workers leave them alone. Writing a file claims it automatically.');
      add('release', 'Release your claims (all, or the given paths).');
      add('share', 'Share a discovery that other workers should know (e.g. a root cause).');
      add('finish_task', 'Finish: first say your answer to the user, then call this with a one-line summary.');
    }
    return tools;
  }

  // ---------- rendering ----------

  private ago = (t: number) => `${((this.now() - t) / 1000).toFixed(1)}s ago`;

  private render(limb: LimbState, reason: string): string {
    const now = this.now();
    const ctx = { now, ago: this.ago, levels: this.levels };
    const stable: Record<string, unknown> = { you: `${limb.id} (${limb.role})`, notes: this.state.notes };
    if (limb.role === 'task') stable.task = limb.task;
    stable.limbs = this.limbList().filter(l => l.status === 'running' || now - l.createdAt < 60_000).map(l => this.describeLimb(l));
    const tasks = this.limbList().filter(l => l.role === 'task');
    if (tasks.length) stable.workers = tasks.map(l => ({
      id: l.id, name: l.name, task: l.task, status: l.status + (l.waitFor ? ` for ${l.waitFor}` : '') + (l.runs.length ? ' (working)' : ''),
      reply_to: l.replyTo, result: l.result, claims: this.claimsOf(l.id),
    }));
    if (this.state.discoveries.length) stable.discoveries = this.state.discoveries.map(d => `${d.by}: ${d.text}`);
    const volatile: Record<string, unknown> = {};
    for (const channel of this.channels) {
      const rendered = channel.render(this.world[channel.name] as never, ctx);
      if (rendered.stable !== undefined) stable[channel.name] = rendered.stable;
      if (rendered.volatile !== undefined) volatile[channel.name] = rendered.volatile;
    }
    const levels = this.levels.entries();
    if (levels.length) volatile.levels = Object.fromEntries(levels.map(([name, level]) => [name, `${JSON.stringify(level.value)} for ${((now - level.since) / 1000).toFixed(1)}s`]));
    if (this.state.stops.length) volatile.output_stops = this.state.stops.map(s => ({ ...s, since: this.ago(s.since) }));
    if (this.state.health.length) volatile.health = this.state.health.slice(-5).map(h => `${h.message} (${this.ago(h.t)})`);
    const fresh = this.log.since(limb.seenSeq).filter(e => !HIDDEN_EVENTS.has(e.type)).slice(-this.config.recentEvents);
    const time = { now_s: +(now / 1000).toFixed(1), last_spoke: this.lastSpoke(), woken_because: reason };
    return [
      'STATE (stable)', JSON.stringify(stable, null, 1),
      'STATE (live)', JSON.stringify(volatile, null, 1),
      'NEW EVENTS since your last wake', fresh.map(e => `#${e.seq} ${this.ago(e.t)} ${e.by} ${e.type} ${JSON.stringify(e.data)}`).join('\n') || '(none)',
      'TIME', JSON.stringify(time),
    ].join('\n');
  }

  private describeLimb(limb: LimbState): string {
    const base = `${limb.id} ${limb.builtin ? 'built-in ' : ''}${limb.role} "${limb.name}" ${limb.status}${limb.parent ? ` (parent ${limb.parent})` : ''}`;
    if (limb.role === 'watch') return `${base}: on ${JSON.stringify(limb.watch!.on)} do ${JSON.stringify(limb.watch!.do)}, fired ${limb.fires}x`;
    if (limb.role === 'program') return `${base}, started ${this.ago(limb.createdAt)}`;
    if (limb.kind === 'llm') return `${base}${limb.runs.length ? `, ${limb.runs.length} run(s) in flight` : ''}`;
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
  private limbList(): LimbState[] { return Object.values(this.state.limbs); }
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
      limbs: this.limbList().map(l => ({
        id: l.id, kind: l.kind, role: l.role, name: l.name, parent: l.parent, model: l.model, status: l.status,
        runs: l.runs.map(r => ({ id: r.id, reason: r.reason, startedAt: r.startedAt, firstToolAt: r.firstToolAt })),
        task: l.task, result: l.result, watch: l.watch, code: l.code, fires: l.fires, label: l.label, group: l.group,
        createdAt: l.createdAt, endedAt: l.endedAt, replyTo: l.replyTo, waitFor: l.waitFor,
        claims: this.claimsOf(l.id),
      })),
      senses: this.jev.list(),
      jev: { available: this.jev.available, calls: jev.calls, perMinute: jev.perMinute },
    };
  }
}

/** Tuned on Jev: complete requests score about 0.4-0.85; fragments, asides and "can you" 0.18 or less. */
export const DRAFT_PAUSE_MS = 700;
export const DRAFT_ATTENTION_QUESTION = 'Does the unsent draft already contain a question or request to the entity that is clear enough to answer or act on?';

const HIDDEN_EVENTS = new Set(['run_started', 'run_finished', 'draft_changed', 'sensed', 'judged', 'program_log', 'tool_called', 'tool_done', 'work_summary', 'watch_fired', 'health', 'review_started', 'review_requeued']);

const TOOL_SCHEMAS = {
  set_watch: { type: 'object', additionalProperties: false, required: ['watch'], properties: { watch: watchSchema } },
  run_program: {
    type: 'object', additionalProperties: false, required: ['name', 'code'],
    properties: { name: { type: 'string', maxLength: 80 }, label: { type: 'string', maxLength: 40, description: 'A few words saying what it does' }, code: { type: 'string', maxLength: 20_000, description: 'Body of an async function' } },
  },
  stop_output: {
    type: 'object', additionalProperties: false, required: ['reason'],
    properties: { reason: { type: 'string', maxLength: 200 }, scope: { type: 'string', enum: ['work', 'subtree', 'entity'] }, mode: { type: 'string', enum: ['stop', 'freeze'] } },
  },
  resume_output: { type: 'object', additionalProperties: false, properties: {} },
  note: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 500 } } },
  set_timer: {
    type: 'object', additionalProperties: false, required: ['after_ms'],
    properties: { after_ms: { type: 'integer', minimum: 0, maximum: 3_600_000 }, label: { type: 'string', maxLength: 80 } },
  },
  cancel: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } },
  kill: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } },
  amend: {
    type: 'object', additionalProperties: false, required: ['seq', 'verdict'],
    properties: {
      seq: { type: 'integer', description: 'The message under review' },
      verdict: { type: 'string', enum: ['confirm', 'correct', 'expand'] },
      text: { type: 'string', maxLength: 4000, description: 'For correct: the corrected answer. For expand: what the answer was missing.' },
    },
  },
  handoff: { type: 'object', additionalProperties: false, required: ['note'], properties: { note: { type: 'string', maxLength: 2000 } } },
  dispatch: {
    type: 'object', additionalProperties: false, required: ['task'],
    properties: {
      task: { type: 'string', maxLength: 8000, description: 'The request, with any context the worker needs' },
      name: { type: 'string', maxLength: 60, description: 'Short label, e.g. "flaky test"' },
      model: { type: 'string', enum: ['task', 'head'], description: 'task (default): the capable model; head: cheaper, for small requests' },
      after: { type: 'string', description: 'Worker id to wait for before starting' },
      reply_to: { type: 'integer', description: 'The user message seq this answers (default: the latest)' },
    },
  },
  dispatch_many: {
    type: 'object', additionalProperties: false, required: ['title', 'items'],
    properties: {
      title: { type: 'string', maxLength: 80, description: 'What the batch is, e.g. "Open bug issues"' },
      items: {
        type: 'array', maxItems: 200,
        items: { type: 'object', additionalProperties: false, required: ['task'], properties: { task: { type: 'string', maxLength: 4000 }, name: { type: 'string', maxLength: 60 } } },
      },
      model: { type: 'string', enum: ['task', 'head'] },
    },
  },
  fork: {
    type: 'object', additionalProperties: false, required: ['worker', 'task'],
    properties: { worker: { type: 'string' }, task: { type: 'string', maxLength: 8000 }, name: { type: 'string', maxLength: 60 }, reply_to: { type: 'integer' } },
  },
  steer: {
    type: 'object', additionalProperties: false, required: ['worker', 'text'],
    properties: {
      worker: { type: 'string' }, text: { type: 'string', maxLength: 4000 },
      when: { type: 'string', enum: ['now', 'after'], description: 'now (default): the worker hears it with its next tool result. after: it continues with this in the same conversation once it finishes its current work.' },
    },
  },
  claim: {
    type: 'object', additionalProperties: false, required: ['paths'],
    properties: { paths: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 50 }, note: { type: 'string', maxLength: 200 } },
  },
  release: { type: 'object', additionalProperties: false, properties: { paths: { type: 'array', items: { type: 'string' }, maxItems: 50 } } },
  share: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 1000 } } },
  finish_task: { type: 'object', additionalProperties: false, required: ['result'], properties: { result: { type: 'string', maxLength: 8000 } } },
} satisfies Record<string, Schema>;

function clean(summary: WorkSummary): Record<string, unknown> {
  const list = (items: unknown) => (Array.isArray(items) ? items : []).map(String).map(s => s.trim()).filter(Boolean).slice(0, 5).map(s => s.slice(0, 160));
  return { done: list(summary.done), doing: list(summary.doing), next: list(summary.next), ...(summary.blocker ? { blocker: String(summary.blocker).slice(0, 200) } : {}) };
}
