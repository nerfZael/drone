const path = require('node:path');

// Each card owns a small window; gaps between cards never intercept desktop clicks.
function registerDesktopNotifications({ ipcMain, BrowserWindow, screen, shell, getWindow, timers = { setTimeout, clearTimeout }, now = Date.now }) {
  const cards = [];
  const pending = [];
  let owner = null;
  const trusted = (event, window = getWindow()) => window && !window.isDestroyed() &&
    event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  const reportError = (error) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('drone-hub:notification-error', String(error?.message || error));
  };
  const workArea = () => {
    const window = getWindow();
    return (window && !window.isDestroyed() ? screen.getDisplayMatching(window.getBounds()) : screen.getPrimaryDisplay()).workArea;
  };
  const capacity = () => Math.max(1, Math.min(3, Math.floor((workArea().height - 24) / 132)));
  const position = () => {
    const area = workArea();
    cards.forEach((card, index) => {
      const width = Math.min(380, area.width - 24);
      card.window.setBounds({ x: area.x + area.width - width - 12, y: area.y + area.height - 12 - (index + 1) * 132 + 12, width, height: 120 });
    });
  };
  const dismiss = (card) => {
    const index = cards.indexOf(card);
    if (index < 0) return;
    cards.splice(index, 1);
    timers.clearTimeout(card.timer);
    if (!card.window.isDestroyed()) card.window.destroy();
    position();
    drain();
  };
  const clear = () => {
    pending.length = 0;
    for (const card of [...cards]) dismiss(card);
  };
  const resume = (card) => {
    if (!card.payload.durationSeconds || !card.ready || card.paused || card.timer) return;
    card.startedAt = now();
    card.timer = timers.setTimeout(() => dismiss(card), card.remaining);
  };
  const pause = (card, paused) => {
    card.paused = paused;
    if (paused && card.timer) {
      timers.clearTimeout(card.timer);
      card.timer = null;
      card.remaining = Math.max(0, card.remaining - (now() - card.startedAt));
    } else if (!paused) resume(card);
  };
  function drain() {
    const window = getWindow();
    if (!window || window.isDestroyed()) { clear(); return; }
    while (pending.length && cards.length < capacity()) {
      const payload = pending.shift();
      let popup;
      try {
        popup = new BrowserWindow({ width: 380, height: 120, show: false, frame: false,
          alwaysOnTop: true, skipTaskbar: true, resizable: false, minimizable: false,
          maximizable: false, fullscreenable: false, title: 'Drone Hub notification',
          backgroundColor: '#171d27', autoHideMenuBar: true,
          webPreferences: { preload: path.join(__dirname, 'hub-notification-preload.cjs'),
            nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
        });
        const card = { window: popup, payload, timer: null, remaining: payload.durationSeconds * 1000,
          ready: false, paused: false, startedAt: 0 };
        cards.push(card);
        popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        popup.webContents.on('will-navigate', (event) => event.preventDefault());
        popup.on('closed', () => dismiss(card));
        popup.webContents.on('render-process-gone', () => { reportError('Notification window stopped responding.'); dismiss(card); });
        void popup.loadFile(path.join(__dirname, 'hub-notification.html')).catch((error) => { reportError(error); dismiss(card); });
      } catch (error) {
        if (popup && !popup.isDestroyed()) popup.destroy();
        reportError(error);
      }
    }
  }
  ipcMain.handle('drone-hub:notification-supported', (event) => Boolean(trusted(event)));
  ipcMain.handle('drone-hub:notification-clear', (event) => {
    if (!trusted(event)) throw new Error('Untrusted notification sender');
    clear();
  });
  ipcMain.handle('drone-hub:notification-show', (event, input) => {
    if (!trusted(event)) throw new Error('Untrusted notification sender');
    const payload = validatePayload(input);
    const window = getWindow();
    if (owner !== window) {
      clear();
      owner = window;
      window.once('closed', clear);
    }
    if (pending.length >= 50) pending.shift();
    pending.push(payload);
    drain();
  });
  ipcMain.handle('drone-hub:notification-card', (event) => {
    const card = cards.find((item) => trusted(event, item.window));
    if (!card) throw new Error('Untrusted notification card');
    return card.payload;
  });
  ipcMain.on('drone-hub:notification-action', (event, action) => {
    const card = cards.find((item) => trusted(event, item.window));
    if (!card) return;
    if (action === 'ready') {
      if (card.ready) return;
      card.ready = true;
      position();
      card.window.showInactive();
      if (!card.payload.silent) shell.beep();
      resume(card);
      return;
    }
    if (action === 'pause' || action === 'resume') { pause(card, action === 'pause'); return; }
    if (action !== 'open' && action !== 'dismiss') return;
    if (action === 'open') {
      const window = getWindow();
      if (window && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        if (card.payload.target) window.webContents.send('drone-hub:notification-click', card.payload.target);
      }
    }
    dismiss(card);
  });
}

function validatePayload(input) {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 250 ||
      typeof input.body !== 'string' || input.body.length > 600 ||
      (input.target != null && (typeof input.target.droneId !== 'string' || !input.target.droneId ||
        input.target.droneId.length > 200 || typeof input.target.chatName !== 'string' || !input.target.chatName ||
        input.target.chatName.length > 200))) throw new Error('Invalid notification');
  const durationSeconds = input.durationSeconds ?? 8;
  if (![0, 5, 8, 15, 30].includes(durationSeconds)) throw new Error('Invalid notification duration');
  return { title: input.title, body: input.body, silent: input.silent === true, durationSeconds,
    name: typeof input.name === 'string' ? input.name.slice(0, 180) : '',
    kind: ['finished', 'failed', 'message'].includes(input.kind) ? input.kind : 'test',
    target: input.target ? { droneId: input.target.droneId, chatName: input.target.chatName } : null };
}

module.exports = { registerDesktopNotifications };
