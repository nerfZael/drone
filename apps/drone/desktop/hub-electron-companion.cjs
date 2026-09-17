const fs = require('node:fs');
const WINDOW_NAME = 'drone-hub-companion';
const CONTROL_CHANNEL = 'drone-hub:companion-window';
const CLOSE_CHANNEL = 'drone-hub:companion-window-close';

// A same-origin blank window lets React move its existing portal without starting
// a second Companion controller, microphone, or websocket connection.
function installCompanionWindow({ owner, ipcMain, shell, screen, isQuitting, openOtherWindow, positionPath }) {
  let floating = null;
  let saveTimer;
  const savePosition = () => {
    clearTimeout(saveTimer);
    if (!positionPath || !floating || floating.isDestroyed()) return;
    const bounds = floating.getBounds();
    try { fs.writeFileSync(positionPath, JSON.stringify({ right: bounds.x + bounds.width, bottom: bounds.y + bounds.height }), { mode: 0o600 }); } catch {}
  };
  const position = (area, width, height, saved) => ({
    x: Math.max(area.x + 16, Math.min((saved?.right ?? area.x + area.width - 16) - width, area.x + area.width - width - 16)),
    y: Math.max(area.y + 16, Math.min((saved?.bottom ?? area.y + area.height - 16) - height, area.y + area.height - height - 16)),
  });
  const destroy = () => {
    savePosition();
    const child = floating;
    floating = null;
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
    let saved;
    try {
      const value = JSON.parse(fs.readFileSync(positionPath, 'utf8'));
      if (Number.isFinite(value.right) && Number.isFinite(value.bottom)) saved = value;
    } catch {}
    const area = saved ? screen.getDisplayMatching({ x: Math.round(saved.right - 1), y: Math.round(saved.bottom - 1), width: 1, height: 1 }).workArea
      : screen.getPrimaryDisplay().workArea;
    const width = Math.min(464, area.width - 32);
    const height = Math.min(64, area.height - 32);
    return {
      action: 'allow',
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        title: 'Companion — Drone Hub',
        ...position(area, width, height, saved),
        width, height,
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
      saveTimer = setTimeout(savePosition, 200);
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
  });
  const control = (event, action, size) => {
    if (owner.isDestroyed() || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) return;
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
      const area = screen.getDisplayMatching(bounds).workArea;
      const height = Math.min(Math.max(48, Math.ceil(size.height)), Math.max(48, area.height - 32));
      const width = Math.min(464, area.width - 32);
      const x = Math.max(area.x + 16, Math.min(bounds.x + bounds.width - width, area.x + area.width - width - 16));
      const y = Math.max(area.y + 16, Math.min(bounds.y + bounds.height - height, area.y + area.height - height - 16));
      // Keep the bottom-right corner stable as replies and menus grow upward.
      // After a drag, preserve the user's chosen corner on that display.
      if (bounds.width !== width || bounds.height !== height || bounds.x !== x || bounds.y !== y) {
        floating.setBounds({ x, y, width, height });
      }
    }
    else if (action === 'show') floating.show();
    else if (action === 'hide') {
      floating.hide();
      const bounds = floating.getBounds();
      const area = screen.getPrimaryDisplay().workArea;
      floating.setBounds({ ...bounds, ...position(area, bounds.width, bounds.height) });
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

module.exports = { installCompanionWindow };
