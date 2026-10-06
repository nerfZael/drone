const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  CONFINE_CHANNEL,
  ENDED_CHANNEL,
  RELEASE_CHANNEL,
  cursorConfinementSupported,
  installCursorConfinement,
  pageRectToScreen,
} = require('../../desktop/hub-electron-cursor-confine.cjs');

function fakeWindow({ content = { x: 100, y: 50, width: 1200, height: 800 }, zoom = 1 } = {}) {
  const window = new EventEmitter();
  const webContents = new EventEmitter();
  webContents.sent = [];
  webContents.send = (channel) => webContents.sent.push(channel);
  webContents.getZoomFactor = () => zoom;
  Object.assign(window, {
    webContents,
    focused: true,
    destroyed: false,
    getContentBounds: () => content,
    isFocused: () => window.focused,
    isDestroyed: () => window.destroyed,
  });
  return window;
}

function setup({ supported = true, result = { ok: true } } = {}) {
  const handlers = new Map();
  const calls = [];
  const confiner = {
    confine: async (rect) => { calls.push(['confine', rect]); return result; },
    release: async () => { calls.push(['release']); return { ok: true }; },
    close: () => calls.push(['close']),
  };
  const window = fakeWindow();
  const screen = { getDisplayMatching: () => ({ scaleFactor: 1 }) };
  const BrowserWindow = { fromWebContents: (contents) => (contents === window.webContents ? window : null) };
  const installed = installCursorConfinement({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    BrowserWindow, screen, confiner, supported,
  });
  const invoke = (channel, ...args) => handlers.get(channel)({ sender: window.webContents }, ...args);
  return { calls, window, invoke, installed };
}

test('confinement is offered on X11 only', () => {
  assert.equal(cursorConfinementSupported('linux', { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' }), true);
  assert.equal(cursorConfinementSupported('linux', { DISPLAY: ':0', XDG_SESSION_TYPE: 'wayland' }), false);
  assert.equal(cursorConfinementSupported('linux', { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }), false);
  assert.equal(cursorConfinementSupported('darwin', { DISPLAY: ':0' }), false);
});

test('a page rectangle becomes screen pixels, rounded inwards and scaled with the page zoom and display', () => {
  const window = fakeWindow({ content: { x: 100, y: 50, width: 1200, height: 800 }, zoom: 1.25 });
  const scaled = { getDisplayMatching: () => ({ scaleFactor: 2 }) };
  assert.deepEqual(pageRectToScreen(window, { x: 10.3, y: 20.5, width: 300.2, height: 200 }, scaled), {
    // Left 112.875 DIP -> 225.75 px -> 226; right (112.875 + 375.25) * 2 = 976.25 -> 976.
    // Top 75.625 DIP -> 151.25 px -> 152; bottom (75.625 + 250) * 2 = 651.25 -> 651.
    x: 226, y: 152, width: 750, height: 499,
  });
  const native = { dipToScreenRect: (_window, rect) => ({ ...rect, x: rect.x + 0.5 }) };
  assert.deepEqual(pageRectToScreen(fakeWindow(), { x: 0, y: 0, width: 100, height: 100 }, native), {
    x: 101, y: 50, width: 99, height: 100,
  });
});

test('the hold ends, and the page is told, when the window loses focus, moves, resizes, hides or reloads', async () => {
  for (const [source, event] of [['window', 'blur'], ['window', 'move'], ['window', 'resize'], ['window', 'hide'],
    ['window', 'minimize'], ['window', 'closed'], ['webContents', 'did-start-navigation'], ['webContents', 'render-process-gone']]) {
    const { calls, window, invoke } = setup();
    assert.deepEqual(await invoke(CONFINE_CHANNEL, { x: 0, y: 0, width: 400, height: 300 }), { ok: true });
    assert.deepEqual(calls, [['confine', { x: 100, y: 50, width: 400, height: 300 }]]);
    (source === 'window' ? window : window.webContents).emit(event);
    assert.deepEqual(calls.at(-1), ['release'], event);
    assert.deepEqual(window.webContents.sent, [ENDED_CHANNEL], event);
    // Once ended, a later event does nothing more.
    window.emit('blur');
    assert.equal(calls.length, 2, event);
  }
});

test('a new rectangle for the same window keeps its hold; release from the page ends it quietly', async () => {
  const { calls, window, invoke } = setup();
  await invoke(CONFINE_CHANNEL, { x: 0, y: 0, width: 400, height: 300 });
  await invoke(CONFINE_CHANNEL, { x: 0, y: 0, width: 500, height: 300 });
  assert.deepEqual(calls.map(([name]) => name), ['confine', 'confine']);
  assert.deepEqual(window.webContents.sent, []);
  await invoke(RELEASE_CHANNEL);
  assert.deepEqual(calls.at(-1), ['release']);
  assert.deepEqual(window.webContents.sent, []);
  window.emit('blur');
  assert.equal(calls.length, 3);
});

test('it refuses where it cannot hold the cursor safely', async () => {
  assert.deepEqual(await setup({ supported: false }).invoke(CONFINE_CHANNEL, { x: 0, y: 0, width: 400, height: 300 }),
    { ok: false, unsupported: true });
  const unfocused = setup();
  unfocused.window.focused = false;
  assert.deepEqual(await unfocused.invoke(CONFINE_CHANNEL, { x: 0, y: 0, width: 400, height: 300 }), { ok: false });
  assert.deepEqual(unfocused.calls, []);
  const bad = setup();
  assert.deepEqual(await bad.invoke(CONFINE_CHANNEL, { x: 0, y: 0, width: Number.NaN, height: 300 }), { ok: false });
  const refused = setup({ result: { ok: false, error: 'no barriers' } });
  assert.deepEqual(await refused.invoke(CONFINE_CHANNEL, { x: 0, y: 0, width: 400, height: 300 }), { ok: false, error: 'no barriers' });
});

test('quitting releases and stops the helper', async () => {
  const { calls, invoke, installed } = setup();
  await invoke(CONFINE_CHANNEL, { x: 0, y: 0, width: 400, height: 300 });
  installed.close();
  assert.deepEqual(calls.slice(1), [['release'], ['close']]);
});
