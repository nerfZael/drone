import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the actual polling hook with deferred responses and isolated React
// state, so other tests keep their real React implementation.
function pollHarness(keepPreviousData: boolean) {
  let cursor = 0;
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const requests: ReturnType<typeof Promise.withResolvers<any>>[] = [];
  const React = {
    useState(initial: any) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, (next: any) => {
        slots[index].value = typeof next === 'function' ? next(slots[index].value) : next;
      }];
    },
    useEffect(effect: () => any, deps: any[]) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
      slots[index] = { deps };
      effects.push(() => {
        previous?.cleanup?.();
        slots[index].cleanup = effect();
      });
    },
  };
  const source = readFileSync(new URL('../src/droneHub/app/hooks.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function('require', 'exports', 'document', 'setTimeout', 'clearTimeout', compiled)(
    (name: string) => {
      if (name === 'react') return React;
      if (name === './chat-load-telemetry') return {};
      throw new Error(`Unexpected import: ${name}`);
    },
    exports,
    { addEventListener() {}, removeEventListener() {} },
    () => 1,
    () => {},
  );
  return {
    requests,
    render(eventVersion: number) {
      const read = () => {
        cursor = 0;
        return exports.usePoll(() => {
          const response = Promise.withResolvers<any>();
          requests.push(response);
          return response.promise;
        }, 60_000, [eventVersion], { keepPreviousData });
      };
      read();
      effects.splice(0).forEach((effect) => effect());
      return read();
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
  };
}

async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('chat event polling', () => {
  test('retains displayed run activity throughout live refreshes and transient failures', async () => {
    const h = pollHarness(true);
    try {
      const first = { key: 'drone:side', pending: [{ id: 'run', activity: { messages: ['reasoning'] } }] };
      h.render(0);
      h.requests[0].resolve(first);
      await settle();
      expect(h.render(0).value).toBe(first);
      // Each tool/reasoning event restarts the poll. Clearing this value would
      // unmount the run disclosure and discard the user's collapsed state.
      expect(h.render(1).value).toBe(first);
      h.requests[1].reject(new Error('temporary disconnect'));
      await settle();
      expect(h.render(1).value).toBe(first);
      expect(h.render(2).value).toBe(first);
      const next = { ...first, pending: [{ id: 'run', activity: { messages: ['reasoning', 'tool'] } }] };
      h.requests[2].resolve(next);
      await settle();
      expect(h.render(2).value).toBe(next);
    } finally {
      h.unmount();
    }
  });

  test('ignores superseded responses while retaining the most recent completed refresh', async () => {
    const h = pollHarness(true);
    try {
      h.render(0);
      h.render(1);
      const newest = { key: 'new-chat', pending: [] };
      h.requests[1].resolve(newest);
      await settle();
      h.requests[0].resolve({ key: 'old-chat', pending: [{ id: 'old' }] });
      await settle();
      expect(h.render(1).value).toBe(newest);
    } finally {
      h.unmount();
    }
  });

  test('still clears previous data for callers using the default reset behavior', async () => {
    const h = pollHarness(false);
    try {
      h.render(0);
      h.requests[0].resolve({ old: true });
      await settle();
      expect(h.render(0).value).toEqual({ old: true });
      expect(h.render(1).value).toBeNull();
    } finally {
      h.unmount();
    }
  });
});
