import { EventEmitter } from 'node:events';
import { expect, test } from 'bun:test';
const { installCompanionWindow } = require('../desktop/hub-electron-companion.cjs');

class Contents extends EventEmitter {
  mainFrame = {};
  messages: string[] = [];
  handler!: (details: { url: string; frameName?: string }) => any;
  setWindowOpenHandler(handler: Contents['handler']) { this.handler = handler; }
  send(channel: string) { this.messages.push(channel); }
}
class Window extends EventEmitter {
  webContents = new Contents();
  destroyed = false;
  visible = false;
  menu: unknown = 'default';
  isMinimized() { return false; }
  restore() {}
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.emit('closed'); }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  setMenu(menu: unknown) { this.menu = menu; }
}

test('Companion windows are bounded, always on top, protected from navigation, and controlled only by the owner main frame', () => {
  const owner = new Window();
  const ipcMain = new EventEmitter();
  const external: string[] = [];
  installCompanionWindow({ owner, ipcMain, shell: { openExternal: async (url: string) => { external.push(url); } }, isQuitting: () => false });
  const open = owner.webContents.handler;
  expect(open({ url: 'about:blank', frameName: 'unrelated' }).action).toBe('deny');
  expect(open({ url: 'https://example.com', frameName: 'drone-hub-companion' }).action).toBe('deny');
  expect(external).toEqual(['https://example.com']);
  expect(open({ url: 'about:blank', frameName: 'drone-hub-companion' })).toMatchObject({
    action: 'allow', outlivesOpener: false,
    overrideBrowserWindowOptions: { alwaysOnTop: true, show: false, frame: true, minWidth: 380 },
  });
  const child = new Window();
  owner.webContents.emit('did-create-window', child, { frameName: 'drone-hub-companion' });
  expect(child.menu).toBeNull();
  expect(open({ url: 'about:blank', frameName: 'drone-hub-companion' }).action).toBe('deny');
  let prevented = false;
  child.emit('close', { preventDefault: () => { prevented = true; } });
  expect(prevented).toBe(true);
  expect(child.destroyed).toBe(false);
  expect(owner.webContents.messages).toEqual(['drone-hub:companion-window-close']);
  const control = (sender: Contents, senderFrame: object, action: string) => ipcMain.emit('drone-hub:companion-window', { sender, senderFrame }, action);
  control(child.webContents, child.webContents.mainFrame, 'show');
  control(owner.webContents, {}, 'show');
  expect(child.visible).toBe(false);
  control(owner.webContents, owner.webContents.mainFrame, 'show');
  expect(child.visible).toBe(true);
  control(owner.webContents, owner.webContents.mainFrame, 'hide');
  expect(child.visible).toBe(false);
  prevented = false;
  child.webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://example.com/link');
  expect(prevented).toBe(true);
  expect(external.at(-1)).toBe('https://example.com/link');
  control(owner.webContents, owner.webContents.mainFrame, 'attach');
  expect(owner.visible).toBe(true);
  expect(child.destroyed).toBe(true);
  const next = new Window();
  owner.webContents.emit('did-create-window', next, { frameName: 'drone-hub-companion' });
  owner.webContents.emit('did-start-navigation', {}, 'http://localhost', false, true);
  expect(next.destroyed).toBe(true);
  owner.destroy();
  expect(ipcMain.listenerCount('drone-hub:companion-window')).toBe(0);
});

test('Companion and chat window handlers coexist without exposing Companion to chat pin commands', () => {
  const { installChatWindows, CHAT_WINDOW_PIN_CHANNEL } = require('../desktop/hub-electron-chat-windows.cjs');
  const owner = new Window();
  const handlers = new Map<string, Function>();
  const ipcMain = Object.assign(new EventEmitter(), {
    handle: (name: string, fn: Function) => handlers.set(name, fn),
    removeHandler: (name: string) => handlers.delete(name),
  });
  const shell = { openExternal: async () => {} };
  const openOtherWindow = installChatWindows({ mainWindow: owner, ipcMain, shell });
  installCompanionWindow({ owner, ipcMain, shell, isQuitting: () => false, openOtherWindow });
  expect(owner.webContents.handler({ url: 'about:blank', frameName: 'drone-hub-chat:test' }).action).toBe('allow');
  expect(owner.webContents.handler({ url: 'about:blank', frameName: 'drone-hub-companion' }).action).toBe('allow');
  const child = new Window();
  owner.webContents.emit('did-create-window', child, { frameName: 'drone-hub-companion' });
  expect(handlers.get(CHAT_WINDOW_PIN_CHANNEL)!({ sender: owner.webContents, senderFrame: owner.webContents.mainFrame }, 'drone-hub-companion', false)).toBe(false);
  owner.destroy();
  expect(child.destroyed).toBe(true);
  expect(handlers.size).toBe(0);
});
