import { EventEmitter } from 'node:events';
import { expect, test } from 'bun:test';
const { installCompanionWindow } = require('../desktop/hub-electron-companion.cjs');
const workArea = { x: 100, y: 50, width: 1920, height: 1040 };
const screen = { getPrimaryDisplay: () => ({ workArea }), getDisplayMatching: () => ({ workArea }) };

class Contents extends EventEmitter {
  mainFrame = {};
  messages: string[] = [];
  placements: Array<{ flow: string; maxHeight: number }> = [];
  handler!: (details: { url: string; frameName?: string }) => any;
  setWindowOpenHandler(handler: Contents['handler']) { this.handler = handler; }
  send(channel: string, payload?: any) {
    this.messages.push(channel);
    if (channel === 'drone-hub:companion-window-placement') this.placements.push(payload);
  }
}
class Window extends EventEmitter {
  webContents = new Contents();
  destroyed = false;
  visible = false;
  bounds = { x: 1540, y: 1010, width: 464, height: 64 };
  getBounds() { return this.bounds; }
  setBounds(bounds: typeof this.bounds) { this.bounds = bounds; }
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
  installCompanionWindow({ owner, ipcMain, screen, shell: { openExternal: async (url: string) => { external.push(url); } }, isQuitting: () => false });
  const open = owner.webContents.handler;
  expect(open({ url: 'about:blank', frameName: 'unrelated' }).action).toBe('deny');
  expect(open({ url: 'https://example.com', frameName: 'drone-hub-companion' }).action).toBe('deny');
  expect(external).toEqual(['https://example.com']);
  expect(open({ url: 'about:blank', frameName: 'drone-hub-companion' })).toMatchObject({
    action: 'allow', outlivesOpener: false,
    overrideBrowserWindowOptions: { alwaysOnTop: true, show: false, frame: false, transparent: true, resizable: false, width: 464, height: 64, x: 1540, y: 1010 },
  });
  const child = new Window();
  owner.webContents.emit('did-create-window', child, { frameName: 'drone-hub-companion' });
  expect(child.menu).toBeNull();
  expect(open({ url: 'about:blank', frameName: 'drone-hub-companion' }).action).toBe('deny');
  let prevented = false;
  child.emit('close', { preventDefault: () => { prevented = true; } });
  expect(prevented).toBe(true);
  expect(child.destroyed).toBe(false);
  expect(owner.webContents.messages).toEqual(['drone-hub:companion-window-placement', 'drone-hub:companion-window-close']);
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
  installCompanionWindow({ owner, ipcMain, screen, shell, isQuitting: () => false, openOtherWindow });
  expect(owner.webContents.handler({ url: 'about:blank', frameName: 'drone-hub-chat:test' }).action).toBe('allow');
  expect(owner.webContents.handler({ url: 'about:blank', frameName: 'drone-hub-companion' }).action).toBe('allow');
  const child = new Window();
  owner.webContents.emit('did-create-window', child, { frameName: 'drone-hub-companion' });
  expect(handlers.get(CHAT_WINDOW_PIN_CHANNEL)!({ sender: owner.webContents, senderFrame: owner.webContents.mainFrame }, 'drone-hub-companion', false)).toBe(false);
  owner.destroy();
  expect(child.destroyed).toBe(true);
  expect(handlers.size).toBe(0);
});

test('content sizing grows upward from a bar low on the screen, shrinks, clamps to the work area, and rejects untrusted or invalid sizes', () => {
  const owner = new Window();
  const ipcMain = new EventEmitter();
  installCompanionWindow({ owner, ipcMain, screen, shell: { openExternal: async () => {} }, isQuitting: () => false });
  const child = new Window();
  owner.webContents.emit('did-create-window', child, { frameName: 'drone-hub-companion' });
  const trusted = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };
  const resize = (height: unknown, event = trusted) => ipcMain.emit('drone-hub:companion-window', event, 'resize', { height });
  resize(600);
  expect(child.bounds).toEqual({ x: 1540, y: 474, width: 464, height: 600 });
  resize(58);
  expect(child.bounds).toEqual({ x: 1540, y: 1016, width: 464, height: 58 });
  for (const size of [NaN, Infinity, '600', undefined]) resize(size);
  resize(900, { sender: owner.webContents, senderFrame: {} });
  resize(900, { sender: child.webContents, senderFrame: child.webContents.mainFrame });
  expect(child.bounds.height).toBe(58);
  resize(999999);
  expect(child.bounds).toEqual({ x: 1540, y: 66, width: 464, height: 1008 });
  // A user drag establishes a new bottom-right corner for subsequent growth.
  child.bounds = { x: 600, y: 300, width: 464, height: 60 };
  resize(160);
  expect(child.bounds).toEqual({ x: 600, y: 200, width: 464, height: 160 });
  owner.destroy();
});

test('content flows downward from a bar high on the screen, and the bar stays put when the direction flips', async () => {
  const owner = new Window();
  const ipcMain = new EventEmitter();
  installCompanionWindow({ owner, ipcMain, screen, shell: { openExternal: async () => {} }, isQuitting: () => false });
  const child = new Window();
  owner.webContents.emit('did-create-window', child, { frameName: 'drone-hub-companion' });
  // The desktop announces the layout as soon as the window exists.
  expect(owner.webContents.placements).toEqual([{ flow: 'up', maxHeight: 1008 }]);
  const trusted = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };
  const bar = { height: 42, inset: 9 };
  const resize = (size: object) => ipcMain.emit('drone-hub:companion-window', trusted, 'resize', size);
  // The renderer's real bar geometry refines the anchor without moving the bar's bottom edge (1065).
  resize({ height: 64, flow: 'up', bar });
  expect(child.bounds).toEqual({ x: 1540, y: 1010, width: 464, height: 64 });
  expect(owner.webContents.placements.at(-1)).toEqual({ flow: 'up', maxHeight: 1008 });
  // Dragging the bar into the top half asks the renderer to lay content out below it.
  child.bounds = { x: 600, y: 66, width: 464, height: 64 };
  child.emit('move');
  await new Promise(resolve => setTimeout(resolve, 250));
  expect(owner.webContents.placements.at(-1)).toEqual({ flow: 'down', maxHeight: 1004 });
  // The renderer flips; the bar's top edge (79) stays exactly where it was.
  resize({ height: 300, flow: 'down', bar });
  expect(child.bounds).toEqual({ x: 600, y: 70, width: 464, height: 300 });
  resize({ height: 500, flow: 'down', bar });
  expect(child.bounds).toEqual({ x: 600, y: 70, width: 464, height: 500 });
  // Oversized content is capped at the room below the bar rather than pushing the bar up.
  resize({ height: 5000, flow: 'down', bar });
  expect(child.bounds).toEqual({ x: 600, y: 70, width: 464, height: 1004 });
  // Showing repeats the placement in case the renderer subscribed late.
  const before = owner.webContents.placements.length;
  ipcMain.emit('drone-hub:companion-window', trusted, 'show');
  expect(owner.webContents.placements.length).toBe(before + 1);
  expect(owner.webContents.placements.at(-1)).toEqual({ flow: 'down', maxHeight: 1004 });
  // Hiding keeps the bar where the user left it; the next session starts below it again.
  ipcMain.emit('drone-hub:companion-window', trusted, 'hide');
  expect(child.visible).toBe(false);
  expect(child.bounds).toEqual({ x: 600, y: 70, width: 464, height: 1004 });
  ipcMain.emit('drone-hub:companion-window', trusted, 'show');
  resize({ height: 64, flow: 'down', bar });
  expect(child.bounds).toEqual({ x: 600, y: 70, width: 464, height: 64 });
  owner.destroy();
});

test('a saved bar position high on the screen restores flowing downward', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-position-'));
  const positionPath = path.join(directory, 'position.json');
  try {
    fs.writeFileSync(positionPath, JSON.stringify({ right: 1064, top: 79, bottom: 121 }));
    const owner = new Window();
    const ipcMain = new EventEmitter();
    installCompanionWindow({ owner, ipcMain, screen, positionPath, shell: { openExternal: async () => {} }, isQuitting: () => false });
    expect(owner.webContents.handler({ url: 'about:blank', frameName: 'drone-hub-companion' }).overrideBrowserWindowOptions)
      .toMatchObject({ x: 600, y: 66, width: 464, height: 64 });
    const child = new Window();
    child.bounds = { x: 600, y: 66, width: 464, height: 64 };
    owner.webContents.emit('did-create-window', child, { frameName: 'drone-hub-companion' });
    expect(owner.webContents.placements).toEqual([{ flow: 'down', maxHeight: 1002 }]);
    owner.destroy();
    // Positions written by earlier versions carry no bar height and still restore.
    fs.writeFileSync(positionPath, JSON.stringify({ right: 1064, bottom: 460 }));
    const second = new Window();
    installCompanionWindow({ owner: second, ipcMain: new EventEmitter(), screen, positionPath, shell: { openExternal: async () => {} }, isQuitting: () => false });
    expect(second.webContents.handler({ url: 'about:blank', frameName: 'drone-hub-companion' }).overrideBrowserWindowOptions)
      .toMatchObject({ x: 600, y: 405, width: 464, height: 64 });
    second.destroy();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('floating position survives restart, hiding, and clamps to the display', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-position-'));
  const positionPath = path.join(directory, 'position.json');
  const open = (owner: Window) => owner.webContents.handler({ url: 'about:blank', frameName: 'drone-hub-companion' }).overrideBrowserWindowOptions;
  const setup = () => {
    const owner = new Window();
    const ipcMain = new EventEmitter();
    installCompanionWindow({ owner, ipcMain, screen, positionPath, shell: { openExternal: async () => {} }, isQuitting: () => false });
    return { owner, ipcMain };
  };
  try {
    const first = setup();
    const child = new Window();
    first.owner.webContents.emit('did-create-window', child, { frameName: 'drone-hub-companion' });
    child.bounds = { x: 600, y: 300, width: 464, height: 160 };
    child.emit('move');
    first.owner.destroy();
    const second = setup();
    expect(open(second.owner)).toMatchObject({ x: 600, y: 396, width: 464, height: 64 });
    const restored = new Window();
    restored.bounds = { x: 600, y: 396, width: 464, height: 64 };
    second.owner.webContents.emit('did-create-window', restored, { frameName: 'drone-hub-companion' });
    const event = { sender: second.owner.webContents, senderFrame: second.owner.webContents.mainFrame };
    second.ipcMain.emit('drone-hub:companion-window', event, 'hide');
    second.ipcMain.emit('drone-hub:companion-window', event, 'show');
    expect(restored.bounds).toEqual({ x: 600, y: 396, width: 464, height: 64 });
    second.owner.destroy();
    fs.writeFileSync(positionPath, JSON.stringify({ right: 99999, bottom: -500 }));
    const third = setup();
    expect(open(third.owner)).toMatchObject({ x: 1540, y: 66 });
    third.owner.destroy();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
