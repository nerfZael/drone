const CHAT_WINDOW_PREFIX = 'drone-hub-chat:';
// A tool pane (editor, terminal, canvas, ...) shown in its own window; wider than a chat.
const TOOL_WINDOW_PREFIX = 'drone-hub-tool:';
const CHAT_WINDOW_PIN_CHANNEL = 'drone-hub:chat-window-pin';

function ownedWindowSize(frameName) {
  if (frameName.startsWith(CHAT_WINDOW_PREFIX)) return { width: 640, height: 800 };
  if (frameName.startsWith(TOOL_WINDOW_PREFIX)) return { width: 1040, height: 760 };
  return null;
}

function installChatWindows({ mainWindow, ipcMain, shell }) {
  const windows = new Map();
  const openExternal = (url) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url).catch(() => {});
  };
  const handleWindowOpen = ({ url, frameName }) => {
    const size = url === 'about:blank' ? ownedWindowSize(frameName) : null;
    if (size) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        ...size, minWidth: 320, minHeight: 280,
        frame: true, titleBarStyle: 'default', titleBarOverlay: false,
        alwaysOnTop: false, backgroundColor: '#11161e',
      } };
    }
    openExternal(url);
    return { action: 'deny' };
  };
  mainWindow.webContents.setWindowOpenHandler(handleWindowOpen);
  mainWindow.webContents.on('did-create-window', (child, { frameName }) => {
    if (!ownedWindowSize(frameName)) return;
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
  return handleWindowOpen;
}
module.exports = { installChatWindows, CHAT_WINDOW_PREFIX, TOOL_WINDOW_PREFIX, CHAT_WINDOW_PIN_CHANNEL };
