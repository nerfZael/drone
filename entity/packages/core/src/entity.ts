import { Levels, type Channel, type EffectSpec } from './channel.js';
import { JevService, type Evaluator, type JevOptions, type SenseInfo } from './jev.js';
import { EventLog, isEntityActor, matches } from './log.js';
import type { Mind, ToolSpec } from './mind.js';
import { runProgram, type ProgramOutcome } from './program.js';
import { headSystemPrompt, taskSystemPrompt, voiceSystemPrompt } from './prompts.js';
import { toJsonSchema, validate } from './schema.js';
import type { Caller, Capability, EntityEvent, EventMatcher, Schema } from './types.js';
import { conditionHolds, conditionSenses, eventMatchesTrigger, LevelTracker, levelHolds, senseHolds, templateArgs, watchSchema, type ConditionContext, type StopMode, type StopScope, type WatchSpec } from './watch.js';

export type SessionStatus = 'idle' | 'running' | 'paused';
export type LimbRole = 'head' | 'voice' | 'task' | 'watch' | 'program';
export type LimbStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled' | 'killed';

export interface RunInfo { id: string; reason: string; startedAt: number; firstToolAt?: number; readSeq: number; abort: AbortController; voice: boolean }

export interface Limb {
  id: string;
  kind: 'llm' | 'code';
  role: LimbRole;
  name: string;
  parent?: string;
  model?: string;
  capabilities: Set<Capability>;
  restart: 'permanent' | 'transient';
  status: LimbStatus;
  createdAt: number;
  children: Set<string>;
  runs: Map<string, RunInfo>;
  /** Log position up to which this limb has already been shown events. */
  seenSeq: number;
  // task limbs
  task?: string;
  result?: string;
  crashes: number[];
  cancelRequested?: boolean;
  // code limbs
  watch?: WatchSpec;
  tracker?: LevelTracker;
  sense?: SenseInfo;
  fires?: number;
  code?: string;
  abort?: AbortController;
  effectTimes: number[];
  expiresAt?: number;
  /** Installed by the runtime itself; limbs cannot cancel it. */
  builtin?: boolean;
  /** Parallel conversation: the user message this worker answers, a worker it waits for, updates for its next tool result. */
  replyTo?: number;
  waitFor?: string;
  notices: string[];
}

export interface Claim { path: string; limb: string; note: string; since: number }

export interface OutputStop { id: string; owner: string; scope: StopScope; mode: StopMode; reason: string; since: number; by: string }

export interface EntityConfig {
  /** Debounce before a user message wakes the head, so bursts arrive together. */
  messageDebounceMs: number;
  /** While the user is still typing after sending, wait until their draft has been quiet this long... */
  messageSettleMs: number;
  /** ...but at most this long after the message before waking anyway. */
  messageSettleMaxMs: number;
  /** How often levels are re-checked for duration triggers. */
  tickMs: number;
  /** How often the heartbeat may wake the head while something is active. */
  headHeartbeatMs: number;
  headMaxSteps: number;
  taskMaxSteps: number;
  maxTasks: number;
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
  /** Parallel conversation: every message gets a capable worker at once (see docs/parallel-conversation.md). */
  parallel: boolean;
  /** Most finished worker conversations kept for forks and follow-ups. */
  keptSessions: number;
  recentEvents: number;
}

export interface EntityOptions {
  mind: Mind;
  channels: Channel[];
  /** voice: an optional fast model that answers first and hands off to the head. Unset: the head is the voice. */
  models: { head: string; task: string; voice?: string };
  evaluator?: Evaluator;
  jev?: JevOptions;
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
    runs: { id: string; reason: string; startedAt: number; firstToolAt?: number; voice: boolean }[];
    task?: string; result?: string; watch?: WatchSpec; code?: string; fires?: number;
  }[];
  senses: SenseInfo[];
  jev: { available: boolean; calls: number; perMinute: number };
}

const DEFAULT_CONFIG: EntityConfig = {
  messageDebounceMs: 150, messageSettleMs: 1000, messageSettleMaxMs: 6000, tickMs: 50, headHeartbeatMs: 180_000, headMaxSteps: 8, taskMaxSteps: 24,
  maxTasks: 6, maxCodeLimbs: 32, reflexPerSecond: 30, limbPerSecond: 5, cancelGraceMs: 3000,
  restartMax: 3, restartWindowMs: 60_000, freezeMaxMs: 600_000, draftAttention: true, codeLimbs: true, parallel: false, keptSessions: 12, recentEvents: 40,
};

class Stopped extends Error {}

/** The realtime entity: event log, limbs, code limbs, channels and user controls. See entity/docs. */
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
  private notes: string[] = [];
  private limbs = new Map<string, Limb>();
  private stops: OutputStop[] = [];
  private health: { t: number; message: string }[] = [];
  private jev!: JevService;
  /** The newest run of each speaking limb: older runs of that limb are superseded. */
  private latestRun = new Map<string, string>();
  private counter = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private messageTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeadRunAt = 0;
  private pausedAt = 0;
  private pauseWaiters: (() => void)[] = [];
  private resumeWaiters: (() => void)[] = [];
  private lastEvents = new Map<string, number>();
  private claims = new Map<string, Claim>();
  private discoveries: { by: string; text: string; t: number }[] = [];
  private keptSessions: string[] = [];
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
    this.notes = [];
    this.limbs = new Map();
    this.stops = [];
    this.health = [];
    this.latestRun = new Map();
    this.lastEvents = new Map();
    this.claims = new Map();
    this.discoveries = [];
    this.keptSessions = [];
    this.jev = new JevService(this.options.evaluator, this.log, this.levels, () => this.renderForJev(), m => this.addHealth(m), this.options.jev);
    this.log.subscribe(event => this.onEvent(event));
    const code: Capability[] = this.config.codeLimbs ? ['set_watch', 'run_program'] : [];
    this.createLimb({ id: 'head', kind: 'llm', role: 'head', name: 'head', model: this.options.models.head, capabilities: ['speak', 'spawn', ...code, 'cancel', 'kill'], restart: 'permanent' });
    if (this.options.models.voice) {
      this.createLimb({ id: 'voice', kind: 'llm', role: 'voice', name: 'voice', parent: 'head', model: this.options.models.voice, capabilities: this.config.parallel ? ['speak', 'spawn', 'cancel'] : ['speak'], restart: 'permanent' });
    }
  }

  now(): number { return Math.round((performance.now() - this.startedAt) * 100) / 100; }

  start(): void {
    if (this.status !== 'idle') return;
    this.status = 'running';
    this.log.append('session_started', 'user', {});
    if (this.jev.available && this.config.draftAttention) {
      // The runtime's own default sense: Jev can add wakes, never suppress them.
      this.installWatch(this.limbs.get(this.frontLimb())!, {
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
    for (const limb of this.limbs.values()) for (const run of limb.runs.values()) run.abort.abort();
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
    for (const limb of this.limbs.values()) if (limb.role === 'task' && limb.status === 'running' && !limb.runs.size) this.wake(limb.id, 'resumed');
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
    for (const limb of this.limbs.values()) {
      limb.abort?.abort();
      for (const run of limb.runs.values()) run.abort.abort();
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
    this.lastEvents.set(`any:${event.type}`, event.t);
    if (event.by === 'user') this.lastEvents.set(`user:${event.type}`, event.t);
    else if (isEntityActor(event.by)) this.lastEvents.set(`entity:${event.type}`, event.t);
    for (const channel of this.channels) channel.reduce(this.world[channel.name] as never, event, { levels: this.levels, now: event.t });
    if (event.type === 'note') { this.notes.push(String(event.data.text)); if (this.notes.length > 20) this.notes.shift(); }
    for (const listener of this.listeners) listener(event);
    for (const waiter of [...this.eventWaiters]) {
      if (matches(event, waiter.matcher)) { this.eventWaiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(event); }
    }
    this.jev.observe(event);
    if (this.status !== 'running') return;
    this.runEventWatches(event);
    this.baselineWakes(event);
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
        const lastKey = this.lastEvents.get('user:draft_changed') ?? -Infinity;
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
    for (const limb of [...this.limbs.values()]) {
      if (limb.role !== 'watch' || limb.status !== 'running' || !limb.watch) continue;
      if (limb.expiresAt !== undefined && now >= limb.expiresAt) { this.endCodeLimb(limb, 'done', 'expired'); continue; }
      this.checkLevelWatch(limb, now);
    }
    const active = [...this.limbs.values()].some(l => l.status === 'running' && l.id !== 'head');
    const head = this.limbs.get('head')!;
    if (active && !head.runs.size && now - this.lastHeadRunAt > this.config.headHeartbeatMs) this.wake('head', 'heartbeat');
  }

  // ---------- watches ----------

  private runEventWatches(event: EntityEvent): void {
    for (const limb of [...this.limbs.values()]) {
      if (limb.role !== 'watch' || limb.status !== 'running' || !limb.watch) continue;
      const on = limb.watch.on;
      if ('event' in on) {
        if (eventMatchesTrigger(event, on, isEntityActor) && this.whenHolds(limb, event.t)) this.fireWatch(limb, event);
      } else this.checkLevelWatch(limb, event.t);
    }
  }

  private checkLevelWatch(limb: Limb, now: number): void {
    const on = limb.watch!.on;
    if ('event' in on) return;
    const triggered = 'level' in on ? levelHolds(on, this.levels, isEntityActor) : senseHolds(this.levels.get(limb.sense!.level)?.value as number | undefined, on);
    if (limb.tracker!.update(triggered && this.whenHolds(limb, now), now, on.for_ms ?? 0)) this.fireWatch(limb, undefined);
  }

  private whenHolds(limb: Limb, now: number): boolean {
    const when = limb.watch?.when;
    return !when || conditionHolds(when, this.conditionContext(now));
  }

  private conditionContext(now: number): ConditionContext {
    return {
      levels: this.levels,
      now,
      isEntity: isEntityActor,
      senseValue: question => { const info = this.jev.find(question); return info ? this.levels.get(info.level)?.value as number | undefined : undefined; },
      lastEvent: (type, by) => this.lastEvents.get(`${by}:${type}`),
    };
  }

  private fireWatch(limb: Limb, event: EntityEvent | undefined): void {
    const watch = limb.watch!;
    limb.fires = (limb.fires ?? 0) + 1;
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
      this.startProgram(this.limbs.get(limb.parent ?? 'head')!, action.run_program.name, action.run_program.code);
    }
    if (watch.once) this.endCodeLimb(limb, 'done', 'fired once');
  }

  private installWatch(author: Limb, spec: WatchSpec, builtin = false): string {
    const error = validate(watchSchema, spec, 'watch');
    if (error) return `error: invalid watch: ${error}. Nothing installed.`;
    const action = spec.do;
    if ('effect' in action) {
      const effect = this.effects.get(action.effect);
      if (!effect) return `error: unknown effect "${action.effect}" (known: ${[...this.effects.keys()].join(', ')}). Nothing installed.`;
      if (effect.spec.voice && !author.capabilities.has('speak')) return `error: you cannot give a watch "${action.effect}": you don't have the speak capability. Nothing installed.`;
    }
    const senses = [...('sense' in spec.on ? [spec.on.sense] : []), ...conditionSenses(spec.when)];
    if (senses.length && !this.jev.available) return 'error: sense watches need Jev, which is not configured in this session. Nothing installed.';
    if (this.countCode() >= this.config.maxCodeLimbs) return `error: too many watches and programs (max ${this.config.maxCodeLimbs}); cancel some first.`;
    const limb = this.createLimb({ kind: 'code', role: 'watch', name: spec.name, parent: author.id, capabilities: [...author.capabilities], restart: 'transient' });
    limb.watch = spec;
    limb.builtin = builtin;
    limb.tracker = new LevelTracker();
    limb.status = 'running';
    if (spec.expires_s) limb.expiresAt = this.now() + spec.expires_s * 1000;
    if ('sense' in spec.on) limb.sense = this.jev.sense(spec.on.sense, limb.id);
    for (const question of conditionSenses(spec.when)) this.jev.sense(question, limb.id);
    this.log.append('watch_installed', author.id, { id: limb.id, name: spec.name, watch: spec as unknown as Record<string, unknown> });
    return `watch ${limb.id} "${spec.name}" installed${limb.sense ? ` (sense level ${limb.sense.level})` : ''}`;
  }

  // ---------- programs ----------

  private startProgram(author: Limb, name: string, code: string): { limb?: Limb; error?: string; done?: Promise<ProgramOutcome> } {
    if (this.countCode() >= this.config.maxCodeLimbs) return { error: `too many watches and programs (max ${this.config.maxCodeLimbs}); cancel some first.` };
    const limb = this.createLimb({ kind: 'code', role: 'program', name, parent: author.id, capabilities: [...author.capabilities], restart: 'transient' });
    limb.code = code;
    limb.abort = new AbortController();
    limb.status = 'running';
    this.log.append('program_started', author.id, { id: limb.id, name, code });
    const done = runProgram(code, this.programApi(limb), limb.abort.signal).then(outcome => {
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

  private programApi(limb: Limb) {
    // Programs read the log in order from where they started: events that happen between two
    // nextEvent calls are buffered, never missed.
    let cursor = this.log.length;
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
    };
  }

  /** Programs are slowed down to their rate limit instead of losing effects. Watches drop instead. */
  private async throttle(limb: Limb, name: string): Promise<void> {
    const spec = this.effects.get(name)?.spec;
    if (!spec || spec.readonly) return;
    const limit = spec.risk === 'reflex' ? this.config.reflexPerSecond : this.config.limbPerSecond;
    for (;;) {
      const now = performance.now();
      limb.effectTimes = limb.effectTimes.filter(t => now - t < 1000);
      if (limb.effectTimes.length < limit) return;
      await this.pausableWait(1000 - (now - limb.effectTimes[0]) + 1);
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
    const stop: OutputStop = { id: `stop-${++this.counter}`, owner, scope, mode, reason, since: this.now(), by };
    this.stops.push(stop);
    if (mode === 'stop') {
      for (const limb of this.limbs.values()) {
        if (limb.role !== 'program' || limb.status !== 'running') continue;
        if (scope === 'entity' || this.isWithin(limb.id, owner)) this.endCodeLimb(limb, 'cancelled', `output stopped: ${reason}`);
      }
    }
    this.log.append('output_stopped', by, { id: stop.id, owner, scope, mode, reason });
    const ownerLimb = this.limbs.get(owner);
    // Wake the owner so it can react, unless it stopped its own output and already knows.
    if (ownerLimb?.kind === 'llm' && by !== owner) this.wake(owner, `output stopped: ${reason}`);
    return stop;
  }

  private resumeOutput(limbId: string, by: string): number {
    const before = this.stops.length;
    this.stops = this.stops.filter(stop => !(limbId === 'head' || this.isWithin(stop.owner, limbId)));
    const removed = before - this.stops.length;
    if (removed) this.log.append('output_resumed', by, { count: removed });
    for (const resolve of this.resumeWaiters.splice(0)) resolve();
    return removed;
  }

  private stoppedBy(caller: Caller): OutputStop | undefined {
    return this.stops.find(stop => {
      if (stop.scope === 'entity') return true;
      if (!this.isWithin(caller.limbId, stop.owner)) return false;
      // The voice is not the head's "work": only a subtree or entity stop silences it.
      return stop.scope === 'subtree' || (caller.limbId !== stop.owner && this.limbs.get(caller.limbId)?.role !== 'voice');
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
    const limb = this.limbs.get(caller.limbId);
    if (!limb || (limb.kind === 'code' && limb.status !== 'running')) return 'error: this limb is no longer running';
    if (this.status === 'paused' && !spec.readonly) return 'error: the session is paused';
    if (spec.risk === 'confirm') return `error: "${name}" needs the user's approval, which this session does not support yet`;
    if (spec.voice && !limb.capabilities.has('speak')) return `error: you cannot use "${name}": only the voice speaks. Use report() to pass it on.`;
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
    if (spec.voice && caller.kind === 'llm' && caller.runId && caller.runId !== this.latestRun.get(caller.limbId)) {
      return 'superseded: a newer run is handling this. Nothing was sent.';
    }
    if (spec.dependsOn) {
      const stale = this.log.since(caller.readSeq).find(event => spec.dependsOn!(args).some(m => matches(event, m)));
      if (stale) return `stale: "${stale.type}" happened after you read the state (#${stale.seq}). Nothing was done; re-check and retry if still right.`;
    }
    if (spec.paths) {
      const refused = this.claimPaths(limb.kind === 'code' && limb.parent ? this.limbs.get(limb.parent)! : limb, spec.paths(args), 'writing');
      if (refused) {
        if (this.config.parallel) this.wake('head', `claim conflict: ${caller.limbId} tried to write ${refused}`);
        return `refused: ${refused}. Nothing was written. Coordinate (share a note, wait, or work elsewhere) instead of overwriting.`;
      }
    }
    if (limb.kind === 'code' && !spec.readonly) {
      const limit = spec.risk === 'reflex' ? this.config.reflexPerSecond : this.config.limbPerSecond;
      const now = performance.now();
      limb.effectTimes = limb.effectTimes.filter(t => now - t < 1000);
      if (limb.effectTimes.length >= limit) return `rate limited: at most ${limit} "${spec.risk}" effects per second for a watch or program`;
      limb.effectTimes.push(now);
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

  /** Wakes an LLM limb with a fresh run. A busy limb gets a parallel run instead of a queue. */
  wake(limbId: string, reason: string): void {
    const limb = this.limbs.get(limbId);
    if (!limb || limb.kind !== 'llm' || this.status !== 'running') return;
    if (limb.role === 'task' && (limb.status !== 'running' || limb.runs.size)) return;
    const run: RunInfo = { id: `run-${++this.counter}`, reason, startedAt: this.now(), readSeq: this.log.length, abort: new AbortController(), voice: limb.capabilities.has('speak') };
    limb.runs.set(run.id, run);
    if (run.voice) this.latestRun.set(limb.id, run.id);
    if (limb.id === 'head') this.lastHeadRunAt = run.startedAt;
    const prompt = this.render(limb, reason);
    this.log.append('run_started', limb.id, { run: run.id, reason });
    const parallel = this.config.parallel;
    const system = limb.role === 'head' ? headSystemPrompt(this.channels, this.limbs.has('voice'), parallel && !this.limbs.has('voice')) : limb.role === 'voice' ? voiceSystemPrompt(this.channels, parallel) : taskSystemPrompt(this.channels, parallel);
    this.mind.run({
      limbId: limb.id, runId: run.id, role: limb.role === 'head' || limb.role === 'voice' ? limb.role : 'task', model: limb.model!, system, prompt,
      tools: this.toolsFor(limb), signal: run.abort.signal,
      sessionKey: limb.role === 'task' ? limb.id : undefined,
      maxSteps: limb.role === 'task' ? this.config.taskMaxSteps : this.config.headMaxSteps,
      callTool: async (name, args) => {
        run.firstToolAt ??= this.now();
        if (run.abort.signal.aborted) return 'error: this run was stopped';
        if (limb.cancelRequested) return 'cancel requested: wrap up now and call finish_task with what you have.';
        // The front limb does not act on its reading of the conversation while the user is still typing:
        // the action waits for them to settle, and if they sent something new meanwhile, a newer run takes over.
        if (this.isFront(limb) && name !== 'note' && !this.effects.get(name)?.spec.readonly) {
          await this.userSettled();
          // A user message this run has not read will wake a newer run; acting now would answer a stale picture.
          if (this.log.since(run.readSeq).some(e => e.type === 'chat_message' && e.by === 'user')) {
            return 'superseded: the user sent another message after you read the state; a newer run will handle both. Nothing was done. Leave a note if you know something it should, then stop.';
          }
        }
        if (run.voice && run.id !== this.latestRun.get(limb.id) && name !== 'note' && name !== 'handoff' && !this.effects.get(name)?.spec.readonly) {
          return 'superseded: a newer run of you has woken with newer events and is handling things now. Nothing was done. Leave a note if you know something it should, then stop.';
        }
        const result = await this.callTool(limb, run, name, args ?? {});
        // Busy workers hear about steers, discoveries and claims with their next tool result, without being stopped.
        if (limb.role === 'task' && limb.notices.length) return `${result}\n\n[updates while you worked]\n${limb.notices.splice(0).join('\n')}`;
        return result;
      },
    }).then(result => {
      limb.runs.delete(run.id);
      this.log.append('run_finished', limb.id, { run: run.id, ms: Math.round(this.now() - run.startedAt), usage: result.usage ?? null });
      if (limb.role === 'task' && limb.status === 'running' && !run.abort.signal.aborted) {
        if (limb.notices.length) this.wake(limb.id, `updates arrived: ${limb.notices.splice(0).join(' | ').slice(0, 1500)}`);
        else this.finishTask(limb, result.text?.trim() || 'finished without a result', 'done');
      }
    }, error => {
      limb.runs.delete(run.id);
      if (run.abort.signal.aborted || this.status !== 'running') {
        this.log.append('run_finished', limb.id, { run: run.id, ms: Math.round(this.now() - run.startedAt), aborted: true });
        return;
      }
      this.crashed(limb, error instanceof Error ? error.message : String(error));
    });
  }

  private crashed(limb: Limb, message: string): void {
    const now = this.now();
    limb.crashes = limb.crashes.filter(t => now - t < this.config.restartWindowMs);
    limb.crashes.push(now);
    this.log.append('limb_failed', limb.id, { error: message.slice(0, 500) });
    this.addHealth(`${limb.id} crashed: ${message.slice(0, 200)}`);
    if (limb.crashes.length > this.config.restartMax) {
      if (limb.role === 'task') this.finishTask(limb, `failed: ${message}`, 'failed');
      return; // the head stays up but is not retried; the next event wakes it again
    }
    if (limb.role === 'task' && limb.status === 'running') this.wake(limb.id, `restart after crash: ${message.slice(0, 200)}`);
  }

  private finishTask(limb: Limb, result: string, status: 'done' | 'failed' | 'cancelled' | 'killed'): void {
    if (limb.status !== 'running') return;
    limb.status = status;
    limb.result = result;
    for (const child of limb.children) this.stopLimb(child, 'cancel', limb.id);
    this.releaseClaims(limb.id);
    if (this.config.parallel && status === 'done') this.keepSession(limb.id);
    else this.mind.forget?.(limb.id);
    this.log.append('task_done', limb.id, { status, result: result.slice(0, 4000), task: limb.task ?? '' });
    // In parallel conversation workers answer the user themselves; the head is only woken to orchestrate.
    if (limb.parent && !this.config.parallel) this.wake(limb.parent, `task ${limb.id} ${status}`);
    for (const waiting of this.limbs.values()) {
      if (waiting.waitFor === limb.id && waiting.status === 'running') { waiting.waitFor = undefined; this.wake(waiting.id, `${limb.id} finished (${status}): ${result.slice(0, 500)}`); }
    }
  }

  private keepSession(id: string): void {
    this.keptSessions = [...this.keptSessions.filter(k => k !== id), id];
    while (this.keptSessions.length > this.config.keptSessions) this.mind.forget?.(this.keptSessions.shift()!);
  }

  /** Parallel conversation: a worker for one user message, started at once (or when the worker it waits for finishes). */
  private dispatch(by: Limb, args: { task: string; name?: string; model?: string; after?: string; reply_to?: number; fork_of?: string }): string {
    const running = [...this.limbs.values()].filter(l => l.role === 'task' && l.status === 'running').length;
    if (running >= this.config.maxTasks) return `error: ${running} workers already running (max ${this.config.maxTasks}); cancel one or steer an existing worker`;
    if (args.after && !this.limbs.get(args.after)) return `error: no worker "${args.after}" to wait for`;
    const source = args.fork_of ? this.limbs.get(args.fork_of) : undefined;
    if (args.fork_of && (!source || source.role !== 'task')) return `error: no worker "${args.fork_of}" to fork`;
    const model = args.model === 'head' ? this.options.models.head : this.options.models.task;
    const caps: Capability[] = ['speak', ...(this.config.codeLimbs ? ['set_watch', 'run_program'] as Capability[] : []), 'cancel'];
    const limb = this.createLimb({ kind: 'llm', role: 'task', name: args.name ?? (source ? `${source.name} (fork)` : 'worker'), parent: 'head', model, capabilities: caps, restart: 'transient' });
    limb.task = args.task;
    limb.status = 'running';
    limb.replyTo = args.reply_to ?? this.lastUserMessageSeq();
    if (source && !this.mind.fork?.(source.id, limb.id)) return `error: ${source.id}'s conversation is no longer kept; dispatch a fresh worker instead`;
    this.log.append('limb_spawned', by.id, { id: limb.id, name: limb.name, task: args.task, model, reply_to: limb.replyTo ?? null, fork_of: source?.id ?? null, after: args.after ?? null });
    const target = args.after ? this.limbs.get(args.after) : undefined;
    if (target && target.status === 'running') { limb.waitFor = target.id; return `worker ${limb.id} "${limb.name}" will start when ${target.id} finishes`; }
    this.wake(limb.id, source ? `forked from ${source.id} for a new request` : 'task assigned');
    return `worker ${limb.id} "${limb.name}" started${source ? ` from ${source.id}'s conversation` : ''}`;
  }

  /** Parallel conversation: a message for one worker, delivered with its next tool result (or reviving it if idle). */
  private steer(by: Limb, id: string, text: string): string {
    const limb = this.limbs.get(id);
    if (!limb || limb.role !== 'task') return `error: no worker "${id}"`;
    this.log.append('steered', by.id, { id, text: text.slice(0, 2000) });
    const note = `Message from the user (via ${by.id}): ${text}`;
    if (limb.status === 'running' && limb.runs.size) { limb.notices.push(note); return `${id} will get it with its next tool result`; }
    if (limb.status === 'running') { this.wake(limb.id, note.slice(0, 2000)); return `${id} woken with it`; }
    if (limb.status !== 'done' || !this.keptSessions.includes(limb.id)) return `error: ${id} is ${limb.status} and its conversation is gone; dispatch a fresh worker instead`;
    limb.status = 'running';
    limb.replyTo = this.lastUserMessageSeq();
    this.log.append('limb_revived', by.id, { id });
    this.wake(limb.id, note.slice(0, 2000));
    return `${id} picked the conversation back up`;
  }

  /** Resolves once the user is not typing (draft quiet for messageSettleMs), or after messageSettleMaxMs. */
  private async userSettled(): Promise<void> {
    const started = this.now();
    for (;;) {
      const typing = this.levels.get('user.typing') !== undefined;
      const quietFor = this.now() - (this.lastEvents.get('user:draft_changed') ?? -Infinity);
      if (!typing || quietFor >= this.config.messageSettleMs || this.now() - started >= this.config.messageSettleMaxMs || this.status !== 'running') return;
      await new Promise(resolve => setTimeout(resolve, Math.min(100, this.config.messageSettleMs - quietFor + 5)));
    }
  }

  private lastUserMessageSeq(): number | undefined {
    const all = this.log.all();
    for (let i = all.length - 1; i >= 0; i--) if (all[i].type === 'chat_message' && all[i].by === 'user') return all[i].seq;
    return undefined;
  }

  private notifyWorkers(except: string, text: string): void {
    for (const limb of this.limbs.values()) if (limb.role === 'task' && limb.status === 'running' && limb.id !== except) limb.notices.push(text);
  }

  private claimPaths(limb: Limb, paths: string[], note: string): string | null {
    for (const path of paths) {
      const holder = this.claimHolder(path, limb.id);
      if (holder) return `"${path}" is claimed by ${holder.limb} (${holder.note || 'no note'}) since ${this.ago(holder.since)}`;
    }
    for (const path of paths) {
      if (this.claims.get(path)?.limb === limb.id) continue;
      this.claims.set(path, { path, limb: limb.id, note, since: this.now() });
      this.log.append('claimed', limb.id, { path, note });
      this.notifyWorkers(limb.id, `${limb.id} claimed ${path}${note ? ` (${note})` : ''}`);
    }
    return null;
  }

  /** Another running limb's claim that overlaps this path (same path, or one contains the other). */
  private claimHolder(path: string, self: string): Claim | undefined {
    const norm = (p: string) => p.replace(/^\.?\/+/, '').replace(/\/+$/, '');
    const target = norm(path);
    for (const claim of this.claims.values()) {
      if (claim.limb === self || this.limbs.get(claim.limb)?.status !== 'running') continue;
      const held = norm(claim.path);
      if (held === target || target.startsWith(`${held}/`) || held.startsWith(`${target}/`) || held === '' ) return claim;
    }
    return undefined;
  }

  private releaseClaims(limbId: string, paths?: string[]): number {
    let released = 0;
    for (const [path, claim] of [...this.claims]) {
      if (claim.limb !== limbId || (paths && !paths.includes(path))) continue;
      this.claims.delete(path);
      released++;
    }
    if (released) this.log.append('released', limbId, { count: released });
    return released;
  }

  private spawnTask(author: Limb, task: string, name: string): string {
    const running = [...this.limbs.values()].filter(l => l.role === 'task' && l.status === 'running').length;
    if (running >= this.config.maxTasks) return `error: ${running} tasks already running (max ${this.config.maxTasks})`;
    const limb = this.createLimb({ kind: 'llm', role: 'task', name, parent: author.id, model: this.options.models.task, capabilities: [...(this.config.codeLimbs ? ['set_watch', 'run_program'] as Capability[] : []), 'cancel'], restart: 'transient' });
    limb.task = task;
    limb.status = 'running';
    this.log.append('limb_spawned', author.id, { id: limb.id, name, task });
    this.wake(limb.id, 'task assigned');
    return `task limb ${limb.id} "${name}" started; you will be woken when it reports or finishes`;
  }

  /** Cancel (graceful, then kill after a grace period) or kill (immediate). */
  stopLimb(id: string, mode: 'cancel' | 'kill', by: string): string {
    const limb = this.limbs.get(id);
    if (!limb || limb.id === 'head') return `error: no limb "${id}" to stop`;
    if (limb.status !== 'running') return `${id} is already ${limb.status}`;
    if (limb.kind === 'code') { this.endCodeLimb(limb, mode === 'kill' ? 'killed' : 'cancelled', `${mode} by ${by}`); return `${id} ${mode === 'kill' ? 'killed' : 'cancelled'}`; }
    if (mode === 'kill' || !limb.runs.size) {
      for (const run of limb.runs.values()) run.abort.abort();
      this.finishTask(limb, limb.result ?? `${mode === 'kill' ? 'killed' : 'cancelled'} by ${by}`, mode === 'kill' ? 'killed' : 'cancelled');
      return `${id} ${mode === 'kill' ? 'killed' : 'cancelled'}`;
    }
    limb.cancelRequested = true;
    const timer = setTimeout(() => { this.timers.delete(timer); if (limb.status === 'running') this.stopLimb(id, 'kill', `${by} (grace period over)`); }, this.config.cancelGraceMs);
    this.timers.add(timer);
    return `${id}: cancel requested; it will be killed in ${this.config.cancelGraceMs / 1000} s if it does not finish`;
  }

  private endCodeLimb(limb: Limb, status: LimbStatus, reason: string, result?: unknown): void {
    if (limb.status !== 'running') return;
    limb.status = status;
    limb.abort?.abort();
    if (limb.sense || limb.role === 'program') this.jev.release(limb.id);
    const type = limb.role === 'program'
      ? status === 'done' ? 'program_finished' : status === 'failed' ? 'program_failed' : 'program_cancelled'
      : 'watch_removed';
    this.log.append(type, limb.id, { id: limb.id, name: limb.name, reason, ...(result !== undefined ? { result: result as never } : {}) });
  }

  private callTool(limb: Limb, run: RunInfo, name: string, args: Record<string, unknown>): Promise<string> | string {
    const caller: Caller = { limbId: limb.id, kind: 'llm', runId: run.id, readSeq: run.readSeq };
    const has = (cap: Capability) => limb.capabilities.has(cap);
    switch (name) {
      case 'set_watch':
        if (!has('set_watch')) return 'error: you cannot install watches';
        return this.installWatch(limb, (args.watch ?? args) as WatchSpec);
      case 'run_program': {
        if (!has('run_program')) return 'error: you cannot run programs';
        const error = validate(TOOL_SCHEMAS.run_program, args, 'args');
        if (error) return `error: ${error}`;
        const started = this.startProgram(limb, String(args.name), String(args.code));
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
      case 'spawn':
        if (!has('spawn')) return 'error: you cannot spawn limbs';
        return this.spawnTask(limb, String(args.task ?? ''), String(args.name ?? 'task'));
      case 'cancel':
      case 'kill': {
        if (!has(name)) return `error: you cannot ${name} limbs`;
        const target = String(args.id ?? '');
        const frontOnWorker = this.config.parallel && this.isFront(limb) && this.limbs.get(target)?.role === 'task';
        if (!frontOnWorker && (!this.isWithin(target, limb.id) || target === limb.id)) return `error: ${target} is not one of your children`;
        if (this.limbs.get(target)?.builtin) return `error: ${target} is built into the runtime and cannot be cancelled`;
        return this.stopLimb(target, name, limb.id);
      }
      case 'dispatch':
      case 'fork': {
        if (!this.isFront(limb) && limb.id !== 'head') return 'error: only the front limb dispatches workers';
        const error = validate(TOOL_SCHEMAS[name], args, 'args');
        if (error) return `error: ${error}`;
        return this.dispatch(limb, { ...(args as { task: string }), fork_of: name === 'fork' ? String(args.worker) : undefined });
      }
      case 'steer': {
        if (!this.isFront(limb) && limb.id !== 'head') return 'error: only the front limb steers workers';
        return this.steer(limb, String(args.worker ?? ''), String(args.text ?? ''));
      }
      case 'claim': {
        const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
        const refused = this.claimPaths(limb, paths, String(args.note ?? ''));
        return refused ? `refused: ${refused}` : `claimed ${paths.join(', ')}`;
      }
      case 'release': return `released ${this.releaseClaims(limb.id, Array.isArray(args.paths) ? args.paths.map(String) : undefined)} claim(s)`;
      case 'share': {
        const text = String(args.text ?? '').slice(0, 1000);
        this.discoveries.push({ by: limb.id, text, t: this.now() });
        if (this.discoveries.length > 20) this.discoveries.shift();
        this.log.append('discovery', limb.id, { text });
        this.notifyWorkers(limb.id, `${limb.id} shares: ${text}`);
        return 'shared with the other workers';
      }
      case 'handoff':
        if (limb.role !== 'voice') return 'error: only the voice hands off';
        this.log.append('handoff', limb.id, { note: String(args.note ?? '').slice(0, 2000) });
        this.wake('head', `voice handed off: ${String(args.note ?? '').slice(0, 300)}`);
        return 'handed off to the head';
      case 'report':
        if (limb.role !== 'task') return 'error: only task limbs report';
        this.log.append('task_progress', limb.id, { text: String(args.text ?? '').slice(0, 2000) });
        if (limb.parent) this.wake(limb.parent, `progress from ${limb.id}`);
        return 'reported';
      case 'finish_task':
        if (limb.role !== 'task') return 'error: only task limbs finish tasks';
        run.abort.abort();
        this.finishTask(limb, String(args.result ?? ''), 'done');
        return 'task finished';
      default:
        if (limb.role === 'task' && name === 'say' && args.reply_to === undefined && limb.replyTo !== undefined) args = { ...args, reply_to: limb.replyTo };
        return this.commit(caller, name, args);
    }
  }

  private toolsFor(limb: Limb): ToolSpec[] {
    const tools: ToolSpec[] = [];
    const add = (name: keyof typeof TOOL_SCHEMAS, description: string) => tools.push({ name, description, parameters: toJsonSchema(TOOL_SCHEMAS[name]) });
    for (const { spec } of this.effects.values()) {
      if (spec.voice && !limb.capabilities.has('speak')) continue;
      tools.push({ name: spec.name, description: `${spec.description}${spec.risk === 'reflex' ? ' (reflex-safe)' : ''}`, parameters: toJsonSchema(spec.parameters) });
    }
    const router = () => {
      add('dispatch', 'Start a worker (a capable model) on a user request right away. It replies to the user itself. Use "after" to start it only when another worker finishes.');
      add('fork', 'Start a worker from another worker\'s conversation, for a request that builds on its context.');
      add('steer', 'Send a message to one worker: it gets it with its next tool result (or wakes up with it).');
      add('cancel', 'Cancel a worker by id.');
    };
    if (limb.role === 'voice') {
      add('note', 'Keep a short note in your state; you remember nothing else between wakes.');
      if (this.config.parallel) router();
      else add('handoff', 'Wake the head (slower, smarter) for anything you should not handle yourself. The note says what is needed.');
      return tools;
    }
    if (this.config.parallel && limb.role === 'head' && !this.limbs.has('voice')) { router(); tools.splice(tools.findIndex(t => t.name === 'cancel'), 1); }
    if (limb.capabilities.has('set_watch')) add('set_watch', 'Install a watch: a code reflex that reacts in ~0 ms without you.');
    if (limb.capabilities.has('run_program')) add('run_program', 'Run a JavaScript program (the body of an async function) as a code limb.');
    add('stop_output', 'Stop output. scope "work" (default): your programs, watches and task limbs, not you; "subtree": you too. mode "stop" (default) cancels programs; "freeze" pauses everything at its next action until resume_output.');
    add('resume_output', 'Resume output after a stop.');
    add('note', 'Keep a short note in your state; you remember nothing else between wakes.');
    add('set_timer', 'Be woken after a delay.');
    if (limb.capabilities.has('spawn')) add('spawn', 'Start a task limb (a stronger, slower model) for work that needs real thinking.');
    if (limb.capabilities.has('cancel')) add('cancel', 'Cancel one of your watches, programs or task limbs by id.');
    if (limb.capabilities.has('kill')) add('kill', 'Stop one of your children immediately, dropping partial work.');
    if (limb.role === 'task' && this.config.parallel) {
      add('claim', 'Claim files or folders you are working on, so other workers leave them alone. Writing a file claims it automatically.');
      add('release', 'Release your claims (all, or the given paths).');
      add('share', 'Share a discovery that other workers should know (e.g. a root cause).');
      add('finish_task', 'Finish: first say your answer to the user, then call this with a one-line summary.');
    } else if (limb.role === 'task') { add('report', 'Report progress to the head.'); add('finish_task', 'Finish your task with a result.'); }
    return tools;
  }

  // ---------- rendering ----------

  private ago = (t: number) => `${((this.now() - t) / 1000).toFixed(1)}s ago`;

  private render(limb: Limb, reason: string): string {
    const now = this.now();
    const ctx = { now, ago: this.ago, levels: this.levels };
    const stable: Record<string, unknown> = { you: `${limb.id} (${limb.role})`, notes: this.notes };
    if (limb.role === 'task') stable.task = limb.task;
    stable.limbs = [...this.limbs.values()].filter(l => l.status === 'running' || now - l.createdAt < 60_000).map(l => this.describeLimb(l));
    const tasks = [...this.limbs.values()].filter(l => l.role === 'task');
    if (tasks.length) stable[this.config.parallel ? 'workers' : 'tasks'] = tasks.map(l => ({
      id: l.id, name: l.name, task: l.task, status: l.status + (l.waitFor ? ` (waiting for ${l.waitFor})` : '') + (l.runs.size ? ' (working)' : ''),
      reply_to: l.replyTo, result: l.result, claims: [...this.claims.values()].filter(c => c.limb === l.id).map(c => c.path),
    }));
    if (this.discoveries.length) stable.discoveries = this.discoveries.map(d => `${d.by}: ${d.text}`);
    const volatile: Record<string, unknown> = {};
    for (const channel of this.channels) {
      const rendered = channel.render(this.world[channel.name] as never, ctx);
      if (rendered.stable !== undefined) stable[channel.name] = rendered.stable;
      if (rendered.volatile !== undefined) volatile[channel.name] = rendered.volatile;
    }
    const levels = this.levels.entries();
    if (levels.length) volatile.levels = Object.fromEntries(levels.map(([name, level]) => [name, `${JSON.stringify(level.value)} for ${((now - level.since) / 1000).toFixed(1)}s`]));
    if (this.stops.length) volatile.output_stops = this.stops.map(s => ({ ...s, since: this.ago(s.since) }));
    if (this.health.length) volatile.health = this.health.slice(-5).map(h => `${h.message} (${this.ago(h.t)})`);
    const fresh = this.log.since(limb.seenSeq).filter(e => !HIDDEN_EVENTS.has(e.type)).slice(-this.config.recentEvents);
    limb.seenSeq = this.log.length;
    const time = { now_s: +(now / 1000).toFixed(1), last_spoke: this.lastSpoke(), woken_because: reason };
    return [
      'STATE (stable)', JSON.stringify(stable, null, 1),
      'STATE (live)', JSON.stringify(volatile, null, 1),
      'NEW EVENTS since your last wake', fresh.map(e => `#${e.seq} ${this.ago(e.t)} ${e.by} ${e.type} ${JSON.stringify(e.data)}`).join('\n') || '(none)',
      'TIME', JSON.stringify(time),
    ].join('\n');
  }

  private describeLimb(limb: Limb): string {
    const base = `${limb.id} ${limb.builtin ? 'built-in ' : ''}${limb.role} "${limb.name}" ${limb.status}${limb.parent ? ` (parent ${limb.parent})` : ''}`;
    if (limb.role === 'watch') return `${base}: on ${JSON.stringify(limb.watch!.on)} do ${JSON.stringify(limb.watch!.do)}, fired ${limb.fires ?? 0}x`;
    if (limb.role === 'program') return `${base}, started ${this.ago(limb.createdAt)}`;
    if (limb.kind === 'llm') return `${base}${limb.runs.size ? `, ${limb.runs.size} run(s) in flight` : ''}`;
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

  private createLimb(init: { id?: string; kind: 'llm' | 'code'; role: LimbRole; name: string; parent?: string; model?: string; capabilities: Capability[]; restart: 'permanent' | 'transient' }): Limb {
    const id = init.id ?? `${init.role}-${++this.counter}`;
    const limb: Limb = {
      id, kind: init.kind, role: init.role, name: init.name, parent: init.parent, model: init.model,
      capabilities: new Set(init.capabilities), restart: init.restart, status: 'idle', createdAt: this.now(),
      children: new Set(), runs: new Map(), seenSeq: 0, crashes: [], effectTimes: [], notices: [],
    };
    this.limbs.set(id, limb);
    if (init.parent) this.limbs.get(init.parent)?.children.add(id);
    return limb;
  }

  private isFront(limb: Limb): boolean { return limb.id === this.frontLimb(); }

  /** Who answers first: the voice limb when configured, otherwise the head. */
  private frontLimb(): string { return this.limbs.has('voice') ? 'voice' : 'head'; }

  private isWithin(id: string, ancestor: string): boolean {
    for (let current: string | undefined = id; current; current = this.limbs.get(current)?.parent) if (current === ancestor) return true;
    return false;
  }

  private countCode(): number { return [...this.limbs.values()].filter(l => l.kind === 'code' && l.status === 'running').length; }

  private addHealth(message: string): void {
    this.health.push({ t: this.now(), message });
    if (this.health.length > 50) this.health.shift();
  }

  private snapshotWorld(): Record<string, unknown> {
    return JSON.parse(JSON.stringify({ world: this.world, levels: Object.fromEntries(this.levels.entries()), notes: this.notes }));
  }

  snapshot(): EntitySnapshot {
    const jev = this.jev.stats;
    return {
      status: this.status,
      t: this.now(),
      world: JSON.parse(JSON.stringify(this.world)),
      self: { notes: [...this.notes] },
      levels: Object.fromEntries(this.levels.entries()),
      stops: [...this.stops],
      health: [...this.health],
      limbs: [...this.limbs.values()].map(l => ({
        id: l.id, kind: l.kind, role: l.role, name: l.name, parent: l.parent, model: l.model, status: l.status,
        runs: [...l.runs.values()].map(r => ({ id: r.id, reason: r.reason, startedAt: r.startedAt, firstToolAt: r.firstToolAt, voice: r.voice })),
        task: l.task, result: l.result, watch: l.watch, code: l.code, fires: l.fires,
      })),
      senses: this.jev.list(),
      jev: { available: this.jev.available, calls: jev.calls, perMinute: jev.perMinute },
    };
  }
}

/** Tuned on Jev: complete requests score about 0.4-0.85; fragments, asides and "can you" 0.18 or less. */
export const DRAFT_PAUSE_MS = 700;
export const DRAFT_ATTENTION_QUESTION = 'Does the unsent draft already contain a question or request to the entity that is clear enough to answer or act on?';

const HIDDEN_EVENTS = new Set(['run_started', 'run_finished', 'draft_changed', 'sensed', 'judged', 'program_log']);

const TOOL_SCHEMAS = {
  set_watch: { type: 'object', additionalProperties: false, required: ['watch'], properties: { watch: watchSchema } },
  run_program: {
    type: 'object', additionalProperties: false, required: ['name', 'code'],
    properties: { name: { type: 'string', maxLength: 80 }, code: { type: 'string', maxLength: 20_000, description: 'Body of an async function' } },
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
  spawn: {
    type: 'object', additionalProperties: false, required: ['task'],
    properties: { task: { type: 'string', maxLength: 8000 }, name: { type: 'string', maxLength: 80 } },
  },
  cancel: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } },
  kill: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } },
  report: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 2000 } } },
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
  fork: {
    type: 'object', additionalProperties: false, required: ['worker', 'task'],
    properties: { worker: { type: 'string' }, task: { type: 'string', maxLength: 8000 }, name: { type: 'string', maxLength: 60 }, reply_to: { type: 'integer' } },
  },
  steer: { type: 'object', additionalProperties: false, required: ['worker', 'text'], properties: { worker: { type: 'string' }, text: { type: 'string', maxLength: 4000 } } },
  claim: {
    type: 'object', additionalProperties: false, required: ['paths'],
    properties: { paths: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 50 }, note: { type: 'string', maxLength: 200 } },
  },
  release: { type: 'object', additionalProperties: false, properties: { paths: { type: 'array', items: { type: 'string' }, maxItems: 50 } } },
  share: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 1000 } } },
  finish_task: { type: 'object', additionalProperties: false, required: ['result'], properties: { result: { type: 'string', maxLength: 8000 } } },
} satisfies Record<string, Schema>;
