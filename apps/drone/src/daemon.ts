import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type DroneState = {
  process?: {
    session: string;
    cmd: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    logPath: string;
    startedAt: string;
  };
};

type PromptJobState = 'queued' | 'running' | 'done' | 'failed';

type PromptJob = {
  id: string;
  kind: string;
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  state: PromptJobState;
  session: string;
  stdoutPath: string;
  stderrPath: string;
  exitPath: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function bashQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readTextSafe(p: string, maxBytes = 2 * 1024 * 1024): Promise<string> {
  try {
    const buf = await fs.readFile(p);
    if (buf.length <= maxBytes) return buf.toString('utf8');
    return `${buf.subarray(0, maxBytes).toString('utf8')}\n\n…(truncated)…`;
  } catch {
    return '';
  }
}

async function readIntSafe(p: string): Promise<number | null> {
  try {
    const raw = (await fs.readFile(p, 'utf8')).trim();
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function fileSizeSafe(p: string): Promise<number> {
  try {
    const st = await fs.stat(p);
    return Number.isFinite(st.size) && st.size > 0 ? Math.floor(st.size) : 0;
  } catch {
    return 0;
  }
}

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

async function readJsonFile<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFileAtomic(p: string, obj: any): Promise<void> {
  const tmp = `${p}.${Math.random().toString(16).slice(2, 8)}.tmp`;
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, p);
}

type PromptIndex = { order: string[] };

async function loadPromptIndex(promptsDir: string): Promise<PromptIndex> {
  return await readJsonFile(path.join(promptsDir, 'queue.json'), { order: [] });
}

async function savePromptIndex(promptsDir: string, idx: PromptIndex): Promise<void> {
  await writeJsonFileAtomic(path.join(promptsDir, 'queue.json'), idx);
}

function promptSessionName(id: string): string {
  const cleaned = String(id).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 48);
  return `drone-prompt-${cleaned || 'job'}`;
}

async function loadPromptJob(promptsDir: string, id: string): Promise<PromptJob | null> {
  const p = path.join(promptsDir, 'jobs', `${id}.json`);
  const exists = await fileExists(p);
  if (!exists) return null;
  return await readJsonFile<PromptJob>(p, null as any);
}

async function savePromptJob(promptsDir: string, job: PromptJob): Promise<void> {
  const p = path.join(promptsDir, 'jobs', `${job.id}.json`);
  await writeJsonFileAtomic(p, job);
}

async function startPromptJob(job: PromptJob): Promise<void> {
  // Run inside tmux so work continues even if this daemon process restarts.
  const quotedCmd = bashQuote(job.cmd);
  const quotedArgs = (job.args ?? []).map((a) => bashQuote(a)).join(' ');
  const cd = job.cwd ? `cd ${bashQuote(job.cwd)}\n` : '';
  const envLines =
    job.env && Object.keys(job.env).length > 0
      ? Object.entries(job.env)
          .map(([k, v]) => `export ${String(k).replace(/[^A-Za-z0-9_]/g, '_')}=${bashQuote(String(v))}`)
          .join('\n') + '\n'
      : '';
  const script = [
    'set +e',
    cd.trimEnd(),
    envLines.trimEnd(),
    // Run and capture exit code.
    `${quotedCmd} ${quotedArgs} > ${bashQuote(job.stdoutPath)} 2> ${bashQuote(job.stderrPath)}`,
    'code=$?',
    `printf %s \"$code\" > ${bashQuote(job.exitPath)}`,
    'exit 0',
  ]
    .filter(Boolean)
    .join('\n');

  // Avoid passing long `bash -lc "<script>"` payloads to tmux; very large prompts
  // can exceed command length limits before the job even starts.
  const scriptPath = path.join(path.dirname(job.stdoutPath), `${job.id}.run.sh`);
  await fs.writeFile(scriptPath, `${script}\n`, { encoding: 'utf8', mode: 0o700 });
  await startSession({ session: job.session, cmd: 'bash', args: [scriptPath] });
}

async function finalizePromptJob(job: PromptJob): Promise<PromptJob> {
  // Some CLIs (notably Codex JSON mode) may continue appending output briefly
  // after the tmux session has exited. Wait for output/exit artifacts to settle.
  let exitCode = await readIntSafe(job.exitPath);
  let stdout = await readTextSafe(job.stdoutPath);
  let stderr = await readTextSafe(job.stderrPath);

  const startedLikeCodexTurn =
    /"type":"thread\.started"/.test(stdout) &&
    /"type":"turn\.started"/.test(stdout);
  const hasCodexTerminalEvent =
    /"type":"turn\.completed"/.test(stdout) ||
    /"type":"response\.completed"/.test(stdout) ||
    /"type":"response\.failed"/.test(stdout) ||
    /"type":"error"/.test(stdout);
  const shouldWaitForCodexFlush =
    job.kind === 'codex' &&
    startedLikeCodexTurn &&
    !hasCodexTerminalEvent;

  if (exitCode == null || shouldWaitForCodexFlush) {
    const settleDeadline = Date.now() + 10_000;
    let stableReads = 0;
    let lastOutSize = await fileSizeSafe(job.stdoutPath);
    let lastErrSize = await fileSizeSafe(job.stderrPath);
    while (Date.now() < settleDeadline) {
      await sleep(150);
      const outSize = await fileSizeSafe(job.stdoutPath);
      const errSize = await fileSizeSafe(job.stderrPath);
      if (outSize === lastOutSize && errSize === lastErrSize) {
        stableReads += 1;
      } else {
        stableReads = 0;
        lastOutSize = outSize;
        lastErrSize = errSize;
      }

      exitCode = await readIntSafe(job.exitPath);
      stdout = await readTextSafe(job.stdoutPath);
      stderr = await readTextSafe(job.stderrPath);
      const codexNowTerminal =
        /"type":"turn\.completed"/.test(stdout) ||
        /"type":"response\.completed"/.test(stdout) ||
        /"type":"response\.failed"/.test(stdout) ||
        /"type":"error"/.test(stdout);
      if (shouldWaitForCodexFlush && codexNowTerminal && (exitCode != null || stableReads >= 2)) break;
      if (exitCode != null && stableReads >= 2) break;
    }
  }

  const ok = exitCode === 0;
  const finishedAt = nowIso();
  return {
    ...job,
    updatedAt: finishedAt,
    finishedAt,
    exitCode: exitCode ?? undefined,
    stdout,
    stderr,
    state: ok ? 'done' : 'failed',
    error: ok ? undefined : (stderr.trim() || stdout.trim() || job.error || 'failed'),
  };
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

function json(res: http.ServerResponse, status: number, obj: any) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(body);
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function tmux(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('tmux', args, { encoding: 'utf8' });
  return { stdout, stderr };
}

async function sessionExists(session: string): Promise<boolean> {
  try {
    await tmux(['has-session', '-t', session]);
    try {
      const pane = await tmux(['display-message', '-p', '-t', `${session}:0.0`, '#{pane_dead}']);
      if (String(pane.stdout ?? '').trim() === '1') {
        // A dead pane can keep the session object around (e.g. remain-on-exit),
        // which would otherwise make prompt jobs look "running" forever.
        try {
          await killSession(session);
        } catch {
          // ignore (best-effort cleanup)
        }
        return false;
      }
    } catch {
      // If pane status cannot be read, fall back to "session exists".
    }
    return true;
  } catch {
    return false;
  }
}

async function startSession(opts: {
  session: string;
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}): Promise<void> {
  const args: string[] = ['new-session', '-d', '-s', opts.session];
  if (opts.cwd) args.push('-c', opts.cwd);

  const cmdArgs: string[] = [];
  if (opts.env && Object.keys(opts.env).length > 0) {
    cmdArgs.push('env');
    for (const [k, v] of Object.entries(opts.env)) cmdArgs.push(`${k}=${v}`);
  }
  cmdArgs.push(opts.cmd, ...(opts.args ?? []));

  await tmux([...args, ...cmdArgs]);
  try {
    // Avoid "dead pane still has a session" states for daemon-managed jobs/processes.
    await tmux(['set-window-option', '-t', `${opts.session}:0`, 'remain-on-exit', 'off']);
  } catch {
    // ignore (best-effort; older tmux variants may differ)
  }
}

async function killSession(session: string): Promise<void> {
  await tmux(['kill-session', '-t', session]);
}

async function sendText(session: string, text: string, enter: boolean): Promise<void> {
  await tmux(['send-keys', '-t', `${session}:0.0`, text]);
  if (enter) {
    // Some TUIs (notably the Cursor Agent TUI) can miss a "submit" when the Enter key
    // is sent immediately after typing. A tiny delay makes submission reliable.
    await sleep(60);
    // Prefer explicit carriage return (C-m) over "Enter" to avoid apps that treat
    // line-feed/newline differently from submit.
    await tmux(['send-keys', '-t', `${session}:0.0`, 'C-m']);
  }
}

function normalizeKey(key: string): string {
  const k = key.trim().toLowerCase();
  if (k === 'ctrl+c' || k === 'c-c') return 'C-c';
  if (k === 'ctrl+d' || k === 'c-d') return 'C-d';
  if (k === 'esc' || k === 'escape') return 'Escape';
  if (k === 'shift+tab' || k === 'backtab' || k === 'btab') return 'BTab';
  if (k === 'enter' || k === 'return') return 'C-m';
  if (k === 'tab') return 'Tab';
  if (k === 'up') return 'Up';
  if (k === 'down') return 'Down';
  if (k === 'left') return 'Left';
  if (k === 'right') return 'Right';
  return key;
}

async function sendKeys(session: string, keys: string[]): Promise<void> {
  for (const key of keys) {
    await tmux(['send-keys', '-t', `${session}:0.0`, normalizeKey(key)]);
  }
}

async function tmuxLoadBufferFromStdin(bufferName: string, text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tmux', ['load-buffer', '-b', bufferName, '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.once('error', (err) => reject(err));
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error((stderr || `tmux load-buffer failed with code ${String(code ?? 1)}`).trim()));
    });
    try {
      child.stdin.end(text, 'utf8');
    } catch (e: any) {
      reject(new Error(e?.message ?? String(e)));
    }
  });
}

async function pasteRawText(session: string, text: string): Promise<void> {
  const payload = String(text ?? '');
  if (!payload) return;
  const bufferName = `drone-terminal-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  await tmuxLoadBufferFromStdin(bufferName, payload);
  await tmux(['paste-buffer', '-d', '-b', bufferName, '-t', `${session}:0.0`]);
}

async function pipePaneToFile(session: string, filePath: string): Promise<void> {
  await tmux(['pipe-pane', '-o', '-t', `${session}:0.0`, `cat >> ${filePath}`]);
}

async function capturePromptLine(session: string): Promise<string> {
  try {
    const target = `${session}:0.0`;
    const cur = await tmux(['display-message', '-p', '-t', target, '#{cursor_y}']);
    const cursorY = Number(String(cur.stdout ?? '').trim());
    if (Number.isFinite(cursorY) && cursorY >= 0) {
      const { stdout } = await tmux(['capture-pane', '-p', '-t', target, '-S', String(Math.floor(cursorY)), '-E', String(Math.floor(cursorY))]);
      const line = String(stdout ?? '').replace(/\r?\n$/, '');
      if (line) return line;
    }
    // Fallback for older tmux versions/edge states.
    const { stdout } = await tmux(['capture-pane', '-p', '-t', target, '-S', '-1', '-E', '-1']);
    return String(stdout ?? '').replace(/\r?\n$/, '');
  } catch {
    return '';
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function isSafeSessionName(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 64) return false;
  return /^[A-Za-z0-9._-]+$/.test(s);
}

let cachedDvmSessionsRoot: string | null = null;
async function resolveDvmSessionsRoot(): Promise<string> {
  if (cachedDvmSessionsRoot) return cachedDvmSessionsRoot;
  const dvm = '/dvm-data/dvm-sessions';
  const tmp = '/tmp/dvm-sessions';
  if (await fileExists(dvm)) {
    cachedDvmSessionsRoot = dvm;
    return dvm;
  }
  if (await fileExists(tmp)) {
    cachedDvmSessionsRoot = tmp;
    return tmp;
  }
  cachedDvmSessionsRoot = dvm;
  return dvm;
}

async function sessionLogPathFor(session: string): Promise<string> {
  const root = await resolveDvmSessionsRoot();
  return path.join(root, session, 'output.log');
}

async function readSessionLogChunk(logPath: string, sinceRaw: number, maxRaw: number): Promise<{ chunk: string; nextOffset: number }> {
  const max = Math.max(1, Math.min(1024 * 1024, Math.floor(maxRaw || 65536)));
  let fileSize = 0;
  try {
    const st = await fs.stat(logPath);
    fileSize = Number.isFinite(st.size) && st.size > 0 ? Math.floor(st.size) : 0;
  } catch {
    fileSize = 0;
  }

  const since = Number.isFinite(sinceRaw) && sinceRaw >= 0 ? Math.floor(sinceRaw) : 0;
  const offset = Math.min(since, fileSize);
  if (fileSize <= 0 || offset >= fileSize) {
    return { chunk: '', nextOffset: offset };
  }

  try {
    const fh = await fs.open(logPath, 'r');
    try {
      const buf = Buffer.alloc(max);
      const { bytesRead } = await fh.read(buf, 0, max, offset);
      const chunk = buf.subarray(0, bytesRead).toString('utf8');
      return { chunk, nextOffset: offset + bytesRead };
    } finally {
      await fh.close();
    }
  } catch {
    return { chunk: '', nextOffset: offset };
  }
}

async function main() {
  const host = parseArg(process.argv, '--host') ?? '0.0.0.0';
  const portRaw = parseArg(process.argv, '--port') ?? '7777';
  const dataDir = parseArg(process.argv, '--data-dir') ?? '/dvm-data/drone';
  const token = parseArg(process.argv, '--token');
  const tokenFile = parseArg(process.argv, '--token-file') ?? path.join(dataDir, 'token');

  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) throw new Error(`invalid --port: ${portRaw}`);

  let resolvedToken = token;
  if (!resolvedToken) resolvedToken = (await fs.readFile(tokenFile, 'utf8')).trim();
  if (!resolvedToken) throw new Error('missing token (use --token or --token-file)');

  const statePath = path.join(dataDir, 'state.json');
  const logsDir = path.join(dataDir, 'logs');
  await fs.mkdir(logsDir, { recursive: true });

  const promptsDir = path.join(dataDir, 'prompts');
  const promptJobsDir = path.join(promptsDir, 'jobs');
  const promptOutDir = path.join(promptsDir, 'out');
  await ensureDir(promptJobsDir);
  await ensureDir(promptOutDir);

  let promptPumpBusy = false;
  async function pumpPrompts() {
    if (promptPumpBusy) return;
    promptPumpBusy = true;
    try {
      const idx = await loadPromptIndex(promptsDir);
      const order = Array.isArray(idx.order) ? idx.order.map(String).filter(Boolean) : [];
      // First, finalize any running jobs whose session ended.
      for (const id of order) {
        const job = await loadPromptJob(promptsDir, id);
        if (!job) continue;
        if (job.state !== 'running') continue;
        const alive = await sessionExists(job.session);
        if (alive) continue;
        const next = await finalizePromptJob(job);
        await savePromptJob(promptsDir, next);
      }

      // Start next queued if none running.
      const anyRunning = await (async () => {
        for (const id of order) {
          const job = await loadPromptJob(promptsDir, id);
          if (job && job.state === 'running') return true;
        }
        return false;
      })();
      if (anyRunning) return;

      let startId: string | null = null;
      for (const id of order) {
        const job = await loadPromptJob(promptsDir, id);
        if (job && job.state === 'queued') {
          startId = id;
          break;
        }
      }
      if (!startId) return;
      const job = await loadPromptJob(promptsDir, startId);
      if (!job) return;
      const startedAt = nowIso();
      const running: PromptJob = { ...job, state: 'running', startedAt, updatedAt: startedAt };
      await savePromptJob(promptsDir, running);
      await startPromptJob(running);
    } finally {
      promptPumpBusy = false;
    }
  }

  // Resume any queued/running prompts on daemon restart.
  setInterval(() => {
    void pumpPrompts();
  }, 400);
  void pumpPrompts();

  async function readState(): Promise<DroneState> {
    try {
      const raw = await fs.readFile(statePath, 'utf8');
      return JSON.parse(raw) as DroneState;
    } catch {
      return {};
    }
  }
  async function writeState(s: DroneState): Promise<void> {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(s, null, 2), 'utf8');
  }

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = u.pathname;
      const method = (req.method ?? 'GET').toUpperCase();

      const auth = String(req.headers.authorization ?? '');
      if (auth !== `Bearer ${resolvedToken}`) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }

      if (method === 'GET' && pathname === '/v1/health') {
        json(res, 200, { ok: true, name: 'drone-daemon', time: new Date().toISOString() });
        return;
      }

      if (method === 'POST' && pathname === '/v1/prompts/enqueue') {
        const body = await readJson(req);
        const id = String(body?.id ?? '').trim();
        if (!id) {
          json(res, 400, { error: 'missing id' });
          return;
        }
        const cmd = String(body?.cmd ?? '').trim();
        if (!cmd) {
          json(res, 400, { error: 'missing cmd' });
          return;
        }
        const args = Array.isArray(body?.args) ? body.args.filter((x: any) => typeof x === 'string') : [];
        const cwd = typeof body?.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined;
        const kind = String(body?.kind ?? 'shell').trim() || 'shell';
        const env =
          body?.env && typeof body.env === 'object' && !Array.isArray(body.env)
            ? (Object.fromEntries(Object.entries(body.env).filter(([, v]) => typeof v === 'string')) as Record<string, string>)
            : undefined;

        const existing = await loadPromptJob(promptsDir, id);
        if (existing) {
          json(res, 200, { ok: true, id, state: existing.state, note: 'already exists' });
          return;
        }

        const session = promptSessionName(id);
        const stdoutPath = path.join(promptOutDir, `${id}.stdout.txt`);
        const stderrPath = path.join(promptOutDir, `${id}.stderr.txt`);
        const exitPath = path.join(promptOutDir, `${id}.exit.txt`);

        const createdAt = nowIso();
        const job: PromptJob = {
          id,
          kind,
          cmd,
          args,
          cwd,
          env,
          createdAt,
          updatedAt: createdAt,
          state: 'queued',
          session,
          stdoutPath,
          stderrPath,
          exitPath,
        };
        await savePromptJob(promptsDir, job);
        const idx = await loadPromptIndex(promptsDir);
        const order = Array.isArray(idx.order) ? idx.order.map(String) : [];
        if (!order.includes(id)) order.push(id);
        idx.order = order.slice(-400);
        await savePromptIndex(promptsDir, idx);
        void pumpPrompts();
        json(res, 202, { ok: true, id, state: 'queued' });
        return;
      }

      const promptMatch = pathname.match(/^\/v1\/prompts\/([^/]+)$/);
      if (method === 'GET' && promptMatch) {
        const id = decodeURIComponent(promptMatch[1] ?? '');
        const job = await loadPromptJob(promptsDir, id);
        if (!job) {
          json(res, 404, { error: 'not found' });
          return;
        }
        // Best-effort finalize if it ended since last pump.
        if (job.state === 'running') {
          const alive = await sessionExists(job.session);
          if (!alive) {
            const next = await finalizePromptJob(job);
            await savePromptJob(promptsDir, next);
            json(res, 200, { ok: true, job: next });
            return;
          }
        }
        json(res, 200, { ok: true, job });
        return;
      }

      if (method === 'GET' && pathname === '/v1/status') {
        const state = await readState();
        const proc = state.process;
        if (!proc) {
          json(res, 200, { ok: true, process: null });
          return;
        }
        const running = await sessionExists(proc.session);
        json(res, 200, { ok: true, process: { ...proc, running } });
        return;
      }

      if (method === 'POST' && pathname === '/v1/process/start') {
        const body = await readJson(req);
        const cmd = String(body?.cmd ?? '');
        if (!cmd) {
          json(res, 400, { error: 'missing cmd' });
          return;
        }
        const args = Array.isArray(body?.args) ? body.args.filter((x: any) => typeof x === 'string') : [];
        const cwd = typeof body?.cwd === 'string' ? body.cwd : undefined;
        const session = typeof body?.session === 'string' && body.session ? body.session : 'drone-main';
        const env =
          body?.env && typeof body.env === 'object' && !Array.isArray(body.env)
            ? (Object.fromEntries(Object.entries(body.env).filter(([, v]) => typeof v === 'string')) as Record<string, string>)
            : undefined;
        const force = body?.force === true;

        const state = await readState();
        if (state.process && !force) {
          json(res, 409, { error: 'process already exists', process: state.process });
          return;
        }

        const exists = await sessionExists(session);
        if (exists) {
          if (!force) {
            json(res, 409, { error: 'tmux session already exists', session });
            return;
          }
          await killSession(session);
        }

        const logPath = path.join(logsDir, `${session}.log`);
        await fs.writeFile(logPath, '', 'utf8');

        await startSession({ session, cmd, args, cwd, env });
        await pipePaneToFile(session, logPath);

        const next: DroneState = {
          process: { session, cmd, args, cwd, env, logPath, startedAt: new Date().toISOString() },
        };
        await writeState(next);

        json(res, 200, { ok: true, process: next.process });
        return;
      }

      if (method === 'POST' && pathname === '/v1/process/stop') {
        const body = await readJson(req);
        const state = await readState();
        const target = typeof body?.session === 'string' && body.session ? body.session : state.process?.session;
        if (!target) {
          json(res, 400, { error: 'no process to stop' });
          return;
        }
        if (await sessionExists(target)) await killSession(target);
        await writeState({});
        json(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && pathname === '/v1/input') {
        const body = await readJson(req);
        const text = String(body?.text ?? '');
        if (!text) {
          json(res, 400, { error: 'missing text' });
          return;
        }
        const enter = body?.enter !== false;
        const state = await readState();
        const target = typeof body?.session === 'string' && body.session ? body.session : state.process?.session;
        if (!target) {
          json(res, 400, { error: 'no active process' });
          return;
        }
        await sendText(target, text, enter);
        json(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && pathname === '/v1/keys') {
        const body = await readJson(req);
        const keys = Array.isArray(body?.keys) ? body.keys.filter((x: any) => typeof x === 'string') : [];
        if (keys.length === 0) {
          json(res, 400, { error: 'missing keys' });
          return;
        }
        const state = await readState();
        const target = typeof body?.session === 'string' && body.session ? body.session : state.process?.session;
        if (!target) {
          json(res, 400, { error: 'no active process' });
          return;
        }
        await sendKeys(target, keys);
        json(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && pathname === '/v1/terminal/input') {
        const body = await readJson(req);
        const session = String(body?.session ?? '').trim();
        const data = typeof body?.data === 'string' ? body.data : '';
        if (!isSafeSessionName(session)) {
          json(res, 400, { error: 'invalid session' });
          return;
        }
        if (!data) {
          json(res, 400, { error: 'missing data' });
          return;
        }
        if (Buffer.byteLength(data, 'utf8') > 128 * 1024) {
          json(res, 413, { error: 'input too large' });
          return;
        }
        const exists = await sessionExists(session);
        if (!exists) {
          json(res, 404, { error: `session not found: ${session}` });
          return;
        }
        await pasteRawText(session, data);
        json(res, 202, { ok: true, session, bytes: Buffer.byteLength(data, 'utf8') });
        return;
      }

      if (method === 'GET' && pathname === '/v1/terminal/output') {
        const session = String(u.searchParams.get('session') ?? '').trim();
        if (!isSafeSessionName(session)) {
          json(res, 400, { error: 'invalid session' });
          return;
        }
        const since = Number(u.searchParams.get('since') ?? '0');
        const max = Number(u.searchParams.get('max') ?? '65536');
        const logPath = await sessionLogPathFor(session);
        const out = await readSessionLogChunk(logPath, since, max);
        json(res, 200, { ok: true, session, chunk: out.chunk, nextOffset: out.nextOffset, logPath });
        return;
      }

      if (method === 'GET' && pathname === '/v1/terminal/prompt') {
        const session = String(u.searchParams.get('session') ?? '').trim();
        if (!isSafeSessionName(session)) {
          json(res, 400, { error: 'invalid session' });
          return;
        }
        const exists = await sessionExists(session);
        if (!exists) {
          json(res, 404, { error: `session not found: ${session}` });
          return;
        }
        const text = await capturePromptLine(session);
        json(res, 200, { ok: true, session, text });
        return;
      }

      if (method === 'GET' && pathname === '/v1/terminal/output/stream') {
        const session = String(u.searchParams.get('session') ?? '').trim();
        if (!isSafeSessionName(session)) {
          json(res, 400, { error: 'invalid session' });
          return;
        }
        const hasSince = u.searchParams.has('since');
        const since = Number(u.searchParams.get('since') ?? '0');
        const logPath = await sessionLogPathFor(session);
        const initial = await readSessionLogChunk(logPath, hasSince ? since : Number.MAX_SAFE_INTEGER, 1);
        let offset = initial.nextOffset;

        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');
        res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, session, since: offset })}\n\n`);

        let closed = false;
        req.on('close', () => {
          closed = true;
        });

        while (!closed) {
          try {
            const out = await readSessionLogChunk(logPath, offset, 128 * 1024);
            if (out.chunk) {
              offset = out.nextOffset;
              res.write(`event: output\ndata: ${JSON.stringify({ chunk: out.chunk, nextOffset: offset })}\n\n`);
            } else {
              offset = out.nextOffset;
            }
          } catch {
            // ignore transient read errors
          }
          await sleep(25);
        }
        return;
      }

      if (method === 'GET' && pathname === '/v1/output') {
        const state = await readState();
        const proc = state.process;
        if (!proc) {
          json(res, 200, { ok: true, chunk: '', nextOffset: 0, logPath: null });
          return;
        }
        const since = Number(u.searchParams.get('since') ?? '0');
        const max = Math.min(Number(u.searchParams.get('max') ?? '65536'), 1024 * 1024);
        const offset = Number.isFinite(since) && since >= 0 ? since : 0;

        try {
          const fh = await fs.open(proc.logPath, 'r');
          try {
            const buf = Buffer.alloc(max);
            const { bytesRead } = await fh.read(buf, 0, max, offset);
            const chunk = buf.subarray(0, bytesRead).toString('utf8');
            json(res, 200, { ok: true, chunk, nextOffset: offset + bytesRead, logPath: proc.logPath });
          } finally {
            await fh.close();
          }
        } catch {
          json(res, 200, { ok: true, chunk: '', nextOffset: offset, logPath: proc.logPath });
        }
        return;
      }

      if (method === 'GET' && pathname === '/v1/output/stream') {
        const state = await readState();
        const proc = state.process;
        if (!proc) {
          res.statusCode = 404;
          res.end('no process');
          return;
        }
        let offset = Number(u.searchParams.get('since') ?? '0');
        if (!Number.isFinite(offset) || offset < 0) offset = 0;

        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');
        res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, since: offset })}\n\n`);

        let closed = false;
        req.on('close', () => {
          closed = true;
        });

        while (!closed) {
          try {
            const fh = await fs.open(proc.logPath, 'r');
            try {
              const buf = Buffer.alloc(64 * 1024);
              const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
              if (bytesRead > 0) {
                const chunk = buf.subarray(0, bytesRead).toString('utf8');
                offset += bytesRead;
                res.write(`event: output\ndata: ${JSON.stringify({ chunk, nextOffset: offset })}\n\n`);
              }
            } finally {
              await fh.close();
            }
          } catch {
            // ignore transient read errors
          }
          await sleep(300);
        }
        return;
      }

      json(res, 404, { error: 'not found' });
    } catch (err: any) {
      json(res, 500, { error: err?.message ?? String(err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, () => resolve()));
  // eslint-disable-next-line no-console
  console.log(`drone-daemon listening on http://${host}:${port}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
