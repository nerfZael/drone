// Real Electron check: bounded inline loading, separate renderer isolation, and
// recovery after a forced crash. Optional argv[2] is a large HTML regression file.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const repo = path.resolve(__dirname, '../../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-html-smoke-'));
const file = process.argv[2] || path.join(dir, 'fixture.html');
if (!process.argv[2]) fs.writeFileSync(file, '<!doctype html><h1>Preview</h1><script>window.previewScriptRan=true</script>');
require('esbuild').buildSync({
  stdin: { resolveDir: path.join(repo, 'apps/drone-hub'), loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { IsolatedHtmlPreview } from './src/droneHub/files/IsolatedHtmlPreview';
    import { readLargeHtmlSource } from './src/droneHub/files/use-large-html-source';
    import { shouldRecoverPreviewAsSource } from './src/droneHub/files/preview-recovery';
    window.sourceRecovery = shouldRecoverPreviewAsSource('smoke:huge.html');
    window.chunkRequests = 0;
    const originalFetch = window.fetch;
    window.fetch = (...args) => { window.chunkRequests++; return originalFetch(...args); };
    readLargeHtmlSource('smoke', '/huge.html', new AbortController().signal, 145766804)
      .then(() => { window.guardResult='unexpected success'; })
      .catch(error => { window.guardResult=error.message; });
    createRoot(document.getElementById('root')).render(<IsolatedHtmlPreview source={'x'.repeat(145766804)} />);
  ` }, outfile: path.join(dir, 'app.js'), bundle: true, platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
});

async function electronRunner() {
  const { app, BrowserWindow, session, ipcMain } = require('electron');
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const http = require('node:http');
  const dir = __dirname;
  const repo = process.env.DRONE_HTML_SMOKE_REPO;
  const file = process.env.DRONE_HTML_SMOKE_FILE;
  const { installRendererRecovery, recoveryPage } = require(path.join(repo, 'apps/drone/desktop/hub-electron-recovery.cjs'));
  const { installHtmlPreviewWindows, OPEN_HTML_PREVIEW_CHANNEL } = require(path.join(repo, 'apps/drone/desktop/hub-electron-html-preview.cjs'));
  app.setPath('userData', path.join(dir, 'profile'));
  app.commandLine.appendSwitch('enable-logging', 'stderr');
  const timeout = setTimeout(() => { console.error('FAIL: smoke timed out'); app.exit(1); }, 90000);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(fn) {
    for (let i = 0; i < 600; i++) { if (await fn()) return; await delay(100); }
    throw new Error('Condition timed out');
  }
  try {
    await app.whenReady();
    const server = http.createServer((req, res) => {
      if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); fs.createReadStream(path.join(dir, 'app.js')).pipe(res); }
      else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(repo, 'apps/drone/desktop/hub-electron-preload.cjs') } });
    const diagnostics = { write(kind, details) { console.log(kind, JSON.stringify(details)); } };
    installRendererRecovery({ window: owner, ipcMain, markerPath: path.join(dir, 'recovery'), getUiUrl: () => url, diagnostics });
    await owner.loadURL(url);
    await until(() => owner.webContents.executeJavaScript('!!window.guardResult && !!document.querySelector("[role=alert]")'));
    assert.equal(await owner.webContents.executeJavaScript('window.chunkRequests'), 0);
    assert.match(await owner.webContents.executeJavaScript('window.guardResult'), /20 MiB/);
    console.log('PASS: 139 MB inline source and metadata are rejected without a file request or renderer crash');

    const size = fs.statSync(file).size;
    const handle = await fs.promises.open(file, 'r');
    let servedBytes = 0;
    global.fetch = async (raw, options) => {
      assert.equal(options.headers.Authorization, 'Bearer smoke-token');
      const request = new URL(raw);
      assert.equal(request.origin, 'http://smoke-api.invalid');
      if (request.pathname.endsWith('/file')) return Response.json({ ok: true, size });
      assert(request.pathname.endsWith('/chunk'));
      const offset = Number(request.searchParams.get('offset'));
      const bytes = Buffer.alloc(Number(request.searchParams.get('limit')));
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
      servedBytes += bytesRead;
      return Response.json({ ok: true, offset, nextOffset: offset + bytesRead, eof: offset + bytesRead === size, dataBase64: bytes.subarray(0, bytesRead).toString('base64') });
    };
    installHtmlPreviewWindows({ ipcMain, BrowserWindow, session, diagnostics, getWindow: () => owner, getConnection: () => ({ apiUrl: 'http://smoke-api.invalid', apiToken: 'smoke-token' }) });
    await owner.webContents.executeJavaScript(`window.droneHubDesktop.openHtmlPreview({droneId:'test',path:'/fixture.html'})`);
    const preview = BrowserWindow.getAllWindows().find(win => win !== owner);
    assert(preview);
    preview.hide();
    let crashed = false;
    preview.webContents.on('render-process-gone', () => { crashed = true; });
    await until(() => !preview.webContents.isLoading());
    assert.equal(crashed, false);
    assert.equal(servedBytes, size);
    const page = await preview.webContents.executeJavaScript('({ heading: document.querySelector("h1")?.textContent, images: document.images.length })');
    assert(page.heading);
    if (size > 100 * 1024 * 1024) {
      assert(page.images > 0);
      await until(() => preview.webContents.executeJavaScript('Array.from(document.images).some(image => image.complete && image.naturalWidth > 0)'));
    }
    console.log('Rendered document:', JSON.stringify(page));
    assert.notEqual(preview.webContents.getOSProcessId(), owner.webContents.getOSProcessId());
    assert.notEqual(preview.webContents.session, owner.webContents.session);
    assert.equal(await preview.webContents.executeJavaScript('typeof window.droneHubDesktop'), 'undefined');
    assert.equal(await preview.webContents.executeJavaScript('typeof require'), 'undefined');
    assert.equal(await preview.webContents.executeJavaScript(`fetch('http://127.0.0.1:8787/api/settings').then(()=>false,()=>true)`), true);
    console.log(`PASS: separate renderer streamed ${size} bytes; no Hub bridge, Node or external fetch`);
    preview.webContents.forcefullyCrashRenderer();
    await until(() => preview.webContents.getURL().startsWith('data:text/html') && !preview.webContents.isLoading());
    assert.equal(await owner.webContents.executeJavaScript('1+1'), 2);
    console.log('PASS: forced preview crash leaves the Hub renderer working');
    preview.close();
    await handle.close();

    owner.webContents.forcefullyCrashRenderer();
    await until(() => owner.webContents.getURL() === recoveryPage && !owner.webContents.isLoading());
    await owner.webContents.executeJavaScript('document.getElementById("recover").click()');
    await until(() => owner.webContents.getURL().includes('droneRecovery=source') && !owner.webContents.isLoading());
    await until(() => owner.webContents.executeJavaScript('window.sourceRecovery === true'));
    console.log('PASS: forced Hub crash displays recovery and reopens in Source mode');
    owner.close();
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) { console.error(error.stack); app.exit(1); }
}
fs.writeFileSync(path.join(dir, 'runner.cjs'), `(${electronRunner.toString()})()`);
const env = { ...process.env, DRONE_HTML_SMOKE_REPO: repo, DRONE_HTML_SMOKE_FILE: path.resolve(file) };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(dir, 'runner.cjs')], { env, stdio: 'inherit' });
child.on('exit', code => { console.log(`Smoke artifacts: ${dir}`); process.exitCode = code ?? 1; });
