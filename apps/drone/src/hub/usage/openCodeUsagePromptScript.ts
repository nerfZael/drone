/** Self-contained Node script, executed next to the provider on host or container. */
export function openCodeUsagePromptScript(args: string[]): string {
  return `(${runOpenCodeWithUsage.toString()})(${JSON.stringify(args)}).catch(error => { console.error(error.message); process.exitCode = 1; });`;
}

async function runOpenCodeWithUsage(args: string[]): Promise<void> {
  const { spawn } = require('node:child_process') as typeof import('node:child_process');
  const { randomBytes } = require('node:crypto') as typeof import('node:crypto');
  const readline = require('node:readline') as typeof import('node:readline');
  const password = randomBytes(24).toString('hex');
  const env = { ...process.env, OPENCODE_SERVER_USERNAME: 'opencode', OPENCODE_SERVER_PASSWORD: password };
  args = args.map((arg) => arg === '__CHECKPOINT_SESSION__' ? process.argv[1] : arg);
  const startedAt = Date.now();
  const server = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let child: ReturnType<typeof spawn> | undefined;
  let sessionId = '';
  let stopping = false;
  let polling: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const cancellation = new AbortController();
  let forceStop: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopping = true; cancellation.abort();
    child?.kill('SIGTERM'); server.kill('SIGTERM');
    forceStop ??= setTimeout(() => { child?.kill('SIGKILL'); server.kill('SIGKILL'); }, 2000);
    forceStop.unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  let diagnostics = '';
  server.stderr?.on('data', (data: Buffer) => { diagnostics = (diagnostics + data).slice(-4000); });
  try {
    const baseUrl = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('OpenCode server startup timed out')), 30_000);
      let output = '';
      server.stdout!.on('data', (data: Buffer) => {
        output = (output + data).slice(-4000);
        const match = output.match(/opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
      server.once('error', (error) => { clearTimeout(timeout); reject(error); });
      server.once('exit', () => { clearTimeout(timeout); reject(new Error(`OpenCode server exited before startup: ${diagnostics.trim()}`)); });
    });
    const request = async (route: string, signal: AbortSignal): Promise<any> => {
      const response = await fetch(`${baseUrl}${route}?directory=${encodeURIComponent(process.cwd())}`, {
        headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
          'x-opencode-directory': encodeURIComponent(process.cwd()) }, signal,
      });
      if (!response.ok) throw new Error(`OpenCode usage read failed (${response.status})`);
      return response.json();
    };
    const collect = async () => {
      if (!sessionId || stopping) return;
      // One deadline covers the entire tree, including response bodies and descendants.
      const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(15_000)]);
      try {
        const queue = [sessionId];
        const visited = new Set<string>();
        const observations: any[] = [];
        while (queue.length) {
          const id = queue.shift()!;
          if (visited.has(id)) continue;
          visited.add(id);
          const route = `/session/${encodeURIComponent(id)}`;
          const messages = await request(`${route}/message`, signal);
          const children = await request(`${route}/children`, signal);
          for (const childSession of children) queue.push(childSession.id);
          for (const message of messages) {
            const info = message.info;
            if (info?.role !== 'assistant' || !(info.time?.created >= startedAt) || !info.tokens) continue;
            const tokens = info.tokens;
            observations.push({ id: info.id, sessionId: id, model: info.modelID ?? 'unknown', provider: info.providerID ?? 'unknown',
              input: tokens.input ?? null, output: typeof tokens.output === 'number' && typeof tokens.reasoning === 'number' ? tokens.output + tokens.reasoning : null,
              cacheRead: tokens.cache?.read ?? null, cacheWrite: tokens.cache?.write ?? null, reasoning: tokens.reasoning ?? null,
              scope: 'request', complete: Boolean(info.time?.completed) && !info.error,
              reportedCost: info.cost, raw: tokens,
              purpose: info.summary ? 'compaction' : id === sessionId ? 'chat' : 'subagent' });
          }
        }
        if (observations.length) process.stdout.write(JSON.stringify({ type: 'usage.snapshot', observations }) + '\n');
      } catch (error) {
        // Preserve CLI observations; never retry a successful prompt because metering failed.
        console.error('OpenCode usage incomplete:', error instanceof Error ? error.message : String(error));
      }
    };
    if (stopping) throw new Error('OpenCode prompt cancelled');
    child = spawn('opencode', [...args, '--attach', baseUrl], { env, stdio: ['ignore', 'pipe', 'inherit'] });
    const lines = readline.createInterface({ input: child.stdout! });
    lines.on('line', (line) => {
      process.stdout.write(line + '\n');
      try { const event = JSON.parse(line); if (!sessionId && event.sessionID) sessionId = event.sessionID; } catch { /* Non-JSON provider diagnostics. */ }
    });
    timer = setInterval(() => { if (!polling) polling = collect().finally(() => { polling = undefined; }); }, 5000);
    const code = await new Promise<number>((resolve, reject) => {
      child!.once('error', reject);
      child!.once('close', (code) => resolve(code ?? 1));
    });
    clearInterval(timer);
    await polling;
    await collect();
    lines.close();
    process.exitCode = stopping ? 130 : code;
  } finally {
    if (timer) clearInterval(timer);
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    child?.kill('SIGTERM'); server.kill('SIGTERM');
    const kill = setTimeout(() => { child?.kill('SIGKILL'); server.kill('SIGKILL'); }, 2000);
    kill.unref();
  }
}
