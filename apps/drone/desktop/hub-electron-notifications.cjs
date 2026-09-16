// Keep native notifications in the main process so clicks restore a minimized window.
function registerDesktopNotifications({ ipcMain, Notification, getWindow, getIcon, platform = process.platform }) {
  const active = new Set();
  const trusted = (event) => {
    const window = getWindow();
    return window && !window.isDestroyed() && event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame;
  };
  ipcMain.handle('drone-hub:notification-supported', (event) => Boolean(trusted(event) && Notification.isSupported()));
  ipcMain.handle('drone-hub:notification-show', (event, input) => {
    if (!trusted(event)) throw new Error('Untrusted notification sender');
    if (!Notification.isSupported()) throw new Error('System notifications are unavailable on this computer.');
    if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 250 ||
        typeof input.body !== 'string' || input.body.length > 600 ||
        (input.target != null && (typeof input.target.droneId !== 'string' || !input.target.droneId ||
          input.target.droneId.length > 200 || typeof input.target.chatName !== 'string' ||
          input.target.chatName.length > 200))) throw new Error('Invalid notification');
    const window = getWindow();
    const target = input.target ? { droneId: input.target.droneId, chatName: input.target.chatName } : null;
    const icon = getIcon();
    const notification = new Notification({ title: input.title, body: input.body, silent: input.silent === true, timeoutType: 'default', ...(icon ? { icon } : {}) });
    active.add(notification);
    // Bound native handles during long-running sessions.
    if (active.size > 100) {
      const oldest = active.values().next().value;
      oldest.close();
      active.delete(oldest);
    }
    notification.on('close', (details) => {
      // Windows closes the banner on timeout while retaining the alert in Action
      // Center. Keep its click handler alive until it is actually dismissed.
      if (platform === 'win32' && details?.reason !== 'userCanceled' && details?.reason !== 'applicationHidden') return;
      active.delete(notification);
    });
    notification.on('failed', (_event, error) => {
      active.delete(notification);
      if (!window.isDestroyed()) window.webContents.send('drone-hub:notification-error', String(error || 'Unable to show system notification.'));
    });
    notification.on('click', () => {
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      if (target) window.webContents.send('drone-hub:notification-click', target);
    });
    try {
      notification.show();
    } catch (error) {
      active.delete(notification);
      throw error;
    }
  });
}

module.exports = { registerDesktopNotifications };
