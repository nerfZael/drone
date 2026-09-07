import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

class ScrollSurface extends EventTarget {
  scrollHeight = 1_200;
  clientHeight = 500;
  private top = 0;
  get scrollTop() {
    return this.top;
  }
  set scrollTop(value: number) {
    this.top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
  }
  scrollEvent() {
    this.dispatchEvent(new Event('scroll'));
  }
}

// Run the real hook with independently controlled animation frames, resize
// notifications, and scroll events. Browser scroll events need not be delivered
// immediately after a programmatic scrollTop assignment.
function scrollHarness() {
  let cursor = 0;
  let dirty = false;
  let nextFrame = 0;
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const frames = new Map<number, () => void>();
  const observers = new Set<() => void>();
  const requestFrame = (callback: () => void) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  const useMemo = (factory: () => any, deps: any[]) => {
    const index = cursor++;
    if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index].deps[i]))) {
      slots[index] = { deps, value: factory() };
    }
    return slots[index].value;
  };
  const useEffect = (effect: () => any, deps: any[]) => {
    const index = cursor++;
    if (slots[index] && deps.every((dep, i) => Object.is(dep, slots[index].deps[i]))) return;
    const previous = slots[index];
    slots[index] = { deps };
    effects.push(() => {
      previous?.cleanup?.();
      slots[index].cleanup = effect();
    });
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
          const next = typeof value === 'function' ? value(state.value) : value;
          if (!Object.is(state.value, next)) dirty = true;
          state.value = next;
        },
      ];
    },
    useEffect,
    useLayoutEffect: useEffect,
  };
  const source = readFileSync(
    new URL('../src/droneHub/chat/use-pinned-transcript-scroll.ts', import.meta.url),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function('require', 'exports', 'window', 'requestAnimationFrame', 'ResizeObserver', compiled)(
    (name: string) => {
      if (name === 'react') return React;
      if (name === '../workspace-state-events') return {};
      throw new Error(`Unexpected import: ${name}`);
    },
    exports,
    {
      addEventListener() {},
      requestAnimationFrame: requestFrame,
      cancelAnimationFrame: (id: number) => frames.delete(id),
    },
    requestFrame,
    class {
      constructor(private callback: () => void) {
        observers.add(callback);
      }
      observe() {}
      disconnect() {
        observers.delete(this.callback);
      }
    },
  );
  let hook: any;
  let props = { contextKey: 'drone:chat-a', contentVersion: 0, enabled: true };
  const render = (nextProps = props) => {
    props = nextProps;
    for (let pass = 0; pass < 10; pass++) {
      dirty = false;
      cursor = 0;
      hook = exports.usePinnedTranscriptScroll(props);
      effects.splice(0).forEach((effect) => effect());
      if (!dirty) return;
    }
    throw new Error('Hook did not settle');
  };
  const surface = new ScrollSurface();
  render();
  hook.bindScrollRef(surface);
  hook.bindContentRef({});
  render();
  return {
    surface,
    frame() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
    resize: () => [...observers].forEach((callback) => callback()),
    changeChat: (contextKey: string) => render({ ...props, contextKey }),
    hook: () => hook,
  };
}

describe('desktop transcript scroll lifecycle', () => {
  test('follows content loaded before the initial automatic scroll event is delivered', () => {
    const h = scrollHarness();
    h.frame();
    expect(h.surface.scrollTop).toBe(700);
    h.surface.scrollHeight += 400;
    h.surface.scrollEvent();
    h.resize();
    h.frame();
    expect(h.surface.scrollTop).toBe(1_100);
  });

  test('keeps following when browser anchoring advances the position during late layout', () => {
    const h = scrollHarness();
    h.frame();
    h.surface.scrollHeight += 600;
    h.surface.scrollTop += 200;
    h.surface.scrollEvent();
    h.resize();
    h.frame();
    expect(h.surface.scrollTop).toBe(1_300);
  });

  test('preserves intentional reading position and resumes following at the bottom', () => {
    const h = scrollHarness();
    h.frame();
    h.surface.scrollTop = 300;
    h.surface.scrollEvent();
    h.surface.scrollHeight += 400;
    h.resize();
    h.frame();
    expect(h.surface.scrollTop).toBe(300);
    h.surface.scrollTop = 600;
    h.surface.scrollEvent();
    h.resize();
    h.frame();
    expect(h.surface.scrollTop).toBe(600);
    h.surface.scrollTop = 1_100;
    h.surface.scrollEvent();
    h.surface.scrollHeight += 300;
    h.resize();
    h.frame();
    expect(h.surface.scrollTop).toBe(1_400);
  });

  test('does not save a late-rendering gap as an intentional scroll position', () => {
    const h = scrollHarness();
    h.frame();
    h.surface.scrollHeight += 400;
    h.surface.scrollEvent();
    h.changeChat('drone:chat-b');
    h.frame();
    h.changeChat('drone:chat-a');
    h.frame();
    expect(h.surface.scrollTop).toBe(1_100);
  });

  test('allows scrolling up even while a response is growing', () => {
    const h = scrollHarness();
    h.frame();
    h.surface.scrollHeight += 400;
    h.surface.scrollTop = 300;
    h.surface.scrollEvent();
    h.resize();
    h.frame();
    expect(h.surface.scrollTop).toBe(300);
  });

  test('keeps following after a layout shrink clamps the scroll position', () => {
    const h = scrollHarness();
    h.frame();
    h.surface.scrollHeight = 900;
    h.surface.scrollTop = 400;
    // Another part of the transcript grows before the queued clamp event arrives.
    h.surface.scrollHeight = 1_100;
    h.surface.scrollEvent();
    h.resize();
    h.frame();
    expect(h.surface.scrollTop).toBe(600);
  });

  test('ignores automatic scrolling queued by a previous chat', () => {
    const h = scrollHarness();
    h.frame();
    h.surface.scrollTop = 300;
    h.surface.scrollEvent();
    h.changeChat('drone:chat-b');
    // Leave B before its initial force-scroll frame. Restore A's reading position.
    h.changeChat('drone:chat-a');
    h.frame();
    expect(h.surface.scrollTop).toBe(300);
    h.resize();
    h.frame();
    expect(h.surface.scrollTop).toBe(300);
  });

  test('a previous chat finishing older-history loading cannot reposition the current chat', async () => {
    const h = scrollHarness();
    h.frame();
    h.surface.scrollTop = 200;
    h.surface.scrollEvent();
    let finish!: () => void;
    const pending = h.hook().preserveScrollOnPrepend(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    h.changeChat('drone:chat-b');
    h.frame();
    finish();
    await pending;
    h.frame();
    expect(h.surface.scrollTop).toBe(700);
    h.surface.scrollHeight += 300;
    h.resize();
    h.frame();
    expect(h.surface.scrollTop).toBe(1_000);
  });
});
