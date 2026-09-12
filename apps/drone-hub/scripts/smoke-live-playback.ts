/** Production playback in real Chrome with synthetic, ordered network jitter. No API calls. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const temp = await mkdtemp(join(tmpdir(), 'live-playback-smoke-'));
const entry = join(temp, 'entry.ts');
const audioModule = new URL('../src/droneHub/companion/browser-live-pcm-audio.ts', import.meta.url).pathname;
await Bun.write(entry, `
import { openBrowserLivePcmAudio } from ${JSON.stringify(audioModule)};
globalThis.runSmoke = async () => {
  const results = [];
  for (const scenario of ['regular', 'delayed']) {
    const errors = []; const scheduled = []; let captures = 0;
    const original = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function() {
      const node = original.call(this); const start = node.start.bind(node); const context = this;
      node.start = function(when) { scheduled.push({start: when, now: context.currentTime, duration: node.buffer.duration}); start(when); };
      return node;
    };
    const audio = await openBrowserLivePcmAudio({onAudio: () => captures++, onError: e => errors.push(e)}, () => {});
    try {
      // Let the render clock start before comparing steady-state delivery.
      await new Promise(r => setTimeout(r, 200));
      const pcm = new Uint8Array(4800); const view = new DataView(pcm.buffer);
      for (let i=0;i<2400;i++) view.setInt16(i*2, Math.round(Math.sin(i*2*Math.PI*440/24000)*10000), true);
      const chunk = btoa(String.fromCharCode(...pcm));
      const base = performance.now();
      for(let i=0;i<40;i++) {
        const delay = scenario === 'delayed' ? ({5:80,15:160,25:240}[i] || 0) : 0;
        const target = base + i*100 + delay;
        await new Promise(r => setTimeout(r, Math.max(0,target-performance.now())));
        audio.play(chunk);
      }
      const gaps = scheduled.slice(1).map((s,i) => Math.max(0, s.start-scheduled[i].start-scheduled[i].duration)*1000);
      results.push({scenario, chunks:scheduled.length, captures, errors,
        gapsAbove10Ms:gaps.filter(g=>g>10).map(g=>Math.round(g*100)/100),
        totalGapMs: Math.round(gaps.reduce((a,b)=>a+b,0)*100)/100,
        maxGapMs: Math.round(Math.max(...gaps)*100)/100});
    } finally { await audio.release(); AudioContext.prototype.createBufferSource = original; }
  }
  return results;
};
`);
const bundle = await Bun.build({ entrypoints: [entry], target: 'browser' });
if (!bundle.success) throw new Error(String(bundle.logs));
const script = await bundle.outputs[0].text();
const server = Bun.serve({ port: 0, fetch: (request) => new URL(request.url).pathname === '/app.js'
  ? new Response(script, { headers: { 'content-type': 'application/javascript' } })
  : new Response('<script src="/app.js"></script>', { headers: { 'content-type': 'text/html' } }) });
const wav = Buffer.alloc(44 + 24000 * 2 * 3);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < 72000; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 24000) * 10000), 44 + i * 2);
await Bun.write(join(temp, 'mic.wav'), wav);
const chrome = spawn(process.env.CHROME_BIN ?? 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu',
  '--remote-debugging-port=0', `--user-data-dir=${join(temp, 'profile')}`, '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${join(temp, 'mic.wav')}`,
  '--autoplay-policy=no-user-gesture-required', `http://localhost:${server.port}`], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket: WebSocket | undefined;
try {
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome did not start')), 15000);
    let stderr = '';
    chrome.on('error', reject);
    chrome.stderr.on('data', (data) => {
      stderr += data.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    chrome.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`Chrome exited ${code}: ${stderr}`)); });
  });
  const origin = new URL(endpoint).origin.replace('ws:', 'http:');
  let page: any;
  for (let i = 0; i < 50; i++) {
    page = ((await (await fetch(`${origin}/json/list`)).json()) as any[]).find((page) => page.type === 'page');
    if (page) break;
    await Bun.sleep(100);
  }
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket!.onopen = resolve; socket!.onerror = reject; });
  let id = 0;
  const pending = new Map<number, { resolve(value: any): void; reject(error: unknown): void }>();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(String(data));
    if (!message.id) return;
    const promise = pending.get(message.id); pending.delete(message.id);
    if (message.error) promise?.reject(message.error); else promise?.resolve(message.result);
  };
  const command = (method: string, params: unknown) => new Promise<any>((resolve, reject) => {
    pending.set(++id, { resolve, reject }); socket!.send(JSON.stringify({ id, method, params }));
  });
  await command('Runtime.enable', {});
  for (let i = 0; i < 100; i++) {
    try {
      const loaded = await command('Runtime.evaluate', { expression: "document.readyState === 'complete' && typeof globalThis.runSmoke === 'function'", returnByValue: true });
      if (loaded.result?.value) break;
    } catch {}
    await Bun.sleep(100);
  }
  const result = await command('Runtime.evaluate', { expression: '(async () => { while (!globalThis.runSmoke) await new Promise(r => setTimeout(r, 50)); return await runSmoke(); })()', awaitPromise: true, returnByValue: true, timeout: 15000 });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  const value = result.result.value;
  console.log('Production browser playback timing:', JSON.stringify(value));
  if (value.some((result: any) => result.chunks !== 40 || result.errors.length || result.gapsAbove10Ms.length)) {
    throw new Error('Live playback introduced gaps under bounded jitter');
  }
} finally {
  socket?.close(); chrome.kill(); server.stop(true);
  await new Promise((resolve) => { if (chrome.exitCode !== null) resolve(undefined); else chrome.once('exit', resolve); });
  await rm(temp, { recursive: true, force: true });
}
