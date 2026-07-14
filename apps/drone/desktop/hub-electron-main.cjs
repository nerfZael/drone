const { app, BrowserWindow, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { detachedHubStartArgs, parseDetachedHubStartOutput } = require('./hub-electron-launch.cjs');

const APP_NAME = 'Drone Hub';

let mainWindow = null;
let hubLauncherProcess = null;
let isQuitting = false;

app.setName(APP_NAME);
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', APP_NAME);
  app.setDesktopName('drone-hub.desktop');
}
if (process.platform === 'win32') {
  app.setAppUserModelId('com.drone.hub');
}

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
        background: #111827;
        color: #f9fafb;
        font: 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        display: grid;
        gap: 10px;
        text-align: center;
      }
      strong {
        font-size: 18px;
        font-weight: 650;
      }
      span {
        color: #cbd5e1;
      }
    </style>
  </head>
  <body>
    <main>
      <strong>Starting Drone Hub</strong>
      <span>Preparing the local server...</span>
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
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    title: APP_NAME,
    backgroundColor: '#111827',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml())}`);
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

function startHub() {
  const cliPath = resolveCliPath();
  hubLauncherProcess = spawn(process.execPath, hubArgs(cliPath), {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let stdout = '';
  let stderrBuffer = '';

  hubLauncherProcess.stdout.on('data', (chunk) => {
    const text = String(chunk || '');
    process.stdout.write(text);
    stdout += text;
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
      const reason = `Hub launcher exited with code ${code == null ? 'null' : code} signal ${signal || 'null'}.`;
      showError(`Drone Hub failed to start.\n\n${reason}\n\n${stderrBuffer.trim()}`);
      return;
    }
    try {
      const { uiUrl } = parseDetachedHubStartOutput(stdout);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(uiUrl).catch(showError);
      }
    } catch (error) {
      showError(error);
    }
  });
}

Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  createWindow();
  startHub();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  app.quit();
});
