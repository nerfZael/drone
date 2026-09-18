const fs = require('node:fs');
const WINDOW_NAME = 'drone-hub-companion';
const CONTROL_CHANNEL = 'drone-hub:companion-window';
const CLOSE_CHANNEL = 'drone-hub:companion-window-close';
const PLACEMENT_CHANNEL = 'drone-hub:companion-window-placement';
const CLIPBOARD_CHANNEL = 'drone-hub:clipboard-write-text';
const MARGIN = 16;
const MIN_HEIGHT = 48;
const MAX_WIDTH = 464;
const INITIAL_HEIGHT = 64;
// Matches the overlay's header row and its distance from the window edge (panel padding plus border).
const DEFAULT_BAR = { height: 40, inset: 9 };

const clamp = (value, low, high) => Math.max(low, Math.min(value, high));

// A same-origin blank window lets React move its existing portal without starting
// a second Companion controller, microphone, or websocket connection.
//
// The bar (Companion's header row) is the window's fixed point. Replies, proposals
// and menus flow away from it into whichever half of the work area has more room,
// so the bar itself never moves or resizes as content comes and goes.
function installCompanionWindow({ owner, ipcMain, shell, screen, isQuitting, openOtherWindow, positionPath }) {
  let floating = null;
  let saveTimer;
  // What the renderer currently lays out: the direction content flows and where the
  // bar sits relative to the window edge it is docked to. Bounds are only meaningful
  // together with the layout they were computed for.
  let layout = { flow: 'up', bar: DEFAULT_BAR };
  let placement = null;

  const width = (area) => Math.min(MAX_WIDTH, area.width - 2 * MARGIN);
  // Screen-space bar rectangle: right edge plus top and bottom.
  const anchorOf = (bounds, { flow, bar }) => {
    const bottom = flow === 'up' ? bounds.y + bounds.height - bar.inset : bounds.y + bar.inset + bar.height;
    return { right: bounds.x + bounds.width, top: bottom - bar.height, bottom };
  };
  const cornerAnchor = (area, bar) => {
    const bottom = area.y + area.height - MARGIN - bar.inset;
    return { right: area.x + area.width - MARGIN, top: bottom - bar.height, bottom };
  };
  const flowFor = (area, anchor) => (anchor.top + anchor.bottom) / 2 - area.y > area.height / 2 ? 'up' : 'down';
  // Tallest window that keeps the bar in place and the window inside the work area.
  const roomFor = (area, anchor, flow, inset) => {
    const room = flow === 'up' ? anchor.bottom + inset - (area.y + MARGIN) : area.y + area.height - MARGIN - (anchor.top - inset);
    return clamp(Math.floor(room), MIN_HEIGHT, Math.max(MIN_HEIGHT, area.height - 2 * MARGIN));
  };
  const boundsFor = (area, anchor, requestedHeight, { flow, bar }) => {
    const w = width(area);
    const height = clamp(Math.ceil(requestedHeight), MIN_HEIGHT, roomFor(area, anchor, flow, bar.inset));
    const y = flow === 'up' ? anchor.bottom + bar.inset - height : anchor.top - bar.inset;
    return {
      x: clamp(Math.round(anchor.right - w), area.x + MARGIN, area.x + area.width - w - MARGIN),
      y: clamp(Math.round(y), area.y + MARGIN, area.y + area.height - height - MARGIN),
      width: w, height,
    };
  };
  const area = () => screen.getDisplayMatching(floating.getBounds()).workArea;
  const currentAnchor = () => anchorOf(floating.getBounds(), layout);

  const savePosition = () => {
    clearTimeout(saveTimer);
    if (!positionPath || !floating || floating.isDestroyed()) return;
    try { fs.writeFileSync(positionPath, JSON.stringify(currentAnchor()), { mode: 0o600 }); } catch {}
  };
  const loadPosition = () => {
    try {
      const value = JSON.parse(fs.readFileSync(positionPath, 'utf8'));
      if (!Number.isFinite(value.right) || !Number.isFinite(value.bottom)) return undefined;
      const top = Number.isFinite(value.top) && value.top < value.bottom ? value.top : value.bottom - DEFAULT_BAR.height;
      return { right: value.right, top, bottom: value.bottom };
    } catch { return undefined; }
  };
  // Tell the renderer which way to lay out content and how tall it may grow.
  const publishPlacement = (force = false) => {
    if (!floating || floating.isDestroyed() || owner.isDestroyed()) return;
    const workArea = area();
    const anchor = currentAnchor();
    const flow = flowFor(workArea, anchor);
    const next = { flow, maxHeight: roomFor(workArea, anchor, flow, layout.bar.inset) };
    if (!force && placement && placement.flow === next.flow && placement.maxHeight === next.maxHeight) return;
    placement = next;
    owner.webContents.send(PLACEMENT_CHANNEL, next);
  };
  const destroy = () => {
    savePosition();
    const child = floating;
    floating = null;
    placement = null;
    layout = { flow: 'up', bar: DEFAULT_BAR };
    if (child && !child.isDestroyed()) child.destroy();
  };
  const external = (url) => {
    if (url !== 'about:blank') void shell.openExternal(url).catch(() => {});
  };
  owner.webContents.setWindowOpenHandler((details) => {
    const { url, frameName } = details;
    if (url !== 'about:blank' || frameName !== WINDOW_NAME) {
      if (openOtherWindow) return openOtherWindow(details);
      external(url);
      return { action: 'deny' };
    }
    if (floating && !floating.isDestroyed()) return { action: 'deny' };
    const saved = loadPosition();
    const workArea = saved ? screen.getDisplayMatching({ x: Math.round(saved.right - 1), y: Math.round(saved.bottom - 1), width: 1, height: 1 }).workArea
      : screen.getPrimaryDisplay().workArea;
    // The renderer starts with content flowing up; the first placement message may flip it.
    const bounds = boundsFor(workArea, saved ?? cornerAnchor(workArea, layout.bar), INITIAL_HEIGHT, layout);
    return {
      action: 'allow',
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        title: 'Companion — Drone Hub',
        ...bounds,
        show: false, frame: false, titleBarStyle: 'default', titleBarOverlay: false, alwaysOnTop: true,
        transparent: true, backgroundColor: '#00000000', hasShadow: false,
        resizable: false, minimizable: false, maximizable: false, skipTaskbar: true,
        fullscreenable: false, autoHideMenuBar: true,
      },
    };
  });
  owner.webContents.on('did-create-window', (child, { frameName }) => {
    if (frameName !== WINDOW_NAME) return;
    floating = child;
    child.setMenu(null);
    child.on('move', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (floating !== child || child.isDestroyed()) return;
        savePosition();
        // A drag may have carried the bar into the other half of the screen.
        publishPlacement();
      }, 200);
    });
    child.on('close', (event) => {
      if (isQuitting() || owner.isDestroyed()) { savePosition(); return; }
      // The renderer must rescue the DOM before the child document is destroyed.
      event.preventDefault();
      owner.webContents.send(CLOSE_CHANNEL);
    });
    child.on('closed', () => { if (floating === child) floating = null; });
    child.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
    child.webContents.on('will-navigate', (event, url) => { event.preventDefault(); external(url); });
    child.webContents.on('will-frame-navigate', (event) => event.preventDefault());
    publishPlacement(true);
  });
  const layoutFrom = (size) => ({
    flow: size.flow === 'down' ? 'down' : 'up',
    bar: {
      height: Number.isFinite(size.bar?.height) && size.bar.height > 0 ? Math.round(size.bar.height) : DEFAULT_BAR.height,
      inset: Number.isFinite(size.bar?.inset) && size.bar.inset >= 0 ? Math.round(size.bar.inset) : DEFAULT_BAR.inset,
    },
  });
  const control = (event, action, size) => {
    if (owner.isDestroyed() || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) return;
    // Something the floating Companion pointed at opens in the main window.
    if (action === 'focus-owner') {
      if (owner.isMinimized()) owner.restore();
      owner.show();
      owner.focus();
      return;
    }
    if (!floating || floating.isDestroyed()) return;
    if (action === 'close' || action === 'attach') {
      destroy();
      if (action === 'attach') {
        if (owner.isMinimized()) owner.restore();
        owner.show();
      }
    }
    else if (action === 'resize' && Number.isFinite(size?.height)) {
      const bounds = floating.getBounds();
      // Read the bar from the bounds the user may just have dragged, under the layout
      // those bounds were made for, then re-derive the window for the reported layout.
      const anchor = anchorOf(bounds, layout);
      layout = layoutFrom(size);
      const next = boundsFor(area(), anchor, size.height, layout);
      if (bounds.width !== next.width || bounds.height !== next.height || bounds.x !== next.x || bounds.y !== next.y) {
        floating.setBounds(next);
      }
      publishPlacement();
    }
    else if (action === 'show') {
      floating.show();
      // The renderer may have subscribed after the window was created.
      publishPlacement(true);
    }
    else if (action === 'hide') {
      // The bar stays where the user left it for the next session.
      floating.hide();
      savePosition();
    }
  };
  ipcMain.on(CONTROL_CHANNEL, control);
  owner.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) destroy();
  });
  owner.on('closed', () => {
    ipcMain.removeListener(CONTROL_CHANNEL, control);
    destroy();
  });
}

// Companion usually floats over another application, and the web clipboard API refuses a document
// that is not focused. Writing is all the renderer may do; the clipboard is never read.
function installCompanionClipboard({ owner, ipcMain, clipboard }) {
  ipcMain.removeHandler(CLIPBOARD_CHANNEL);
  ipcMain.handle(CLIPBOARD_CHANNEL, (event, text) => {
    if (owner.isDestroyed() || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) throw new Error('Clipboard is only available to Drone Hub.');
    if (typeof text !== 'string' || !text || text.length > 100_000) throw new Error('Invalid clipboard text.');
    clipboard.writeText(text);
    return true;
  });
  owner.once('closed', () => ipcMain.removeHandler(CLIPBOARD_CHANNEL));
}

module.exports = { installCompanionWindow, installCompanionClipboard };
