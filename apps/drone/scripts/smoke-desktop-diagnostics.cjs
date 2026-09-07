const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

async function main() {
  const repo = path.resolve(__dirname, '../../..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-diagnostics-smoke-'));
  const desktop = path.join(repo, 'apps/drone/desktop');
  try {
    await esbuild.build({
      stdin: {
        resolveDir: path.join(repo, 'apps/drone-hub'), loader: 'tsx',
        contents: `
          import React from 'react';
          import {createRoot} from 'react-dom/client';
          import {UiErrorBoundary} from './src/UiErrorBoundary';
          import {installUiDiagnostics,recordUiAction,showStartupFailure} from './src/ui-diagnostics';
          installUiDiagnostics();
          function BrokenFile() { throw new Error('smoke: file render failure'); }
          function TestApp() {
            const [failed,setFailed]=React.useState(false);
            return failed ? <BrokenFile/> : <button id="file-link" onClick={()=>{
              recordUiAction({action:'chat-file-link',path:'/test/source.ts',line:42,droneId:'smoke-drone'});
              setFailed(true);
            }}>Open file</button>;
          }
          createRoot(document.getElementById('root')).render(<UiErrorBoundary><TestApp/></UiErrorBoundary>);
          window.smokeRuntimeErrors=()=>{
            setTimeout(()=>{throw new Error('smoke: uncaught exception')},0);
            void Promise.reject(new Error('smoke: rejected promise'));
          };
          window.smokeStartupFailure=()=>showStartupFailure(new Error('smoke: startup import failure'));
        `,
      },
      bundle: true, outfile: path.join(dir, 'fixture.js'), platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"', __DRONE_HUB_BUILD_ID__: '"smoke-build"' },
    });
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><body><div id="root"></div><script src="fixture.js"></script></body></html>');
    fs.writeFileSync(path.join(dir, 'runner.cjs'), `
      const {app,BrowserWindow,ipcMain}=require('electron');
      const assert=require('node:assert/strict');
      const fs=require('node:fs');
      const path=require('node:path');
      const {createDesktopDiagnostics,observeWindowDiagnostics,DIAGNOSTICS_CHANNEL}=require(${JSON.stringify(path.join(desktop, 'hub-electron-diagnostics.cjs'))});
      app.setPath('userData',path.join(__dirname,'profile'));
      const logPath=path.join(__dirname,'desktop.jsonl');
      const logger=createDesktopDiagnostics({logPath});
      const entries=()=>fs.existsSync(logPath)?fs.readFileSync(logPath,'utf8').trim().split('\\n').map(JSON.parse):[];
      const pause=()=>new Promise(r=>setTimeout(r,50));
      async function waitFor(check){for(let i=0;i<200;i++){if(await check())return;await pause()}throw Error('Timed out waiting for diagnostic result')}
      setTimeout(()=>{console.error('Smoke test timeout');app.exit(1)},25000);
      app.whenReady().then(async()=>{
        const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,preload:${JSON.stringify(path.join(desktop, 'hub-electron-preload.cjs'))}}});
        observeWindowDiagnostics(win,logger);
        ipcMain.on(DIAGNOSTICS_CHANNEL,(event,record)=>{
          if(event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame)logger.renderer(record);
        });
        await win.loadFile(path.join(__dirname,'index.html'));
        await waitFor(()=>win.webContents.executeJavaScript('!!document.getElementById("file-link")'));
        await win.webContents.executeJavaScript('(()=>{const script=document.createElement("script");script.src="missing-diagnostic-fixture.js";document.head.appendChild(script)})()');
        await waitFor(()=>entries().some(e=>e.details.kind==='resource-load-error'));
        await waitFor(()=>entries().some(e=>e.details.kind==='asset-load-error'));
        await win.webContents.executeJavaScript('window.smokeRuntimeErrors()');
        await waitFor(()=>entries().some(e=>e.details.kind==='unhandled-rejection'));
        assert(entries().some(e=>e.details.kind==='uncaught-error'));
        await win.webContents.executeJavaScript('document.getElementById("file-link").click()');
        await waitFor(()=>entries().some(e=>e.details.kind==='react-render-error'));
        const failure=entries().find(e=>e.details.kind==='react-render-error');
        assert(failure.details.stack.includes('smoke: file render failure'));
        assert(failure.details.componentStack.includes('BrokenFile'));
        assert(failure.details.buildId==='smoke-build');
        assert(failure.breadcrumbs.some(b=>b.path==='/test/source.ts'&&b.line===42));
        const screen=await win.webContents.executeJavaScript('document.body.innerText');
        assert(screen.includes('Reload window'));
        assert(screen.includes(failure.details.id));
        await win.webContents.executeJavaScript('window.smokeStartupFailure()');
        await waitFor(()=>entries().some(e=>e.details.kind==='startup-error'));
        assert((await win.webContents.executeJavaScript('document.body.innerText')).includes('Drone Hub could not load'));
        win.webContents.forcefullyCrashRenderer();
        await waitFor(()=>entries().some(e=>e.kind==='render-process-gone'));
        assert(entries().find(e=>e.kind==='render-process-gone').details.reason==='crashed');
        console.log('PASS: IPC, asset/runtime errors, React stack/recovery, startup recovery, breadcrumbs, and native renderer crash');
        app.exit(0);
      }).catch(error=>{console.error(error.stack);app.exit(1)});
    `);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = execFileSync(require('electron'), [path.join(dir, 'runner.cjs')], {
      env, encoding: 'utf8', timeout: 35000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    process.stdout.write(result);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    process.stderr.write(`${error.stderr || error.stack || error}\nArtifacts: ${dir}\n`);
    process.exitCode = 1;
  }
}
void main();
