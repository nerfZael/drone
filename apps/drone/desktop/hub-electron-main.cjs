const { app, BrowserWindow, Menu, contentTracing, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  detachedHubStartArgs,
  electronNodeChildEnv,
  formatDetachedHubStartOutput,
  parseDetachedHubStartOutput,
} = require('./hub-electron-launch.cjs');
const {
  resolveDesktopStaticUiDir,
  resolveHubApiTokenPath,
  startDesktopStaticUiServer,
} = require('./hub-electron-static-server.cjs');
const { zoomActionForInput } = require('./hub-electron-zoom.cjs');

const APP_NAME = 'Drone Hub';
const NAVIGATION_ZOOM_CHANNEL = 'drone-hub:navigation-zoom';

let mainWindow = null;
let hubLauncherProcess = null;
let desktopStaticUiServer = null;
let isQuitting = false;
let performanceTraceStarted = false;

app.setName(APP_NAME);
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', APP_NAME);
  app.setDesktopName('drone-hub.desktop');
}
if (process.platform === 'win32') {
  app.setAppUserModelId('com.drone.hub');
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function resolveCliPath() {
  const explicit = String(process.env.DRONE_HUB_CLI_PATH || '').trim();
  if (explicit) return explicit;
  const candidates = [
    path.join(__dirname, 'cli.js'),
    path.join(__dirname, '..', 'dist', 'cli.js'),
    path.resolve(__dirname, '..', 'dist', 'cli.js'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found) return found;
  throw new Error('Drone CLI path was not provided. Start the desktop app with `drone hub app`.');
}

function hubArgs(cliPath) {
  return detachedHubStartArgs(cliPath);
}

function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, 'drone-hub-icon.png'),
    path.join(__dirname, 'hub-ui', 'icons', 'drone-app-icon-256.png'),
    path.resolve(__dirname, '..', '..', 'drone-hub', 'pwa', 'icons', 'drone-app-icon-256.png'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function loadingHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Drone Hub</title>
    <style>
      body {
        margin: 0;
        height: 100vh;
        display: grid;
        place-items: center;
        background: #11161e;
        color: #c7cdda;
        font: 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        text-align: center;
      }
      .spinner {
        position: relative;
        width: 44px;
        height: 44px;
      }
      .spinner-track {
        position: absolute;
        inset: 0;
        border: 1px solid #293241;
        border-radius: 999px;
        background: rgba(0, 0, 0, .09);
      }
      .spinner-arc {
        position: absolute;
        inset: 0;
        width: 44px;
        height: 44px;
        animation: hub-spinner-rotate 1s linear infinite;
      }
      .spinner-dot {
        position: absolute;
        inset: 17px;
        border-radius: 999px;
        background: #b19cff;
        box-shadow: 0 0 10px #9678fa;
      }
      .message {
        color: #c7cdda;
        font-size: 14px;
        font-weight: 500;
        line-height: 20px;
      }
      @keyframes hub-spinner-rotate {
        to { transform: rotate(360deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .spinner-arc { animation: none; }
      }
    </style>
  </head>
  <body>
    <main role="status" aria-live="polite">
      <div class="spinner" aria-hidden="true">
        <div class="spinner-track"></div>
        <svg class="spinner-arc" viewBox="0 0 44 44" fill="none">
          <path d="M22 3a19 19 0 0 1 16.45 9.5" stroke="#b19cff" stroke-width="2.25" stroke-linecap="round" />
        </svg>
        <div class="spinner-dot"></div>
      </div>
      <div class="message">Loading your workspace…</div>
    </main>
  </body>
</html>`;
}

function errorHtml(message) {
  const escaped = String(message || 'Drone Hub failed to start.')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Drone Hub</title></head><body style="font:14px system-ui;margin:32px;line-height:1.5"><h1>Drone Hub failed to start</h1><pre style="white-space:pre-wrap">${escaped}</pre></body></html>`;
}

function createWindow() {
  const appIconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    title: APP_NAME,
    backgroundColor: '#11161e',
    ...(appIconPath ? { icon: appIconPath } : {}),
    ...(process.platform === 'linux'
      ? {}
      : {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: '#171d27',
            symbolColor: '#c7cdda',
            height: 29,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, 'hub-electron-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml())}`);
  mainWindow.webContents.setZoomFactor(1);
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.setZoomFactor(1);
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const action = zoomActionForInput(input);
    if (!action || !mainWindow || mainWindow.isDestroyed()) return;
    event.preventDefault();
    mainWindow.webContents.send(NAVIGATION_ZOOM_CHANNEL, { action });
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => {});
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showError(error) {
  const message = error && error.message ? error.message : String(error || 'Unknown error');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml(message))}`).catch(() => {});
  }
}

function requestedTraceDurationMs() {
  const seconds = Number(process.env.DRONE_HUB_PERF_TRACE_SECONDS || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds, 300) * 1_000;
}

async function startPerformanceTraceAfterLoad() {
  const durationMs = requestedTraceDurationMs();
  if (performanceTraceStarted || durationMs <= 0) return;
  performanceTraceStarted = true;
  const requestedDelay = Number(process.env.DRONE_HUB_PERF_TRACE_DELAY_SECONDS || 0);
  const delayMs = Number.isFinite(requestedDelay) && requestedDelay > 0
    ? Math.min(requestedDelay, 300) * 1_000
    : 0;
  const explicitPath = String(process.env.DRONE_HUB_PERF_TRACE_PATH || '').trim();
  const tracePath = explicitPath || path.join(
    app.getPath('userData'),
    'performance-traces',
    `drone-hub-${Date.now()}.json`,
  );
  try {
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (isQuitting) return;
    await contentTracing.startRecording({
      categoryFilter: [
        'blink',
        'cc',
        'gpu',
        'renderer.scheduler',
        'toplevel',
        'v8',
        'disabled-by-default-v8.cpu_profiler',
        'disabled-by-default-v8.cpu_profiler.hires',
      ].join(','),
      traceOptions: 'record-until-full',
    });
    const timer = setTimeout(() => {
      void contentTracing.stopRecording(tracePath).then(() => {
        if (process.env.DRONE_HUB_EXIT_AFTER_TRACE === '1') app.quit();
      }).catch((error) => {
        fs.writeFileSync(`${tracePath}.error.txt`, `${error?.stack || error}\n`);
      });
    }, durationMs);
    timer.unref?.();
  } catch (error) {
    fs.writeFileSync(`${tracePath}.error.txt`, `${error?.stack || error}\n`);
  }
}

function startHub() {
  const cliPath = resolveCliPath();
  const nodePath = String(process.env.DRONE_HUB_NODE_PATH || '').trim() || 'node';
  hubLauncherProcess = spawn(nodePath, hubArgs(cliPath), {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: electronNodeChildEnv(process.env),
  });

  let stdout = '';
  let stderrBuffer = '';
  let navigationStarted = false;
  let terminalStatusWritten = false;

  const loadHubUiFromOutput = () => {
    if (navigationStarted) return true;
    let payload;
    let uiUrl;
    try {
      ({ payload, uiUrl } = parseDetachedHubStartOutput(stdout));
    } catch {
      return false;
    }
    navigationStarted = true;
    if (!terminalStatusWritten) {
      terminalStatusWritten = true;
      process.stdout.write(`${formatDetachedHubStartOutput(payload)}\n`);
    }
    void (async () => {
      try {
        if (payload.buildMismatch) {
          throw new Error(
            'Restart required\n\nDrone Hub is running an older app build. Close this window, run `drone hub stop`, then reopen Drone Hub.',
          );
        }
        if (payload.alreadyRunning) {
          const staticDir = resolveDesktopStaticUiDir(__dirname, process.env.DRONE_HUB_STATIC_UI_DIR);
          const tokenPath = resolveHubApiTokenPath(payload);
          const apiHost = String(payload.state?.apiHost || '').trim();
          const apiPort = Number(payload.state?.apiPort);
          if (!staticDir) throw new Error('The production Drone Hub UI bundle is missing. Run `bun run --filter drone-hub build`.');
          if (!tokenPath || !fs.existsSync(tokenPath)) throw new Error('The running Hub API token could not be found.');
          if (!apiHost || !Number.isInteger(apiPort) || apiPort <= 0) throw new Error('The running Hub API address is invalid.');
          desktopStaticUiServer = await startDesktopStaticUiServer({
            staticDir,
            apiHost,
            apiPort,
            apiToken: fs.readFileSync(tokenPath, 'utf8').trim(),
          });
          uiUrl = desktopStaticUiServer.url;
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          await mainWindow.loadURL(uiUrl);
          await startPerformanceTraceAfterLoad();
        }
      } catch (error) {
        showError(error);
      }
    })();
    return true;
  };

  hubLauncherProcess.stdout.on('data', (chunk) => {
    const text = String(chunk || '');
    stdout += text;
    void loadHubUiFromOutput();
  });

  hubLauncherProcess.stderr.on('data', (chunk) => {
    const text = String(chunk || '');
    process.stderr.write(text);
    stderrBuffer += text;
    if (stderrBuffer.length > 8000) stderrBuffer = stderrBuffer.slice(-8000);
  });

  hubLauncherProcess.once('error', showError);
  hubLauncherProcess.once('exit', (code, signal) => {
    hubLauncherProcess = null;
    if (isQuitting) return;
    if (code !== 0) {
      if (navigationStarted) return;
      const reason = `Hub launcher exited with code ${code == null ? 'null' : code} signal ${signal || 'null'}.`;
      showError(`Drone Hub failed to start.\n\n${reason}\n\n${stderrBuffer.trim()}`);
      return;
    }
    try {
      if (!loadHubUiFromOutput()) throw new Error('Hub launcher did not return its connection details.');
    } catch (error) {
      showError(error);
    }
  });
}

Menu.setApplicationMenu(null);

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    const appIconPath = resolveAppIconPath();
    if (process.platform === 'darwin' && appIconPath) app.dock?.setIcon(appIconPath);
    createWindow();
    startHub();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    void desktopStaticUiServer?.close();
    desktopStaticUiServer = null;
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
