const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

// Real React + xterm in a disposable Electron profile; fake Hub transport makes
// duplicate opens, early input and tab lifetime deterministic without user data.
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-terminal-smoke-'));
  try {
    await esbuild.build({ entryPoints: [path.join(__dirname, 'terminal-snapshot-fixture.ts')], bundle: true, platform: 'node', outfile: path.join(dir, 'snapshot.cjs') });
    const snapshot = await require(path.join(dir, 'snapshot.cjs')).createSnapshotFixture();
    await esbuild.build({
      stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'tsx', contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { Terminal } from '@xterm/xterm';
        import { DroneTerminalDock } from './src/droneHub/terminal/DroneTerminalDock';
        import { terminalPerformanceSamples } from './src/droneHub/terminal/terminal-connection';
        import { createTerminalPaneSessionsState, ensureTerminalPaneSessionsInitialized, createTerminalPaneSession,
          setActiveTerminalPaneSession, setTerminalPaneSessionName, closeTerminalPaneSession } from './src/droneHub/terminal/terminal-tabs-state';
        window.realSnapshot = ${JSON.stringify(snapshot)};
        window.makeSnapshotTerminal = () => { const host = document.createElement('div'); document.body.append(host); const terminal = new Terminal({cols:90,rows:50}); terminal.open(host); return terminal; };
        window.telemetry = []; window.opens = []; window.inputs = []; window.terminals = []; window.sockets = [];
        window.metrics = terminalPerformanceSamples;
        const originalOpen = Terminal.prototype.open;
        Terminal.prototype.open = function(...args) { window.terminals.push(this); return originalOpen.apply(this, args); };
        window.fetch = async (url, init) => {
          if (url === '/api/telemetry/terminal') {
            window.telemetry.push(JSON.parse(init.body));
            return new Response('{"ok":true}', {status:202});
          }
          if (!String(url).includes('/terminal/open?')) throw new Error('unexpected request: ' + url);
          const sessionName = new URL(url, 'http://localhost').searchParams.get('session');
          window.opens.push(sessionName);
          await new Promise(r => setTimeout(r, 200));
          return new Response(JSON.stringify({sessionName, transport:'terminal-control-v1'}), {headers:{'content-type':'application/json'}});
        };
        class Socket {
          static OPEN = 1;
          readyState = 0; bufferedAmount = 0;
          constructor(url) {
            this.url = String(url); window.sockets.push(this);
            setTimeout(() => {
              if (this.readyState === 3) return;
              this.readyState = 1; this.onopen?.({});
              this.onmessage?.({data:JSON.stringify({type:'ready', offsetBytes:0, generation:'test', flowControl:true})});
              this.onmessage?.({data:JSON.stringify({type:'snapshot', data:btoa('\\x1b[?2004hready> ')})});
            }, 20);
          }
          send(raw) {
            const message = JSON.parse(raw);
            if (message.type === 'paste') {
              if (message.start) this.paste = '';
              this.paste += message.data;
              if (!message.end) return;
              message.data = this.paste;
            }
            if (message.type === 'input' || message.type === 'paste') {
              window.inputs.push({socket:window.sockets.indexOf(this), data:message.data});
              setTimeout(() => this.onmessage?.({data:new TextEncoder().encode(message.data).buffer}), 0);
            }
          }
          close() { this.readyState = 3; setTimeout(() => this.onclose?.({}), 0); }
        }
        window.WebSocket = Socket;
        function App() {
          const [sessions, setSessions] = React.useState(createTerminalPaneSessionsState);
          const [visible, setVisible] = React.useState(true);
          const [label, setLabel] = React.useState('first');
          window.showTerminal = setVisible; window.rename = () => setLabel('renamed');
          window.addTab = () => setSessions(s => createTerminalPaneSession(s, '/tmp'));
          window.activate = id => setSessions(s => setActiveTerminalPaneSession(s, id));
          return visible && <DroneTerminalDock droneId="terminal-smoke" droneName={label} chatName={label} defaultCwd="/tmp" paneKey="single"
            disabled={false} sessionsState={sessions}
            onEnsureSessions={() => setSessions(s => ensureTerminalPaneSessionsInitialized(s, '/tmp'))}
            onCreateSession={() => window.addTab()} onActivateSession={(_,__,id) => window.activate(id)}
            onResolveSessionName={(_,__,id,name) => setSessions(s => setTerminalPaneSessionName(s,id,name))}
            onCloseSession={(_,__,id) => setSessions(s => closeTerminalPaneSession(s,id))} />;
        }
        createRoot(document.getElementById('root')).render(<App />);
      ` }, bundle: true, outfile: path.join(dir, 'fixture.js'), platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    });
    fs.writeFileSync(path.join(dir, 'index.html'), `<html><head><link rel="stylesheet" href="fixture.css"><style>
      html,body,#root {margin:0;width:100%;height:100%} .h-full{height:100%} .w-full{width:100%} .relative{position:relative}
      #root>div{display:flex;flex-direction:column} #root>div>div:last-child{flex:1;min-height:0}
      </style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
    function run() {
      const { app, BrowserWindow } = require('electron');
      const assert = require('node:assert/strict');
      const path = require('node:path');
      app.setPath('userData', path.join(__dirname, 'profile'));
      const timeout = setTimeout(() => { console.error('Terminal smoke timed out'); app.exit(1); }, 20000);
      app.whenReady().then(async () => {
        const win = new BrowserWindow({ show: false, width: 900, height: 600, webPreferences: { backgroundThrottling: false } });
        const evaluate = code => win.webContents.executeJavaScript(code);
        await win.loadFile(path.join(__dirname, 'index.html'));
        const pause = ms => new Promise(r => setTimeout(r, ms));
        const until = async expr => { for (let i = 0; i < 200; i++) { if (await evaluate(expr)) return; await pause(10); } throw new Error('Timed out: '+expr); };
        await until('window.terminals?.length === 1');
        await evaluate('window.terminals[0].input("early", true)');
        await until('window.inputs?.length > 0');
        assert.equal(await evaluate('window.inputs.map(x=>x.data).join("")'), 'early');
        await pause(100);
        assert.equal(await evaluate('window.opens.length'), 1, 'Session name resolution must not open twice');
        assert.equal(await evaluate('window.sockets.length'), 1);
        await evaluate('window.rename()');
        await pause(30);
        assert.equal(await evaluate('window.opens.length'), 1, 'Renaming/changing chat must not reopen shell');
        await evaluate('window.addTab()');
        await until('window.sockets.length === 2 && window.sockets[1].readyState === 1');
        await evaluate('window.activate("terminal-1")');
        await pause(30);
        assert.equal(await evaluate('window.opens.length'), 2, 'Switching tabs must reuse session');
        assert.equal(await evaluate('window.terminals.length'), 2, 'Switching tabs must reuse xterm');
        assert.match(await evaluate('window.terminals[0].buffer.active.getLine(0).translateToString(true)'), /early/);
        await evaluate('window.showTerminal(false)'); await pause(30);
        await evaluate('window.showTerminal(true)'); await pause(30);
        assert.equal(await evaluate('window.opens.length'), 2, 'Pane remount must reuse session');
        await evaluate('window.terminals[0].input("\\n€🙂", true)');
        await until('window.inputs.length === 2');
        await pause(30);
        const screen = await evaluate('Array.from({length:5},(_,i)=>window.terminals[0].buffer.active.getLine(i)?.translateToString(true)).join("\\n")');
        assert.match(screen, /€🙂/);
        assert.equal(await evaluate('window.inputs[1].socket'), 0, 'Input targets the restored session');
        await evaluate('window.largePaste = "🙂".repeat(9000) + "\\nend"; window.terminals[0].paste(window.largePaste)');
        await until('window.inputs.length === 3');
        assert(await evaluate('window.inputs[2].data === window.largePaste.replace(/\\n/g, "\\r")'), 'Chunked paste preserves Unicode and xterm newline normalization');
        const renderMs = await evaluate('new Promise(resolve => { const start = performance.now(); window.terminals[0].write("build output line\\r\\n".repeat(20000), () => resolve(performance.now() - start)); })');
        assert((await evaluate('window.terminals[0].buffer.active.length')) <= 15100, 'Scrollback remains bounded under heavy output');
        await evaluate('window.snapshotTerminal = window.makeSnapshotTerminal(); new Promise(resolve => window.snapshotTerminal.write(Uint8Array.from(atob(window.realSnapshot), c => c.charCodeAt(0)), resolve))');
        assert.equal(await evaluate('window.snapshotTerminal.buffer.active.cursorY'), 0, 'Legacy snapshot must restore the cursor to the prompt row');
        assert.equal(await evaluate('window.snapshotTerminal.buffer.active.cursorX'), 8, 'Legacy snapshot must restore the cursor column including prompt whitespace');
        assert.equal(await evaluate('window.snapshotTerminal.buffer.active.getLine(0).getCell(0).getFgColor()'), 2, 'Snapshot preserves ANSI prompt highlighting');
        await evaluate('new Promise(resolve => window.snapshotTerminal.write("typed", resolve))');
        assert.equal(await evaluate('window.snapshotTerminal.buffer.active.getLine(0).translateToString(true)'), 'PROMPT> typed');
        assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b => b.textContent === "Diagnostics")'), false);
        assert.equal(await evaluate('Boolean(document.querySelector(' + JSON.stringify('section[aria-label="Terminal diagnostics"]') + '))'), false);
        await until('window.telemetry.some(report => report.events.some(event => event.phase === "snapshot-processed"))');
        assert(await evaluate('window.telemetry.some(report => report.transport === "persistent" && report.events.some(event => event.phase === "ready"))'));
        assert.equal(await evaluate('JSON.stringify(window.telemetry).includes("early")'), false, 'Telemetry must exclude terminal input');
        console.log('PASS: real tmux snapshot restores cursor and ANSI colors; timing reports upload automatically with no diagnostics UI');
        console.log('PASS: early input, one open, rename stability, cached tabs/remount, Unicode, large paste, and heavy output');
        console.log('DOM renderer: 20,000 lines processed in ' + renderMs.toFixed(1) + 'ms (not a paint measurement)');
        console.log(JSON.stringify(await evaluate('window.metrics()')));
        clearTimeout(timeout);
        app.exit(0);
      }).catch(error => { console.error(error.stack); app.exit(1); });
    }
    fs.writeFileSync(path.join(dir, 'runner.cjs'), `(${run.toString()})()`);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const output = execFileSync(require('electron'), [path.join(dir, 'runner.cjs')], { env, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(output);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) { process.stderr.write(`${error.stderr || error.stack || error}\nArtifacts: ${dir}\n`); process.exitCode = 1; }
}
void main();
