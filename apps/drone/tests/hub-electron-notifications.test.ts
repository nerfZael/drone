import { EventEmitter } from 'node:events';
import { expect, test } from 'bun:test';
const { registerDesktopNotifications } = require('../desktop/hub-electron-notifications.cjs');

test('validates IPC, restores the window, routes the exact chat, and reports OS failures', () => {
  const handlers = new Map<string, Function>();
  const calls: unknown[] = [];
  let notification: any;
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(public options: unknown) { super(); notification = this; }
    show() { calls.push('show'); }
    close() {}
  }
  const mainFrame = {};
  const webContents = { mainFrame, send: (...args: unknown[]) => calls.push(args) };
  const window = { webContents, isDestroyed: () => false, isMinimized: () => true,
    restore: () => calls.push('restore'), show: () => calls.push('window'), focus: () => calls.push('focus') };
  registerDesktopNotifications({ ipcMain: { handle: (name: string, handler: Function) => handlers.set(name, handler) }, Notification, getWindow: () => window, getIcon: () => null });
  const trusted = { sender: webContents, senderFrame: mainFrame };
  const show = handlers.get('drone-hub:notification-show')!;
  const target = { droneId: 'reviewer', chatName: 'tests' };
  expect(() => show({ sender: webContents, senderFrame: {} }, {})).toThrow('Untrusted');
  expect(() => show(trusted, { title: 'bad', body: '', target: { droneId: 3 } })).toThrow('Invalid');
  show(trusted, { title: 'Reviewer finished', body: 'Open chat', silent: true, target });
  expect(notification.options).toEqual({ title: 'Reviewer finished', body: 'Open chat', silent: true, timeoutType: 'default' });
  notification.emit('click');
  expect(calls).toEqual(['show', 'restore', 'window', 'focus', ['drone-hub:notification-click', target]]);
  notification.emit('failed', {}, 'Permission denied');
  expect(calls.at(-1)).toEqual(['drone-hub:notification-error', 'Permission denied']);
});

test('Windows banner timeouts retain handles, explicit dismissals release them, and eviction closes the oldest', () => {
  const handlers = new Map<string, Function>();
  const notifications: any[] = [];
  const sent: unknown[] = [];
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    closed = 0;
    constructor() { super(); notifications.push(this); }
    show() {}
    close() { this.closed++; this.emit('close', { reason: 'applicationHidden' }); }
  }
  const mainFrame = {};
  const webContents = { mainFrame, send: (...args: unknown[]) => sent.push(args) };
  const window = { webContents, isDestroyed: () => false, isMinimized: () => false, show() {}, focus() {} };
  registerDesktopNotifications({ ipcMain: { handle: (name: string, handler: Function) => handlers.set(name, handler) }, Notification, getWindow: () => window, getIcon: () => null, platform: 'win32' });
  const show = () => handlers.get('drone-hub:notification-show')!({ sender: webContents, senderFrame: mainFrame }, {
    title: 'Done', body: '', target: { droneId: 'a', chatName: 'review' },
  });
  show();
  notifications[0].emit('close', { reason: 'timedOut' });
  notifications[0].emit('click');
  expect(sent).toEqual([['drone-hub:notification-click', { droneId: 'a', chatName: 'review' }]]);
  show();
  notifications[1].emit('close', { reason: 'userCanceled' });
  for (let i = 0; i < 99; i++) show();
  expect(notifications[0].closed).toBe(0);
  show();
  // The timed-out item still counts toward the bound; the dismissed item does not.
  expect(notifications[0].closed).toBe(1);
  expect(notifications[1].closed).toBe(0);
});
