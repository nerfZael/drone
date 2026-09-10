import type { ServerResponse } from 'node:http';

// Durations only: never include commands, environment values, terminal text or tokens.
export function terminalStartupTiming(
  res: ServerResponse,
  runtime: string,
  started = performance.now(),
) {
  const phases: Array<{ phase: string; ms: number }> = [];
  let path = 'recovery';
  let fallback: string | undefined;
  return {
    add(phase: string, since: number) {
      phases.push({ phase, ms: performance.now() - since });
    },
    async measure<T>(phase: string, fn: () => Promise<T>): Promise<T> {
      const since = performance.now();
      try {
        return await fn();
      } finally {
        phases.push({ phase, ms: performance.now() - since });
      }
    },
    route(value: string) {
      path = value;
    },
    fallback(value: string) {
      fallback = value;
    },
    result(daemon?: unknown) {
      const totalMs = performance.now() - started;
      res.setHeader(
        'Server-Timing',
        [
          ...phases.map((p) => `${p.phase.replace(/[^a-zA-Z0-9_]/g, '_')};dur=${p.ms.toFixed(1)}`),
          `terminal_open;dur=${totalMs.toFixed(1)}`,
        ].join(', '),
      );
      return { runtime, path, fallback, totalMs, phases, ...(daemon ? { daemon } : {}) };
    },
  };
}
