import type { ModelUsage } from './mind.js';
/** A short, human-level account of one worker's progress, for the Work view. */
export interface WorkSummary {
  done: string[];
  doing: string[];
  next: string[];
  blocker?: string;
}

/** Produces work summaries from a worker's task and recent activity. The Hub backs it with a cheap model. */
export interface Summarizer {
  /** `usage`: what writing the summary cost, counted in the session's totals. */
  summarize(input: { task: string; activity: string }, signal: AbortSignal): Promise<WorkSummary & { usage?: ModelUsage }>;
}

/** A one-line description of a tool call's arguments, for the Work view's "now" line. */
export function describeToolArgs(name: string, args: Record<string, unknown>): string {
  const pick = (...keys: string[]) => keys.map(k => args[k]).find(v => typeof v === 'string' && v.trim()) as string | undefined;
  if (Array.isArray(args.paths)) return (args.paths as unknown[]).map(String).join(', ').slice(0, 120);
  const value = pick('path', 'command', 'keys', 'key', 'query', 'worker', 'id', 'name', 'task', 'text', 'question', 'note', 'result', 'reason');
  if (value) return value.replace(/\s+/g, ' ').slice(0, 120);
  if (name === 'set_watch' && args.watch && typeof args.watch === 'object') return String((args.watch as { name?: unknown }).name ?? '').slice(0, 120);
  return '';
}

/** Whether a tool result reports success, for the Work view and summaries. */
export function toolResultOk(result: string): boolean {
  return !/^(error|refused|output stopped|superseded|stale|rate limited|cancel requested)\b/.test(result);
}
