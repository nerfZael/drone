const CHAT_WINDOW_PREFIX = 'drone-hub-chat:';
const CHAT_WINDOW_PIN_CHANNEL = 'drone-hub:chat-window-pin';

function installChatWindows({ mainWindow, ipcMain, shell }) {
  const windows = new Map();
  const openExternal = (url) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url).catch(() => {});
  };
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url === 'about:blank' && frameName.startsWith(CHAT_WINDOW_PREFIX)) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 640, height: 800, minWidth: 320, minHeight: 280,
        frame: true, titleBarStyle: 'default', titleBarOverlay: false,
        alwaysOnTop: false, backgroundColor: '#11161e',
      } };
    }
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-create-window', (child, { frameName }) => {
    windows.set(frameName, child);
    child.setMenu(null);
    child.webContents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: 'deny' };
    });
    child.webContents.on('will-navigate', (event, url) => {
      event.preventDefault();
      openExternal(url);
    });
    child.on('closed', () => { if (windows.get(frameName) === child) windows.delete(frameName); });
  });
  const pin = (event, name, enabled) => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
    const child = windows.get(name);
    if (!child || child.isDestroyed() || typeof enabled !== 'boolean') return false;
    child.setAlwaysOnTop(enabled);
    return child.isAlwaysOnTop();
  };
  ipcMain.handle(CHAT_WINDOW_PIN_CHANNEL, pin);
  mainWindow.on('closed', () => {
    ipcMain.removeHandler(CHAT_WINDOW_PIN_CHANNEL);
    for (const child of windows.values()) if (!child.isDestroyed()) child.destroy();
    windows.clear();
  });
}
module.exports = { installChatWindows, CHAT_WINDOW_PREFIX, CHAT_WINDOW_PIN_CHANNEL };
