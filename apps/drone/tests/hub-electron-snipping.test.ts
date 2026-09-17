import { EventEmitter } from 'node:events';
import { expect, test } from 'bun:test';
const { cropRectangle, selectScreenSource, installSnipping } = require('../desktop/hub-electron-snipping.cjs');

test('selection uses actual capture dimensions on scaled and negative-origin monitors', () => {
  const bounds = { x: -1920, y: -100, width: 1920, height: 1080 };
  expect(cropRectangle({ x: 20, y: 30, width: 100, height: 50 }, bounds, { width: 3840, height: 2160 })).toEqual({ x: 40, y: 60, width: 200, height: 100 });
  expect(cropRectangle({ x: -20, y: 1000, width: 100, height: 200 }, bounds, { width: 1920, height: 1080 })).toEqual({ x: 0, y: 1000, width: 80, height: 80 });
  expect(() => cropRectangle({ x: NaN, y: 0, width: 1, height: 1 }, bounds, bounds)).toThrow();
  expect(() => cropRectangle({ x: 0, y: 0, width: 0, height: 1 }, bounds, bounds)).toThrow();
});

test('capture matches display identity rather than source order and refuses unknown screens', () => {
  const thumbnail = { isEmpty: () => false };
  const sources = [{ display_id: '2', thumbnail }, { display_id: '1', thumbnail }];
  expect(selectScreenSource(sources, { id: 1 })).toBe(sources[1]);
  expect(() => selectScreenSource(sources, { id: 3 })).toThrow('could not be matched');
});

function fixture(platform = 'linux') {
  const ipc = Object.assign(new EventEmitter(), {
    handle: (_channel: string, fn: any) => { handler = fn; }, removeHandler: () => {},
  });
  let handler: any;
  const image = { isEmpty: () => false, toPNG: () => Buffer.from('png'), toDataURL: () => 'data:image/png;base64,cG5n', getSize: () => ({ width: 200, height: 100 }), crop: (rect: any) => { crops.push(rect); return image; } };
  const crops: any[] = [];
  const windows: Overlay[] = [];
  class Overlay extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { mainFrame: {}, setWindowOpenHandler: () => {}, send: () => {} });
    destroyed = false;
    fullscreen = false;
    fullscreenAtShow = false;
    constructor(public options: any) { super(); windows.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    async loadFile() {}
    setBounds() {} setAlwaysOnTop() {} focus() {}
    setFullScreen(value: boolean) { this.fullscreen = value; }
    show() { this.fullscreenAtShow = this.fullscreen; }
  }
  const owner = Object.assign(new EventEmitter(), { webContents: { mainFrame: {} }, isDestroyed: () => false });
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };
  const sources: any[] = [];
  installSnipping({ owner, ipcMain: ipc, BrowserWindow: Overlay, platform, getCursorPoint: (screen: any) => screen.getCursorScreenPoint(),
    screen: { getAllDisplays: () => [{ id: 42 }], getCursorScreenPoint: () => ({ x: -10, y: 10 }), getDisplayNearestPoint: () => ({ id: 42, scaleFactor: 2, bounds: { x: -100, y: 0, width: 100, height: 50 } }) },
    desktopCapturer: { getSources: async (input: any) => { sources.push(input); return [{ display_id: '42', thumbnail: image }]; } },
  });
  return { handler: (mode: string, sender = event) => handler(sender, mode), windows, ipc, owner, crops, sources };
}

test('immediate capture needs no overlay and rejects untrusted frames', async () => {
  const f = fixture();
  await expect(f.handler('screen')).resolves.toMatchObject({ mime: 'image/png', size: 3, dataBase64: 'cG5n' });
  expect(f.sources[0].thumbnailSize).toEqual({ width: 200, height: 100 });
  expect(f.windows).toHaveLength(0);
  await expect(f.handler('screen', { sender: f.owner.webContents, senderFrame: {} })).rejects.toThrow('only available');
});

test('snipping freezes first, ignores foreign selection, suppresses repeats and cleans up after cancel', async () => {
  const f = fixture();
  const result = f.handler('region');
  await Promise.resolve(); await Promise.resolve();
  const overlay = f.windows[0];
  expect(overlay.options.x).toBe(-100);
  expect(await f.handler('region')).toBeNull();
  f.ipc.emit('drone-hub:snip-selection', { sender: {}, senderFrame: {} }, 'screen');
  expect(overlay.destroyed).toBe(false);
  f.ipc.emit('drone-hub:snip-selection', { sender: overlay.webContents, senderFrame: overlay.webContents.mainFrame }, null);
  expect(await result).toBeNull();
  expect(overlay.destroyed).toBe(true);
  expect(f.ipc.listenerCount('drone-hub:snip-selection')).toBe(0);
  expect(await f.handler('screen')).not.toBeNull();
});

test('region selection crops captured pixels and owner teardown cancels an open snip', async () => {
  const f = fixture();
  const result = f.handler('region');
  await Promise.resolve(); await Promise.resolve();
  const overlay = f.windows[0];
  f.ipc.emit('drone-hub:snip-selection', { sender: overlay.webContents, senderFrame: overlay.webContents.mainFrame }, { x: 5, y: 10, width: 20, height: 15 });
  expect(await result).not.toBeNull();
  expect(f.crops).toEqual([{ x: 10, y: 20, width: 40, height: 30 }]);
  const cancelled = f.handler('region');
  await Promise.resolve(); await Promise.resolve();
  f.owner.emit('closed');
  expect(await cancelled).toBeNull();
});


test('Linux capture matches truncated unsigned IDs across reordered sources and identical monitor models', () => {
  const displays = [{ id: 1886007147620946 }, { id: 1242421754473043 }, { id: 1886007147620949 }];
  const thumbnail = { isEmpty: () => false };
  const sources = ['1108601429', '1108601426', '3679857235'].map(display_id => ({ display_id, thumbnail }));
  expect(selectScreenSource(sources, displays[0], displays, 'linux')).toBe(sources[1]);
  expect(selectScreenSource(sources, displays[1], displays, 'linux')).toBe(sources[2]);
  expect(selectScreenSource(sources, displays[2], displays, 'linux')).toBe(sources[0]);
  expect(() => selectScreenSource(sources, displays[0], displays, 'darwin')).toThrow('could not be matched');
  expect(() => selectScreenSource(sources, displays[0], displays, 'win32')).toThrow('could not be matched');
});

test('truncated IDs never override exact matches or guess through a collision', () => {
  const display = { id: 1886007147620946 };
  const thumbnail = { isEmpty: () => false };
  const truncated = { display_id: '1108601426', thumbnail };
  const exact = { display_id: String(display.id), thumbnail };
  expect(selectScreenSource([truncated, exact], display, [display], 'linux')).toBe(exact);
  expect(() => selectScreenSource([truncated, truncated], display, [display], 'linux')).toThrow('could not be matched');
  expect(() => selectScreenSource([truncated], display, [display, { id: display.id + 2 ** 32 }], 'linux')).toThrow('could not be matched');
  expect(() => selectScreenSource([{ display_id: '', thumbnail }], display, [display], 'linux')).toThrow('could not be matched');
  expect(() => selectScreenSource([{ ...exact, thumbnail: { isEmpty: () => true } }], display)).toThrow('capture is empty');
});

for (const platform of ['linux', 'darwin', 'win32']) {
  test(`snipping anchors the overlay before showing it on ${platform}`, async () => {
    const f = fixture(platform);
    const result = f.handler('region');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const overlay = f.windows[0];
    const fullscreen = platform === 'linux';
    expect(overlay.options).toMatchObject({
      x: -100, y: 0, width: fullscreen ? 50 : 100, height: fullscreen ? 25 : 50,
      show: false, frame: false, fullscreenable: fullscreen, resizable: fullscreen,
    });
    expect(overlay.fullscreenAtShow).toBe(fullscreen);
    f.owner.emit('closed');
    expect(await result).toBeNull();
  });
}
