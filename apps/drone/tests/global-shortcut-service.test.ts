import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'bun:test';

import {
  GlobalShortcutService,
  type GlobalShortcutDispatchEvent,
  type GlobalShortcutServiceDependencies,
  type KeyboardHook,
} from '../src/hub/global-shortcut-service';

class FakeKeyboardHook extends EventEmitter implements KeyboardHook {
  started = false;
  stopped = false;

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }
}

function keyboardEvent(
  keycode: number,
  modifiers: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {},
) {
  return {
    type: 4,
    time: Date.now(),
    keycode,
    altKey: modifiers.altKey === true,
    ctrlKey: modifiers.ctrlKey === true,
    metaKey: modifiers.metaKey === true,
    shiftKey: modifiers.shiftKey === true,
  } as any;
}

function createService(initialBindings: unknown, options: { env?: NodeJS.ProcessEnv } = {}) {
  const hook = new FakeKeyboardHook();
  let stored = initialBindings;
  let now = 1_000;
  let loadCount = 0;
  const deps: GlobalShortcutServiceDependencies = {
    readBindings: async () => stored as any,
    writeBindings: async (bindings) => {
      stored = bindings;
    },
    loadKeyboardHook: () => {
      loadCount += 1;
      return {
        uIOhook: hook,
        UiohookKey: {
          Numpad1: 79,
          NumpadEnd: 61_007,
          NumpadDecimal: 83,
          NumpadDelete: 61_011,
          Q: 16,
          P: 25,
        },
      };
    },
    now: () => ++now,
    platform: 'linux',
    env: options.env ?? { DISPLAY: ':1' },
  };
  return { service: new GlobalShortcutService(deps), hook, getLoadCount: () => loadCount };
}

describe('GlobalShortcutService', () => {
  test('dispatches a physical numpad key to only the most recently active client', async () => {
    const { service, hook } = createService({
      toggleChatVoiceRecording: {
        key: 'num1',
        mod: false,
        ctrl: false,
        meta: false,
        alt: false,
        shift: false,
      },
    });
    await service.start();
    const first: GlobalShortcutDispatchEvent[] = [];
    const second: GlobalShortcutDispatchEvent[] = [];
    service.connectClient('client-one', (event) => first.push(event));
    service.connectClient('client-two', (event) => second.push(event));
    service.updateClientActivity('client-one', { focused: true, visible: true });

    hook.emit('keydown', keyboardEvent(79));
    hook.emit('keydown', keyboardEvent(79));
    hook.emit('keyup', keyboardEvent(79));

    expect(first.map((event) => event.actionId)).toEqual(['toggleChatVoiceRecording']);
    expect(second).toEqual([]);

    service.updateClientActivity('client-one', { focused: false, visible: false });
    service.updateClientActivity('client-two', { focused: true, visible: true });
    hook.emit('keydown', keyboardEvent(61_007));
    hook.emit('keyup', keyboardEvent(61_007));

    expect(first).toHaveLength(1);
    expect(second.map((event) => event.actionId)).toEqual(['toggleChatVoiceRecording']);
    service.close();
  });

  test('does not activate duplicate global bindings', async () => {
    const binding = {
      key: 'q',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    };
    const { service, hook } = createService({
      toggleChatVoiceRecording: binding,
      toggleCompanion: binding,
    });
    await service.start();

    expect(service.snapshot().status.running).toBe(false);
    expect(service.snapshot().status.actions.toggleChatVoiceRecording?.active).toBe(false);
    expect(service.snapshot().status.actions.toggleCompanion?.error).toContain('Another global');
    expect(hook.started).toBe(false);
  });

  test('recognizes the physical numpad decimal key with Num Lock off', async () => {
    const { service, hook } = createService({
      toggleVoiceClipboardRecording: {
        key: 'numdec',
        mod: false,
        ctrl: false,
        meta: false,
        alt: false,
        shift: false,
      },
    });
    await service.start();
    const events: GlobalShortcutDispatchEvent[] = [];
    service.connectClient('client-one', (event) => events.push(event));

    hook.emit('keydown', keyboardEvent(61_011));
    hook.emit('keyup', keyboardEvent(61_011));

    expect(events.map((event) => event.actionId)).toEqual(['toggleVoiceClipboardRecording']);
    service.close();
  });

  test('requires an exact portable modifier match', async () => {
    const { service, hook } = createService({
      openQuickOpen: {
        key: 'p',
        mod: true,
        ctrl: false,
        meta: false,
        alt: true,
        shift: false,
      },
    });
    await service.start();
    const events: GlobalShortcutDispatchEvent[] = [];
    service.connectClient('client-one', (event) => events.push(event));

    hook.emit('keydown', keyboardEvent(25, { ctrlKey: true }));
    hook.emit('keyup', keyboardEvent(25));
    hook.emit('keydown', keyboardEvent(25, { ctrlKey: true, altKey: true, shiftKey: true }));
    hook.emit('keyup', keyboardEvent(25));
    hook.emit('keydown', keyboardEvent(25, { ctrlKey: true, altKey: true }));
    hook.emit('keyup', keyboardEvent(25));

    expect(events.map((event) => event.actionId)).toEqual(['openQuickOpen']);
    service.close();
  });

  test('keeps Hub available when no graphical keyboard session exists', async () => {
    const { service, getLoadCount } = createService(
      {
        toggleCompanion: {
          key: 'q',
          mod: false,
          ctrl: false,
          meta: false,
          alt: false,
          shift: false,
        },
      },
      { env: {} },
    );
    await service.start();

    expect(service.snapshot().status.running).toBe(false);
    expect(service.snapshot().status.error).toContain('graphical desktop session');
    expect(getLoadCount()).toBe(0);
  });
});
