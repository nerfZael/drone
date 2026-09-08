import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { OPEN_SIDE_CHAT_EVENT } from '../src/droneHub/app/side-chat-events';

test('returning to a drone does not revive a previous visit’s request or clear a newer operation', async () => {
  const harness = sideChatHarness();
  try {
    harness.render('A');
    harness.open('A');
    harness.render('B');
    harness.render('A');
    harness.open('A');
    harness.requests[0].resolve({
      sideChatOrigin: { sourceChatName: 'main', checkpointId: 'old' },
    });
    await settle();
    expect(harness.render('A').sideChats).toHaveLength(0);
    expect(harness.render('A').busy).toBe('create');
    harness.requests[1].resolve({
      sideChatOrigin: { sourceChatName: 'main', checkpointId: 'new' },
    });
    await settle();
    expect(harness.render('A').sideChats).toMatchObject([{ checkpointId: 'new' }]);
    expect(harness.render('A').busy).toBeNull();
  } finally {
    harness.unmount();
  }
});

test('a late response after unmount does not update state', async () => {
  const harness = sideChatHarness();
  harness.render('A');
  harness.open('A');
  harness.unmount();
  const writes = harness.stateWrites();
  harness.requests[0].reject(new Error('late failure'));
  await settle();
  expect(harness.stateWrites()).toBe(writes);
});

test('a delete confirmation cannot submit after navigating away, and stays visibly busy while open', async () => {
  const harness = sideChatHarness();
  try {
    const pending = harness.render('A').finish('side', false);
    expect(harness.render('A').busy).toBe('side');
    harness.render('B');
    harness.confirmation.resolve(true);
    await pending;
    expect(harness.requests).toHaveLength(0);
    expect(harness.render('B').busy).toBeNull();
  } finally {
    harness.unmount();
  }
});

async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

// Like the transcript-scroll tests, run the real hook with controlled effects
// and deferred I/O, without replacing React globally for other test files.
function sideChatHarness() {
  let cursor = 0;
  let dirty = false;
  let writes = 0;
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const requests: ReturnType<typeof Promise.withResolvers<any>>[] = [];
  const confirmation = Promise.withResolvers<boolean>();
  const useMemo = (factory: () => any, deps: any[]) => {
    const index = cursor++;
    if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index].deps[i]))) {
      slots[index] = { deps, value: factory() };
    }
    return slots[index].value;
  };
  const React = {
    useMemo,
    useCallback: (callback: any, deps: any[]) => useMemo(() => callback, deps),
    useRef: (current: any) => useMemo(() => ({ current }), []),
    useState: (initial: any) => {
      const state = useMemo(() => ({ value: initial }), []);
      return [
        state.value,
        (value: any) => {
          writes++;
          const next = typeof value === 'function' ? value(state.value) : value;
          if (!Object.is(next, state.value)) dirty = true;
          state.value = next;
        },
      ];
    },
    useEffect: (effect: () => any, deps: any[]) => {
      const index = cursor++;
      if (slots[index] && deps.every((dep, i) => Object.is(dep, slots[index].deps[i]))) return;
      const previous = slots[index];
      slots[index] = { deps };
      effects.push(() => {
        previous?.cleanup?.();
        slots[index].cleanup = effect();
      });
    },
  };
  const source = readFileSync(
    new URL('../src/droneHub/app/use-workspace-side-chats.ts', import.meta.url),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: Record<string, any> = {};
  const window = new EventTarget();
  const confirm = () => confirmation.promise;
  new Function('require', 'exports', 'window', 'document', compiled)(
    (name: string) => {
      if (name === 'react') return React;
      if (name === '../../ui/AppConfirmDialog') return { useAppConfirmDialog: () => confirm };
      if (name === './side-chat-events') return { OPEN_SIDE_CHAT_EVENT };
      if (name === '../http')
        return {
          requestJson: () => {
            const pending = Promise.withResolvers<any>();
            requests.push(pending);
            return pending.promise;
          },
        };
      throw new Error(`Unexpected import: ${name}`);
    },
    exports,
    window,
    { querySelector: () => null },
  );
  return {
    requests,
    confirmation,
    stateWrites: () => writes,
    render(droneId: string) {
      let result: any;
      do {
        cursor = 0;
        dirty = false;
        result = exports.useWorkspaceSideChats({ id: droneId }, 'main');
        effects.splice(0).forEach((effect) => effect());
      } while (dirty);
      return result;
    },
    open(droneId: string) {
      window.dispatchEvent(
        new CustomEvent(OPEN_SIDE_CHAT_EVENT, {
          cancelable: true,
          detail: { droneId, target: { sourceChatName: 'main', checkpointId: 'answer' } },
        }),
      );
    },
    unmount() {
      slots.forEach((slot) => slot.cleanup?.());
    },
  };
}
