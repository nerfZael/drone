const fs = require('node:fs');
const path = require('node:path');

const RECOVERY_CHANNEL = 'drone-hub:renderer-recover';
const recoveryPage = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<meta charset="utf-8"><title>Drone Hub recovery</title>
<style>body{margin:0;background:#11161e;color:#e8edf5;font:16px system-ui;display:grid;place-items:center;height:100vh}main{max-width:520px;padding:32px}p{line-height:1.6;color:#b9c4d4}button{padding:12px 18px;border:0;border-radius:6px;background:#77b6ff;color:#11161e;font:inherit;cursor:pointer}</style>
<main><h1>Drone Hub’s window stopped</h1><p>Reopen with files in Source mode to avoid loading a preview that may have caused the crash. Saved chats and drafts will be restored.</p>
<button id="recover">Reopen without previews</button><p id="status" role="status"></p></main>
<script>document.getElementById('recover').onclick=()=>{document.getElementById('status').textContent='Reopening…';window.droneHubDesktop?.recoverRenderer?.();};</script>`)}`;

function sourceRecoveryUrl(url) {
  const result = new URL(url);
  result.searchParams.set('droneRecovery', 'source');
  return result.href;
}

function installRendererRecovery({ window, ipcMain, markerPath, getUiUrl, diagnostics, isQuitting = () => false }) {
  const contents = window.webContents;
  let recoveryVisible = false;
  let reopening = false;
  let safeUrl = null;
  let recovered = false;
  function startupUrl(url) {
    if (!fs.existsSync(markerPath)) return url;
    safeUrl = sourceRecoveryUrl(url);
    return safeUrl;
  }
  function failure(error) {
    diagnostics.write('renderer-recovery-error', { message: String(error?.message || error) });
  }
  function crashed(_event, details) {
    if (isQuitting() || details.reason === 'clean-exit' || window.isDestroyed()) return;
    try {
      fs.mkdirSync(path.dirname(markerPath), { recursive: true });
      fs.writeFileSync(markerPath, 'source\n', { mode: 0o600 });
    } catch (error) { failure(error); }
    if (recoveryVisible && !reopening) return;
    recoveryVisible = true;
    recovered = false;
    reopening = false;
    // Chromium must finish tearing down the old renderer before navigating.
    setImmediate(() => {
      if (!window.isDestroyed() && !isQuitting()) void contents.loadURL(recoveryPage).catch(failure);
    });
  }
  function recover(event) {
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame ||
        !recoveryVisible || reopening || contents.getURL() !== recoveryPage || isQuitting()) return;
    const url = getUiUrl();
    if (!url) return;
    reopening = true;
    safeUrl = sourceRecoveryUrl(url);
    void contents.loadURL(safeUrl).catch(error => { reopening = false; failure(error); });
  }
  function loaded() {
    if (!safeUrl || contents.getURL() !== safeUrl) return;
    recoveryVisible = false;
    reopening = false;
    recovered = true;
  }
  contents.on('render-process-gone', crashed);
  contents.on('did-finish-load', loaded);
  ipcMain.on(RECOVERY_CHANNEL, recover);
  window.once('closed', () => {
    // Keep the marker for abrupt exits. A clean close after recovery allows the
    // next launch to use the per-file Source choices persisted by the renderer.
    if (recovered) {
      try { fs.rmSync(markerPath, { force: true }); } catch (error) { failure(error); }
    }
    ipcMain.removeListener(RECOVERY_CHANNEL, recover);
    contents.removeListener('render-process-gone', crashed);
    contents.removeListener('did-finish-load', loaded);
  });
  return { startupUrl };
}

module.exports = { installRendererRecovery, sourceRecoveryUrl, RECOVERY_CHANNEL, recoveryPage };
