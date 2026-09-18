import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
const { cropRectangle, cropSelection, placeSelection, unionBounds, selectScreenSource, installSnipping } = require('../desktop/hub-electron-snipping.cjs');

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

function fixture(platform = 'linux', x11 = platform === 'linux', second = false) {
  const ipc = Object.assign(new EventEmitter(), {
    handle: (_channel: string, fn: any) => { handler = fn; }, removeHandler: () => {},
  });
  let handler: any;
  const image = { isEmpty: () => false, toPNG: () => Buffer.from('png'), toDataURL: () => 'data:image/png;base64,cG5n', getSize: () => ({ width: 200, height: 100 }), crop: (rect: any) => { crops.push(rect); return image; } };
  const crops: any[] = [];
  const windows: Overlay[] = [];
  class Overlay extends EventEmitter {
    sent: any[] = [];
    webContents = Object.assign(new EventEmitter(), { mainFrame: {}, setWindowOpenHandler: () => {}, send: (...args: any[]) => { this.sent.push(args); } });
    destroyed = false;
    visible = false;
    shows = 0;
    fullscreen = false;
    fullscreenAtShow = false;
    bounds: any;
    boundsAtShow: any;
    constructor(public options: any) { super(); windows.push(this); this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    async loadFile() {}
    setBounds(bounds: any) { this.bounds = bounds; } setAlwaysOnTop() {} focus() {}
    setFullScreen(value: boolean) { this.fullscreen = value; }
    show() { this.visible = true; this.shows++; this.fullscreenAtShow = this.fullscreen; this.boundsAtShow = this.bounds; }
    hide() { this.visible = false; }
  }
  const owner = Object.assign(new EventEmitter(), { webContents: { mainFrame: {} }, isDestroyed: () => false });
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };
  const sources: any[] = [];
  const display = { id: 42, scaleFactor: 2, bounds: { x: -100, y: 0, width: 100, height: 50 } };
  // An optional smaller monitor to the right of the one under the cursor.
  const displays = second ? [display, { id: 7, scaleFactor: 1, bounds: { x: 0, y: 0, width: 80, height: 40 } }] : [display];
  const selectionPath = join(mkdtempSync(join(tmpdir(), 'snip-')), 'selection.json');
  installSnipping({ owner, ipcMain: ipc, BrowserWindow: Overlay, platform, x11, selectionPath, getCursorPoint: (screen: any) => screen.getCursorScreenPoint(),
    screen: { getAllDisplays: () => displays, getPrimaryDisplay: () => display, getCursorScreenPoint: () => ({ x: -10, y: 10 }), getDisplayNearestPoint: () => display },
    desktopCapturer: { getSources: async (input: any) => { sources.push(input); return displays.map(item => ({ display_id: String(item.id), thumbnail: image })); } },
  });
  // The overlay page answers a start message once its frozen frame is decoded.
  const fromOverlay = () => ({ sender: windows[0].webContents, senderFrame: windows[0].webContents.mainFrame });
  const open = async () => {
    const result = handler(event, 'region');
    for (let i = 0; i < 8; i++) await Promise.resolve();
    ipc.emit('drone-hub:snip-ready', fromOverlay());
    return { result: result as Promise<any> };
  };
  const select = (value: any) => ipc.emit('drone-hub:snip-selection', fromOverlay(), value);
  return { handler: (mode: string, sender = event) => handler(sender, mode), open, select, windows, ipc, owner, crops, sources, selectionPath };
}

test('immediate capture never shows the prewarmed overlay and rejects untrusted frames', async () => {
  const f = fixture();
  await expect(f.handler('screen')).resolves.toMatchObject({ mime: 'image/png', size: 3, dataBase64: 'cG5n' });
  expect(f.sources[0].thumbnailSize).toEqual({ width: 200, height: 100 });
  expect(f.windows).toHaveLength(1);
  expect(f.windows[0].options.show).toBe(false);
  expect(f.windows[0].shows).toBe(0);
  await expect(f.handler('screen', { sender: f.owner.webContents, senderFrame: {} })).rejects.toThrow('only available');
});

test('snipping freezes first, waits for the frame, ignores foreign selection, suppresses repeats and hides after cancel', async () => {
  const f = fixture();
  const result = f.handler('region');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const overlay = f.windows[0];
  expect(overlay.sent[0]).toEqual(['drone-hub:snip-start', { image: 'data:image/png;base64,cG5n', selection: null, size: { width: 100, height: 50 },
    displays: [{ id: '42', x: 0, y: 0, width: 100, height: 50 }], active: '42' }]);
  expect(overlay.visible).toBe(false);
  f.ipc.emit('drone-hub:snip-ready', { sender: {}, senderFrame: {} });
  expect(overlay.visible).toBe(false);
  f.ipc.emit('drone-hub:snip-ready', { sender: overlay.webContents, senderFrame: overlay.webContents.mainFrame });
  expect(overlay.visible).toBe(true);
  expect(await f.handler('region')).toBeNull();
  f.ipc.emit('drone-hub:snip-selection', { sender: {}, senderFrame: {} }, 'screen');
  expect(overlay.visible).toBe(true);
  f.select(null);
  expect(await result).toBeNull();
  expect(overlay.visible).toBe(false);
  expect(overlay.destroyed).toBe(false);
  expect(overlay.sent.at(-1)).toEqual(['drone-hub:snip-reset']);
  expect(f.ipc.listenerCount('drone-hub:snip-selection')).toBe(0);
  expect(f.ipc.listenerCount('drone-hub:snip-ready')).toBe(0);
  expect(await f.handler('screen')).not.toBeNull();
});

test('region selection crops captured pixels, is remembered, and the overlay is reused until the owner closes', async () => {
  const f = fixture();
  const { result } = await f.open();
  f.select({ x: 5, y: 10, width: 20, height: 15 });
  expect(await result).not.toBeNull();
  expect(f.crops).toEqual([{ x: 10, y: 20, width: 40, height: 30 }]);
  // Remembered in screen coordinates, handed back relative to the overlay.
  expect(JSON.parse(readFileSync(f.selectionPath, 'utf8'))).toEqual({ x: -95, y: 10, width: 20, height: 15 });
  const { result: cancelled } = await f.open();
  expect(f.windows).toHaveLength(1);
  expect(f.windows[0].shows).toBe(2);
  expect(f.windows[0].sent.find((message: any[], index: number) => index > 1 && message[0] === 'drone-hub:snip-start')[1].selection).toEqual({ x: 5, y: 10, width: 20, height: 15 });
  f.owner.emit('closed');
  expect(await cancelled).toBeNull();
  expect(f.windows[0].destroyed).toBe(true);
});

test('a full-screen capture from the overlay keeps the remembered selection and a lost overlay is rebuilt', async () => {
  const f = fixture();
  const { result } = await f.open();
  f.select({ screen: '42' });
  expect(await result).not.toBeNull();
  expect(f.crops).toEqual([]);
  expect(existsSync(f.selectionPath)).toBe(false);
  const { result: lost } = await f.open();
  f.windows[0].destroy();
  expect(await lost).toBeNull();
  const again = f.handler('region');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(f.windows).toHaveLength(2);
  f.ipc.emit('drone-hub:snip-ready', { sender: f.windows[1].webContents, senderFrame: f.windows[1].webContents.mainFrame });
  expect(f.windows[1].visible).toBe(true);
  f.owner.emit('closed');
  expect(await again).toBeNull();
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

for (const [platform, x11] of [['linux', true], ['linux', false], ['darwin', false], ['win32', false]] as const) {
  test(`snipping covers the target display before showing the overlay on ${platform}${platform === 'linux' ? (x11 ? ' X11' : ' Wayland') : ''}`, async () => {
    const f = fixture(platform, x11);
    const { result } = await f.open();
    const overlay = f.windows[0];
    const fullscreen = platform === 'linux' && !x11;
    expect(overlay.options).toMatchObject({
      x: -100, y: 0, width: fullscreen ? 50 : 100, height: fullscreen ? 25 : 50,
      show: false, frame: false, transparent: true, fullscreenable: fullscreen, resizable: fullscreen,
    });
    // A dock window is neither placed nor animated by an X11 window manager.
    expect(overlay.options.type).toBe(x11 ? 'dock' : undefined);
    expect(overlay.fullscreenAtShow).toBe(fullscreen);
    if (!fullscreen) expect(overlay.boundsAtShow).toEqual({ x: -100, y: 0, width: 100, height: 50 });
    f.owner.emit('closed');
    expect(await result).toBeNull();
  });
}

test('on X11 one overlay covers every display, freezes the others after it is shown, and captures any picked screen', async () => {
  const f = fixture('linux', true, true);
  const result = f.handler('region');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const overlay = f.windows[0];
  // Each distinct pixel size is requested exactly, so no display's frame is rescaled.
  expect(f.sources.map(input => input.thumbnailSize)).toEqual([{ width: 200, height: 100 }, { width: 80, height: 40 }]);
  expect(overlay.sent[0][1]).toMatchObject({ size: { width: 180, height: 50 }, active: '42',
    displays: [{ id: '42', x: 0, y: 0, width: 100, height: 50 }, { id: '7', x: 100, y: 0, width: 80, height: 40 }] });
  expect(overlay.sent.some((message: any[]) => message[0] === 'drone-hub:snip-image')).toBe(false);
  f.ipc.emit('drone-hub:snip-ready', { sender: overlay.webContents, senderFrame: overlay.webContents.mainFrame });
  expect(overlay.boundsAtShow).toEqual({ x: -100, y: 0, width: 180, height: 50 });
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(overlay.sent.filter((message: any[]) => message[0] === 'drone-hub:snip-image').map((message: any[]) => message[1].id)).toEqual(['7']);
  // A rectangle on the second monitor is cropped from that monitor's frame, in its own pixels.
  f.select({ x: 110, y: 5, width: 20, height: 10 });
  expect(await result).not.toBeNull();
  expect(f.crops).toEqual([{ x: 25, y: 12, width: 50, height: 26 }]);
  const { result: picked } = await f.open();
  f.select({ screen: '7' });
  expect(await picked).not.toBeNull();
  f.owner.emit('closed');
});

test('a selection across monitors is stitched at the sharpest scale with gaps left transparent', () => {
  const solid = (width: number, height: number, value: number): any => ({
    getSize: () => ({ width, height }),
    crop: (rect: any) => solid(rect.width, rect.height, value),
    resize: (size: any) => solid(size.width, size.height, value),
    toBitmap: () => Buffer.alloc(width * height * 4, value),
  });
  const created: any[] = [];
  const nativeImage = { createFromBitmap: (pixels: Buffer, size: any) => { created.push({ pixels, size }); return 'stitched'; } };
  const parts = [
    { id: 1, bounds: { x: 0, y: 0, width: 10, height: 10 }, image: solid(20, 20, 1) },   // 2x
    { id: 2, bounds: { x: 10, y: 0, width: 10, height: 5 }, image: solid(10, 5, 2) },    // 1x and shorter
  ];
  expect(cropSelection({ x: 8, y: 2, width: 4, height: 6 }, parts, nativeImage)).toBe('stitched');
  const { pixels, size } = created[0];
  expect(size).toEqual({ width: 8, height: 12 });
  const at = (x: number, y: number) => pixels[(y * size.width + x) * 4];
  expect([at(0, 0), at(3, 11), at(4, 0), at(7, 5), at(4, 6), at(7, 11)]).toEqual([1, 1, 2, 2, 0, 0]);
  // Inside one monitor it stays a plain crop, and outside every monitor there is nothing to capture.
  expect(cropSelection({ x: 1, y: 1, width: 2, height: 2 }, parts, nativeImage).getSize()).toEqual({ width: 4, height: 4 });
  expect(() => cropSelection({ x: 50, y: 50, width: 5, height: 5 }, parts, nativeImage)).toThrow('non-empty');
  expect(() => cropSelection({ x: NaN, y: 0, width: 1, height: 1 }, parts, nativeImage)).toThrow('Invalid');
});

test('the remembered rectangle follows the user to the display where the snip starts', () => {
  const left = { id: 1, bounds: { x: 0, y: 0, width: 100, height: 100 } };
  const right = { id: 2, bounds: { x: 100, y: 0, width: 50, height: 40 } };
  expect(unionBounds([left, right])).toEqual({ x: 0, y: 0, width: 150, height: 100 });
  const saved = { x: 60, y: 70, width: 30, height: 20 };
  expect(placeSelection(saved, [left, right], left)).toBe(saved);
  // Same offset on the other display, pulled inside its smaller bounds.
  expect(placeSelection(saved, [left, right], right)).toEqual({ x: 120, y: 20, width: 30, height: 20 });
  expect(placeSelection({ x: 900, y: 900, width: 10, height: 10 }, [left, right], left)).toBeNull();
  expect(placeSelection({ x: NaN }, [left, right], left)).toBeNull();
});
