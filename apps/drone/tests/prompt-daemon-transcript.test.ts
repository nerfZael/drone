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
  throw new Error(
    `prompt daemon transcript tests require local socket binding support: ${listenSupport.detail}`,
  );
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
  const detail = [
    String(result.stdout ?? '').trim(),
    String(result.stderr ?? '').trim(),
    result.error?.message ?? '',
  ]
    .filter(Boolean)
    .join(' | ');
  return {
    ok: false,
    detail: detail || `tmux -V exited with status ${String(result.status ?? 'unknown')}`,
  };
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
  while (Date.now() - startedAt < 15_000) {
    try {
      const response = await fetch(`${baseUrl}/v1/health`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) return;
      lastError = await response.text();
    } catch (error: any) {
      lastError = error?.message ?? String(error);
    }
    await Bun.sleep(50);
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
      throw new Error(
        `prompt job failed: ${String(lastJob?.error ?? lastJob?.stderr ?? 'unknown error')}`,
      );
    }
    await Bun.sleep(150);
  }
  throw new Error(`timed out waiting for prompt job ${id}: ${JSON.stringify(lastJob)}`);
}

async function waitForRunningPromptJob(
  baseUrl: string,
  token: string,
  id: string,
  predicate: (job: any) => boolean,
): Promise<any> {
  const startedAt = Date.now();
  let lastJob: any = null;
  while (Date.now() - startedAt < 15_000) {
    const response = await fetch(`${baseUrl}/v1/prompts/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data: any = await response.json();
    lastJob = data?.job ?? data;
    if (lastJob?.state === 'failed') {
      throw new Error(
        `prompt job failed: ${String(lastJob?.error ?? lastJob?.stderr ?? 'unknown error')}`,
      );
    }
    if (lastJob?.state === 'running' && predicate(lastJob)) return lastJob;
    await Bun.sleep(100);
  }
  throw new Error(`timed out waiting for running prompt job ${id}: ${JSON.stringify(lastJob)}`);
}

async function readPromptEventJob(
  baseUrl: string,
  token: string,
  id: string,
  predicate: (job: any) => boolean,
): Promise<any> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(new Error('timed out reading prompt events')), 5_000);
  timeout.unref?.();
  try {
    const response = await fetch(`${baseUrl}/v1/prompts/events`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'text/event-stream',
      },
      signal: abort.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`prompt event stream failed: ${response.status} ${response.statusText}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!abort.signal.aborted) {
        // eslint-disable-next-line no-await-in-loop
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let separatorIndex = buffer.indexOf('\n\n');
        while (separatorIndex !== -1) {
          const frame = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const dataText = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice('data:'.length).trimStart())
            .join('\n');
          if (dataText) {
            const data = JSON.parse(dataText);
            const jobs = Array.isArray(data?.jobs) ? data.jobs : data?.job ? [data.job] : [];
            const job = jobs.find(
              (candidate: any) => String(candidate?.id ?? '') === id && predicate(candidate),
            );
            if (job) return job;
          }
          separatorIndex = buffer.indexOf('\n\n');
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    throw new Error(`prompt event stream ended before reporting ${id}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForTerminalPromptJob(
  baseUrl: string,
  token: string,
  id: string,
  timeoutMs = 15_000,
): Promise<any> {
  const startedAt = Date.now();
  let lastJob: any = null;
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${baseUrl}/v1/prompts/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data: any = await response.json();
    lastJob = data?.job ?? data;
    if (['done', 'failed', 'canceled'].includes(String(lastJob?.state ?? ''))) return lastJob;
    await Bun.sleep(100);
  }
  throw new Error(`timed out waiting for terminal prompt job ${id}: ${JSON.stringify(lastJob)}`);
}

async function waitForRecoveredPromptJob(
  baseUrl: string,
  token: string,
  id: string,
  timeoutMs = 15_000,
): Promise<any> {
  const startedAt = Date.now();
  let lastJob: any = null;
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${baseUrl}/v1/prompts/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data: any = await response.json();
    lastJob = data?.job ?? data;
    if (lastJob?.state === 'done') return lastJob;
    if (lastJob?.state === 'failed' && lastJob?.exitStatusSource !== 'missing-exit-file') {
      throw new Error(`late prompt recovery became terminal: ${JSON.stringify(lastJob)}`);
    }
    await Bun.sleep(100);
  }
  throw new Error(`timed out waiting for recovered prompt job ${id}: ${JSON.stringify(lastJob)}`);
}

function writeTmuxProbeShim(root: string, mode: 'missing' | 'unknown'): string {
  const shimDir = path.join(root, `tmux-shim-${mode}`);
  const shimPath = path.join(shimDir, 'tmux');
  fs.mkdirSync(shimDir, { recursive: true });
  fs.writeFileSync(
    shimPath,
    `#!/usr/bin/env bash
if [ "\${1:-}" = "has-session" ]; then
  if [ "${mode}" = "missing" ]; then
    printf '%s\n' "can't find session: synthetic-test" >&2
    exit 1
  fi
  printf '%s\n' "synthetic transient tmux client failure" >&2
  exit 75
fi
exec "\${REAL_TMUX}" "\$@"
`,
    'utf8',
  );
  fs.chmodSync(shimPath, 0o755);
  return shimDir;
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

  test('persists the final Codex transcript message when stored stdout is truncated', async () => {
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
    const daemon = Bun.spawn(
      [
        process.execPath,
        daemonEntry,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--data-dir',
        dataDir,
        '--token',
        token,
      ],
      {
        cwd: process.cwd(),
        stdout: 'ignore',
        stderr: 'pipe',
      },
    );
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
  }, 20_000);

  test('persists the final Blip transcript message when stored stdout is truncated', async () => {
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
    const daemon = Bun.spawn(
      [
        process.execPath,
        daemonEntry,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--data-dir',
        dataDir,
        '--token',
        token,
      ],
      {
        cwd: process.cwd(),
        stdout: 'ignore',
        stderr: 'pipe',
      },
    );
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
  }, 20_000);

  test('records Blip terminal-to-wrapper lag when the command keeps running after session_finished', async () => {
    const port = await allocatePort();
    const dataDir = path.join(tempRoot, `daemon-${port}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const scriptPath = path.join(tempRoot, `blip-terminal-lag-${port}.js`);
    fs.writeFileSync(
      scriptPath,
      `
function emit(event) {
  console.log(JSON.stringify(event));
}

(async () => {
  emit({ type: 'session_started', sessionId: 'blip-session-lag', timestamp: new Date().toISOString() });
  emit({ type: 'assistant_message', sessionId: 'blip-session-lag', timestamp: new Date().toISOString(), text: 'Done.' });
  emit({
    type: 'session_finished',
    sessionId: 'blip-session-lag',
    timestamp: new Date().toISOString(),
    status: 'completed',
    durationMs: 50,
  });
  await new Promise((resolve) => setTimeout(resolve, 1600));
})();
`,
      'utf8',
    );

    const token = 'daemon-token';
    const daemon = Bun.spawn(
      [
        process.execPath,
        daemonEntry,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--data-dir',
        dataDir,
        '--token',
        token,
      ],
      {
        cwd: process.cwd(),
        stdout: 'ignore',
        stderr: 'pipe',
      },
    );
    processes.push(daemon);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, token, daemon);

    const id = `blip-terminal-lag-${port}`;
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
    expect(job.transcript).toMatchObject({
      kind: 'blip',
      sessionId: 'blip-session-lag',
      message: 'Done.',
      terminalEvent: 'session_finished',
      terminalStatus: 'completed',
      durationMs: 50,
      eventCounts: {
        session_started: 1,
        assistant_message: 1,
        session_finished: 1,
      },
    });
    expect(typeof job.transcript.terminalEventAt).toBe('string');
    expect(job.diagnostics).toMatchObject({
      transcriptTerminalEventAt: job.transcript.terminalEventAt,
      transcriptParsedAt: job.transcript.parsedAt,
    });
    expect(job.diagnostics.transcriptTerminalEventLagMs).toBeGreaterThanOrEqual(900);
    expect(job.diagnostics.wrapperExitAfterTranscriptTerminalMs).toBeGreaterThanOrEqual(500);
    expect(job.diagnostics.wrapperRuntimeMs).toBeGreaterThanOrEqual(500);
  }, 20_000);

  for (const mode of ['unknown', 'missing'] as const) {
    test(`keeps a live prompt running through a synthetic tmux ${mode} probe`, async () => {
      const port = await allocatePort();
      const dataDir = path.join(tempRoot, `daemon-${mode}-${port}`);
      fs.mkdirSync(dataDir, { recursive: true });
      const scriptPath = path.join(tempRoot, `tmux-${mode}-${port}.js`);
      fs.writeFileSync(
        scriptPath,
        `
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-${mode}' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  console.log(JSON.stringify({ type: 'item.completed', item: { id: 'message', type: 'agent_message', text: 'Recovered ${mode} probe.' } }));
  console.log(JSON.stringify({ type: 'turn.completed' }));
}, 2500);
`,
        'utf8',
      );

      const realTmux = String(cp.spawnSync('which', ['tmux'], { encoding: 'utf8' }).stdout).trim();
      const shimDir = writeTmuxProbeShim(tempRoot, mode);
      const token = 'daemon-token';
      const daemon = Bun.spawn(
        [
          process.execPath,
          daemonEntry,
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--data-dir',
          dataDir,
          '--token',
          token,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ''}`,
            REAL_TMUX: realTmux,
          },
          stdout: 'ignore',
          stderr: 'pipe',
        },
      );
      processes.push(daemon);
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForHealth(baseUrl, token, daemon);

      if (mode === 'unknown') {
        fs.writeFileSync(
          path.join(dataDir, 'state.json'),
          JSON.stringify({
            process: {
              session: 'synthetic-unknown-status',
              cmd: 'synthetic',
              args: [],
              logPath: '/tmp/synthetic.log',
              startedAt: new Date().toISOString(),
            },
          }),
          'utf8',
        );
        const statusResponse = await fetch(`${baseUrl}/v1/status`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const status: any = await statusResponse.json();
        expect(status.process.running).toBe(false);
      }

      const id = `tmux-${mode}-${port}`;
      const enqueue = await fetch(`${baseUrl}/v1/prompts/enqueue`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ id, kind: 'codex', cmd: process.execPath, args: [scriptPath] }),
      });
      expect(enqueue.status).toBe(202);

      const running = await waitForRunningPromptJob(
        baseUrl,
        token,
        id,
        (job) =>
          job?.sessionProbe?.status === mode &&
          typeof job?.heartbeatPath === 'string' &&
          fs.existsSync(job.heartbeatPath),
      );
      expect(running.sessionProbe.status).toBe(mode);
      expect(fs.existsSync(running.heartbeatPath)).toBe(true);

      const job = await waitForPromptJob(baseUrl, token, id);
      expect(job.state).toBe('done');
      expect(job.exitCode).toBe(0);
      expect(job.transcript).toMatchObject({
        kind: 'codex',
        message: `Recovered ${mode} probe.`,
        terminalEvent: 'turn.completed',
      });
      expect(JSON.parse(fs.readFileSync(job.wrapperStatePath, 'utf8'))).toMatchObject({
        phase: 'finished',
        exitCode: 0,
      });
    }, 20_000);
  }

  test('repairs a provisional missing-exit failure when completion artifacts arrive later', async () => {
    const port = await allocatePort();
    const dataDir = path.join(tempRoot, `daemon-late-recovery-${port}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const scriptPath = path.join(tempRoot, `late-recovery-${port}.js`);
    fs.writeFileSync(
      scriptPath,
      `
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-late' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  console.log(JSON.stringify({ type: 'item.completed', item: { id: 'message', type: 'agent_message', text: 'Late completion recovered.' } }));
  console.log(JSON.stringify({ type: 'turn.completed' }));
}, 1800);
`,
      'utf8',
    );

    const token = 'daemon-token';
    const daemon = Bun.spawn(
      [
        process.execPath,
        daemonEntry,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--data-dir',
        dataDir,
        '--token',
        token,
      ],
      { cwd: process.cwd(), stdout: 'ignore', stderr: 'pipe' },
    );
    processes.push(daemon);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, token, daemon);

    const id = `late-recovery-${port}`;
    await fetch(`${baseUrl}/v1/prompts/enqueue`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id, kind: 'codex', cmd: process.execPath, args: [scriptPath] }),
    });
    const running = await waitForRunningPromptJob(baseUrl, token, id, () => true);
    const jobPath = path.join(dataDir, 'prompts', 'jobs', `${id}.json`);
    fs.writeFileSync(
      jobPath,
      JSON.stringify(
        {
          ...running,
          state: 'failed',
          finishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          exitStatusSource: 'missing-exit-file',
          failureReason: 'prompt wrapper ended without writing an exit code',
          error: 'Codex turn started but exited before producing a response.',
        },
        null,
        2,
      ),
      'utf8',
    );

    const recovered = await waitForRecoveredPromptJob(baseUrl, token, id);
    expect(recovered.state).toBe('done');
    expect(recovered.exitStatusSource).toBe('exit-file');
    expect(recovered.transcript).toMatchObject({
      message: 'Late completion recovered.',
      terminalEvent: 'turn.completed',
    });
    expect(recovered.error).toBeUndefined();
    expect(recovered.failureReason).toBeUndefined();
  }, 20_000);

  test('preserves every prompt when enqueue requests mutate the queue concurrently', async () => {
    const port = await allocatePort();
    const dataDir = path.join(tempRoot, `daemon-concurrent-enqueue-${port}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const token = 'daemon-token';
    const daemon = Bun.spawn(
      [
        process.execPath,
        daemonEntry,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--data-dir',
        dataDir,
        '--token',
        token,
      ],
      { cwd: process.cwd(), stdout: 'ignore', stderr: 'pipe' },
    );
    processes.push(daemon);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, token, daemon);

    const ids = Array.from({ length: 12 }, (_, index) => `concurrent-${port}-${index}`);
    const responses = await Promise.all(
      ids.map((id) =>
        fetch(`${baseUrl}/v1/prompts/enqueue`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            id,
            kind: 'shell',
            cmd: process.execPath,
            args: ['-e', 'setTimeout(() => {}, 30000)'],
          }),
        }),
      ),
    );
    expect(responses.every((response) => response.status === 202)).toBe(true);

    const queue = JSON.parse(fs.readFileSync(path.join(dataDir, 'prompts', 'queue.json'), 'utf8'));
    expect(new Set(queue.order)).toEqual(new Set(ids));
    for (const id of ids) {
      expect(fs.existsSync(path.join(dataDir, 'prompts', 'jobs', `${id}.json`))).toBe(true);
    }

    const cancellations = await Promise.all(
      ids.map((id) =>
        fetch(`${baseUrl}/v1/prompts/${encodeURIComponent(id)}/cancel`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    );
    expect(cancellations.every((response) => response.status === 200)).toBe(true);
  }, 20_000);

  test('accepts a successful terminal transcript when the wrapper does not exit promptly', async () => {
    const port = await allocatePort();
    const dataDir = path.join(tempRoot, `daemon-terminal-authority-${port}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const scriptPath = path.join(tempRoot, `terminal-authority-${port}.js`);
    fs.writeFileSync(
      scriptPath,
      `
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-terminal-authority' }));
console.log(JSON.stringify({ type: 'turn.started' }));
console.log(JSON.stringify({ type: 'item.completed', item: { id: 'message', type: 'agent_message', text: 'Terminal event is authoritative.' } }));
console.log(JSON.stringify({ type: 'error', message: 'transient event before completion' }));
console.log('{"type": "turn.completed"}');
setTimeout(() => {}, 30000);
`,
      'utf8',
    );

    const token = 'daemon-token';
    const daemon = Bun.spawn(
      [
        process.execPath,
        daemonEntry,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--data-dir',
        dataDir,
        '--token',
        token,
      ],
      { cwd: process.cwd(), stdout: 'ignore', stderr: 'pipe' },
    );
    processes.push(daemon);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, token, daemon);

    const id = `terminal-authority-${port}`;
    await fetch(`${baseUrl}/v1/prompts/enqueue`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id, kind: 'codex', cmd: process.execPath, args: [scriptPath] }),
    });

    const completed = await waitForPromptJob(baseUrl, token, id);
    expect(completed.exitCode).toBeUndefined();
    expect(completed.exitStatusSource).toBe('transcript-terminal');
    expect(completed.transcript).toMatchObject({
      message: 'Terminal event is authoritative.',
      terminalEvent: 'turn.completed',
    });
    expect(cp.spawnSync('tmux', ['has-session', '-t', completed.session]).status).not.toBe(0);

    const wrapperState = JSON.parse(fs.readFileSync(completed.wrapperStatePath, 'utf8'));
    const pgidResult = cp.spawnSync('ps', ['-o', 'pgid=', '-p', String(wrapperState.pid)], {
      encoding: 'utf8',
    });
    const processGroupId = Number(String(pgidResult.stdout ?? '').trim());
    if (Number.isFinite(processGroupId) && processGroupId > 1) {
      process.kill(-processGroupId, 'SIGKILL');
    }
  }, 20_000);

  test('still fails a genuinely terminated wrapper with captured exit evidence', async () => {
    const port = await allocatePort();
    const dataDir = path.join(tempRoot, `daemon-killed-wrapper-${port}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const token = 'daemon-token';
    const daemon = Bun.spawn(
      [
        process.execPath,
        daemonEntry,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--data-dir',
        dataDir,
        '--token',
        token,
      ],
      { cwd: process.cwd(), stdout: 'ignore', stderr: 'pipe' },
    );
    processes.push(daemon);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, token, daemon);

    const id = `killed-wrapper-${port}`;
    await fetch(`${baseUrl}/v1/prompts/enqueue`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id,
        kind: 'codex',
        cmd: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 30000)'],
      }),
    });
    const running = await waitForRunningPromptJob(
      baseUrl,
      token,
      id,
      (job) => typeof job?.wrapperStatePath === 'string' && fs.existsSync(job.wrapperStatePath),
    );
    const wrapperState = JSON.parse(fs.readFileSync(running.wrapperStatePath, 'utf8'));
    const wrapperPid = Number(wrapperState.pid);
    const pgidResult = cp.spawnSync('ps', ['-o', 'pgid=', '-p', String(wrapperPid)], {
      encoding: 'utf8',
    });
    const processGroupId = Number(String(pgidResult.stdout ?? '').trim());
    expect(Number.isFinite(processGroupId) && processGroupId > 1).toBe(true);
    process.kill(-processGroupId, 'SIGKILL');

    const terminal = await waitForTerminalPromptJob(baseUrl, token, id, 20_000);
    expect(terminal.state).toBe('failed');
    expect(terminal.exitStatusSource).toBe('missing-exit-file');
    expect(terminal.failureReason).toContain('without writing an exit code');
    const heartbeatAt = String(fs.readFileSync(terminal.heartbeatPath, 'utf8')).trim();
    expect(Math.abs(Date.parse(terminal.finishedAt) - Date.parse(heartbeatAt))).toBeLessThan(1_000);
  }, 25_000);

  test('keeps Codex App Server approvals pending until the Hub resolves them', async () => {
    const port = await allocatePort();
    const dataDir = path.join(tempRoot, `daemon-codex-approval-${port}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const messagesPath = path.join(tempRoot, `codex-approval-messages-${port}.jsonl`);
    const fakeServerPath = path.join(tempRoot, `fake-codex-approval-server-${port}.js`);
    fs.writeFileSync(
      fakeServerPath,
      `
const fs = require('node:fs');
const readline = require('node:readline');
const messagesPath = process.argv[2];
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
const record = (message) => fs.appendFileSync(messagesPath, JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  const message = JSON.parse(line);
  record(message);
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake-codex-approval' } });
    return;
  }
  if (message.method === 'initialized') return;
  if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'thread-approval', turns: [] } } });
    send({ method: 'thread/started', params: { thread: { id: 'thread-approval' } } });
    return;
  }
  if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-approval', status: 'inProgress', items: [] } } });
    send({ method: 'turn/started', params: { threadId: 'thread-approval', turn: { id: 'turn-approval', status: 'inProgress', items: [] } } });
    send({ method: 'item/started', params: { threadId: 'thread-approval', turnId: 'turn-approval', item: { id: 'command-approval', type: 'commandExecution', command: 'bun test', cwd: '/workspace', status: 'inProgress' } } });
    send({ id: 'approval-request-1', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-approval', turnId: 'turn-approval', itemId: 'command-approval', command: 'bun test', cwd: '/workspace', reason: 'Run the focused tests' } });
    return;
  }
  if (message.id === 'approval-request-1') {
    send({ method: 'item/completed', params: { threadId: 'thread-approval', turnId: 'turn-approval', item: { id: 'command-approval', type: 'commandExecution', command: 'bun test', cwd: '/workspace', status: 'completed', exitCode: 0, aggregatedOutput: 'pass' } } });
    send({ method: 'item/completed', params: { threadId: 'thread-approval', turnId: 'turn-approval', item: { id: 'answer-approval', type: 'agentMessage', text: 'Approved and completed.' } } });
    send({ method: 'turn/completed', params: { threadId: 'thread-approval', turn: { id: 'turn-approval', status: 'completed', items: [] } } });
  }
});
`,
      'utf8',
    );

    const token = 'daemon-token';
    const daemon = Bun.spawn(
      [
        process.execPath,
        daemonEntry,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--data-dir',
        dataDir,
        '--token',
        token,
      ],
      { cwd: process.cwd(), stdout: 'ignore', stderr: 'pipe' },
    );
    processes.push(daemon);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, token, daemon);

    const id = `codex-approval-${port}`;
    const enqueueResponse = await fetch(`${baseUrl}/v1/codex/enqueue`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id,
        sessionKey: `approval-session-${port}`,
        launchScript: `exec ${process.execPath} ${fakeServerPath} ${messagesPath}`,
        prompt: 'Run the tests.',
        approvalPolicy: 'untrusted',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
      }),
    });
    expect(enqueueResponse.status).toBe(202);

    const pending = await waitForRunningPromptJob(
      baseUrl,
      token,
      id,
      (job) => job?.codexAppServer?.run?.pendingApprovals?.length === 1,
    );
    const approval = pending.codexAppServer.run.pendingApprovals[0];
    expect(approval).toMatchObject({
      promptId: id,
      method: 'item/commandExecution/requestApproval',
      kind: 'command_execution',
      command: 'bun test',
      cwd: '/workspace',
      reason: 'Run the focused tests',
      status: 'pending',
    });
    expect(
      await readPromptEventJob(
        baseUrl,
        token,
        id,
        (job) => job?.state === 'running' && job?.pendingApprovalCount === 1,
      ),
    ).toMatchObject({ id, state: 'running', pendingApprovalCount: 1 });

    const approvalResponse = await fetch(
      `${baseUrl}/v1/prompts/${encodeURIComponent(id)}/approvals/${encodeURIComponent(approval.id)}/acceptForSession`,
      { method: 'POST', headers: { authorization: `Bearer ${token}` } },
    );
    expect(approvalResponse.status).toBe(200);
    expect(await approvalResponse.json()).toMatchObject({
      ok: true,
      decision: 'acceptForSession',
      job: { codexAppServer: { run: { pendingApprovals: [] } } },
    });

    const completed = await waitForPromptJob(baseUrl, token, id);
    expect(completed.transcript).toMatchObject({ message: 'Approved and completed.' });
    const messages = fs
      .readFileSync(messagesPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(messages).toContainEqual({
      id: 'approval-request-1',
      result: { decision: 'acceptForSession' },
    });
  }, 25_000);

  test('completes a run when an implicit continuation uses a different turn id', async () => {
    const port = await allocatePort();
    const dataDir = path.join(tempRoot, `daemon-codex-implicit-turn-${port}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const fakeServerPath = path.join(tempRoot, `fake-codex-implicit-turn-${port}.js`);
    fs.writeFileSync(
      fakeServerPath,
      `
const readline = require('node:readline');
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake-codex-implicit-turn' } });
    return;
  }
  if (message.method === 'initialized') return;
  if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'thread-implicit', turns: [] } } });
    return;
  }
  if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'allocated-turn', status: 'inProgress', items: [] } } });
    send({ method: 'item/started', params: { threadId: 'thread-implicit', turnId: 'implicit-turn', item: { id: 'answer-implicit', type: 'agentMessage', text: '' } } });
    send({ method: 'item/completed', params: { threadId: 'thread-implicit', turnId: 'implicit-turn', item: { id: 'answer-implicit', type: 'agentMessage', text: 'Implicit continuation completed.' } } });
    send({ method: 'turn/completed', params: { threadId: 'thread-implicit', turn: { id: 'implicit-turn', status: 'completed', items: [] } } });
  }
});
`,
      'utf8',
    );

    const token = 'daemon-token';
    const daemon = Bun.spawn(
      [
        process.execPath,
        daemonEntry,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--data-dir',
        dataDir,
        '--token',
        token,
      ],
      { cwd: process.cwd(), stdout: 'ignore', stderr: 'pipe' },
    );
    processes.push(daemon);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, token, daemon);

    const id = `codex-implicit-turn-${port}`;
    const enqueueResponse = await fetch(`${baseUrl}/v1/codex/enqueue`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id,
        sessionKey: `implicit-turn-session-${port}`,
        launchScript: `exec ${process.execPath} ${fakeServerPath}`,
        prompt: 'Join the implicit continuation.',
      }),
    });
    expect(enqueueResponse.status).toBe(202);

    const completed = await waitForPromptJob(baseUrl, token, id);
    expect(completed).toMatchObject({
      state: 'done',
      codexAppServer: {
        turnId: 'implicit-turn',
        run: { state: 'done', turnId: 'implicit-turn' },
      },
      transcript: {
        message: 'Implicit continuation completed.',
        terminalEvent: 'turn.completed',
      },
    });

    const runPath = path.join(dataDir, 'prompts', 'runs', `${id}.json`);
    const messagePath = path.join(dataDir, 'prompts', 'jobs', `${id}.json`);
    for (const targetPath of [runPath, messagePath]) {
      const persisted = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      persisted.state = 'running';
      delete persisted.finishedAt;
      delete persisted.exitCode;
      fs.writeFileSync(targetPath, JSON.stringify(persisted, null, 2));
    }

    const recovered = await waitForPromptJob(baseUrl, token, id);
    expect(recovered).toMatchObject({
      state: 'done',
      codexAppServer: { run: { state: 'done' } },
      transcript: { terminalEvent: 'turn.completed' },
    });
  }, 25_000);

  test('keeps the root Codex thread active across subagent lifecycle notifications', async () => {
    const port = await allocatePort();
    const dataDir = path.join(tempRoot, `daemon-codex-subagent-thread-${port}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const requestsPath = path.join(tempRoot, `codex-subagent-thread-requests-${port}.jsonl`);
    const fakeServerPath = path.join(tempRoot, `fake-codex-subagent-thread-${port}.js`);
    fs.writeFileSync(
      fakeServerPath,
      `
const fs = require('node:fs');
const readline = require('node:readline');
const requestsPath = process.argv[2];
let turnSequence = 0;
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
const record = (message) => fs.appendFileSync(requestsPath, JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  const message = JSON.parse(line);
  record(message);
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake-codex-subagent-thread' } });
    return;
  }
  if (message.method === 'initialized') return;
  if (message.method === 'thread/resume') {
    const threadId = message.params?.threadId;
    // Real App Server versions can omit parentThreadId here even for a child.
    send({ id: message.id, result: { thread: { id: threadId, turns: [] } } });
    return;
  }
  if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'root-thread', turns: [] } } });
    send({ method: 'thread/started', params: { thread: { id: 'root-thread', parentThreadId: null } } });
    return;
  }
  if (message.method === 'turn/start') {
    if (message.params?.threadId !== 'root-thread') {
      send({ id: message.id, error: { code: -32000, message: 'direct app-server input is not allowed for multi-agent v2 sub-agents' } });
      return;
    }
    const sequence = ++turnSequence;
    const rootTurnId = 'root-turn-' + sequence;
    send({ id: message.id, result: { turn: { id: rootTurnId, status: 'inProgress', items: [] } } });
    send({ method: 'turn/started', params: { threadId: 'root-thread', turn: { id: rootTurnId, status: 'inProgress', items: [] } } });
    if (sequence === 1) {
      send({ method: 'thread/started', params: { thread: { id: 'child-thread', parentThreadId: 'root-thread' } } });
      send({ method: 'turn/started', params: { threadId: 'child-thread', turn: { id: 'child-turn', status: 'inProgress', items: [] } } });
      send({ method: 'turn/completed', params: { threadId: 'child-thread', turn: { id: 'child-turn', status: 'completed', items: [] } } });
    }
    setTimeout(() => {
      send({ method: 'item/completed', params: { threadId: 'root-thread', turnId: rootTurnId, item: { id: 'root-answer-' + sequence, type: 'agentMessage', text: 'Root answer ' + sequence + '.' } } });
      send({ method: 'turn/completed', params: { threadId: 'root-thread', turn: { id: rootTurnId, status: 'completed', items: [] } } });
    }, sequence === 1 ? 500 : 10);
  }
});
`,
      'utf8',
    );

    const token = 'daemon-token';
    const daemon = Bun.spawn(
      [
        process.execPath,
        daemonEntry,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--data-dir',
        dataDir,
        '--token',
        token,
      ],
      { cwd: process.cwd(), stdout: 'ignore', stderr: 'pipe' },
    );
    processes.push(daemon);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, token, daemon);

    const sessionKey = `subagent-thread-session-${port}`;
    const enqueue = async (
      id: string,
      prompt: string,
      existingThreadId?: string,
      targetSessionKey = sessionKey,
    ) => {
      const response = await fetch(`${baseUrl}/v1/codex/enqueue`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id,
          sessionKey: targetSessionKey,
          launchScript: `exec ${process.execPath} ${fakeServerPath} ${requestsPath}`,
          prompt,
          ...(existingThreadId ? { existingThreadId } : {}),
        }),
      });
      expect(response.status).toBe(202);
    };

    const firstId = `codex-subagent-thread-first-${port}`;
    await enqueue(firstId, 'Delegate part of this task.');
    const first = await waitForPromptJob(baseUrl, token, firstId);
    expect(first).toMatchObject({
      codexAppServer: {
        threadId: 'root-thread',
        run: { state: 'done', threadId: 'root-thread', turnId: 'root-turn-1' },
      },
      transcript: {
        threadId: 'root-thread',
        message: 'Root answer 1.',
        terminalEvent: 'turn.completed',
      },
    });

    const secondId = `codex-subagent-thread-second-${port}`;
    await enqueue(secondId, 'Continue in the same Hub chat.', first.codexAppServer.threadId);
    const second = await waitForPromptJob(baseUrl, token, secondId);
    expect(second).toMatchObject({
      codexAppServer: {
        threadId: 'root-thread',
        run: { state: 'done', threadId: 'root-thread', turnId: 'root-turn-2' },
      },
      transcript: {
        threadId: 'root-thread',
        message: 'Root answer 2.',
        terminalEvent: 'turn.completed',
      },
    });

    const recoveredId = `codex-subagent-thread-recovered-${port}`;
    await enqueue(
      recoveredId,
      'Recover this existing Hub chat.',
      'child-thread',
      `${sessionKey}-recovery`,
    );
    const recovered = await waitForPromptJob(baseUrl, token, recoveredId);
    expect(recovered).toMatchObject({
      codexAppServer: {
        threadId: 'root-thread',
        run: { state: 'done', threadId: 'root-thread', turnId: 'root-turn-1' },
      },
      transcript: {
        threadId: 'root-thread',
        message: 'Root answer 1.',
        terminalEvent: 'turn.completed',
      },
    });

    const requests = fs
      .readFileSync(requestsPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(
      requests
        .filter((message) => message.method === 'turn/start')
        .map((message) => message.params?.threadId),
    ).toEqual(['root-thread', 'root-thread', 'child-thread', 'root-thread']);
    expect(requests).toContainEqual({
      id: expect.any(Number),
      method: 'thread/resume',
      params: expect.objectContaining({ threadId: 'child-thread' }),
    });
  }, 25_000);

  test('delivers every Codex ASAP prompt through same-turn App Server steering', async () => {
    const port = await allocatePort();
    const dataDir = path.join(tempRoot, `daemon-codex-steering-${port}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const requestsPath = path.join(tempRoot, `codex-steering-requests-${port}.jsonl`);
    const fakeServerPath = path.join(tempRoot, `fake-codex-app-server-${port}.js`);
    fs.writeFileSync(
      fakeServerPath,
      `
const fs = require('node:fs');
const readline = require('node:readline');
const requestsPath = process.argv[2];
let completionTimer = null;
let turnSequence = 0;
let activeTurnId = '';
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
const record = (message) => fs.appendFileSync(requestsPath, JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  const message = JSON.parse(line);
  record(message);
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake-codex' } });
    return;
  }
  if (message.method === 'initialized') return;
  if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'thread-steering', turns: [] } } });
    send({ method: 'thread/started', params: { thread: { id: 'thread-steering' } } });
    return;
  }
  if (message.method === 'turn/start') {
    activeTurnId = 'turn-steering-' + (++turnSequence);
    const startTurn = () => {
      send({ id: message.id, result: { turn: { id: activeTurnId, status: 'inProgress', items: [] } } });
      send({ method: 'turn/started', params: { threadId: 'thread-steering', turn: { id: activeTurnId, status: 'inProgress', items: [] } } });
      completionTimer = setTimeout(() => {
        send({ method: 'item/completed', params: { threadId: 'thread-steering', turnId: activeTurnId, completedAtMs: Date.now(), item: { id: 'answer-' + turnSequence, type: 'agentMessage', text: 'Combined steered answer.' } } });
        send({ method: 'turn/completed', params: { threadId: 'thread-steering', turn: { id: activeTurnId, status: 'completed', items: [] } } });
      }, 1500);
    };
    const prompt = String(message.params?.input?.[0]?.text ?? '');
    if (prompt.includes('Delayed start')) setTimeout(startTurn, 500);
    else startTurn();
    return;
  }
  if (message.method === 'turn/steer') {
    const prompt = String(message.params?.input?.[0]?.text ?? '');
    if (prompt.includes('Reject steering')) {
      send({ id: message.id, error: { code: -32000, message: 'turn is no longer active' } });
      return;
    }
    send({ id: message.id, result: { turnId: activeTurnId } });
    return;
  }
  if (message.method === 'turn/interrupt') {
    if (completionTimer) clearTimeout(completionTimer);
    send({ id: message.id, result: {} });
    send({ method: 'turn/completed', params: { threadId: 'thread-steering', turn: { id: activeTurnId, status: 'interrupted', items: [] } } });
  }
});
`,
      'utf8',
    );

    const token = 'daemon-token';
    const daemon = Bun.spawn(
      [
        process.execPath,
        daemonEntry,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--data-dir',
        dataDir,
        '--token',
        token,
      ],
      { cwd: process.cwd(), stdout: 'ignore', stderr: 'pipe' },
    );
    processes.push(daemon);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, token, daemon);
    const enqueue = async (id: string, prompt: string, deliveryMode: 'queue' | 'asap') => {
      const response = await fetch(`${baseUrl}/v1/codex/enqueue`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id,
          sessionKey: 'chat-hey',
          launchScript: `exec ${process.execPath} ${fakeServerPath} ${requestsPath}`,
          prompt,
          deliveryMode,
          approvalPolicy: 'never',
          sandbox: 'workspace-write',
        }),
      });
      expect(response.status).toBe(202);
      return await response.json();
    };

    const rootId = `codex-root-${port}`;
    const steerOneId = `codex-steer-one-${port}`;
    const steerTwoId = `codex-steer-two-${port}`;
    expect((await enqueue(rootId, 'Initial request', 'queue')).disposition).toBe('started');
    const steerOneResult = await enqueue(steerOneId, 'First ASAP correction', 'asap');
    expect(steerOneResult).toMatchObject({
      disposition: 'steered',
      steering: {
        outcome: 'accepted',
        activeRunId: rootId,
        activeTurnId: 'turn-steering-1',
        threadId: 'thread-steering',
      },
    });
    const steerTwoResult = await enqueue(steerTwoId, 'Second ASAP correction', 'asap');
    expect(steerTwoResult).toMatchObject({
      disposition: 'steered',
      steering: {
        outcome: 'accepted',
        activeRunId: rootId,
        activeTurnId: 'turn-steering-1',
        threadId: 'thread-steering',
      },
    });

    const rejectedSteerId = `codex-steer-rejected-${port}`;
    const rejectedSteerResult = await enqueue(rejectedSteerId, 'Reject steering', 'asap');
    expect(rejectedSteerResult).toMatchObject({
      disposition: 'queued',
      steering: {
        outcome: 'rejected',
        reason: 'turn-steer-rejected',
        activeRunId: rootId,
        activeTurnId: 'turn-steering-1',
        threadId: 'thread-steering',
        error: 'turn is no longer active',
      },
    });
    const rejectedCancelResponse = await fetch(
      `${baseUrl}/v1/prompts/${encodeURIComponent(rejectedSteerId)}/cancel`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      },
    );
    expect(rejectedCancelResponse.status).toBe(200);

    const [liveRoot, liveSteerOne, liveSteerTwo] = await Promise.all([
      waitForRunningPromptJob(
        baseUrl,
        token,
        rootId,
        (job) => job?.codexAppServer?.run?.responseMessageId === steerTwoId,
      ),
      waitForRunningPromptJob(
        baseUrl,
        token,
        steerOneId,
        (job) => job?.codexAppServer?.run?.responseMessageId === steerTwoId,
      ),
      waitForRunningPromptJob(
        baseUrl,
        token,
        steerTwoId,
        (job) => job?.codexAppServer?.run?.responseMessageId === steerTwoId,
      ),
    ]);
    expect(liveRoot.codexAppServer.run).toMatchObject({
      id: rootId,
      messageIds: [rootId, steerOneId, steerTwoId],
      responseMessageId: steerTwoId,
    });
    expect(liveSteerOne.codexAppServer.run.id).toBe(rootId);
    expect(liveSteerTwo.codexAppServer.run.id).toBe(rootId);
    expect(liveRoot.stdoutPath).toBe(liveSteerOne.stdoutPath);
    expect(liveRoot.stdoutPath).toBe(liveSteerTwo.stdoutPath);
    expect(liveRoot.codexAppServer.outputOwner).toBe(false);
    expect(liveSteerOne.codexAppServer.outputOwner).toBe(false);
    expect(liveSteerTwo.codexAppServer.outputOwner).toBe(true);

    const [root, steerOne, steerTwo] = await Promise.all([
      waitForPromptJob(baseUrl, token, rootId),
      waitForPromptJob(baseUrl, token, steerOneId),
      waitForPromptJob(baseUrl, token, steerTwoId),
    ]);
    expect(root.codexAppServer.run.responseMessageId).toBe(steerTwoId);
    expect(steerOne.codexAppServer.run.id).toBe(root.codexAppServer.run.id);
    expect(steerTwo.codexAppServer.run.id).toBe(root.codexAppServer.run.id);
    expect(root.stdoutPath).toBe(steerOne.stdoutPath);
    expect(root.stdoutPath).toBe(steerTwo.stdoutPath);
    expect(steerTwo.transcript).toMatchObject({
      threadId: 'thread-steering',
      message: 'Combined steered answer.',
      terminalEvent: 'turn.completed',
    });
    const persistedRun = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'prompts', 'runs', `${rootId}.json`), 'utf8'),
    );
    expect(persistedRun).toMatchObject({
      id: rootId,
      state: 'done',
      messageIds: [rootId, steerOneId, steerTwoId],
      responseMessageId: steerTwoId,
    });
    for (const messageId of [rootId, steerOneId, steerTwoId]) {
      const persistedMessage = JSON.parse(
        fs.readFileSync(path.join(dataDir, 'prompts', 'jobs', `${messageId}.json`), 'utf8'),
      );
      expect(persistedMessage.codexAppServer.runId).toBe(rootId);
      expect(persistedMessage.codexAppServer).not.toHaveProperty('outputOwner');
    }
    const persistedSteerTwo = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'prompts', 'jobs', `${steerTwoId}.json`), 'utf8'),
    );
    expect(persistedSteerTwo.diagnostics.codexEnqueue).toMatchObject({
      requestedDeliveryMode: 'asap',
      disposition: 'steered',
      steering: { outcome: 'accepted', activeRunId: rootId },
    });
    const persistedRejectedSteer = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'prompts', 'jobs', `${rejectedSteerId}.json`), 'utf8'),
    );
    expect(persistedRejectedSteer.diagnostics.codexEnqueue).toMatchObject({
      requestedDeliveryMode: 'asap',
      disposition: 'queued',
      steering: {
        outcome: 'rejected',
        reason: 'turn-steer-rejected',
        error: 'turn is no longer active',
      },
    });

    const rootMessagePath = path.join(dataDir, 'prompts', 'jobs', `${rootId}.json`);
    const partiallyPersistedRoot = JSON.parse(fs.readFileSync(rootMessagePath, 'utf8'));
    partiallyPersistedRoot.state = 'running';
    delete partiallyPersistedRoot.finishedAt;
    delete partiallyPersistedRoot.exitCode;
    fs.writeFileSync(rootMessagePath, JSON.stringify(partiallyPersistedRoot, null, 2));
    const repairedRoot = await waitForPromptJob(baseUrl, token, rootId);
    expect(repairedRoot.state).toBe('done');
    expect(JSON.parse(fs.readFileSync(rootMessagePath, 'utf8')).state).toBe('done');

    const requests = fs
      .readFileSync(requestsPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(requests.filter((request) => request.method === 'turn/start')).toHaveLength(1);
    expect(requests.find((request) => request.method === 'turn/start')?.params).toMatchObject({
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'workspaceWrite' },
    });
    const steering = requests.filter((request) => request.method === 'turn/steer');
    expect(steering).toHaveLength(3);
    expect(steering.map((request) => request.params.clientUserMessageId)).toEqual([
      steerOneId,
      steerTwoId,
      rejectedSteerId,
    ]);
    expect(steering.every((request) => request.params.expectedTurnId === 'turn-steering-1')).toBe(
      true,
    );

    const canceledActiveId = `codex-cancel-active-${port}`;
    const afterCanceledId = `codex-after-cancel-${port}`;
    expect(await enqueue(canceledActiveId, 'Cancel this active turn', 'asap')).toMatchObject({
      disposition: 'started',
      steering: { outcome: 'unavailable', reason: 'no-active-run' },
    });
    expect((await enqueue(afterCanceledId, 'Run after cancellation', 'queue')).disposition).toBe(
      'queued',
    );
    const activeCancelResponse = await fetch(
      `${baseUrl}/v1/prompts/${encodeURIComponent(canceledActiveId)}/cancel`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      },
    );
    expect(activeCancelResponse.status).toBe(200);
    expect((await activeCancelResponse.json())?.job?.state).toBe('canceled');
    expect((await waitForTerminalPromptJob(baseUrl, token, canceledActiveId)).state).toBe(
      'canceled',
    );
    expect((await waitForTerminalPromptJob(baseUrl, token, afterCanceledId)).state).toBe('done');

    const requestsAfterCancel = fs
      .readFileSync(requestsPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const interruptedTurnIds = requestsAfterCancel
      .filter((request) => request.method === 'turn/interrupt')
      .map((request) => request.params.turnId);
    expect(interruptedTurnIds).toContain('turn-steering-2');
    expect(interruptedTurnIds).not.toContain('turn-steering-3');

    const delayedId = `codex-delayed-start-${port}`;
    const delayedEnqueue = enqueue(delayedId, 'Delayed start cancellation', 'queue');
    await waitForRunningPromptJob(baseUrl, token, delayedId, (job) => !job?.codexAppServer?.turnId);
    const cancelResponse = await fetch(
      `${baseUrl}/v1/prompts/${encodeURIComponent(delayedId)}/cancel`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      },
    );
    expect(cancelResponse.status).toBe(200);
    expect((await cancelResponse.json())?.job?.state).toBe('canceled');
    await delayedEnqueue;
    const canceled = await waitForTerminalPromptJob(baseUrl, token, delayedId);
    expect(canceled.state).toBe('canceled');
  }, 25_000);
});
