const fs = require('node:fs');
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

/** Smallest rectangle containing every display: the coordinate space of an overlay that covers the desktop. */
function unionBounds(displays) {
  const x = Math.min(...displays.map(display => display.bounds.x));
  const y = Math.min(...displays.map(display => display.bounds.y));
  return {
    x, y,
    width: Math.max(...displays.map(display => display.bounds.x + display.bounds.width)) - x,
    height: Math.max(...displays.map(display => display.bounds.y + display.bounds.height)) - y,
  };
}

const intersection = (a, b) => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x, height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
};

/**
 * Crop a selection given in screen coordinates out of per-display captures.
 * A selection inside one display is a plain crop; one that crosses displays is
 * stitched at the sharpest scale involved, leaving gaps between monitors transparent.
 */
function cropSelection(rect, parts, nativeImage) {
  if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))) throw new Error('Invalid capture selection.');
  const touched = parts.map(part => ({ ...part, overlap: intersection(rect, part.bounds) })).filter(part => part.overlap);
  if (!touched.length) throw new Error('Select a non-empty area.');
  const pieceOf = part => part.image.crop(cropRectangle(
    { ...part.overlap, x: part.overlap.x - part.bounds.x, y: part.overlap.y - part.bounds.y }, part.bounds, part.image.getSize()));
  if (touched.length === 1) return pieceOf(touched[0]);
  const scale = Math.max(...touched.map(part => part.image.getSize().width / part.bounds.width));
  const frame = touched.map(part => part.overlap).reduce((a, b) => unionBounds([{ bounds: a }, { bounds: b }]));
  const width = Math.round(frame.width * scale), height = Math.round(frame.height * scale);
  const pixels = Buffer.alloc(width * height * 4);
  for (const part of touched) {
    const target = {
      x: Math.round((part.overlap.x - frame.x) * scale), y: Math.round((part.overlap.y - frame.y) * scale),
      width: Math.round(part.overlap.width * scale), height: Math.round(part.overlap.height * scale),
    };
    let piece = pieceOf(part);
    const size = piece.getSize();
    if (size.width !== target.width || size.height !== target.height) piece = piece.resize({ width: target.width, height: target.height, quality: 'best' });
    const bitmap = piece.toBitmap();
    const columns = Math.min(target.width, width - target.x);
    for (let row = 0; row < Math.min(target.height, height - target.y); row++) {
      bitmap.copy(pixels, ((target.y + row) * width + target.x) * 4, row * target.width * 4, (row * target.width + columns) * 4);
    }
  }
  return nativeImage.createFromBitmap(pixels, { width, height });
}

/** The remembered rectangle follows the user: on another monitor it takes the same place it had on its own. */
function placeSelection(saved, displays, active) {
  if (!saved || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(saved[key]))) return null;
  const holds = display => intersection({ x: saved.x + saved.width / 2, y: saved.y + saved.height / 2, width: 1, height: 1 }, display.bounds);
  if (holds(active)) return saved;
  const from = displays.find(holds);
  if (!from) return null;
  const width = Math.min(saved.width, active.bounds.width), height = Math.min(saved.height, active.bounds.height);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  return {
    x: clamp(saved.x - from.bounds.x + active.bounds.x, active.bounds.x, active.bounds.x + active.bounds.width - width),
    y: clamp(saved.y - from.bounds.y + active.bounds.y, active.bounds.y, active.bounds.y + active.bounds.height - height),
    width, height,
  };
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

function installSnipping({ owner, ipcMain, BrowserWindow, desktopCapturer, screen, nativeImage, selectionPath, getCursorPoint = captureCursorPoint, platform = process.platform, x11 = platform === 'linux' && !process.env.WAYLAND_DISPLAY }) {
  const channel = 'drone-hub:companion-capture';
  const resultChannel = 'drone-hub:snip-selection';
  const readyChannel = 'drone-hub:snip-ready';
  // A normal window is placed and animated by the window manager: on X11 a
  // monitor-sized one can land on another equally sized monitor, and GNOME
  // zooms it in and out. A dock window keeps the position it asks for and
  // maps without animation, so one window can cover every display and the
  // selection can be dragged onto, or across, any of them. Elsewhere the
  // overlay covers only the display under the cursor; on other Linux sessions
  // it anchors a smaller window there and requests fullscreen before showing.
  const span = x11;
  const fullscreen = platform === 'linux' && !x11;
  const overlayDisplays = display => span ? screen.getAllDisplays() : [display];
  let busy = false;
  let cancel = null;
  let overlay = null;
  let loaded = null;

  const loadSelection = () => {
    try { return JSON.parse(fs.readFileSync(selectionPath, 'utf8')); } catch { return null; }
  };
  const saveSelection = (selection) => {
    if (!selectionPath) return;
    try { fs.writeFileSync(selectionPath, JSON.stringify(selection), { mode: 0o600 }); } catch {}
  };
  const fromOverlay = event => Boolean(overlay) && !overlay.isDestroyed() && event.sender === overlay.webContents && event.senderFrame === overlay.webContents.mainFrame;
  const anchorBounds = display => fullscreen ? {
    ...display.bounds,
    width: Math.max(1, Math.min(800, Math.floor(display.bounds.width / 2))),
    height: Math.max(1, Math.min(600, Math.floor(display.bounds.height / 2))),
  } : display.bounds;

  // Creating a window and loading its page costs several hundred milliseconds
  // and is visible as a flash. The overlay is therefore built once, kept
  // hidden, and only shown once a frozen frame is ready to paint. It is
  // transparent so that anything short of that frame shows the live desktop.
  const ensureOverlay = (display) => {
    if (overlay && !overlay.isDestroyed()) return loaded;
    const created = new BrowserWindow({
      ...anchorBounds(display), ...(x11 ? { type: 'dock' } : {}), show: false, frame: false, resizable: fullscreen, movable: fullscreen,
      transparent: true, backgroundColor: '#00000000', hasShadow: false,
      alwaysOnTop: true, skipTaskbar: true, fullscreenable: fullscreen,
      webPreferences: { preload: path.join(__dirname, 'hub-snipping-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    overlay = created;
    const gone = (error) => {
      if (overlay !== created) return;
      overlay = null; loaded = null;
      if (!created.isDestroyed()) created.destroy();
      cancel?.(error);
    };
    created.on('closed', () => gone());
    created.webContents.on('render-process-gone', () => gone(new Error('Snipping window closed unexpectedly.')));
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    created.webContents.on('will-navigate', event => event.preventDefault());
    loaded = created.loadFile(path.join(__dirname, 'hub-snipping.html'));
    loaded.catch(() => gone());
    return loaded;
  };

  // parts: the captured displays the overlay covers, in screen coordinates; area: the rectangle it occupies.
  const select = (display, parts, area) => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      cancel = null;
      ipcMain.removeListener(resultChannel, onSelection);
      ipcMain.removeListener(readyChannel, onReady);
      if (overlay && !overlay.isDestroyed()) {
        overlay.hide();
        if (fullscreen) overlay.setFullScreen(false);
        overlay.webContents.send('drone-hub:snip-reset');
      }
      if (error) reject(error); else resolve(value);
    };
    const onSelection = (event, value) => { if (fromOverlay(event)) finish(value); };
    const onReady = (event) => {
      if (settled || !fromOverlay(event)) return;
      if (fullscreen) overlay.setFullScreen(true);
      else overlay.setBounds(area);
      overlay.setAlwaysOnTop(true, 'screen-saver');
      overlay.show();
      overlay.focus();
      void freezeOthers();
    };
    // Encoding a frame blocks this process for tens of milliseconds, so the other displays wait until
    // the overlay is up. Until each frame arrives, that display's live desktop shows through unchanged.
    const freezeOthers = async () => {
      for (const part of parts) {
        if (part.id === display.id) continue;
        await new Promise(resolve => setImmediate(resolve));
        if (settled || !overlay || overlay.isDestroyed()) return;
        overlay.webContents.send('drone-hub:snip-image', { id: String(part.id), image: part.image.toDataURL() });
      }
    };
    cancel = error => finish(null, error);
    ipcMain.on(resultChannel, onSelection);
    ipcMain.on(readyChannel, onReady);
    ensureOverlay(display).then(() => {
      if (settled) return;
      overlay.setBounds(fullscreen ? anchorBounds(display) : area);
      const saved = placeSelection(loadSelection(), parts, display);
      const active = parts.find(part => part.id === display.id);
      overlay.webContents.send('drone-hub:snip-start', {
        image: active.image.toDataURL(),
        selection: saved && { ...saved, x: saved.x - area.x, y: saved.y - area.y },
        size: { width: area.width, height: area.height },
        displays: parts.map(part => ({ id: String(part.id), x: part.bounds.x - area.x, y: part.bounds.y - area.y, width: part.bounds.width, height: part.bounds.height })),
        active: String(display.id),
      });
    }).catch(error => finish(null, error));
  });

  const pixelSize = display => ({ width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) });
  // A thumbnail is scaled to the requested size, so only a request for a display's exact pixel
  // size keeps its pixels. Differently sized displays are captured by parallel requests, all
  // before the overlay exists on screen.
  const capture = async (display, displays) => {
    const all = screen.getAllDisplays();
    const key = size => `${size.width}x${size.height}`;
    const sizes = new Map(displays.map(item => [key(pixelSize(item)), pixelSize(item)]));
    const sources = new Map(await Promise.all([...sizes].map(async ([name, thumbnailSize]) => [name, await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })])));
    return displays.flatMap((item) => {
      try {
        return [{ id: item.id, bounds: item.bounds, image: selectScreenSource(sources.get(key(pixelSize(item))), item, all, platform).thumbnail }];
      } catch (error) {
        // Only the display under the cursor is essential; another one that cannot be matched is left uncovered.
        if (item.id === display.id) throw error;
        return [];
      }
    });
  };

  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, mode) => {
    if (event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) throw new Error('Capture is only available to Drone Hub.');
    if (mode !== 'region' && mode !== 'screen') throw new Error('Invalid capture mode.');
    if (busy) return null;
    busy = true;
    try {
      const display = screen.getDisplayNearestPoint(await getCursorPoint(screen));
      const parts = await capture(display, mode === 'region' ? overlayDisplays(display) : [display]);
      let captured = parts.find(part => part.id === display.id).image;
      if (owner.isDestroyed()) return null;
      if (mode === 'region') {
        const area = span ? unionBounds(parts) : display.bounds;
        const selection = await select(display, parts, area);
        if (!selection) return null;
        if (selection === 'screen' || selection.screen !== undefined) {
          captured = (parts.find(part => String(part.id) === String(selection.screen)) ?? { image: captured }).image;
        } else {
          const rect = { x: selection.x + area.x, y: selection.y + area.y, width: selection.width, height: selection.height };
          captured = cropSelection(rect, parts, nativeImage);
          saveSelection(rect);
        }
      }
      const bytes = captured.toPNG();
      if (bytes.length > 6 * 1024 * 1024) throw new Error('Screenshot exceeds the 6 MB attachment limit. Please snip a smaller area.');
      return { name: `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`, mime: 'image/png', size: bytes.length, dataBase64: bytes.toString('base64') };
    } finally { busy = false; }
  });
  owner.once('closed', () => {
    cancel?.();
    ipcMain.removeHandler(channel);
    const last = overlay;
    overlay = null; loaded = null;
    if (last && !last.isDestroyed()) last.destroy();
  });
  // Warm the overlay up front so the first snip appears as quickly as later ones.
  try { ensureOverlay(screen.getPrimaryDisplay()).catch(() => {}); } catch {}
}
module.exports = { cropRectangle, cropSelection, placeSelection, unionBounds, selectScreenSource, installSnipping };
