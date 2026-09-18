import type { ReflexAnswers, ReflexEvaluate, ReflexRule, ReflexTable, ReflexTick } from './types';
import { decisionConfidence, factAnswers, matchRule, tableQuestions, violatedExpectations } from './rules';
import { assertReflexTable } from './validate';

export type ReflexSnapshot<S> = {
  state: S;
  /** What the evaluator receives. Keep it trimmed to the decision. */
  serialized: unknown;
  /** Identity of the evaluated content; an unchanged key means nothing new to decide. */
  key: string;
  /** Code-computed facts for this tick, exposed to rules as `fact:<name>` answers. */
  facts?: Record<string, boolean | number>;
  /** Whether an unchanged key should be re-evaluated on the repoll cadence (for time-dependent state). Defaults to whether repollMs is set. */
  repoll?: boolean;
  /** Re-poll cadence for this snapshot, overriding the loop's repollMs (for example backing off as silence grows). */
  repollMs?: number;
};

export type ReflexLoopOptions<S> = {
  table: ReflexTable;
  evaluate: ReflexEvaluate;
  /** Null when there is nothing to evaluate. */
  snapshot(): ReflexSnapshot<S> | null;
  /** Whether a finished evaluation may still act. Default: the current key equals the evaluated key. */
  stillValid?(evaluated: ReflexSnapshot<S>, current: ReflexSnapshot<S> | null): boolean;
  act(rule: ReflexRule, answers: ReflexAnswers, snapshot: ReflexSnapshot<S>, signal: AbortSignal, tick: ReflexTick<S>): Promise<void> | void;
  onWake?(reason: string, snapshot: ReflexSnapshot<S>, answers: ReflexAnswers | undefined): void;
  onTick?(tick: ReflexTick<S>): void;
  onError?(message: string): void;
  onChange?(): void;
  /** Return a delay in milliseconds to retry a failed evaluation automatically, or null to pause and report it. Receives the consecutive failure count. */
  retryDelayMs?(error: unknown, failures: number): number | null;
  /** Minimum time between evaluation starts after a change. */
  intervalMs?: number;
  /** Re-evaluate an unchanged key on this cadence, for time-dependent state. Omit to wait for notify(). */
  repollMs?: number;
  /** Actions the table may reference; validated on every table change. */
  actions?: Iterable<string>;
  /** When a change arrives mid-evaluation, abort that evaluation so the new state is evaluated at once (for example speech arriving during a sense-only tick). */
  preempt?(evaluating: ReflexSnapshot<S>, current: ReflexSnapshot<S>, elapsedMs: number): boolean;
  now?(): number;
  id?(): string;
};

export const REFLEX_DEFAULT_INTERVAL_MS = 250;

/** One evaluation in flight, coalesced changes, stale decisions discarded, first matching rule acts. */
export class ReflexLoop<S = unknown> {
  private stopped = false;
  private paused = false;
  private evaluating = false;
  private evaluatedKey: string | null = null;
  private lastStarted = -Infinity;
  private lastWake = -Infinity;
  private lowConfidenceStreak = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private intervalMs: number;
  private current: ReflexTable;
  private inFlight: { snapshot: ReflexSnapshot<S>; abort: AbortController; done: Promise<void>; startedAt: number } | null = null;
  private failures = 0;
  private retryAt = -Infinity;
  readonly abort = new AbortController();

  constructor(private readonly options: ReflexLoopOptions<S>) {
    assertReflexTable(options.table, options.actions);
    this.current = options.table;
    this.intervalMs = options.intervalMs ?? REFLEX_DEFAULT_INTERVAL_MS;
  }

  get table() { return this.current; }
  get busy() { return this.evaluating; }
  get isPaused() { return this.paused; }
  get lowConfidenceTicks() { return this.lowConfidenceStreak; }
  get isStopped() { return this.stopped; }

  /** The state changed: evaluate again after the minimum interval. */
  notify(): void {
    if (this.stopped) return;
    this.evaluatedKey = null;
    clearTimeout(this.timer); this.timer = undefined;
    if (this.inFlight && this.options.preempt) {
      const current = this.options.snapshot();
      if (current && current.key !== this.inFlight.snapshot.key && this.options.preempt(this.inFlight.snapshot, current, this.now() - this.inFlight.startedAt)) this.inFlight.abort.abort();
    }
    this.options.onChange?.();
    this.schedule();
  }

  setTable(table: ReflexTable): void {
    assertReflexTable(table, this.options.actions);
    this.current = table;
    this.lowConfidenceStreak = 0;
    this.notify();
  }

  setIntervalMs(intervalMs: number): void {
    this.intervalMs = intervalMs;
    clearTimeout(this.timer); this.timer = undefined;
    this.schedule();
  }

  /** Resolves once no evaluation is in flight. */
  async idle(): Promise<void> { while (this.inFlight) await this.inFlight.done; }

  pause(paused: boolean): void { this.paused = paused; if (!paused) this.retry(); }
  retry(): void { if (this.stopped) return; this.paused = false; this.failures = 0; this.retryAt = -Infinity; this.evaluatedKey = null; this.schedule(); }
  stop(): void { this.stopped = true; clearTimeout(this.timer); this.timer = undefined; this.abort.abort(); }

  private now() { return this.options.now?.() ?? Date.now(); }

  private schedule(): void {
    if (this.stopped || this.paused || this.evaluating || this.timer) return;
    const snapshot = this.options.snapshot();
    if (!snapshot) return;
    const unchanged = snapshot.key === this.evaluatedKey;
    if (unchanged && !(snapshot.repoll ?? this.options.repollMs !== undefined)) return;
    // Never poll unchanged content in a tight loop, even with a zero interval in tests.
    const interval = unchanged ? Math.max(50, snapshot.repollMs ?? this.options.repollMs ?? 0, this.intervalMs) : this.intervalMs;
    const delay = Math.max(0, interval - (this.now() - this.lastStarted), this.retryAt - this.now());
    this.timer = setTimeout(() => { this.timer = undefined; void this.evaluate(); }, delay);
  }

  private wake(reason: string, snapshot: ReflexSnapshot<S>, answers: ReflexAnswers | undefined): boolean {
    if (this.now() - this.lastWake < this.current.wake.cooldownMs) return false;
    this.lastWake = this.now();
    this.lowConfidenceStreak = 0;
    this.options.onWake?.(reason, snapshot, answers);
    return true;
  }

  private async evaluate(): Promise<void> {
    if (this.stopped || this.paused || this.evaluating) return;
    const snapshot = this.options.snapshot();
    if (!snapshot) return;
    const table = this.current;
    const questions = tableQuestions(table);
    const startedAt = this.now();
    const tick: ReflexTick<S> = { id: this.options.id?.() ?? `${startedAt}-${Math.random().toString(36).slice(2, 8)}`, startedAt, durationMs: 0,
      tableVersion: table.version, state: snapshot.state, serialized: snapshot.serialized, questions };
    const preemption = new AbortController();
    let settle!: () => void;
    this.inFlight = { snapshot, abort: preemption, done: new Promise<void>(resolve => { settle = resolve; }), startedAt };
    this.evaluating = true; this.lastStarted = startedAt; this.evaluatedKey = snapshot.key;
    this.options.onChange?.();
    try {
      const evaluated = await this.options.evaluate(snapshot.serialized, questions, AbortSignal.any([this.abort.signal, preemption.signal]));
      tick.durationMs = this.now() - startedAt;
      this.failures = 0; this.retryAt = -Infinity;
      if (this.stopped || this.paused || preemption.signal.aborted) { tick.stale = true; return; }
      for (const [id, question] of Object.entries(questions)) {
        const answer = evaluated?.[id];
        if (!answer || answer.type !== question.type) throw new Error(`The evaluator returned no ${question.type} answer for ${id}.`);
        if (answer.type === 'choice' && question.type === 'choice' && !(answer.choice in question.criteria)) throw new Error(`The evaluator chose an unknown option for ${id}.`);
      }
      const answers = { ...factAnswers(snapshot.facts), ...evaluated };
      tick.answers = answers;
      const valid = this.options.stillValid ? this.options.stillValid(snapshot, this.options.snapshot()) : this.options.snapshot()?.key === snapshot.key;
      if (!valid) { tick.stale = true; this.evaluatedKey = null; return; }
      const rule = matchRule(table, answers);
      tick.confidence = decisionConfidence(table, rule, answers);
      if (rule) {
        tick.rule = rule.id; tick.action = rule.do;
        await this.options.act(rule, answers, snapshot, this.abort.signal, tick);
      }
      if (this.stopped) return;
      const violated = violatedExpectations(table, answers);
      const reason = violated.length ? `expectation:${violated[0]}` : rule?.wake ? `rule:${rule.id}:${rule.wake}` : null;
      if (tick.confidence < table.wake.minConfidence) this.lowConfidenceStreak += 1; else this.lowConfidenceStreak = 0;
      const wakeReason = reason
        ?? (this.lowConfidenceStreak >= table.wake.lowConfidenceTicks ? 'low-confidence' : null)
        ?? (table.wake.maxTableAgeMs !== undefined && this.now() - table.createdAt > table.wake.maxTableAgeMs ? 'table-age' : null);
      if (wakeReason && this.wake(wakeReason, snapshot, answers)) tick.wake = wakeReason;
    } catch (error) {
      tick.durationMs = this.now() - startedAt;
      if (this.stopped) { tick.stale = true; return; }
      // A preempted evaluation is stale, not failed: newer state is waiting to be evaluated.
      if (preemption.signal.aborted) { tick.stale = true; this.lastStarted = -Infinity; return; }
      tick.error = error instanceof Error ? error.message : 'Reflex evaluation failed.';
      this.failures += 1;
      const retry = this.options.retryDelayMs?.(error, this.failures) ?? null;
      if (retry !== null) {
        // Transient failure: keep the state and try again shortly instead of pausing.
        this.retryAt = this.now() + retry;
        this.evaluatedKey = null;
      } else {
        this.paused = true;
        this.options.onError?.(tick.error);
      }
    } finally {
      this.inFlight = null;
      this.evaluating = false;
      settle();
      // Ticks are reported even after stop so a session's last evaluation is visible.
      this.options.onTick?.(tick);
      if (!this.stopped) {
        this.options.onChange?.();
        this.schedule();
      }
    }
  }
}
