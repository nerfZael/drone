#!/usr/bin/env node
import { Command } from 'commander';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fsSync from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { formatHubStartOutput, formatHubStopOutput, formatHumanOutput } from './cli-output';
import { health, procStart, procStop, readOutput, sendInput, sendKeys, status } from './host/api';
import { ensureContainerDroneDaemonSession } from './host/container-daemon';
import { dvmClone, dvmCopyToContainer, dvmCreate, dvmExec, dvmLs, dvmPorts, dvmRemove, dvmSessionStart } from './host/dvm';
import { droneRootPath } from './host/paths';
import {
  createProfile as createManagedProfile,
  ensureDefaultProfileForFirstRun,
  deleteProfile as deleteManagedProfile,
  listProfilesState,
  useProfile as useManagedProfile,
} from './host/profile-manager';
import {
  DEFAULT_PROFILE_NAME,
  defaultProfileDroneRootDir,
  defaultProfileDvmRootDir,
  ensureProfileDirs,
  listProfiles,
  normalizeProfileName,
  profileDroneRootDir,
  profileDvmRootDir,
  profileRootDir,
  readActiveProfileName,
  readActiveProfileNameSync,
  writeActiveProfileName,
} from './host/profiles';
import { loadRegistry, registryHasDisplayName, updateRegistry } from './host/registry';
import { readRegistryJsonFromSqlitePath } from './host/sqlite-registry-store';
import {
  hostDroneDaemonDataPath,
  hostDroneDaemonLogPath,
  hostDroneDaemonTokenPath,
  hostDroneRootPath,
  hostDroneWorkspacePath,
  buildContainerDroneDaemonLaunchScript,
  DRONE_DAEMON_SESSION_NAME,
  installBlipCliScript,
  removeRetiredContainerCliScripts,
  missingHostDependencyMessage,
  normalizeDroneRuntime,
  type DroneRuntime,
} from './host/runtime';
import { ensureHubSetupState } from './host/setup-state';
import { resolveDetachedCliLaunchSpec } from './hub/hub-launch';
import { readRawBody } from './hub/hub-http';
import { cleanupLegacyRemoteHub } from './hub/legacy-remote-cleanup';
import {
  upsertCanonicalDroneLifecycle,
} from './hub/drone-lifecycle-service';
import { permanentlyDeleteCanonicalDrone } from './hub/drone-deletion-service';
import { renameDroneDisplayName, setDroneGroupMetadata } from './hub/drone-metadata-commands';
import { DEFAULT_DEVICE_MESH_INGRESS_PORT } from './hub/device-mesh/device-mesh-ingress';
import { parseHubRunnerProcessesFromPsOutput, parseHubUiServerProcessesFromPsOutput, selectHubRunnerPidsToStop } from './hub/orphan-hub-runners';
import { startDroneHubApiServer } from './hub/server';
import {
  deleteChatFromStore,
  importChatFromRegistry,
  patchChatMetadataInStore,
  readChatFromStore,
  upsertChatInStore,
  upsertTranscriptTurnInStore,
} from './hub/transcript-store';
import { ensureCanonicalGroup, listCanonicalGroups, listCanonicalRepositories, registerCanonicalRepository } from './hub/groups-repositories';

const requireFromCli = createRequire(__filename);

async function persistRealDroneEntry(droneId: string, entry: any): Promise<void> {
  const canonical = await upsertCanonicalDroneLifecycle('real', droneId, entry);
  if (canonical) return;
  // Bun/native-binding compatibility only. Production Node must commit the
  // lifecycle row before any legacy projection exists.
  await updateRegistry((registry: any) => {
    registry.drones = registry.drones ?? {};
    registry.drones[droneId] = entry;
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function bashQuote(s: string): string {
  // Safe single-quote for bash:  abc'def  ->  'abc'\''def'
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function escapeRegExp(text: string): string {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDoneMarkerFromCapturedOutput(
  capturedRaw: string,
  markerPrefix: string
): { output: string; exitCode: number | null } {
  const captured = String(capturedRaw ?? '');
  const markerLine = new RegExp(`^${escapeRegExp(markerPrefix)}(\\d+)\\s*$`, 'gm');
  let exitCode: number | null = null;
  for (const m of captured.matchAll(markerLine)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 0) exitCode = Math.floor(n);
  }
  const output = captured.replace(markerLine, '').trimEnd();
  return { output, exitCode };
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

function normalizeHostCwd(raw: any): string | undefined {
  const s = raw == null ? '' : String(raw).trim();
  if (!s) return undefined;
  if (!path.isAbsolute(s)) {
    throw new Error(`invalid --cwd: must be an absolute host path (example: ${path.join(path.sep, 'tmp', 'drone-work')})`);
  }
  return path.resolve(s);
}

function normalizeRuntimeOption(raw: unknown): DroneRuntime {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return 'container';
  if (value === 'container' || value === 'host') return value;
  throw new Error('invalid --runtime (expected container|host)');
}

type CreateCommandOptions = {
  group?: string;
  containerPort?: string | number;
  runtime?: string;
  cwd?: string;
  mkdir?: boolean;
  repo?: string;
  droneId?: string;
  cloneContainer?: string;
  persistVolume?: boolean;
};

type ParsedCreateOptions = {
  group?: string;
  containerPort: number;
  runtime: DroneRuntime;
  cwd?: string;
  mkdir: boolean;
  repoPath: string;
  droneId?: string;
  cloneContainer?: string;
  persistVolume?: boolean;
};

function addCreateOptions(command: Command): Command {
  return command
    .option('--group <group>', 'Optional group name for organizing drones in the Hub')
    .option('--container-port <port>', 'Daemon port inside container', '7777')
    .option('--runtime <runtime>', 'Drone runtime: container|host', 'container')
    .option('--cwd <path>', 'Default working directory (container path for container runtime, host path for host runtime)')
    .option('--mkdir', 'Create --cwd if it does not exist (mkdir -p)', false)
    .option('--drone-id <id>', 'Stable drone identity (internal; advanced use)')
    .option('--clone-container <name>', 'Clone this existing container into the new drone container before provisioning')
    .option('--no-persist-volume', 'Do not mount a DVM persistence volume at /dvm-data; keep /dvm-data in the container image layer')
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

function resolveDroneFromRegistry(
  reg: Awaited<ReturnType<typeof loadRegistry>>,
  nameRaw: string
): { key: string; drone: any; containerName: string; runtime: DroneRuntime } {
  const name = String(nameRaw ?? '').trim();
  if (!name) throw new Error('missing drone name');
  const byKey = (reg as any)?.drones?.[name] ?? null;
  if (byKey) {
    const containerName = String(byKey?.containerName ?? byKey?.name ?? name).trim() || name;
    return { key: name, drone: byKey, containerName, runtime: normalizeDroneRuntime((byKey as any)?.runtime) };
  }
  const entries = Object.entries((reg as any)?.drones ?? {});
  const byValueName = entries.find(([, v]) => String((v as any)?.name ?? '').trim() === name) ?? null;
  if (byValueName) {
    const key = String(byValueName[0]);
    const drone = byValueName[1] as any;
    const containerName = String(drone?.containerName ?? drone?.name ?? key).trim() || key;
    return { key, drone, containerName, runtime: normalizeDroneRuntime((drone as any)?.runtime) };
  }
  const byContainer = entries.find(([, v]) => String((v as any)?.containerName ?? '').trim() === name) ?? null;
  if (byContainer) {
    const key = String(byContainer[0]);
    const drone = byContainer[1] as any;
    const containerName = String(drone?.containerName ?? drone?.name ?? key).trim() || key;
    return { key, drone, containerName, runtime: normalizeDroneRuntime((drone as any)?.runtime) };
  }
  throw new Error(`unknown drone: ${name} (not in registry)`);
}

function parseCreateOptions(options: CreateCommandOptions): ParsedCreateOptions {
  const runtime = normalizeRuntimeOption(options.runtime);
  const repoArg = String(options.repo ?? '').trim();
  const repoPath =
    repoArg === '-' || repoArg.toLowerCase() === 'none' ? '' : path.resolve(repoArg || process.cwd());
  const groupRaw = options.group == null ? '' : String(options.group);
  const group = groupRaw.trim() ? groupRaw.trim() : undefined;
  const containerPort = Number(options.containerPort);
  if (!Number.isFinite(containerPort) || containerPort <= 0) throw new Error('invalid --container-port');
  const cwd = runtime === 'host' ? normalizeHostCwd(options.cwd) : normalizeContainerCwd(options.cwd);
  const droneId = normalizeDroneIdentity(options.droneId);
  const cloneContainerRaw = String(options.cloneContainer ?? '').trim();
  const cloneContainer = cloneContainerRaw || undefined;
  const persistVolume = options.persistVolume === false ? false : undefined;
  return { group, containerPort, runtime, cwd, mkdir: Boolean(options.mkdir), repoPath, droneId, cloneContainer, persistVolume };
}

const DRONE_DISPLAY_NAME_MAX_LEN = 80;
function normalizeDroneDisplayName(raw: any): string {
  const s = String(raw ?? '').trim();
  if (!s) throw new Error('missing drone name');
  if (s.length > DRONE_DISPLAY_NAME_MAX_LEN) throw new Error(`invalid drone name (max ${DRONE_DISPLAY_NAME_MAX_LEN} chars)`);
  if (/[\r\n]/.test(s)) throw new Error('invalid drone name (no newlines)');
  return s;
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
  const droneId = String((d as any)?.id ?? key).trim() || key;

  d.chats = d.chats ?? {};
  const existing = d.chats[opts.chatName];
  if (existing && !opts.reset && typeof existing.chatId === 'string' && existing.chatId.trim()) return existing.chatId;

  const createdId = await createCursorAgentChatId(containerName);
  if (!(globalThis as any).Bun) {
    if (existing) await importChatFromRegistry({ droneId, chatName: opts.chatName, chatEntry: existing });
    const stored = readChatFromStore({ droneId, chatName: opts.chatName }).chat;
    const storedId = !opts.reset && typeof stored?.chatId === 'string' ? String(stored.chatId).trim() : '';
    if (storedId) return storedId;
    if (!stored) {
      await upsertChatInStore({
        droneId,
        chatName: opts.chatName,
        chatEntry: {
          chatId: createdId,
          createdAt: new Date().toISOString(),
          ...(opts.model ? { model: opts.model } : {}),
        },
      });
    } else {
      await patchChatMetadataInStore({
        droneId,
        chatName: opts.chatName,
        patch: {
          set: {
            chatId: createdId,
            createdAt: String(stored.createdAt ?? '').trim() || new Date().toISOString(),
            ...(opts.model ? { model: opts.model } : {}),
          },
        },
      });
    }
    return createdId;
  }
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
  ok: boolean;
  output: string;
  error?: string;
  promptAt?: string;
  completedAt?: string;
}): Promise<void> {
  if (!(globalThis as any).Bun) {
    const registry = await loadRegistry();
    const { key, drone } = resolveDroneFromRegistry(registry as any, opts.droneName);
    const droneId = String((drone as any)?.id ?? key ?? opts.droneName).trim() || opts.droneName;
    const legacyChat = (drone as any)?.chats?.[opts.chatName];
    if (legacyChat) await importChatFromRegistry({ droneId, chatName: opts.chatName, chatEntry: legacyChat });
    else {
      await upsertChatInStore({
        droneId,
        chatName: opts.chatName,
        chatEntry: { createdAt: new Date().toISOString() },
      });
    }
    const completedAt = String(opts.completedAt ?? new Date().toISOString());
    await upsertTranscriptTurnInStore({
      droneId,
      chatName: opts.chatName,
      turn: {
        at: completedAt,
        prompt: opts.prompt,
        ok: Boolean(opts.ok),
        output: String(opts.output ?? ''),
        ...(opts.error ? { error: String(opts.error) } : {}),
        ...(opts.promptAt ? { promptAt: String(opts.promptAt) } : {}),
        ...(opts.completedAt ? { completedAt: String(opts.completedAt) } : {}),
      },
    });
    return;
  }
  await updateRegistry((reg) => {
    const { key, drone: d } = resolveDroneFromRegistry(reg as any, opts.droneName);
    d.chats = d.chats ?? {};
    d.chats[opts.chatName] = d.chats[opts.chatName] ?? { chatId: '', createdAt: new Date().toISOString() };
    const entry: any = d.chats[opts.chatName];
    entry.turns = Array.isArray(entry.turns) ? entry.turns : [];
    const completedAt = String(opts.completedAt ?? new Date().toISOString());
    entry.turns.push({
      at: completedAt,
      prompt: opts.prompt,
      ok: Boolean(opts.ok),
      output: String(opts.output ?? ''),
      ...(opts.error ? { error: String(opts.error) } : {}),
      ...(opts.promptAt ? { promptAt: String(opts.promptAt) } : {}),
      ...(opts.completedAt ? { completedAt: String(opts.completedAt) } : {}),
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
}): Promise<string> {
  return await withDroneClient(opts.name, async ({ client }) => {
    let offset = opts.since;
    const until = opts.until ? new RegExp(opts.until) : null;
    const start = Date.now();
    let captured = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const resp = await readOutput(client, { since: offset, max: 65536 });
      const chunk = String(resp.chunk ?? '');
      if (chunk) {
        process.stdout.write(chunk);
        captured += chunk;
      }
      offset = Number(resp.nextOffset ?? offset);
      if (until && until.test(chunk)) break;
      if (Date.now() - start > opts.timeoutMs) throw new Error('follow timeout');
      await sleep(300);
    }
    return captured;
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

async function isTcpPortAvailable(host: string, port: number): Promise<boolean> {
  const server = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve());
    });
    return true;
  } catch (error: any) {
    const code = String(error?.code ?? '');
    if (code === 'EADDRINUSE' || code === 'EACCES') return false;
    throw error;
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

const DEFAULT_HUB_API_PORT = 8787;
const DEFAULT_HUB_API_HOST = '127.0.0.1';
const DEFAULT_CONTAINER_MCP_HOST = process.platform === 'linux' ? '172.17.0.1' : '0.0.0.0';
const DEFAULT_CONTAINER_MCP_PORT = 8788;

function parsePortOption(raw: unknown, optionName: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) throw new Error(`invalid ${optionName}`);
  return value;
}

function resolveContainerMcpHost(options: any): string {
  return String(
    options.containerMcpHost ??
      process.env.DRONE_HUB_CONTAINER_MCP_BIND_HOST ??
      DEFAULT_CONTAINER_MCP_HOST
  ).trim() || DEFAULT_CONTAINER_MCP_HOST;
}

function resolveContainerMcpPort(options: any): number {
  const raw = options.containerMcpPort ?? process.env.DRONE_HUB_CONTAINER_MCP_PORT ?? DEFAULT_CONTAINER_MCP_PORT;
  return parsePortOption(raw, '--container-mcp-port');
}

function resolveContainerMcpUrl(options: any): string {
  const raw = String(options.containerMcpUrl ?? process.env.DRONE_HUB_CONTAINER_MCP_URL ?? '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('invalid --container-mcp-url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('--container-mcp-url must be an http(s) URL');
  }
  if (parsed.pathname !== '/mcp') {
    throw new Error('--container-mcp-url must point to /mcp');
  }
  if (parsed.hash) {
    throw new Error('--container-mcp-url must not include a URL fragment');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function resolveContainerMcpProjectedUrl(port: number, explicitUrl: string): string {
  const normalizedExplicitUrl = explicitUrl.trim().replace(/\/+$/, '');
  return normalizedExplicitUrl || `http://host.docker.internal:${Math.floor(port)}/mcp`;
}

function resolveRepoRootFromDroneCliDir(): string {
  // Repo root from this file's directory:
  // - src -> drone -> apps -> <repoRoot>
  // - dist -> drone -> apps -> <repoRoot>
  return path.resolve(__dirname, '..', '..', '..');
}

type DroneHubUiMode = 'dev' | 'static';

type StaticDroneHubUiServer = {
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
};

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function normalizeDroneHubUiMode(raw: unknown): DroneHubUiMode {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value || value === 'dev') return 'dev';
  if (value === 'static' || value === 'desktop' || value === 'electron') return 'static';
  throw new Error('invalid --ui-mode (expected dev|static)');
}

function resolveDroneHubStaticUiDir(repoRoot: string, raw: unknown): string {
  const explicit = String(raw ?? process.env.DRONE_HUB_STATIC_UI_DIR ?? '').trim();
  if (explicit) return path.resolve(explicit);
  const candidates = [
    path.join(repoRoot, 'apps', 'drone-hub', 'dist'),
    path.join(__dirname, 'hub-ui'),
    path.join(__dirname, '..', 'hub-ui'),
  ];
  return candidates.find((candidate) => fsSync.existsSync(path.join(candidate, 'index.html'))) ?? candidates[0];
}

function contentTypeForStaticFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.webmanifest') return 'application/manifest+json; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

function safeDroneHubStaticPath(staticDir: string, pathname: string): string | null {
  let decoded = '/';
  try {
    decoded = decodeURIComponent(pathname.split('?')[0] ?? '/');
  } catch {
    return null;
  }
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(staticDir, rel);
  const root = path.resolve(staticDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

function shouldServeDroneHubIndexFallback(pathname: string): boolean {
  let decoded = '/';
  try {
    decoded = decodeURIComponent(pathname.split('?')[0] ?? '/');
  } catch {
    return false;
  }
  return decoded === '/' || decoded === '/index.html' || !path.posix.extname(decoded);
}

async function serveDroneHubStaticAsset(staticDir: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const resolved = safeDroneHubStaticPath(staticDir, url.pathname);
  const fallback = path.join(staticDir, 'index.html');
  const filePath = resolved && fsSync.existsSync(resolved) ? resolved : shouldServeDroneHubIndexFallback(url.pathname) ? fallback : null;
  if (!filePath || !fsSync.existsSync(filePath)) {
    res.statusCode = fsSync.existsSync(path.join(staticDir, 'index.html')) ? 404 : 503;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        ok: false,
        error: fsSync.existsSync(path.join(staticDir, 'index.html'))
          ? 'static asset not found'
          : `Drone Hub UI is not built at ${staticDir}; run \`bun run --filter drone-hub build\`.`,
      }),
    );
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', contentTypeForStaticFile(filePath));
  const base = path.basename(filePath);
  if (path.extname(filePath).toLowerCase() === '.html' || base === 'pwa-sw.js' || base === 'version.json') {
    res.setHeader('cache-control', 'no-store');
  } else if (url.pathname.startsWith('/assets/')) {
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
  }
  fsSync.createReadStream(filePath).pipe(res);
}

function copyProxyResponseHeaders(response: Response, res: http.ServerResponse): void {
  response.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
  });
}

async function proxyDroneHubApiRequest(opts: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  apiHost: string;
  apiPort: number;
  apiToken: string;
}): Promise<void> {
  const method = String(opts.req.method ?? 'GET').toUpperCase();
  const url = new URL(opts.req.url ?? '/', `http://${opts.req.headers.host ?? '127.0.0.1'}`);
  const target = `http://${opts.apiHost}:${opts.apiPort}${url.pathname}${url.search}`;
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(opts.req);
  const response = await fetch(target, {
    method,
    headers: {
      authorization: `Bearer ${opts.apiToken}`,
      ...(opts.req.headers['content-type'] ? { 'content-type': String(opts.req.headers['content-type']) } : {}),
      ...(opts.req.headers['if-none-match'] ? { 'if-none-match': String(opts.req.headers['if-none-match']) } : {}),
      ...(opts.req.headers['mcp-session-id'] ? { 'mcp-session-id': String(opts.req.headers['mcp-session-id']) } : {}),
    },
    body: body as any,
  });

  opts.res.statusCode = response.status;
  copyProxyResponseHeaders(response, opts.res);
  if (!response.body) {
    opts.res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body as any), opts.res);
}

function proxyDroneHubApiUpgrade(opts: {
  req: http.IncomingMessage;
  socket: net.Socket;
  head: Buffer;
  apiHost: string;
  apiPort: number;
  apiToken: string;
}): void {
  const url = new URL(opts.req.url ?? '/', `http://${opts.req.headers.host ?? '127.0.0.1'}`);
  if (!url.pathname.startsWith('/api/')) {
    opts.socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    opts.socket.destroy();
    return;
  }

  const upstream = net.connect(opts.apiPort, opts.apiHost);
  upstream.once('connect', () => {
    const headers = new Map<string, string>();
    for (const [key, value] of Object.entries(opts.req.headers)) {
      if (value == null) continue;
      const lower = key.toLowerCase();
      if (lower === 'host' || lower === 'authorization') continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    }
    headers.set('Host', `${opts.apiHost}:${opts.apiPort}`);
    headers.set('Authorization', `Bearer ${opts.apiToken}`);
    headers.set('Connection', 'Upgrade');
    headers.set('Upgrade', 'websocket');

    const lines = [`${opts.req.method ?? 'GET'} ${url.pathname}${url.search} HTTP/${opts.req.httpVersion}`];
    for (const [key, value] of headers) lines.push(`${key}: ${value}`);
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (opts.head.length > 0) upstream.write(opts.head);
    opts.socket.pipe(upstream).pipe(opts.socket);
  });
  upstream.once('error', () => {
    try {
      opts.socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    } catch {
      // ignore
    }
    opts.socket.destroy();
  });
}

async function startStaticDroneHubUiServer(opts: {
  port: number;
  host?: string;
  staticDir: string;
  apiHost: string;
  apiPort: number;
  apiToken: string;
}): Promise<StaticDroneHubUiServer> {
  const host = String(opts.host ?? '127.0.0.1').trim() || '127.0.0.1';
  const sockets = new Set<net.Socket>();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`);
      if (url.pathname.startsWith('/api/')) {
        await proxyDroneHubApiRequest({
          req,
          res,
          apiHost: opts.apiHost,
          apiPort: opts.apiPort,
          apiToken: opts.apiToken,
        });
        return;
      }
      await serveDroneHubStaticAsset(opts.staticDir, req, res);
    } catch (error: any) {
      if (res.headersSent) {
        if (!res.destroyed) res.destroy(error);
        return;
      }
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: error?.message ?? String(error) }));
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  server.on('upgrade', (req, socket, head) => {
    proxyDroneHubApiUpgrade({
      req,
      socket: socket as net.Socket,
      head,
      apiHost: opts.apiHost,
      apiPort: opts.apiPort,
      apiToken: opts.apiToken,
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  return {
    host,
    port,
    url: `http://${host}:${port}`,
    close: async () => {
      for (const socket of sockets) {
        try {
          socket.destroy();
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
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
  containerMcp?: {
    host: string;
    port: number;
    url: string;
  } | null;
  startedAt: string;
  logPath: string;
  launchEnv?: HubLaunchEnvSnapshot | null;
};

type HubSecretSnapshot = {
  present: boolean;
  hasValue: boolean;
  rawLength: number | null;
  trimmedLength: number | null;
  fingerprint: string | null;
};

type HubLaunchEnvSnapshot = {
  llmProvider: 'openai' | 'gemini' | null;
  llmProviderRaw: string | null;
  openai: HubSecretSnapshot;
  gemini: HubSecretSnapshot;
};

function normalizeHubLlmProviderEnv(raw: unknown): 'openai' | 'gemini' | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'openai' || value === 'gemini') return value;
  return null;
}

function fingerprintSecretValue(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}

function captureSecretEnvSnapshot(raw: unknown): HubSecretSnapshot {
  const present = raw !== undefined;
  const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  const trimmed = text.trim();
  return {
    present,
    hasValue: trimmed.length > 0,
    rawLength: present ? text.length : null,
    trimmedLength: present ? trimmed.length : null,
    fingerprint: fingerprintSecretValue(trimmed),
  };
}

function captureHubLaunchEnvSnapshot(): HubLaunchEnvSnapshot {
  const llmProviderRaw = String(process.env.DRONE_HUB_LLM_PROVIDER ?? '').trim();
  return {
    llmProvider: normalizeHubLlmProviderEnv(llmProviderRaw),
    llmProviderRaw: llmProviderRaw || null,
    openai: captureSecretEnvSnapshot(process.env.OPENAI_API_KEY),
    gemini: captureSecretEnvSnapshot(process.env.GEMINI_API_KEY),
  };
}

function parseHubSecretSnapshot(raw: unknown): HubSecretSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  return {
    present: value.present === true,
    hasValue: value.hasValue === true,
    rawLength: Number.isFinite(Number(value.rawLength)) ? Number(value.rawLength) : null,
    trimmedLength: Number.isFinite(Number(value.trimmedLength)) ? Number(value.trimmedLength) : null,
    fingerprint: typeof value.fingerprint === 'string' && value.fingerprint.trim() ? value.fingerprint.trim() : null,
  };
}

function parseHubLaunchEnvSnapshot(raw: unknown): HubLaunchEnvSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const openai = parseHubSecretSnapshot(value.openai);
  const gemini = parseHubSecretSnapshot(value.gemini);
  if (!openai || !gemini) return null;
  const llmProviderRaw = typeof value.llmProviderRaw === 'string' ? value.llmProviderRaw.trim() : '';
  return {
    llmProvider: normalizeHubLlmProviderEnv(value.llmProvider),
    llmProviderRaw: llmProviderRaw || null,
    openai,
    gemini,
  };
}

function hubLaunchEnvSnapshotsDiffer(a: HubLaunchEnvSnapshot | null | undefined, b: HubLaunchEnvSnapshot | null | undefined): boolean {
  if (!a || !b) return false;
  return JSON.stringify(a) !== JSON.stringify(b);
}

function droneDir(rootDir?: string): string {
  return rootDir ? path.resolve(rootDir) : droneRootPath();
}

function hubStatePath(rootDir?: string): string {
  return path.join(droneDir(rootDir), 'hub.json');
}

function hubTokenPath(rootDir?: string): string {
  return path.join(droneDir(rootDir), 'hub.token');
}

function hubMcpTokenPath(rootDir?: string): string {
  return path.join(droneDir(rootDir), 'hub.mcp.token');
}

function hubLogPath(rootDir?: string): string {
  return path.join(droneDir(rootDir), 'hub.log');
}

async function ensureDroneDir(rootDir?: string): Promise<void> {
  await fs.mkdir(droneDir(rootDir), { recursive: true });
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

async function readHubState(rootDir?: string): Promise<HubState | null> {
  try {
    const raw = await fs.readFile(hubStatePath(rootDir), 'utf8');
    const parsed: any = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== 1) return null;
    const pid = Number(parsed.pid);
    const apiPort = Number(parsed.apiPort);
    const uiPort = Number(parsed.uiPort);
    if (!Number.isFinite(pid) || !Number.isFinite(apiPort) || !Number.isFinite(uiPort)) return null;
    const apiHost = typeof parsed.apiHost === 'string' ? parsed.apiHost : '127.0.0.1';
    const startedAt = typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date().toISOString();
    const logPath = typeof parsed.logPath === 'string' ? parsed.logPath : hubLogPath(rootDir);
    const launchEnv = parseHubLaunchEnvSnapshot(parsed.launchEnv);
    const containerMcp = parseHubContainerMcpState(parsed.containerMcp);
    return { version: 1, pid, apiHost, apiPort, uiPort, containerMcp, startedAt, logPath, launchEnv };
  } catch {
    return null;
  }
}

function parseHubContainerMcpState(raw: unknown): HubState['containerMcp'] {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as any;
  const host = typeof value.host === 'string' ? value.host.trim() : '';
  const port = Number(value.port);
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  if (!host || !Number.isFinite(port) || port <= 0 || !url) return null;
  return { host, port: Math.floor(port), url };
}

async function writeHubState(state: HubState, rootDir?: string): Promise<void> {
  await ensureDroneDir(rootDir);
  const p = hubStatePath(rootDir);
  await fs.writeFile(p, JSON.stringify(state, null, 2), 'utf8');
  await setPrivateFileModeBestEffort(p);
}

async function writeHubApiToken(token: string, rootDir?: string): Promise<void> {
  await ensureDroneDir(rootDir);
  const p = hubTokenPath(rootDir);
  await fs.writeFile(p, `${String(token ?? '').trim()}\n`, 'utf8');
  await setPrivateFileModeBestEffort(p);
}

async function writeHubMcpToken(token: string, rootDir?: string): Promise<void> {
  await ensureDroneDir(rootDir);
  const p = hubMcpTokenPath(rootDir);
  await fs.writeFile(p, `${String(token ?? '').trim()}\n`, 'utf8');
  await setPrivateFileModeBestEffort(p);
}

async function readTrimmedSecretFile(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const token = String(raw ?? '').trim();
    return token || null;
  } catch {
    return null;
  }
}

async function readHubApiToken(rootDir?: string): Promise<string | null> {
  return readTrimmedSecretFile(hubTokenPath(rootDir));
}

async function readHubMcpToken(rootDir?: string): Promise<string | null> {
  return readTrimmedSecretFile(hubMcpTokenPath(rootDir));
}

async function ensureHubApiToken(rootDir?: string): Promise<string> {
  const existing = await readHubApiToken(rootDir);
  if (existing) return existing;
  const token = crypto.randomBytes(32).toString('base64url');
  await writeHubApiToken(token, rootDir);
  return token;
}

async function ensureHubMcpToken(rootDir?: string): Promise<string> {
  const existing = await readHubMcpToken(rootDir);
  if (existing) return existing;
  const token = crypto.randomBytes(32).toString('base64url');
  await writeHubMcpToken(token, rootDir);
  return token;
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

async function removeHubStateIfOwnedByPid(pid: number, rootDir?: string): Promise<void> {
  try {
    const cur = await readHubState(rootDir);
    if (cur && cur.pid === pid) {
      await fs.rm(hubStatePath(rootDir), { force: true });
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

async function readCommandStdout(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk ?? '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk ?? '');
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function findRecoverableHubRunnerPids(preferredUiPort: number): Promise<number[]> {
  if (process.platform === 'win32') return [];
  try {
    const psOutput = await readCommandStdout('ps', ['-eo', 'pid=,args=']);
    const matches = parseHubRunnerProcessesFromPsOutput(psOutput, {
      cliPath: __filename,
      selfPid: process.pid,
    });
    return selectHubRunnerPidsToStop(matches, preferredUiPort);
  } catch {
    return [];
  }
}

async function findRecoverableHubUiServerPids(preferredUiPort: number): Promise<number[]> {
  if (process.platform === 'win32') return [];
  try {
    const repoRoot = resolveRepoRootFromDroneCliDir();
    const psOutput = await readCommandStdout('ps', ['-eo', 'pid=,args=']);
    const matches = parseHubUiServerProcessesFromPsOutput(psOutput, {
      repoRoot,
      selfPid: process.pid,
    });
    return selectHubRunnerPidsToStop(matches, preferredUiPort);
  } catch {
    return [];
  }
}

async function stopHubProcess(pid: number): Promise<void> {
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
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function dirHasEntries(targetPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(targetPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function stopHubAtRootIfRunning(rootDir: string): Promise<boolean> {
  const cur = await readHubState(rootDir);
  if (!cur || !pidIsRunning(cur.pid)) {
    try {
      await fs.rm(hubStatePath(rootDir), { force: true });
    } catch {
      // ignore
    }
    return false;
  }
  await stopHubProcess(cur.pid);
  try {
    await fs.rm(hubStatePath(rootDir), { force: true });
  } catch {
    // ignore
  }
  return true;
}

async function readRegistrySnapshotAtRoot(rootDir: string): Promise<any> {
  try {
    const raw = readRegistryJsonFromSqlitePath(path.join(rootDir, 'hub.sqlite')) ?? (await fs.readFile(path.join(rootDir, 'registry.json'), 'utf8'));
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function deleteProfileResources(profileName: string): Promise<{
  removedContainers: string[];
  removedHostRoots: string[];
  stoppedHub: boolean;
}> {
  const droneDirForProfile = profileDroneRootDir(profileName);
  const reg = await readRegistrySnapshotAtRoot(droneDirForProfile);
  const removedContainers: string[] = [];
  const removedHostRoots: string[] = [];
  const failures: string[] = [];
  const stoppedHub = await stopHubAtRootIfRunning(droneDirForProfile);
  const drones = reg?.drones && typeof reg.drones === 'object' && !Array.isArray(reg.drones) ? Object.values(reg.drones) : [];

  for (const droneAny of drones) {
    const drone = droneAny as any;
    const runtime = normalizeDroneRuntime(drone?.runtime);
    if (runtime === 'host') {
      const hostPid = Number(drone?.host?.pid);
      const hostRootDir = String(drone?.host?.rootDir ?? '').trim();
      try {
        if (Number.isFinite(hostPid) && hostPid > 0) {
          await stopHostDaemonByPid(hostPid);
        }
        if (hostRootDir) {
          await fs.rm(hostRootDir, { recursive: true, force: true });
          removedHostRoots.push(hostRootDir);
        }
      } catch (error: any) {
        failures.push(`host runtime ${String(drone?.name ?? drone?.id ?? '(unknown)')}: ${error?.message ?? String(error)}`);
      }
      continue;
    }

    const containerName = String(drone?.containerName ?? drone?.name ?? '').trim();
    if (!containerName) continue;
    try {
      await dvmRemove(containerName, { keepVolume: false });
      removedContainers.push(containerName);
    } catch (error: any) {
      failures.push(`container ${containerName}: ${error?.message ?? String(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`failed deleting profile resources:\n- ${failures.join('\n- ')}`);
  }

  return { removedContainers, removedHostRoots, stoppedHub };
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
  const runtimeDir = resolveDroneDaemonRuntimeDir();
  for (const fileName of ['daemon.js', 'blip.js', 'mcp-http-stdio-bridge.js']) {
    const filePath = path.join(runtimeDir, fileName);
    try {
      await fs.stat(filePath);
    } catch {
      const repoRoot = path.resolve(__dirname, '..', '..', '..');
      throw new Error(`Missing ${filePath}. Run: cd ${repoRoot}/apps/drone && bun run build`);
    }
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

function resolveDroneDaemonRuntimeDir(): string {
  return path.dirname(resolveDroneDaemonJsPath());
}

async function resolveHostPort(container: string, containerPort: number): Promise<number> {
  const ports = await dvmPorts(container);
  const match = ports.find((p) => p.containerPort === containerPort);
  if (!match) throw new Error(`No host port mapped for ${container}:${containerPort} (run: dvm ports ${container})`);
  return match.hostPort;
}

function normalizeHostPort(raw: unknown): number {
  const hostPort = Number(raw);
  if (!Number.isFinite(hostPort) || hostPort <= 0) throw new Error('missing host runtime daemon port');
  return Math.floor(hostPort);
}

async function stopHostDaemonByPid(pidRaw: unknown): Promise<void> {
  const pid = Number(pidRaw);
  if (!Number.isFinite(pid) || pid <= 0) return;
  const targetPid = Math.floor(pid);
  const isRunning = () => {
    try {
      process.kill(targetPid, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (!isRunning()) return;
  try {
    process.kill(targetPid, 'SIGTERM');
  } catch {
    return;
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isRunning()) return;
    // eslint-disable-next-line no-await-in-loop
    await sleep(100);
  }
  try {
    process.kill(targetPid, 'SIGKILL');
  } catch {
    // ignore
  }
}

async function removeHostRuntimeRootBestEffort(droneIdRaw: unknown): Promise<void> {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return;
  try {
    await fs.rm(hostDroneRootPath(droneId), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function launchHostDroneDaemon(opts: {
  droneId: string;
  hostPort: number;
  token: string;
}): Promise<number> {
  const daemonPath = resolveDroneDaemonJsPath();
  const daemonDataDir = hostDroneDaemonDataPath(opts.droneId);
  const tokenPath = hostDroneDaemonTokenPath(opts.droneId);
  const logPath = hostDroneDaemonLogPath(opts.droneId);
  await fs.mkdir(daemonDataDir, { recursive: true });
  await fs.writeFile(tokenPath, opts.token, 'utf8');
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(tokenPath, 0o600);
    } catch {
      // ignore
    }
  }
  const log = await fs.open(logPath, 'a');
  let child: ReturnType<typeof spawn> | null = null;
  try {
    child = spawn(
      process.execPath,
      [daemonPath, '--host', '127.0.0.1', '--port', String(opts.hostPort), '--data-dir', daemonDataDir, '--token-file', tokenPath],
      { detached: true, stdio: ['ignore', log.fd, log.fd], env: process.env }
    );
    child.unref();
  } finally {
    await log.close();
  }
  if (!child?.pid || !Number.isFinite(child.pid)) {
    throw new Error('failed to launch host daemon process');
  }
  return Math.floor(child.pid);
}

function makeClient(hostPort: number, token: string) {
  return { baseUrl: `http://127.0.0.1:${hostPort}`, token };
}

async function ensureContainerDroneReady(drone: DroneRegistryEntry, hostPort: number, token: string): Promise<void> {
  const containerName = String((drone as any)?.containerName ?? (drone as any)?.name ?? '').trim();
  const containerPort = Number((drone as any)?.containerPort ?? NaN);
  if (!containerName || !Number.isFinite(containerPort) || containerPort <= 0 || !token) return;

  const client = makeClient(hostPort, token);
  try {
    await health(client);
    return;
  } catch {
    // Best-effort self-heal when the container came back but the daemon tmux session did not.
  }

  await ensureContainerDroneDaemonSession({ containerName, containerPort: Math.floor(containerPort) });
  await waitForHealth(hostPort, token);
}

async function hostCommandExists(command: string): Promise<boolean> {
  const name = String(command ?? '').trim();
  if (!name) return false;
  return await new Promise<boolean>((resolve) => {
    const child = spawn('bash', ['-lc', `command -v ${bashQuote(name)} >/dev/null 2>&1`], { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

type DroneRegistryEntry = Awaited<ReturnType<typeof loadRegistry>>['drones'][string];
type DroneClient = ReturnType<typeof makeClient>;

async function withDroneClient<T>(
  name: string,
  fn: (ctx: { drone: DroneRegistryEntry; hostPort: number; client: DroneClient }) => Promise<T>
): Promise<T> {
  const reg = await loadRegistry();
  const { drone, containerName, runtime } = resolveDroneFromRegistry(reg, name);
  const hostPort =
    runtime === 'host'
      ? normalizeHostPort((drone as any)?.hostPort)
      : await resolveHostPort(containerName, Number((drone as any)?.containerPort ?? 7777));
  if (runtime === 'container') {
    await ensureContainerDroneReady(drone as any, hostPort, String((drone as any)?.token ?? ''));
  }
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
    'test -f /dvm-data/drone/token -a \\( -f /dvm-data/drone/dist/daemon.js -o -f /dvm-data/drone/daemon.js \\) && echo yes || echo no',
  ]);
  return String(r.stdout ?? '').trim().split('\n').pop() === 'yes';
}

function jsonOutputRequested(localOptions?: { json?: boolean }): boolean {
  return Boolean(localOptions?.json || program.opts().json);
}

function printCommandOutput(value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(jsonOutputRequested() ? JSON.stringify(value, null, 2) : formatHumanOutput(value));
}

const program = new Command();
program
  .name('drone')
  .description('Manage drone daemons (container or host runtime)')
  .option('--json', 'Print machine-readable JSON', false);

const createCommand = addCreateOptions(
  program
    .command('create')
    .argument('<name>', 'Drone display name (dash-case; used for CLI/UI lookups)')
);

createCommand
  .option('--no-build', 'Skip checking daemon build output')
  .action(async (name, options) => {
    const { repoPath, group, containerPort, runtime, cwd, mkdir, droneId, cloneContainer, persistVolume } = parseCreateOptions(options);

    if (options.build) await ensureDaemonBuilt(repoPath);

    const token = crypto.randomBytes(32).toString('base64url');
    const stableId = droneId ?? crypto.randomUUID();
    const displayName = normalizeDroneDisplayName(name);

    if (runtime === 'host') {
      if (cloneContainer) throw new Error('--clone-container is only supported for container runtime');
      if (!(await hostCommandExists('tmux'))) {
        throw new Error(missingHostDependencyMessage('tmux', 'host runtime drones'));
      }
      const hostPort = await getFreeTcpPort();
      const hostPid = await launchHostDroneDaemon({ droneId: stableId, hostPort, token });
      const workspaceDir = hostDroneWorkspacePath(stableId);
      const defaultCwd = repoPath ? repoPath : workspaceDir;
      const effectiveCwd = cwd || defaultCwd;
      if (!repoPath) {
        await fs.mkdir(workspaceDir, { recursive: true });
      }
      if (effectiveCwd) {
        if (mkdir) {
          await fs.mkdir(effectiveCwd, { recursive: true });
        } else {
          const st = await fs.stat(effectiveCwd).catch(() => null);
          if (!st || !st.isDirectory()) {
            await stopHostDaemonByPid(hostPid);
            throw new Error(`cwd does not exist: ${effectiveCwd} (pass --mkdir to create)`);
          }
        }
      }
      try {
        await waitForHealth(hostPort, token);
      } catch (error) {
        await stopHostDaemonByPid(hostPid);
        throw error;
      }

      try {
        if (group) await ensureCanonicalGroup(group);
        const registry = await loadRegistry();
        if (registryHasDisplayName(registry, displayName, { excludeId: stableId })) throw new Error(`drone already exists: ${displayName}`);
        const at = new Date().toISOString();
        const createdEntry = {
            id: stableId,
            runtime: 'host',
            name: displayName,
            containerName: stableContainerNameFromDroneId(stableId),
            group,
            cwd: effectiveCwd,
            hostPort,
            containerPort: hostPort,
            token,
            repoPath,
            ...(repoPath ? { repo: { dest: repoPath } } : {}),
            createdAt: at,
            host: {
              pid: hostPid,
              workspaceDir,
              rootDir: hostDroneRootPath(stableId),
              dataDir: hostDroneDaemonDataPath(stableId),
              tokenPath: hostDroneDaemonTokenPath(stableId),
            },
          } as any;
        await persistRealDroneEntry(stableId, createdEntry);
      } catch (error) {
        await stopHostDaemonByPid(hostPid);
        throw error;
      }

      printCommandOutput({
        ok: true,
        id: stableId,
        runtime: 'host',
        name: displayName,
        hostPort,
        daemonPid: hostPid,
        ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
      });
      return;
    }

    const containerName = stableContainerNameFromDroneId(stableId);

    let hostPort = 0;
    if (cloneContainer) {
      const cloneAttempts = 5;
      for (let attempt = 1; attempt <= cloneAttempts; attempt++) {
        try {
          const [hostPortDaemon, hostPortRdp, hostPortNoVnc, hostPort3000, hostPort3001, hostPort5173, hostPort5174] =
            await getUniqueFreeTcpPorts(7);
          await dvmClone(cloneContainer, containerName, {
            start: true,
            copyPersistenceVolume: true,
            ...(typeof persistVolume === 'boolean' ? { persistVolume } : {}),
            ports: [
              { hostPort: hostPortDaemon, containerPort, hostIp: '127.0.0.1' },
              { hostPort: hostPortRdp, containerPort: 3389 },
              { hostPort: hostPortNoVnc, containerPort: 6080 },
              { hostPort: hostPort3000, containerPort: 3000 },
              { hostPort: hostPort3001, containerPort: 3001 },
              { hostPort: hostPort5173, containerPort: 5173 },
              { hostPort: hostPort5174, containerPort: 5174 },
            ],
          });
          hostPort = await resolveHostPort(containerName, containerPort);
          break;
        } catch (err) {
          if (!isPortAllocationConflictError(err) || attempt === cloneAttempts) throw err;
          try {
            await dvmRemove(containerName);
          } catch {
            // ignore best-effort cleanup between retries
          }
          await sleep(125 * attempt);
        }
      }
    } else {
      const createAttempts = 5;
      for (let attempt = 1; attempt <= createAttempts; attempt++) {
        try {
          // Pick truly free host ports (dvm's auto-allocation only checks Docker ports, not host processes).
          const [hostPortDaemon, hostPortRdp, hostPortNoVnc, hostPort3000, hostPort3001, hostPort5173, hostPort5174] =
            await getUniqueFreeTcpPorts(7);
          await dvmCreate(containerName, {
            ...(persistVolume === false ? { persist: false } : {}),
            ports: [
              { hostPort: hostPortDaemon, containerPort, hostIp: '127.0.0.1' },
              { hostPort: hostPortRdp, containerPort: 3389 },
              { hostPort: hostPortNoVnc, containerPort: 6080 },
              { hostPort: hostPort3000, containerPort: 3000 },
              { hostPort: hostPort3001, containerPort: 3001 },
              { hostPort: hostPort5173, containerPort: 5173 },
              { hostPort: hostPort5174, containerPort: 5174 },
            ],
          });
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

    // Copy the built daemon runtime tree so relative requires continue to work in-container.
    const clearDaemonRuntime = await dvmExec(containerName, 'bash', ['-lc', 'mkdir -p /dvm-data/drone && rm -rf /dvm-data/drone/dist']);
    if (clearDaemonRuntime.code !== 0) {
      throw new Error(clearDaemonRuntime.stderr || clearDaemonRuntime.stdout || 'failed clearing daemon runtime in container');
    }
    await dvmCopyToContainer(containerName, resolveDroneDaemonRuntimeDir(), '/dvm-data/drone/dist', { clean: false });
    const removeRetiredClis = await dvmExec(containerName, 'bash', ['-lc', removeRetiredContainerCliScripts()]);
    if (removeRetiredClis.code !== 0) {
      throw new Error(removeRetiredClis.stderr || removeRetiredClis.stdout || 'failed removing retired CLIs from container');
    }
    const installBlipCli = await dvmExec(containerName, 'bash', ['-lc', installBlipCliScript()]);
    if (installBlipCli.code !== 0) {
      throw new Error(installBlipCli.stderr || installBlipCli.stdout || 'failed installing blip CLI in container');
    }

    await dvmSessionStart(
      containerName,
      DRONE_DAEMON_SESSION_NAME,
      'bash',
      ['-lc', buildContainerDroneDaemonLaunchScript(containerPort)],
      true
    );

    await waitForHealth(hostPort, token);

    if (group) await ensureCanonicalGroup(group);
    const registry = await loadRegistry();
    if (registryHasDisplayName(registry, displayName, { excludeId: stableId })) throw new Error(`drone already exists: ${displayName}`);
    const at = new Date().toISOString();
    const createdEntry = {
        id: stableId,
        runtime: 'container' as const,
        name: displayName,
        containerName,
        group,
        cwd,
        hostPort,
        containerPort,
        token,
        repoPath,
        ...(persistVolume === false ? { persistVolume: false } : {}),
        createdAt: at,
      };
    await persistRealDroneEntry(stableId, createdEntry);

    printCommandOutput({ ok: true, id: stableId, runtime: 'container', name: displayName, containerName, hostPort, containerPort, ...(cwd ? { cwd } : {}) });
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
    const { repoPath, group, containerPort, runtime, cwd, mkdir, droneId, persistVolume } = parseCreateOptions(options);
    if (runtime !== 'container') {
      throw new Error('drone import currently supports only container runtime');
    }

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

    if (group) await ensureCanonicalGroup(group);
    const registry = await loadRegistry();
    // Enforce unique display names (unless this is updating the same id).
    for (const [k, v] of Object.entries((registry as any)?.drones ?? {})) {
        if (String((v as any)?.name ?? '').trim() === displayName && String(k) !== String(stableId)) {
          throw new Error(`drone already exists: ${displayName}`);
        }
    }
    const at = new Date().toISOString();
    const importedEntry = {
        id: stableId,
        runtime: 'container' as const,
        name: displayName,
        containerName,
        group,
        cwd,
        hostPort,
        containerPort,
        token,
        repoPath,
        ...(persistVolume === false ? { persistVolume: false } : {}),
        createdAt: at,
      };
    await persistRealDroneEntry(stableId, importedEntry);

    printCommandOutput({ ok: true, id: stableId, runtime: 'container', name: displayName, containerName, hostPort, containerPort, ...(cwd ? { cwd } : {}) });
  });

program
  .command('rm')
  .alias('remove')
  .description('Remove a drone and clean up runtime resources')
  .argument('<name>', 'Drone display name')
  .option('--keep-volume', 'Keep runtime persistence data (container volume or host runtime dir)', false)
  .option('--forget', 'Remove from registry even if container removal fails', true)
  .action(async (name, options) => {
    const regSnap = await loadRegistry();
    const nameStr = String(name ?? '').trim();
    let runtime: DroneRuntime = 'container';
    let containerName = nameStr;
    let resolvedKey: string | null = null;
    let resolvedDrone: any = null;
    try {
      const resolved = resolveDroneFromRegistry(regSnap, nameStr);
      resolvedKey = resolved.key;
      resolvedDrone = resolved.drone;
      runtime = resolved.runtime;
      containerName = resolved.containerName;
    } catch {
      // Not in registry; treat as raw container name.
      containerName = nameStr;
    }
    const hadEntry = Boolean(resolvedKey);

    let removeErr: string | null = null;
    if (runtime === 'host' && resolvedDrone) {
      try {
        await stopHostDaemonByPid((resolvedDrone as any)?.host?.pid);
      } catch (err: any) {
        removeErr = err?.message ?? String(err);
      }
      if (!Boolean(options.keepVolume) && resolvedKey) {
        await removeHostRuntimeRootBestEffort(resolvedKey);
      }
    } else {
      try {
        await dvmRemove(containerName, { keepVolume: Boolean(options.keepVolume) });
      } catch (err: any) {
        removeErr = err?.message ?? String(err);
      }
    }

    let removedRegistry = false;
    if (options.forget) {
      const removed = resolvedKey
        ? await permanentlyDeleteCanonicalDrone({ droneId: resolvedKey, lifecycleState: 'real' })
        : null;
      removedRegistry = Boolean(removed?.removedLifecycle);
    }

    if (removeErr) throw new Error(removeErr);

    printCommandOutput({
      ok: true,
      id: resolvedKey,
      name: nameStr,
      runtime,
      containerName: runtime === 'container' ? containerName : null,
      removedRegistry: removedRegistry || hadEntry,
    });
  });

program
  .command('rename')
  .description('Rename a drone display name (container name stays stable)')
  .argument('<oldName>', 'Existing drone name (display name)')
  .argument('<newName>', 'New drone name (display name)')
  .action(async (oldNameRaw, newNameRaw) => {
    const oldName = normalizeDroneDisplayName(oldNameRaw);
    const newName = normalizeDroneDisplayName(newNameRaw);
    if (oldName === newName) {
      printCommandOutput({ ok: true, oldName, newName, renamed: false, reason: 'same-name' });
      return;
    }

    const reg = await loadRegistry();
    const { key: oldKey, drone: oldEntry, containerName } = resolveDroneFromRegistry(reg, oldName);
    for (const [k, v] of Object.entries((reg as any)?.drones ?? {})) {
      if (String((v as any)?.name ?? '').trim() === newName && String(k) !== String(oldKey)) {
        throw new Error(`drone already exists: ${newName}`);
      }
    }

    await renameDroneDisplayName({ droneId: oldKey, state: 'real', name: newName });

    printCommandOutput({
      ok: true,
      id: oldKey,
      oldName,
      newName,
      containerName,
      hostPort: (oldEntry as any)?.hostPort ?? null,
      containerPort: Number((oldEntry as any)?.containerPort ?? 7777),
    });
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
      printCommandOutput({ ok: true, removed: 0, targets: [] });
      return;
    }

    if (!options.apply) {
      printCommandOutput({
        ok: true,
        dryRun: true,
        targets,
        note: 'Run again with --apply to actually delete these drones/containers.',
      });
      return;
    }

    const errors: Array<{ name: string; error: string }> = [];
    const lifecycleIdsByContainer = new Map<string, string[]>();
    for (const [key, drone] of Object.entries((reg as any)?.drones ?? {})) {
      const container = String((drone as any)?.containerName ?? (drone as any)?.name ?? key).trim();
      if (!container) continue;
      const ids = lifecycleIdsByContainer.get(container) ?? [];
      ids.push(String((drone as any)?.id ?? key).trim() || String(key));
      lifecycleIdsByContainer.set(container, ids);
    }
    for (const t of targets) {
      try {
        await dvmRemove(t, { keepVolume: Boolean(options.keepVolume) });
      } catch (err: any) {
        errors.push({ name: t, error: err?.message ?? String(err) });
      }
      for (const droneId of lifecycleIdsByContainer.get(t) ?? []) {
        // eslint-disable-next-line no-await-in-loop
        await permanentlyDeleteCanonicalDrone({ droneId, lifecycleState: 'real' });
      }
    }

    printCommandOutput({ ok: errors.length === 0, removed: targets.length - errors.length, errors });
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
      const runtime = normalizeDroneRuntime((d as any)?.runtime);
      if (options.ungrouped) {
        if (g) continue;
      } else if (groupFilter) {
        if (g !== groupFilter) continue;
      }

      try {
        const containerName = String((d as any)?.containerName ?? (d as any)?.name ?? '').trim() || String((d as any)?.name ?? '');
        const hostPort =
          runtime === 'host'
            ? normalizeHostPort((d as any)?.hostPort)
            : await resolveHostPort(containerName, d.containerPort);
        if (runtime === 'container') {
          await ensureContainerDroneReady(d as any, hostPort, String((d as any)?.token ?? ''));
        }
        const s = await status(makeClient(hostPort, d.token));
        out.push({
          name: d.name,
          runtime,
          containerName: runtime === 'container' ? containerName : null,
          group: d.group ?? null,
          hostPort,
          containerPort: d.containerPort,
          ok: true,
          status: s,
        });
      } catch (err: any) {
        out.push({ name: d.name, runtime, group: d.group ?? null, ok: false, error: err?.message ?? String(err) });
      }
    }
    printCommandOutput(out);
  });

program
  .command('groups')
  .description('List existing drone groups (host-side metadata)')
  .action(async () => {
    const reg = await loadRegistry();
    const byGroup = new Map<string, string[]>();
    for (const entry of await listCanonicalGroups()) {
      const name = String(entry.name ?? '').trim();
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

    printCommandOutput({
      ok: true,
      groups,
      ungrouped,
      totalDrones: Object.keys(reg.drones).length,
    });
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

    await ensureCanonicalGroup(group);
    const reg = await loadRegistry();
    const { key, drone } = resolveDroneFromRegistry(reg as any, String(name));
    const prev = String(drone.group ?? '').trim() || null;
    await setDroneGroupMetadata({ droneId: key, state: 'real', group });

    printCommandOutput({ ok: true, name: String(name), previousGroup: prev, group });
  });

program
  .command('group-clear')
  .alias('ungroup')
  .description('Clear a drone group assignment')
  .argument('<name>', 'Drone display name')
  .action(async (name) => {
    const reg = await loadRegistry();
    const { key, drone } = resolveDroneFromRegistry(reg as any, String(name));
    const prev = String(drone.group ?? '').trim() || null;
    await setDroneGroupMetadata({ droneId: key, state: 'real', group: null });

    printCommandOutput({ ok: true, name: String(name), previousGroup: prev, group: null });
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

    await registerCanonicalRepository({
        path: repoRoot,
        addedAt,
        ...(remoteUrl ? { remoteUrl } : {}),
        ...(github ? { github } : {}),
    });

    const repos = (await listCanonicalRepositories())
      .map((r: any) => ({
        path: typeof r?.path === 'string' ? String(r.path) : '',
        addedAt: typeof r?.addedAt === 'string' ? String(r.addedAt) : null,
        remoteUrl: typeof r?.remoteUrl === 'string' ? String(r.remoteUrl) : null,
        github: r?.github ?? null,
      }))
      .filter((r: any) => r.path)
      .sort((a: any, b: any) => String(a.path).localeCompare(String(b.path)));

    printCommandOutput({ ok: true, added: repoRoot, repos });
  });

async function cleanupLegacyRemoteHubForCli(): Promise<void> {
  const result = await cleanupLegacyRemoteHub(droneRootPath(), {
    warn: (message) => {
      // eslint-disable-next-line no-console
      console.warn(message);
    },
  });
  if (result.stoppedPids.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`Stopped legacy RemoteHub processes: ${result.stoppedPids.join(', ')}`);
  }
}

async function hubRun(options: any) {
  const uiPortRaw = Number(options.port);
  const uiPort = uiPortRaw === 0 ? await getFreeTcpPort() : uiPortRaw;
  if (!Number.isFinite(uiPort) || uiPort <= 0) throw new Error('invalid --port');
  const uiMode = normalizeDroneHubUiMode(options.uiMode);

  const apiPortRaw = Number(options.apiPort);
  const apiPort = apiPortRaw === 0 ? await getFreeTcpPort() : apiPortRaw;
  if (!Number.isFinite(apiPort) || apiPort <= 0) throw new Error('invalid --api-port');

  const apiHost = String(options.host || DEFAULT_HUB_API_HOST);
  const containerMcpHost = resolveContainerMcpHost(options);
  const containerMcpPort = resolveContainerMcpPort(options);
  const containerMcpUrl = resolveContainerMcpUrl(options);
  await ensureDefaultProfileForFirstRun();
  await ensureHubSetupState();
  await cleanupLegacyRemoteHubForCli();
  const activeProfile = readActiveProfileNameSync();
  const apiToken = await ensureHubApiToken();
  const mcpToken = await ensureHubMcpToken();
  const allowedOrigins = new Set<string>([`http://127.0.0.1:${uiPort}`, `http://localhost:${uiPort}`]);
  if (apiHost && apiHost !== '0.0.0.0' && apiHost !== '::') {
    allowedOrigins.add(`http://${apiHost}:${uiPort}`);
  }
  const repoRoot = resolveRepoRootFromDroneCliDir();
  let shuttingDown = false;
  let waitForStopResolve: (() => void) | null = null;
  let shutdownStarted = false;
  let staticUiServer: StaticDroneHubUiServer | null = null;

  const api = await startDroneHubApiServer({
    port: apiPort,
    host: apiHost,
    containerMcpHost,
    containerMcpPort,
    containerMcpUrl,
    apiToken,
    deviceMeshIngressPort: DEFAULT_DEVICE_MESH_INGRESS_PORT,
    mcpToken,
    allowedOrigins: Array.from(allowedOrigins),
  });

  await writeHubState({
    version: 1,
    pid: process.pid,
    apiHost: api.host,
    apiPort: api.port,
    uiPort,
    containerMcp: api.containerMcp,
    startedAt: new Date().toISOString(),
    logPath: hubLogPath(),
    launchEnv: captureHubLaunchEnvSnapshot(),
  });
  await writeHubApiToken(apiToken);
  await writeHubMcpToken(mcpToken);

  const hubDir = path.join(repoRoot, 'apps', 'drone-hub');
  const staticUiDir = resolveDroneHubStaticUiDir(repoRoot, options.staticUiDir);
  let uiPortAvailable = await isTcpPortAvailable('127.0.0.1', uiPort);
  if (!uiPortAvailable) {
    const recoveredUiPids = await findRecoverableHubUiServerPids(uiPort);
    if (recoveredUiPids.length > 0) {
      for (const pid of recoveredUiPids) {
        await stopHubProcess(pid);
      }
      uiPortAvailable = await isTcpPortAvailable('127.0.0.1', uiPort);
    }
  }
  const child = uiMode === 'dev' && uiPortAvailable
    ? spawn('bun', ['run', 'dev', '--', '--port', String(uiPort), '--strictPort'], {
        cwd: hubDir,
        stdio: 'inherit',
        env: {
          ...process.env,
          DRONE_HUB_API_PORT: String(api.port),
          DRONE_HUB_API_TOKEN: apiToken,
          // Keep short API fetches off the Vite origin used by long-lived SSE
          // streams. Otherwise HTTP/1.1 browser connection limits can queue
          // unrelated Hub requests behind EventSource connections.
          VITE_DRONE_HUB_DIRECT_API_BASE: `http://127.0.0.1:${api.port}`,
          VITE_DRONE_HUB_DIRECT_API_TOKEN: apiToken,
          ...(activeProfile ? { VITE_DRONE_PROFILE_ID: activeProfile } : {}),
        },
      })
    : null;
  if (uiMode === 'static') {
    if (!uiPortAvailable) {
      throw new Error(`Drone Hub UI port ${uiPort} is already in use`);
    }
    staticUiServer = await startStaticDroneHubUiServer({
      port: uiPort,
      staticDir: staticUiDir,
      apiHost: api.host,
      apiPort: api.port,
      apiToken,
    });
  } else if (!uiPortAvailable) {
    // eslint-disable-next-line no-console
    console.warn(`Drone Hub UI port ${uiPort} is already in use; leaving the existing UI server running.`);
  }

  const shutdown = async () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    shuttingDown = true;
    try {
      child?.kill('SIGINT');
    } catch {
      // ignore
    }
    try {
      await staticUiServer?.close();
    } catch {
      // ignore
    }
    try {
      await api.close();
    } catch {
      // ignore
    }
    await removeHubStateIfOwnedByPid(process.pid);
    waitForStopResolve?.();
  };

  process.once('SIGINT', async () => {
    await shutdown();
  });
  process.once('SIGTERM', async () => {
    await shutdown();
  });

  // eslint-disable-next-line no-console
  console.log(`Drone Hub API: http://${api.host}:${api.port}`);
  if (api.containerMcp) {
    // eslint-disable-next-line no-console
    console.log(`Container MCP: ${api.containerMcp.url} (listening on ${api.containerMcp.host}:${api.containerMcp.port})`);
  }
  // eslint-disable-next-line no-console
  console.log(`Drone Hub UI:  http://127.0.0.1:${uiPort}`);
  if (options.readyJson) {
    // eslint-disable-next-line no-console
    console.log(
      `DRONE_HUB_READY ${JSON.stringify({
        ok: true,
        apiUrl: `http://${api.host}:${api.port}`,
        uiUrl: `http://127.0.0.1:${uiPort}`,
        uiMode,
        staticUiDir: uiMode === 'static' ? staticUiDir : null,
        ...(api.containerMcp ? { containerMcpUrl: api.containerMcp.url } : {}),
      })}`,
    );
  }

  await new Promise<void>((resolve, reject) => {
    waitForStopResolve = resolve;
    child?.once('error', reject);
    child?.once('exit', () => resolve());
  });
  await shutdown();
}

async function hubStart(options: any) {
  const uiPort = Number(options.port ?? 5174);
  if (!Number.isFinite(uiPort) || uiPort < 0) throw new Error('invalid --port');
  const uiMode = normalizeDroneHubUiMode(options.uiMode);
  const staticUiDir = String(options.staticUiDir ?? '').trim();
  const apiPortRaw = Number(options.apiPort ?? 0);
  if (!Number.isFinite(apiPortRaw) || apiPortRaw < 0) throw new Error('invalid --api-port');
  const apiHost = String(options.host || DEFAULT_HUB_API_HOST);
  const containerMcpHost = resolveContainerMcpHost(options);
  const containerMcpPort = resolveContainerMcpPort(options);
  const containerMcpUrl = resolveContainerMcpUrl(options);
  const containerMcpProjectedUrl = resolveContainerMcpProjectedUrl(containerMcpPort, containerMcpUrl);
  await cleanupLegacyRemoteHubForCli();

  const cur = await readHubState();
  if (cur && pidIsRunning(cur.pid)) {
    const currentLaunchEnv = captureHubLaunchEnvSnapshot();
    const launchEnvChanged = hubLaunchEnvSnapshotsDiffer(cur.launchEnv, currentLaunchEnv);
    const runningApiHost = String(cur.apiHost ?? '').trim();
    const runningApiPort = Number(cur.apiPort);
    const runningContainerMcpHost = String(cur.containerMcp?.host ?? '').trim();
    const runningContainerMcpPort = Number(cur.containerMcp?.port);
    const runningContainerMcpUrl = String(cur.containerMcp?.url ?? '').trim();
    const restartReasons: string[] = [];
    if (runningApiHost && runningApiHost !== apiHost) {
      restartReasons.push(`Hub API is bound to ${runningApiHost}; requested ${apiHost}.`);
    }
    if (Number.isFinite(runningApiPort) && runningApiPort > 0 && apiPortRaw > 0 && runningApiPort !== apiPortRaw) {
      restartReasons.push(`Hub API is listening on port ${runningApiPort}; requested ${apiPortRaw}.`);
    }
    if (Number.isFinite(Number(cur.uiPort)) && Number(cur.uiPort) > 0 && uiPort > 0 && Number(cur.uiPort) !== uiPort) {
      restartReasons.push(`Hub UI is listening on port ${cur.uiPort}; requested ${uiPort}.`);
    }
    if (!cur.containerMcp && containerMcpHost && containerMcpPort > 0) {
      restartReasons.push('Container MCP listener is not running.');
    }
    if (runningContainerMcpHost && runningContainerMcpHost !== containerMcpHost) {
      restartReasons.push(`Container MCP is bound to ${runningContainerMcpHost}; requested ${containerMcpHost}.`);
    }
    if (Number.isFinite(runningContainerMcpPort) && runningContainerMcpPort > 0 && runningContainerMcpPort !== containerMcpPort) {
      restartReasons.push(`Container MCP is listening on port ${runningContainerMcpPort}; requested ${containerMcpPort}.`);
    }
    if (runningContainerMcpUrl && runningContainerMcpUrl !== containerMcpProjectedUrl) {
      restartReasons.push(`Container MCP URL is ${runningContainerMcpUrl}; requested ${containerMcpProjectedUrl}.`);
    }
    if (launchEnvChanged) {
      restartReasons.push(
        'The hub is already running with a different LLM environment snapshot. Restart it to pick up the current OPENAI_API_KEY/GEMINI_API_KEY/DRONE_HUB_LLM_PROVIDER values.'
      );
    }
    const output = {
      ok: true,
      alreadyRunning: true,
      state: cur,
      ...(restartReasons.length > 0
        ? {
            restartRecommended: true,
            reason: restartReasons.join(' '),
            ...(launchEnvChanged ? { runningLaunchEnv: cur.launchEnv, currentLaunchEnv } : {}),
          }
        : {}),
    };
    // eslint-disable-next-line no-console
    console.log(jsonOutputRequested(options)
      ? JSON.stringify(output, null, 2)
      : formatHubStartOutput({
          pid: cur.pid,
          alreadyRunning: true,
          apiUrl: `http://${cur.apiHost}:${cur.apiPort}`,
          uiUrl: `http://127.0.0.1:${cur.uiPort}`,
          ...(cur.containerMcp ? { containerMcpUrl: cur.containerMcp.url } : {}),
          logPath: cur.logPath,
          ...(restartReasons.length > 0 ? { restartReason: restartReasons.join(' ') } : {}),
        }));
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
    const launch = resolveDetachedCliLaunchSpec({ cliFilename: __filename });
    const child = spawn(
      launch.command,
      [
        ...launch.args,
        'hub',
        'run',
        '--port',
        String(uiPort),
        '--api-port',
        String(apiPortRaw),
        '--host',
        apiHost,
        '--ui-mode',
        uiMode,
        ...(staticUiDir ? ['--static-ui-dir', staticUiDir] : []),
        '--container-mcp-host',
        containerMcpHost,
        '--container-mcp-port',
        String(containerMcpPort),
        ...(containerMcpUrl ? ['--container-mcp-url', containerMcpUrl] : []),
      ],
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

    const output = {
      ok: true,
      pid: child.pid,
      ...(state
        ? {
            apiUrl: `http://${state.apiHost}:${state.apiPort}`,
            uiUrl: `http://127.0.0.1:${state.uiPort}`,
            ...(state.containerMcp ? { containerMcpUrl: state.containerMcp.url } : {}),
            logPath: state.logPath,
          }
        : { logPath }),
    };
    // eslint-disable-next-line no-console
    console.log(jsonOutputRequested(options) ? JSON.stringify(output, null, 2) : formatHubStartOutput(output));
  } finally {
    try {
      await logHandle.close();
    } catch {
      // ignore
    }
  }
}

async function hubStop(options: { json?: boolean } = {}) {
  await cleanupLegacyRemoteHubForCli();
  const cur = await readHubState();
  const fallbackUiPort = cur?.uiPort ?? 5174;
  if (!cur) {
    const recoveredPids = await findRecoverableHubRunnerPids(fallbackUiPort);
    if (recoveredPids.length > 0) {
      for (const pid of recoveredPids) {
        await stopHubProcess(pid);
      }
      try {
        await fs.rm(hubStatePath(), { force: true });
      } catch {
        // ignore
      }
      const output = { ok: true, stopped: true, recovered: true, pids: recoveredPids };
      // eslint-disable-next-line no-console
      console.log(jsonOutputRequested(options) ? JSON.stringify(output, null, 2) : formatHubStopOutput({ kind: 'recovered', pids: recoveredPids }));
      return;
    }
    const output = { ok: true, stopped: false, reason: 'not running' };
    // eslint-disable-next-line no-console
    console.log(jsonOutputRequested(options) ? JSON.stringify(output, null, 2) : formatHubStopOutput({ kind: 'not-running' }));
    return;
  }

  const pid = Number(cur.pid);
  if (!pidIsRunning(pid)) {
    try {
      await fs.rm(hubStatePath(), { force: true });
    } catch {
      // ignore
    }
    const recoveredPids = await findRecoverableHubRunnerPids(fallbackUiPort);
    if (recoveredPids.length > 0) {
      for (const recoveredPid of recoveredPids) {
        await stopHubProcess(recoveredPid);
      }
      const output = { ok: true, stopped: true, recovered: true, pids: recoveredPids };
      // eslint-disable-next-line no-console
      console.log(jsonOutputRequested(options) ? JSON.stringify(output, null, 2) : formatHubStopOutput({ kind: 'recovered', pids: recoveredPids }));
      return;
    }
    const output = { ok: true, stopped: false, reason: 'stale state file', previousPid: pid };
    // eslint-disable-next-line no-console
    console.log(jsonOutputRequested(options) ? JSON.stringify(output, null, 2) : formatHubStopOutput({ kind: 'stale', previousPid: pid }));
    return;
  }

  await stopHubProcess(pid);

  try {
    await fs.rm(hubStatePath(), { force: true });
  } catch {
    // ignore
  }

  const output = { ok: true, stopped: true, pid };
  // eslint-disable-next-line no-console
  console.log(jsonOutputRequested(options) ? JSON.stringify(output, null, 2) : formatHubStopOutput({ kind: 'stopped', pid }));
}

function resolveElectronCliPath(): string {
  try {
    return requireFromCli.resolve('electron/cli.js');
  } catch {
    throw new Error(
      'Electron is not installed. Install optional dependencies for the drone package, or run this from the repo after `bun install`.',
    );
  }
}

function resolveDroneHubElectronMainPath(): string {
  const repoRoot = resolveRepoRootFromDroneCliDir();
  const candidates = [
    path.join(__dirname, 'hub-electron-main.cjs'),
    path.join(repoRoot, 'apps', 'drone', 'desktop', 'hub-electron-main.cjs'),
  ];
  const found = candidates.find((candidate) => fsSync.existsSync(candidate));
  if (found) return found;
  throw new Error(`Drone Hub Electron main file was not found. Looked in: ${candidates.join(', ')}`);
}

async function hubApp(options: any) {
  const electronCli = resolveElectronCliPath();
  const electronMain = resolveDroneHubElectronMainPath();
  const uiPort = Number(options.port ?? 0);
  if (!Number.isFinite(uiPort) || uiPort < 0) throw new Error('invalid --port');
  const apiPort = Number(options.apiPort ?? 0);
  if (!Number.isFinite(apiPort) || apiPort < 0) throw new Error('invalid --api-port');
  const containerMcpUrl = resolveContainerMcpUrl(options);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [electronCli, electronMain], {
      stdio: 'inherit',
      env: {
        ...process.env,
        DRONE_HUB_CLI_PATH: __filename,
        DRONE_HUB_APP_PORT: String(uiPort),
        DRONE_HUB_APP_API_PORT: String(apiPort),
        DRONE_HUB_APP_HOST: String(options.host || DEFAULT_HUB_API_HOST),
        DRONE_HUB_APP_CONTAINER_MCP_HOST: resolveContainerMcpHost(options),
        DRONE_HUB_APP_CONTAINER_MCP_PORT: String(resolveContainerMcpPort(options)),
        ...(containerMcpUrl ? { DRONE_HUB_APP_CONTAINER_MCP_URL: containerMcpUrl } : {}),
        ...(options.staticUiDir ? { DRONE_HUB_STATIC_UI_DIR: path.resolve(String(options.staticUiDir)) } : {}),
      },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
        resolve();
        return;
      }
      reject(new Error(`Electron exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`));
    });
  });
}

async function profileListCommand() {
  printCommandOutput({ ok: true, ...(await listProfilesState()) });
}

async function profileCurrentCommand() {
  const activeProfile = (await readActiveProfileName()) ?? DEFAULT_PROFILE_NAME;
  printCommandOutput({
    ok: true,
    activeProfile,
    mode: 'profile',
    droneDataDir: activeProfile ? profileDroneRootDir(activeProfile) : defaultProfileDroneRootDir(),
    dvmDataDir: activeProfile ? profileDvmRootDir(activeProfile) : defaultProfileDvmRootDir(),
  });
}

async function profileCreateCommand(nameRaw: string, options: { use?: boolean }) {
  const result = await createManagedProfile(nameRaw, { use: options.use, stopCurrentHub: true });
  printCommandOutput({ ok: true, ...result });
}

async function profileUseCommand(nameRaw: string) {
  const result = await useManagedProfile(nameRaw, { stopCurrentHub: true });
  printCommandOutput({ ok: true, ...result });
}

async function profileDeleteCommand(nameRaw: string) {
  const result = await deleteManagedProfile(nameRaw);
  printCommandOutput({ ok: true, ...result });
}

const profile = program.command('profile').description('Manage repo-local Drone/DVM profiles');
profile.command('list').description('List available profiles').action(async () => {
  await profileListCommand();
});
profile.command('current').description('Show the active profile and resolved data roots').action(async () => {
  await profileCurrentCommand();
});
profile.command('create <name>')
  .description('Create a new profile')
  .option('--use', 'Switch to the new profile after creating it', false)
  .action(async (name, options) => {
    await profileCreateCommand(name, options);
  });
profile.command('use <name>')
  .description('Switch the active profile')
  .action(async (name) => {
    await profileUseCommand(name);
  });
profile.command('delete <name>')
  .description('Delete a profile and all of its containers/runtime state')
  .action(async (name) => {
    await profileDeleteCommand(name);
  });

const hub = program.command('hub').description('Manage the local Drone Hub (detached dev server)');
hub.command('start')
  .description('Start the hub in detached mode')
  .option('--json', 'Print machine-readable JSON', false)
  .option('--port <port>', 'UI port (Vite dev server or static UI server; pass 0 for auto in static mode)', '5174')
  .option('--ui-mode <mode>', 'UI mode: dev|static', 'dev')
  .option('--static-ui-dir <path>', 'Built drone-hub dist directory for --ui-mode static')
  .option('--api-port <port>', `Hub API port (${DEFAULT_HUB_API_PORT} by default; pass 0 for auto)`, String(DEFAULT_HUB_API_PORT))
  .option('--host <host>', 'Bind host for Hub API server', DEFAULT_HUB_API_HOST)
  .option('--container-mcp-host <host>', 'Bind host for container-reachable MCP-only server', DEFAULT_CONTAINER_MCP_HOST)
  .option('--container-mcp-port <port>', `Container MCP-only server port (${DEFAULT_CONTAINER_MCP_PORT} by default)`, String(DEFAULT_CONTAINER_MCP_PORT))
  .option('--container-mcp-url <url>', 'MCP URL projected into container agent configs')
  .action(async (options) => {
    await hubStart(options);
  });
hub.command('stop')
  .description('Stop the detached hub')
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (options) => {
    await hubStop(options);
  });
hub.command('restart')
  .description('Restart the detached hub')
  .option('--json', 'Print machine-readable JSON', false)
  .option('--port <port>', 'UI port (Vite dev server or static UI server; pass 0 for auto in static mode)', '5174')
  .option('--ui-mode <mode>', 'UI mode: dev|static', 'dev')
  .option('--static-ui-dir <path>', 'Built drone-hub dist directory for --ui-mode static')
  .option('--api-port <port>', `Hub API port (${DEFAULT_HUB_API_PORT} by default; pass 0 for auto)`, String(DEFAULT_HUB_API_PORT))
  .option('--host <host>', 'Bind host for Hub API server', DEFAULT_HUB_API_HOST)
  .option('--container-mcp-host <host>', 'Bind host for container-reachable MCP-only server', DEFAULT_CONTAINER_MCP_HOST)
  .option('--container-mcp-port <port>', `Container MCP-only server port (${DEFAULT_CONTAINER_MCP_PORT} by default)`, String(DEFAULT_CONTAINER_MCP_PORT))
  .option('--container-mcp-url <url>', 'MCP URL projected into container agent configs')
  .action(async (options) => {
    await hubStop(options);
    await hubStart(options);
  });
hub.command('run')
  .description('Run the hub in the current process (internal)')
  .option('--port <port>', 'UI port (Vite dev server or static UI server; pass 0 for auto in static mode)', '5174')
  .option('--ui-mode <mode>', 'UI mode: dev|static', 'dev')
  .option('--static-ui-dir <path>', 'Built drone-hub dist directory for --ui-mode static')
  .option('--api-port <port>', `Hub API port (${DEFAULT_HUB_API_PORT} by default; pass 0 for auto)`, String(DEFAULT_HUB_API_PORT))
  .option('--host <host>', 'Bind host for Hub API server', DEFAULT_HUB_API_HOST)
  .option('--container-mcp-host <host>', 'Bind host for container-reachable MCP-only server', DEFAULT_CONTAINER_MCP_HOST)
  .option('--container-mcp-port <port>', `Container MCP-only server port (${DEFAULT_CONTAINER_MCP_PORT} by default)`, String(DEFAULT_CONTAINER_MCP_PORT))
  .option('--container-mcp-url <url>', 'MCP URL projected into container agent configs')
  .option('--ready-json', 'Print a DRONE_HUB_READY JSON line after startup')
  .action(async (options) => {
    await hubRun(options);
  });
hub.command('app')
  .alias('electron')
  .description('Start Drone Hub as an Electron desktop app')
  .option('--port <port>', 'Local desktop UI port; pass 0 for auto', '0')
  .option('--static-ui-dir <path>', 'Built drone-hub dist directory')
  .option('--api-port <port>', `Hub API port (${DEFAULT_HUB_API_PORT} by default; pass 0 for auto)`, '0')
  .option('--host <host>', 'Bind host for Hub API server', DEFAULT_HUB_API_HOST)
  .option('--container-mcp-host <host>', 'Bind host for container-reachable MCP-only server', DEFAULT_CONTAINER_MCP_HOST)
  .option('--container-mcp-port <port>', `Container MCP-only server port (${DEFAULT_CONTAINER_MCP_PORT} by default)`, String(DEFAULT_CONTAINER_MCP_PORT))
  .option('--container-mcp-url <url>', 'MCP URL projected into container agent configs')
  .action(async (options) => {
    await hubApp(options);
  });
hub.action(async () => {
  // `drone hub` defaults to detached start.
  await hubStart({ port: 5174, apiPort: DEFAULT_HUB_API_PORT, host: DEFAULT_HUB_API_HOST });
});

program
  .command('status')
  .argument('<name>', 'Drone/container name')
  .action(async (name) => {
    await withDroneClient(name, async ({ drone, hostPort, client }) => {
      const s = await status(client);
      const runtime = normalizeDroneRuntime((drone as any)?.runtime);
      printCommandOutput({ name, runtime, hostPort, containerPort: drone.containerPort, status: s });
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

      printCommandOutput(resp);
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

      const doneMarkerPrefix = `DRONE_AGENT_DONE_${crypto.randomBytes(8).toString('hex')}:`;
      const modelArg = model ? ` --model ${bashQuote(model)}` : '';
      const script = [
        'set -uo pipefail',
        `agent${modelArg} --resume ${bashQuote(chatId)} -f --approve-mcps --print ${bashQuote(prompt)}`,
        'code=$?',
        `echo ${bashQuote(doneMarkerPrefix)}"$code"`,
        'exit "$code"',
      ].join('; ');

      const effectiveCwd = options.cwd ? String(options.cwd) : drone.cwd;
      const promptAt = new Date().toISOString();
      await procStart(client, {
        cmd: 'bash',
        args: ['-lc', script],
        cwd: effectiveCwd,
        session: options.session,
        force: !!options.force,
      });
      const captured = await followOutput({
        name,
        since: 0,
        until: doneMarkerPrefix,
        timeoutMs: Number(options.timeoutMs),
      });
      const parsed = parseDoneMarkerFromCapturedOutput(captured, doneMarkerPrefix);
      const ok = parsed.exitCode === 0;
      const completedAt = new Date().toISOString();
      await recordChatTurn({
        droneName: String(name),
        chatName,
        prompt,
        ok,
        output: parsed.output,
        ...(ok ? {} : { error: `agent exited with code ${parsed.exitCode ?? 'unknown'}` }),
        promptAt,
        completedAt,
      });
      if (!ok) throw new Error(`agent exited with code ${parsed.exitCode ?? 'unknown'}`);
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

      const doneMarkerPrefix = `DRONE_AGENT_ONCE_DONE_${crypto.randomBytes(8).toString('hex')}:`;
      const model = options.model ? String(options.model) : undefined;
      const modelArg = model ? ` --model ${bashQuote(model)}` : '';
      const script = [
        'set -uo pipefail',
        `agent${modelArg} -f --approve-mcps --print ${bashQuote(prompt)}`,
        'code=$?',
        `echo ${bashQuote(doneMarkerPrefix)}"$code"`,
        'exit "$code"',
      ].join('; ');

      const effectiveCwd = options.cwd ? String(options.cwd) : drone.cwd;
      await procStart(client, {
        cmd: 'bash',
        args: ['-lc', script],
        cwd: effectiveCwd,
        session: options.session,
        force: !!options.force,
      });

      const captured = await followOutput({
        name,
        since: 0,
        until: doneMarkerPrefix,
        timeoutMs: Number(options.timeoutMs),
      });
      const parsed = parseDoneMarkerFromCapturedOutput(captured, doneMarkerPrefix);
      if (parsed.exitCode !== 0) throw new Error(`agent-once exited with code ${parsed.exitCode ?? 'unknown'}`);
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
    const { drone: d } = resolveDroneFromRegistry(reg, String(name));

    const chats = d.chats ?? {};
    const chatOpt = options?.chat ? String(options.chat) : '';
    const turnOpt = options?.turn ? String(options.turn) : '';

    // Default: list chats (chatName -> {chatId, createdAt, ...})
    if (!chatOpt) {
      printCommandOutput({ ok: true, name: String(name), chats });
      return;
    }

    const chatName = chatOpt;
    const c = chats[chatName];
    if (!c) throw new Error(`unknown chat: ${chatName}`);
    const turns = c.turns ?? [];

    // If --turn omitted: show turn metadata.
    if (!turnOpt) {
      printCommandOutput({ ok: true, name: String(name), chat: chatName, chatId: c.chatId, turns });
      return;
    }

    // If --turn provided: print transcript(s) from stored turn output.
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
      process.stdout.write(`=== drone:${String(name)} chat:${chatName} turn:${i + 1}/${turns.length} at:${at}\n`);
      process.stdout.write(`--- PROMPT ---\n${prompt}\n`);

      const ok = Boolean((t as any)?.ok);
      const out = String((t as any)?.output ?? '');
      const err = String((t as any)?.error ?? '');
      process.stdout.write(`--- OUTPUT (${ok ? 'ok' : 'error'}) ---\n`);
      if (ok) {
        process.stdout.write(out);
      } else {
        process.stderr.write(err || out || 'failed');
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
    const registry = await loadRegistry();
    const { key, drone } = resolveDroneFromRegistry(registry as any, String(name));
    const droneId = String((drone as any)?.id ?? key ?? name).trim() || String(name);
    const had = Boolean((drone as any)?.chats?.[chatName]);
    if ((globalThis as any).Bun) await updateRegistry((reg) => {
      const { key, drone: d } = resolveDroneFromRegistry(reg as any, String(name));
      if (d.chats) delete d.chats[chatName];
      (reg as any).drones[key] = d;
    });
    else await deleteChatFromStore({ droneId, chatName });
    printCommandOutput({ ok: true, name: String(name), chat: chatName, removed: had });
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
      printCommandOutput(resp);
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
      printCommandOutput({ ok: true, typed, submitted });
    });
  });

program
  .command('keys')
  .argument('<name>', 'Drone/container name')
  .argument('<keys...>', 'Keys to send (e.g. ctrl+c esc shift+tab)')
  .action(async (name, keysArr) => {
    await withDroneClient(name, async ({ client }) => {
      const resp = await sendKeys(client, { keys: keysArr as string[] });
      printCommandOutput(resp);
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
      printCommandOutput(resp);
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
