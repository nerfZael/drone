const { app, BrowserWindow, ipcMain, screen, shell, Menu, Tray, nativeImage, clipboard } = require('electron');
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const zlib = require('node:zlib');

const PROTOCOL = 'voicestream';
const pendingPairingPayloads = [];
let mainWindow = null;
let compactMode = true;
let normalWindowBounds = null;
let tray = null;
let isQuitting = false;
let trayStatus = { mode: 'off', status: 'Off.' };

const fullWindow = {
  width: 1180,
  height: 780,
  minWidth: 960,
  minHeight: 680,
};
const compactWindow = {
  width: 268,
  height: 72,
  margin: 18,
};

const sampleRate = 16_000;
const wakeGrammar = [
  'hey sebastian',
  'hey sebastien',
  'hay sebastian',
  'hay sebastien',
  'hey',
  'hay',
  'sebastian',
  'sebastien',
  'patch me in',
  'can you transcribe',
  'transcribe',
  'go to sleep',
  'go',
  'to',
  'sleep',
  'status',
  'state us',
  'state is',
  'status check',
  'check status',
  'approval',
  'code',
  'approval code',
  'zero',
  'oh',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  '[unk]',
];

const defaultConfig = {
  serverUrl: process.env.VOICE_STREAM_NEXT_SERVER_URL || 'http://127.0.0.1:3299',
  webUrl: process.env.VOICE_STREAM_NEXT_WEB_URL || '',
  authMode: 'dev',
  bearerToken: '',
  devEmail: 'desktop@example.local',
  devName: 'Desktop Operator',
  devAdmin: false,
  installationId: '',
  deviceId: '',
  deviceToken: '',
  deviceName: 'Desktop voice client',
  inputDeviceId: '',
  outputDeviceId: '',
  authSavedAt: '',
};

const voskState = {
  vosk: null,
  model: null,
  recognizer: null,
  worker: null,
  workerReady: false,
  workerStarting: null,
  modelPath: '',
  error: '',
  lastText: '',
  lastTextAt: 0,
};

function configPath() {
  return path.join(app.getPath('userData'), 'voice-stream-next-desktop.json');
}

function createInstallationId() {
  return `desktop_${randomUUID().replace(/-/g, '')}`;
}

function normalizeConfig(nextConfig) {
  const config = { ...defaultConfig, ...nextConfig };
  if (!String(config.installationId || '').trim()) {
    config.installationId = createInstallationId();
  }
  return config;
}

function persistConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    const config = normalizeConfig(parsed);
    if (!parsed.installationId) persistConfig(config);
    return config;
  } catch {
    const config = normalizeConfig({});
    persistConfig(config);
    return config;
  }
}

function writeConfig(nextConfig) {
  const config = normalizeConfig(nextConfig);
  persistConfig(config);
  return config;
}

function windowDebugLog(message, details = {}) {
  try {
    const file = path.join(app.getPath('userData'), 'voice-stream-next-window-debug.log');
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, message, ...details })}\n`);
  } catch {
    // Debug logging must never affect window behavior.
  }
}

function windowSnapshot(win) {
  if (!win || win.isDestroyed()) return null;
  return {
    bounds: win.getBounds(),
    minimumSize: win.getMinimumSize(),
    resizable: win.isResizable(),
    alwaysOnTop: win.isAlwaysOnTop(),
    compactMode,
    normalWindowBounds,
  };
}

function resolveVoskModelPath() {
  const candidates = [
    process.env.VOICE_STREAM_NEXT_VOSK_MODEL,
    path.join(process.resourcesPath || '', 'model-en-us'),
    path.join(process.resourcesPath || '', 'vosk-model-en-us'),
    path.resolve(__dirname, '../android/app/src/main/assets/model-en-us'),
    path.resolve(__dirname, '../../voice-stream/android/app/src/main/assets/model-en-us'),
  ].filter(Boolean);

  return candidates.find((candidate) => hasRequiredVoskModelFiles(candidate)) || '';
}

function hasRequiredVoskModelFiles(modelDir) {
  return fs.existsSync(path.join(modelDir, 'am', 'final.mdl')) &&
    fs.existsSync(path.join(modelDir, 'graph', 'HCLr.fst')) &&
    fs.existsSync(path.join(modelDir, 'graph', 'Gr.fst')) &&
    fs.existsSync(path.join(modelDir, 'conf', 'model.conf'));
}

async function ensureVoskRecognizer() {
  if (voskState.recognizer) return statusForVosk(true);
  if (voskState.workerReady) return statusForVosk(true);
  if (voskState.workerStarting) return voskState.workerStarting;

  const modelPath = resolveVoskModelPath();
  if (!modelPath) {
    voskState.error = 'No Vosk model found. Set VOICE_STREAM_NEXT_VOSK_MODEL to an Android-style Vosk model directory.';
    return statusForVosk(false);
  }

  try {
    if (!voskState.vosk) {
      voskState.vosk = requireVosk();
      voskState.vosk.setLogLevel(-1);
    }
    voskState.model = new voskState.vosk.Model(modelPath);
    voskState.recognizer = new voskState.vosk.Recognizer({
      model: voskState.model,
      sampleRate,
      grammar: wakeGrammar,
    });
    voskState.modelPath = modelPath;
    voskState.error = '';
    return statusForVosk(true);
  } catch (error) {
    releaseVosk();
    return startVoskWorker(modelPath, error);
  }
}

function startVoskWorker(modelPath, originalError) {
  if (voskState.workerStarting) return voskState.workerStarting;
  const workerPath = path.join(__dirname, 'vosk-worker.cjs');
  const nodeExecutable = process.env.VOICE_STREAM_NEXT_NODE || 'node';
  voskState.workerStarting = new Promise((resolve) => {
    let settled = false;
    let worker;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      voskState.workerStarting = null;
      resolve(status);
    };
    try {
      worker = fork(workerPath, {
        cwd: path.resolve(__dirname, '../..', '..'),
        execPath: nodeExecutable,
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
    } catch (error) {
      voskState.error = [
        `Vosk failed in Electron: ${originalError?.message || String(originalError)}`,
        `Node worker failed: ${error?.message || String(error)}`,
      ].join(' ');
      finish(statusForVosk(false));
      return;
    }
    voskState.worker = worker;
    voskState.workerReady = false;
    worker.stderr?.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (text) console.warn(`[voice-stream-vosk-worker] ${text}`);
    });
    worker.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'status') {
        voskState.workerReady = Boolean(message.available);
        voskState.modelPath = String(message.modelPath || modelPath);
        voskState.error = String(message.error || '');
        finish(statusForVosk(Boolean(message.available)));
      }
      if (message.type === 'text' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vosk:text', {
          text: String(message.text || ''),
          final: Boolean(message.final),
        });
      }
    });
    worker.on('exit', () => {
      if (voskState.worker === worker) {
        voskState.worker = null;
        voskState.workerReady = false;
      }
      if (!settled) {
        voskState.error = `Vosk failed in Electron: ${originalError?.message || String(originalError)} Node worker exited before startup.`;
        finish(statusForVosk(false));
      }
    });
    worker.on('error', (error) => {
      if (voskState.worker === worker) {
        voskState.worker = null;
        voskState.workerReady = false;
      }
      voskState.error = [
        `Vosk failed in Electron: ${originalError?.message || String(originalError)}`,
        `Node worker failed: ${error?.message || String(error)}`,
      ].join(' ');
      finish(statusForVosk(false));
    });
    worker.send({
      type: 'start',
      modelPath,
      sampleRate,
      grammar: wakeGrammar,
    });
  });
  return voskState.workerStarting;
}

function requireVosk() {
  try {
    return require('vosk');
  } catch (error) {
    const resourcesNodeModules = path.join(process.resourcesPath || '', 'node_modules', 'vosk', 'package.json');
    if (!fs.existsSync(resourcesNodeModules)) throw error;
    return createRequire(resourcesNodeModules)('vosk');
  }
}

function statusForVosk(started = Boolean(voskState.recognizer || voskState.workerReady)) {
  return {
    available: Boolean(started && (voskState.recognizer || voskState.workerReady)),
    modelPath: voskState.modelPath || resolveVoskModelPath() || '',
    error: voskState.error,
  };
}

function releaseVosk() {
  try {
    voskState.recognizer?.free();
  } catch {
    // Ignore native cleanup errors while shutting down the local recognizer.
  }
  try {
    voskState.model?.free();
  } catch {
    // Ignore native cleanup errors while shutting down the local recognizer.
  }
  voskState.model = null;
  voskState.recognizer = null;
  if (voskState.worker) {
    try {
      voskState.worker.send({ type: 'stop' });
    } catch {
      // Ignore stale worker shutdown errors.
    }
    try {
      voskState.worker.kill();
    } catch {
      // Ignore stale worker shutdown errors.
    }
  }
  voskState.worker = null;
  voskState.workerReady = false;
  voskState.workerStarting = null;
  voskState.lastText = '';
  voskState.lastTextAt = 0;
}

function resetVosk() {
  if (voskState.workerReady && voskState.worker) {
    try {
      voskState.worker.send({ type: 'reset' });
    } catch {
      releaseVosk();
    }
    return;
  }
  try {
    voskState.recognizer?.reset();
  } catch {
    releaseVosk();
  }
  voskState.lastText = '';
  voskState.lastTextAt = 0;
}

function textFromVoskResult(result) {
  if (!result || typeof result !== 'object') return '';
  return String(result.partial || result.text || '').trim();
}

function handleVoskFrame(sender, frame) {
  if (voskState.workerReady && voskState.worker) {
    const buffer = Buffer.isBuffer(frame) ? frame : Buffer.from(frame);
    try {
      voskState.worker.send({ type: 'frame', frame: buffer });
    } catch (error) {
      voskState.error = error?.message || String(error);
      sender.send('vosk:status', statusForVosk(false));
      releaseVosk();
    }
    return;
  }
  if (!voskState.recognizer) return;
  const buffer = Buffer.isBuffer(frame) ? frame : Buffer.from(frame);
  if (!buffer.length) return;

  try {
    const accepted = voskState.recognizer.acceptWaveform(buffer);
    const text = textFromVoskResult(accepted ? voskState.recognizer.result() : voskState.recognizer.partialResult());
    if (!text) return;

    const now = Date.now();
    if (text === voskState.lastText && now - voskState.lastTextAt < 900) return;
    voskState.lastText = text;
    voskState.lastTextAt = now;
    sender.send('vosk:text', { text, final: Boolean(accepted) });
  } catch (error) {
    voskState.error = error?.message || String(error);
    sender.send('vosk:status', statusForVosk(false));
    releaseVosk();
  }
}

function extractPairingPayloadFromArgv(argv) {
  return argv.find((entry) => /^voicestream:\/\//i.test(String(entry || '').trim())) || null;
}

function queuePairingPayload(payload) {
  const trimmed = String(payload || '').trim();
  if (!trimmed) return;
  pendingPairingPayloads.push(trimmed);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pairing:payload', trimmed);
  }
}

function registerProtocolClient() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
      return;
    }
  }
  app.setAsDefaultProtocolClient(PROTOCOL);
}

function displayForWindow(win) {
  return screen.getDisplayMatching(win.getBounds());
}

function compactBoundsForWindow(win) {
  const { workArea } = displayForWindow(win);
  return {
    x: workArea.x + workArea.width - compactWindow.width - compactWindow.margin,
    y: workArea.y + workArea.height - compactWindow.height - compactWindow.margin,
    width: compactWindow.width,
    height: compactWindow.height,
  };
}

function windowStatePayload() {
  return { compact: compactMode };
}

function sendWindowState(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('window:state', windowStatePayload());
}

function applyCompactMode(win) {
  if (!win || win.isDestroyed()) return windowStatePayload();
  windowDebugLog('applyCompactMode:start', { snapshot: windowSnapshot(win) });
  if (!compactMode) normalWindowBounds = win.getBounds();
  compactMode = true;
  win.setMinimumSize(compactWindow.width, compactWindow.height);
  win.setResizable(false);
  win.setAlwaysOnTop(true, 'floating');
  win.setSkipTaskbar(true);
  win.setBounds(compactBoundsForWindow(win));
  if (win.isMinimized()) win.restore();
  win.show();
  sendWindowState(win);
  windowDebugLog('applyCompactMode:end', { snapshot: windowSnapshot(win) });
  return windowStatePayload();
}

function centeredFullBounds(win) {
  const display = win && !win.isDestroyed() ? displayForWindow(win) : screen.getPrimaryDisplay();
  const { workArea } = display;
  return {
    x: Math.round(workArea.x + (workArea.width - fullWindow.width) / 2),
    y: Math.round(workArea.y + (workArea.height - fullWindow.height) / 2),
    width: fullWindow.width,
    height: fullWindow.height,
  };
}

function applyExpandedMode(win) {
  if (!win || win.isDestroyed()) return windowStatePayload();
  windowDebugLog('applyExpandedMode:start', { snapshot: windowSnapshot(win) });
  compactMode = false;
  win.setResizable(true);
  win.setMinimumSize(fullWindow.minWidth, fullWindow.minHeight);
  win.setAlwaysOnTop(false);
  win.setSkipTaskbar(false);
  const bounds = normalWindowBounds || centeredFullBounds(win);
  const tooSmallForFullMode = bounds.width < fullWindow.minWidth || bounds.height < fullWindow.minHeight;
  win.setBounds(tooSmallForFullMode ? centeredFullBounds(win) : bounds);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  sendWindowState(win);
  windowDebugLog('applyExpandedMode:end', { snapshot: windowSnapshot(win) });
  return windowStatePayload();
}

function applySignedOutMode(win) {
  windowDebugLog('applySignedOutMode:start', { snapshot: windowSnapshot(win) });
  normalWindowBounds = null;
  const result = applyExpandedMode(win);
  windowDebugLog('applySignedOutMode:end', { snapshot: windowSnapshot(win) });
  return result;
}

function shouldStartCompact() {
  const config = readConfig();
  return Boolean(config.deviceId && config.deviceToken);
}

function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender) || mainWindow;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function trayModeLabel(mode) {
  const labels = {
    off: 'Off',
    awake: 'Awake',
    sleeping: 'Asleep',
    recording: 'Recording',
    transcribing: 'Working',
    error: 'Error',
  };
  return labels[mode] || 'Voice';
}

function normalizeTrayMode(mode) {
  const value = String(mode || '').trim().toLowerCase();
  if (value === 'asleep' || value === 'sleep') return 'sleeping';
  if (['off', 'awake', 'sleeping', 'recording', 'transcribing', 'error'].includes(value)) return value;
  return 'off';
}

function trayModeColor(mode) {
  const colors = {
    off: [118, 124, 135],
    awake: [36, 181, 116],
    sleeping: [245, 158, 11],
    recording: [239, 68, 68],
    transcribing: [56, 137, 255],
    error: [220, 38, 38],
  };
  return colors[normalizeTrayMode(mode)] || colors.off;
}

function trayStatusTooltip() {
  const label = trayModeLabel(trayStatus.mode);
  const detail = String(trayStatus.status || '').trim();
  return detail && detail !== label ? `VoiceStream: ${label}\n${detail}` : `VoiceStream: ${label}`;
}

function trayStatusMenuTemplate() {
  return [
    { label: `Status: ${trayModeLabel(trayStatus.mode)}`, enabled: false },
    { type: 'separator' },
    { label: 'Show VoiceStream', click: showMainWindow },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];
}

function applyTrayStatus() {
  if (!tray) return;
  tray.setImage(trayIconImage(trayStatus.mode));
  tray.setToolTip(trayStatusTooltip());
  tray.setContextMenu(Menu.buildFromTemplate(trayStatusMenuTemplate()));
}

function updateTrayStatus(mode, status) {
  trayStatus = {
    mode: normalizeTrayMode(mode),
    status: String(status || trayModeLabel(normalizeTrayMode(mode))),
  };
  applyTrayStatus();
  return trayStatus;
}

function trayIconPngBuffer(mode = trayStatus.mode) {
  const size = 32;
  const raw = Buffer.alloc(size * (1 + size * 4));
  const [baseR, baseG, baseB] = trayModeColor(mode);

  function setPixel(x, y, r, g, b, a) {
    const offset = y * (1 + size * 4) + 1 + x * 4;
    raw[offset] = r;
    raw[offset + 1] = g;
    raw[offset + 2] = b;
    raw[offset + 3] = a;
  }

  for (let y = 0; y < size; y += 1) {
    raw[y * (1 + size * 4)] = 0;
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - 16;
      const dy = y + 0.5 - 16;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= 15) {
        const alpha = distance < 14 ? 255 : Math.round((15 - distance) * 255);
        setPixel(x, y, baseR, baseG, baseB, alpha);
      }
    }
  }

  for (let y = 8; y <= 18; y += 1) {
    for (let x = 13; x <= 18; x += 1) {
      const roundedTop = y < 11 && (x < 14 || x > 17);
      const roundedBottom = y > 15 && (x < 14 || x > 17);
      if (!roundedTop && !roundedBottom) setPixel(x, y, 255, 255, 255, 255);
    }
  }
  for (let y = 19; y <= 23; y += 1) {
    for (let x = 15; x <= 16; x += 1) setPixel(x, y, 255, 255, 255, 255);
  }
  for (let y = 24; y <= 25; y += 1) {
    for (let x = 11; x <= 20; x += 1) setPixel(x, y, 255, 255, 255, 255);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function trayIconImage(mode = trayStatus.mode) {
  const image = nativeImage.createFromBuffer(trayIconPngBuffer(mode));
  if (process.platform === 'darwin') image.setTemplateImage(false);
  return image;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  sendWindowState(mainWindow);
  mainWindow.webContents.invalidate?.();
  windowDebugLog('showMainWindow', { snapshot: windowSnapshot(mainWindow) });
}

function ensureTray() {
  if (tray) return tray;
  tray = new Tray(trayIconImage());
  applyTrayStatus();
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
  return tray;
}

function hideToTray(win) {
  if (!win || win.isDestroyed()) return;
  ensureTray();
  win.hide();
  windowDebugLog('hideToTray', { snapshot: windowSnapshot(win) });
}

function createWindow() {
  const initialBounds = centeredFullBounds(null);
  windowDebugLog('createWindow:start', {
    initialBounds,
    shouldStartCompact: shouldStartCompact(),
    config: (() => {
      const config = readConfig();
      return {
        serverUrl: config.serverUrl,
        webUrl: config.webUrl,
        deviceId: config.deviceId ? `${config.deviceId.slice(0, 12)}...` : '',
        hasDeviceToken: Boolean(config.deviceToken),
      };
    })(),
  });
  const win = new BrowserWindow({
    ...initialBounds,
    minWidth: fullWindow.minWidth,
    minHeight: fullWindow.minHeight,
    title: 'VoiceStream',
    backgroundColor: '#101216',
    frame: false,
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'index.html'));
  mainWindow = win;
  win.once('ready-to-show', () => {
    windowDebugLog('ready-to-show', { snapshot: windowSnapshot(win), shouldStartCompact: shouldStartCompact() });
    if (shouldStartCompact()) {
      applyCompactMode(win);
    } else {
      applySignedOutMode(win);
    }
  });
  win.webContents.once('did-finish-load', () => {
    windowDebugLog('did-finish-load', { snapshot: windowSnapshot(win) });
    sendWindowState(win);
  });
  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideToTray(win);
  });
  win.on('move', () => {
    if (compactMode) return;
    normalWindowBounds = win.getBounds();
  });
  win.on('resize', () => {
    if (compactMode) return;
    normalWindowBounds = win.getBounds();
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const payload = extractPairingPayloadFromArgv(argv);
    if (payload) queuePairingPayload(payload);
    showMainWindow();
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    queuePairingPayload(url);
  });

  registerProtocolClient();

  ipcMain.handle('config:read', () => readConfig());
  ipcMain.handle('pairing:takePending', () => pendingPairingPayloads.splice(0));
  ipcMain.handle('config:write', (_event, config) => writeConfig(config));
  ipcMain.handle('app:openExternal', (_event, url) => shell.openExternal(url));
  ipcMain.handle('clipboard:writeText', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });
  ipcMain.handle('debug:window', (_event, message, details) => {
    windowDebugLog(String(message || 'renderer'), { renderer: details || {}, snapshot: windowSnapshot(mainWindow) });
    return { ok: true };
  });
  ipcMain.handle('window:state', () => windowStatePayload());
  ipcMain.handle('window:compact', (event) => applyCompactMode(windowFromEvent(event)));
  ipcMain.handle('window:expand', (event) => applyExpandedMode(windowFromEvent(event)));
  ipcMain.handle('window:signedOut', (event) => applySignedOutMode(windowFromEvent(event)));
  ipcMain.handle('window:close', (event) => {
    const win = windowFromEvent(event);
    hideToTray(win);
  });
  ipcMain.handle('tray:status', (_event, payload) => updateTrayStatus(payload?.mode, payload?.status));
  ipcMain.handle('vosk:status', () => statusForVosk());
  ipcMain.handle('vosk:start', () => ensureVoskRecognizer());
  ipcMain.handle('vosk:stop', () => {
    releaseVosk();
    return statusForVosk(false);
  });
  ipcMain.handle('vosk:reset', () => {
    resetVosk();
    return statusForVosk();
  });
  ipcMain.on('vosk:frame', (event, frame) => handleVoskFrame(event.sender, frame));

  app.whenReady().then(() => {
    const launchPayload = extractPairingPayloadFromArgv(process.argv);
    if (launchPayload) queuePairingPayload(launchPayload);
    ensureTray();
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (isQuitting && process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    showMainWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    releaseVosk();
  });
}
