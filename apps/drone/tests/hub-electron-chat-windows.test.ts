import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
const { installChatWindows, CHAT_WINDOW_PIN_CHANNEL } = require('../desktop/hub-electron-chat-windows.cjs');

test('restricts native windows and pin commands to owned chat windows and closes them with Hub', () => {
  const handlers = new Map();
  const ipcMain = { handle: (name: string, fn: unknown) => handlers.set(name, fn), removeHandler: (name: string) => handlers.delete(name) };
  const contents = () => Object.assign(new EventEmitter(), { mainFrame: {}, open: null as any, setWindowOpenHandler(fn: unknown) { this.open = fn; } });
  const mainWindow = Object.assign(new EventEmitter(), { webContents: contents() });
  installChatWindows({ mainWindow, ipcMain, shell: { openExternal: async () => {} } });
  expect(mainWindow.webContents.open({ url: 'about:blank', frameName: 'drone-hub-chat:a' }).action).toBe('allow');
  expect(mainWindow.webContents.open({ url: 'about:blank', frameName: 'other' }).action).toBe('deny');
  const tool = mainWindow.webContents.open({ url: 'about:blank', frameName: 'drone-hub-tool:editor:1' });
  expect(tool.action).toBe('allow');
  expect(tool.overrideBrowserWindowOptions.width).toBeGreaterThan(640);
  expect(mainWindow.webContents.open({ url: 'https://example.com', frameName: 'drone-hub-tool:editor:1' }).action).toBe('deny');
  expect(mainWindow.webContents.open({ url: 'https://example.com', frameName: 'drone-hub-chat:a' }).action).toBe('deny');
  let pinned = false;
  let destroyed = false;
  const child = Object.assign(new EventEmitter(), {
    webContents: contents(), setMenu() {}, isDestroyed: () => destroyed,
    setAlwaysOnTop: (value: boolean) => { pinned = value; }, isAlwaysOnTop: () => pinned,
    destroy: () => { destroyed = true; },
  });
  mainWindow.webContents.emit('did-create-window', child, { frameName: 'drone-hub-chat:a' });
  const pin = handlers.get(CHAT_WINDOW_PIN_CHANNEL);
  const trusted = { sender: mainWindow.webContents, senderFrame: mainWindow.webContents.mainFrame };
  expect(pin({ sender: child.webContents }, 'drone-hub-chat:a', true)).toBe(false);
  expect(pin({ ...trusted, senderFrame: {} }, 'drone-hub-chat:a', true)).toBe(false);
  expect(pin(trusted, 'missing', true)).toBe(false);
  expect(pin(trusted, 'drone-hub-chat:a', 'yes')).toBe(false);
  expect(pin(trusted, 'drone-hub-chat:a', true)).toBe(true);
  expect(pin(trusted, 'drone-hub-chat:a', false)).toBe(false);
  let toolPinned = false;
  const toolChild = Object.assign(new EventEmitter(), {
    webContents: contents(), setMenu() {}, isDestroyed: () => false,
    setAlwaysOnTop: (value: boolean) => { toolPinned = value; }, isAlwaysOnTop: () => toolPinned,
    destroy: () => {},
  });
  mainWindow.webContents.emit('did-create-window', toolChild, { frameName: 'drone-hub-tool:editor:1' });
  expect(pin(trusted, 'drone-hub-tool:editor:1', true)).toBe(true);
  mainWindow.emit('closed');
  expect(destroyed).toBe(true);
  expect(handlers.size).toBe(0);
});
