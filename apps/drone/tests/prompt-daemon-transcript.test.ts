import fs from 'node:fs';
import cp from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
const tmuxSupport = getTmuxSupport();
if (!listenSupport.ok && process.env.CI) {
  throw new Error(`prompt daemon transcript tests require local socket binding support: ${listenSupport.detail}`);
}
if (!tmuxSupport.ok && process.env.CI) {
  throw new Error(`prompt daemon transcript tests require tmux: ${tmuxSupport.detail}`);
}
if (!listenSupport.ok) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping prompt daemon transcript tests: ${listenSupport.detail}`);
}
if (!tmuxSupport.ok) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping prompt daemon transcript tests: ${tmuxSupport.detail}`);
}

const describeRuntimeSuite = listenSupport.ok && tmuxSupport.ok ? describe : describe.skip;
const daemonEntry = path.resolve(__dirname, '..', 'src', 'daemon.ts');

function getTmuxSupport(): { ok: boolean; detail: string } {
  const result = cp.spawnSync('tmux', ['-V'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.status === 0) return { ok: true, detail: '' };
  const detail = [String(result.stdout ?? '').trim(), String(result.stderr ?? '').trim(), result.error?.message ?? '']
    .filter(Boolean)
    .join(' | ');
  return { ok: false, detail: detail || `tmux -V exited with status ${String(result.status ?? 'unknown')}` };
}

async function allocatePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('failed to allocate test port'));
        return;
      }
      const { port } = addr;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForHealth(baseUrl: string, token: string, daemon: ReturnType<typeof Bun.spawn>) {
  const startedAt = Date.now();
  let lastError = '';
  while (Date.now() - startedAt < 10_000) {
    try {
      const response = await fetch(`${baseUrl}/v1/health`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) return;
      lastError = await response.text();
    } catch (error: any) {
      lastError = error?.message ?? String(error);
    }
    await Bun.sleep(100);
  }
  const stderr = await new Response(daemon.stderr).text().catch(() => '');
  throw new Error(`timed out waiting for daemon health: ${lastError || stderr || 'unknown error'}`);
}

async function waitForPromptJob(baseUrl: string, token: string, id: string): Promise<any> {
  const startedAt = Date.now();
  let lastJob: any = null;
  while (Date.now() - startedAt < 15_000) {
    const response = await fetch(`${baseUrl}/v1/prompts/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data: any = await response.json();
    lastJob = data?.job ?? data;
    if (lastJob?.state === 'done') return lastJob;
    if (lastJob?.state === 'failed') {
      throw new Error(`prompt job failed: ${String(lastJob?.error ?? lastJob?.stderr ?? 'unknown error')}`);
    }
    await Bun.sleep(150);
  }
  throw new Error(`timed out waiting for prompt job ${id}: ${JSON.stringify(lastJob)}`);
}

async function waitForRunningPromptJob(baseUrl: string, token: string, id: string, predicate: (job: any) => boolean): Promise<any> {
  const startedAt = Date.now();
  let lastJob: any = null;
  while (Date.now() - startedAt < 10_000) {
    const response = await fetch(`${baseUrl}/v1/prompts/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data: any = await response.json();
    lastJob = data?.job ?? data;
    if (lastJob?.state === 'failed') {
      throw new Error(`prompt job failed: ${String(lastJob?.error ?? lastJob?.stderr ?? 'unknown error')}`);
    }
    if (lastJob?.state === 'running' && predicate(lastJob)) return lastJob;
    await Bun.sleep(100);
  }
  throw new Error(`timed out waiting for running prompt job ${id}: ${JSON.stringify(lastJob)}`);
}

describeRuntimeSuite('prompt daemon transcripts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-prompt-daemon-transcript-'));
  const processes: Array<ReturnType<typeof Bun.spawn>> = [];

  afterAll(async () => {
    for (const daemon of processes) {
      daemon.kill();
      await daemon.exited.catch(() => {});
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test(
    'persists the final Codex transcript message when stored stdout is truncated',
    async () => {
      const port = await allocatePort();
      const dataDir = path.join(tempRoot, `daemon-${port}`);
      fs.mkdirSync(dataDir, { recursive: true });
      const scriptPath = path.join(tempRoot, `large-codex-jsonl-${port}.js`);
      fs.writeFileSync(
        scriptPath,
        `
const filler = 'x'.repeat(2 * 1024 * 1024 + 1024);
console.log(JSON.stringify({ type: 'thread.started', thread_id: '019e1922-047b-74b1-bab8-0eaceadf4062' }));
console.log(JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'Interim status.' } }));
console.log(JSON.stringify({ type: 'item.completed', item: { id: 'tool_1', type: 'tool_call_output', text: filler } }));
console.log(JSON.stringify({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Final report.' } }));
console.log(JSON.stringify({ type: 'turn.completed' }));
`,
        'utf8',
      );

      const token = 'daemon-token';
      const daemon = Bun.spawn([process.execPath, daemonEntry, '--host', '127.0.0.1', '--port', String(port), '--data-dir', dataDir, '--token', token], {
        cwd: process.cwd(),
        stdout: 'ignore',
        stderr: 'pipe',
      });
      processes.push(daemon);
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForHealth(baseUrl, token, daemon);

      const id = `large-codex-jsonl-${port}`;
      const enqueue = await fetch(`${baseUrl}/v1/prompts/enqueue`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ id, kind: 'codex', cmd: process.execPath, args: [scriptPath] }),
      });
      expect(enqueue.status).toBe(202);

      const job = await waitForPromptJob(baseUrl, token, id);
      expect(job.exitStatusSource).toBe('exit-file');
      expect(String(job.wrapperLog ?? '')).toContain('prompt wrapper: command exited');
      expect(job.stdoutTruncated).toBe(true);
      expect(job.stdoutBytes).toBeGreaterThan(2 * 1024 * 1024);
      expect(String(job.stdout ?? '')).toContain('Interim status.');
      expect(String(job.stdout ?? '')).toContain('truncated');
      expect(String(job.stdout ?? '')).not.toContain('Final report.');
      expect(job.transcript).toMatchObject({
        kind: 'codex',
        threadId: '019e1922-047b-74b1-bab8-0eaceadf4062',
        message: 'Final report.',
        terminalEvent: 'turn.completed',
        stdoutTruncated: true,
      });
      expect(job.transcript.stdoutBytes).toBe(job.stdoutBytes);
    },
    20_000,
  );

  test(
    'persists the final Blip transcript message when stored stdout is truncated',
    async () => {
      const port = await allocatePort();
      const dataDir = path.join(tempRoot, `daemon-${port}`);
      fs.mkdirSync(dataDir, { recursive: true });
      const scriptPath = path.join(tempRoot, `large-blip-jsonl-${port}.js`);
      fs.writeFileSync(
        scriptPath,
        `
const filler = 'x'.repeat(2 * 1024 * 1024 + 1024);
console.log(JSON.stringify({ type: 'session_started', sessionId: 'blip-session-1' }));
console.log(JSON.stringify({ type: 'assistant_message', sessionId: 'blip-session-1', text: 'Interim status.' }));
console.log(JSON.stringify({ type: 'tool_result', sessionId: 'blip-session-1', text: filler }));
console.log(JSON.stringify({ type: 'assistant_message', sessionId: 'blip-session-1', text: 'Final Blip report.' }));
console.log(JSON.stringify({ type: 'session_finished', sessionId: 'blip-session-1' }));
`,
        'utf8',
      );

      const token = 'daemon-token';
      const daemon = Bun.spawn([process.execPath, daemonEntry, '--host', '127.0.0.1', '--port', String(port), '--data-dir', dataDir, '--token', token], {
        cwd: process.cwd(),
        stdout: 'ignore',
        stderr: 'pipe',
      });
      processes.push(daemon);
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForHealth(baseUrl, token, daemon);

      const id = `large-blip-jsonl-${port}`;
      const enqueue = await fetch(`${baseUrl}/v1/prompts/enqueue`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ id, kind: 'blip', cmd: process.execPath, args: [scriptPath] }),
      });
      expect(enqueue.status).toBe(202);

      const job = await waitForPromptJob(baseUrl, token, id);
      expect(job.exitStatusSource).toBe('exit-file');
      expect(job.stdoutTruncated).toBe(true);
      expect(String(job.stdout ?? '')).toContain('Interim status.');
      expect(String(job.stdout ?? '')).not.toContain('Final Blip report.');
      expect(job.transcript).toMatchObject({
        kind: 'blip',
        sessionId: 'blip-session-1',
        message: 'Final Blip report.',
        terminalEvent: 'session_finished',
        stdoutTruncated: true,
      });
      expect(job.transcript.stdoutBytes).toBe(job.stdoutBytes);
    },
    20_000,
  );

  test(
    'returns live Blip clone activity while a prompt job is still running',
    async () => {
      const port = await allocatePort();
      const dataDir = path.join(tempRoot, `daemon-${port}`);
      fs.mkdirSync(dataDir, { recursive: true });
      const scriptPath = path.join(tempRoot, `running-blip-clones-${port}.sh`);
      fs.writeFileSync(
        scriptPath,
        `
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' '{"type":"session_started","sessionId":"blip-session-running"}'
printf '%s\n' '{"type":"tool_call_started","sessionId":"blip-session-running","callId":"call_clones","tool":"create_clones","args":{"tasks":["build cli app one","build cli app two","build cli app three"]}}'
sleep 5
printf '%s\n' '{"type":"tool_call_completed","sessionId":"blip-session-running","callId":"call_clones","tool":"create_clones","result":{"maxClones":8,"clones":[]}}'
printf '%s\n' '{"type":"assistant_message","sessionId":"blip-session-running","text":"Done."}'
printf '%s\n' '{"type":"session_finished","sessionId":"blip-session-running"}'
`,
        'utf8',
      );
      fs.chmodSync(scriptPath, 0o700);

      const token = 'daemon-token';
      const daemon = Bun.spawn([process.execPath, daemonEntry, '--host', '127.0.0.1', '--port', String(port), '--data-dir', dataDir, '--token', token], {
        cwd: process.cwd(),
        stdout: 'ignore',
        stderr: 'pipe',
      });
      processes.push(daemon);
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForHealth(baseUrl, token, daemon);

      const id = `running-blip-clones-${port}`;
      const enqueue = await fetch(`${baseUrl}/v1/prompts/enqueue`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ id, kind: 'blip', cmd: '/bin/bash', args: [scriptPath] }),
      });
      expect(enqueue.status).toBe(202);

      const running = await waitForRunningPromptJob(baseUrl, token, id, (job) => job?.transcript?.cloneActivity?.count === 3);
      expect(running.transcript).toMatchObject({
        kind: 'blip',
        sessionId: 'blip-session-running',
        message: null,
        cloneActivity: {
          status: 'running',
          count: 3,
          tasks: ['build cli app one', 'build cli app two', 'build cli app three'],
        },
      });

      const done = await waitForPromptJob(baseUrl, token, id);
      expect(done.transcript).toMatchObject({
        kind: 'blip',
        sessionId: 'blip-session-running',
        message: 'Done.',
        terminalEvent: 'session_finished',
      });
      expect(done.transcript).not.toHaveProperty('cloneActivity');
    },
    20_000,
  );
});
