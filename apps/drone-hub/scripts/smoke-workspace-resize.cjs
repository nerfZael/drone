const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

// Exercise the real React workspace and Dockview in an isolated desktop window.
// No Hub server, user profile, or chat data is used.
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-resize-smoke-'));
  try {
    await esbuild.build({
      stdin: {
        resolveDir: path.resolve(__dirname, '..'), loader: 'tsx',
        contents: `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { DockviewComponent } from 'dockview';
          import { DockableDroneWorkspace } from './src/droneHub/app/DockableDroneWorkspace';
          import { saveSideChatWorkspaceState } from './src/droneHub/app/side-chat-workspace-state';
          saveSideChatWorkspaceState('resize-smoke', {
            floatingBounds: { fork: { x: 650, y: 100, width: 500, height: 450 } },
          });
          window.optionUpdates = 0;
          window.pointerEvents = [];
          for (const type of ['pointerdown', 'pointermove', 'pointerup']) document.addEventListener(type, event => {
            window.pointerEvents.push({ type, target: event.target.className, x: event.clientX });
          });
          const updateOptions = DockviewComponent.prototype.updateOptions;
          DockviewComponent.prototype.updateOptions = function(options) {
            window.workspaceApi = this.api;
            window.optionUpdates++;
            return updateOptions.call(this, options);
          };
          function App() {
            const [revision, setRevision] = React.useState(0);
            window.refreshWorkspace = () => setRevision(n => n + 1);
            return <DockableDroneWorkspace currentDrone={{ id: 'resize-smoke' }}
              paneHeaderMode="normal" activeToolTab="terminal" openRequestNonce={0}
              chatContent={<div data-revision={revision}>Chat {revision}</div>}
              sideChats={[{ name: 'fork' }]} mainChatName="default"
              renderSideChat={() => <div data-side-chat-name="fork">Fork {revision}</div>}
              renderToolPane={() => <div>Tool {revision}</div>} previewTab="preview" />;
          }
          createRoot(document.getElementById('root')).render(<App />);
        `,
      },
      bundle: true, outfile: path.join(dir, 'fixture.js'), platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    });
    fs.writeFileSync(path.join(dir, 'index.html'), `
      <html><head><link rel="stylesheet" href="fixture.css"><style>
        * { box-sizing: border-box; }
        html, body, #root { margin: 0; width: 100%; height: 100%; }
        .dh-dockable-workspace { position: absolute; inset: 0; }
        .h-full { height: 100%; }
      </style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>
    `);
    function desktopRunner() {
      const { app, BrowserWindow } = require('electron');
      const assert = require('node:assert/strict');
      const path = require('node:path');
      app.setPath('userData', path.join(__dirname, 'profile'));
      const pause = () => new Promise(resolve => setTimeout(resolve, 30));
      setTimeout(() => { console.error('Resize smoke timed out'); app.exit(1); }, 20000);
      app.whenReady().then(async () => {
        const win = new BrowserWindow({ show: true, width: 1400, height: 900,
          webPreferences: { backgroundThrottling: false } });
        await win.loadFile(path.join(__dirname, 'index.html'));
        const evaluate = source => win.webContents.executeJavaScript(source);
        for (let i = 0; i < 200; i++) {
          if (await evaluate('!!window.workspaceApi?.getPanel("side-chat:fork")')) break;
          await pause();
        }
        assert(await evaluate('!!window.workspaceApi?.getPanel("side-chat:fork")'), 'Workspace mounted');
        await pause();
        await evaluate(`void window.workspaceApi.addPanel({ id: 'tool:terminal', component: 'tool',
          params: { tab: 'terminal' }, position: { referencePanel: 'agent-chat', direction: 'right' } })`);
        await pause();
        const bounds = selector => evaluate(`(() => {
          const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })()`);
        const refresh = async () => {
          await evaluate('window.refreshWorkspace()');
          await pause();
        };
        const originalUpdates = await evaluate('window.optionUpdates');
        const floating = '.dv-resize-container';
        const before = await bounds(floating);
        const handle = await bounds('.dv-resize-handle-right');
        let x = Math.round(handle.x + handle.width / 2);
        const y = Math.round(handle.y + handle.height / 2);
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x, y });
        // Dockview records the starting bounds on the first pointermove.
        win.webContents.sendInputEvent({ type: 'mouseMove', x: ++x, y });
        await pause();
        for (let i = 0; i < 4; i++) {
          x -= 20;
          win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
          await pause();
          const during = await bounds(floating);
          await refresh();
          const after = await bounds(floating);
          assert(Math.abs(during.width - after.width) < 1, 'Refresh preserves floating width');
          assert(Math.abs(during.x - after.x) < 1, 'Refresh preserves floating position');
        }
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x, y });
        const resized = await bounds(floating);
        assert(Math.abs(resized.width - (before.width - 80)) < 2,
          `Floating window follows resize: ${JSON.stringify({ before, resized, handle, events: await evaluate('window.pointerEvents') })}`);

        const sash = await bounds('.dv-sash.dv-enabled');
        x = Math.round(sash.x + sash.width / 2);
        const sashY = Math.round(sash.y + 15);
        const chatWidth = () => evaluate('window.workspaceApi.getPanel("agent-chat").group.width');
        const beforeGrid = await chatWidth();
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y: sashY });
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x, y: sashY });
        for (let i = 0; i < 4; i++) {
          x -= 15;
          win.webContents.sendInputEvent({ type: 'mouseMove', x, y: sashY });
          await pause();
          const during = await chatWidth();
          await refresh();
          assert(Math.abs(await chatWidth() - during) < 1, 'Refresh preserves docked width');
        }
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x, y: sashY });
        assert(Math.abs(await chatWidth() - (beforeGrid - 60)) < 2, 'Docked panel follows resize');
        assert.equal(await evaluate('Number(document.querySelector("[data-revision]").dataset.revision)'), 8,
          'Chat content updates throughout both resize gestures');
        const updates = await evaluate('window.optionUpdates') - originalUpdates;
        assert.equal(updates, 0, 'Background renders must not reconfigure or force layout in Dockview');
        console.log('PASS: floating and docked resizing survive background React renders without forced layouts');
        app.exit(0);
      }).catch(error => { console.error(error.stack); app.exit(1); });
    }
    fs.writeFileSync(path.join(dir, 'runner.cjs'), `(${desktopRunner.toString()})()`);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const output = execFileSync(require('electron'), [path.join(dir, 'runner.cjs')], {
      env, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert(output.includes('PASS:'));
    process.stdout.write(output);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    process.stderr.write(`${error.stderr || error.stack || error}\nArtifacts: ${dir}\n`);
    process.exitCode = 1;
  }
}
void main();
