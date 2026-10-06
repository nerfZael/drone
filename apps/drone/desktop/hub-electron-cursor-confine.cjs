const { spawn } = require('node:child_process');
const path = require('node:path');
const { createInterface } = require('node:readline');

const CONFINE_CHANNEL = 'drone-hub:cursor-confine';
const RELEASE_CHANNEL = 'drone-hub:cursor-release';
const ENDED_CHANNEL = 'drone-hub:cursor-confine-ended';

/** Whether the real cursor can be held in place here: X11 pointer barriers. Wayland and other systems cannot. */
function cursorConfinementSupported(platform = process.platform, env = process.env) {
  return platform === 'linux' && env.XDG_SESSION_TYPE !== 'wayland' && !env.WAYLAND_DISPLAY && Boolean(env.DISPLAY);
}

/**
 * The X11 helper that holds the cursor in a screen rectangle. Started on first use and kept for the session;
 * requests are answered in order. If it stops, the X server removes its walls, so nothing stays confined.
 */
function createCursorConfiner({ spawnHelper = spawn } = {}) {
  let helper = null;

  const start = () => {
    const child = spawnHelper('python3', ['-u', path.join(__dirname, 'hub-x11-cursor-confine.py')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const waiting = [];
    let details = '';
    let failed = null;
    const fail = (error) => {
      if (failed) return;
      failed = error;
      if (helper?.child === child) helper = null;
      for (const settle of waiting.splice(0)) settle({ ok: false, error: error.message });
    };
    child.stderr.on('data', (chunk) => { details = (details + chunk).slice(-2000); });
    child.once('error', fail);
    child.stdin.on('error', fail);
    child.once('exit', () => fail(new Error(details.trim() || 'The cursor confinement helper stopped.')));
    const lines = createInterface({ input: child.stdout });
    let ready = false;
    lines.on('line', (line) => {
      let reply;
      try { reply = JSON.parse(line); } catch { return; }
      if (!ready && reply.ready) { ready = true; return; }
      waiting.shift()?.(reply);
    });
    const request = (command) => new Promise((resolve) => {
      if (failed) { resolve({ ok: false, error: failed.message }); return; }
      waiting.push(resolve);
      child.stdin.write(`${JSON.stringify(command)}\n`);
    });
    return { child, request };
  };

  return {
    confine(rect) {
      helper ??= start();
      return helper.request({ confine: rect });
    },
    release() {
      return helper ? helper.request({ release: true }) : Promise.resolve({ ok: true });
    },
    close() {
      const current = helper;
      helper = null;
      current?.child.stdin.end();
    },
  };
}

/**
 * A rectangle of the page, in CSS pixels from its top left, as a rectangle of the screen in X11 pixels.
 * Rounded inwards, so the cursor cannot stop on a pixel outside the area.
 */
function pageRectToScreen(window, rect, screen) {
  const content = window.getContentBounds();
  const zoom = window.webContents.getZoomFactor?.() ?? 1;
  const dip = {
    x: content.x + rect.x * zoom,
    y: content.y + rect.y * zoom,
    width: rect.width * zoom,
    height: rect.height * zoom,
  };
  const scale = typeof screen.dipToScreenRect === 'function' ? null : screen.getDisplayMatching(content).scaleFactor;
  const physical = scale === null
    ? screen.dipToScreenRect(window, dip)
    : { x: dip.x * scale, y: dip.y * scale, width: dip.width * scale, height: dip.height * scale };
  const left = Math.ceil(physical.x);
  const top = Math.ceil(physical.y);
  return {
    x: left,
    y: top,
    width: Math.floor(physical.x + physical.width) - left,
    height: Math.floor(physical.y + physical.height) - top,
  };
}

function isPageRect(rect) {
  return Boolean(rect) && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key])) &&
    rect.width >= 2 && rect.height >= 2;
}

/**
 * Lets a Hub window hold the real cursor inside part of itself (the canvas, for edge panning). The hold ends as soon
 * as the window loses focus, moves, resizes, hides or reloads, and the page is told, so the cursor is never left
 * trapped behind another window or in a stale rectangle.
 */
function installCursorConfinement({ ipcMain, BrowserWindow, screen, confiner = createCursorConfiner(), supported = cursorConfinementSupported() }) {
  let held = null;

  const end = (notify) => {
    const current = held;
    if (!current) return;
    held = null;
    current.detach();
    void confiner.release();
    if (notify && !current.window.isDestroyed()) current.window.webContents.send(ENDED_CHANNEL);
  };

  const hold = (window) => {
    const onLost = () => end(true);
    const windowEvents = ['blur', 'move', 'resize', 'minimize', 'hide', 'leave-full-screen', 'enter-full-screen', 'closed'];
    const pageEvents = ['render-process-gone', 'did-start-navigation', 'destroyed'];
    for (const name of windowEvents) window.on(name, onLost);
    for (const name of pageEvents) window.webContents.on(name, onLost);
    return {
      window,
      detach() {
        for (const name of windowEvents) window.removeListener(name, onLost);
        if (!window.isDestroyed()) for (const name of pageEvents) window.webContents.removeListener(name, onLost);
      },
    };
  };

  ipcMain.handle(CONFINE_CHANNEL, async (event, rect) => {
    if (!supported) return { ok: false, unsupported: true };
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed() || !window.isFocused() || !isPageRect(rect)) return { ok: false };
    const result = await confiner.confine(pageRectToScreen(window, rect, screen));
    if (!result?.ok) {
      end(false);
      return { ok: false, error: result?.error };
    }
    // A new rectangle for the same window (the canvas resized, a menu opened) keeps the hold it has.
    if (held?.window !== window) {
      end(true);
      held = hold(window);
    }
    // The window may have lost focus while the helper answered.
    if (!window.isFocused()) {
      end(true);
      return { ok: false };
    }
    return { ok: true };
  });
  ipcMain.handle(RELEASE_CHANNEL, (event) => {
    if (held && BrowserWindow.fromWebContents(event.sender) === held.window) end(false);
    return true;
  });

  return {
    close() {
      end(false);
      confiner.close();
    },
  };
}

module.exports = {
  CONFINE_CHANNEL,
  ENDED_CHANNEL,
  RELEASE_CHANNEL,
  createCursorConfiner,
  cursorConfinementSupported,
  installCursorConfinement,
  pageRectToScreen,
};
