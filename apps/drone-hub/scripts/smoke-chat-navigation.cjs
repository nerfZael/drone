const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

// Real Chromium layout with the production transcript, composer, markdown and
// styles. An isolated window/profile and synthetic messages never touch the Hub.
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-chat-navigation-'));
  try {
    const assets = path.resolve(__dirname, '../dist/assets');
    const styles = fs.readdirSync(assets).filter(name => name.endsWith('.css'));
    assert(styles.length, 'Run the drone-hub build first');
    await esbuild.build({
      stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'tsx', contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { ChatTranscriptFrame } from './src/droneHub/chat/ChatTranscriptFrame';
        import { ChatInput } from './src/droneHub/chat/ChatInput';
        import { ActiveComposerProvider } from './src/droneHub/chat/ActiveComposerContext';
        import { MarkdownMessage } from './src/droneHub/chat/MarkdownMessage';
        import { usePinnedTranscriptScroll } from './src/droneHub/chat/use-pinned-transcript-scroll';
        window.fetch = async () => Response.json({ ok: true, models: [], deliveries: [] });
        const drafts = { a: '', b: 'A saved draft\\nwith several lines\\nthat changes the composer height.' };
        function Chat({ chat, extra }) {
          const scroll = usePinnedTranscriptScroll({ contextKey: 'smoke:' + chat,
            initialPosition: 'bottom', contentVersion: chat + ':' + extra });
          return <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ChatTranscriptFrame ref={scroll.bindScrollRef} contentRef={scroll.bindContentRef}
                loading={false} hasContent emptyState={null}>
                {Array.from({ length: chat === 'a' ? 24 : 36 }, (_, i) => <div key={chat + i}>
                  <MarkdownMessage text={'Message ' + chat + '-' + i + '\\n\\n| Column | Value |\\n| --- | --- |\\n| Some longer table text that wraps in narrow windows | 123 |'} />
                </div>)}
                <div data-last-message style={{ minHeight: 50 + extra }}>Last message {chat}</div>
              </ChatTranscriptFrame>
            </div>
            <ChatInput resetKey={chat} droneName="smoke" draftValue={drafts[chat]}
              onDraftValueChange={() => {}} promptError={null} waiting={false} autoFocus={false} onSend={() => {}} />
          </div>;
        }
        function App() {
          const [state, setState] = React.useState({ chat: 'a', remount: false, extra: 0 });
          window.navigate = (chat, remount) => flushSync(() => setState({ chat, remount, extra: 0 }));
          window.grow = extra => flushSync(() => setState(state => ({ ...state, extra })));
          return <ActiveComposerProvider><Chat key={state.remount ? state.chat : 'shared'} {...state} /></ActiveComposerProvider>;
        }
        window.measure = () => {
          const node = document.querySelector('[data-chat-transcript-scroll]');
          return { top: node.scrollTop, gap: node.scrollHeight - node.clientHeight - node.scrollTop,
            height: node.clientHeight, lastBottom: document.querySelector('[data-last-message]').getBoundingClientRect().bottom };
        };
        flushSync(() => createRoot(document.getElementById('root')).render(<App />));
      ` },
      bundle: true, outfile: path.join(dir, 'fixture.js'), platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    });
    fs.writeFileSync(path.join(dir, 'index.html'), `<html><head>
      ${styles.map(name => `<link rel="stylesheet" href="${pathToFileURL(path.join(assets, name))}">`).join('')}
      <style>html,body,#root { margin:0; width:100%; height:100%; } body { overflow:hidden; }</style>
      </head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
    function desktopRunner() {
      const { app, BrowserWindow } = require('electron');
      const assert = require('node:assert/strict');
      const path = require('node:path');
      app.setPath('userData', path.join(__dirname, 'profile'));
      setTimeout(() => { console.error('Chat navigation smoke timed out'); app.exit(1); }, 25000);
      app.whenReady().then(async () => {
        const win = new BrowserWindow({ show: true, width: 850, height: 780,
          webPreferences: { backgroundThrottling: false } });
        win.webContents.on('console-message', (_event, level, message) => {
          if (level >= 2) console.error(message);
        });
        await win.loadFile(path.join(__dirname, 'index.html'));
        const evaluate = source => win.webContents.executeJavaScript(source);
        const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        await frames();
        for (const remount of [false, true]) {
          for (const chat of ['b', 'a', 'b', 'a']) {
            const immediate = await evaluate(`window.navigate('${chat}', ${remount}); window.measure()`);
            assert(Math.abs(immediate.gap) <= 1, 'Navigation positions content before paint: ' + JSON.stringify(immediate));
            await frames();
            const settled = await evaluate('window.measure()');
            assert(Math.abs(settled.gap) <= 1, 'Remains at bottom after layout');
            assert(Math.abs(immediate.lastBottom - settled.lastBottom) <= 1, 'No composer/table height jitter after selection');
          }
        }
        await evaluate(`window.resizeSamples = [];
          window.observer = new ResizeObserver(() => window.resizeSamples.push(window.measure()));
          window.observer.observe(document.querySelector('[data-chat-transcript-scroll]'));
          window.observer.observe(document.querySelector('.dh-chat-transcript'));`);
        await frames();
        await evaluate('window.grow(200)');
        await frames();
        await evaluate("document.getElementById('root').style.height = '600px'");
        await frames();
        await evaluate("document.getElementById('root').style.height = '100%'");
        await frames();
        const samples = await evaluate('window.resizeSamples');
        assert(samples.length >= 3, 'Observed content and viewport resizes');
        assert(samples.every(sample => Math.abs(sample.gap) <= 1), 'Resizes correct the bottom before paint: ' + JSON.stringify(samples));
        await evaluate(`window.observer.disconnect();
          const node = document.querySelector('[data-chat-transcript-scroll]');
          node.scrollTop = 150; node.dispatchEvent(new Event('scroll')); window.grow(400);`);
        await frames();
        assert.equal((await evaluate('window.measure()')).top, 150, 'A reader scrolled up is not pulled down');
        // Dockview's default renderer detaches the inactive panel's DOM while
        // retaining its React tree. Match that lifecycle when visiting Editor.
        await evaluate(`window.hiddenChat = document.getElementById('root').firstElementChild;
          window.hiddenChat.remove();`);
        await frames();
        await evaluate(`document.getElementById('root').append(window.hiddenChat)`);
        await frames();
        assert.equal((await evaluate('window.measure()')).top, 150, 'Returning from Editor preserves the reading position');
        await evaluate(`{ const node = document.querySelector('[data-chat-transcript-scroll]');
          node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll'));
          window.hiddenChat.remove(); }`);
        await frames();
        await evaluate('window.grow(800)');
        await frames();
        await evaluate(`document.getElementById('root').append(window.hiddenChat)`);
        await frames();
        assert(Math.abs((await evaluate('window.measure()')).gap) <= 1, 'Returning from Editor follows content received while hidden');
        console.log('PASS: reused and remounted chats settle before paint; content/composer resizing stays pinned; Editor round trips preserve reading position and bottom following');
        app.exit(0);
      }).catch(error => { console.error(error.stack); app.exit(1); });
    }
    fs.writeFileSync(path.join(dir, 'runner.cjs'), `(${desktopRunner.toString()})()`);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const output = execFileSync(require('electron'), [path.join(dir, 'runner.cjs')], {
      env, encoding: 'utf8', timeout: 35000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    process.stdout.write(output);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    process.stderr.write(`${error.stderr || error.stack || error}\nArtifacts: ${dir}\n`);
    process.exitCode = 1;
  }
}
void main();
