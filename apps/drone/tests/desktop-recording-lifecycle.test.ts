import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { installDesktopRecordings, captureArgs } from '../desktop/hub-desktop-recordings.cjs';

let root: string;
const originalPath = process.env.PATH;
const originalFetch = globalThis.fetch;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-lifecycle-'));
  process.env.PATH = `${root}:${originalPath}`;
  await fs.mkdir(path.join(root, 'microphone'));
  await fs.mkdir(path.join(root, 'system'));
  const pactl = `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
console.log(args === 'get-default-source' ? 'physical-mic' : args === 'get-default-sink' ? 'speakers' : JSON.stringify([{name:'physical-mic', mute:false}, {name:'speakers.monitor'}]));
`;
  await fs.writeFile(path.join(root, 'pactl'), pactl, { mode: 0o700 });
  await fs.writeFile(path.join(root, 'ffprobe'), '#!/usr/bin/env node\nconsole.log("ffprobe fake");', { mode: 0o700 });
  await fs.writeFile(path.join(root, 'ffmpeg'), `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv.includes('-version')) { console.log('ffmpeg fake'); process.exit(0); }
for (const source of ['microphone','system']) fs.writeFileSync(source + '/000000.flac', 'audio');
function finish() {
  for (const source of ['microphone','system']) fs.writeFileSync(source + '.csv', '000000.flac,0.000000,1.000000\\n');
  fs.writeFileSync('stopped', 'yes');
  process.exit(0);
}
process.stdin.on('data', finish);
process.on('SIGTERM', finish);
process.stdin.resume();
`, { mode: 0o700 });
});
afterEach(async () => { process.env.PATH = originalPath; globalThis.fetch = originalFetch; await fs.rm(root, { recursive: true, force: true }); });

test('only the owner main frame can start; duplicate starts fail; stop finalizes both sources', async () => {
  let handler: any;
  const owner = { isDestroyed: () => false, webContents: { mainFrame: {} } };
  const requests: string[] = [];
  globalThis.fetch = (async (url, init) => {
    requests.push(String(url));
    if (String(url).endsWith('/create')) return Response.json({ ok: true, recording: { id: 'test-recording' }, directory: root });
    if (String(url).endsWith('/finish')) expect(JSON.parse(String(init!.body)).durationSeconds).toBeGreaterThanOrEqual(0);
    return Response.json({ ok: true });
  }) as typeof fetch;
  const runtime = installDesktopRecordings({ ipcMain: { handle: (_name: string, fn: any) => { handler = fn; } }, getWindow: () => owner, getConnection: () => ({ apiUrl: 'http://local', apiToken: 'test' }) });
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };
  expect(() => handler({ ...event, senderFrame: {} }, 'start')).toThrow('main Drone Hub window');
  const starting = handler(event, 'start', {});
  await expect(handler(event, 'start', {})).rejects.toThrow('already active');
  try {
    await starting;
    expect(runtime.status().id).toBe('test-recording');
    expect(runtime.status().microphone).toBe('physical-mic');
    await handler(event, 'stop');
    expect(runtime.status().id).toBeNull();
    expect(await fs.readFile(path.join(root, 'stopped'), 'utf8')).toBe('yes');
    expect(requests.some(url => url.endsWith('/test-recording/finish'))).toBe(true);
  } finally { await runtime.close(); }
});

test('the lifetime guard stops FFmpeg when its desktop control pipe disappears', async () => {
  const guard = path.resolve(import.meta.dir, '../desktop/hub-audio-capture.cjs');
  const child = spawn(process.execPath, [guard, 'mic', 'monitor'], { cwd: root, env: process.env, stdio: ['pipe', 'ignore', 'pipe'] });
  const finished = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`guard exit ${code}`)));
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await fs.stat(path.join(root, 'microphone/000000.flac')).catch(() => null)) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    child.stdin.end();
    await finished;
    expect(await fs.readFile(path.join(root, 'stopped'), 'utf8')).toBe('yes');
  } finally { clearTimeout(timer); child.kill(); }
});

test('capture uses a shared clock, separate maps and completed-segment manifests', () => {
  const args = captureArgs('mic', 'monitor');
  expect(args).toContain('-copyts');
  expect(args).toContain('-start_at_zero');
  expect(args.slice(args.indexOf('-isync'), args.indexOf('-isync') + 2)).toEqual(['-isync', '0']);
  expect(args).not.toContain('amix');
  expect(args).toContain('microphone.csv');
  expect(args).toContain('system.csv');
});
