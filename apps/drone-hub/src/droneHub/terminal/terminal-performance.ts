export type TerminalTiming = {
  droneId: string;
  traceId?: string;
  phase: string;
  ms: number;
  at: string;
  detail?: Record<string, string | number | boolean | undefined>;
};
const timings: TerminalTiming[] = [];
let openIntent = 0;
let focusIntent = 0;
let moduleReadyAt = 0;
export function markTerminalModuleReady() {
  moduleReadyAt = performance.now();
}
export function terminalModuleTiming(started: number) {
  return {
    ms: Math.max(0, moduleReadyAt - started),
    preloaded: moduleReadyAt > 0 && moduleReadyAt <= started,
  };
}

export function beginTerminalOpen() {
  openIntent = performance.now();
  focusIntent = openIntent;
}
/**
 * A terminal takes keyboard focus only when the user just asked for one. One that
 * merely appears, as when a drone opens with a terminal in its layout, leaves focus alone.
 */
export function takeTerminalFocusIntent(): boolean {
  const requested = focusIntent > 0 && performance.now() - focusIntent < 15_000;
  focusIntent = 0;
  return requested;
}
export function takeTerminalOpenStartedAt() {
  const started =
    openIntent && performance.now() - openIntent < 15_000 ? openIntent : performance.now();
  openIntent = 0;
  return started;
}
export function terminalPerformanceSamples() {
  return timings.map((t) => ({ ...t, detail: t.detail && { ...t.detail } }));
}
export function recordTerminalTiming(
  target: { droneId: string; traceId?: string },
  phase: string,
  started: number,
  detail?: TerminalTiming['detail'],
) {
  const timing = {
    droneId: target.droneId,
    traceId: target.traceId,
    phase,
    ms: performance.now() - started,
    at: new Date().toISOString(),
    detail,
  };
  timings.push(timing);
  if (timings.length > 300) timings.shift();
  if (typeof window !== 'undefined')
    (window as any).__droneTerminalPerformance = terminalPerformanceSamples;
  return timing;
}
