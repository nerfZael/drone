import React from 'react';
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type PaneProps = {
  tab: string;
  label: string;
  load: () => Promise<any>;
  children: (component: any) => React.ReactNode;
};

// Keep render and effect flushing separate: changing tabs must be safe during
// the FIRST render, before React has run the new module-loading effect.
function paneHarness() {
  let cursor = 0;
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const useMemo = (factory: () => any, deps: any[]) => {
    const index = cursor++;
    if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index].deps[i]))) {
      slots[index] = { deps, value: factory() };
    }
    return slots[index].value;
  };
  const react = {
    ...React,
    useMemo,
    useState(initial: any) {
      const state = useMemo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [state.value, (next: any) => {
        state.value = typeof next === 'function' ? next(state.value) : next;
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
  const source = readFileSync(new URL('../src/droneHub/app/AsyncPaneBoundary.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function('require', 'exports', 'window', compiled)(
    (name: string) => {
      if (name === 'react') return react;
      throw new Error(`Unexpected import: ${name}`);
    },
    exports,
    {
      setTimeout(callback: () => void) { timers.set(++nextTimer, callback); return nextTimer; },
      clearTimeout(id: number) { timers.delete(id); },
    },
  );
  let retry: () => void = () => {};
  return {
    render(props: PaneProps) {
      cursor = 0;
      const element = exports.AsyncPaneBoundary({
        ...props,
        loadingFallback: 'loading',
        errorFallback: (message: string, onRetry: () => void) => { retry = onRetry; return message; },
      });
      return element.props.children;
    },
    effects() { effects.splice(0).forEach((effect) => effect()); },
    timeout() { [...timers.values()].forEach((callback) => callback()); },
    retry() { retry(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function deferredPane(tab: string) {
  const response = Promise.withResolvers<any>();
  const Component = (props: any) => props[tab]();
  const props: PaneProps = {
    tab,
    label: tab,
    load: () => response.promise,
    children: (Loaded) => Loaded({ [tab]: () => tab }),
  };
  return { props, resolve: () => response.resolve(Component), reject: response.reject };
}

describe('async workspace pane transitions', () => {
  test('a synchronous loader failure uses the error fallback', async () => {
    const h = paneHarness();
    const pane = deferredPane('changes');
    pane.props.load = () => { throw new Error('Module unavailable'); };
    try {
      h.render(pane.props);
      h.effects();
      await settle();
      expect(h.render(pane.props)).toBe('Module unavailable');
    } finally { h.unmount(); }
  });

  test('View diff can replace the Editor pane without rendering it with Changes props', async () => {
    const h = paneHarness();
    const editor = deferredPane('editor');
    const changes = deferredPane('changes');
    try {
      expect(h.render(editor.props)).toBe('loading');
      h.effects();
      editor.resolve();
      await settle();
      expect(h.render(editor.props)).toBe('editor');
      // Before the fix this calls Editor({ changes: ... }) and throws.
      expect(h.render(changes.props)).toBe('loading');
      h.effects();
      changes.resolve();
      await settle();
      expect(h.render(changes.props)).toBe('changes');
      expect(h.render(editor.props)).toBe('loading');
      h.effects();
      await settle();
      expect(h.render(editor.props)).toBe('editor');
    } finally { h.unmount(); }
  });

  test('a superseded load cannot replace the current pane', async () => {
    const h = paneHarness();
    const editor = deferredPane('editor');
    const changes = deferredPane('changes');
    try {
      h.render(editor.props);
      h.effects();
      h.render(changes.props);
      h.effects();
      changes.resolve();
      await settle();
      editor.resolve();
      await settle();
      expect(h.render(changes.props)).toBe('changes');
    } finally { h.unmount(); }
  });

  test('switching panes clears a previous error before the new effect runs', async () => {
    const h = paneHarness();
    const editor = deferredPane('editor');
    const changes = deferredPane('changes');
    try {
      h.render(editor.props);
      h.effects();
      editor.reject(new Error('Editor failed'));
      await settle();
      expect(h.render(editor.props)).toBe('Editor failed');
      expect(h.render(changes.props)).toBe('loading');
      h.effects();
    } finally { h.unmount(); }
  });

  test('retry immediately clears a timeout and accepts the completed module', async () => {
    const h = paneHarness();
    const pane = deferredPane('changes');
    try {
      h.render(pane.props);
      h.effects();
      h.timeout();
      expect(h.render(pane.props)).toContain('still loading');
      h.retry();
      expect(h.render(pane.props)).toBe('loading');
      h.effects();
      pane.resolve();
      await settle();
      expect(h.render(pane.props)).toBe('changes');
    } finally { h.unmount(); }
  });

  test('updates the props of an already loaded pane without reloading its module', async () => {
    const h = paneHarness();
    const pane = deferredPane('changes');
    try {
      h.render(pane.props);
      h.effects();
      pane.resolve();
      await settle();
      expect(h.render({ ...pane.props, children: (Component) => Component({ changes: () => 'another diff' }) })).toBe('another diff');
    } finally { h.unmount(); }
  });
});
