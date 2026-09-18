import type { ReflexAnswers, ReflexEvaluate, ReflexTable, ReflexTick } from './types';
import { matchRule } from './rules';

/** Session-bounded ring of ticks. Acting ticks are kept in preference to waits and errors. */
export class ReflexRecorder<S = unknown> {
  private ticks: ReflexTick<S>[] = [];
  constructor(private readonly limits: { maxEntries?: number; maxBytes?: number; keep?: (tick: ReflexTick<S>) => boolean } = {}) {}

  record(tick: ReflexTick<S>): void {
    this.ticks.unshift(tick);
    const maxEntries = this.limits.maxEntries ?? 200;
    const maxBytes = this.limits.maxBytes ?? 2_000_000;
    const keep = this.limits.keep ?? ((item: ReflexTick<S>) => Boolean(item.action && item.action !== 'wait'));
    const prioritized = [...this.ticks.filter(keep).slice(0, maxEntries / 2), ...this.ticks.filter(item => !keep(item)).slice(0, maxEntries / 2)];
    let size = 0;
    this.ticks = prioritized.filter(item => { size += JSON.stringify(item).length; return size <= maxBytes; })
      .sort((left, right) => right.startedAt - left.startedAt);
  }

  get entries(): readonly ReflexTick<S>[] { return this.ticks; }
  clear(): void { this.ticks = []; }
  trace(): ReflexTrace { return { ticks: [...this.ticks].reverse().map(({ serialized, questions, answers, rule, action, tableVersion, id, startedAt }) => ({ id, startedAt, tableVersion, serialized, questions, answers, rule, action })) }; }
}

export type ReflexTraceTick = Pick<ReflexTick, 'id' | 'startedAt' | 'tableVersion' | 'serialized' | 'questions' | 'answers' | 'rule' | 'action'>;
export type ReflexTrace = { ticks: ReflexTraceTick[] };

export type ReflexReplayResult = {
  ticks: number;
  unchanged: number;
  changed: Array<{ id: string; before?: string; after?: string; answers: ReflexAnswers }>;
  errors: Array<{ id: string; error: string }>;
  durationMs: number;
};

/** Re-evaluate a recorded trace with a candidate table and report which decisions would change. Never acts. */
export async function replayReflexTrace(trace: ReflexTrace, table: ReflexTable, evaluate: ReflexEvaluate, options: { signal?: AbortSignal; questions?: (table: ReflexTable) => Record<string, import('./types').ReflexQuestion>; concurrency?: number } = {}): Promise<ReflexReplayResult> {
  const { tableQuestions } = await import('./rules');
  const questions = (options.questions ?? tableQuestions)(table);
  const result: ReflexReplayResult = { ticks: trace.ticks.length, unchanged: 0, changed: [], errors: [], durationMs: 0 };
  const startedAt = Date.now();
  const signal = options.signal ?? new AbortController().signal;
  const queue = [...trace.ticks];
  const worker = async () => {
    for (let tick = queue.shift(); tick; tick = queue.shift()) {
      try {
        const answers = await evaluate(tick.serialized, questions, signal);
        const after = matchRule(table, answers)?.do;
        if (after === tick.action) result.unchanged += 1;
        else result.changed.push({ id: tick.id, before: tick.action, after, answers });
      } catch (error) {
        result.errors.push({ id: tick.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 4) }, worker));
  result.durationMs = Date.now() - startedAt;
  return result;
}
