import type { Levels } from './channel.js';
import type { EventLog } from './log.js';
import type { EntityEvent } from './types.js';

export interface EvalQuestion {
  id: string;
  /** A yes/no question. The answer is the probability of "yes". */
  question: string;
}

/** Backs `judge` and `sense`: Jev, or a small fast LLM in the same role. */
export interface Evaluator {
  evaluate(questions: EvalQuestion[], state: string, signal: AbortSignal): Promise<Record<string, number>>;
}

export interface JevOptions {
  /** Longest a batch may take before its questions resolve to their defaults. */
  timeoutMs?: number;
  /** Minimum gap between sense re-asks. */
  senseIntervalMs?: number;
  /** Event types that make senses stale. */
  senseTriggers?: string[];
  maxPerMinute?: number;
  maxPerSession?: number;
  /** Most questions per call. Jev accepts 64. */
  maxBatch?: number;
}

interface PendingJudge { id: string; question: string; by: string; resolve(p: number): void; fallback: number }

export interface SenseInfo { id: string; question: string; level: string; owners: string[]; value?: number; askedAt?: number }

/**
 * The runtime service behind `judge` and `sense`. Code calls it; it only ever returns numbers.
 * Batches everything due in the same tick into one evaluator call, keeps senses fresh when relevant
 * state changes (one call in flight, at most once per interval), times out, caps spend, and logs
 * every question and answer so replays can reuse them.
 */
export class JevService {
  private readonly queue: PendingJudge[] = [];
  private readonly senses = new Map<string, SenseInfo>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private senseTimer: ReturnType<typeof setTimeout> | null = null;
  private senseDirty = false;
  private senseInFlight = false;
  private lastSenseAt = -Infinity;
  private readonly callTimes: number[] = [];
  private sessionCalls = 0;
  private nextId = 1;
  private closed = false;
  private readonly controllers = new Set<AbortController>();
  private readonly opts: Required<JevOptions>;

  constructor(
    private readonly evaluator: Evaluator | undefined,
    private readonly log: EventLog,
    private readonly levels: Levels,
    private readonly renderState: () => string,
    private readonly health: (message: string) => void,
    options: JevOptions = {},
  ) {
    this.opts = {
      timeoutMs: options.timeoutMs ?? 8000,
      senseIntervalMs: options.senseIntervalMs ?? 500,
      senseTriggers: options.senseTriggers ?? ['chat_message', 'draft_changed', 'transcript_partial', 'transcript_final'],
      maxPerMinute: options.maxPerMinute ?? 60,
      maxPerSession: options.maxPerSession ?? 2000,
      maxBatch: options.maxBatch ?? 64,
    };
  }

  get available(): boolean { return !!this.evaluator; }
  get stats() { return { calls: this.sessionCalls, perMinute: this.recentCalls(), senses: this.senses.size }; }

  judge(question: string, by: string, fallback = 0): Promise<number> {
    if (!this.evaluator || this.closed) return Promise.resolve(fallback);
    return new Promise(resolve => {
      this.queue.push({ id: `j${this.nextId++}`, question, by, resolve, fallback });
      this.flushTimer ??= setTimeout(() => { this.flushTimer = null; void this.flushJudges(); }, 0);
    });
  }

  /** Registers (or reuses) a continuous sense and returns its level name. */
  sense(question: string, owner: string): SenseInfo {
    const key = question.trim();
    let info = this.senses.get(key);
    if (!info) {
      info = { id: `s${this.nextId++}`, question: key, level: `sense.${slug(key)}`, owners: [] };
      this.senses.set(key, info);
      this.markSensesDirty();
    }
    if (!info.owners.includes(owner)) info.owners.push(owner);
    return info;
  }

  release(owner: string): void {
    for (const [key, info] of this.senses) {
      info.owners = info.owners.filter(o => o !== owner);
      if (!info.owners.length) { this.senses.delete(key); this.levels.clear(info.level); }
    }
  }

  list(): SenseInfo[] { return [...this.senses.values()]; }

  /** An already registered sense, without registering it. */
  find(question: string): SenseInfo | undefined { return this.senses.get(question.trim()); }

  /** Called for every appended event; relevant ones make senses stale. */
  observe(event: EntityEvent): void {
    if (this.opts.senseTriggers.includes(event.type)) this.markSensesDirty();
  }

  close(): void {
    this.closed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.senseTimer) clearTimeout(this.senseTimer);
    for (const c of this.controllers) c.abort();
    for (const pending of this.queue.splice(0)) pending.resolve(pending.fallback);
  }

  private markSensesDirty(): void {
    if (!this.evaluator || this.closed || !this.senses.size) return;
    this.senseDirty = true;
    if (this.senseInFlight || this.senseTimer) return;
    const wait = Math.max(0, this.lastSenseAt + this.opts.senseIntervalMs - performance.now());
    this.senseTimer = setTimeout(() => { this.senseTimer = null; void this.askSenses(); }, wait);
  }

  private async askSenses(): Promise<void> {
    if (!this.senseDirty || this.closed || !this.senses.size) return;
    this.senseDirty = false;
    this.senseInFlight = true;
    this.lastSenseAt = performance.now();
    const infos = [...this.senses.values()].slice(0, this.opts.maxBatch);
    const answers = await this.call(infos.map(i => ({ id: i.id, question: i.question })), 'system');
    this.senseInFlight = false;
    if (answers) {
      const now = this.log.length;
      for (const info of infos) {
        const p = answers[info.id];
        if (typeof p !== 'number') continue;
        info.value = p;
        info.askedAt = now;
        this.levels.set(info.level, p, 'jev');
      }
      this.log.append('sensed', 'system', { answers: Object.fromEntries(infos.filter(i => typeof answers[i.id] === 'number').map(i => [i.level, answers[i.id]])) });
    }
    if (this.senseDirty) this.markSensesDirty();
  }

  private async flushJudges(): Promise<void> {
    while (this.queue.length) {
      const batch = this.queue.splice(0, this.opts.maxBatch);
      void this.call(batch.map(b => ({ id: b.id, question: b.question })), batch[0].by).then(answers => {
        for (const pending of batch) {
          const p = answers?.[pending.id];
          const value = typeof p === 'number' ? p : pending.fallback;
          this.log.append('judged', pending.by, { question: pending.question, p: value, fallback: typeof p !== 'number' });
          pending.resolve(value);
        }
      });
    }
  }

  private recentCalls(): number {
    const cutoff = performance.now() - 60_000;
    while (this.callTimes.length && this.callTimes[0] < cutoff) this.callTimes.shift();
    return this.callTimes.length;
  }

  private async call(questions: EvalQuestion[], by: string): Promise<Record<string, number> | null> {
    if (!this.evaluator || this.closed) return null;
    if (this.recentCalls() >= this.opts.maxPerMinute || this.sessionCalls >= this.opts.maxPerSession) {
      this.health(`jev cap reached (${this.opts.maxPerMinute}/min, ${this.opts.maxPerSession}/session); using defaults`);
      return null;
    }
    this.callTimes.push(performance.now());
    this.sessionCalls++;
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    const started = performance.now();
    try {
      return await this.evaluator.evaluate(questions, this.renderState(), controller.signal);
    } catch (error) {
      if (!this.closed) {
        const message = controller.signal.aborted ? `timed out after ${this.opts.timeoutMs} ms` : error instanceof Error ? error.message : String(error);
        this.log.append('jev_unavailable', 'system', { by, error: message, ms: Math.round(performance.now() - started) });
        this.health(`jev: ${message}`);
      }
      return null;
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
}

function slug(text: string): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
  return base || 'question';
}
