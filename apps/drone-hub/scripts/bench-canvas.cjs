const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

// Canvas interaction benchmark. Renders the real DroneCanvasDock with synthetic drones and the production
// styles in an isolated Electron window, drives it with real input (wheel zoom, right-drag pan, card drags,
// a marquee, select all, copy, paste, delete, create) and prints canvas-perf's summary of each: frame times,
// frames over 20ms ("slow"), and React renders per component. No Hub server or user profile is used.
//
//   bun run build && node scripts/bench-canvas.cjs
//
// Options:
//   --drones=60 --chats=3   board size (a drone card plus its chats per drone)
//   --scale=0.7             starting zoom; below 0.85 cards are scaled up for readability
//   --wheel=60              wheel delta per tick; 8 with --scale=0.55 keeps the zoom in the scaled-up range
//   --detailed              detailed cards
//   --refresh=1000          ms between synthetic summary refreshes (0: none)
//   --width=1400 --height=900  window size
//   --trace=zoom|pan|marquee|dragall   record a Chrome trace of that step and print where its time went
//   --shots                 save screenshots during and after each zoom, and while edge panning
//   --noshadow --nogrid     strip card shadows or the dot grid, to see what they cost
//   --shadow='0 2px 4px #0008'  give every card this shadow and nothing else one, to see what it costs
//   --panx=20 --pany=20     starting pan; a fraction of a pixel shows whether text stays sharp
//   --still                 only save a screenshot of the board at rest (still.png), e.g. to compare sharpness
//   --zoomin=10 --settle=1500  with --still: first zoom in with that many wheel notches, then wait
//   --nolayer               draw the pan as a plain 2D transform with no GPU layer, as the canvas once did
//   --fraclayer             move the pan layer by the exact fractional pan, as before it snapped to pixels
//   --out=result.json       write the raw summaries
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value ?? '1'];
}));

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-canvas-bench-'));
  const assets = path.resolve(__dirname, '../dist/assets');
  const styles = fs.existsSync(assets) ? fs.readdirSync(assets).filter((name) => name.endsWith('.css')) : [];
  assert(styles.length, 'Run the drone-hub build first');
  const drones = Number(args.drones ?? 60);
  const chats = Number(args.chats ?? 3);
  await esbuild.build({
    stdin: {
      resolveDir: path.resolve(__dirname, '..'), loader: 'tsx', contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { DroneHubDndProvider } from './src/droneHub/app/drone-hub-dnd';
        import { ActiveComposerProvider } from './src/droneHub/chat/ActiveComposerContext';
        import { DroneCanvasDock } from './src/droneHub/canvas/DroneCanvasDock';
        import './src/droneHub/canvas/canvas-perf';
        import { useDroneCanvasStore } from './src/droneHub/canvas/use-drone-canvas-store';
        import { useDroneHubUiStore } from './src/droneHub/app/use-drone-hub-ui-store';
        import { createCanvasChatNodeId, createCanvasDroneNodeId } from './src/droneHub/app/app-config';
        window.fetch = async () => Response.json({ ok: true, models: [], deliveries: [], chats: [] });
        window.__droneCanvasPerf.enable();
        useDroneHubUiStore.getState().setCanvasDetailedCards(${args.detailed === '1'});
        const DRONES = ${drones}, CHATS = ${chats};
        const chatNames = Array.from({ length: CHATS }, (_, i) => i === 0 ? 'default' : 'chat-' + i);
        // Rebuilt on every refresh, like the Hub's summaries: new objects with the same content.
        function buildSummaries(revision) {
          const droneById = {}, droneNameById = {}, droneRepoById = {}, chatNodeStateById = {}, fleetParentIdByDroneId = {};
          for (let d = 0; d < DRONES; d++) {
            const id = 'drone-' + d;
            droneById[id] = { id, name: 'Drone number ' + d, group: null, createdAt: '', repoPath: '/repo/project-' + (d % 5),
              repoBranch: 'feature/branch-' + d, containerPort: 0, hostPort: null, statusOk: true, statusError: null,
              chats: chatNames.slice(), runtime: d % 3 ? 'container' : 'host', revision };
            droneNameById[id] = 'Drone number ' + d;
            droneRepoById[id] = 'project-' + (d % 5);
            if (d % 4 === 1) fleetParentIdByDroneId[id] = 'drone-' + (d - 1);
            for (const chat of chatNames) {
              chatNodeStateById[createCanvasChatNodeId(id, chat)] = { statusOk: true, statusError: null,
                busy: (d + chat.length) % 7 === 0, unreadAgentMessage: d % 5 === 0, lastAgentSnippet: 'Last reply ' + d };
            }
          }
          return { droneById, droneNameById, droneRepoById, chatNodeStateById, fleetParentIdByDroneId };
        }
        // A drone card with its chats in a row under it, eight drones to a row.
        const nodes = [];
        for (let d = 0; d < DRONES; d++) {
          const x = (d % 8) * 420, y = Math.floor(d / 8) * 200;
          nodes.push({ droneId: createCanvasDroneNodeId('drone-' + d), label: 'Drone number ' + d, x, y });
          chatNames.forEach((chat, i) => nodes.push({ droneId: createCanvasChatNodeId('drone-' + d, chat), label: chat, x: x + i * 120, y: y + 80 }));
        }
        useDroneCanvasStore.setState({ scope: 'global' });
        useDroneCanvasStore.getState().upsertNodes(nodes);
        useDroneCanvasStore.getState().setViewport(${Number(args.panx ?? 20)}, ${Number(args.pany ?? 20)}, ${Number(args.scale ?? 0.7)});
        let cloneCount = 0;
        const noop = () => {};
        function App() {
          const [revision, setRevision] = React.useState(0);
          React.useEffect(() => {
            if (!${Number(args.refresh ?? 1000)}) return;
            const timer = setInterval(() => setRevision((r) => r + 1), ${Number(args.refresh ?? 1000)});
            return () => clearInterval(timer);
          }, []);
          const summaries = React.useMemo(() => buildSummaries(revision), [revision]);
          return <DroneCanvasDock boardDrone={summaries.droneById['drone-0']} {...summaries}
            fleetAssignedIdsByDroneId={{}} sidebarSelectedChatNodeId={null} onActivateChat={noop}
            onCloneChat={async (droneId, chatName, opts) => {
              const name = chatName + '-copy-' + (++cloneCount);
              opts?.onPlaced?.(name);
              return { ok: true, chatName: name };
            }}
            onDeleteChats={async (targets) => targets.map((t) => ({ ...t, ok: true }))}
            spawnAgentMenuEntries={[]} spawnAgentKey="builtin:codex" onOpenCustomAgentModal={noop}
            resolveAgentKey={() => ({ kind: 'builtin', id: 'codex' })} spawnModel=""
            createRepoMenuEntries={[]} createRepoPath="" onCreateRepoPathChange={noop}
            createGroup="" onCreateGroupChange={noop} />;
        }
        createRoot(document.getElementById('root')).render(
          <ActiveComposerProvider><DroneHubDndProvider><App /></DroneHubDndProvider></ActiveComposerProvider>);
      `,
    },
    bundle: true, outfile: path.join(dir, 'fixture.js'), platform: 'browser', logLevel: 'error',
    loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty', '.png': 'empty', '.svg': 'empty', '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  });
  fs.writeFileSync(path.join(dir, 'index.html'), `<html><head>
    ${styles.map((name) => `<link rel="stylesheet" href="${pathToFileURL(path.join(assets, name))}">`).join('')}
    <style>html,body,#root { margin:0; width:100%; height:100%; } body { overflow:hidden; }</style>
    </head><body class="dark"><div id="root"></div><script src="fixture.js"></script></body></html>`);

  function desktopRunner() {
    const { app, BrowserWindow, contentTracing } = require('electron');
    const fs = require('node:fs');
    const path = require('node:path');
    app.setPath('userData', path.join(__dirname, 'profile'));
    setTimeout(() => { console.error('Canvas bench timed out'); app.exit(1); }, 120000);
    const options = JSON.parse(process.env.CANVAS_BENCH_OPTIONS);
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const traced = async (name, run) => {
      if (options.trace !== name) return run();
      await contentTracing.startRecording({ included_categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'gpu', 'v8.execute'] });
      await run();
      console.log('TRACE ' + await contentTracing.stopRecording(path.join(__dirname, 'trace-' + name + '.json')));
    };
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: true, width: options.width, height: options.height, webPreferences: { backgroundThrottling: false } });
      win.webContents.on('console-message', (_event, level, message) => {
        if (level >= 2 && !message.includes('[canvas-perf]')) console.error('page:', message.slice(0, 300));
      });
      await win.loadFile(path.join(__dirname, 'index.html'));
      if (options.nogrid) await win.webContents.insertCSS('[data-canvas-dot-grid] > div { background-image: none !important; }');
      if (options.fraclayer) {
        // The pan layer at the exact fractional offset, as shipped before snapping.
        await win.webContents.executeJavaScript(`setTimeout(() => { document.querySelector('[data-canvas-pan]').style.transform = 'translate3d(${options.panX}px, ${options.panY}px, 0)'; }, 1500); 0`);
      }
      if (options.nolayer) {
        // As the canvas used to draw: a 2D transform and no layer hints, so nothing gets a GPU layer of its own.
        await win.webContents.insertCSS('[data-canvas-pan], [data-canvas-dot-grid] > div { will-change: auto !important; }');
        await win.webContents.executeJavaScript(`setTimeout(() => { for (const el of document.querySelectorAll('[data-canvas-pan], [data-canvas-dot-grid] > div')) el.style.transform = el.style.transform.replace('translate3d(', 'translate(').replace(/, 0(px)?\\)$/, ')'); }, 1500); 0`).catch(() => {});
      }
      if (options.probeblur) {
        // One card fades its opacity, as a done card does on hover; then the wheel zooms in. Compare it with an
        // identical card that did not fade.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const ids = await win.webContents.executeJavaScript(`(() => {
          const cards = [...document.querySelectorAll('[data-canvas-node-kind="chat"]')].filter((c) => c.textContent.trim() === 'chat-1');
          // Two cards one above the other: chat-1 of the first drone and of the first drone in the next row.
          const [faded, plain] = [cards[0], cards[8]];
          // As a finished chat's card: dimmed, brightening while hovered and dimming again after.
          faded.style.transition = 'opacity 100ms';
          faded.style.opacity = '0.8';
          setTimeout(() => { faded.style.opacity = '1'; }, 300);
          setTimeout(() => { faded.style.opacity = '0.8'; }, 600);
          plain.style.opacity = '0.8';
          return [faded.dataset.droneId, plain.dataset.droneId];
        })()`);
        await new Promise((resolve) => setTimeout(resolve, 900));
        // Zoom in on the faded card, so it stays in view with the other one below it.
        const box = await win.webContents.executeJavaScript(`(() => {
          const [a, b] = ${JSON.stringify(ids)}.map((id) => document.querySelector('[data-drone-id="' + CSS.escape(id) + '"]').getBoundingClientRect());
          return { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) };
        })()`);
        win.webContents.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y });
        for (let i = 0; i < 10; i++) {
          win.webContents.sendInputEvent({ type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 60, canScroll: true });
          await new Promise((resolve) => setTimeout(resolve, 16));
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const rects = await win.webContents.executeJavaScript(`${JSON.stringify(ids)}.map((id) => { const r = document.querySelector('[data-drone-id="' + CSS.escape(id) + '"]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })`);
        fs.writeFileSync(path.join(__dirname, 'probe.png'), (await win.webContents.capturePage()).toPNG());
        console.log('PROBE ' + __dirname + ' ' + JSON.stringify(rects));
        app.exit(0);
        return;
      }
      if (options.still) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        if (options.zoomIn) {
          // Arrive at the zoom with the wheel, as a person does, rather than loading at it.
          const at = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector('[data-drone-canvas-viewport]').getBoundingClientRect(); return { x: Math.round(r.x + 150), y: Math.round(r.y + 120) }; })()`);
          win.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
          for (let i = 0; i < options.zoomIn; i++) {
            win.webContents.sendInputEvent({ type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: 60, canScroll: true });
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
          await new Promise((resolve) => setTimeout(resolve, options.settleMs));
          console.log('ZOOMED ' + await win.webContents.executeJavaScript(`document.querySelector('[data-canvas-pan]').style.transform + ' ' + document.querySelector('[data-canvas-world]').style.transform`));
        }
        const image = await win.webContents.capturePage({ x: 0, y: 60, width: 700, height: 260 });
        fs.writeFileSync(path.join(__dirname, 'still.png'), image.toPNG());
        console.log('STILL ' + path.join(__dirname, 'still.png'));
        app.exit(0);
        return;
      }
      if (options.noshadow) await win.webContents.insertCSS('[data-canvas-world] * { box-shadow: none !important; }');
      if (options.shadow) {
        await win.webContents.insertCSS('[data-canvas-world] * { box-shadow: none !important; }');
        await win.webContents.insertCSS(`[data-canvas-world] [data-canvas-node] { box-shadow: ${options.shadow} !important; }`);
      }
      const evaluate = (source) => win.webContents.executeJavaScript(source);
      for (let i = 0; i < 200 && !(await evaluate('!!document.querySelector("[data-canvas-node]")')); i++) await wait(30);
      await wait(1500);
      const send = (event) => win.webContents.sendInputEvent(event);
      const centerOf = (selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), left: r.left, top: r.top, height: r.height }; })()`);
      const viewport = await centerOf('[data-drone-canvas-viewport]');
      const empty = { x: Math.round(viewport.left + 30), y: Math.round(viewport.top + viewport.height - 140) };
      const center = { x: viewport.x, y: viewport.y };
      const INPUT_MS = 8; // A 125Hz mouse.

      let shot = 0;
      const capture = async (name, whole = false) => {
        if (!options.shots) return;
        const image = await win.webContents.capturePage(whole ? undefined : { x: center.x - 300, y: center.y - 200, width: 600, height: 400 });
        const file = path.join(__dirname, `shot-${++shot}-${name}.png`);
        fs.writeFileSync(file, image.toPNG());
        console.log('SHOT ' + file);
      };
      const zoom = async (ticks, deltaY) => {
        for (let i = 0; i < ticks; i++) {
          send({ type: 'mouseWheel', x: center.x, y: center.y, deltaX: 0, deltaY, canScroll: true });
          await wait(INPUT_MS * 2);
        }
        await capture(`zoom${deltaY}-during`);
        await wait(400);
        await capture(`zoom${deltaY}-settled`);
      };
      const drag = async (from, steps, button = 'left') => {
        send({ type: 'mouseMove', x: from.x, y: from.y });
        send({ type: 'mouseDown', button, x: from.x, y: from.y, clickCount: 1 });
        for (let i = 1; i <= steps; i++) {
          send({ type: 'mouseMove', x: from.x + i * 3, y: from.y + i * 2, modifiers: [button + 'ButtonDown'] });
          await wait(INPUT_MS);
        }
        send({ type: 'mouseUp', button, x: from.x + steps * 3, y: from.y + steps * 2, clickCount: 1 });
        await wait(400);
      };
      const key = async (keyCode, modifiers = []) => {
        send({ type: 'keyDown', keyCode, modifiers });
        send({ type: 'char', keyCode, modifiers });
        send({ type: 'keyUp', keyCode, modifiers });
        await wait(400);
      };
      const click = async (point, clickCount = 1) => {
        send({ type: 'mouseDown', button: 'left', x: point.x, y: point.y, clickCount });
        send({ type: 'mouseUp', button: 'left', x: point.x, y: point.y, clickCount });
        await wait(clickCount === 1 ? 0 : 400);
      };

      send({ type: 'mouseMove', x: center.x, y: center.y });
      await traced('zoom', async () => { await zoom(30, options.wheel); await zoom(30, -options.wheel); });
      await traced('pan', () => drag(center, 60, 'right'));
      await drag(await centerOf('[data-canvas-node-kind="chat"]'), 60);
      await traced('marquee', () => drag(empty, 60));
      await key('a', ['control']);
      await traced('dragall', async () => drag(await centerOf('[data-canvas-node-kind="drone"]'), 60));
      await key('Escape');
      await click(await centerOf('[data-canvas-node-kind="chat"]'));
      await wait(400);
      await key('c', ['control']);
      send({ type: 'mouseMove', x: empty.x + 200, y: empty.y });
      await key('v', ['control']);
      await key('Delete');
      await click({ x: empty.x + 400, y: empty.y });
      await click({ x: empty.x + 400, y: empty.y }, 2);
      // Edge pan: middle-click holds the cursor, pushing against an edge or a corner pans that way.
      const panOf = () => evaluate(`(() => { const t = document.querySelector('[data-canvas-pan]').style.transform.match(/translate(?:3d)?\\(([-0-9.]+)px, ([-0-9.]+)px/); return { x: Number(t[1]), y: Number(t[2]) }; })()`);
      const isLocked = () => evaluate('!!document.pointerLockElement');
      // Browsers grant pointer lock only to a focused page.
      app.focus({ steal: true });
      win.focus();
      win.webContents.focus();
      await wait(200);
      send({ type: 'mouseMove', x: center.x, y: center.y });
      send({ type: 'mouseDown', button: 'middle', x: center.x, y: center.y, clickCount: 1 });
      send({ type: 'mouseUp', button: 'middle', x: center.x, y: center.y, clickCount: 1 });
      await wait(300);
      const edgePan = { locked: await isLocked(), moves: [] };
      await capture('edge-locked', true);
      // Under pointer lock the mouse reports movement only, and Electron's injected input reports it wrongly on
      // X11 (measured against the real cursor). Give the lock movement directly, as a mouse would.
      const push = async (dx, dy, steps) => {
        for (let i = 0; i < steps; i++) {
          await evaluate(`document.pointerLockElement?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', movementX: ${dx}, movementY: ${dy} }))`);
          await wait(INPUT_MS * 2);
        }
      };
      let at = { ...center };
      for (const [name, dx, dy] of [['right', 30, 0], ['bottom-left', -30, 30]]) {
        const before = await panOf();
        await push(dx, dy, 60);
        await wait(700);
        await capture('edge-' + name, true);
        const after = await panOf();
        edgePan.cursorAt ??= {};
        edgePan.cursorAt[name] = await evaluate(`({ cursor: document.querySelector('[data-canvas-edge-pan-cursor]').style.transform,
          glow: [...document.querySelectorAll('[data-canvas-edge-glow]')].filter((g) => g.classList.contains('opacity-100')).map((g) => g.dataset.canvasEdgeGlow) })`);
        edgePan.moves.push({ name, dx: Math.round(after.x - before.x), dy: Math.round(after.y - before.y) });
      }
      send({ type: 'mouseDown', button: 'middle', x: at.x, y: at.y, clickCount: 1 });
      send({ type: 'mouseUp', button: 'middle', x: at.x, y: at.y, clickCount: 1 });
      await wait(300);
      edgePan.releasedByMiddleClick = !(await isLocked());
      console.log('EDGEPAN ' + JSON.stringify(edgePan));
      const result = await evaluate(`JSON.stringify({ cards: document.querySelectorAll('[data-canvas-node]').length, log: window.__droneCanvasPerf.log })`);
      console.log('RESULT ' + result);
      app.exit(0);
    }).catch((error) => { console.error(error.stack); app.exit(1); });
  }
  fs.writeFileSync(path.join(dir, 'runner.cjs'), `(${desktopRunner.toString()})()`);
  const env = { ...process.env, CANVAS_BENCH_OPTIONS: JSON.stringify({
    trace: args.trace ?? '', wheel: Number(args.wheel ?? 60), width: Number(args.width ?? 1400), height: Number(args.height ?? 900), shots: Boolean(args.shots),
    noshadow: Boolean(args.noshadow), shadow: args.shadow ?? '', nogrid: Boolean(args.nogrid), nolayer: Boolean(args.nolayer), fraclayer: Boolean(args.fraclayer), still: Boolean(args.still), zoomIn: Number(args.zoomin ?? 0), settleMs: Number(args.settle ?? 1500), probeblur: Boolean(args.probeblur), panX: Number(args.panx ?? 20), panY: Number(args.pany ?? 20),
  }) };
  delete env.ELECTRON_RUN_AS_NODE;
  const output = execFileSync(require('electron'), [path.join(dir, 'runner.cjs')], {
    env, encoding: 'utf8', timeout: 150000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = output.split('\n');
  const probe = lines.find((line) => line.startsWith('PROBE '));
  if (probe) { console.log(probe); return; }
  const still = lines.find((line) => line.startsWith('STILL '));
  for (const line of lines) if (line.startsWith('ZOOMED ')) console.log(line);
  if (still) { console.log(still); return; }
  const resultLine = lines.find((line) => line.startsWith('RESULT '));
  assert(resultLine, output);
  const result = JSON.parse(resultLine.slice('RESULT '.length));
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(result, null, 2));
  for (const line of lines) if (line.startsWith('SHOT ')) console.log(line);
  for (const line of lines) if (line.startsWith('EDGEPAN ')) console.log(`edge pan: ${line.slice('EDGEPAN '.length)}`);
  const traceLine = lines.find((line) => line.startsWith('TRACE '));
  if (traceLine) summarizeTrace(traceLine.slice('TRACE '.length));
  console.log(`${result.cards} cards`);
  for (const summary of result.log) {
    const renders = Object.entries(summary.renders).map(([id, stat]) => `${id}×${stat.count}`).join(' ');
    const timing = summary.name.startsWith('action:')
      ? `${summary.durationMs}ms to paint`
      : `${String(summary.frames).padStart(3)} frames  avg ${String(summary.avgFrameMs).padStart(6)}  p95 ${String(summary.p95FrameMs).padStart(6)}  max ${String(summary.maxFrameMs).padStart(6)}  slow ${String(summary.slowFrames).padStart(3)}`;
    console.log(`${summary.name.padEnd(24)} ${timing}  | ${renders}`);
  }
  if (args.trace || args.shots) console.log(`Artifacts: ${dir}`);
  else fs.rmSync(dir, { recursive: true, force: true });
}

/** Where the traced step's time went: busy time per thread, and the renderer main thread's largest phases. */
function summarizeTrace(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const events = data.traceEvents || data;
  const threads = new Map();
  const processes = new Map();
  for (const event of events) {
    if (event.ph !== 'M') continue;
    if (event.name === 'thread_name') threads.set(`${event.pid}:${event.tid}`, event.args.name);
    if (event.name === 'process_name') processes.set(event.pid, event.args.name);
  }
  const busy = new Map();
  const phases = new Map();
  for (const event of events) {
    if (event.ph !== 'X' || !event.dur) continue;
    const thread = threads.get(`${event.pid}:${event.tid}`) || '';
    if (event.name === 'ThreadControllerImpl::RunTask' || event.name === 'RunTask') {
      const key = `${processes.get(event.pid) || event.pid} / ${thread}`;
      busy.set(key, (busy.get(key) || 0) + event.dur / 1000);
    }
    if (thread === 'CrRendererMain') phases.set(event.name, (phases.get(event.name) || 0) + event.dur / 1000);
  }
  const top = (map, count) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, count);
  console.log('Busy time per thread (ms):');
  for (const [name, ms] of top(busy, 5)) console.log(`  ${ms.toFixed(1).padStart(8)}  ${name}`);
  console.log('Renderer main thread, inclusive (ms):');
  for (const [name, ms] of top(phases, 16)) console.log(`  ${ms.toFixed(1).padStart(8)}  ${name}`);
}

main().catch((error) => {
  process.stderr.write(`${error.stderr || error.stack || error}\n`);
  process.exitCode = 1;
});
