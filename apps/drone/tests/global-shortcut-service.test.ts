import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { describe, expect, test } from 'bun:test';

import {
  GlobalShortcutService,
  type GlobalShortcutDispatchEvent,
  type GlobalShortcutServiceDependencies,
  type KeyboardHook,
} from '../src/hub/global-shortcut-service';
import { HubRouter } from '../src/hub/hub-router';
import { registerGlobalShortcutRoutes } from '../src/hub/routes/global-shortcut-routes';

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
  test('requires native dispatch for ordinary X11 keys and ignores auto-repeat callbacks', async () => {
    const binding = { key: 'q', mod: false, ctrl: false, meta: false, alt: false, shift: false };
    const { service, hook } = createService({ toggleCompanion: binding });
    await service.start();
    let config: any;
    const events: GlobalShortcutDispatchEvent[] = [];
    service.connectClient('client-one', (event) => events.push(event));
    service.connectDesktop('desktop-one', (value) => { config = value; });
    service.reportDesktopStatus('desktop-one', config.revision, { actions: { toggleCompanion: { active: true } } });
    hook.emit('keydown', keyboardEvent(16));
    expect(events).toHaveLength(0);
    service.dispatchDesktop('desktop-one', config.revision, 'toggleCompanion');
    hook.emit('keydown', keyboardEvent(16));
    service.dispatchDesktop('desktop-one', config.revision, 'toggleCompanion');
    expect(events).toHaveLength(1);
    hook.emit('keyup', keyboardEvent(16));
    hook.emit('keydown', keyboardEvent(16));
    service.dispatchDesktop('desktop-one', config.revision, 'toggleCompanion');
    expect(events).toHaveLength(2);
    service.close();
  });

  test('uses the X11 observer only for successfully reserved physical numpad keys', async () => {
    const binding = { key: 'num1', mod: false, ctrl: false, meta: false, alt: false, shift: false };
    const { service, hook } = createService({ toggleCompanion: binding });
    await service.start();
    let config: any;
    const events: GlobalShortcutDispatchEvent[] = [];
    service.connectClient('client-one', (event) => events.push(event));
    service.connectDesktop('desktop-one', (value) => { config = value; });
    expect(config.observedNumpad).toBe(true);
    hook.emit('keydown', keyboardEvent(79));
    hook.emit('keyup', keyboardEvent(79));
    expect(events).toHaveLength(0);
    service.reportDesktopStatus('desktop-one', config.revision, { actions: { toggleCompanion: { active: true } } });
    for (const keycode of [79, 61_007]) {
      hook.emit('keydown', keyboardEvent(keycode));
      hook.emit('keydown', keyboardEvent(keycode));
      hook.emit('keyup', keyboardEvent(keycode));
    }
    service.dispatchDesktop('desktop-one', config.revision, 'toggleCompanion');
    expect(events).toHaveLength(2);
    service.updateClientActivity('client-one', { focused: true, capturing: true });
    service.reportDesktopStatus('desktop-one', config.revision, { actions: { toggleCompanion: { active: true } } });
    hook.emit('keydown', keyboardEvent(79));
    hook.emit('keyup', keyboardEvent(79));
    expect(events).toHaveLength(2);
    service.close();
  });

  test('hands ownership to desktop and rejects stale or unregistered dispatches', async () => {
    const binding = { key: 'q', mod: false, ctrl: false, meta: false, alt: false, shift: false };
    const { service, hook } = createService({ toggleCompanion: binding });
    await service.start();
    const configurations: any[] = [];
    const events: GlobalShortcutDispatchEvent[] = [];
    service.connectClient('client-one', (event) => events.push(event));
    const disconnect = service.connectDesktop('desktop-one', (config) => configurations.push(config));
    expect(hook.stopped).toBe(true);
    expect(hook.listenerCount('keydown')).toBe(1);
    expect(service.snapshot().status.running).toBe(false);
    expect(() => service.connectDesktop('desktop-two', () => {})).toThrow('already connected');
    const revision = configurations[0].revision;
    expect(service.reportDesktopStatus('desktop-one', revision, { actions: { toggleCompanion: { active: true } } })).toBe(true);
    expect(service.dispatchDesktop('desktop-one', revision, 'toggleCompanion')).toBe(true);
    expect(service.dispatchDesktop('desktop-two', revision, 'toggleCompanion')).toBe(false);
    expect(service.dispatchDesktop('desktop-one', revision, 'openHome')).toBe(false);
    const update = service.update({ toggleCompanion: { ...binding, key: 'p' } });
    await Promise.resolve();
    const nextRevision = configurations.at(-1).revision;
    expect(service.reportDesktopStatus('desktop-one', revision, { actions: {} })).toBe(false);
    expect(service.dispatchDesktop('desktop-one', revision, 'toggleCompanion')).toBe(false);
    service.reportDesktopStatus('desktop-one', nextRevision, { actions: { toggleCompanion: { active: false, error: 'Reserved' } } });
    expect((await update).status.actions.toggleCompanion?.error).toBe('Reserved');
    expect(events).toHaveLength(1);
    disconnect();
    expect(hook.listenerCount('keydown')).toBe(1);
    expect(service.dispatchDesktop('desktop-one', nextRevision, 'toggleCompanion')).toBe(false);
    service.close();
  });

  test('suspends desktop shortcuts while a focused client captures a new binding', async () => {
    const { service } = createService({});
    await service.start();
    const configurations: any[] = [];
    service.connectDesktop('desktop-one', (config) => configurations.push(config));
    const disconnect = service.connectClient('client-one', () => {});
    service.updateClientActivity('client-one', { focused: true, capturing: true });
    expect(configurations.at(-1).suspended).toBe(true);
    disconnect();
    expect(configurations.at(-1).suspended).toBe(false);
    service.close();
  });

  test('registers, reconnects, updates and releases through the desktop HTTP connection', async () => {
    const { connectDesktopGlobalShortcuts } = require('../desktop/hub-electron-global-shortcuts.cjs');
    const binding = { key: 'q', mod: false, ctrl: false, meta: false, alt: false, shift: false };
    const { service, hook } = createService({ toggleCompanion: binding });
    await service.start();
    const router = new HubRouter((res, status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    }, async (req) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      return JSON.parse(body);
    });
    registerGlobalShortcutRoutes(router, service);
    let desktopStream: import('node:http').ServerResponse | undefined;
    const server = createServer((req, res) => {
      expect(req.headers.authorization).toBe('Bearer test-token');
      if (req.url?.startsWith('/api/global-shortcuts/desktop/events')) desktopStream = res;
      void router.handle(req, res, new URL(req.url!, 'http://localhost')).catch((error) => res.destroy(error));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const apiUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    const callbacks = new Map<string, () => void>();
    const errors: Error[] = [];
    const events: GlobalShortcutDispatchEvent[] = [];
    service.connectClient('client-one', (event) => events.push(event));
    const desktop = connectDesktopGlobalShortcuts({ apiUrl, apiToken: 'test-token', onError: (error: Error) => errors.push(error), globalShortcut: {
      register: (key: string, callback: () => void) => {
        if (key === 'p') return false;
        callbacks.set(key, callback);
        return true;
      },
      unregister: (key: string) => callbacks.delete(key),
      setSuspended: () => {},
    } });
    try {
      await waitUntil(() => hook.stopped && service.snapshot().status.running);
      callbacks.get('q')!();
      await waitUntil(() => events.length === 1);
      expect(errors).toEqual([]);
      desktopStream!.destroy();
      await waitUntil(() => !callbacks.has('q'));
      await waitUntil(() => callbacks.has('q') && service.snapshot().status.running);
      callbacks.get('q')!();
      await waitUntil(() => events.length === 2);
      const response = await fetch(`${apiUrl}/api/settings/global-shortcuts`, {
        method: 'PUT', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: JSON.stringify({ bindings: { toggleCompanion: { ...binding, key: 'p' } } }),
      });
      const settings = await response.json() as any;
      expect(settings.status.actions.toggleCompanion.active).toBe(false);
      expect(settings.status.actions.toggleCompanion.error).toContain('unavailable');
      expect(callbacks.has('q')).toBe(false);
      await desktop.close();
      expect(callbacks.size).toBe(0);
      await waitUntil(() => hook.listenerCount('keydown') === 1);
    } finally {
      await desktop.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      service.close();
    }
  });

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

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for shortcut state');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
