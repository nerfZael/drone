const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { WebSocket } = require('ws');
const exec = promisify(execFile);

test('built daemon ensures sessions once, captures the first prompt, and exposes persistent terminal transport', { timeout: 45000 }, async (t) => {
  const dir = await fs.mkdtemp('/tmp/terminal-daemon-test-');
  const bin = path.join(dir, 'bin');
  const data = path.join(dir, 'data');
  await fs.mkdir(bin);
  await fs.mkdir(path.join(data, 'tmux-sessions'), { recursive: true });
  const tmux = (await exec('which', ['tmux'])).stdout.trim();
  const config = path.join(dir, 'tmux.conf');
  await fs.writeFile(config, 'set -g base-index 1\nset-window-option -g pane-base-index 1\n');
  const quote = value => `'${value.replace(/'/g, `'\\''`)}'`;
  await fs.writeFile(path.join(bin, 'tmux'), `#!/bin/sh\nexec ${quote(tmux)} -S ${quote(path.join(dir, 'socket'))} -f ${quote(config)} "$@"\n`, { mode: 0o755 });
  const listener = http.createServer();
  await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  await new Promise(r => listener.close(r));
  const child = spawn(process.execPath, [path.resolve(__dirname, '../../dist/daemon.js'), '--host', '127.0.0.1', '--port', String(port), '--data-dir', data, '--token', 'test-token'], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  child.stdout.on('data', data => { diagnostics = (diagnostics + data).slice(-4000); });
  child.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-4000); });
  let ws;
  t.after(async () => {
    ws?.terminate();
    child.kill('SIGTERM');
    await new Promise(r => { if (child.exitCode !== null) r(); else child.once('exit', r); });
    await exec(tmux, ['-S', path.join(dir, 'socket'), 'kill-server']).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  });
  const request = async (pathname, payload) => {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method: payload ? 'POST' : 'GET', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  let health;
  for (let i = 0; i < 200; i++) {
    try { health = await request('/v1/health'); break; } catch { await new Promise(r => setTimeout(r, 20)); }
  }
  assert.ok(health, diagnostics);
  assert.ok(health.capabilities.includes('terminal-control-v1'));
  const payload = { session: 'test-terminal', cmd: 'bash', args: ['--noprofile', '--norc', '-i'], cwd: dir };
  const other = { ...payload, session: 'test-terminal-other' };
  assert.equal((await request('/v1/terminal/ensure', other)).reused, false);
  await request('/v1/process/stop', { session: payload.session });
  assert.equal((await request('/v1/terminal/ensure', other)).reused, true, 'Stopping an absent session must not stop a prefix match');
  const results = await Promise.all(Array.from({ length: 5 }, () => request('/v1/terminal/ensure', payload)));
  assert.equal(results.filter(r => !r.reused).length, 1);
  const samples = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    assert.equal((await request('/v1/terminal/ensure', payload)).reused, true);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  t.diagnostic(`10 warm ensure-session HTTP samples: median=${((samples[4] + samples[5]) / 2).toFixed(2)}ms`);
  const output = await request('/v1/terminal/output?session=test-terminal');
  assert.match(output.chunk, /bash-.*[$#]/, 'The first prompt must be logged');
  ws = new WebSocket(`ws://127.0.0.1:${port}/v1/terminal/connect?session=test-terminal&cols=90&rows=25`, { headers: { authorization: 'Bearer test-token' } });
  const messages = [];
  ws.on('message', (data, binary) => { if (!binary) messages.push(JSON.parse(data.toString())); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('snapshot timed out')), 3000);
    ws.on('error', reject);
    ws.on('message', () => { if (messages.some(m => m.type === 'snapshot')) { clearTimeout(timeout); resolve(); } });
  });
  assert.ok(messages.find(m => m.type === 'ready').generation);
  const abort = new AbortController();
  t.after(() => abort.abort());
  const stream = await fetch(`http://127.0.0.1:${port}/v1/terminal/output/stream?session=test-terminal&since=999999999`, {
    headers: { authorization: 'Bearer test-token' }, signal: abort.signal,
  });
  let frames = '';
  try {
    for await (const chunk of stream.body) {
      frames += Buffer.from(chunk).toString();
      if (frames.includes(': keepalive\n\n')) break;
    }
    assert.match(frames, /: keepalive/, 'An idle terminal must send a heartbeat before fetch times out');
  } finally { abort.abort(); }

});
