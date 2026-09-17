const WINDOW_NAME = 'drone-hub-companion';
const CONTROL_CHANNEL = 'drone-hub:companion-window';
const CLOSE_CHANNEL = 'drone-hub:companion-window-close';

// A same-origin blank window lets React move its existing portal without starting
// a second Companion controller, microphone, or websocket connection.
function installCompanionWindow({ owner, ipcMain, shell, isQuitting, openOtherWindow }) {
  let floating = null;
  const destroy = () => {
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
    return {
      action: 'allow',
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        title: 'Companion — Drone Hub',
        width: 520, height: 680, minWidth: 380, minHeight: 300,
        show: false, frame: true, titleBarStyle: 'default', titleBarOverlay: false, alwaysOnTop: true,
        fullscreenable: false, autoHideMenuBar: true,
        backgroundColor: '#11161e',
      },
    };
  });
  owner.webContents.on('did-create-window', (child, { frameName }) => {
    if (frameName !== WINDOW_NAME) return;
    floating = child;
    child.setMenu(null);
    child.on('close', (event) => {
      if (isQuitting() || owner.isDestroyed()) return;
      // The renderer must rescue the DOM before the child document is destroyed.
      event.preventDefault();
      owner.webContents.send(CLOSE_CHANNEL);
    });
    child.on('closed', () => { if (floating === child) floating = null; });
    child.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
    child.webContents.on('will-navigate', (event, url) => { event.preventDefault(); external(url); });
    child.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  });
  const control = (event, action) => {
    if (owner.isDestroyed() || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) return;
    if (!floating || floating.isDestroyed()) return;
    if (action === 'close' || action === 'attach') {
      destroy();
      if (action === 'attach') {
        if (owner.isMinimized()) owner.restore();
        owner.show();
      }
    }
    else if (action === 'show') floating.show();
    else if (action === 'hide') floating.hide();
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
