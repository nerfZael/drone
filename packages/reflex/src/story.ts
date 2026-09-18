import type { ReflexTick } from './types';

/** A scripted user story: timed host events with expectations about which actions fire. */
export type ReflexStoryStep<E> = {
  /** Milliseconds after the story starts. */
  at: number;
  event: E;
  /** Actions that must fire at least once for state observed between this step and the next step's `at` (or the story end). A decision belongs to the window in which its evaluation started. */
  expect?: string[];
  /** Actions that must not fire in that window. */
  forbid?: string[];
  label?: string;
};

export type ReflexStory<E> = {
  name: string;
  description?: string;
  steps: ReflexStoryStep<E>[];
  /** Time to keep observing after the last step. */
  settleMs?: number;
};

export type ReflexStoryFailure = { step: number; label?: string; message: string };

export type ReflexStoryResult = {
  name: string;
  passed: boolean;
  failures: ReflexStoryFailure[];
  ticks: number;
  actions: Array<{ at: number; action: string; rule?: string; confidence?: number }>;
  latencyMs: { p50: number; max: number } | null;
  errors: string[];
  durationMs: number;
};

export type ReflexStoryDriver<E> = {
  /** Apply one host event, for example a transcript delta. */
  apply(event: E, at: number): void;
  /** Subscribe to ticks; return an unsubscribe function. */
  onTick(listener: (tick: ReflexTick<unknown>) => void): () => void;
  /** Wait for an in-flight evaluation before the story ends, so a slow last decision is still reported. */
  drain?(): Promise<void>;
  /** Called once the story is over. */
  finish?(): void;
  sleep?(ms: number): Promise<void>;
  now?(): number;
};

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

/** Run a story against a live driver and score which actions fired inside each step's window. */
export async function runReflexStory<E>(story: ReflexStory<E>, driver: ReflexStoryDriver<E>): Promise<ReflexStoryResult> {
  const sleep = driver.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = driver.now ?? Date.now;
  const started = now();
  const ticks: ReflexTick<unknown>[] = [];
  const unsubscribe = driver.onTick(tick => ticks.push(tick));
  const windows: Array<{ step: number; from: number; to: number }> = [];
  try {
    const steps = [...story.steps].sort((left, right) => left.at - right.at);
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const wait = started + step.at - now();
      if (wait > 0) await sleep(wait);
      const from = now();
      driver.apply(step.event, step.at);
      const next = steps[index + 1];
      windows.push({ step: index, from, to: next ? started + next.at : started + step.at + (story.settleMs ?? 1_500) });
    }
    const last = windows[windows.length - 1];
    if (last) { const wait = last.to - now(); if (wait > 0) await sleep(wait); }
    if (driver.drain) await Promise.race([driver.drain(), sleep(10_000)]);
    if (last) last.to = now();
  } finally {
    unsubscribe();
    driver.finish?.();
  }
  const acted = ticks.filter(tick => tick.action && !tick.stale && !tick.error);
  const failures: ReflexStoryFailure[] = [];
  for (const window of windows) {
    const step = story.steps[window.step];
    // A decision is about the state at the start of its evaluation, so latency never moves it into a later window.
    const fired = acted.filter(tick => tick.startedAt >= window.from && tick.startedAt < window.to).map(tick => tick.action!);
    for (const action of step.expect ?? []) {
      if (!fired.includes(action)) failures.push({ step: window.step, label: step.label, message: `expected ${action}, saw ${fired.length ? fired.join(', ') : 'nothing'}` });
    }
    for (const action of step.forbid ?? []) {
      if (fired.includes(action)) failures.push({ step: window.step, label: step.label, message: `forbidden ${action} fired` });
    }
  }
  const latencies = ticks.filter(tick => tick.answers).map(tick => tick.durationMs);
  return {
    name: story.name, passed: failures.length === 0, failures, ticks: ticks.length,
    actions: acted.map(tick => ({ at: tick.startedAt + tick.durationMs - started, action: tick.action!, rule: tick.rule, confidence: tick.confidence })),
    latencyMs: latencies.length ? { p50: percentile(latencies, 0.5), max: Math.max(...latencies) } : null,
    errors: ticks.filter(tick => tick.error).map(tick => tick.error!),
    durationMs: now() - started,
  };
}

/** Compress or stretch a story's timeline, for fast deterministic tests or slower live runs. */
export function scaleReflexStory<E>(story: ReflexStory<E>, factor: number): ReflexStory<E> {
  return { ...story, steps: story.steps.map(step => ({ ...step, at: Math.round(step.at * factor) })), ...(story.settleMs !== undefined ? { settleMs: Math.round(story.settleMs * factor) } : {}) };
}
