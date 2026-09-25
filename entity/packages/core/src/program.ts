import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSDeferredPromise, type QuickJSHandle, type QuickJSRuntime } from 'quickjs-emscripten';
import type { EntityEvent, EventMatcher } from './types.js';

/** What a program can do. Everything else (network, filesystem, timers, host objects) is absent from the sandbox. */
export interface ProgramApi {
  /** Commits an effect through the normal gate. Resolves to the effect's result text. */
  effect(name: string, args: Record<string, unknown>): Promise<string>;
  effects(): { name: string; shorthand?: string }[];
  wait(ms: number): Promise<void>;
  nextEvent(matcher: EventMatcher, timeoutMs: number): Promise<EntityEvent | null>;
  judge(question: string): Promise<number>;
  sense(question: string): number | undefined;
  state(): unknown;
  log(message: string): void;
  now(): number;
}

export type ProgramOutcome =
  | { status: 'finished'; result?: unknown }
  | { status: 'failed'; error: string }
  | { status: 'cancelled' };

export interface ProgramLimits {
  /** Longest a program may run synchronously between awaits. */
  sliceMs?: number;
  memoryBytes?: number;
}

const PRELUDE = (effects: { name: string; shorthand?: string }[]) => `
(() => {
  const effect = globalThis.__effect;
  const toArgs = (shorthand, value) => (value !== null && typeof value === 'object') ? value : (shorthand ? { [shorthand]: value } : {});
  globalThis.effect = (name, args) => effect(name, args ?? {});
  for (const e of ${JSON.stringify(effects)}) globalThis[e.name] = (value) => effect(e.name, toArgs(e.shorthand, value));
  globalThis.console = { log: (...parts) => globalThis.log(parts.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join(' ')) };
})();
`;

/**
 * Runs LLM-written JavaScript as the body of an async function in a fresh QuickJS runtime.
 * Its only capabilities are the functions in {@link ProgramApi}.
 */
export async function runProgram(code: string, api: ProgramApi, signal: AbortSignal, limits: ProgramLimits = {}): Promise<ProgramOutcome> {
  if (signal.aborted) return { status: 'cancelled' };
  const QuickJS = await getQuickJS();
  const runtime: QuickJSRuntime = QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes ?? 32 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  const ctx: QuickJSContext = runtime.newContext();
  const sliceMs = limits.sliceMs ?? 250;
  const pending = new Set<QuickJSDeferredPromise>();
  let alive = true;

  const slice = <T>(fn: () => T): T => {
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + sliceMs));
    return fn();
  };
  const pump = () => { if (alive) slice(() => runtime.executePendingJobs()); };

  const jsonObject = ctx.getProp(ctx.global, 'JSON');
  const jsonParse = ctx.getProp(jsonObject, 'parse');
  jsonObject.dispose();
  const toHandle = (value: unknown): QuickJSHandle => {
    if (value === undefined) return ctx.undefined;
    const text = ctx.newString(JSON.stringify(value));
    try { return ctx.unwrapResult(ctx.callFunction(jsonParse, ctx.undefined, text)); } finally { text.dispose(); }
  };

  const hostAsync = (name: string, fn: (...args: unknown[]) => Promise<unknown>) => {
    const handle = ctx.newFunction(name, (...argHandles) => {
      const args = argHandles.map(h => ctx.dump(h));
      const deferred = ctx.newPromise();
      pending.add(deferred);
      fn(...args).then(
        value => {
          if (!alive || !deferred.alive) return;
          const result = toHandle(value);
          deferred.resolve(result);
          if (result !== ctx.undefined) result.dispose();
          pending.delete(deferred);
          pump();
        },
        error => {
          if (!alive || !deferred.alive) return;
          const err = ctx.newError(error instanceof Error ? error.message : String(error));
          deferred.reject(err);
          err.dispose();
          pending.delete(deferred);
          pump();
        },
      );
      return deferred.handle;
    });
    ctx.setProp(ctx.global, name, handle);
    handle.dispose();
  };
  const hostSync = (name: string, fn: (...args: unknown[]) => unknown) => {
    const handle = ctx.newFunction(name, (...argHandles) => toHandle(fn(...argHandles.map(h => ctx.dump(h)))));
    ctx.setProp(ctx.global, name, handle);
    handle.dispose();
  };

  hostAsync('__effect', (name, args) => api.effect(String(name), (args ?? {}) as Record<string, unknown>));
  hostAsync('wait', ms => api.wait(Math.max(0, Math.min(Number(ms) || 0, 3_600_000))));
  hostAsync('nextEvent', (matcher, timeoutMs) => api.nextEvent((matcher ?? {}) as EventMatcher, Number(timeoutMs) || 60_000));
  hostAsync('judge', question => api.judge(String(question)));
  hostSync('sense', question => api.sense(String(question)));
  hostSync('state', () => api.state());
  hostSync('now', () => api.now());
  hostSync('log', message => { api.log(String(message)); return undefined; });

  const dispose = () => {
    if (!alive) return;
    alive = false;
    for (const deferred of pending) if (deferred.alive) deferred.dispose();
    pending.clear();
    try { jsonParse.dispose(); ctx.dispose(); runtime.dispose(); } catch { /* the runtime is being dropped either way */ }
  };

  return new Promise<ProgramOutcome>(resolve => {
    let settled = false;
    const finish = (outcome: ProgramOutcome) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      dispose();
      resolve(outcome);
    };
    const onAbort = () => finish({ status: 'cancelled' });
    signal.addEventListener('abort', onAbort);

    try {
      const prelude = slice(() => ctx.evalCode(PRELUDE(api.effects()), 'prelude.js'));
      ctx.unwrapResult(prelude).dispose();
      const evaluated = slice(() => ctx.evalCode(`(async () => {\n${code}\n})()`, 'program.js'));
      if (evaluated.error) {
        const error = ctx.dump(evaluated.error);
        evaluated.error.dispose();
        finish({ status: 'failed', error: formatError(error) });
        return;
      }
      const promise = evaluated.value;
      ctx.resolvePromise(promise).then(result => {
        if (!alive) return;
        if (result.error) {
          const error = ctx.dump(result.error);
          result.error.dispose();
          finish({ status: 'failed', error: formatError(error) });
        } else {
          const value = ctx.dump(result.value);
          result.value.dispose();
          finish({ status: 'finished', result: value });
        }
      });
      promise.dispose();
      pump();
    } catch (error) {
      finish({ status: 'failed', error: formatError(error) });
    }
  });
}

function formatError(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { name?: string; message?: string; stack?: string };
    const where = e.stack?.split('\n').find(line => line.includes('program.js'))?.trim();
    return `${e.name ?? 'Error'}: ${e.message ?? JSON.stringify(error)}${where ? ` (${where})` : ''}`;
  }
  return String(error);
}
