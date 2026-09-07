import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as paging from '../src/drones/mobile-chat-files-paging';
import * as zoom from '../src/drones/image-preview-zoom';

// Execute the components' real gesture callbacks without loading a native runtime.
// Springs settle immediately; JS updates are committed after each native event batch.
function gestureHarness(file: string) {
  let cursor = 0;
  let dirty = false;
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const reactions = new Set<() => void>();
  const gestures: any[] = [];
  const styles: (() => any)[] = [];
  const backHandlers: (() => boolean)[] = [];
  const pageGesture = {};
  const sameDeps = (a?: any[], b?: any[]) =>
    a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
  const useMemo = (factory: () => any, deps?: any[]) => {
    const index = cursor++;
    if (!slots[index] || !sameDeps(slots[index].deps, deps)) {
      slots[index] = { deps, value: factory() };
    }
    return slots[index].value;
  };
  const useState = (initial: any) => {
    const state = useMemo(() => ({ value: initial }), []);
    return [
      state.value,
      (value: any) => {
        const next = typeof value === 'function' ? value(state.value) : value;
        if (!Object.is(next, state.value)) dirty = true;
        state.value = next;
      },
    ];
  };
  const React = {
    createElement: () => null,
    createContext: () => ({ Provider: 'Provider' }),
    useContext: () => pageGesture,
    useMemo,
    useCallback: (callback: any, deps: any[]) => useMemo(() => callback, deps),
    useState,
    useEffect: (effect: () => any, deps?: any[]) => {
      const index = cursor++;
      if (slots[index] && sameDeps(slots[index].deps, deps)) return;
      const previous = slots[index];
      slots[index] = { deps };
      effects.push(() => {
        previous?.cleanup?.();
        slots[index].cleanup = effect();
      });
    },
  };
  function makeGesture(kind: string) {
    const config: Record<string, any> = { kind };
    const gesture = new Proxy(config, {
      get: (target, property: string) =>
        property in target
          ? target[property]
          : (...args: any[]) => {
              target[property] = args.length === 1 ? args[0] : args;
              return gesture;
            },
    });
    gestures.push(config);
    return gesture;
  }
  const modules: Record<string, any> = {
    react: React,
    'react-native': {
      StyleSheet: { create: (value: any) => value },
      Keyboard: { dismiss() {} },
      useWindowDimensions: () => ({ width: 360 }),
      BackHandler: {
        addEventListener: (_name: string, callback: () => boolean) => {
          backHandlers.push(callback);
          return { remove: () => backHandlers.splice(backHandlers.indexOf(callback), 1) };
        },
      },
    },
    'react-native-gesture-handler': {
      Gesture: {
        Pan: () => makeGesture('pan'),
        Pinch: () => makeGesture('pinch'),
        Tap: () => makeGesture('tap'),
        Simultaneous: (...items: any[]) => items,
      },
    },
    'react-native-reanimated': {
      useSharedValue: (value: any) => useMemo(() => ({ value }), []),
      useAnimatedStyle: (factory: () => any) => {
        styles.push(factory);
        return {};
      },
      useAnimatedReaction: (prepare: () => any, react: (next: any, prev: any) => void) => {
        const state = useMemo(() => ({ previous: null }), []);
        reactions.add(() => {
          const next = prepare();
          react(next, state.previous);
          state.previous = next;
        });
      },
      withSpring: (value: number) => value,
      withTiming: (value: number) => value,
      cancelAnimation() {},
      runOnJS: (callback: any) => callback,
    },
    './mobile-chat-files-paging': paging,
    './image-preview-zoom': zoom,
    './ChatFilesCarousel': { ChatFilesGestureContext: {} },
    '../theme': { colors: {} },
  };
  const source = readFileSync(new URL(`../src/drones/${file}.tsx`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function('require', 'exports', 'setTimeout', 'clearTimeout', compiled)(
    (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected import: ${name}`);
      return modules[name];
    },
    exports,
    () => 0,
    () => {},
  );
  return {
    render(props: any) {
      for (let pass = 0; pass < 10; pass++) {
        dirty = false;
        cursor = 0;
        gestures.length = 0;
        styles.length = 0;
        reactions.clear();
        exports[file](props);
        effects.splice(0).forEach((effect) => effect());
        reactions.forEach((reaction) => reaction());
        if (!dirty) return;
      }
      throw new Error('Render did not settle');
    },
    gesture: (kind: string) => gestures.findLast((gesture) => gesture.kind === kind),
    style: () => styles.at(-1)!(),
    back: () => [...backHandlers].reverse().some((handler) => handler()),
    pageGesture,
  };
}

describe('file page gesture lifecycle', () => {
  for (const initiallyOpen of [false, true]) {
    test(`cancelled swipe from ${initiallyOpen ? 'files' : 'chat'} preserves the page and next navigation`, () => {
      const harness = gestureHarness('ChatFilesCarousel');
      const changes: boolean[] = [];
      const props = {
        open: initiallyOpen,
        enabled: true,
        onReveal() {},
        renderFiles() {},
        onOpenChange(open: boolean) {
          changes.push(open);
          props.open = open;
        },
      };
      harness.render(props);
      const gesture = harness.gesture('pan');
      gesture.onStart();
      gesture.onUpdate({ translationX: initiallyOpen ? 240 : -240 });
      // RNGH calls BOTH callbacks when an active gesture is cancelled (e.g. app backgrounding).
      gesture.onEnd({ velocityX: initiallyOpen ? 700 : -700 }, false);
      gesture.onFinalize({}, false);
      harness.render(props);
      expect(props.open).toBe(initiallyOpen);
      expect(harness.style().transform[0].translateX).toBeCloseTo(initiallyOpen ? -360 : 0);

      // A file link / header Back changes the controlled page after cancellation.
      props.open = !initiallyOpen;
      harness.render(props);
      expect(harness.style().transform[0].translateX).toBeCloseTo(props.open ? -360 : 0);
      expect(changes).toEqual([initiallyOpen]);
    });
  }

  test('successful swipe back publishes chat only once', () => {
    const harness = gestureHarness('ChatFilesCarousel');
    const changes: boolean[] = [];
    harness.render({
      open: true,
      enabled: true,
      onReveal() {},
      renderFiles() {},
      onOpenChange: (open: boolean) => changes.push(open),
    });
    const gesture = harness.gesture('pan');
    gesture.onStart();
    gesture.onUpdate({ translationX: 50 });
    gesture.onEnd({ velocityX: 700 }, true);
    gesture.onFinalize({}, true);
    expect(changes).toEqual([false]);
    expect(harness.style().transform[0].translateX).toBeCloseTo(0);
  });
});

describe('image navigation gestures', () => {
  test('fitted images yield the touch, zoomed images pan, and Back restores swipe-back', () => {
    const harness = gestureHarness('ZoomableImageStage');
    const props = { resetKey: 'image.png', active: true };
    harness.render(props);
    let failed = false;
    const touchDown = () => {
      failed = false;
      harness.gesture('pan').onTouchesDown?.(
        {},
        {
          fail: () => {
            failed = true;
          },
        },
      );
    };
    touchDown();
    expect(failed).toBe(true);
    expect(harness.back()).toBe(false);

    harness.gesture('tap').onEnd({ x: 0, y: 0 }, true);
    harness.render(props);
    touchDown();
    expect(failed).toBe(false);
    expect(harness.gesture('pan').blocksExternalGesture).toBe(harness.pageGesture);
    expect(harness.back()).toBe(true);
    touchDown();
    expect(failed).toBe(true);
    expect(harness.back()).toBe(false);
  });

  test('pinch reset and double-tap reset both release image panning', () => {
    for (const reset of ['pinch', 'tap']) {
      const harness = gestureHarness('ZoomableImageStage');
      harness.render({ resetKey: 'image.svg' });
      const tap = harness.gesture('tap');
      tap.onEnd({ x: 0, y: 0 }, true);
      if (reset === 'tap') tap.onEnd({ x: 0, y: 0 }, true);
      else {
        const pinch = harness.gesture('pinch');
        pinch.onStart();
        pinch.onUpdate({ scale: 0.1, focalX: 0, focalY: 0 });
        pinch.onEnd();
      }
      let failed = false;
      harness.gesture('pan').onTouchesDown?.(
        {},
        {
          fail: () => {
            failed = true;
          },
        },
      );
      expect(failed).toBe(true);
    }
  });

  test('hidden images release Back and reopen at normal zoom', () => {
    const harness = gestureHarness('ZoomableImageStage');
    const props = { resetKey: 'image.png', active: true };
    harness.render(props);
    harness.gesture('tap').onEnd({ x: 0, y: 0 }, true);
    harness.render(props);
    harness.render({ ...props, active: false });
    expect(harness.back()).toBe(false);
    expect(harness.gesture('pan').enabled).toBe(false);
    harness.render(props);
    expect(harness.style().transform[2].scale).toBe(1);
  });
});
