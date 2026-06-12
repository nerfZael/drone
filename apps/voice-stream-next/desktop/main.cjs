const { app, BrowserWindow, ipcMain, screen, shell, Menu, Tray, nativeImage, clipboard, dialog, globalShortcut } = require('electron');
const { fork, spawn } = require('node:child_process');
const { createHmac, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const APP_NAME = 'Drone';
const LINUX_DESKTOP_FILE_NAME = 'drone.desktop';
const PROTOCOL = 'voicestream';
const APP_ICON_PATH = path.join(__dirname, '..', 'assets', 'app-icon.png');
const pendingPairingPayloads = [];
let mainWindow = null;
let compactMode = true;
let normalWindowBounds = null;
let tray = null;
let isQuitting = false;
let trayStatus = { mode: 'off', status: 'Off.' };
let localDesktopAuth = { server: null, callbackUrls: [], secret: '', deviceToken: '', expiresAt: 0, expiryTimer: null };
let extensionBridge = { socket: null, reconnectTimer: null, stopped: false, reconnectDelayMs: 1000 };
const extensionHost = {
  loading: null,
  loaded: false,
  configKey: '',
  manifests: [],
  tools: new Map(),
  statuses: [],
  deactivators: [],
};

app.setName(APP_NAME);
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', APP_NAME);
  app.setDesktopName(LINUX_DESKTOP_FILE_NAME);
}
if (process.platform === 'win32') app.setAppUserModelId('com.huntelkator.voicestream');

const fullWindow = {
  width: 1180,
  height: 780,
  minWidth: 960,
  minHeight: 680,
};
const LOCAL_DESKTOP_AUTH_TTL_MS = 2 * 60 * 1000;
const compactWindow = {
  width: 268,
  height: 72,
  margin: 18,
};

const defaultTranscriptionShortcut = {
  key: 'space',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: true,
};

const defaultAwakeSleepToggleShortcut = {
  key: 'a',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: true,
};

const defaultTurnOffShortcut = {
  key: 'o',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: true,
};

const defaultPauseResumeShortcut = {
  key: 'p',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: true,
};

const sampleRate = 16_000;
const voicePhrases = loadSharedClassicScript('voice-phrases.js');
const defaultVoicePhraseSettings = voicePhrases.VOICE_PHRASE_DEFAULTS;
let currentVoskGrammar = voicePhrases.buildAwakeWakeGrammar({
  triggerPhrase: 'approval code',
  shutdownPhrase: defaultVoicePhraseSettings.shutdownPhrase,
});
const packagedBuildConfig = loadPackagedBuildConfig();

function loadSharedClassicScript(fileName) {
  const filename = path.join(__dirname, '..', 'shared', fileName);
  const sharedModule = { exports: {} };
  const context = vm.createContext({
    module: sharedModule,
    exports: sharedModule.exports,
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return sharedModule.exports;
}

const defaultConfig = {
  serverUrl: process.env.VOICE_STREAM_NEXT_DESKTOP_SERVER_URL || process.env.VOICE_STREAM_NEXT_SERVER_URL || packagedBuildConfig.serverUrl || 'http://127.0.0.1:3299',
  webUrl: process.env.VOICE_STREAM_NEXT_WEB_URL || packagedBuildConfig.webUrl || '',
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
  suppressWakeDuringPlayback: false,
  transcriptionShortcut: defaultTranscriptionShortcut,
  awakeSleepToggleShortcut: defaultAwakeSleepToggleShortcut,
  turnOffShortcut: defaultTurnOffShortcut,
  pauseResumeShortcut: defaultPauseResumeShortcut,
  extensionBridgeEnabled: true,
  extensions: [],
  authSavedAt: '',
};

function loadPackagedBuildConfig() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'voice-stream-next-desktop-build-config.json') : '',
    path.join(__dirname, '..', 'build', 'voice-stream-next-desktop-build-config.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        serverUrl: String(parsed.serverUrl || '').trim().replace(/\/+$/, ''),
        webUrl: String(parsed.webUrl || '').trim().replace(/\/+$/, ''),
        buildMode: String(parsed.buildMode || '').trim(),
      };
    } catch {
      // Ignore missing or malformed generated build config and fall back to local defaults.
    }
  }
  return { serverUrl: '', webUrl: '', buildMode: '' };
}

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
  config.suppressWakeDuringPlayback = config.suppressWakeDuringPlayback === true;
  config.transcriptionShortcut = sanitizeShortcutBinding(config.transcriptionShortcut, defaultTranscriptionShortcut);
  config.awakeSleepToggleShortcut = sanitizeShortcutBinding(config.awakeSleepToggleShortcut, defaultAwakeSleepToggleShortcut);
  config.turnOffShortcut = sanitizeShortcutBinding(config.turnOffShortcut, defaultTurnOffShortcut);
  config.pauseResumeShortcut = sanitizeShortcutBinding(config.pauseResumeShortcut, defaultPauseResumeShortcut);
  if (!String(config.installationId || '').trim()) {
    config.installationId = createInstallationId();
  }
  return config;
}

const modifierOnlyShortcutKeys = new Set(['shift', 'control', 'ctrl', 'alt', 'meta', 'os']);
const supportedPunctuationShortcutKeys = new Set([
  ')', '!', '@', '#', '$', '%', '^', '&', '*', '(', ':', ';', '=', '<', ',', '_', '-', '>', '.', '?', '/', '~', '`', '{', ']', '[', '|', '\\', '}', '"',
]);

function normalizeShortcutKey(raw) {
  const key = String(raw ?? '');
  if (!key) return '';
  if (key === ' ') return 'space';
  const lower = key.trim().toLowerCase();
  if (!lower) return '';
  if (lower === 'spacebar') return 'space';
  if (lower === 'esc') return 'escape';
  if (lower === 'return') return 'enter';
  return lower;
}

function sanitizeShortcutBinding(value, fallback = null) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return cloneShortcutBinding(fallback);
  const key = normalizeShortcutKey(value.key);
  if (!key || modifierOnlyShortcutKeys.has(key)) return cloneShortcutBinding(fallback);
  const mod = value.mod === true;
  return {
    key,
    mod,
    ctrl: mod ? false : value.ctrl === true,
    meta: mod ? false : value.meta === true,
    alt: value.alt === true,
    altGraph: value.altGraph === true,
    shift: value.shift === true,
  };
}

function cloneShortcutBinding(binding) {
  return binding ? { ...binding } : null;
}

function shortcutKeyLabel(key) {
  if (/^num[0-9]$/.test(key)) return `Numpad ${key.slice(3)}`;
  if (key === 'numdec') return 'Numpad .';
  if (key === 'numadd') return 'Numpad +';
  if (key === 'numsub') return 'Numpad -';
  if (key === 'nummult') return 'Numpad *';
  if (key === 'numdiv') return 'Numpad /';
  if (key === 'numenter') return 'Numpad Enter';
  if (key === 'space') return 'Space';
  if (key === 'escape') return 'Esc';
  if (key === 'arrowup') return 'Up';
  if (key === 'arrowdown') return 'Down';
  if (key === 'arrowleft') return 'Left';
  if (key === 'arrowright') return 'Right';
  if (key === 'pageup') return 'Page Up';
  if (key === 'pagedown') return 'Page Down';
  if (key === 'capslock') return 'Caps Lock';
  if (key === 'backspace') return 'Backspace';
  if (key === 'delete') return 'Delete';
  if (key === 'insert') return 'Insert';
  if (key === 'home') return 'Home';
  if (key === 'end') return 'End';
  if (key === 'tab') return 'Tab';
  if (key === 'enter') return 'Enter';
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function formatShortcutBinding(binding) {
  if (!binding) return 'Not set';
  const parts = [];
  if (binding.mod) parts.push('Ctrl/Cmd');
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.meta) parts.push('Meta');
  if (binding.alt) parts.push('Alt');
  if (binding.altGraph) parts.push('AltGr');
  if (binding.shift) parts.push('Shift');
  parts.push(shortcutKeyLabel(binding.key));
  return parts.join('+');
}

function shortcutKeyAccelerator(key) {
  if (/^num[0-9]$/.test(key)) return key;
  if (/^[a-z]$/.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) return key.toUpperCase();
  if (supportedPunctuationShortcutKeys.has(key)) return key;
  const map = {
    numdec: 'numdec',
    numadd: 'numadd',
    numsub: 'numsub',
    nummult: 'nummult',
    numdiv: 'numdiv',
    space: 'Space',
    tab: 'Tab',
    enter: 'Return',
    escape: 'Esc',
    backspace: 'Backspace',
    delete: 'Delete',
    insert: 'Insert',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    arrowup: 'Up',
    arrowdown: 'Down',
    arrowleft: 'Left',
    arrowright: 'Right',
    '+': 'Plus',
  };
  return map[key] || '';
}

function shortcutBindingToAccelerator(binding) {
  if (!binding) return '';
  const key = shortcutKeyAccelerator(binding.key);
  if (!key) return '';
  const parts = [];
  if (binding.mod) parts.push('CommandOrControl');
  if (binding.ctrl) parts.push('Control');
  if (binding.meta) parts.push(process.platform === 'darwin' ? 'Command' : 'Super');
  if (binding.alt) parts.push('Alt');
  if (binding.altGraph) parts.push('AltGr');
  if (binding.shift) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

function unsupportedShortcutRegistrationError(binding) {
  if (binding?.key === 'numenter') {
    return 'Numpad Enter is not supported for background shortcuts by Electron yet. Choose another key.';
  }
  return 'This key cannot be registered as a background shortcut.';
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

function newLocalSecret(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

function localNetworkHosts() {
  const hosts = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry && entry.family === 'IPv4' && !entry.internal && entry.address && !hosts.includes(entry.address)) {
        hosts.push(entry.address);
      }
    }
  }
  return hosts.length ? hosts : ['127.0.0.1'];
}

function parseJsonRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.byteLength;
      if (bytes > 16_384) {
        reject(new Error('request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(body));
}

function stopLocalDesktopAuthServer() {
  if (localDesktopAuth.expiryTimer) {
    clearTimeout(localDesktopAuth.expiryTimer);
  }
  if (localDesktopAuth.server) {
    localDesktopAuth.server.close();
  }
  localDesktopAuth = { server: null, callbackUrls: [], secret: '', deviceToken: '', expiresAt: 0, expiryTimer: null };
}

function desktopAuthPayloadUrl(input) {
  const payload = new URL('voicestream://desktop-auth');
  payload.searchParams.set('callbackUrl', input.callbackUrls[0] || '');
  payload.searchParams.set('callbackUrls', JSON.stringify(input.callbackUrls));
  payload.searchParams.set('callbackSecret', input.secret);
  payload.searchParams.set('deviceToken', input.deviceToken);
  payload.searchParams.set('displayName', input.displayName);
  payload.searchParams.set('installationId', input.installationId);
  payload.searchParams.set('expiresAt', new Date(input.expiresAt).toISOString());
  payload.searchParams.set('minClientVersion', '1');
  return payload.toString();
}

function cleanHttpBaseUrl(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol');
    if (!url.hostname) throw new Error('missing host');
    return `${url.protocol}//${url.host}`;
  } catch {
    throw new Error('server URL must be an http(s) URL');
  }
}

function desktopClaimProof(token, claim) {
  return createHmac('sha256', token)
    .update(JSON.stringify({
      serverUrl: claim.serverUrl,
      deviceId: claim.deviceId,
      displayName: claim.displayName,
    }))
    .digest('base64url');
}

function proofMatches(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  return actualBuffer.byteLength === expectedBuffer.byteLength && timingSafeEqual(actualBuffer, expectedBuffer);
}

async function startLocalDesktopAuthServer(input = {}) {
  stopLocalDesktopAuthServer();
  const config = readConfig();
  const displayName = String(input.displayName || config.deviceName || 'Desktop voice client').trim() || 'Desktop voice client';
  const installationId = String(input.installationId || config.installationId || '').trim();
  const secret = newLocalSecret();
  const deviceToken = newLocalSecret(32);
  const expiresAt = Date.now() + LOCAL_DESKTOP_AUTH_TTL_MS;
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }
    if (req.method !== 'POST' || req.url !== '/desktop-auth/claim') {
      sendJson(res, 404, { ok: false, error: 'not found' });
      return;
    }
    try {
      if (Date.now() > localDesktopAuth.expiresAt) {
        sendJson(res, 410, { ok: false, error: 'desktop sign-in QR expired' });
        return;
      }
      const body = await parseJsonRequest(req);
      if (String(body.callbackSecret || '') !== localDesktopAuth.secret) {
        sendJson(res, 401, { ok: false, error: 'invalid desktop sign-in QR' });
        return;
      }
      const serverUrl = cleanHttpBaseUrl(body.serverUrl);
      const deviceId = String(body.deviceId || '').trim();
      const claimedName = String(body.displayName || displayName).trim() || displayName;
      if (!serverUrl || !deviceId) {
        sendJson(res, 400, { ok: false, error: 'server URL and device id are required' });
        return;
      }
      const expectedProof = desktopClaimProof(localDesktopAuth.deviceToken, {
        serverUrl,
        deviceId,
        displayName: claimedName,
      });
      if (!proofMatches(body.claimProof, expectedProof)) {
        sendJson(res, 401, { ok: false, error: 'invalid desktop claim proof' });
        return;
      }
      const saved = writeConfig({
        ...readConfig(),
        serverUrl,
        deviceId,
        deviceToken: localDesktopAuth.deviceToken,
        deviceName: claimedName,
      });
      restartExtensionBridge();
      sendJson(res, 200, { ok: true });
      stopLocalDesktopAuthServer();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop-auth:claimed', saved);
      }
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error?.message || 'desktop sign-in failed' });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const port = server.address().port;
  const callbackUrls = localNetworkHosts().map((host) => `http://${host}:${port}/desktop-auth/claim`);
  const expiryTimer = setTimeout(stopLocalDesktopAuthServer, Math.max(0, expiresAt - Date.now()));
  expiryTimer.unref?.();
  localDesktopAuth = { server, callbackUrls, secret, deviceToken, expiresAt, expiryTimer };
  return {
    ok: true,
    payload: desktopAuthPayloadUrl({ callbackUrls, secret, deviceToken, displayName, installationId, expiresAt }),
    callbackUrl: callbackUrls[0] || '',
    callbackUrls,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function windowDebugLog(message, details = {}) {
  try {
    const file = path.join(app.getPath('userData'), 'voice-stream-next-window-debug.log');
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, message, ...details })}\n`);
  } catch {
    // Debug logging must never affect window behavior.
  }
}

function commandLogPath() {
  return path.join(app.getPath('userData'), 'voice-stream-next-command-debug.log');
}

function sanitizeCommandLogEntry(entry = {}) {
  const value = entry && typeof entry === 'object' ? entry : {};
  const clean = (raw, max = 500) => String(raw ?? '').slice(0, max);
  const outcome = clean(value.outcome, 40);
  return {
    at: clean(value.at || new Date().toISOString(), 80),
    mode: clean(value.mode, 40),
    source: clean(value.source, 40),
    text: clean(value.text, 500),
    final: Boolean(value.final),
    outcome: outcome || 'event',
    command: clean(value.command, 80),
    reason: clean(value.reason, 160),
  };
}

function readCommandLogEntries(limit = 200) {
  try {
    const file = commandLogPath();
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}

function trimCommandLogFile() {
  try {
    const file = commandLogPath();
    if (!fs.existsSync(file) || fs.statSync(file).size <= 256 * 1024) return;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-250);
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
  } catch {
    // Command logging must never affect recognition.
  }
}

function appendCommandLog(entry) {
  const file = commandLogPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const saved = sanitizeCommandLogEntry(entry);
  fs.appendFileSync(file, `${JSON.stringify(saved)}\n`);
  trimCommandLogFile();
  return { ok: true, entry: saved, logs: readCommandLogEntries() };
}

function clearCommandLogs() {
  try {
    fs.writeFileSync(commandLogPath(), '');
  } catch {
    // Ignore missing or temporarily unavailable log files.
  }
  return { ok: true, logs: [] };
}

const callRecorderState = {
  child: null,
  sessionId: '',
  recordingId: '',
  audioUrl: '',
  transcriptUrl: '',
  uploadBuffer: Buffer.alloc(0),
  uploadQueue: Promise.resolve(),
  uploadError: null,
  uploadedBytes: 0,
  transcriptText: '',
  startedAt: 0,
  stderr: '',
  sources: [],
  mode: 'idle',
  message: 'Ready to record computer audio.',
  error: '',
};

function callRecorderStatus(extra = {}) {
  return {
    ok: true,
    mode: callRecorderState.mode,
    message: callRecorderState.message,
    error: callRecorderState.error || null,
    sessionId: callRecorderState.sessionId || null,
    recordingId: callRecorderState.recordingId || null,
    audioUrl: callRecorderState.audioUrl || null,
    transcriptUrl: callRecorderState.transcriptUrl || null,
    uploadedBytes: callRecorderState.uploadedBytes || 0,
    transcriptText: callRecorderState.transcriptText || '',
    startedAt: callRecorderState.startedAt ? new Date(callRecorderState.startedAt).toISOString() : null,
    durationMs: callRecorderState.startedAt && callRecorderState.mode === 'recording' ? Date.now() - callRecorderState.startedAt : null,
    sources: callRecorderState.sources,
    ...extra,
  };
}

function sendCallRecorderStatus(status = callRecorderStatus()) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('callRecorder:status', status);
}

function callRecorderFfmpegCommand() {
  return String(process.env.VOICE_STREAM_NEXT_CALL_RECORDER_FFMPEG || process.env.FFMPEG_PATH || 'ffmpeg').trim() || 'ffmpeg';
}

function parseCallRecorderSource(raw, fallbackFormat, fallbackInput, label) {
  const value = String(raw || '').trim();
  const text = value || `${fallbackFormat}:${fallbackInput}`;
  const match = /^(pulse|alsa|avfoundation|dshow|wasapi):(.*)$/i.exec(text);
  if (match) {
    return { label, format: match[1].toLowerCase(), input: match[2] };
  }
  return { label, format: fallbackFormat, input: text };
}

function callRecorderInputArgs(source) {
  if (source.format === 'pulse') return ['-f', 'pulse', '-thread_queue_size', '4096', '-i', source.input];
  if (source.format === 'alsa') return ['-f', 'alsa', '-thread_queue_size', '4096', '-i', source.input];
  if (source.format === 'avfoundation') return ['-f', 'avfoundation', '-thread_queue_size', '4096', '-i', source.input];
  if (source.format === 'dshow') return ['-f', 'dshow', '-thread_queue_size', '4096', '-i', source.input];
  if (source.format === 'wasapi') return ['-f', 'wasapi', '-thread_queue_size', '4096', '-i', source.input];
  throw new Error(`Unsupported call recorder source format: ${source.format}`);
}

function defaultCallRecorderSources() {
  const micDisabled = /^(0|false|no)$/i.test(String(process.env.VOICE_STREAM_NEXT_CALL_RECORDER_MIC_ENABLED ?? '1').trim());
  const systemDisabled = /^(0|false|no)$/i.test(String(process.env.VOICE_STREAM_NEXT_CALL_RECORDER_SYSTEM_ENABLED ?? '1').trim());
  const sources = [];
  if (!micDisabled) {
    if (process.platform === 'darwin') {
      sources.push(parseCallRecorderSource(process.env.VOICE_STREAM_NEXT_CALL_RECORDER_MIC_SOURCE, 'avfoundation', ':0', 'microphone'));
    } else if (process.platform === 'win32') {
      sources.push(parseCallRecorderSource(process.env.VOICE_STREAM_NEXT_CALL_RECORDER_MIC_SOURCE, 'dshow', 'audio=default', 'microphone'));
    } else {
      sources.push(parseCallRecorderSource(process.env.VOICE_STREAM_NEXT_CALL_RECORDER_MIC_SOURCE, 'pulse', 'default', 'microphone'));
    }
  }
  if (!systemDisabled) {
    if (process.platform === 'linux') {
      sources.push(parseCallRecorderSource(process.env.VOICE_STREAM_NEXT_CALL_RECORDER_SYSTEM_SOURCE, 'pulse', '@DEFAULT_MONITOR@', 'system'));
    } else if (process.env.VOICE_STREAM_NEXT_CALL_RECORDER_SYSTEM_SOURCE) {
      const fallbackFormat = process.platform === 'darwin' ? 'avfoundation' : process.platform === 'win32' ? 'wasapi' : 'pulse';
      sources.push(parseCallRecorderSource(process.env.VOICE_STREAM_NEXT_CALL_RECORDER_SYSTEM_SOURCE, fallbackFormat, '', 'system'));
    }
  }
  return sources.filter((source) => source.input);
}

function callRecorderFfmpegArgs(sources) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const source of sources) args.push(...callRecorderInputArgs(source));
  if (sources.length > 1) {
    const inputs = sources.map((_source, index) => `[${index}:a]`).join('');
    args.push(
      '-filter_complex',
      `${inputs}amix=inputs=${sources.length}:duration=longest:dropout_transition=0:normalize=1,aresample=16000,pan=mono|c0=c0[a]`,
      '-map',
      '[a]',
    );
  } else {
    args.push('-map', '0:a');
  }
  args.push('-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1');
  return args;
}

async function startCallRecording() {
  if (callRecorderState.child || callRecorderState.mode === 'transcribing') {
    return callRecorderStatus();
  }
  const sources = defaultCallRecorderSources();
  if (sources.length === 0) {
    throw new Error('No call recording audio sources are configured.');
  }
  const liveSession = await startLiveCallRecordingSession();
  const command = callRecorderFfmpegCommand();
  const args = callRecorderFfmpegArgs(sources);
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  callRecorderState.child = child;
  callRecorderState.sessionId = liveSession.sessionId || '';
  callRecorderState.recordingId = liveSession.recording?.id || '';
  callRecorderState.audioUrl = callRecorderState.recordingId ? `/api/voice/recordings/${encodeURIComponent(callRecorderState.recordingId)}/audio` : '';
  callRecorderState.transcriptUrl = '';
  callRecorderState.uploadBuffer = Buffer.alloc(0);
  callRecorderState.uploadQueue = Promise.resolve();
  callRecorderState.uploadError = null;
  callRecorderState.uploadedBytes = 0;
  callRecorderState.transcriptText = '';
  callRecorderState.startedAt = Date.now();
  callRecorderState.stderr = '';
  callRecorderState.sources = sources.map((source) => ({
    label: source.label,
    format: source.format,
    input: source.input,
  }));
  callRecorderState.mode = 'recording';
  callRecorderState.message = sources.some((source) => source.label === 'system')
    ? 'Recording microphone and computer audio.'
    : 'Recording microphone audio. Configure a system loopback source to include computer audio.';
  callRecorderState.error = '';
  child.stderr?.on('data', (chunk) => {
    callRecorderState.stderr = `${callRecorderState.stderr}${String(chunk || '')}`.slice(-4000);
  });
  child.stdout?.on('data', (chunk) => {
    bufferCallRecorderAudio(chunk);
  });
  child.on('error', (error) => {
    if (callRecorderState.child === child) callRecorderState.child = null;
    void finalizeCallRecorderAfterQueuedUploads();
    callRecorderState.mode = 'error';
    callRecorderState.error = error?.message || String(error);
    callRecorderState.message = `Call recording failed: ${callRecorderState.error}`;
    sendCallRecorderStatus();
  });
  child.on('exit', (code, signal) => {
    if (callRecorderState.child !== child) return;
    callRecorderState.child = null;
    if (callRecorderState.mode === 'recording') {
      callRecorderState.mode = 'error';
      const detail = callRecorderState.stderr.trim() || `ffmpeg exited ${code ?? signal ?? 'unknown'}`;
      callRecorderState.error = detail;
      callRecorderState.message = `Call recording stopped unexpectedly: ${detail}`;
      void finalizeCallRecorderAfterQueuedUploads();
      sendCallRecorderStatus();
    }
  });
  const status = callRecorderStatus();
  sendCallRecorderStatus(status);
  return status;
}

function waitForCallRecorderExit(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore kill races while stopping ffmpeg.
      }
    }, 2500);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.stdin?.write('q');
      child.stdin?.end();
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore stale child cleanup.
      }
    }
  });
}

function callRecorderAuthHeaders(config) {
  return {
    'x-voice-device-id': config.deviceId,
    'x-voice-device-token': config.deviceToken,
    'x-voice-installation-id': config.installationId || '',
    'x-voice-client-version': '1',
  };
}

async function parseCallRecorderResponse(response) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text };
  }
  if (!response.ok) throw new Error(body?.error || `${response.status} ${response.statusText}`);
  return body || { ok: true };
}

async function startLiveCallRecordingSession() {
  const config = readConfig();
  if (!config.deviceId || !config.deviceToken) throw new Error('Sign in before recording computer audio.');
  const response = await fetch(`${trimSlash(config.serverUrl)}/api/voice/live-recordings/start`, {
    method: 'POST',
    headers: {
      ...callRecorderAuthHeaders(config),
    },
  });
  return parseCallRecorderResponse(response);
}

async function uploadLiveCallRecordingChunk(chunk, final = false) {
  if (!callRecorderState.sessionId || (!final && chunk.byteLength === 0)) return { ok: true };
  const config = readConfig();
  const suffix = final ? '/stop' : '/chunk';
  const response = await fetch(`${trimSlash(config.serverUrl)}/api/voice/live-recordings/${encodeURIComponent(callRecorderState.sessionId)}${suffix}`, {
    method: 'POST',
    headers: {
      ...callRecorderAuthHeaders(config),
      'content-type': 'application/octet-stream',
    },
    body: chunk,
  });
  const body = await parseCallRecorderResponse(response);
  if (body.recording?.id) callRecorderState.recordingId = String(body.recording.id);
  if (body.recording?.transcriptText || body.text) callRecorderState.transcriptText = String(body.recording?.transcriptText || body.text || '');
  if (body.audioUrl) callRecorderState.audioUrl = body.audioUrl;
  if (body.transcriptUrl) callRecorderState.transcriptUrl = body.transcriptUrl;
  callRecorderState.uploadedBytes += chunk.byteLength;
  return body;
}

function enqueueCallRecorderUpload(chunk, final = false) {
  if (!chunk || chunk.byteLength === 0) return callRecorderState.uploadQueue;
  const uploadChunk = Buffer.from(chunk);
  callRecorderState.uploadQueue = callRecorderState.uploadQueue
    .then(() => uploadLiveCallRecordingChunk(uploadChunk, final))
    .catch((error) => {
      callRecorderState.uploadError = error;
      throw error;
    });
  return callRecorderState.uploadQueue;
}

function finalizeCallRecorderAfterQueuedUploads() {
  return callRecorderState.uploadQueue
    .catch(() => null)
    .then(() => uploadLiveCallRecordingChunk(Buffer.alloc(0), true))
    .catch(() => null);
}

function bufferCallRecorderAudio(chunk) {
  if (!chunk || chunk.byteLength === 0 || callRecorderState.uploadError) return;
  callRecorderState.uploadBuffer = Buffer.concat([callRecorderState.uploadBuffer, Buffer.from(chunk)]);
  const flushBytes = 32_000;
  if (callRecorderState.uploadBuffer.byteLength < flushBytes) return;
  const flush = callRecorderState.uploadBuffer;
  callRecorderState.uploadBuffer = Buffer.alloc(0);
  void enqueueCallRecorderUpload(flush).catch((error) => {
    if (callRecorderState.child) {
      try {
        callRecorderState.child.kill('SIGTERM');
      } catch {
        // Ignore stop races after upload failure.
      }
    }
    callRecorderState.mode = 'error';
    callRecorderState.error = error?.message || String(error);
    callRecorderState.message = `Live recording upload failed: ${callRecorderState.error}`;
    sendCallRecorderStatus();
  });
}

async function stopCallRecording() {
  const child = callRecorderState.child;
  if (!child || callRecorderState.mode !== 'recording') return callRecorderStatus();
  callRecorderState.mode = 'transcribing';
  callRecorderState.message = 'Stopping recording and finalizing the live transcript.';
  sendCallRecorderStatus();
  callRecorderState.child = null;
  await waitForCallRecorderExit(child);

  const finalChunk = callRecorderState.uploadBuffer;
  callRecorderState.uploadBuffer = Buffer.alloc(0);
  if (callRecorderState.uploadedBytes + finalChunk.byteLength === 0) {
    await uploadLiveCallRecordingChunk(Buffer.alloc(0), true).catch(() => null);
    callRecorderState.mode = 'error';
    callRecorderState.error = callRecorderState.stderr.trim() || 'Recorded audio file is empty.';
    callRecorderState.message = `Call recording failed: ${callRecorderState.error}`;
    const status = callRecorderStatus({ sizeBytes: 0 });
    sendCallRecorderStatus(status);
    return status;
  }

  try {
    await callRecorderState.uploadQueue;
    const finalized = await uploadLiveCallRecordingChunk(finalChunk, true);
    const transcriptText = String(finalized.recording?.transcriptText || finalized.text || callRecorderState.transcriptText || '').trim();
    const recordingId = String(finalized.recording?.id || callRecorderState.recordingId || '');
    callRecorderState.recordingId = recordingId;
    callRecorderState.audioUrl = finalized.audioUrl || (recordingId ? `/api/voice/recordings/${encodeURIComponent(recordingId)}/audio` : callRecorderState.audioUrl);
    callRecorderState.transcriptUrl = finalized.transcriptUrl || callRecorderState.transcriptUrl || '';
    callRecorderState.transcriptText = transcriptText;
    callRecorderState.mode = 'saved';
    callRecorderState.message = transcriptText
      ? `Saved live recording with transcript (${transcriptText.length.toLocaleString()} characters).`
      : 'Saved recording to history. Transcription returned no text.';
    callRecorderState.error = '';
    const status = callRecorderStatus({
      sizeBytes: 44 + callRecorderState.uploadedBytes,
      transcriptText,
      provider: finalized.provider || null,
      model: finalized.model || null,
      audioDurationMs: finalized.recording?.durationMs || null,
      recordingId: callRecorderState.recordingId || null,
      audioUrl: callRecorderState.audioUrl || null,
      transcriptUrl: callRecorderState.transcriptUrl || null,
    });
    sendCallRecorderStatus(status);
    return status;
  } catch (error) {
    await uploadLiveCallRecordingChunk(Buffer.alloc(0), true).catch(() => null);
    callRecorderState.mode = 'error';
    callRecorderState.error = error?.message || String(error);
    callRecorderState.message = `Live recording finalization failed: ${callRecorderState.error}`;
    const status = callRecorderStatus({ sizeBytes: 44 + callRecorderState.uploadedBytes });
    sendCallRecorderStatus(status);
    return status;
  }
}

function desktopWebUrl(config) {
  if (config.webUrl) return trimSlash(config.webUrl);
  const serverUrl = trimSlash(config.serverUrl);
  if (!serverUrl) return '';
  try {
    const url = new URL(serverUrl);
    if (url.port === '3299') {
      url.port = '5185';
      return trimSlash(url.toString());
    }
  } catch {
    // Fall back to the server URL when it is not a valid absolute URL.
  }
  return serverUrl;
}

function openCallRecordingLocation() {
  const config = readConfig();
  const baseUrl = desktopWebUrl(config) || trimSlash(config.serverUrl);
  if (!baseUrl) return { ok: false };
  shell.openExternal(`${baseUrl}/settings/recordings`);
  return { ok: true };
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
      grammar: currentVoskGrammar,
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
      grammar: currentVoskGrammar,
    });
  });
  return voskState.workerStarting;
}

function resolveVoskGrammar(mode, settings = {}) {
  const triggerPhrase = String(settings.triggerPhrase || 'approval code').trim();
  const unlockPhrase = String(settings.unlockPhrase || defaultVoicePhraseSettings.unlockPhrase).trim();
  const shutdownPhrase = String(settings.shutdownPhrase || defaultVoicePhraseSettings.shutdownPhrase).trim();
  const assistantWakePhrases = Array.isArray(settings.assistantProfiles)
    ? settings.assistantProfiles
      .filter((profile) => profile?.enabled !== false)
      .flatMap((profile) => [profile?.wakePhrase, ...(Array.isArray(profile?.wakePhraseAliases) ? profile.wakePhraseAliases : [])])
      .map((phrase) => String(phrase || '').trim())
      .filter(Boolean)
    : [];
  if (mode === 'sleep') {
    return voicePhrases.buildSleepWakeGrammar({ unlockPhrase, shutdownPhrase });
  }
  return voicePhrases.buildAwakeWakeGrammar({ triggerPhrase, shutdownPhrase, assistantWakePhrases });
}

async function applyVoskGrammar(mode, settings = {}) {
  currentVoskGrammar = resolveVoskGrammar(mode, settings);
  if (voskState.workerReady && voskState.worker) {
    releaseVosk();
    return ensureVoskRecognizer();
  }
  if (voskState.recognizer) {
    releaseVosk();
    return ensureVoskRecognizer();
  }
  return statusForVosk(false);
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

function createShortcutRegistration({ defaultBinding, configKey, onTrigger }) {
  let registeredAccelerator = '';
  let status = { registered: false, accelerator: '', label: 'Not set', error: '' };

  function register() {
    if (!app.isReady()) return status;
    if (registeredAccelerator) {
      globalShortcut.unregister(registeredAccelerator);
      registeredAccelerator = '';
    }

    const config = readConfig();
    const binding = sanitizeShortcutBinding(config[configKey], defaultBinding);
    const accelerator = shortcutBindingToAccelerator(binding);
    const label = formatShortcutBinding(binding);
    if (!binding || !accelerator) {
      status = {
        registered: false,
        accelerator: '',
        label,
        error: binding ? unsupportedShortcutRegistrationError(binding) : '',
      };
      sendShortcutStatuses();
      return status;
    }

    const registered = globalShortcut.register(accelerator, onTrigger);
    registeredAccelerator = registered ? accelerator : '';
    status = {
      registered,
      accelerator,
      label,
      error: registered ? '' : 'The operating system or another app is already using this shortcut.',
    };
    sendShortcutStatuses();
    return status;
  }

  return { register, getStatus: () => status, defaultBinding, configKey };
}

function allShortcutStatuses() {
  return {
    transcription: transcriptionShortcutRegistration.getStatus(),
    awakeSleepToggle: awakeSleepToggleShortcutRegistration.getStatus(),
    turnOff: turnOffShortcutRegistration.getStatus(),
    pauseResume: pauseResumeShortcutRegistration.getStatus(),
  };
}

function sendShortcutStatuses(win = mainWindow) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('shortcut:status', allShortcutStatuses());
}

function registerAllGlobalShortcuts() {
  transcriptionShortcutRegistration.register();
  awakeSleepToggleShortcutRegistration.register();
  turnOffShortcutRegistration.register();
  pauseResumeShortcutRegistration.register();
  return allShortcutStatuses();
}

function triggerRendererShortcut(channel) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow({ compactShowInactive: true });
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send(channel);
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function triggerTranscriptionShortcut() {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow({ compactShowInactive: true });
  const restoreWindowMode = win.isVisible() && !win.isMinimized()
    ? (compactMode ? 'compact' : 'expanded')
    : 'hidden';
  const temporaryOverlay = restoreWindowMode !== 'compact';
  applyCompactMode(win, { inactive: true });
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send('shortcut:transcription', { temporaryOverlay, restoreWindowMode });
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function triggerAwakeSleepToggleShortcut() {
  triggerRendererShortcut('shortcut:toggleAwakeSleep');
}

function triggerTurnOffShortcut() {
  triggerRendererShortcut('shortcut:turnOff');
}

function triggerPauseResumeShortcut() {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow({ compactShowInactive: true });
  const shouldShowCompact = ['recording', 'paused'].includes(trayStatus.mode) && (!win.isVisible() || win.isMinimized());
  if (shouldShowCompact) applyCompactMode(win, { inactive: true });
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send('shortcut:pauseResume');
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

const transcriptionShortcutRegistration = createShortcutRegistration({
  defaultBinding: defaultTranscriptionShortcut,
  configKey: 'transcriptionShortcut',
  onTrigger: triggerTranscriptionShortcut,
});

const awakeSleepToggleShortcutRegistration = createShortcutRegistration({
  defaultBinding: defaultAwakeSleepToggleShortcut,
  configKey: 'awakeSleepToggleShortcut',
  onTrigger: triggerAwakeSleepToggleShortcut,
});

const turnOffShortcutRegistration = createShortcutRegistration({
  defaultBinding: defaultTurnOffShortcut,
  configKey: 'turnOffShortcut',
  onTrigger: triggerTurnOffShortcut,
});

const pauseResumeShortcutRegistration = createShortcutRegistration({
  defaultBinding: defaultPauseResumeShortcut,
  configKey: 'pauseResumeShortcut',
  onTrigger: triggerPauseResumeShortcut,
});

function restoreTemporaryOverlay(win, restoreWindowMode) {
  if (!win || win.isDestroyed()) return windowStatePayload();
  if (!compactMode) return windowStatePayload();
  if (restoreWindowMode === 'expanded') return applyExpandedMode(win);
  if (restoreWindowMode === 'hidden') {
    hideToTray(win);
    return windowStatePayload();
  }
  return windowStatePayload();
}

function showWindow(win, options = {}) {
  if (options.inactive && typeof win.showInactive === 'function') {
    win.showInactive();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
}

function applyCompactMode(win, options = {}) {
  if (!win || win.isDestroyed()) return windowStatePayload();
  windowDebugLog('applyCompactMode:start', { snapshot: windowSnapshot(win) });
  if (!compactMode) normalWindowBounds = win.getBounds();
  compactMode = true;
  win.setMinimumSize(compactWindow.width, compactWindow.height);
  win.setResizable(false);
  win.setAlwaysOnTop(true, 'floating');
  win.setSkipTaskbar(true);
  win.setBounds(compactBoundsForWindow(win));
  showWindow(win, options);
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

function extensionBridgeUrl(config) {
  const url = new URL(`/api/devices/${encodeURIComponent(config.deviceId)}/extensions`, trimSlash(config.serverUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', config.deviceToken);
  url.searchParams.set('clientVersion', '1');
  url.searchParams.set('protocolVersion', '1');
  return url.toString();
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function extensionToolName(extensionId, toolName) {
  return `${safeExtensionToolSegment(extensionId).replace(/_/g, '-')}__${safeExtensionToolSegment(toolName)}`;
}

function safeExtensionToolSegment(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function cleanExtensionConfigs(config = readConfig()) {
  const entries = Array.isArray(config.extensions) ? config.extensions : [];
  return entries
    .map((entry, index) => {
      const value = entry && typeof entry === 'object' ? entry : {};
      const id = safeExtensionToolSegment(value.id || path.basename(String(value.path || `extension_${index}`), path.extname(String(value.path || '')))).replace(/_/g, '-');
      const extensionPath = String(value.path || '').trim();
      if (!id || !extensionPath) return null;
      return {
        id,
        name: String(value.name || id).trim() || id,
        path: extensionPath,
        enabled: value.enabled !== false,
        config: value.config && typeof value.config === 'object' && !Array.isArray(value.config) ? value.config : {},
      };
    })
    .filter(Boolean);
}

function extensionConfigKey(configs) {
  return JSON.stringify(configs.map((item) => ({
    id: item.id,
    name: item.name,
    path: item.path,
    enabled: item.enabled,
    config: item.config,
  })));
}

function extensionStatePath() {
  return path.join(app.getPath('userData'), 'voice-stream-next-extension-state.json');
}

function readExtensionState() {
  try {
    return JSON.parse(fs.readFileSync(extensionStatePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeExtensionState(state) {
  fs.mkdirSync(path.dirname(extensionStatePath()), { recursive: true });
  fs.writeFileSync(extensionStatePath(), JSON.stringify(state, null, 2));
}

async function postAssistantThreadPromptFromExtension(extensionId, threadId, prompt, options = {}) {
  const config = readConfig();
  const cleanThreadId = String(threadId || '').trim();
  const cleanPrompt = String(prompt || '').trim();
  if (!config.deviceId || !config.deviceToken) throw new Error('desktop device is not paired with Drone');
  if (!cleanThreadId) throw new Error('threadId is required');
  if (!cleanPrompt) throw new Error('prompt is required');
  if (typeof fetch !== 'function') throw new Error('fetch is not available in this desktop runtime');

  const url = new URL(`/api/devices/${encodeURIComponent(config.deviceId)}/assistant/threads/${encodeURIComponent(cleanThreadId)}/prompt`, trimSlash(config.serverUrl));
  const body = {
    token: config.deviceToken,
    clientVersion: 1,
    source: 'extension',
    extensionId: String(extensionId || '').trim(),
    prompt: cleanPrompt,
    ...(options.provider ? { provider: String(options.provider) } : {}),
    ...(options.model ? { model: String(options.model) } : {}),
    ...(options.thinkingLevel ? { thinkingLevel: String(options.thinkingLevel) } : {}),
  };
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error(String(data?.error || text || `assistant prompt failed with ${response.status}`));
  return data;
}

function createExtensionApi(extensionConfig, manifest, tools) {
  return {
    id: extensionConfig.id,
    name: extensionConfig.name,
    config: { ...extensionConfig.config },
    log(message, details = {}) {
      windowDebugLog('extension:log', { extensionId: extensionConfig.id, message: String(message || ''), details });
    },
    registerTool(tool) {
      const value = tool && typeof tool === 'object' ? tool : {};
      const localName = safeExtensionToolSegment(value.name);
      if (!localName) throw new Error(`extension ${extensionConfig.id} registered a tool without a name`);
      if (typeof value.execute !== 'function') throw new Error(`extension ${extensionConfig.id}.${localName} is missing execute(args, context)`);
      const fullName = extensionToolName(extensionConfig.id, localName);
      if (tools.has(fullName)) throw new Error(`duplicate extension tool: ${fullName}`);
      const approvalEvaluator = typeof value.approval === 'function' ? value.approval : null;
      const toolManifest = {
        name: localName,
        label: String(value.label || localName.replace(/_/g, ' ')).trim(),
        description: String(value.description || `${localName} extension tool`).trim(),
        inputSchema: normalizeExtensionInputSchema(value.inputSchema),
        approval: approvalEvaluator ? 'dynamic' : cleanExtensionApproval(value.approval),
        supportedTargets: cleanExtensionTargets(value.supportedTargets || value.targets),
        defaultTarget: cleanExtensionTarget(value.defaultTarget, 'device'),
      };
      const targetSlot = safeExtensionToolSegment(value.targetSlot || '');
      if (targetSlot) toolManifest.targetSlot = targetSlot;
      if (!toolManifest.supportedTargets.includes(toolManifest.defaultTarget)) {
        toolManifest.defaultTarget = toolManifest.supportedTargets[0] || 'device';
      }
      manifest.tools.push(toolManifest);
      tools.set(fullName, {
        extensionId: extensionConfig.id,
        name: localName,
        fullName,
        execute: value.execute,
        approval: approvalEvaluator,
      });
    },
    registerSkill(skill) {
      const value = skill && typeof skill === 'object' ? skill : {};
      const name = String(value.name || '').trim();
      const slug = String(value.slug || name)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
      if (!name || !slug) throw new Error(`extension ${extensionConfig.id} registered a skill without a name`);
      const rawToolNames = Array.isArray(value.toolNames) ? value.toolNames : [];
      const toolNames = [...new Set(rawToolNames.map((toolName) => {
        const text = String(toolName || '').trim();
        if (!text) return '';
        return text.includes('__') ? normalizeExtensionSkillToolName(text) : extensionToolName(extensionConfig.id, text);
      }).filter(Boolean))];
      manifest.skills.push({
        slug,
        name,
        description: String(value.description || `${name} extension skill`).trim(),
        markdownBody: String(value.markdownBody || value.instructions || '').trim(),
        toolNames,
        disableModelInvocation: value.disableModelInvocation === true,
      });
    },
    assistant: {
      async promptThread(threadId, prompt, options = {}) {
        return postAssistantThreadPromptFromExtension(extensionConfig.id, threadId, prompt, options);
      },
    },
    state: {
      async get(key, fallback = null) {
        const state = readExtensionState();
        const bucket = state[extensionConfig.id] && typeof state[extensionConfig.id] === 'object' ? state[extensionConfig.id] : {};
        return Object.prototype.hasOwnProperty.call(bucket, key) ? bucket[key] : fallback;
      },
      async set(key, value) {
        const state = readExtensionState();
        const bucket = state[extensionConfig.id] && typeof state[extensionConfig.id] === 'object' ? state[extensionConfig.id] : {};
        bucket[String(key)] = value;
        state[extensionConfig.id] = bucket;
        writeExtensionState(state);
      },
    },
  };
}

function normalizeExtensionInputSchema(schema) {
  const value = schema && typeof schema === 'object' && !Array.isArray(schema) ? schema : {};
  return {
    type: 'object',
    properties: value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties) ? value.properties : {},
    required: Array.isArray(value.required) ? value.required.map((item) => String(item)).filter(Boolean) : [],
    additionalProperties: value.additionalProperties === true,
  };
}

function normalizeExtensionSkillToolName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
}

function cleanExtensionApproval(value) {
  const approval = String(value || '').trim();
  return approval === 'never' || approval === 'normal_threads' || approval === 'always' || approval === 'dynamic' ? approval : 'always';
}

function cleanExtensionTarget(value, fallback = 'device') {
  const target = String(value || '').trim();
  return target === 'server' || target === 'device' || target === 'any_device' ? target : fallback;
}

function cleanExtensionTargets(value) {
  const values = Array.isArray(value) ? value : [value];
  const targets = values.map((item) => cleanExtensionTarget(item, '')).filter(Boolean);
  return targets.length > 0 ? [...new Set(targets)] : ['device'];
}

function titleFromExtensionId(id) {
  return String(id || 'extension')
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Extension';
}

function extensionIdFromFilePath(filePath) {
  const baseName = path.basename(String(filePath || ''), path.extname(String(filePath || '')));
  return safeExtensionToolSegment(baseName.replace(/[-_]?extension$/i, '')).replace(/_/g, '-') || 'extension';
}

function assertLoadableExtensionPath(filePath) {
  const rawPath = String(filePath || '').trim();
  if (!rawPath) throw new Error('Extension file path is required.');
  const resolved = path.resolve(rawPath);
  const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
  if (!stat?.isFile()) throw new Error('Extension file does not exist.');
  const ext = path.extname(resolved).toLowerCase();
  if (ext !== '.cjs' && ext !== '.js') throw new Error('Extension file must be a .cjs or .js file.');
  return resolved;
}

function bundledWorkspaceExtensionPath() {
  return path.resolve(__dirname, 'extensions', 'workspace-extension.cjs');
}

function workspaceExtensionEntry(existing = {}) {
  const existingConfig = existing.config && typeof existing.config === 'object' && !Array.isArray(existing.config) ? existing.config : {};
  return {
    id: 'workspace',
    name: 'Workspace',
    path: bundledWorkspaceExtensionPath(),
    enabled: true,
    config: {
      ...existingConfig,
      workspaceRoots: uniqueWorkspaceRoots(existingConfig.workspaceRoots),
    },
  };
}

function uniqueWorkspaceRoots(values) {
  const rawValues = Array.isArray(values) ? values : [];
  const seen = new Set();
  const roots = [];
  for (const value of rawValues) {
    const text = String(value || '').trim();
    if (!text) continue;
    const resolved = path.resolve(text);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    roots.push(resolved);
  }
  return roots;
}

async function enableWorkspaceExtension() {
  const config = readConfig();
  const extensions = Array.isArray(config.extensions) ? [...config.extensions] : [];
  const existingIndex = extensions.findIndex((entry) => String(entry?.id || '') === 'workspace');
  const existing = existingIndex >= 0 && extensions[existingIndex] && typeof extensions[existingIndex] === 'object'
    ? extensions[existingIndex]
    : {};
  const entry = workspaceExtensionEntry(existing);
  if (existingIndex >= 0) extensions[existingIndex] = entry;
  else extensions.unshift(entry);
  const savedConfig = writeConfig({ ...config, extensions });
  return { entry, ...(await reloadExtensionsAfterConfigSave(savedConfig)) };
}

async function addWorkspaceRootToConfig(rootPath) {
  const cleanRoot = String(rootPath || '').trim();
  if (!cleanRoot) throw new Error('Workspace root path is required.');
  const resolvedRoot = path.resolve(cleanRoot);
  const stat = fs.existsSync(resolvedRoot) ? fs.statSync(resolvedRoot) : null;
  if (!stat?.isDirectory()) throw new Error('Workspace root must be an existing directory.');
  const config = readConfig();
  const extensions = Array.isArray(config.extensions) ? [...config.extensions] : [];
  const existingIndex = extensions.findIndex((entry) => String(entry?.id || '') === 'workspace');
  const existing = existingIndex >= 0 && extensions[existingIndex] && typeof extensions[existingIndex] === 'object'
    ? extensions[existingIndex]
    : {};
  const entry = workspaceExtensionEntry(existing);
  entry.config.workspaceRoots = uniqueWorkspaceRoots([...(entry.config.workspaceRoots || []), resolvedRoot]);
  if (existingIndex >= 0) extensions[existingIndex] = entry;
  else extensions.unshift(entry);
  const savedConfig = writeConfig({ ...config, extensions });
  return { entry, ...(await reloadExtensionsAfterConfigSave(savedConfig)) };
}

async function saveWorkspaceRootsToConfig(roots) {
  const config = readConfig();
  const extensions = Array.isArray(config.extensions) ? [...config.extensions] : [];
  const existingIndex = extensions.findIndex((entry) => String(entry?.id || '') === 'workspace');
  const existing = existingIndex >= 0 && extensions[existingIndex] && typeof extensions[existingIndex] === 'object'
    ? extensions[existingIndex]
    : {};
  const entry = workspaceExtensionEntry(existing);
  entry.config.workspaceRoots = uniqueWorkspaceRoots(roots);
  if (existingIndex >= 0) extensions[existingIndex] = entry;
  else extensions.unshift(entry);
  const savedConfig = writeConfig({ ...config, extensions });
  return { entry, ...(await reloadExtensionsAfterConfigSave(savedConfig)) };
}

async function reloadExtensionsAfterConfigSave(savedConfig) {
  extensionHost.loaded = false;
  extensionHost.configKey = '';
  await loadDesktopExtensions({ force: true });
  restartExtensionBridge();
  return { ok: true, config: savedConfig, statuses: extensionHost.statuses, manifests: extensionHost.manifests };
}

async function addExtensionFileToConfig(filePath) {
  const resolved = assertLoadableExtensionPath(filePath);
  const config = readConfig();
  const extensions = Array.isArray(config.extensions) ? [...config.extensions] : [];
  const id = extensionIdFromFilePath(resolved);
  const existingIndex = extensions.findIndex((entry) => String(entry?.id || '') === id);
  const existing = existingIndex >= 0 && extensions[existingIndex] && typeof extensions[existingIndex] === 'object'
    ? extensions[existingIndex]
    : {};
  const entry = {
    id,
    name: String(existing.name || titleFromExtensionId(id)).trim() || titleFromExtensionId(id),
    path: resolved,
    enabled: true,
    config: existing.config && typeof existing.config === 'object' && !Array.isArray(existing.config) ? existing.config : {},
  };
  if (existingIndex >= 0) {
    extensions[existingIndex] = entry;
  } else {
    extensions.push(entry);
  }
  const savedConfig = writeConfig({ ...config, extensions });
  return { entry, ...(await reloadExtensionsAfterConfigSave(savedConfig)) };
}

async function deactivateDesktopExtensions() {
  const deactivators = extensionHost.deactivators.splice(0);
  for (const entry of deactivators) {
    try {
      await entry.deactivate();
    } catch (error) {
      windowDebugLog('extension:deactivateFailed', { extensionId: entry.extensionId, error: error?.message || String(error) });
    }
  }
}

async function loadDesktopExtensions(options = {}) {
  const configs = cleanExtensionConfigs();
  const configKey = extensionConfigKey(configs);
  if (!options.force && extensionHost.loaded && extensionHost.configKey === configKey) return extensionHost;
  if (extensionHost.loading) return extensionHost.loading;
  extensionHost.loading = (async () => {
    await deactivateDesktopExtensions();
    const manifests = [];
    const tools = new Map();
    const statuses = [];
    const extensionIds = new Set();
    for (const extensionConfig of configs) {
      if (!extensionConfig.enabled) {
        statuses.push({ id: extensionConfig.id, name: extensionConfig.name, enabled: false, ok: true, toolCount: 0, skillCount: 0 });
        continue;
      }
      const manifest = {
        id: extensionConfig.id,
        name: extensionConfig.name,
        version: '0.0.0',
        tools: [],
        skills: [],
      };
      const existingToolNames = new Set(tools.keys());
      try {
        if (extensionIds.has(extensionConfig.id)) throw new Error(`duplicate extension id: ${extensionConfig.id}`);
        extensionIds.add(extensionConfig.id);
        if (!path.isAbsolute(extensionConfig.path)) throw new Error('extension path must be absolute');
        const modulePath = extensionConfig.path;
        delete require.cache[require.resolve(modulePath)];
        const extensionModule = require(modulePath);
        const activate = extensionModule?.activate || extensionModule?.default?.activate;
        const deactivate = extensionModule?.deactivate || extensionModule?.default?.deactivate;
        if (typeof activate !== 'function') throw new Error('extension must export activate(api)');
        await activate(createExtensionApi(extensionConfig, manifest, tools));
        if (manifest.tools.length === 0 && manifest.skills.length === 0) throw new Error('extension did not register any tools or skills');
        if (typeof deactivate === 'function') {
          extensionHost.deactivators.push({ extensionId: extensionConfig.id, deactivate });
        }
        manifests.push(manifest);
        statuses.push({ id: extensionConfig.id, name: extensionConfig.name, enabled: true, ok: true, toolCount: manifest.tools.length, skillCount: manifest.skills.length });
      } catch (error) {
        for (const toolName of tools.keys()) {
          if (!existingToolNames.has(toolName)) tools.delete(toolName);
        }
        statuses.push({ id: extensionConfig.id, name: extensionConfig.name, enabled: true, ok: false, error: error?.message || String(error), toolCount: 0, skillCount: 0 });
        windowDebugLog('extension:loadFailed', { extensionId: extensionConfig.id, path: extensionConfig.path, error: error?.message || String(error) });
      }
    }
    extensionHost.manifests = manifests;
    extensionHost.tools = tools;
    extensionHost.statuses = statuses;
    extensionHost.loaded = true;
    extensionHost.configKey = configKey;
    return extensionHost;
  })();
  try {
    return await extensionHost.loading;
  } finally {
    extensionHost.loading = null;
  }
}

function desktopExtensionManifests() {
  return extensionHost.manifests;
}

async function executeDesktopExtensionTool(toolName, args, context = {}) {
  const loaded = await loadDesktopExtensions();
  const tool = loaded.tools.get(toolName);
  if (!tool) throw new Error(`unknown desktop extension tool: ${toolName}`);
  return tool.execute(args || {}, {
    ...context,
    toolName,
    extensionId: tool.extensionId,
    localToolName: tool.name,
  });
}

function normalizeExtensionApprovalDecision(value) {
  if (value === false || value === 'never') return false;
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'approvalRequired')) {
    return value.approvalRequired !== false;
  }
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'required')) {
    return value.required !== false;
  }
  return true;
}

async function evaluateDesktopExtensionApproval(toolName, args, context = {}) {
  const loaded = await loadDesktopExtensions();
  const tool = loaded.tools.get(toolName);
  if (!tool) throw new Error(`unknown desktop extension tool: ${toolName}`);
  if (typeof tool.approval !== 'function') return true;
  const decision = await tool.approval(args || {}, {
    ...context,
    toolName,
    extensionId: tool.extensionId,
    localToolName: tool.name,
  });
  return normalizeExtensionApprovalDecision(decision);
}

function stopExtensionBridge() {
  extensionBridge.stopped = true;
  if (extensionBridge.reconnectTimer) {
    clearTimeout(extensionBridge.reconnectTimer);
    extensionBridge.reconnectTimer = null;
  }
  if (extensionBridge.socket) {
    try {
      extensionBridge.socket.close(1000, 'desktop bridge stopped');
    } catch {
      // Closing the bridge is best-effort during app shutdown.
    }
    extensionBridge.socket = null;
  }
}

function scheduleExtensionBridgeReconnect() {
  if (extensionBridge.stopped || extensionBridge.reconnectTimer) return;
  const delay = extensionBridge.reconnectDelayMs;
  extensionBridge.reconnectDelayMs = Math.min(30_000, Math.round(delay * 1.8));
  extensionBridge.reconnectTimer = setTimeout(() => {
    extensionBridge.reconnectTimer = null;
    void startExtensionBridge();
  }, delay);
}

async function startExtensionBridge() {
  const config = readConfig();
  if (!config.extensionBridgeEnabled || !config.deviceId || !config.deviceToken) return;
  await loadDesktopExtensions();
  let WebSocketCtor = globalThis.WebSocket;
  if (typeof WebSocketCtor !== 'function') {
    try {
      WebSocketCtor = require('ws');
    } catch {
      WebSocketCtor = null;
    }
  }
  if (typeof WebSocketCtor !== 'function') {
    windowDebugLog('extensionBridge:unavailable', { reason: 'WebSocket is not available in Electron main' });
    return;
  }
  if (extensionBridge.socket && [0, 1].includes(extensionBridge.socket.readyState)) return;
  extensionBridge.stopped = false;
  let socket;
  try {
    socket = new WebSocketCtor(extensionBridgeUrl(config));
  } catch (error) {
    windowDebugLog('extensionBridge:connectFailed', { error: error?.message || String(error) });
    scheduleExtensionBridgeReconnect();
    return;
  }
  extensionBridge.socket = socket;
  socket.addEventListener('open', () => {
    extensionBridge.reconnectDelayMs = 1000;
    socket.send(JSON.stringify({
      type: 'extension_hello',
      manifests: desktopExtensionManifests(),
      sentAt: new Date().toISOString(),
    }));
    windowDebugLog('extensionBridge:open', { deviceId: config.deviceId ? `${config.deviceId.slice(0, 12)}...` : '' });
  });
  socket.addEventListener('message', async (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.type === 'server_ping') {
      socket.send(JSON.stringify({ type: 'client_ping', sentAt: new Date().toISOString(), serverSentAt: message.sentAt }));
      return;
    }
    if (message.type === 'extension_tool_request') {
      const requestId = String(message.requestId || '');
      const toolName = String(message.toolName || '');
      try {
        const result = await executeDesktopExtensionTool(toolName, message.args, {
          requestId,
          threadId: message.threadId || null,
          runId: message.runId || null,
          toolCallId: message.toolCallId || null,
        });
        socket.send(JSON.stringify({ type: 'extension_tool_result', requestId, ok: true, result }));
      } catch (error) {
        socket.send(JSON.stringify({
          type: 'extension_tool_result',
          requestId,
          ok: false,
          error: error?.message || String(error),
        }));
      }
    }
    if (message.type === 'extension_approval_request') {
      const requestId = String(message.requestId || '');
      const toolName = String(message.toolName || '');
      try {
        const approvalRequired = await evaluateDesktopExtensionApproval(toolName, message.args, {
          requestId,
          threadId: message.threadId || null,
        });
        socket.send(JSON.stringify({ type: 'extension_approval_result', requestId, ok: true, approvalRequired }));
      } catch (error) {
        socket.send(JSON.stringify({
          type: 'extension_approval_result',
          requestId,
          ok: false,
          error: error?.message || String(error),
        }));
      }
    }
  });
  socket.addEventListener('close', (event) => {
    if (extensionBridge.socket === socket) extensionBridge.socket = null;
    windowDebugLog('extensionBridge:closed', { code: event.code, reason: event.reason });
    if (!extensionBridge.stopped) scheduleExtensionBridgeReconnect();
  });
  socket.addEventListener('error', () => {
    windowDebugLog('extensionBridge:error');
  });
}

function restartExtensionBridge() {
  stopExtensionBridge();
  extensionBridge.stopped = false;
  void startExtensionBridge();
}

function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender) || mainWindow;
}

function trayModeLabel(mode) {
  const labels = {
    off: 'Off',
    awake: 'Awake',
    sleeping: 'Asleep',
    recording: 'Recording',
    paused: 'Paused',
    transcribing: 'Working',
    error: 'Error',
  };
  return labels[mode] || 'Voice';
}

function normalizeTrayMode(mode) {
  const value = String(mode || '').trim().toLowerCase();
  if (value === 'asleep' || value === 'sleep') return 'sleeping';
  if (['off', 'awake', 'sleeping', 'recording', 'paused', 'transcribing', 'error'].includes(value)) return value;
  return 'off';
}

function trayStatusTooltip() {
  const label = trayModeLabel(trayStatus.mode);
  const detail = String(trayStatus.status || '').trim();
  return detail && detail !== label ? `Drone: ${label}\n${detail}` : `Drone: ${label}`;
}

function trayStatusMenuTemplate() {
  return [
    { label: `Status: ${trayModeLabel(trayStatus.mode)}`, enabled: false },
    { type: 'separator' },
    { label: 'Show Drone', click: showMainWindow },
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

function appIconImage(size) {
  const image = nativeImage.createFromPath(APP_ICON_PATH);
  if (image.isEmpty() || !size) return image;
  return image.resize({ width: size, height: size, quality: 'best' });
}

function trayIconImage() {
  const image = appIconImage(process.platform === 'darwin' ? 18 : 32);
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

function createWindow(options = {}) {
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
    title: 'Drone',
    backgroundColor: '#101216',
    frame: false,
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    show: false,
    icon: APP_ICON_PATH,
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
      applyCompactMode(win, { inactive: options.compactShowInactive === true });
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
  return win;
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
  ipcMain.handle('config:write', (_event, config) => {
    const saved = writeConfig(config);
    registerAllGlobalShortcuts();
    restartExtensionBridge();
    return saved;
  });
  ipcMain.handle('extensions:reload', async () => {
    extensionHost.loaded = false;
    extensionHost.configKey = '';
    await loadDesktopExtensions({ force: true });
    restartExtensionBridge();
    return { ok: true, statuses: extensionHost.statuses, manifests: extensionHost.manifests };
  });
  ipcMain.handle('extensions:status', async () => {
    await loadDesktopExtensions();
    return { ok: true, statuses: extensionHost.statuses, manifests: extensionHost.manifests };
  });
  ipcMain.handle('extensions:addFile', async (_event, filePath) => addExtensionFileToConfig(filePath));
  ipcMain.handle('extensions:enableWorkspace', async () => enableWorkspaceExtension());
  ipcMain.handle('extensions:saveWorkspaceRoots', async (_event, roots) => saveWorkspaceRootsToConfig(roots));
  ipcMain.handle('extensions:addWorkspaceRoot', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(owner, {
      title: 'Add workspace root',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    return addWorkspaceRootToConfig(result.filePaths[0]);
  });
  ipcMain.handle('extensions:chooseFile', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(owner, {
      title: 'Add local extension',
      properties: ['openFile'],
      filters: [
        { name: 'Extension files', extensions: ['cjs', 'js'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    return addExtensionFileToConfig(result.filePaths[0]);
  });
  ipcMain.handle('app:openExternal', (_event, url) => shell.openExternal(url));
  ipcMain.handle('clipboard:writeText', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });
  ipcMain.handle('desktopAuth:qrPayload', (_event, config) => startLocalDesktopAuthServer(config || {}));
  ipcMain.handle('desktopAuth:stopQr', () => {
    stopLocalDesktopAuthServer();
    return { ok: true };
  });
  ipcMain.handle('qr:dataUrl', async (_event, text) => {
    const QRCode = require('qrcode');
    return QRCode.toDataURL(String(text || ''), {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 8,
      color: {
        dark: '#101216',
        light: '#ffffff',
      },
    });
  });
  ipcMain.handle('debug:window', (_event, message, details) => {
    windowDebugLog(String(message || 'renderer'), { renderer: details || {}, snapshot: windowSnapshot(mainWindow) });
    return { ok: true };
  });
  ipcMain.handle('commandLog:append', (_event, entry) => appendCommandLog(entry));
  ipcMain.handle('commandLog:read', () => ({ ok: true, logs: readCommandLogEntries() }));
  ipcMain.handle('commandLog:clear', () => clearCommandLogs());
  ipcMain.handle('callRecorder:status', () => callRecorderStatus());
  ipcMain.handle('callRecorder:start', () => startCallRecording());
  ipcMain.handle('callRecorder:stop', () => stopCallRecording());
  ipcMain.handle('callRecorder:open', () => openCallRecordingLocation());
  ipcMain.handle('window:state', () => windowStatePayload());
  ipcMain.handle('window:compact', (event) => applyCompactMode(windowFromEvent(event)));
  ipcMain.handle('window:expand', (event) => applyExpandedMode(windowFromEvent(event)));
  ipcMain.handle('window:signedOut', (event) => applySignedOutMode(windowFromEvent(event)));
  ipcMain.handle('window:close', (event) => {
    const win = windowFromEvent(event);
    hideToTray(win);
  });
  ipcMain.handle('window:restoreTemporaryOverlay', (event, payload) => restoreTemporaryOverlay(windowFromEvent(event), payload?.restoreWindowMode));
  ipcMain.handle('tray:status', (_event, payload) => updateTrayStatus(payload?.mode, payload?.status));
  ipcMain.handle('shortcut:status', () => allShortcutStatuses());
  ipcMain.handle('shortcut:resetTranscription', () => {
    const config = writeConfig({ ...readConfig(), transcriptionShortcut: defaultTranscriptionShortcut });
    registerAllGlobalShortcuts();
    return { ok: true, config, status: allShortcutStatuses() };
  });
  ipcMain.handle('shortcut:resetAwakeSleepToggle', () => {
    const config = writeConfig({ ...readConfig(), awakeSleepToggleShortcut: defaultAwakeSleepToggleShortcut });
    registerAllGlobalShortcuts();
    return { ok: true, config, status: allShortcutStatuses() };
  });
  ipcMain.handle('shortcut:resetTurnOff', () => {
    const config = writeConfig({ ...readConfig(), turnOffShortcut: defaultTurnOffShortcut });
    registerAllGlobalShortcuts();
    return { ok: true, config, status: allShortcutStatuses() };
  });
  ipcMain.handle('shortcut:resetPauseResume', () => {
    const config = writeConfig({ ...readConfig(), pauseResumeShortcut: defaultPauseResumeShortcut });
    registerAllGlobalShortcuts();
    return { ok: true, config, status: allShortcutStatuses() };
  });
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
  ipcMain.handle('vosk:setGrammar', (_event, mode, settings = {}) => applyVoskGrammar(mode, settings));
  ipcMain.on('vosk:frame', (event, frame) => handleVoskFrame(event.sender, frame));

  app.whenReady().then(() => {
    const launchPayload = extractPairingPayloadFromArgv(process.argv);
    if (launchPayload) queuePairingPayload(launchPayload);
    if (process.platform === 'darwin') app.dock?.setIcon(appIconImage(256));
    ensureTray();
    createWindow();
    registerAllGlobalShortcuts();
    void startExtensionBridge();
  });

  app.on('window-all-closed', () => {
    if (isQuitting && process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    showMainWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    if (callRecorderState.child) {
      try {
        callRecorderState.child.kill('SIGTERM');
      } catch {
        // Ignore recorder cleanup during quit.
      }
    }
    stopExtensionBridge();
    void deactivateDesktopExtensions();
    globalShortcut.unregisterAll();
    releaseVosk();
  });
}
