// Focused Electron integration check; no Hub server, app build, or microphone needed.
// Run: xvfb-run -a node apps/drone-hub/scripts/smoke-companion-window.cjs (Linux CI)
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const repo = path.resolve(__dirname, '../../..');

async function runElectron() {
  const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
  const { installChatWindows } = require('../../drone/desktop/hub-electron-chat-windows.cjs');
  const { installCompanionWindow } = require('../../drone/desktop/hub-electron-companion.cjs');
  app.commandLine.appendSwitch('disable-gpu');
  await app.whenReady();
  Menu.setApplicationMenu(null);
  const owner = new BrowserWindow({ show: true, webPreferences: {
    preload: path.join(repo, 'apps/drone/desktop/hub-electron-preload.cjs'),
    contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
  } });
  let quitting = false;
  const openOtherWindow = installChatWindows({ mainWindow: owner, ipcMain, shell });
  installCompanionWindow({ owner, ipcMain, shell, isQuitting: () => quitting, openOtherWindow });
  const errors = [];
  const undoModifier = process.platform === 'darwin' ? 'meta' : 'control';
  owner.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
  const js = (code) => owner.webContents.executeJavaScript(code, true);
  const waitFor = async (check, label) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${label}\n${errors.join('\n')}`);
  };
  try {
    await owner.loadURL(process.env.COMPANION_TEST_URL);
    await waitFor(() => js('Boolean(window.companionTest)'), 'fixture mount');
    assert.equal(await js("Boolean(window.open('about:blank', 'drone-hub-chat:smoke'))"), true);
    const chat = BrowserWindow.getAllWindows().find(win => win !== owner);
    assert(chat);
    assert.equal(await js("droneHubDesktop.setChatWindowAlwaysOnTop('drone-hub-chat:smoke', true)"), true);
    assert.equal(chat.isAlwaysOnTop(), true);
    chat.close();
    await waitFor(() => js("Boolean(document.querySelector('[data-portable-editor]')?.shadowRoot?.querySelector('.monaco-editor'))"), 'Monaco editor mount');
    await js("window.originalMonaco = companionTest.monaco.editor.getEditors()[0]; companionTest.editor.current.applyCompanionEdit('changed before detaching')");
    await waitFor(() => js("companionTest.draft === 'changed before detaching'"), 'initial editor edit');
    await js("window.originalDraft = document.querySelector('#draft'); originalDraft.value = 'keep me'; originalDraft.setSelectionRange(2, 4); document.querySelector('#increment').click(); document.querySelector('#toggle').click()");
    await waitFor(() => js('companionTest.host.detached'), 'detach');
    const child = BrowserWindow.getAllWindows().find(win => win !== owner);
    assert(child);
    await waitFor(() => child.isVisible(), 'floating window shown');
    assert(child.isAlwaysOnTop());
    assert.equal(await js('companionTest.mounts'), 1);
    assert.equal(await js("companionTest.host.ownerWindow.document.querySelector('#draft') === originalDraft"), true);
    assert.equal(await js('originalDraft.value'), 'keep me');
    assert.equal(await js('originalDraft.selectionStart'), 2);
    assert.equal(await js("Boolean(document.querySelector('#draft'))"), false);
    const childJs = code => child.webContents.executeJavaScript(code, true);
    await childJs("document.querySelector('#increment').click(); document.querySelector('#options').focus(); document.querySelector('#options').click()");
    await waitFor(() => childJs("document.activeElement?.id === 'first'"), 'floating popover autofocus');
    await childJs("document.querySelector('#last').focus()");
    child.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    child.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await waitFor(() => childJs("document.activeElement?.id === 'first'"), 'floating popover Tab loop');
    child.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await waitFor(() => childJs("!document.querySelector('#options-panel')"), 'floating popover Escape');
    await waitFor(() => childJs("document.activeElement?.id === 'options'"), 'floating popover focus return');
    await childJs("document.querySelector('#dialog').focus(); document.querySelector('#dialog').click()");
    await waitFor(() => childJs("Boolean(document.querySelector('[role=dialog]'))"), 'floating proposal dialog');
    child.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await waitFor(() => childJs("!document.querySelector('[role=dialog]')"), 'floating dialog Escape');
    await js('setCompanionVisible(false)');
    await waitFor(() => !child.isVisible(), 'idle hides window');
    await js('setCompanionVisible(true)');
    await waitFor(() => child.isVisible(), 'new session shows window');
    assert.equal(await js('companionTest.monaco.editor.getEditors()[0] === originalMonaco'), true);
    await js('companionTest.editor.current.focus()');
    child.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: [undoModifier] });
    child.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: [undoModifier] });
    await waitFor(() => js("companionTest.draft === 'editor draft'"), 'undo survives detaching');
    await js('companionTest.editor.current.setSelection({ start: 0, end: 0 })');
    child.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'X' });
    child.webContents.sendInputEvent({ type: 'char', keyCode: 'X' });
    child.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'X' });
    await waitFor(() => js("companionTest.draft === 'Xeditor draft'"), 'typing in detached Monaco');
    child.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: [undoModifier] });
    child.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: [undoModifier] });
    await waitFor(() => js("companionTest.draft === 'editor draft'"), 'undo in detached Monaco');
    await childJs("document.querySelector('#dialog').focus(); document.querySelector('#dialog').click()");
    await waitFor(() => childJs("Boolean(document.querySelector('[role=dialog]'))"), 'dialog before native close');
    child.close();
    await waitFor(() => js('!companionTest.host.detached'), 'native close returns Companion');
    assert.equal(await js("document.querySelector('#draft') === originalDraft"), true);
    assert.equal(await js("document.querySelector('#increment').textContent"), '2');
    assert.equal(await js('companionTest.mounts'), 1);
    assert.equal(await js("Boolean(document.querySelector('[role=dialog]'))"), true);
    await js("document.querySelector('[aria-label=\"Close dialog\"]').click()");
    await waitFor(() => js("!document.querySelector('[role=dialog]')"), 'close reattached dialog');
    await js('companionTest.editor.current.focus(); companionTest.editor.current.setSelection({ start: 0, end: 0 })');
    owner.webContents.sendInputEvent({ type: 'char', keyCode: 'Y' });
    await waitFor(() => js("companionTest.draft === 'Yeditor draft'"), 'typing after reattaching Monaco');
    await js("document.querySelector('#toggle').click()");
    await waitFor(() => js('companionTest.host.detached'), 'second detach');
    await js("companionTest.host.ownerWindow.document.querySelector('#toggle').click()");
    await waitFor(() => js('!companionTest.host.detached'), 'toggle returns Companion');
    assert.equal(await js('originalDraft.value'), 'keep me');
    assert.deepEqual(errors, []);
    console.log('PASS: floating window, state retention, Monaco typing/undo, menus, keyboard focus, visibility, native close with open dialog, repeated toggles');
  } finally {
    quitting = true;
    owner.destroy();
    app.quit();
  }
}

async function main() {
  if (process.versions.electron) return runElectron();
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false, root: repo,
    plugins: [{ name: 'fixture', configureServer(server) {
      server.middlewares.use('/companion-window-test', (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/apps/drone-hub/tests/fixtures/companion-window.tsx"></script></body></html>');
      });
    } }],
    resolve: { alias: { '@drone/assistant-chat': path.join(repo, 'packages/assistant-chat/src/index.ts'), '@drone/device-protocol': path.join(repo, 'packages/device-protocol/src/index.ts'), '@blip/protocol': path.join(repo, 'blip/packages/protocol/src/index.ts') } },
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  try {
    const child = spawn(require('electron'), ['--no-sandbox', __filename], {
      stdio: 'inherit',
      env: { ...process.env, COMPANION_TEST_URL: `${server.resolvedUrls.local[0]}companion-window-test` },
    });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    if (code !== 0) throw new Error(`Electron check exited with ${code}`);
  } finally { await server.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });
