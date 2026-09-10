import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openCodeUsagePromptScript } from '../src/hub/usage/openCodeUsagePromptScript';
import { parseBuiltinPromptJobTranscript } from '../src/hub/builtin-transcript-sessions';

// A local CLI/server fixture exercises the generated script without a provider or a paid request.
const fixture = `#!/usr/bin/env node
const http = require('node:http');
if (process.argv[2] === 'serve') {
  const server = http.createServer((req, res) => {
    if (!req.headers.authorization) { res.writeHead(401); return res.end(); }
    if (process.env.FAIL_USAGE === '1') { res.writeHead(500); return res.end(); }
    const route = new URL(req.url, 'http://localhost').pathname;
    const child = route.includes('/child/');
    const message = (id, created) => ({info: { id, role: 'assistant', providerID: 'provider', modelID: child ? 'small' : 'large',
      time: {created, completed: Date.now()}, tokens: {input: 10, output: 2, reasoning: 3, cache: {read: 4, write: 1}}, cost: 0.001 }});
    const data = route.endsWith('/children') ? (child ? [] : [{id: 'child'}]) :
      [message('copied-' + (child ? 'child' : 'root'), 1), message(child ? 'new-child' : 'new-root', Date.now())];
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data));
  });
  server.listen(0, '127.0.0.1', () => console.log('opencode server listening on http://127.0.0.1:' + server.address().port));
} else {
  if (!process.argv.includes('--attach')) process.exit(2);
  console.log(JSON.stringify({type: 'step_finish', sessionID: 'root', part: {id: 'step', tokens: {input: 10, output: 2, reasoning: 3, cache: {read: 4, write: 1}}}}));
  console.log(JSON.stringify({type: 'text', sessionID: 'root', part: {text: 'done'}}));
  if (process.env.IGNORE_STOP === '1') {
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
    console.log('ready-to-cancel');
  }
}
`;

test('OpenCode cancellation terminates a CLI that ignores SIGTERM', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-cancel-'));
  await fs.writeFile(path.join(directory, 'opencode'), fixture, { mode: 0o700 });
  const child = Bun.spawn(['node', '-e', openCodeUsagePromptScript(['run', '--format', 'json', 'hello'])], {
    cwd: directory, env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, IGNORE_STOP: '1' },
    stdout: 'pipe', stderr: 'pipe',
  });
  try {
    const reader = child.stdout.getReader();
    let output = '';
    while (!output.includes('ready-to-cancel')) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('CLI exited before cancellation');
      output += new TextDecoder().decode(chunk.value);
    }
    reader.releaseLock();
    child.kill('SIGTERM');
    expect(await child.exited).toBe(130);
  } finally {
    child.kill('SIGKILL');
    await child.exited;
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 8000);

for (const failUsage of [false, true]) {
  test(`OpenCode wrapper ${failUsage ? 'preserves successful output when metering fails' : 'includes descendants and excludes copied messages'}`, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-usage-'));
    await fs.writeFile(path.join(directory, 'opencode'), fixture, { mode: 0o700 });
    try {
      const process = Bun.spawn(['node', '-e', openCodeUsagePromptScript(['run', '--format', 'json', 'hello'])], {
        cwd: directory, env: { ...globalThis.process.env, PATH: `${directory}:${globalThis.process.env.PATH}`, FAIL_USAGE: failUsage ? '1' : '0' },
        stdout: 'pipe', stderr: 'pipe',
      });
      const [stdout, stderr, exit] = await Promise.all([
        new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
      ]);
      expect(exit).toBe(0);
      const parsed = parseBuiltinPromptJobTranscript('opencode', stdout);
      expect(parsed?.message).toBe('done');
      if (failUsage) {
        expect(parsed?.usage?.map((item) => item.id)).toEqual(['step']);
        expect(stderr).toContain('usage incomplete');
      } else {
        expect(parsed?.usage?.map((item) => item.id)).toEqual(['new-root', 'new-child']);
        expect(parsed?.usage?.reduce((sum, item) => sum + item.output!, 0)).toBe(10);
        expect(parsed?.usage?.[1].model).toBe('small');
      }
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
}
