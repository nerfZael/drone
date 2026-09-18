import {
  ReflexLoop, ReflexRecorder, applyBrainOutput, type ReflexAnswers, type ReflexBrainOutput, type ReflexCompileInput, type ReflexEvaluate,
  type ReflexQuestion, type ReflexRule, type ReflexSnapshot, type ReflexTable, type ReflexTick,
} from '@drone/reflex';
import { CompanionReflexTranscript, type CompanionTranscriptHistory, type CompanionTranscriptSnapshot } from './transcript';
import { COMPANION_REFLEX_ACTIONS, COMPANION_REFLEX_PURPOSE, COMPANION_REFLEX_SKIP_SILENCE_MS, COMPANION_REFLEX_STATE_DESCRIPTION, companionReflexTable } from './table';
import { computeCompanionFacts, computeCompanionSpeechFacts, observationKey, serializeCompanionObservation, type CompanionAutonomy, type CompanionFacts, type CompanionObservation, type CompanionSenseSources } from './senses';

export type CompanionBackendStatus = { status: 'idle' | 'working'; lastReply?: string };
export type CompanionSendOrigin = 'user' | 'nudge';

export type CompanionReflexDecision = {
  id: string;
  startedAt: number;
  durationMs: number;
  tableVersion: number;
  action?: string;
  rule?: string;
  /** False when a rule matched but code declined it, for example skipping before enough silence. */
  applied: boolean;
  /** True when autonomy is observe: the action was recorded, not executed. */
  dryRun?: boolean;
  /** Why code declined an autonomous action that matched, for example a cooldown. */
  suppressed?: string;
  /** The on-screen note or nudge text an autonomous action produced or would have produced. */
  note?: string;
  confidence?: number;
  answers?: ReflexAnswers;
  wake?: string;
  stale?: boolean;
  error?: string;
  input: { transcript: string; context: string; silenceMs: number };
  request: { state: unknown; questions: Record<string, ReflexQuestion> };
};

export type CompanionReflexWake = { reason: string; table?: ReflexTable; error?: string; durationMs: number; /** The loop wanted the brain but it is switched off; nothing changed. */ disabled?: boolean };

/** A live view into the loop: what it sees, what it last decided, and the playbook it is running. */
export type CompanionReflexInsight = {
  table: ReflexTable;
  evaluating: boolean;
  compiling: boolean;
  paused: boolean;
  pending: string;
  silenceMs: number;
  backend: CompanionBackendStatus;
  lastDecision: CompanionReflexDecision | null;
  lowConfidenceTicks: number;
  decisions: number;
  delegations: number;
  wakes: CompanionReflexWake[];
  autonomy: CompanionAutonomy;
  observation: CompanionObservation | null;
  facts: CompanionFacts | null;
};

export type CompanionReflexSessionOptions = {
  seedInstructions: string;
  evaluate: ReflexEvaluate;
  /** Acceptance of the delegated transcript. Resolve once the backend accepted it, not when it replied. */
  send(transcript: string, signal: AbortSignal, origin: CompanionSendOrigin): Promise<void>;
  cancel?(signal: AbortSignal): Promise<void>;
  /** off (default) keeps the loop speech-only. observe records autonomous actions without executing them. act executes them. */
  autonomy?: CompanionAutonomy;
  /** Extra senses and the note channel. Ignored while autonomy is off. */
  senses?: CompanionSenseSources;
  /** How often the senses are re-read for changes while autonomy is on. */
  senseIntervalMs?: number;
  /** Minimum time between nudges, and between repeats of the same note. */
  autonomousCooldownMs?: number;
  /** An evaluation older than this is restarted when more speech arrives. */
  slowEvaluationMs?: number;
  /** The brain: compile a revised table. Omit to run a static table. */
  compile?(input: ReflexCompileInput, signal: AbortSignal): Promise<ReflexBrainOutput>;
  backend?(): CompanionBackendStatus;
  history?: CompanionTranscriptHistory;
  table?: ReflexTable;
  intervalMs?: number;
  skipSilenceMs?: number;
  onDecision?(decision: CompanionReflexDecision): void;
  onWake?(wake: CompanionReflexWake): void;
  onError?(message: string): void;
  onChange?(): void;
  now?(): number;
  id?(): string;
};

const ACTION_NAMES = COMPANION_REFLEX_ACTIONS.map(action => action.name);

/** Unchanged speech is re-checked quickly at first, then less often the longer the silence lasts. */
export function silenceRepollMs(silenceMs: number): number {
  return silenceMs < 3_000 ? 0 : silenceMs < 10_000 ? 1_000 : silenceMs < 30_000 ? 3_000 : 10_000;
}

/** Companion's reflex loop: a transcript model, the reflex table, and code-owned actions. */
export class CompanionReflexSession {
  readonly transcript: CompanionReflexTranscript;
  readonly recorder = new ReflexRecorder<CompanionTranscriptSnapshot>({ maxEntries: 100 });
  private readonly loop: ReflexLoop<CompanionTranscriptSnapshot>;
  private applied = new Map<string, boolean>();
  private compiling = false;
  private lowConfidence: string[] = [];
  private lastDecision: CompanionReflexDecision | null = null;
  private decisions = 0;
  private wakes: CompanionReflexWake[] = [];
  private readonly autonomy: CompanionAutonomy;
  private senseTimer?: ReturnType<typeof setInterval>;
  private lastObservationKey = '';
  private lastObservation: CompanionObservation | null = null;
  private lastFacts: CompanionFacts | null = null;
  private notes = new Map<string, string>();
  private suppressions = new Map<string, string>();
  private lastNudgeAt = -Infinity;
  private lastNoteAt = new Map<string, number>();

  constructor(private readonly options: CompanionReflexSessionOptions) {
    const now = options.now ?? Date.now;
    this.autonomy = options.autonomy ?? 'off';
    this.transcript = new CompanionReflexTranscript(options.history, () => this.loop?.notify(), now);
    this.loop = new ReflexLoop<CompanionTranscriptSnapshot>({
      table: options.table ?? companionReflexTable(options.seedInstructions, { now, autonomy: this.autonomy }),
      actions: ACTION_NAMES,
      intervalMs: options.intervalMs,
      repollMs: options.intervalMs,
      now, id: options.id,
      evaluate: (state, questions, signal) => {
        if (String((state as { unsentTranscript?: string }).unsentTranscript ?? '').length > 120_000) {
          throw new Error('The unsent transcript exceeds the evaluation request limit. Your transcript is retained; end voice and review it before continuing.');
        }
        return options.evaluate(state, questions, signal);
      },
      snapshot: () => {
        const snapshot = this.transcript.snapshot() ?? this.emptySnapshot();
        const observation = this.observe();
        if (this.autonomy === 'off') {
          if (!snapshot.pending.trim()) return null;
          const backend = observation.backend;
          return {
            state: snapshot,
            serialized: { unsentTranscript: snapshot.pending, previousDelegatedTranscripts: snapshot.context, timing: { silenceMs: snapshot.silenceMs },
              backend: { status: backend.status, ...(backend.lastReply ? { lastReply: backend.lastReply.slice(0, 1_000) } : {}) } },
            key: this.speechKey(snapshot),
            facts: { ...computeCompanionSpeechFacts(snapshot.pending, snapshot.silenceMs, this.transcript.history.lastTranscriptAt) },
            repollMs: silenceRepollMs(snapshot.silenceMs),
          };
        }
        const facts = computeCompanionFacts(observation, snapshot.pending, snapshot.silenceMs, now(), this.transcript.history.lastTranscriptAt);
        this.lastObservation = observation; this.lastFacts = facts;
        if (!facts.speechPending && !facts.backendWorking && !facts.backendJustReplied && !facts.hasEvents) return null;
        return {
          state: snapshot,
          serialized: { unsentTranscript: snapshot.pending, previousDelegatedTranscripts: snapshot.context, timing: { silenceMs: snapshot.silenceMs },
            ...serializeCompanionObservation(observation, facts, now()) },
          key: `${this.speechKey(snapshot)}\u0000${observationKey(observation, facts)}`,
          facts: { ...facts },
          // Only pending speech is time-sensitive enough to re-evaluate unchanged; senses wake the loop when they change.
          repoll: facts.speechPending,
          repollMs: silenceRepollMs(snapshot.silenceMs),
        };
      },
      stillValid: evaluated => this.transcript.stillValid(evaluated.state),
      // Speech arriving during a sense-only tick must not wait behind it, and a slow evaluation
      // that new speech has already outdated is restarted rather than waited for.
      preempt: (evaluating, current, elapsedMs) => current.state.pending.trim().length > 0 && (!evaluating.state.pending.trim() || elapsedMs >= (options.slowEvaluationMs ?? 1_000)),
      act: (rule, answers, snapshot, signal, tick) => this.act(rule, answers, snapshot, signal, tick.id),
      onWake: (reason, snapshot, answers) => void this.wake(reason, snapshot, answers),
      onTick: tick => this.report(tick),
      // Gateway timeouts, overloads, and rate limits are retried with backoff; speech is retained meanwhile.
      retryDelayMs: (error, failures) => (failures <= 3 && /timed out|rate limiting|could not complete|Gateway request failed|Overloaded/i.test(error instanceof Error ? error.message : String(error)) ? 1_000 * 2 ** (failures - 1) : null),
      onError: options.onError,
      onChange: options.onChange,
    });
    if (this.autonomy !== 'off') {
      // Senses change without speech: re-read them and wake the loop when they do.
      this.senseTimer = setInterval(() => {
        if (this.loop.isStopped) return;
        const observation = this.observe();
        const snapshot = this.transcript.snapshot() ?? this.emptySnapshot();
        const facts = computeCompanionFacts(observation, snapshot.pending, snapshot.silenceMs, now(), this.transcript.history.lastTranscriptAt);
        const key = observationKey(observation, facts);
        if (key !== this.lastObservationKey) { this.lastObservationKey = key; this.loop.notify(); }
      }, options.senseIntervalMs ?? 1_000);
      (this.senseTimer as { unref?: () => void }).unref?.();
    }
  }

  private observe(): CompanionObservation {
    if (this.options.senses) return this.options.senses.observe();
    const backend = this.options.backend?.() ?? { status: 'idle' as const };
    return { backend: { status: backend.status, ...(backend.lastReply ? { lastReply: backend.lastReply } : {}) } };
  }

  private emptySnapshot(): CompanionTranscriptSnapshot {
    return { items: this.transcript.history.items.map(item => ({ ...item })), pending: '', context: this.transcript.history.delegations.slice(-5).join('\n\n').slice(-16_000),
      silenceMs: this.transcript.silenceMs, lastTranscriptAt: this.transcript.history.lastTranscriptAt };
  }

  private speechKey(snapshot: CompanionTranscriptSnapshot): string {
    return snapshot.items.map(item => `${item.id}:${item.sent}:${item.text}`).join('\n');
  }

  get table(): ReflexTable { return this.loop.table; }
  get busy(): boolean { return this.loop.busy; }
  get isCompiling(): boolean { return this.compiling; }
  get history(): CompanionTranscriptHistory { return this.transcript.history; }
  get pending(): string { return this.transcript.pending; }
  get displayTranscript(): string { return this.transcript.displayTranscript; }
  get silenceMs(): number { return this.transcript.silenceMs; }
  get autonomyLevel(): CompanionAutonomy { return this.autonomy; }

  insight(): CompanionReflexInsight {
    const observation = this.observe();
    const snapshot = this.transcript.snapshot() ?? this.emptySnapshot();
    const facts = this.autonomy === 'off' ? null : computeCompanionFacts(observation, snapshot.pending, snapshot.silenceMs, this.options.now?.() ?? Date.now(), this.transcript.history.lastTranscriptAt);
    return {
      table: this.loop.table, evaluating: this.loop.busy, compiling: this.compiling, paused: this.loop.isPaused,
      pending: this.transcript.pending, silenceMs: this.transcript.silenceMs, backend: { status: observation.backend.status, ...(observation.backend.lastReply ? { lastReply: observation.backend.lastReply } : {}) },
      lastDecision: this.lastDecision, lowConfidenceTicks: this.loop.lowConfidenceTicks, decisions: this.decisions,
      delegations: this.transcript.history.delegations.length, wakes: this.wakes.slice(-10),
      autonomy: this.autonomy, observation: this.autonomy === 'off' ? null : observation, facts,
    };
  }

  register(id: string, previousId?: string | null): void { if (!this.loop.isStopped) this.transcript.register(id, previousId); }
  append(delta: string, id: string): void { if (!this.loop.isStopped) this.transcript.append(delta, id); }
  complete(text: string, id: string): void { if (!this.loop.isStopped) this.transcript.complete(text, id); }
  pause(paused: boolean): void { this.loop.pause(paused); }
  retry(): void { this.loop.retry(); }
  stop(): void { this.loop.stop(); clearInterval(this.senseTimer); }
  /** Resolves once no evaluation is in flight. */
  idle(): Promise<void> { return this.loop.idle(); }
  setIntervalMs(intervalMs: number): void { this.loop.setIntervalMs(intervalMs); }
  setTable(table: ReflexTable): void { this.loop.setTable(table); }

  private async act(rule: ReflexRule, _answers: ReflexAnswers, snapshot: ReflexSnapshot<CompanionTranscriptSnapshot>, signal: AbortSignal, key: string): Promise<void> {
    const state = snapshot.state;
    if (rule.do === 'send') {
      await this.options.send(state.pending, signal, 'user');
      // A successful submission stays marked sent even if listening stopped during acceptance.
      this.transcript.advance(state, 'sent');
      this.applied.set(key, true);
    } else if (rule.do === 'skip') {
      const quiet = state.silenceMs >= (this.options.skipSilenceMs ?? COMPANION_REFLEX_SKIP_SILENCE_MS);
      if (quiet) this.transcript.advance(state, 'skipped');
      this.applied.set(key, quiet);
    } else if (rule.do === 'cancel') {
      if (this.options.cancel) await this.options.cancel(signal);
      if (signal.aborted) return;
      this.transcript.advance(state, 'cancelled');
      this.applied.set(key, true);
    } else if (rule.do === 'nudge') {
      const now = this.options.now?.() ?? Date.now();
      const cooldown = this.options.autonomousCooldownMs ?? 60_000;
      if (now - this.lastNudgeAt < cooldown) { this.suppressions.set(key, `nudged ${Math.round((now - this.lastNudgeAt) / 1000)} s ago; cooldown ${Math.round(cooldown / 1000)} s`); this.applied.set(key, false); return; }
      const backend = this.observe().backend;
      const quietFor = Math.round((now - Math.max(backend.lastActivityAt ?? 0, backend.startedAt ?? 0)) / 1000);
      const text = `Status check from Companion: no tool activity or reply for about ${quietFor} seconds while working on the last request. Briefly report progress and continue, or say what is blocking you.`;
      this.notes.set(key, text);
      this.lastNudgeAt = now;
      if (this.autonomy === 'act') { await this.options.send(text, signal, 'nudge'); this.applied.set(key, true); }
      else this.applied.set(key, false);
    } else if (rule.do === 'notify') {
      const now = this.options.now?.() ?? Date.now();
      const cooldown = this.options.autonomousCooldownMs ?? 60_000;
      const text = typeof rule.args?.text === 'string' && rule.args.text.trim() ? rule.args.text.slice(0, 500) : 'Companion noticed something worth a look.';
      const last = this.lastNoteAt.get(text) ?? -Infinity;
      if (now - last < cooldown) { this.suppressions.set(key, `same note shown ${Math.round((now - last) / 1000)} s ago`); this.applied.set(key, false); return; }
      this.notes.set(key, text);
      this.lastNoteAt.set(text, now);
      if (this.autonomy === 'act' && this.options.senses?.notify) { this.options.senses.notify(text); this.applied.set(key, true); }
      else this.applied.set(key, false);
    } else this.applied.set(key, false);
  }

  private report(tick: ReflexTick<CompanionTranscriptSnapshot>): void {
    const key = tick.id;
    const applied = this.applied.get(key) ?? false;
    const note = this.notes.get(key);
    const suppressed = this.suppressions.get(key);
    this.applied.delete(key); this.notes.delete(key); this.suppressions.delete(key);
    const autonomous = tick.action === 'nudge' || tick.action === 'notify';
    this.recorder.record(tick);
    if (tick.confidence !== undefined && tick.confidence < this.loop.table.wake.minConfidence) {
      this.lowConfidence = [...this.lowConfidence.slice(-4), `${JSON.stringify(tick.state.pending.slice(-300))} → ${tick.action ?? 'none'} (confidence ${tick.confidence.toFixed(2)})`];
    }
    const decision: CompanionReflexDecision = {
      id: tick.id, startedAt: tick.startedAt, durationMs: tick.durationMs, tableVersion: tick.tableVersion,
      action: tick.action, rule: tick.rule, applied, confidence: tick.confidence, answers: tick.answers, wake: tick.wake, stale: tick.stale, error: tick.error,
      ...(autonomous && this.autonomy === 'observe' ? { dryRun: true } : {}),
      ...(note ? { note } : {}),
      ...(suppressed ? { suppressed } : {}),
      input: { transcript: tick.state.pending, context: tick.state.context, silenceMs: tick.state.silenceMs },
      request: { state: tick.serialized, questions: tick.questions },
    };
    this.decisions += 1;
    this.lastDecision = decision;
    this.options.onDecision?.(decision);
  }

  /** The brain recompiles the table. Failures are reported and never pause the loop. */
  private async wake(reason: string, _snapshot: ReflexSnapshot<CompanionTranscriptSnapshot>, _answers: ReflexAnswers | undefined): Promise<void> {
    if (this.loop.isStopped) return;
    if (!this.options.compile) {
      // Record the wake so the wake rate is visible even with the brain off.
      this.wakes.push({ reason, durationMs: 0, disabled: true });
      this.options.onWake?.(this.wakes[this.wakes.length - 1]);
      return;
    }
    if (this.compiling) return;
    this.compiling = true;
    const startedAt = this.options.now?.() ?? Date.now();
    const elapsed = () => (this.options.now?.() ?? Date.now()) - startedAt;
    try {
      const output = await this.options.compile({
        purpose: COMPANION_REFLEX_PURPOSE,
        stateDescription: COMPANION_REFLEX_STATE_DESCRIPTION,
        actions: COMPANION_REFLEX_ACTIONS,
        base: this.loop.table,
        guidance: this.options.seedInstructions,
        observations: [`Wake reason: ${reason}.`, ...(this.lowConfidence.length ? ['Recent low-confidence decisions:', ...this.lowConfidence] : []),
          `Recent delegations: ${JSON.stringify(this.transcript.history.delegations.slice(-3))}`].join('\n'),
      }, this.loop.abort.signal);
      if (this.loop.isStopped) return;
      const table = applyBrainOutput(this.loop.table, output, { actions: ACTION_NAMES, now: this.options.now });
      this.loop.setTable(table);
      this.lowConfidence = [];
      this.wakes.push({ reason, table, durationMs: elapsed() });
      this.options.onWake?.(this.wakes[this.wakes.length - 1]);
    } catch (error) {
      if (this.loop.isStopped) return;
      this.wakes.push({ reason, error: error instanceof Error ? error.message : 'The brain could not compile a table.', durationMs: elapsed() });
      this.options.onWake?.(this.wakes[this.wakes.length - 1]);
    } finally {
      this.compiling = false;
    }
  }
}
