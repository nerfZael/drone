import { EventEmitter } from 'node:events';
import { expect, test } from 'bun:test';
const { registerDesktopNotifications } = require('../desktop/hub-electron-notifications.cjs');

function fixture() {
  const handlers = new Map<string, Function>();
  const events = new Map<string, Function>();
  const popups: any[] = [];
  const calls: unknown[] = [];
  const timers = new Map<object, { callback: Function; delay: number }>();
  let time = 0;
  class Popup extends EventEmitter {
    destroyed = false;
    bounds: any;
    webContents = Object.assign(new EventEmitter(), { mainFrame: {}, setWindowOpenHandler() {} });
    constructor(public options: any) { super(); popups.push(this); }
    loadFile() { return Promise.resolve(); }
    setBounds(bounds: any) { this.bounds = bounds; }
    showInactive() { calls.push('inactive'); }
    destroy() { this.destroyed = true; this.emit('closed'); }
    isDestroyed() { return this.destroyed; }
  }
  const mainFrame = {};
  const webContents = { mainFrame, send: (...args: unknown[]) => calls.push(args) };
  const window = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false, isMinimized: () => true,
    getBounds: () => ({ x: 0, y: 0, width: 1200, height: 900 }),
    restore: () => calls.push('restore'), show: () => calls.push('window'), focus: () => calls.push('focus') });
  registerDesktopNotifications({
    ipcMain: { handle: (name: string, handler: Function) => handlers.set(name, handler), on: (name: string, handler: Function) => events.set(name, handler) },
    BrowserWindow: Popup, screen: { getDisplayMatching: () => ({ workArea: { x: 100, y: 50, width: 1200, height: 900 } }) },
    shell: { beep: () => calls.push('beep') }, getWindow: () => window, now: () => time,
    timers: { setTimeout: (callback: Function, delay: number) => { const id = {}; timers.set(id, { callback, delay }); return id; }, clearTimeout: (id: object) => timers.delete(id) },
  });
  const sender = (popup = window) => ({ sender: popup.webContents, senderFrame: popup.webContents.mainFrame });
  const show = (extra = {}) => handlers.get('drone-hub:notification-show')!(sender(), { title: 'Reviewer finished', body: 'Open chat', silent: true, target: { droneId: 'reviewer', chatName: 'tests' }, ...extra });
  const action = (popup: any, action: string) => events.get('drone-hub:notification-action')!(sender(popup), action);
  return { handlers, events, popups, calls, timers, window, sender, show, action, advance: (ms: number) => { time += ms; } };
}

test('creates sandboxed cards without focusing, with exact click navigation and individual dismissal', () => {
  const f = fixture();
  f.show(); f.show();
  const card = f.popups[0];
  expect(card.options).toMatchObject({ frame: false, alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  f.action(card, 'ready');
  expect(f.calls).toEqual(['inactive']);
  expect(card.bounds).toEqual({ x: 908, y: 818, width: 380, height: 120 });
  f.action(card, 'open');
  expect(f.calls.slice(-4)).toEqual(['restore', 'window', 'focus', ['drone-hub:notification-click', { droneId: 'reviewer', chatName: 'tests' }]]);
  expect(card.destroyed).toBe(true);
  f.action(f.popups[1], 'dismiss');
  expect(f.popups[1].destroyed).toBe(true);
  expect(f.calls).toHaveLength(5);
});

test('caps visible cards, queues extras, and clears both visible and queued cards', () => {
  const f = fixture();
  for (let i = 0; i < 6; i++) f.show({ durationSeconds: 0 });
  expect(f.popups).toHaveLength(3);
  f.popups.forEach((card) => f.action(card, 'ready'));
  expect(f.timers.size).toBe(0);
  f.action(f.popups[0], 'dismiss');
  expect(f.popups).toHaveLength(4);
  f.handlers.get('drone-hub:notification-clear')!(f.sender());
  expect(f.popups.every((card) => card.destroyed)).toBe(true);
  expect(f.popups).toHaveLength(4);
});

test('auto-dismiss uses visible time, pausing on hover/focus and resuming the remaining duration', () => {
  const f = fixture();
  f.show({ durationSeconds: 8 });
  expect(f.timers.size).toBe(0);
  const card = f.popups[0];
  f.action(card, 'ready');
  expect([...f.timers.values()][0].delay).toBe(8000);
  f.advance(2500);
  f.action(card, 'pause');
  expect(f.timers.size).toBe(0);
  f.advance(20000);
  f.action(card, 'resume');
  expect([...f.timers.values()][0].delay).toBe(5500);
  [...f.timers.values()][0].callback();
  expect(card.destroyed).toBe(true);
});

test('rejects untrusted main/card IPC and invalid durations; closes cards with the main window', () => {
  const f = fixture();
  expect(() => f.handlers.get('drone-hub:notification-show')!({}, {})).toThrow('Untrusted');
  expect(() => f.show({ durationSeconds: -1 })).toThrow('duration');
  expect(() => f.show({ target: { droneId: 3 } })).toThrow('Invalid');
  f.show();
  expect(() => f.handlers.get('drone-hub:notification-card')!(f.sender())).toThrow('Untrusted');
  const card = f.popups[0];
  expect(f.handlers.get('drone-hub:notification-card')!(f.sender(card)).title).toBe('Reviewer finished');
  f.events.get('drone-hub:notification-action')!(f.sender(), 'dismiss');
  expect(card.destroyed).toBe(false);
  f.window.emit('closed');
  expect(card.destroyed).toBe(true);
});

test('drops the oldest queued card on overflow without dismissing visible persistent cards', () => {
  const f = fixture();
  for (let i = 0; i < 55; i++) f.show({ title: `Notification ${i}`, durationSeconds: 0 });
  expect(f.popups).toHaveLength(3);
  expect(f.popups.every((card) => !card.destroyed)).toBe(true);
  f.action(f.popups[0], 'dismiss');
  const payload = f.handlers.get('drone-hub:notification-card')!(f.sender(f.popups[3]));
  expect(payload.title).toBe('Notification 5');
});
