/**
 * Opt-in timing for canvas gestures and actions. Off unless `localStorage['droneHub.canvasPerf'] = '1'`
 * (or `window.__droneCanvasPerf.enable()`); then each gesture logs its frame times and how much React
 * rendering it caused, and keeps the summaries in `window.__droneCanvasPerf.log`.
 *
 * Works in production builds, where React.Profiler reports nothing: renders are timed from a component's
 * body to its layout effect.
 */

export type CanvasPerfGesture = 'zoom' | 'pan' | 'drag' | 'marquee';

export type CanvasPerfSummary = {
  name: string;
  durationMs: number;
  frames: number;
  avgFrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  /** Frames longer than 20ms: visibly dropped at 60Hz. */
  slowFrames: number;
  renders: Record<string, { count: number; ms: number }>;
};

type Active = {
  name: string;
  startedAt: number;
  lastFrameAt: number;
  frameGaps: number[];
  renders: Record<string, { count: number; ms: number }>;
  raf: number | null;
};

const STORAGE_KEY = 'droneHub.canvasPerf';
const WHEEL_IDLE_MS = 160;
const MAX_LOG = 200;

function readEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let enabled = readEnabled();
let active: Active | null = null;
let idleRenders: Record<string, { count: number; ms: number }> = {};
let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;
const log: CanvasPerfSummary[] = [];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function tick(now: number) {
  if (!active) return;
  // The first callback can carry a timestamp from before the gesture began.
  if (now > active.lastFrameAt) active.frameGaps.push(now - active.lastFrameAt);
  active.lastFrameAt = now;
  active.raf = requestAnimationFrame(tick);
}

function summarize(current: Active): CanvasPerfSummary {
  const gaps = current.frameGaps;
  return {
    name: current.name,
    durationMs: round(performance.now() - current.startedAt),
    frames: gaps.length,
    avgFrameMs: round(gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length)),
    p95FrameMs: round(percentile(gaps, 0.95)),
    maxFrameMs: round(gaps.length ? Math.max(...gaps) : 0),
    slowFrames: gaps.filter((gap) => gap > 20).length,
    renders: Object.fromEntries(
      Object.entries(current.renders).map(([id, stat]) => [id, { count: stat.count, ms: round(stat.ms) }]),
    ),
  };
}

function record(summary: CanvasPerfSummary) {
  log.push(summary);
  if (log.length > MAX_LOG) log.shift();
  const renders = Object.entries(summary.renders)
    .map(([id, stat]) => `${id}×${stat.count} ${stat.ms}ms`)
    .join(', ');
  console.info(
    `[canvas-perf] ${summary.name}: ${summary.durationMs}ms, ${summary.frames} frames avg ${summary.avgFrameMs}ms ` +
      `p95 ${summary.p95FrameMs}ms max ${summary.maxFrameMs}ms slow ${summary.slowFrames}` +
      (renders ? ` | renders: ${renders}` : ''),
  );
}

function begin(name: string) {
  if (!enabled) return;
  if (active?.name === name) return;
  if (active) end(active.name);
  const now = performance.now();
  active = { name, startedAt: now, lastFrameAt: now, frameGaps: [], renders: {}, raf: null };
  active.raf = requestAnimationFrame(tick);
}

function end(name: string) {
  if (!active || active.name !== name) return;
  const current = active;
  active = null;
  if (current.raf !== null) cancelAnimationFrame(current.raf);
  record(summarize(current));
}

export const canvasPerf = {
  get enabled() {
    return enabled;
  },
  /** A pointer gesture starts; frames are timed until `gestureEnd`. */
  gestureStart(name: CanvasPerfGesture) {
    begin(name);
  },
  gestureEnd(name: CanvasPerfGesture) {
    end(name);
  },
  /** Wheel zoom has no end event: it ends once the wheel has been still for a moment. */
  wheel() {
    if (!enabled) return;
    begin('zoom');
    if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
    wheelIdleTimer = setTimeout(() => {
      wheelIdleTimer = null;
      end('zoom');
    }, WHEEL_IDLE_MS);
  },
  /** A discrete action (paste, delete, select all): timed until the frame after it has painted. */
  action(name: string) {
    if (!enabled) return;
    begin(`action:${name}`);
    const current = active;
    requestAnimationFrame(() => {
      // The second callback runs after the first frame containing the action has been produced.
      setTimeout(() => {
        if (active === current) end(`action:${name}`);
      }, 0);
    });
  },
  /** Frames for a fixed time from now, e.g. an animation that follows a gesture. */
  window(name: string, ms: number) {
    if (!enabled) return;
    begin(name);
    const current = active;
    setTimeout(() => {
      if (active === current) end(name);
    }, ms);
  },
  /** Call at the top of a component's body; pass the result to `renderEnd` from a layout effect. */
  renderStart(): number {
    return enabled ? performance.now() : 0;
  },
  renderEnd(id: string, startedAt: number) {
    if (!enabled || !startedAt) return;
    const bucket = active ? active.renders : idleRenders;
    const stat = (bucket[id] ??= { count: 0, ms: 0 });
    stat.count += 1;
    stat.ms += performance.now() - startedAt;
  },
};

if (typeof window !== 'undefined') {
  (window as unknown as { __droneCanvasPerf: unknown }).__droneCanvasPerf = {
    log,
    enable() {
      enabled = true;
      try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* storage unavailable */ }
    },
    disable() {
      enabled = false;
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
    },
    /** Renders outside any gesture since the last call, e.g. from background summaries. */
    takeIdleRenders() {
      const out = idleRenders;
      idleRenders = {};
      return out;
    },
  };
}
