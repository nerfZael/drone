const path = require('node:path');
const { captureCursorPoint } = require('./hub-capture-cursor.cjs');

function cropRectangle(rect, bounds, size) {
  if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))) throw new Error('Invalid capture selection.');
  const left = Math.max(0, Math.min(bounds.width, rect.x));
  const top = Math.max(0, Math.min(bounds.height, rect.y));
  const right = Math.max(left, Math.min(bounds.width, rect.x + rect.width));
  const bottom = Math.max(top, Math.min(bounds.height, rect.y + rect.height));
  const x = Math.floor(left * size.width / bounds.width);
  const y = Math.floor(top * size.height / bounds.height);
  const width = Math.min(size.width, Math.ceil(right * size.width / bounds.width)) - x;
  const height = Math.min(size.height, Math.ceil(bottom * size.height / bounds.height)) - y;
  if (width < 1 || height < 1) throw new Error('Select a non-empty area.');
  return { x, y, width, height };
}

function selectScreenSource(sources, display, displays = [display], platform = process.platform) {
  let source = sources.find(item => item.display_id === String(display.id));
  if (!source && platform === 'linux' && Number.isSafeInteger(display.id)) {
    // Electron's X11 MonitorAtomIdToDisplayId uses uint32_t, while screen
    // exposes the full display ID. Do not rely on source ordering or labels.
    const truncatedId = id => Number.isSafeInteger(id) ? String(BigInt.asUintN(32, BigInt(id))) : null;
    const id = truncatedId(display.id);
    const candidates = sources.filter(item => item.display_id === id);
    const matchingDisplays = displays.filter(item => truncatedId(item.id) === id);
    if (candidates.length === 1 && matchingDisplays.length === 1) source = candidates[0];
  }
  // A truncated-ID collision is ambiguous; do not choose the wrong monitor.
  if (!source) throw new Error('The desktop capture sources could not be matched to the screen under the cursor.');
  if (source.thumbnail.isEmpty()) throw new Error('The screen capture is empty. Check screen recording permissions and desktop capture support.');
  return source;
}

function installSnipping({ owner, ipcMain, BrowserWindow, desktopCapturer, screen, getCursorPoint = captureCursorPoint, platform = process.platform }) {
  const channel = 'drone-hub:companion-capture';
  let busy = false;
  let cancel = null;
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, mode) => {
    if (event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) throw new Error('Capture is only available to Drone Hub.');
    if (mode !== 'region' && mode !== 'screen') throw new Error('Invalid capture mode.');
    if (busy) return null;
    busy = true;
    try {
      const display = screen.getDisplayNearestPoint(await getCursorPoint(screen));
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: {
        width: Math.round(display.bounds.width * display.scaleFactor),
        height: Math.round(display.bounds.height * display.scaleFactor),
      } });
      let captured = selectScreenSource(sources, display, screen.getAllDisplays()).thumbnail;
      if (owner.isDestroyed()) return null;
      if (mode === 'region') {
        const selection = await new Promise((resolve, reject) => {
          // On X11, mapping a fixed-size, monitor-sized window can move it to
          // another equally sized monitor. Anchor a smaller normal window on
          // the target display, then request fullscreen before showing it.
          const fullscreen = platform === 'linux';
          const initialBounds = fullscreen ? {
            ...display.bounds,
            width: Math.max(1, Math.min(800, Math.floor(display.bounds.width / 2))),
            height: Math.max(1, Math.min(600, Math.floor(display.bounds.height / 2))),
          } : display.bounds;
          const overlay = new BrowserWindow({
            ...initialBounds, show: false, frame: false, resizable: fullscreen, movable: fullscreen,
            alwaysOnTop: true, skipTaskbar: true, fullscreenable: fullscreen,
            webPreferences: { preload: path.join(__dirname, 'hub-snipping-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
          });
          const resultChannel = 'drone-hub:snip-selection';
          let settled = false;
          const finish = (value, error) => {
            if (settled) return;
            settled = true;
            cancel = null;
            ipcMain.removeListener(resultChannel, onSelection);
            if (!overlay.isDestroyed()) overlay.destroy();
            if (error) reject(error); else resolve(value);
          };
          const onSelection = (sender, value) => {
            if (sender.sender === overlay.webContents && sender.senderFrame === overlay.webContents.mainFrame) finish(value);
          };
          cancel = () => finish(null);
          ipcMain.on(resultChannel, onSelection);
          overlay.on('closed', () => finish(null));
          overlay.webContents.on('render-process-gone', () => finish(null, new Error('Snipping window closed unexpectedly.')));
          overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
          overlay.webContents.on('will-navigate', event => event.preventDefault());
          overlay.loadFile(path.join(__dirname, 'hub-snipping.html')).then(() => {
            if (settled) return;
            overlay.webContents.send('drone-hub:snip-image', captured.toDataURL());
            if (fullscreen) overlay.setFullScreen(true);
            else overlay.setBounds(display.bounds);
            overlay.setAlwaysOnTop(true, 'screen-saver');
            overlay.show();
            overlay.focus();
          }).catch(error => finish(null, error));
        });
        if (!selection) return null;
        if (selection !== 'screen') captured = captured.crop(cropRectangle(selection, display.bounds, captured.getSize()));
      }
      const bytes = captured.toPNG();
      if (bytes.length > 6 * 1024 * 1024) throw new Error('Screenshot exceeds the 6 MB attachment limit. Please snip a smaller area.');
      return { name: `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`, mime: 'image/png', size: bytes.length, dataBase64: bytes.toString('base64') };
    } finally { busy = false; }
  });
  owner.once('closed', () => { cancel?.(); ipcMain.removeHandler(channel); });
}
module.exports = { cropRectangle, selectScreenSource, installSnipping };
