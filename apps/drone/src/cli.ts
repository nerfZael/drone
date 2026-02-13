#!/usr/bin/env node
import { Command } from 'commander';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fsSync from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import { health, procStart, procStop, readOutput, sendInput, sendKeys, status } from './host/api';
import { dvmCreate, dvmExec, dvmLs, dvmPorts, dvmRemove, dvmRename, dvmScript, dvmSessionStart } from './host/dvm';
import { droneRootPath } from './host/paths';
import { loadRegistry, updateRegistry } from './host/registry';
import { startDroneHubApiServer } from './hub/server';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function bashQuote(s: string): string {
  // Safe single-quote for bash:  abc'def  ->  'abc'\''def'
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function normalizeContainerCwd(raw: any): string | undefined {
  const s = raw == null ? '' : String(raw).trim();
  if (!s) return undefined;
  // Keep it conservative: `tmux new-session -c` expects a directory path.
  // Require absolute paths to avoid surprising behavior.
  if (!s.startsWith('/')) {
    throw new Error(`invalid --cwd: must be an absolute path inside the container (example: /dvm-data/work)`);
  }
  return s;
}

type CreateCommandOptions = {
  group?: string;
  containerPort?: string | number;
  cwd?: string;
  mkdir?: boolean;
  repo?: string;
};

type ParsedCreateOptions = {
  group?: string;
  containerPort: number;
  cwd?: string;
  mkdir: boolean;
  repoPath: string;
};

function addCreateOptions(command: Command): Command {
  return command
    .option('--group <group>', 'Optional group name for organizing drones in the Hub')
    .option('--container-port <port>', 'Daemon port inside container', '7777')
    .option('--cwd <path>', 'Default working directory inside container (used by agent/run/proc-start when --cwd omitted)')
    .option('--mkdir', 'Create --cwd inside the container (mkdir -p)', false)
    .option(
      '--repo <path>',
      'Host repo path associated with this drone (Hub metadata only). Use "-" for no repo.',
      process.cwd()
    );
}

function parseCreateOptions(options: CreateCommandOptions): ParsedCreateOptions {
  const repoArg = String(options.repo ?? '').trim();
  const repoPath =
    repoArg === '-' || repoArg.toLowerCase() === 'none' ? '' : path.resolve(repoArg || process.cwd());
  const groupRaw = options.group == null ? '' : String(options.group);
  const group = groupRaw.trim() ? groupRaw.trim() : undefined;
  const containerPort = Number(options.containerPort);
  if (!Number.isFinite(containerPort) || containerPort <= 0) throw new Error('invalid --container-port');
  const cwd = normalizeContainerCwd(options.cwd);
  return { group, containerPort, cwd, mkdir: Boolean(options.mkdir), repoPath };
}

function isValidDroneNameDashCase(name: string): boolean {
  const n = String(name ?? '').trim();
  if (!n || n.length > 48) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n);
}

async function readAllStdin(): Promise<string> {
  const chunks: string[] = [];
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) chunks.push(String(chunk));
  return chunks.join('');
}

async function resolvePromptText(opts: { promptParts: string[]; promptFile?: string; promptStdin?: boolean }): Promise<string> {
  const fromArgs = (opts.promptParts ?? []).join(' ').trim();
  if (fromArgs) return fromArgs;
  if (opts.promptFile) {
    const raw = await fs.readFile(path.resolve(String(opts.promptFile)), 'utf8');
    const t = raw.trim();
    if (!t) throw new Error('empty --prompt-file');
    return t;
  }
  if (opts.promptStdin) {
    const raw = await readAllStdin();
    const t = raw.trim();
    if (!t) throw new Error('empty stdin prompt');
    return t;
  }
  throw new Error('missing prompt');
}

function parseChatId(text: string): string | null {
  const m = String(text).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

async function createCursorAgentChatId(containerName: string): Promise<string> {
  const r = await dvmExec(containerName, 'bash', ['-lc', 'agent create-chat']);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || 'agent create-chat failed');
  const id = parseChatId(`${r.stdout}\n${r.stderr}`);
  if (!id) throw new Error(`failed to parse chatId from agent create-chat output: ${r.stdout || r.stderr || '(empty)'}`);
  return id;
}

async function ensureChatId(opts: { droneName: string; chatName: string; model?: string; reset?: boolean }): Promise<string> {
  const reg = await loadRegistry();
  const d = reg.drones[opts.droneName];
  if (!d) throw new Error(`unknown drone: ${opts.droneName} (not in registry)`);

  d.chats = d.chats ?? {};
  const existing = d.chats[opts.chatName];
  if (existing && !opts.reset && typeof existing.chatId === 'string' && existing.chatId.trim()) return existing.chatId;

  const createdId = await createCursorAgentChatId(d.name);
  return await updateRegistry((reg2) => {
    const d2 = reg2.drones[opts.droneName];
    if (!d2) throw new Error(`unknown drone: ${opts.droneName} (not in registry)`);
    d2.chats = d2.chats ?? {};
    const cur = d2.chats[opts.chatName];
    const curId = cur && typeof (cur as any).chatId === 'string' ? String((cur as any).chatId).trim() : '';
    if (curId && !opts.reset) return curId;
    d2.chats[opts.chatName] = {
      ...(cur && typeof cur === 'object' ? cur : {}),
      chatId: createdId,
      createdAt: new Date().toISOString(),
      ...(opts.model ? { model: opts.model } : {}),
    } as any;
    reg2.drones[opts.droneName] = d2 as any;
    return createdId;
  });
}

async function recordChatTurn(opts: {
  droneName: string;
  chatName: string;
  prompt: string;
  session: string;
  logPath: string;
}): Promise<void> {
  await updateRegistry((reg) => {
    const d = reg.drones[opts.droneName];
    if (!d) throw new Error(`unknown drone: ${opts.droneName} (not in registry)`);
    d.chats = d.chats ?? {};
    d.chats[opts.chatName] = d.chats[opts.chatName] ?? { chatId: '', createdAt: new Date().toISOString() };
    const entry: any = d.chats[opts.chatName];
    entry.turns = Array.isArray(entry.turns) ? entry.turns : [];
    entry.turns.push({
      at: new Date().toISOString(),
      prompt: opts.prompt,
      session: opts.session,
      logPath: opts.logPath,
    });
    d.chats[opts.chatName] = entry;
    reg.drones[opts.droneName] = d;
  });
}

async function followOutput(opts: {
  name: string;
  since: number;
  until?: string;
  timeoutMs: number;
}): Promise<void> {
  await withDroneClient(opts.name, async ({ client }) => {
    let offset = opts.since;
    const until = opts.until ? new RegExp(opts.until) : null;
    const start = Date.now();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const resp = await readOutput(client, { since: offset, max: 65536 });
      const chunk = String(resp.chunk ?? '');
      if (chunk) process.stdout.write(chunk);
      offset = Number(resp.nextOffset ?? offset);
      if (until && until.test(chunk)) break;
      if (Date.now() - start > opts.timeoutMs) throw new Error('follow timeout');
      await sleep(300);
    }
  });
}

async function getFreeTcpPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => resolve());
  });
  const addr = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!addr || typeof addr === 'string') throw new Error('failed to allocate port');
  return addr.port;
}

type HubState = {
  version: 1;
  pid: number;
  apiHost: string;
  apiPort: number;
  uiPort: number;
  startedAt: string;
  logPath: string;
};

function droneDir(): string {
  return droneRootPath();
}

function hubStatePath(): string {
  return path.join(droneDir(), 'hub.json');
}

function hubLogPath(): string {
  return path.join(droneDir(), 'hub.log');
}

async function ensureDroneDir(): Promise<void> {
  await fs.mkdir(droneDir(), { recursive: true });
}

function pidIsRunning(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    const code = String(e?.code ?? '');
    // EPERM means "exists but no permission".
    return code === 'EPERM';
  }
}

async function readHubState(): Promise<HubState | null> {
  try {
    const raw = await fs.readFile(hubStatePath(), 'utf8');
    const parsed: any = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== 1) return null;
    const pid = Number(parsed.pid);
    const apiPort = Number(parsed.apiPort);
    const uiPort = Number(parsed.uiPort);
    if (!Number.isFinite(pid) || !Number.isFinite(apiPort) || !Number.isFinite(uiPort)) return null;
    const apiHost = typeof parsed.apiHost === 'string' ? parsed.apiHost : '127.0.0.1';
    const startedAt = typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date().toISOString();
    const logPath = typeof parsed.logPath === 'string' ? parsed.logPath : hubLogPath();
    return { version: 1, pid, apiHost, apiPort, uiPort, startedAt, logPath };
  } catch {
    return null;
  }
}

async function writeHubState(state: HubState): Promise<void> {
  await ensureDroneDir();
  const p = hubStatePath();
  await fs.writeFile(p, JSON.stringify(state, null, 2), 'utf8');
  await setPrivateFileModeBestEffort(p);
}

async function setPrivateFileModeBestEffort(p: string): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    await fs.chmod(p, 0o600);
  } catch (error: any) {
    const code = String(error?.code ?? '');
    if (code === 'ENOSYS' || code === 'EINVAL' || code === 'EPERM') return;
    throw error;
  }
}

async function removeHubStateIfOwnedByPid(pid: number): Promise<void> {
  try {
    const cur = await readHubState();
    if (cur && cur.pid === pid) {
      await fs.rm(hubStatePath(), { force: true });
    }
  } catch {
    // ignore
  }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!pidIsRunning(pid)) return true;
    await sleep(80);
  }
  return !pidIsRunning(pid);
}

async function runGit(
  args: string[],
  cwd: string,
  timeoutMs = 10_000
): Promise<{ code: number; stdout: string; stderr: string }> {
  const r = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'], cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    let done = false;
    let timeout: any = null;

    const finish = (res: { code: number; stdout: string; stderr: string }) => {
      if (done) return;
      done = true;
      if (timeout) clearTimeout(timeout);
      resolve(res);
    };

    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeout = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, 750);
        finish({
          code: 124,
          stdout,
          stderr: `${stderr}${stderr.trim() ? '\n\n' : ''}Timed out after ${Math.round(timeoutMs / 1000)}s`,
        });
      }, timeoutMs);
    }

    child.once('error', (err: any) => finish({ code: 127, stdout, stderr: `${stderr}${err?.message ?? String(err)}` }));
    child.once('close', (code) => finish({ code: typeof code === 'number' ? code : 1, stdout, stderr }));
  });
  return r;
}

async function gitTopLevel(cwd: string): Promise<string> {
  const r = await runGit(['rev-parse', '--show-toplevel'], cwd);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'not a git repo').trim());
  const p = String(r.stdout ?? '').trim();
  if (!p) throw new Error('failed to resolve git root');
  return p;
}

async function gitBestRemoteUrl(repoRoot: string): Promise<string | null> {
  // Prefer origin; fall back to first remote.
  const origin = await runGit(['remote', 'get-url', 'origin'], repoRoot);
  const o = String(origin.stdout ?? '').trim();
  if (origin.code === 0 && o) return o;
  const all = await runGit(['remote', '-v'], repoRoot);
  const lines = String(all.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    // Example: origin  git@github.com:owner/repo.git (fetch)
    const parts = line.split(/\s+/g);
    const url = parts[1] ? String(parts[1]).trim() : '';
    if (url) return url;
  }
  return null;
}

function parseGithubSlug(remoteUrl: string | null): { owner: string; repo: string } | null {
  const u = String(remoteUrl ?? '').trim();
  if (!u) return null;
  const m =
    u.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/i) ??
    u.match(/^https?:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/i);
  const owner = (m as any)?.groups?.owner ? String((m as any).groups.owner).trim() : '';
  const repo = (m as any)?.groups?.repo ? String((m as any).groups.repo).trim() : '';
  if (!owner || !repo) return null;
  return { owner, repo };
}

async function ensureDaemonBuilt(_repoPath: string) {
  const daemonPath = resolveDroneDaemonJsPath();
  try {
    await fs.stat(daemonPath);
  } catch {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    throw new Error(`Missing ${daemonPath}. Run: cd ${repoRoot}/apps/drone && bun run build`);
  }
}

function resolveDroneDaemonJsPath(): string {
  // When built, __dirname is .../apps/drone/dist and daemon.js is a sibling.
  // When running from source (ts-node), __dirname is .../apps/drone/src and daemon.js is in ../dist.
  const candidates = [
    path.resolve(__dirname, 'daemon.js'),
    path.resolve(__dirname, '..', 'dist', 'daemon.js'),
  ];
  // Prefer an existing path, but return the first candidate for error messages.
  for (const p of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      // (sync check is fine here; this is CLI startup)
      fsSync.accessSync(p);
      return p;
    } catch {
      // keep trying
    }
  }
  return candidates[0]!;
}

async function resolveHostPort(container: string, containerPort: number): Promise<number> {
  const ports = await dvmPorts(container);
  const match = ports.find((p) => p.containerPort === containerPort);
  if (!match) throw new Error(`No host port mapped for ${container}:${containerPort} (run: dvm ports ${container})`);
  return match.hostPort;
}

function makeClient(hostPort: number, token: string) {
  return { baseUrl: `http://127.0.0.1:${hostPort}`, token };
}

type DroneRegistryEntry = Awaited<ReturnType<typeof loadRegistry>>['drones'][string];
type DroneClient = ReturnType<typeof makeClient>;

async function withDroneClient<T>(
  name: string,
  fn: (ctx: { drone: DroneRegistryEntry; hostPort: number; client: DroneClient }) => Promise<T>
): Promise<T> {
  const reg = await loadRegistry();
  const d = reg.drones[name];
  if (!d) throw new Error(`unknown drone: ${name} (not in registry)`);
  const hostPort = await resolveHostPort(d.name, d.containerPort);
  const client = makeClient(hostPort, d.token);
  return await fn({ drone: d, hostPort, client });
}

async function waitForHealth(hostPort: number, token: string, timeoutMs = 15_000) {
  const start = Date.now();
  const client = makeClient(hostPort, token);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await health(client);
      return;
    } catch {
      if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for daemon health');
      await sleep(300);
    }
  }
}

async function readTokenFromContainer(containerName: string): Promise<string> {
  const r = await dvmExec(containerName, 'bash', ['-lc', 'cat /dvm-data/drone/token 2>/dev/null || true']);
  const token = String(r.stdout ?? '').trim();
  if (!token) throw new Error(`missing token in container: ${containerName} (expected /dvm-data/drone/token)`);
  return token;
}

async function isDroneContainer(containerName: string): Promise<boolean> {
  // Conservative heuristic: token + daemon installed in persistence.
  // If exec fails (container not running), treat as unknown (false).
  const r = await dvmExec(containerName, 'bash', [
    '-lc',
    'test -f /dvm-data/drone/token -a -f /dvm-data/drone/daemon.js && echo yes || echo no',
  ]);
  return String(r.stdout ?? '').trim().split('\n').pop() === 'yes';
}

function formatList(items: string[]): string {
  return items.map((x) => `- ${x}`).join('\n');
}

const program = new Command();
program.name('drone').description('Manage per-container drone daemons via dvm');

const createCommand = addCreateOptions(
  program
    .command('create')
    .argument('<name>', 'Container name (one drone per container)')
);

createCommand
  .option('--no-build', 'Skip checking daemon build output')
  .action(async (name, options) => {
    const { repoPath, group, containerPort, cwd, mkdir } = parseCreateOptions(options);

    if (options.build) await ensureDaemonBuilt(repoPath);

    const token = crypto.randomBytes(32).toString('base64url');

    // Pick truly free host ports (dvm's auto-allocation only checks Docker ports, not host processes).
    const hostPortDaemon = await getFreeTcpPort();
    const hostPortRdp = await getFreeTcpPort();
    const hostPortNoVnc = await getFreeTcpPort();
    const hostPort3000 = await getFreeTcpPort();
    const hostPort3001 = await getFreeTcpPort();
    const hostPort5173 = await getFreeTcpPort();
    const hostPort5174 = await getFreeTcpPort();
    await dvmCreate(name, [
      '--ports',
      `${hostPortDaemon}:${containerPort},${hostPortRdp}:3389,${hostPortNoVnc}:6080,${hostPort3000}:3000,${hostPort3001}:3001,${hostPort5173}:5173,${hostPort5174}:5174`,
    ]);

    const hostPort = await resolveHostPort(name, containerPort);

    if (cwd) {
      const ensureCmd = mkdir
        ? `mkdir -p ${bashQuote(cwd)}`
        : `test -d ${bashQuote(cwd)} || (echo "cwd does not exist: ${cwd} (pass --mkdir to create)" 1>&2; exit 1)`;
      const ensured = await dvmExec(name, 'bash', ['-lc', ensureCmd]);
      if (ensured.code !== 0) {
        throw new Error(ensured.stderr || ensured.stdout || `failed ensuring --cwd: ${cwd}`);
      }
    }

    // Persist token inside container too (so daemon can read it).
    const writeTokenCmd = `mkdir -p /dvm-data/drone && umask 077 && printf %s '${token}' > /dvm-data/drone/token`;
    const wr = await dvmExec(name, 'bash', ['-lc', writeTokenCmd]);
    if (wr.code !== 0) throw new Error(wr.stderr || wr.stdout || 'failed writing token in container');

    // Install daemon JS into the container persistence volume (no bind mount required).
    const daemonPath = resolveDroneDaemonJsPath();
    const daemonJs = await fs.readFile(daemonPath, 'utf8');
    const delimiter = `DRONE_DAEMON_${crypto.randomBytes(8).toString('hex')}`;
    const installScript = `#!/usr/bin/env bash
set -euo pipefail
mkdir -p /dvm-data/drone
cat > /dvm-data/drone/daemon.js <<'${delimiter}'
${daemonJs}
${delimiter}
chmod +x /dvm-data/drone/daemon.js
`;

    const tmpDir = droneRootPath('tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpScriptPath = path.join(tmpDir, `install-daemon-${name}-${Date.now()}.sh`);
    await fs.writeFile(tmpScriptPath, installScript, { mode: 0o700 });
    try {
      await dvmScript(name, tmpScriptPath);
    } finally {
      await fs.rm(tmpScriptPath, { force: true });
    }

    await dvmSessionStart(
      name,
      'drone-daemon',
      'bash',
      ['-lc', `node /dvm-data/drone/daemon.js --host 0.0.0.0 --port ${containerPort} --data-dir /dvm-data/drone --token-file /dvm-data/drone/token`],
      true
    );

    await waitForHealth(hostPort, token);

    await updateRegistry((reg) => {
      reg.drones[name] = {
        name,
        group,
        cwd,
        hostPort,
        containerPort,
        token,
        repoPath,
        createdAt: new Date().toISOString(),
      };
    });

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, name, hostPort, containerPort, ...(cwd ? { cwd } : {}) }, null, 2));
  });

const importCommand = addCreateOptions(
  program
    .command('import')
    .description('Register an already-running drone container into the local registry')
    .argument('<name>', 'Drone/container name')
);

importCommand
  .action(async (name, options) => {
    const { repoPath, group, containerPort, cwd, mkdir } = parseCreateOptions(options);

    const hostPort = await resolveHostPort(String(name), containerPort);
    const token = await readTokenFromContainer(String(name));
    await waitForHealth(hostPort, token);

    if (cwd) {
      const ensureCmd = mkdir
        ? `mkdir -p ${bashQuote(cwd)}`
        : `test -d ${bashQuote(cwd)} || (echo "cwd does not exist: ${cwd} (pass --mkdir to create)" 1>&2; exit 1)`;
      const ensured = await dvmExec(String(name), 'bash', ['-lc', ensureCmd]);
      if (ensured.code !== 0) {
        throw new Error(ensured.stderr || ensured.stdout || `failed ensuring --cwd: ${cwd}`);
      }
    }

    await updateRegistry((reg) => {
      reg.drones[String(name)] = {
        name: String(name),
        group,
        cwd,
        hostPort,
        containerPort,
        token,
        repoPath,
        createdAt: new Date().toISOString(),
      };
    });

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, name: String(name), hostPort, containerPort, ...(cwd ? { cwd } : {}) }, null, 2));
  });

program
  .command('rm')
  .alias('remove')
  .description('Remove a drone: delete container + remove from registry')
  .argument('<name>', 'Drone/container name')
  .option('--keep-volume', 'Keep the dvm persistence volume (dvm-<name>-data)', false)
  .option('--forget', 'Remove from registry even if container removal fails', true)
  .action(async (name, options) => {
    const hadEntry = Boolean((await loadRegistry()).drones[String(name)]);

    let removeErr: string | null = null;
    try {
      await dvmRemove(String(name), { keepVolume: Boolean(options.keepVolume) });
    } catch (err: any) {
      removeErr = err?.message ?? String(err);
    }

    let removedRegistry = false;
    if (options.forget) {
      removedRegistry = await updateRegistry((reg) => {
        if (reg.drones[String(name)]) {
          delete reg.drones[String(name)];
          return true;
        }
        return false;
      });
    }

    if (removeErr) throw new Error(removeErr);

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, name: String(name), removedRegistry: removedRegistry || hadEntry }, null, 2));
  });

program
  .command('rename')
  .description('Rename a drone/container quickly and migrate host registry metadata')
  .argument('<oldName>', 'Existing drone/container name')
  .argument('<newName>', 'New drone/container name')
  .option('--start', 'Start the renamed container even if old one was stopped')
  .option('--no-start', 'Do not start the renamed container even if old one was running')
  .option('--migrate-volume-name', 'Also migrate persistence volume name to dvm-<new>-data (slower)', false)
  .action(async (oldNameRaw, newNameRaw, options) => {
    const oldName = String(oldNameRaw ?? '').trim();
    const newName = String(newNameRaw ?? '').trim();
    if (!isValidDroneNameDashCase(oldName)) throw new Error(`invalid old drone name: ${oldName}`);
    if (!isValidDroneNameDashCase(newName)) throw new Error(`invalid new drone name: ${newName}`);
    if (oldName === newName) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ok: true, oldName, newName, renamed: false, reason: 'same-name' }, null, 2));
      return;
    }

    const reg = await loadRegistry();
    const oldEntry = reg.drones[oldName];
    if (!oldEntry) throw new Error(`unknown drone: ${oldName} (not in registry)`);
    if (reg.drones[newName]) throw new Error(`drone already exists: ${newName}`);
    if ((reg as any)?.pending?.[newName]) throw new Error(`cannot rename to ${newName}: pending drone already exists`);

    const startMode = options.start === false ? 'never' : options.start === true ? 'always' : 'preserve';
    await dvmRename(oldEntry.name, newName, {
      startMode,
      migrateVolumeName: Boolean(options.migrateVolumeName),
    });
    const sourceContainerName = String(oldEntry.name ?? oldName).trim() || oldName;
    const hostPort = (await resolveHostPort(newName, oldEntry.containerPort).catch(() => null)) ?? oldEntry.hostPort;

    try {
      await updateRegistry((reg2: any) => {
        const cur = reg2?.drones?.[oldName];
        if (!cur) throw new Error(`drone disappeared from registry during rename: ${oldName}`);
        if (reg2?.drones?.[newName]) throw new Error(`drone already exists in registry: ${newName}`);
        delete reg2.drones[oldName];
        cur.name = newName;
        if (typeof hostPort === 'number' && Number.isFinite(hostPort)) cur.hostPort = hostPort;
        reg2.drones[newName] = cur;

        // Keep queued clone workflows coherent if they referenced the old name.
        if (reg2?.pending && typeof reg2.pending === 'object') {
          for (const p of Object.values(reg2.pending) as any[]) {
            if (String(p?.cloneFrom ?? '').trim() === oldName) {
              p.cloneFrom = newName;
            }
          }
        }
      });
    } catch (e: any) {
      // Keep CLI semantics aligned with Hub endpoint behavior:
      // if registry update fails after Docker rename, attempt rollback.
      try {
        await dvmRename(newName, sourceContainerName, { startMode: 'preserve', migrateVolumeName: false });
      } catch {
        // ignore rollback failure; throw original error below
      }
      throw e;
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, oldName, newName, hostPort, containerPort: oldEntry.containerPort }, null, 2));
  });

program
  .command('purge')
  .description('Remove all drones and their containers (registry drones by default)')
  .option('--orphans', 'Also detect running drone containers not in registry', false)
  .option('--apply', 'Actually delete (otherwise dry-run)', false)
  .option('--keep-volume', 'Keep dvm persistence volumes', false)
  .action(async (options) => {
    const reg = await loadRegistry();
    const inRegistry = Object.keys(reg.drones);

    let orphans: string[] = [];
    if (options.orphans) {
      const all = await dvmLs();
      const candidates = all.filter((n) => !reg.drones[n]);
      const found: string[] = [];
      for (const c of candidates) {
        try {
          if (await isDroneContainer(c)) found.push(c);
        } catch {
          // ignore containers we cannot inspect (stopped, permission, etc.)
        }
      }
      orphans = found;
    }

    const targets = [...new Set([...inRegistry, ...orphans])].sort();
    if (targets.length === 0) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ok: true, removed: 0, targets: [] }, null, 2));
      return;
    }

    if (!options.apply) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            ok: true,
            dryRun: true,
            targets,
            note: 'Run again with --apply to actually delete these drones/containers.',
          },
          null,
          2
        )
      );
      // Also print a human-friendly list for quick scanning.
      // eslint-disable-next-line no-console
      console.log(formatList(targets));
      return;
    }

    const errors: Array<{ name: string; error: string }> = [];
    for (const t of targets) {
      try {
        await dvmRemove(t, { keepVolume: Boolean(options.keepVolume) });
      } catch (err: any) {
        errors.push({ name: t, error: err?.message ?? String(err) });
      }
      if (reg.drones[t]) delete reg.drones[t];
    }
    await updateRegistry((regLatest) => {
      for (const t of targets) {
        if (regLatest.drones[t]) delete regLatest.drones[t];
      }
    });

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: errors.length === 0, removed: targets.length - errors.length, errors }, null, 2));
    if (errors.length > 0) process.exitCode = 1;
  });

program
  .command('ps')
  .alias('ls')
  .alias('list')
  .description('List drones known in local registry')
  .option('--group <group>', 'Only include drones in this group')
  .option('--ungrouped', 'Only include ungrouped drones', false)
  .action(async (options) => {
    const groupFilter = options.group == null ? null : String(options.group).trim();
    if (groupFilter !== null && !groupFilter) throw new Error('invalid --group (must be non-empty)');
    if (groupFilter && options.ungrouped) throw new Error('cannot use --group with --ungrouped');

    const reg = await loadRegistry();
    const out: any[] = [];
    for (const d of Object.values(reg.drones)) {
      const g = String(d.group ?? '').trim();
      if (options.ungrouped) {
        if (g) continue;
      } else if (groupFilter) {
        if (g !== groupFilter) continue;
      }

      try {
        const hostPort = await resolveHostPort(d.name, d.containerPort);
        const s = await status(makeClient(hostPort, d.token));
        out.push({ name: d.name, group: d.group ?? null, hostPort, containerPort: d.containerPort, ok: true, status: s });
      } catch (err: any) {
        out.push({ name: d.name, group: d.group ?? null, ok: false, error: err?.message ?? String(err) });
      }
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(out, null, 2));
  });

program
  .command('groups')
  .description('List existing drone groups (host-side metadata)')
  .action(async () => {
    const reg = await loadRegistry();
    const byGroup = new Map<string, string[]>();
    const ungrouped: string[] = [];
    for (const d of Object.values(reg.drones)) {
      const g = String(d.group ?? '').trim();
      if (!g) {
        ungrouped.push(d.name);
        continue;
      }
      const arr = byGroup.get(g) ?? [];
      arr.push(d.name);
      byGroup.set(g, arr);
    }

    const groups = Array.from(byGroup.entries())
      .map(([group, drones]) => ({ group, count: drones.length, drones: drones.slice().sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => a.group.localeCompare(b.group));

    ungrouped.sort((a, b) => a.localeCompare(b));

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          groups,
          ungrouped,
          totalDrones: Object.keys(reg.drones).length,
        },
        null,
        2
      )
    );
  });

program
  .command('group-set')
  .alias('set-group')
  .description('Assign (or reassign) a drone to a group')
  .argument('<name>', 'Drone/container name')
  .argument('<group>', 'Group name')
  .action(async (name, groupRaw) => {
    const group = String(groupRaw ?? '').trim();
    if (!group) throw new Error('invalid group (must be non-empty)');

    const prev = await updateRegistry((reg) => {
      const d = reg.drones[String(name)];
      if (!d) throw new Error(`unknown drone: ${String(name)} (not in registry)`);
      const prev = String(d.group ?? '').trim() || null;
      d.group = group;
      reg.drones[String(name)] = d;
      return prev;
    });

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, name: String(name), previousGroup: prev, group }, null, 2));
  });

program
  .command('group-clear')
  .alias('ungroup')
  .description('Clear a drone group assignment')
  .argument('<name>', 'Drone/container name')
  .action(async (name) => {
    const prev = await updateRegistry((reg) => {
      const d = reg.drones[String(name)];
      if (!d) throw new Error(`unknown drone: ${String(name)} (not in registry)`);
      const prev = String(d.group ?? '').trim() || null;
      delete (d as any).group;
      reg.drones[String(name)] = d;
      return prev;
    });

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, name: String(name), previousGroup: prev, group: null }, null, 2));
  });

program
  .command('repo')
  .description('Register a local git repo root in the registry (for the Hub UI)')
  .argument('[path]', 'Any path inside the repo (default: cwd)', process.cwd())
  .action(async (p) => {
    const cwd = path.resolve(String(p ?? process.cwd()));
    const repoRoot = await gitTopLevel(cwd);
    const remoteUrl = await gitBestRemoteUrl(repoRoot);
    const github = parseGithubSlug(remoteUrl);
    const addedAt = new Date().toISOString();

    await updateRegistry((reg: any) => {
      const cur = reg?.repos;
      const next: Record<string, any> =
        cur && typeof cur === 'object' && !Array.isArray(cur)
          ? (cur as any)
          : {};
      next[repoRoot] = {
        path: repoRoot,
        addedAt,
        ...(remoteUrl ? { remoteUrl } : {}),
        ...(github ? { github } : {}),
      };
      reg.repos = next;
    });

    const regAny: any = await loadRegistry();
    const reposObj = regAny?.repos && typeof regAny.repos === 'object' && !Array.isArray(regAny.repos) ? regAny.repos : {};
    const repos = Object.values(reposObj)
      .map((r: any) => ({
        path: typeof r?.path === 'string' ? String(r.path) : '',
        addedAt: typeof r?.addedAt === 'string' ? String(r.addedAt) : null,
        remoteUrl: typeof r?.remoteUrl === 'string' ? String(r.remoteUrl) : null,
        github: r?.github ?? null,
      }))
      .filter((r: any) => r.path)
      .sort((a: any, b: any) => String(a.path).localeCompare(String(b.path)));

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, added: repoRoot, repos }, null, 2));
  });

async function hubRun(options: any) {
  const uiPort = Number(options.port);
  if (!Number.isFinite(uiPort) || uiPort <= 0) throw new Error('invalid --port');

  const apiPortRaw = Number(options.apiPort);
  const apiPort = apiPortRaw === 0 ? await getFreeTcpPort() : apiPortRaw;
  if (!Number.isFinite(apiPort) || apiPort <= 0) throw new Error('invalid --api-port');

  const apiHost = String(options.host || '127.0.0.1');
  const apiToken = crypto.randomBytes(32).toString('base64url');
  const allowedOrigins = new Set<string>([`http://127.0.0.1:${uiPort}`, `http://localhost:${uiPort}`]);
  if (apiHost && apiHost !== '0.0.0.0' && apiHost !== '::') {
    allowedOrigins.add(`http://${apiHost}:${uiPort}`);
  }
  const api = await startDroneHubApiServer({
    port: apiPort,
    host: apiHost,
    apiToken,
    allowedOrigins: Array.from(allowedOrigins),
  });

  await writeHubState({
    version: 1,
    pid: process.pid,
    apiHost: api.host,
    apiPort: api.port,
    uiPort,
    startedAt: new Date().toISOString(),
    logPath: hubLogPath(),
  });

  // Repo root from this file's directory:
  // - src -> drone -> apps -> <repoRoot>
  const repoRoot = path.resolve(__dirname, '..', '..', '..');

  // Start the drone-hub Vite dev server and proxy /api → Hub API server.
  const hubDir = path.join(repoRoot, 'apps', 'drone-hub');
  const child = spawn('bun', ['run', 'dev', '--', '--port', String(uiPort), '--strictPort'], {
    cwd: hubDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      DRONE_HUB_API_PORT: String(api.port),
      DRONE_HUB_API_TOKEN: apiToken,
    },
  });

  const shutdown = async () => {
    try {
      child.kill('SIGINT');
    } catch {
      // ignore
    }
    try {
      await api.close();
    } catch {
      // ignore
    }
    await removeHubStateIfOwnedByPid(process.pid);
  };

  process.once('SIGINT', async () => {
    await shutdown();
  });
  process.once('SIGTERM', async () => {
    await shutdown();
  });

  // eslint-disable-next-line no-console
  console.log(`Drone Hub API: http://${api.host}:${api.port}`);
  // eslint-disable-next-line no-console
  console.log(`Drone Hub UI:  http://127.0.0.1:${uiPort}`);

  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => resolve());
  });
  await shutdown();
}

async function hubStart(options: any) {
  const uiPort = Number(options.port ?? 5174);
  if (!Number.isFinite(uiPort) || uiPort <= 0) throw new Error('invalid --port');
  const apiPortRaw = Number(options.apiPort ?? 0);
  if (!Number.isFinite(apiPortRaw) || apiPortRaw < 0) throw new Error('invalid --api-port');
  const apiHost = String(options.host || '127.0.0.1');

  const cur = await readHubState();
  if (cur && pidIsRunning(cur.pid)) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, alreadyRunning: true, state: cur }, null, 2));
    return;
  }
  if (cur && !pidIsRunning(cur.pid)) {
    // stale state
    try {
      await fs.rm(hubStatePath(), { force: true });
    } catch {
      // ignore
    }
  }

  await ensureDroneDir();
  const logPath = hubLogPath();
  const logHandle = await fs.open(logPath, 'a');
  try {
    const child = spawn(
      process.execPath,
      [__filename, 'hub', 'run', '--port', String(uiPort), '--api-port', String(apiPortRaw), '--host', apiHost],
      { detached: true, stdio: ['ignore', logHandle.fd, logHandle.fd], env: { ...process.env, DRONE_HUB_DAEMON: '1' } }
    );
    child.unref();

    let state: HubState | null = null;
    for (let i = 0; i < 60; i++) {
      // eslint-disable-next-line no-await-in-loop
      const s = await readHubState();
      if (s && s.pid === child.pid) {
        state = s;
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(80);
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          pid: child.pid,
          ...(state
            ? {
                apiUrl: `http://${state.apiHost}:${state.apiPort}`,
                uiUrl: `http://127.0.0.1:${state.uiPort}`,
                logPath: state.logPath,
              }
            : { logPath }),
        },
        null,
        2
      )
    );
  } finally {
    try {
      await logHandle.close();
    } catch {
      // ignore
    }
  }
}

async function hubStop() {
  const cur = await readHubState();
  if (!cur) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, stopped: false, reason: 'not running' }, null, 2));
    return;
  }

  const pid = Number(cur.pid);
  if (!pidIsRunning(pid)) {
    try {
      await fs.rm(hubStatePath(), { force: true });
    } catch {
      // ignore
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, stopped: false, reason: 'stale state file', previousPid: pid }, null, 2));
    return;
  }

  // Prefer killing the whole process group (hub + Vite child).
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }

  const exited = await waitForPidExit(pid, 8_000);
  if (!exited) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // ignore
      }
    }
    await waitForPidExit(pid, 2_000);
  }

  try {
    await fs.rm(hubStatePath(), { force: true });
  } catch {
    // ignore
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, stopped: true, pid }, null, 2));
}

const hub = program.command('hub').description('Manage the local Drone Hub (detached dev server)');
hub.command('start')
  .description('Start the hub in detached mode')
  .option('--port <port>', 'UI port (Vite dev server)', '5174')
  .option('--api-port <port>', 'Hub API port (0 = auto)', '0')
  .option('--host <host>', 'Bind host for Hub API server', '127.0.0.1')
  .action(async (options) => {
    await hubStart(options);
  });
hub.command('stop')
  .description('Stop the detached hub')
  .action(async () => {
    await hubStop();
  });
hub.command('restart')
  .description('Restart the detached hub')
  .option('--port <port>', 'UI port (Vite dev server)', '5174')
  .option('--api-port <port>', 'Hub API port (0 = auto)', '0')
  .option('--host <host>', 'Bind host for Hub API server', '127.0.0.1')
  .action(async (options) => {
    await hubStop();
    await hubStart(options);
  });
hub.command('run')
  .description('Run the hub in the current process (internal)')
  .option('--port <port>', 'UI port (Vite dev server)', '5174')
  .option('--api-port <port>', 'Hub API port (0 = auto)', '0')
  .option('--host <host>', 'Bind host for Hub API server', '127.0.0.1')
  .action(async (options) => {
    await hubRun(options);
  });
hub.action(async () => {
  // `drone hub` defaults to detached start.
  await hubStart({ port: 5174, apiPort: 0, host: '127.0.0.1' });
});

program
  .command('status')
  .argument('<name>', 'Drone/container name')
  .action(async (name) => {
    await withDroneClient(name, async ({ drone, hostPort, client }) => {
      const s = await status(client);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ name, hostPort, containerPort: drone.containerPort, status: s }, null, 2));
    });
  });

program
  .command('proc-start')
  .argument('<name>', 'Drone/container name')
  .option('--cwd <path>', 'Working directory inside container')
  .option('--session <session>', 'tmux session name', 'drone-main')
  .option('--force', 'Kill existing and start new', false)
  .description('Start a terminal process under tmux in the drone container')
  .action(async (name, options) => {
    await withDroneClient(name, async ({ drone, client }) => {
      const idx = process.argv.indexOf('--');
      if (idx === -1) throw new Error('usage: drone proc-start <name> -- <cmd> [args...]');
      const parts = process.argv.slice(idx + 1);
      if (parts.length === 0) throw new Error('missing cmd');
      const [command, ...args] = parts;

      const effectiveCwd = options.cwd ? String(options.cwd) : drone.cwd;
      const resp = await procStart(client, {
        cmd: command,
        args,
        cwd: effectiveCwd,
        session: options.session,
        force: !!options.force,
      });

      // eslint-disable-next-line no-console
      console.log(JSON.stringify(resp, null, 2));
    });
  });

program
  .command('run')
  .argument('<name>', 'Drone/container name')
  .option('--cwd <path>', 'Working directory inside container')
  .option('--session <session>', 'tmux session name', 'drone-main')
  .option('--force', 'Kill existing and start new', false)
  .option('--until <regex>', 'Stop when regex matches')
  .option('--timeout-ms <n>', 'Timeout in ms', '600000')
  .description('Start a command and stream output (proc-start + follow)')
  .action(async (name, options) => {
    await withDroneClient(name, async ({ drone, client }) => {
      const idx = process.argv.indexOf('--');
      if (idx === -1) throw new Error('usage: drone run <name> -- <cmd> [args...]');
      const parts = process.argv.slice(idx + 1);
      if (parts.length === 0) throw new Error('missing cmd');
      const [command, ...args] = parts;

      const effectiveCwd = options.cwd ? String(options.cwd) : drone.cwd;
      await procStart(client, {
        cmd: command,
        args,
        cwd: effectiveCwd,
        session: options.session,
        force: !!options.force,
      });
    });

    await followOutput({
      name,
      since: 0,
      until: options.until ? String(options.until) : undefined,
      timeoutMs: Number(options.timeoutMs),
    });
  });

program
  .command('agent')
  .description(
    'Persistent multi-turn Cursor Agent chat (stores chatId; uses --resume each turn). Use `agent-once` for one-shot.'
  )
  .argument('<name>', 'Drone/container name')
  .argument('[prompt...]', 'Prompt text (or use --prompt-file / --prompt-stdin)')
  .option('--chat <name>', 'Chat name to persist (host-side)', 'default')
  .option('--model <model>', 'Cursor agent model (optional)')
  .option('--new', 'Create a new chatId (reset stored chat)', false)
  .option('--prompt-file <path>', 'Read prompt from a file on the host')
  .option('--prompt-stdin', 'Read prompt from stdin', false)
  .option('--cwd <path>', 'Working directory inside container')
  .option('--session <session>', 'tmux session name', 'drone-agent')
  .option('--no-force', 'Do not kill existing and start new')
  .option('--timeout-ms <n>', 'Timeout in ms', '600000')
  .action(async (name, promptParts, options) => {
    await withDroneClient(name, async ({ drone, client }) => {
      const prompt = await resolvePromptText({
        promptParts: promptParts as string[],
        promptFile: options.promptFile ? String(options.promptFile) : undefined,
        promptStdin: Boolean(options.promptStdin),
      });

      const chatName = String(options.chat || 'default');
      const model = options.model ? String(options.model) : undefined;
      const chatId = await ensureChatId({ droneName: String(name), chatName, model, reset: Boolean(options.new) });

      const doneMarker = `DRONE_AGENT_DONE_${crypto.randomBytes(8).toString('hex')}`;
      const modelArg = model ? ` --model ${bashQuote(model)}` : '';
      const script = `set -euo pipefail; agent${modelArg} --resume ${bashQuote(chatId)} -f --approve-mcps --print ${bashQuote(
        prompt
      )}; echo ${bashQuote(doneMarker)}`;

      const effectiveCwd = options.cwd ? String(options.cwd) : drone.cwd;
      const started = await procStart(client, {
        cmd: 'bash',
        args: ['-lc', script],
        cwd: effectiveCwd,
        session: options.session,
        force: !!options.force,
      });
      if (started?.process?.logPath && started?.process?.session) {
        await recordChatTurn({
          droneName: String(name),
          chatName,
          prompt,
          session: String(started.process.session),
          logPath: String(started.process.logPath),
        });
      }

      await followOutput({
        name,
        since: 0,
        until: doneMarker,
        timeoutMs: Number(options.timeoutMs),
      });
    });
  });

program
  .command('agent-once')
  .description('One-shot Cursor Agent (no saved chatId/history). Niche: prefer `agent` for multi-turn.')
  .argument('<name>', 'Drone/container name')
  .argument('[prompt...]', 'Prompt text (or use --prompt-file / --prompt-stdin)')
  .option('--model <model>', 'Cursor agent model (optional)')
  .option('--prompt-file <path>', 'Read prompt from a file on the host')
  .option('--prompt-stdin', 'Read prompt from stdin', false)
  .option('--cwd <path>', 'Working directory inside container')
  .option('--session <session>', 'tmux session name', 'drone-agent-once')
  .option('--no-force', 'Do not kill existing and start new')
  .option('--timeout-ms <n>', 'Timeout in ms', '600000')
  .action(async (name, promptParts, options) => {
    await withDroneClient(name, async ({ drone, client }) => {
      const prompt = await resolvePromptText({
        promptParts: promptParts as string[],
        promptFile: options.promptFile ? String(options.promptFile) : undefined,
        promptStdin: Boolean(options.promptStdin),
      });

      const doneMarker = `DRONE_AGENT_ONCE_DONE_${crypto.randomBytes(8).toString('hex')}`;
      const model = options.model ? String(options.model) : undefined;
      const modelArg = model ? ` --model ${bashQuote(model)}` : '';
      const script = `set -euo pipefail; agent${modelArg} -f --approve-mcps --print ${bashQuote(prompt)}; echo ${bashQuote(doneMarker)}`;

      const effectiveCwd = options.cwd ? String(options.cwd) : drone.cwd;
      await procStart(client, {
        cmd: 'bash',
        args: ['-lc', script],
        cwd: effectiveCwd,
        session: options.session,
        force: !!options.force,
      });

      await followOutput({
        name,
        since: 0,
        until: doneMarker,
        timeoutMs: Number(options.timeoutMs),
      });
    });
  });

program
  .command('agent-chats')
  .description('Inspect persisted Cursor Agent chats, turns, and transcripts')
  .argument('<name>', 'Drone/container name')
  .option('--chat <name>', 'Chat name (if omitted: list all chats)')
  .option('--turn <n>', 'Turn number (1-based), or: last|all (requires --chat)')
  .action(async (name, options) => {
    const reg = await loadRegistry();
    const d = reg.drones[String(name)];
    if (!d) throw new Error(`unknown drone: ${name} (not in registry)`);

    const chats = d.chats ?? {};
    const chatOpt = options?.chat ? String(options.chat) : '';
    const turnOpt = options?.turn ? String(options.turn) : '';

    // Default: list chats (chatName -> {chatId, createdAt, ...})
    if (!chatOpt) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ok: true, name: String(name), chats }, null, 2));
      return;
    }

    const chatName = chatOpt;
    const c = chats[chatName];
    if (!c) throw new Error(`unknown chat: ${chatName}`);
    const turns = c.turns ?? [];

    // If --turn omitted: show turn metadata (prompt + logPath).
    if (!turnOpt) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ok: true, name: String(name), chat: chatName, chatId: c.chatId, turns }, null, 2));
      return;
    }

    // If --turn provided: print transcript(s) by reading each turn's logPath inside the container.
    if (turns.length === 0) throw new Error(`no stored turns for chat: ${chatName}`);

    const sel = String(turnOpt).trim().toLowerCase();
    let idxs: number[] = [];
    if (sel === 'all') idxs = turns.map((_: any, i: number) => i);
    else if (sel === 'last') idxs = [turns.length - 1];
    else {
      const n = Number(sel);
      if (!Number.isFinite(n) || n < 1 || Math.floor(n) !== n) throw new Error('invalid --turn (expected 1-based integer, last, or all)');
      if (n > turns.length) throw new Error(`turn out of range (max ${turns.length})`);
      idxs = [n - 1];
    }

    for (const i of idxs) {
      const t = turns[i];
      const at = String((t as any)?.at ?? '');
      const prompt = String((t as any)?.prompt ?? '');
      const session = typeof (t as any)?.session === 'string' ? String((t as any).session) : '';
      process.stdout.write(
        `=== drone:${String(name)} chat:${chatName} turn:${i + 1}/${turns.length} at:${at}${session ? ` session:${session}` : ''}\n`,
      );
      process.stdout.write(`--- PROMPT ---\n${prompt}\n`);

      if (typeof (t as any)?.ok === 'boolean') {
        const ok = Boolean((t as any).ok);
        const out = String((t as any)?.output ?? '');
        const err = String((t as any)?.error ?? '');
        process.stdout.write(`--- OUTPUT (${ok ? 'ok' : 'error'}) ---\n`);
        if (ok) {
          process.stdout.write(out);
        } else {
          process.stderr.write(err || out || 'failed');
        }
      } else {
        const logPath = String((t as any)?.logPath ?? '');
        process.stdout.write(`--- OUTPUT (${logPath || 'missing logPath'}) ---\n`);
        if (!logPath) throw new Error('missing logPath for legacy turn');
        const r = await dvmExec(d.name, 'bash', [
          '-lc',
          `cat ${bashQuote(logPath)} 2>/dev/null || (echo "missing log: ${logPath}" 1>&2; exit 1)`,
        ]);
        if (r.stdout) process.stdout.write(r.stdout);
        if (r.stderr) process.stderr.write(r.stderr);
        if (r.code !== 0) throw new Error(r.stderr || r.stdout || `failed reading log: ${logPath}`);
      }
      process.stdout.write(`\n=== END turn:${i + 1} ===\n`);
    }
  });

program
  .command('agent-reset')
  .description('Forget a persisted Cursor Agent chatId (host-side)')
  .argument('<name>', 'Drone/container name')
  .option('--chat <name>', 'Chat name to reset', 'default')
  .action(async (name, options) => {
    const chatName = String(options.chat || 'default');
    const had = await updateRegistry((reg) => {
      const d = reg.drones[String(name)];
      if (!d) throw new Error(`unknown drone: ${name} (not in registry)`);
      const had = Boolean(d.chats?.[chatName]);
      if (d.chats) delete d.chats[chatName];
      reg.drones[String(name)] = d;
      return had;
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, name: String(name), chat: chatName, removed: had }, null, 2));
  });

program
  .command('exec')
  .description('Run a command inside the drone container (wrapper around dvm exec)')
  .argument('<name>', 'Drone/container name')
  .action(async (name) => {
    const reg = await loadRegistry();
    const d = reg.drones[String(name)];
    if (!d) throw new Error(`unknown drone: ${name} (not in registry)`);
    const idx = process.argv.indexOf('--');
    if (idx === -1) throw new Error('usage: drone exec <name> -- <cmd> [args...]');
    const parts = process.argv.slice(idx + 1);
    if (parts.length === 0) throw new Error('missing cmd');
    const [cmd, ...args] = parts;
    const r = await dvmExec(d.name, cmd, args);
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.code !== 0) process.exitCode = r.code;
  });

program
  .command('proc-stop')
  .argument('<name>', 'Drone/container name')
  .option('--session <session>', 'tmux session name to stop (default: active process session)')
  .description('Stop the currently tracked process (or a specific tmux session)')
  .action(async (name, options) => {
    await withDroneClient(name, async ({ client }) => {
      const resp = await procStop(client, options.session ? { session: String(options.session) } : {});
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(resp, null, 2));
    });
  });

program
  .command('send')
  .argument('<name>', 'Drone/container name')
  .argument('<text...>', 'Text to send')
  .option('--no-enter', 'Do not press Enter')
  .action(async (name, textParts, options) => {
    await withDroneClient(name, async ({ client }) => {
      const text = (textParts as string[]).join(' ');
      // For TUIs (notably Cursor Agent), sending text + enter via a single API call
      // can be interpreted as "insert newline" rather than "submit". Typing first,
      // then sending an explicit carriage return is more reliable.
      const typed = await sendInput(client, { text, enter: false });
      let submitted: any = null;
      if (options.enter) {
        await sleep(60);
        submitted = await sendKeys(client, { keys: ['C-m'] });
      }
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ok: true, typed, submitted }, null, 2));
    });
  });

program
  .command('keys')
  .argument('<name>', 'Drone/container name')
  .argument('<keys...>', 'Keys to send (e.g. ctrl+c esc shift+tab)')
  .action(async (name, keysArr) => {
    await withDroneClient(name, async ({ client }) => {
      const resp = await sendKeys(client, { keys: keysArr as string[] });
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(resp, null, 2));
    });
  });

program
  .command('output')
  .argument('<name>', 'Drone/container name')
  .option('--since <n>', 'Byte offset', '0')
  .option('--max <n>', 'Max bytes', '65536')
  .action(async (name, options) => {
    await withDroneClient(name, async ({ client }) => {
      const resp = await readOutput(client, { since: Number(options.since), max: Number(options.max) });
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(resp, null, 2));
    });
  });

program
  .command('follow')
  .argument('<name>', 'Drone/container name')
  .option('--since <n>', 'Start offset', '0')
  .option('--until <regex>', 'Stop when regex matches')
  .option('--timeout-ms <n>', 'Timeout in ms', '600000')
  .action(async (name, options) => {
    await followOutput({
      name,
      since: Number(options.since),
      until: options.until ? String(options.until) : undefined,
      timeoutMs: Number(options.timeoutMs),
    });
  });

async function main() {
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
