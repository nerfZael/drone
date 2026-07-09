const { app, BrowserWindow, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const APP_NAME = 'Drone Hub';

let mainWindow = null;
let hubProcess = null;
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

function optionalArg(name, value) {
  const text = String(value || '').trim();
  return text ? [name, text] : [];
}

function hubArgs(cliPath) {
  const defaultContainerMcpHost = process.platform === 'linux' ? '172.17.0.1' : '0.0.0.0';
  const args = [
    cliPath,
    'hub',
    'run',
    '--ui-mode',
    'static',
    '--port',
    String(process.env.DRONE_HUB_APP_PORT || '0'),
    '--api-port',
    String(process.env.DRONE_HUB_APP_API_PORT || '0'),
    '--host',
    String(process.env.DRONE_HUB_APP_HOST || '127.0.0.1'),
    '--container-mcp-host',
    String(process.env.DRONE_HUB_APP_CONTAINER_MCP_HOST || defaultContainerMcpHost),
    '--container-mcp-port',
    String(process.env.DRONE_HUB_APP_CONTAINER_MCP_PORT || '8788'),
    '--voice-stream-port',
    String(process.env.DRONE_HUB_APP_VOICE_STREAM_PORT || '3199'),
    '--ready-json',
    ...optionalArg('--static-ui-dir', process.env.DRONE_HUB_STATIC_UI_DIR),
    ...optionalArg('--container-mcp-url', process.env.DRONE_HUB_APP_CONTAINER_MCP_URL),
  ];
  if (process.env.DRONE_HUB_APP_NO_VOICE_STREAM === '1') args.push('--no-voice-stream');
  return args;
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
  hubProcess = spawn(process.execPath, hubArgs(cliPath), {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let ready = false;

  hubProcess.stdout.on('data', (chunk) => {
    const text = String(chunk || '');
    process.stdout.write(text);
    stdoutBuffer += text;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('DRONE_HUB_READY ')) continue;
      try {
        const payload = JSON.parse(line.slice('DRONE_HUB_READY '.length));
        if (!payload || typeof payload.uiUrl !== 'string' || !payload.uiUrl.trim()) {
          throw new Error('Hub process reported ready without a UI URL.');
        }
        ready = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(payload.uiUrl).catch(showError);
        }
      } catch (error) {
        showError(error);
      }
    }
  });

  hubProcess.stderr.on('data', (chunk) => {
    const text = String(chunk || '');
    process.stderr.write(text);
    stderrBuffer += text;
    if (stderrBuffer.length > 8000) stderrBuffer = stderrBuffer.slice(-8000);
  });

  hubProcess.once('error', showError);
  hubProcess.once('exit', (code, signal) => {
    hubProcess = null;
    if (isQuitting) return;
    const reason = `Hub process exited with code ${code == null ? 'null' : code} signal ${signal || 'null'}.`;
    showError(`${ready ? 'Drone Hub stopped unexpectedly.' : 'Drone Hub failed before it was ready.'}\n\n${reason}\n\n${stderrBuffer.trim()}`);
  });
}

function stopHub() {
  if (!hubProcess) return;
  const child = hubProcess;
  hubProcess = null;
  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
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
  stopHub();
});

app.on('window-all-closed', () => {
  app.quit();
});
