#!/usr/bin/env node
import { Command } from 'commander';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fsSync from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import { health, procStart, procStop, readOutput, sendInput, sendKeys, status } from './host/api';
import { dvmClone, dvmCreate, dvmExec, dvmLs, dvmPorts, dvmRemove, dvmScript, dvmSessionStart } from './host/dvm';
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
  droneId?: string;
  cloneContainer?: string;
};

type ParsedCreateOptions = {
  group?: string;
  containerPort: number;
  cwd?: string;
  mkdir: boolean;
  repoPath: string;
  droneId?: string;
  cloneContainer?: string;
};

function addCreateOptions(command: Command): Command {
  return command
    .option('--group <group>', 'Optional group name for organizing drones in the Hub')
    .option('--container-port <port>', 'Daemon port inside container', '7777')
    .option('--cwd <path>', 'Default working directory inside container (used by agent/run/proc-start when --cwd omitted)')
    .option('--mkdir', 'Create --cwd inside the container (mkdir -p)', false)
    .option('--drone-id <id>', 'Stable drone identity (internal; advanced use)')
    .option('--clone-container <name>', 'Clone this existing container into the new drone container before provisioning')
    .option(
      '--repo <path>',
      'Host repo path associated with this drone (Hub metadata only). Use "-" for no repo.',
      process.cwd()
    );
}

function normalizeDroneIdentity(raw: unknown): string | undefined {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return undefined;
  if (id.length > 128) throw new Error('invalid --drone-id');
  return id;
}

function stableContainerNameFromDroneId(droneId: string): string {
  const id = String(droneId ?? '').trim();
  if (!id) throw new Error('missing drone id for container name');
  const uuid = parseUuid(id);
  if (uuid) return `drone-${uuid.toLowerCase()}`;
  const hex = crypto.createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 32);
  return `drone-${hex}`;
}

function resolveDroneFromRegistry(reg: Awaited<ReturnType<typeof loadRegistry>>, nameRaw: string): { key: string; drone: any; containerName: string } {
  const name = String(nameRaw ?? '').trim();
  if (!name) throw new Error('missing drone name');
  const byKey = (reg as any)?.drones?.[name] ?? null;
  if (byKey) {
    const containerName = String(byKey?.containerName ?? byKey?.name ?? name).trim() || name;
    return { key: name, drone: byKey, containerName };
  }
  const entries = Object.entries((reg as any)?.drones ?? {});
  const byValueName = entries.find(([, v]) => String((v as any)?.name ?? '').trim() === name) ?? null;
  if (byValueName) {
    const key = String(byValueName[0]);
    const drone = byValueName[1] as any;
    const containerName = String(drone?.containerName ?? drone?.name ?? key).trim() || key;
    return { key, drone, containerName };
  }
  const byContainer = entries.find(([, v]) => String((v as any)?.containerName ?? '').trim() === name) ?? null;
  if (byContainer) {
    const key = String(byContainer[0]);
    const drone = byContainer[1] as any;
    const containerName = String(drone?.containerName ?? drone?.name ?? key).trim() || key;
    return { key, drone, containerName };
  }
  throw new Error(`unknown drone: ${name} (not in registry)`);
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
  const droneId = normalizeDroneIdentity(options.droneId);
  const cloneContainerRaw = String(options.cloneContainer ?? '').trim();
  const cloneContainer = cloneContainerRaw || undefined;
  return { group, containerPort, cwd, mkdir: Boolean(options.mkdir), repoPath, droneId, cloneContainer };
}

const DRONE_DISPLAY_NAME_MAX_LEN = 80;
function normalizeDroneDisplayName(raw: any): string {
  const s = String(raw ?? '').trim();
  if (!s) throw new Error('missing drone name');
  if (s.length > DRONE_DISPLAY_NAME_MAX_LEN) throw new Error(`invalid drone name (max ${DRONE_DISPLAY_NAME_MAX_LEN} chars)`);
  if (/[\r\n]/.test(s)) throw new Error('invalid drone name (no newlines)');
  return s;
}
function registryHasDisplayName(reg: Awaited<ReturnType<typeof loadRegistry>>, nameRaw: string): boolean {
  const name = String(nameRaw ?? '').trim();
  if (!name) return false;
  for (const d of Object.values((reg as any)?.drones ?? {}) as any[]) {
    if (String(d?.name ?? '').trim() === name) return true;
  }
  for (const d of Object.values((reg as any)?.pending ?? {}) as any[]) {
    if (String(d?.name ?? '').trim() === name) return true;
  }
  return false;
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

function parseUuid(text: string): string | null {
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
  const { key, drone: d, containerName } = resolveDroneFromRegistry(reg, opts.droneName);

  d.chats = d.chats ?? {};
  const existing = d.chats[opts.chatName];
  if (existing && !opts.reset && typeof existing.chatId === 'string' && existing.chatId.trim()) return existing.chatId;

  const createdId = await createCursorAgentChatId(containerName);
  return await updateRegistry((reg2) => {
    const { key: key2, drone: d2 } = resolveDroneFromRegistry(reg2 as any, key);
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
    (reg2 as any).drones[key2] = d2 as any;
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
    const { key, drone: d } = resolveDroneFromRegistry(reg as any, opts.droneName);
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
    (reg as any).drones[key] = d;
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

async function getUniqueFreeTcpPorts(count: number): Promise<number[]> {
  const ports: number[] = [];
  const seen = new Set<number>();
  const maxAttempts = Math.max(20, count * 12);
  for (let i = 0; i < maxAttempts && ports.length < count; i++) {
    const p = await getFreeTcpPort();
    if (seen.has(p)) continue;
    seen.add(p);
    ports.push(p);
  }
  if (ports.length !== count) {
    throw new Error(`failed to allocate ${count} unique host ports`);
  }
  return ports;
}

function isPortAllocationConflictError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? '').toLowerCase();
  return (
    msg.includes('port is already allocated') ||
    msg.includes('address already in use') ||
    (msg.includes('bind for') && msg.includes('failed')) ||
    (msg.includes('failed to set up container networking') && msg.includes('bind'))
  );
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
  const { drone, containerName } = resolveDroneFromRegistry(reg, name);
  const hostPort = await resolveHostPort(containerName, Number((drone as any)?.containerPort ?? 7777));
  const client = makeClient(hostPort, (drone as any).token);
  return await fn({ drone: drone as any, hostPort, client });
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
    .argument('<name>', 'Drone display name (dash-case; used for CLI/UI lookups)')
);

createCommand
  .option('--no-build', 'Skip checking daemon build output')
  .action(async (name, options) => {
    const { repoPath, group, containerPort, cwd, mkdir, droneId, cloneContainer } = parseCreateOptions(options);

    if (options.build) await ensureDaemonBuilt(repoPath);

    const token = crypto.randomBytes(32).toString('base64url');
    const stableId = droneId ?? crypto.randomUUID();
    const containerName = stableContainerNameFromDroneId(stableId);
    const displayName = normalizeDroneDisplayName(name);

    let hostPort = 0;
    if (cloneContainer) {
      await dvmClone(cloneContainer, containerName, {
        start: true,
        copyPersistenceVolume: true,
      });
      hostPort = await resolveHostPort(containerName, containerPort);
    } else {
      const createAttempts = 5;
      for (let attempt = 1; attempt <= createAttempts; attempt++) {
        try {
          // Pick truly free host ports (dvm's auto-allocation only checks Docker ports, not host processes).
          const [hostPortDaemon, hostPortRdp, hostPortNoVnc, hostPort3000, hostPort3001, hostPort5173, hostPort5174] =
            await getUniqueFreeTcpPorts(7);
          await dvmCreate(containerName, [
            '--ports',
            `${hostPortDaemon}:${containerPort},${hostPortRdp}:3389,${hostPortNoVnc}:6080,${hostPort3000}:3000,${hostPort3001}:3001,${hostPort5173}:5173,${hostPort5174}:5174`,
          ]);
          hostPort = await resolveHostPort(containerName, containerPort);
          break;
        } catch (err) {
          if (!isPortAllocationConflictError(err) || attempt === createAttempts) throw err;
          try {
            await dvmRemove(containerName);
          } catch {
            // ignore best-effort cleanup between retries
          }
          await sleep(125 * attempt);
        }
      }
    }
    if (!hostPort) throw new Error(`failed creating ${containerName}: no daemon host port mapped`);

    if (cwd) {
      const ensureCmd = mkdir
        ? `mkdir -p ${bashQuote(cwd)}`
        : `test -d ${bashQuote(cwd)} || (echo "cwd does not exist: ${cwd} (pass --mkdir to create)" 1>&2; exit 1)`;
      const ensured = await dvmExec(containerName, 'bash', ['-lc', ensureCmd]);
      if (ensured.code !== 0) {
        throw new Error(ensured.stderr || ensured.stdout || `failed ensuring --cwd: ${cwd}`);
      }
    }

    // Persist token inside container too (so daemon can read it).
    const writeTokenCmd = `mkdir -p /dvm-data/drone && umask 077 && printf %s '${token}' > /dvm-data/drone/token`;
    const wr = await dvmExec(containerName, 'bash', ['-lc', writeTokenCmd]);
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
    const tmpScriptPath = path.join(tmpDir, `install-daemon-${stableId}-${Date.now()}.sh`);
    await fs.writeFile(tmpScriptPath, installScript, { mode: 0o700 });
    try {
      await dvmScript(containerName, tmpScriptPath);
    } finally {
      await fs.rm(tmpScriptPath, { force: true });
    }

    await dvmSessionStart(
      containerName,
      'drone-daemon',
      'bash',
      ['-lc', `node /dvm-data/drone/daemon.js --host 0.0.0.0 --port ${containerPort} --data-dir /dvm-data/drone --token-file /dvm-data/drone/token`],
      true
    );

    await waitForHealth(hostPort, token);

    await updateRegistry((reg) => {
      const at = new Date().toISOString();
      if (registryHasDisplayName(reg, displayName)) throw new Error(`drone already exists: ${displayName}`);
      if (group) {
        (reg as any).groups = (reg as any).groups ?? {};
        if (!(reg as any).groups[group]) (reg as any).groups[group] = { name: group, createdAt: at, updatedAt: at };
      }
      reg.drones[stableId] = {
        id: stableId,
        name: displayName,
        containerName,
        group,
        cwd,
        hostPort,
        containerPort,
        token,
        repoPath,
        createdAt: at,
      };
    });

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({ ok: true, id: stableId, name: displayName, containerName, hostPort, containerPort, ...(cwd ? { cwd } : {}) }, null, 2)
    );
  });

const importCommand = addCreateOptions(
  program
    .command('import')
    .description('Register an already-running drone container into the local registry')
    .argument('<name>', 'Drone display name (registry key)')
);

importCommand
  .option('--container <name>', 'Existing container name to import (defaults to derived from --drone-id when provided)')
  .action(async (name, options) => {
    const { repoPath, group, containerPort, cwd, mkdir, droneId } = parseCreateOptions(options);

    const displayName = normalizeDroneDisplayName(name);

    const regSnap = await loadRegistry();
    let existingId = '';
    try {
      const resolved = resolveDroneFromRegistry(regSnap, displayName);
      existingId = typeof (resolved.drone as any)?.id === 'string' ? String((resolved.drone as any).id).trim() : '';
    } catch {
      existingId = '';
    }
    const stableId = (droneId ?? existingId) || crypto.randomUUID();
    const derivedContainerName = stableContainerNameFromDroneId(stableId);
    const containerName = String((options as any)?.container ?? '').trim() || derivedContainerName;

    const hostPort = await resolveHostPort(containerName, containerPort);
    const token = await readTokenFromContainer(containerName);
    await waitForHealth(hostPort, token);

    if (cwd) {
      const ensureCmd = mkdir
        ? `mkdir -p ${bashQuote(cwd)}`
        : `test -d ${bashQuote(cwd)} || (echo "cwd does not exist: ${cwd} (pass --mkdir to create)" 1>&2; exit 1)`;
      const ensured = await dvmExec(containerName, 'bash', ['-lc', ensureCmd]);
      if (ensured.code !== 0) {
        throw new Error(ensured.stderr || ensured.stdout || `failed ensuring --cwd: ${cwd}`);
      }
    }

    await updateRegistry((reg) => {
      const at = new Date().toISOString();
      // Enforce unique display names (unless this is updating the same id).
      for (const [k, v] of Object.entries((reg as any)?.drones ?? {})) {
        if (String((v as any)?.name ?? '').trim() === displayName && String(k) !== String(stableId)) {
          throw new Error(`drone already exists: ${displayName}`);
        }
      }
      if (group) {
        (reg as any).groups = (reg as any).groups ?? {};
        if (!(reg as any).groups[group]) (reg as any).groups[group] = { name: group, createdAt: at, updatedAt: at };
      }
      reg.drones[stableId] = {
        id: stableId,
        name: displayName,
        containerName,
        group,
        cwd,
        hostPort,
        containerPort,
        token,
        repoPath,
        createdAt: at,
      };
    });

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({ ok: true, id: stableId, name: displayName, containerName, hostPort, containerPort, ...(cwd ? { cwd } : {}) }, null, 2)
    );
  });

program
  .command('rm')
  .alias('remove')
  .description('Remove a drone: delete container + remove from registry')
  .argument('<name>', 'Drone display name (or container name for legacy)')
  .option('--keep-volume', 'Keep the dvm persistence volume (dvm-<name>-data)', false)
  .option('--forget', 'Remove from registry even if container removal fails', true)
  .action(async (name, options) => {
    const regSnap = await loadRegistry();
    const nameStr = String(name ?? '').trim();
    let containerName = nameStr;
    let resolvedKey: string | null = null;
    try {
      const resolved = resolveDroneFromRegistry(regSnap, nameStr);
      resolvedKey = resolved.key;
      containerName = resolved.containerName;
    } catch {
      // Not in registry; treat as raw container name.
      containerName = nameStr;
    }
    const hadEntry = Boolean(resolvedKey);

    let removeErr: string | null = null;
    try {
      await dvmRemove(containerName, { keepVolume: Boolean(options.keepVolume) });
    } catch (err: any) {
      removeErr = err?.message ?? String(err);
    }

    let removedRegistry = false;
    if (options.forget) {
      removedRegistry = await updateRegistry((reg) => {
        const key = resolvedKey ? String(resolvedKey) : '';
        if (key && (reg as any)?.drones?.[key]) {
          delete (reg as any).drones[key];
          return true;
        }
        return false;
      });
    }

    if (removeErr) throw new Error(removeErr);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        { ok: true, id: resolvedKey, name: nameStr, containerName, removedRegistry: removedRegistry || hadEntry },
        null,
        2
      )
    );
  });

program
  .command('rename')
  .description('Rename a drone display name (container name stays stable)')
  .argument('<oldName>', 'Existing drone name (display name)')
  .argument('<newName>', 'New drone name (display name)')
  // Back-compat flags (ignored): container renames are no longer the default.
  .option('--start', '(deprecated/ignored) Start the container after rename (container rename no longer happens)', false)
  .option('--no-start', '(deprecated/ignored) Do not start the container after rename (container rename no longer happens)', undefined)
  .option('--migrate-volume-name', '(deprecated/ignored) Migrate persistence volume name', false)
  .action(async (oldNameRaw, newNameRaw, options) => {
    const oldName = normalizeDroneDisplayName(oldNameRaw);
    const newName = normalizeDroneDisplayName(newNameRaw);
    if (oldName === newName) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ok: true, oldName, newName, renamed: false, reason: 'same-name' }, null, 2));
      return;
    }

    const reg = await loadRegistry();
    const { key: oldKey, drone: oldEntry, containerName } = resolveDroneFromRegistry(reg, oldName);
    for (const [k, v] of Object.entries((reg as any)?.drones ?? {})) {
      if (String((v as any)?.name ?? '').trim() === newName && String(k) !== String(oldKey)) {
        throw new Error(`drone already exists: ${newName}`);
      }
    }

    await updateRegistry((reg2: any) => {
      const cur = reg2?.drones?.[oldKey] ?? null;
      if (!cur) throw new Error(`drone disappeared from registry during rename: ${oldName}`);
      const curId = normalizeDroneIdentity(cur?.id) ?? crypto.randomUUID();
      cur.id = curId;
      cur.name = newName;
      cur.containerName = String(cur?.containerName ?? containerName).trim() || containerName;
      reg2.drones[oldKey] = cur;
    });

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          id: oldKey,
          oldName,
          newName,
          containerName,
          hostPort: (oldEntry as any)?.hostPort ?? null,
          containerPort: Number((oldEntry as any)?.containerPort ?? 7777),
        },
        null,
        2
      )
    );
  });

program
  .command('purge')
  .description('Remove all drones and their containers (registry drones by default)')
  .option('--orphans', 'Also detect running drone containers not in registry', false)
  .option('--apply', 'Actually delete (otherwise dry-run)', false)
  .option('--keep-volume', 'Keep dvm persistence volumes', false)
  .action(async (options) => {
    const reg = await loadRegistry();
    const registryEntries = Object.entries((reg as any)?.drones ?? {}) as Array<[string, any]>;
    const inRegistryContainers = registryEntries
      .map(([key, d]) => String(d?.containerName ?? d?.name ?? key).trim())
      .filter(Boolean);
    const inRegistryContainerSet = new Set(inRegistryContainers);

    let orphans: string[] = [];
    if (options.orphans) {
      const all = await dvmLs();
      const candidates = all.filter((n) => !inRegistryContainerSet.has(String(n)));
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

    const targets = [...new Set([...inRegistryContainers, ...orphans])].sort();
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
      // Remove any registry entries that reference this container.
      for (const [key, d] of Object.entries((reg as any)?.drones ?? {})) {
        const c = String((d as any)?.containerName ?? (d as any)?.name ?? key).trim();
        if (c && c === t) {
          delete (reg as any).drones[key];
        }
      }
    }
    await updateRegistry((regLatest) => {
      for (const t of targets) {
        for (const [key, d] of Object.entries((regLatest as any)?.drones ?? {})) {
          const c = String((d as any)?.containerName ?? (d as any)?.name ?? key).trim();
          if (c && c === t) {
            delete (regLatest as any).drones[key];
          }
        }
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
        const containerName = String((d as any)?.containerName ?? (d as any)?.name ?? '').trim() || String((d as any)?.name ?? '');
        const hostPort = await resolveHostPort(containerName, d.containerPort);
        const s = await status(makeClient(hostPort, d.token));
        out.push({
          name: d.name,
          containerName,
          group: d.group ?? null,
          hostPort,
          containerPort: d.containerPort,
          ok: true,
          status: s,
        });
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
    for (const g of Object.keys((reg as any).groups ?? {})) {
      const name = String(g ?? '').trim();
      if (!name) continue;
      if (!byGroup.has(name)) byGroup.set(name, []);
    }
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
  .argument('<name>', 'Drone display name')
  .argument('<group>', 'Group name')
  .action(async (name, groupRaw) => {
    const group = String(groupRaw ?? '').trim();
    if (!group) throw new Error('invalid group (must be non-empty)');

    const prev = await updateRegistry((reg) => {
      const at = new Date().toISOString();
      (reg as any).groups = (reg as any).groups ?? {};
      if (!(reg as any).groups[group]) (reg as any).groups[group] = { name: group, createdAt: at, updatedAt: at };
      const { key, drone: d } = resolveDroneFromRegistry(reg as any, String(name));
      const prev = String(d.group ?? '').trim() || null;
      d.group = group;
      (reg as any).drones[key] = d;
      return prev;
    });

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, name: String(name), previousGroup: prev, group }, null, 2));
  });

program
  .command('group-clear')
  .alias('ungroup')
  .description('Clear a drone group assignment')
  .argument('<name>', 'Drone display name')
  .action(async (name) => {
    const prev = await updateRegistry((reg) => {
      const { key, drone: d } = resolveDroneFromRegistry(reg as any, String(name));
      const prev = String(d.group ?? '').trim() || null;
      delete (d as any).group;
      (reg as any).drones[key] = d;
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
  .argument('<name>', 'Drone display name')
  .option('--chat <name>', 'Chat name (if omitted: list all chats)')
  .option('--turn <n>', 'Turn number (1-based), or: last|all (requires --chat)')
  .action(async (name, options) => {
    const reg = await loadRegistry();
    const { drone: d, containerName } = resolveDroneFromRegistry(reg, String(name));

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
        const r = await dvmExec(containerName, 'bash', [
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
  .argument('<name>', 'Drone display name')
  .option('--chat <name>', 'Chat name to reset', 'default')
  .action(async (name, options) => {
    const chatName = String(options.chat || 'default');
    const had = await updateRegistry((reg) => {
      const { key, drone: d } = resolveDroneFromRegistry(reg as any, String(name));
      const had = Boolean(d.chats?.[chatName]);
      if (d.chats) delete d.chats[chatName];
      (reg as any).drones[key] = d;
      return had;
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, name: String(name), chat: chatName, removed: had }, null, 2));
  });

program
  .command('exec')
  .description('Run a command inside the drone container (wrapper around dvm exec)')
  .argument('<name>', 'Drone display name')
  .action(async (name) => {
    const reg = await loadRegistry();
    const { containerName } = resolveDroneFromRegistry(reg, String(name));
    const idx = process.argv.indexOf('--');
    if (idx === -1) throw new Error('usage: drone exec <name> -- <cmd> [args...]');
    const parts = process.argv.slice(idx + 1);
    if (parts.length === 0) throw new Error('missing cmd');
    const [cmd, ...args] = parts;
    const r = await dvmExec(containerName, cmd, args);
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
