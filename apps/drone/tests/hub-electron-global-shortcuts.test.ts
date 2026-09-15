import { describe, expect, test } from 'bun:test';

const { shortcutAccelerator, createShortcutRegistrar } = require('../desktop/hub-electron-global-shortcuts.cjs');
const binding = (key: string, modifiers = {}) => ({ key, mod: false, ctrl: false, meta: false, alt: false, shift: false, ...modifiers });

function fakeShortcuts() {
  const callbacks = new Map<string, () => void>();
  const unavailable = new Set<string>();
  let suspended = false;
  return {
    callbacks, unavailable,
    get suspended() { return suspended; },
    register(accelerator: string, callback: () => void) {
      if (unavailable.has(accelerator)) return false;
      if (callbacks.has(accelerator)) throw new Error('Already registered');
      callbacks.set(accelerator, callback);
      return true;
    },
    unregister(accelerator: string) { callbacks.delete(accelerator); },
    setSuspended(value: boolean) { suspended = value; },
  };
}

describe('Electron global shortcuts', () => {
  test('reserves observed numpad keys without double dispatch and rejects them if observation is unavailable', () => {
    const native = fakeShortcuts();
    const events: unknown[] = [];
    const registrar = createShortcutRegistrar(native, (event: unknown) => events.push(event));
    registrar.configure({ revision: 1, bindings: { toggleCompanion: binding('num1') }, observedNumpad: true });
    expect(native.callbacks.has('num1')).toBe(true);
    native.callbacks.get('num1')!();
    expect(events).toHaveLength(0);
    const status = registrar.configure({ revision: 2, bindings: { toggleCompanion: binding('num1') }, numpadUnavailable: true });
    expect(status.actions.toggleCompanion.active).toBe(false);
    expect(native.callbacks.has('num1')).toBe(false);
    registrar.close();
  });

  test('leaves observed backquote dispatch to the physical listener, with native fallback elsewhere', () => {
    for (const key of ['`', '~']) {
      const native = fakeShortcuts();
      const events: unknown[] = [];
      const registrar = createShortcutRegistrar(native, (event: unknown) => events.push(event));
      registrar.configure({ revision: 1, bindings: { toggleCompanion: binding(key) }, observedBackquote: true });
      native.callbacks.get(key)!();
      expect(events).toHaveLength(0);
      registrar.configure({ revision: 2, bindings: { toggleCompanion: binding(key) } });
      native.callbacks.get(key)!();
      expect(events).toEqual([{ revision: 2, actionId: 'toggleCompanion' }]);
      registrar.close();
    }
  });

  test('preserves numpad identity and translates portable and explicit modifiers', () => {
    expect(shortcutAccelerator(binding('num1'))).toBe('num1');
    expect(shortcutAccelerator(binding('1'))).toBe('1');
    expect(shortcutAccelerator(binding('numenter'))).toBeNull();
    expect(shortcutAccelerator(binding('arrowleft', { mod: true, alt: true }), 'darwin')).toBe('Super+Alt+Left');
    expect(shortcutAccelerator(binding('q', { mod: true }), 'linux')).toBe('Control+q');
    expect(shortcutAccelerator(binding('q', { ctrl: true, meta: true, shift: true }), 'darwin')).toBe('Control+Super+Shift+q');
    expect(shortcutAccelerator(binding('+', { ctrl: true }))).toBe('Control+Plus');
  });

  test('reports conflicts and unsupported keys without registering aliases for them', () => {
    const native = fakeShortcuts();
    native.unavailable.add('num1');
    const registrar = createShortcutRegistrar(native, () => {}, 'linux');
    const status = registrar.configure({ revision: 1, bindings: {
      toggleCompanion: binding('num1'),
      openHome: binding('numenter'),
      openQuickOpen: binding('p', { mod: true }),
      openFilesTab: binding('p', { ctrl: true }),
      toggleSidebarCollapsed: binding('q'),
    } });
    expect(status.actions.toggleCompanion.active).toBe(false);
    expect(status.actions.toggleCompanion.error).toContain('unavailable');
    expect(status.actions.openHome.error).toContain('not supported');
    expect(status.actions.openQuickOpen.error).toContain('Another global');
    expect(status.actions.openFilesTab.active).toBe(false);
    expect([...native.callbacks.keys()]).toEqual(['q']);
    expect(status.running).toBe(true);
    registrar.close();
  });

  test('releases old bindings, ignores stale callbacks, and suspends during capture', () => {
    const native = fakeShortcuts();
    const events: unknown[] = [];
    const registrar = createShortcutRegistrar(native, (event: unknown) => events.push(event));
    registrar.configure({ revision: 1, bindings: { toggleCompanion: binding('q') } });
    const oldCallback = native.callbacks.get('q')!;
    oldCallback();
    registrar.configure({ revision: 2, bindings: { toggleCompanion: binding('num1') }, suspended: true });
    expect(native.callbacks.has('q')).toBe(false);
    expect(native.suspended).toBe(true);
    native.callbacks.get('num1')!();
    oldCallback();
    expect(events).toEqual([{ revision: 1, actionId: 'toggleCompanion' }]);
    registrar.configure({ revision: 3, bindings: { toggleCompanion: binding('num1') } });
    expect(native.suspended).toBe(false);
    native.callbacks.get('num1')!();
    expect(events).toHaveLength(2);
    registrar.close();
    expect(native.callbacks.size).toBe(0);
  });
});

describe('physical desktop shortcut ownership', () => {
  const { createDesktopShortcutRegistrar } = require('../desktop/hub-electron-global-shortcuts.cjs');

  test('reserves physical backquote instead of its layout-dependent Electron symbol and releases it before rebinding', async () => {
    const native = fakeShortcuts();
    const reservations: any[] = [];
    let owned = false;
    const reserve = (config: any) => {
      expect(owned).toBe(false);
      owned = true;
      reservations.push(config);
      return {
        status: Promise.resolve({ toggleCompanion: { active: true, error: '' } }),
        close: async () => { owned = false; },
      };
    };
    const registrar = createDesktopShortcutRegistrar(native, () => {}, () => {}, reserve);
    const config = { revision: 1, observedBackquote: true, bindings: {
      toggleCompanion: binding('`'), openHome: binding('q', { ctrl: true }),
    } };
    const status = await registrar.configure(config);
    expect([...native.callbacks.keys()]).toEqual(['Control+q']);
    expect(reservations[0].bindings).toEqual({ toggleCompanion: binding('`') });
    expect(status.actions.toggleCompanion.active).toBe(true);
    expect(status.actions.openHome.active).toBe(true);
    expect(status.running).toBe(true);
    await registrar.configure({ ...config, revision: 2, suspended: true });
    expect(reservations[1].suspended).toBe(true);
    expect(native.suspended).toBe(true);
    await registrar.close();
    expect(owned).toBe(false);
    expect(native.callbacks.size).toBe(0);
  });

  test('reports unavailable physical grabs without a leaking native fallback', async () => {
    for (const result of ['conflict', 'missing helper']) {
      const native = fakeShortcuts();
      let closed = false;
      const registrar = createDesktopShortcutRegistrar(native, () => {}, () => {}, () => ({
        status: result === 'conflict'
          ? Promise.resolve({ toggleCompanion: { active: false, error: 'Reserved elsewhere' } })
          : Promise.reject(new Error('python3 unavailable')),
        close: async () => { closed = true; },
      }));
      const status = await registrar.configure({ revision: 1, observedBackquote: true, bindings: { toggleCompanion: binding('~', { shift: true }) } });
      expect(status.running).toBe(false);
      expect(status.actions.toggleCompanion.active).toBe(false);
      expect(status.actions.toggleCompanion.error).toContain(result === 'conflict' ? 'Reserved' : 'python3');
      expect(native.callbacks.size).toBe(0);
      await registrar.close();
      expect(closed).toBe(true);
    }
  });

  test('keeps native backquote registration on desktops without the X11 observer', async () => {
    const native = fakeShortcuts();
    const events: unknown[] = [];
    const registrar = createDesktopShortcutRegistrar(native, (event: unknown) => events.push(event), () => {}, () => {
      throw new Error('Physical reservation must only run for X11 observation');
    });
    await registrar.configure({ revision: 1, bindings: { toggleCompanion: binding('`') } });
    native.callbacks.get('`')!();
    expect(events).toEqual([{ revision: 1, actionId: 'toggleCompanion' }]);
    await registrar.close();
  });
});
