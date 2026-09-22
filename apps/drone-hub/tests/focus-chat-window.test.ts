import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../src/droneHub/app/focus-chat-window.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

// Isolate browser scheduling without replacing globals shared by other tests.
function harness() {
  const document = Object.assign(new EventTarget(), { activeElement: null as any });
  let callback = () => {};
  let observed = false;
  let nextFrame = 0;
  const frames = new Map<number, () => void>();
  const exports: Record<string, any> = {};
  class Observer {
    constructor(fn: () => void) { callback = fn; }
    observe() { observed = true; }
    disconnect() { observed = false; }
  }
  new Function('exports', 'document', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', compiled)(
    exports, document, Observer,
    (fn: () => void) => { frames.set(++nextFrame, fn); return nextFrame; },
    (id: number) => frames.delete(id),
  );
  const interaction = (target: any, type = 'focusin') => {
    const event = new Event(type);
    Object.defineProperty(event, 'target', { value: target });
    document.dispatchEvent(event);
  };
  const composer = { focus: () => { document.activeElement = composer; interaction(composer); } };
  let ready = false;
  const scope = {
    isConnected: true, tabIndex: 0,
    contains: (node: any) => node === scope || node === composer,
    querySelector: () => ready ? composer : null,
    focus: () => { document.activeElement = scope; interaction(scope); },
  };
  let mounted = false;
  let available = true;
  return {
    document, scope, composer, exports,
    start: () => exports.focusChatWindow({ isConnected: true }, () => mounted ? scope : null, () => available),
    mount: () => { mounted = true; },
    loadComposer: () => { ready = true; },
    hide: () => { available = false; },
    frame: () => { const work = [...frames.values()]; frames.clear(); work.forEach((fn) => fn()); },
    mutate: () => { if (observed) callback(); },
    interaction,
    observed: () => observed,
  };
}

test('focus waits for the window portal and stays on the chat when its composer loads', () => {
  const h = harness();
  h.start(); h.frame();
  expect(h.document.activeElement).toBeNull();
  h.mount(); h.mutate(); h.frame();
  expect(h.document.activeElement).toBe(h.scope);
  h.loadComposer(); h.mutate(); h.frame();
  expect(h.document.activeElement).toBe(h.scope);
  expect(h.observed()).toBe(false);
});

test('the chat receives focus even when its composer is immediately available', () => {
  const h = harness();
  h.mount(); h.loadComposer(); h.start(); h.frame();
  expect(h.document.activeElement).toBe(h.scope);
  expect(h.observed()).toBe(false);
});

test('clicking elsewhere before a portal mounts cancels its focus request', () => {
  const h = harness();
  h.start(); h.interaction({}, 'pointerdown');
  h.mount(); h.loadComposer(); h.mutate(); h.frame();
  expect(h.document.activeElement).toBeNull();
  expect(h.observed()).toBe(false);
});

test('moving focus away during loading does not get pulled back when the composer arrives', () => {
  const h = harness();
  h.mount(); h.start(); h.frame();
  const elsewhere = {};
  h.document.activeElement = elsewhere; h.interaction(elsewhere);
  h.loadComposer(); h.mutate(); h.frame();
  expect(h.document.activeElement).toBe(elsewhere);
  expect(h.observed()).toBe(false);
});

test('hidden or closed windows cannot receive delayed focus', () => {
  const h = harness();
  h.start(); h.hide(); h.mount(); h.loadComposer(); h.frame();
  expect(h.document.activeElement).toBeNull();
  expect(h.observed()).toBe(false);
});

test('cleanup cancels scheduled focus and disconnects observation', () => {
  const h = harness();
  const cancel = h.start();
  cancel(); h.mount(); h.loadComposer(); h.mutate(); h.frame();
  expect(h.document.activeElement).toBeNull();
  expect(h.observed()).toBe(false);
});

test('a canvas-originated activation keeps focus once, and the mark does not outlive its moment', () => {
  const { exports } = harness();
  expect(exports.consumeKeepFocusOnChatActivation(1_000)).toBe(false);
  exports.keepFocusOnNextChatActivation(1_000);
  expect(exports.consumeKeepFocusOnChatActivation(1_200)).toBe(true);
  // Consumed: the next activation, from the sidebar, focuses the chat as usual.
  expect(exports.consumeKeepFocusOnChatActivation(1_300)).toBe(false);
  // A mark nothing consumed (the chat was already the main chat) expires on its own.
  exports.keepFocusOnNextChatActivation(2_000);
  expect(exports.consumeKeepFocusOnChatActivation(3_500)).toBe(false);
});
