import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';

import dotenv from 'dotenv';
import { RawData, WebSocket, WebSocketServer } from 'ws';

import { droneRootPath } from '../host/paths';
import { loadRegistry, updateRegistry } from '../host/registry';
import {
  dvmExec,
  dvmLs,
  dvmPorts,
  dvmRepoHeadSha,
  dvmRepoExport,
  dvmRepoSeed,
  dvmRepoSetBaseSha,
  dvmRemove,
  dvmRename,
  dvmScript,
  dvmSessionRead,
  dvmSessionStart,
  dvmSessionType,
  resolveDvmCliPath,
} from '../host/dvm';
import {
  promptEnqueue as dronePromptEnqueue,
  promptGet as dronePromptGet,
  status as droneStatus,
  terminalInput as droneTerminalInput,
  terminalOutput as droneTerminalOutput,
  terminalPrompt as droneTerminalPrompt,
} from '../host/api';
import { jobsPlanFromAgentMessage, suggestDroneNameFromMessage } from './jobsFromMessage';
import { shouldDeferQueuedTranscriptPrompt } from './pendingPromptEnqueue';
import {
  cleanupQuarantineWorktree,
  deleteHostRefBestEffort,
  gitCurrentBranchOrSha,
  gitIsClean,
  gitRepoChangesSummary,
  importBundleHeadToHostRef,
  mergeBranchIntoMainWorkingTreeNoCommit,
  parseGitStatusPorcelainV2Z,
  gitStashPop,
  gitStashPush,
  gitTopLevel,
  isRepoPatchApplyError,
  quarantineWorktreePath,
} from './repoOps';

const HUB_API_LOADED_AT = new Date().toISOString();
const HUB_API_BUILD_ID = crypto.randomBytes(6).toString('hex');

let HUB_ENV_LOADED = false;
function loadHubEnv() {
  if (HUB_ENV_LOADED) return;
  HUB_ENV_LOADED = true;

  // Load .env files if present. This makes local dev ergonomics nicer.
  // It does NOT override already-exported environment variables.
  //
  // Compiled layout:
  //   apps/drone/dist/hub/server.js -> __dirname = apps/drone/dist/hub
  const appRoot = path.resolve(__dirname, '..', '..'); // apps/drone/
  const repoRoot = path.resolve(appRoot, '..', '..'); // repo root

  const candidates = [
    path.join(appRoot, '.env.local'),
    path.join(appRoot, '.env'),
    path.join(repoRoot, '.env.local'),
    path.join(repoRoot, '.env'),
  ];

  for (const p of candidates) {
    try {
      dotenv.config({ path: p, override: false });
    } catch {
      // ignore
    }
  }
}

type LlmProviderId = 'openai' | 'gemini';
type ApiKeySettingsSource = 'settings' | 'environment' | null;
type EffectiveProviderApiKeySettings = {
  apiKey: string | null;
  source: ApiKeySettingsSource;
  updatedAt: string | null;
};
type LlmProviderSource = 'settings' | 'environment' | 'default';
type EffectiveLlmProvider = {
  provider: LlmProviderId;
  source: LlmProviderSource;
};

function parseLlmProvider(raw: unknown): LlmProviderId | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'openai' || s === 'gemini') return s;
  return null;
}

function normalizeApiKey(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function apiKeyHint(apiKey: string | null): string | null {
  const key = normalizeApiKey(apiKey);
  if (!key) return null;
  if (key.length <= 8) return `${key.slice(0, 2)}...${key.slice(-2)}`;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function providerApiKeyEnvVar(provider: LlmProviderId): 'OPENAI_API_KEY' | 'GEMINI_API_KEY' {
  return provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
}

function providerDisplayName(provider: LlmProviderId): string {
  return provider === 'openai' ? 'OpenAI' : 'Gemini';
}

function hubLog(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) {
  const at = new Date().toISOString();
  const payload = meta && Object.keys(meta).length > 0 ? { at, ...meta } : { at };
  if (level === 'error') {
    console.error(`[DroneHub] ${message}`, payload);
    return;
  }
  if (level === 'warn') {
    console.warn(`[DroneHub] ${message}`, payload);
    return;
  }
  console.log(`[DroneHub] ${message}`, payload);
}

async function getStoredProviderApiKey(provider: LlmProviderId): Promise<{ apiKey: string; updatedAt: string | null } | null> {
  const reg = await loadRegistry();
  const block = provider === 'openai' ? reg.settings?.openai : reg.settings?.gemini;
  const apiKey = normalizeApiKey(block?.apiKey);
  if (!apiKey) return null;
  const updatedAtRaw = block?.updatedAt;
  const updatedAt = typeof updatedAtRaw === 'string' && updatedAtRaw.trim() ? updatedAtRaw : null;
  return { apiKey, updatedAt };
}

async function upsertStoredProviderApiKey(provider: LlmProviderId, apiKeyRaw: string): Promise<void> {
  const apiKey = normalizeApiKey(apiKeyRaw);
  if (!apiKey) throw new Error('API key is required.');
  const updatedAt = new Date().toISOString();
  await updateRegistry((reg) => {
    reg.settings ??= {};
    if (provider === 'openai') reg.settings.openai = { apiKey, updatedAt };
    else reg.settings.gemini = { apiKey, updatedAt };
  });
}

async function clearStoredProviderApiKey(provider: LlmProviderId): Promise<void> {
  await updateRegistry((reg) => {
    if (!reg.settings) return;
    if (provider === 'openai') {
      if (!reg.settings.openai) return;
      delete reg.settings.openai;
    } else {
      if (!reg.settings.gemini) return;
      delete reg.settings.gemini;
    }
    if (Object.keys(reg.settings).length === 0) delete reg.settings;
  });
}

async function resolveEffectiveProviderApiKeySettings(provider: LlmProviderId): Promise<EffectiveProviderApiKeySettings> {
  const stored = await getStoredProviderApiKey(provider);
  if (stored) {
    return {
      apiKey: stored.apiKey,
      source: 'settings',
      updatedAt: stored.updatedAt,
    };
  }
  const envVar = providerApiKeyEnvVar(provider);
  const envApiKey = normalizeApiKey(process.env[envVar]);
  if (envApiKey) {
    return {
      apiKey: envApiKey,
      source: 'environment',
      updatedAt: null,
    };
  }
  return {
    apiKey: null,
    source: null,
    updatedAt: null,
  };
}

async function getStoredLlmProvider(): Promise<LlmProviderId | null> {
  const reg = await loadRegistry();
  return parseLlmProvider(reg.settings?.llm?.provider);
}

async function upsertStoredLlmProvider(provider: LlmProviderId): Promise<void> {
  const updatedAt = new Date().toISOString();
  await updateRegistry((reg) => {
    reg.settings ??= {};
    reg.settings.llm = { provider, updatedAt };
  });
}

async function resolveEffectiveLlmProvider(): Promise<EffectiveLlmProvider> {
  const stored = await getStoredLlmProvider();
  if (stored) return { provider: stored, source: 'settings' };
  const env = parseLlmProvider(process.env.DRONE_HUB_LLM_PROVIDER);
  if (env) return { provider: env, source: 'environment' };
  return { provider: 'openai', source: 'default' };
}

function providerKeySettingsResponse(settings: EffectiveProviderApiKeySettings): {
  hasKey: boolean;
  source: ApiKeySettingsSource;
  keyHint: string | null;
  updatedAt: string | null;
} {
  return {
    hasKey: Boolean(settings.apiKey),
    source: settings.source,
    keyHint: apiKeyHint(settings.apiKey),
    updatedAt: settings.source === 'settings' ? settings.updatedAt : null,
  };
}

async function resolveLlmSettingsResponse(): Promise<{
  ok: true;
  provider: { selected: LlmProviderId; source: LlmProviderSource };
  openai: { hasKey: boolean; source: ApiKeySettingsSource; keyHint: string | null; updatedAt: string | null };
  gemini: { hasKey: boolean; source: ApiKeySettingsSource; keyHint: string | null; updatedAt: string | null };
}> {
  const [provider, openai, gemini] = await Promise.all([
    resolveEffectiveLlmProvider(),
    resolveEffectiveProviderApiKeySettings('openai'),
    resolveEffectiveProviderApiKeySettings('gemini'),
  ]);
  return {
    ok: true,
    provider: { selected: provider.provider, source: provider.source },
    openai: providerKeySettingsResponse(openai),
    gemini: providerKeySettingsResponse(gemini),
  };
}

const HUB_SETTINGS_LOG_DEFAULT_TAIL_LINES = 600;
const HUB_SETTINGS_LOG_MAX_TAIL_LINES = 5000;
const HUB_SETTINGS_LOG_DEFAULT_MAX_BYTES = 200_000;
const HUB_SETTINGS_LOG_MAX_BYTES = 1_000_000;

async function readHubLogTail(opts: {
  tailLines: number;
  maxBytes: number;
}): Promise<{
  logPath: string;
  text: string;
  truncated: boolean;
  fileSize: number;
  bytesRead: number;
  updatedAt: string | null;
}> {
  const logPath = droneRootPath('hub.log');

  let fileSize = 0;
  let updatedAt: string | null = null;
  try {
    const st = await fs.stat(logPath);
    fileSize = Number.isFinite(st.size) && st.size > 0 ? Math.floor(st.size) : 0;
    updatedAt = st.mtime ? st.mtime.toISOString() : null;
  } catch (error: any) {
    const code = String(error?.code ?? '');
    if (code === 'ENOENT') {
      return { logPath, text: '', truncated: false, fileSize: 0, bytesRead: 0, updatedAt: null };
    }
    throw error;
  }

  if (fileSize <= 0) {
    return { logPath, text: '', truncated: false, fileSize: 0, bytesRead: 0, updatedAt };
  }

  const maxBytes = clampInt(opts.maxBytes, 1, HUB_SETTINGS_LOG_MAX_BYTES);
  const start = Math.max(0, fileSize - maxBytes);
  const readLen = Math.max(1, fileSize - start);
  const fh = await fs.open(logPath, 'r');

  let bytesRead = 0;
  let text = '';
  try {
    const buf = Buffer.alloc(readLen);
    const out = await fh.read(buf, 0, readLen, start);
    bytesRead = out.bytesRead;
    text = buf.subarray(0, bytesRead).toString('utf8').replace(/\r\n/g, '\n');
  } finally {
    await fh.close();
  }

  let truncated = start > 0;
  if (start > 0) {
    // We likely started mid-line; drop the partial first line for cleaner output.
    const nl = text.indexOf('\n');
    if (nl >= 0) text = text.slice(nl + 1);
  }

  const tailLines = clampInt(opts.tailLines, 1, HUB_SETTINGS_LOG_MAX_TAIL_LINES);
  const lines = text.split('\n');
  if (lines.length > tailLines) {
    text = lines.slice(-tailLines).join('\n');
    truncated = true;
  }

  return {
    logPath,
    text,
    truncated,
    fileSize,
    bytesRead,
    updatedAt,
  };
}

function json(res: http.ServerResponse, status: number, body: any) {
  const data = JSON.stringify(body, null, 2);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(data);
}

async function resolveDroneFromRegistry(
  droneName: string,
  onStillStarting: () => void,
  onUnknown: () => void,
): Promise<any | null> {
  const regAny: any = await loadRegistry();
  if (!regAny?.drones?.[droneName] && regAny?.pending?.[droneName]) {
    onStillStarting();
    return null;
  }
  const drone = regAny?.drones?.[droneName] ?? null;
  if (!drone) {
    onUnknown();
    return null;
  }
  return drone;
}

async function resolveDroneOrRespond(res: http.ServerResponse, droneName: string): Promise<any | null> {
  return resolveDroneFromRegistry(
    droneName,
    () => {
      json(res, 409, { ok: false, error: `drone "${droneName}" is still starting` });
    },
    () => {
      json(res, 404, { ok: false, error: `unknown drone: ${droneName}` });
    },
  );
}

async function resolveDroneOrRejectUpgrade(socket: any, droneName: string): Promise<any | null> {
  return resolveDroneFromRegistry(
    droneName,
    () => {
      rejectWebSocketUpgrade(socket, 409, 'Conflict');
    },
    () => {
      rejectWebSocketUpgrade(socket, 404, 'Not Found');
    },
  );
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
    req.on('end', () => resolve());
    req.on('error', reject);
  });
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid JSON body');
  }
}

function appendVaryHeader(res: http.ServerResponse, value: string) {
  const current = String(res.getHeader('vary') ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (!current.includes(value.toLowerCase())) {
    const next = [...current, value.toLowerCase()];
    res.setHeader('vary', next.join(', '));
  }
}

function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(String(raw));
    const proto = String(u.protocol || '').toLowerCase();
    if (proto !== 'http:' && proto !== 'https:') return null;
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function withCors(req: http.IncomingMessage, res: http.ServerResponse, allowedOrigins: Set<string>): boolean {
  const originRaw = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (!originRaw) return true;

  appendVaryHeader(res, 'origin');
  const origin = normalizeOrigin(originRaw);
  if (!origin || !allowedOrigins.has(origin)) return false;

  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,authorization');
  return true;
}

function isHubApiAuthorized(req: http.IncomingMessage, apiToken: string): boolean {
  const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const expected = `Bearer ${apiToken}`;
  const a = Buffer.from(auth, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isHubApiToken(raw: string, apiToken: string): boolean {
  const a = Buffer.from(String(raw ?? ''), 'utf8');
  const b = Buffer.from(String(apiToken ?? ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isHubApiAuthorizedForWebSocket(req: http.IncomingMessage, u: URL, apiToken: string): boolean {
  if (isHubApiAuthorized(req, apiToken)) return true;
  const token = String(u.searchParams.get('token') ?? '');
  if (!token) return false;
  return isHubApiToken(token, apiToken);
}

function rejectWebSocketUpgrade(socket: any, statusCode: number, statusText: string): void {
  try {
    socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\n\r\n`);
  } catch {
    // ignore
  }
  try {
    socket.destroy();
  } catch {
    // ignore
  }
}

function bashQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function shellQuoteIfNeeded(s: string): string {
  const v = String(s);
  // Conservative "safe" set: avoid quoting common path-ish tokens.
  // If anything looks weird, fall back to full bash quoting.
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(v)) return v;
  return bashQuote(v);
}

function normalizeContainerPath(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '/';
  return s.startsWith('/') ? s : `/${s}`;
}

function encodeRemotePath(p: string): string {
  // Keep "/" separators while escaping segments.
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function hexEncodeUtf8(s: string): string {
  return Buffer.from(String(s ?? ''), 'utf8').toString('hex');
}

function parseBoolParam(raw: string | null, defaultValue: boolean): boolean {
  if (raw == null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'n' || v === 'off') return false;
  return defaultValue;
}

function isRepoAttachedDrone(drone: any): boolean {
  if (!drone || typeof drone !== 'object') return false;
  const explicit = (drone as any).repoAttached;
  if (typeof explicit === 'boolean') return explicit;
  return Boolean(String((drone as any).repoPath ?? '').trim());
}

function looksLikeEmptyBundleExportError(message: string): boolean {
  const raw = String(message ?? '');
  return /refusing to create empty bundle/i.test(raw);
}

function looksLikeBundleMissingPrerequisiteError(message: string): boolean {
  const raw = String(message ?? '');
  return /lacks these prerequisite commits|missing prerequisite commits|repository lacks.*prerequisite/i.test(raw);
}

function defaultDroneHomeCwd(drone: any): string {
  return isRepoAttachedDrone(drone) ? '/work/repo' : '/dvm-data/home';
}

function droneRepoPathInContainer(drone: any): string {
  const raw = String(drone?.repo?.dest ?? '/work/repo').trim();
  return normalizeContainerPath(raw || '/work/repo');
}

async function runGitInDrone(opts: {
  container: string;
  repoPathInContainer: string;
  args: string[];
}): Promise<{ code: number; stdout: string; stderr: string }> {
  return await dvmExec(opts.container, 'git', ['-C', normalizeContainerPath(opts.repoPathInContainer), ...opts.args]);
}

async function runGitInDroneOrThrow(opts: {
  container: string;
  repoPathInContainer: string;
  args: string[];
  okCodes?: number[];
}): Promise<{ code: number; stdout: string; stderr: string }> {
  const okCodes = Array.isArray(opts.okCodes) && opts.okCodes.length > 0 ? opts.okCodes : [0];
  const r = await runGitInDrone(opts);
  if (!okCodes.includes(r.code)) {
    const msg = (r.stderr || r.stdout || `git ${opts.args.join(' ')} failed (exit ${r.code})`).trim();
    throw new Error(msg);
  }
  return r;
}

async function droneRepoChangesSummary(opts: {
  container: string;
  repoPathInContainer: string;
}): Promise<{ repoRoot: string; summary: ReturnType<typeof parseGitStatusPorcelainV2Z> }> {
  const repoPathInContainer = normalizeContainerPath(opts.repoPathInContainer);
  const repoRootRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['rev-parse', '--show-toplevel'],
  });
  const repoRoot = String(repoRootRaw.stdout ?? '').trim() || repoPathInContainer;
  const statusRaw = await runGitInDroneOrThrow({
    container: opts.container,
    repoPathInContainer,
    args: ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'],
  });
  return {
    repoRoot,
    summary: parseGitStatusPorcelainV2Z(statusRaw.stdout),
  };
}

async function droneRepoDiffForPath(opts: {
  container: string;
  repoPathInContainer: string;
  filePath: string;
  kind: 'staged' | 'unstaged';
  contextLines?: number;
  maxChars?: number;
}): Promise<{ path: string; kind: 'staged' | 'unstaged'; diff: string; truncated: boolean; fromUntracked: boolean }> {
  const repoPathInContainer = normalizeContainerPath(opts.repoPathInContainer);
  const requestedPath = String(opts.filePath ?? '').trim();
  const kind: 'staged' | 'unstaged' = opts.kind === 'staged' ? 'staged' : 'unstaged';
  if (!requestedPath) throw new Error('missing file path');
  if (requestedPath.includes('\0')) throw new Error('invalid file path');

  const contextLines =
    typeof opts.contextLines === 'number' && Number.isFinite(opts.contextLines) && opts.contextLines >= 0
      ? Math.floor(opts.contextLines)
      : 3;
  const maxChars =
    typeof opts.maxChars === 'number' && Number.isFinite(opts.maxChars) && opts.maxChars > 0
      ? Math.floor(opts.maxChars)
      : 350_000;

  const contextFlag = `-U${contextLines}`;
  let diffText = '';
  let fromUntracked = false;

  if (kind === 'staged') {
    const staged = await runGitInDroneOrThrow({
      container: opts.container,
      repoPathInContainer,
      args: ['diff', '--no-color', '--no-ext-diff', '--cached', contextFlag, '--', requestedPath],
    });
    diffText = staged.stdout;
  } else {
    const unstaged = await runGitInDroneOrThrow({
      container: opts.container,
      repoPathInContainer,
      args: ['diff', '--no-color', '--no-ext-diff', contextFlag, '--', requestedPath],
    });
    diffText = unstaged.stdout;

    if (!diffText) {
      const tracked = await runGitInDroneOrThrow({
        container: opts.container,
        repoPathInContainer,
        args: ['ls-files', '--error-unmatch', '--', requestedPath],
        okCodes: [0, 1],
      });
      if (tracked.code !== 0) {
        const noIndex = await runGitInDroneOrThrow({
          container: opts.container,
          repoPathInContainer,
          args: ['diff', '--no-color', '--no-ext-diff', '--no-index', contextFlag, '/dev/null', requestedPath],
          okCodes: [0, 1],
        });
        diffText = noIndex.stdout;
        fromUntracked = Boolean(diffText);
      }
    }
  }

  let truncated = false;
  if (diffText.length > maxChars) {
    truncated = true;
    diffText = `${diffText.slice(0, maxChars)}\n\n@@ truncated @@\n`;
  }

  return {
    path: requestedPath,
    kind,
    diff: diffText,
    truncated,
    fromUntracked,
  };
}

function buildDockerExecShellCommand(containerName: string, cwdRaw: string): string {
  const cwd = normalizeContainerPath(cwdRaw);
  const shellBody = [
    `target=${bashQuote(cwd)}`,
    'mkdir -p "$target" 2>/dev/null || true',
    'cd "$target" 2>/dev/null || cd /',
    // Some images export ENV/BASH_ENV startup files with bashisms (`source`).
    // Clear them so fallback POSIX sh does not error on startup.
    'unset ENV BASH_ENV',
    'if command -v bash >/dev/null 2>&1; then exec bash -i; fi',
    'exec sh -i',
  ].join('; ');
  // Use `sh -c` (not login shell) to avoid profile bashisms like `source`.
  return `docker exec -it ${bashQuote(containerName)} sh -c ${bashQuote(shellBody)}`;
}

const IMAGE_FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'tif', 'tiff']);
const FS_THUMB_MAX_BYTES = 8 * 1024 * 1024;

type ContainerFsEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'other';
  size: number | null;
  mtimeMs: number | null;
  ext: string | null;
  isImage: boolean;
};

function extensionLower(rawPathOrName: string): string {
  const base = path.posix.basename(String(rawPathOrName ?? '').trim().toLowerCase());
  const i = base.lastIndexOf('.');
  if (i <= 0 || i === base.length - 1) return '';
  return base.slice(i + 1);
}

function isLikelyImagePath(rawPathOrName: string): boolean {
  const ext = extensionLower(rawPathOrName);
  return ext ? IMAGE_FILE_EXTENSIONS.has(ext) : false;
}

function guessImageMimeType(rawPathOrName: string): string {
  const ext = extensionLower(rawPathOrName);
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'svg':
      return 'image/svg+xml';
    case 'ico':
      return 'image/x-icon';
    case 'avif':
      return 'image/avif';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    default:
      return 'application/octet-stream';
  }
}

function parseContainerFsListOutput(text: string): { resolvedPath: string; entries: ContainerFsEntry[] } {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);

  let resolvedPath = '/';
  const entries: ContainerFsEntry[] = [];

  for (const line of lines) {
    if (line.startsWith('__PATH__\t')) {
      const p = normalizeContainerPath(line.slice('__PATH__\t'.length));
      resolvedPath = p || '/';
      continue;
    }
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [nameRaw, typeRaw, sizeRaw, mtimeRaw] = parts;
    const name = String(nameRaw ?? '');
    if (!name || name === '.' || name === '..') continue;

    const type = String(typeRaw ?? '');
    const kind: ContainerFsEntry['kind'] = type === 'd' ? 'directory' : type === 'f' ? 'file' : 'other';
    const sizeNum = Number(sizeRaw);
    const mtimeSec = Number(mtimeRaw);

    const fullPath =
      resolvedPath === '/' ? path.posix.join('/', name) : path.posix.join(resolvedPath.replace(/\/+$/g, ''), name);
    const ext = kind === 'file' ? extensionLower(name) || null : null;
    const isImage = kind === 'file' ? isLikelyImagePath(name) : false;

    entries.push({
      name,
      path: fullPath,
      kind,
      size: Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : null,
      mtimeMs: Number.isFinite(mtimeSec) ? Math.max(0, Math.floor(mtimeSec * 1000)) : null,
      ext,
      isImage,
    });
  }

  const rank = (k: ContainerFsEntry['kind']) => (k === 'directory' ? 0 : k === 'file' ? 1 : 2);
  entries.sort((a, b) => {
    const r = rank(a.kind) - rank(b.kind);
    if (r !== 0) return r;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return { resolvedPath, entries };
}

function isUngroupedGroupName(name: string): boolean {
  return String(name ?? '').trim().toLowerCase() === 'ungrouped';
}

function buildDvmCommand(args: string[]): string {
  const nodePath = process.execPath;
  const dvmCli = resolveDvmCliPath();
  return `${bashQuote(nodePath)} ${bashQuote(dvmCli)} ${args.map(bashQuote).join(' ')}`;
}

function buildDvmManualCommand(args: string[]): string {
  const nodePath = process.execPath;
  const dvmCli = resolveDvmCliPath();
  return `${shellQuoteIfNeeded(nodePath)} ${shellQuoteIfNeeded(dvmCli)} ${args.map(shellQuoteIfNeeded).join(' ')}`;
}

function sanitizeTmuxSessionName(raw: string): string {
  // tmux session names are fairly permissive, but keep it conservative:
  // - no spaces
  // - no slashes
  // - keep it short-ish
  const s = String(raw ?? '').trim();
  const cleaned = s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!cleaned) return 'default';
  return cleaned.slice(0, 48);
}

function isSafeTmuxSessionName(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 64) return false;
  return /^[A-Za-z0-9._-]+$/.test(s);
}

async function sleepMs(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function dvmContainerExists(name: string): Promise<boolean> {
  const n = String(name ?? '').trim();
  if (!n) return false;
  try {
    const names = await dvmLs();
    return names.includes(n);
  } catch {
    // If `dvm ls` is unavailable, be conservative and assume it exists.
    return true;
  }
}

async function waitForDroneDaemonReady(client: ReturnType<typeof makeClient>, timeoutMs: number) {
  const start = Date.now();
  // Keep retrying briefly; daemon may not be ready immediately after container start.
  // NOTE: droneStatus already has its own per-request timeout.
  while (Date.now() - start < timeoutMs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await droneStatus(client);
      return;
    } catch {
      // eslint-disable-next-line no-await-in-loop
      await sleepMs(250);
    }
  }
  throw new Error(`drone daemon not ready after ${timeoutMs}ms`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  const ms = Number.isFinite(timeoutMs) ? Math.max(1, Math.floor(timeoutMs)) : 1;
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${message} (timed out after ${Math.round(ms / 1000)}s)`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const DEFAULT_DAEMON_READY_TIMEOUT_MS = 20_000;
const UPGRADE_DAEMON_READY_TIMEOUT_MS = 30_000;
const DEFAULT_REPO_SEED_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_SEED_BOOTSTRAP_TIMEOUT_MS = 45_000;
const DEFAULT_PROMPT_ENQUEUE_TIMEOUT_MS = 180_000;
const DAEMON_UPGRADED_BY_CONTAINER = new Set<string>();
const DAEMON_UPGRADE_TASKS = new Map<string, Promise<void>>();

function defaultDaemonReadyTimeoutMs(): number {
  const raw = String(process.env.DRONE_HUB_DAEMON_READY_TIMEOUT_MS ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 1_000) return Math.max(1_000, Math.min(120_000, Math.floor(n)));
  return DEFAULT_DAEMON_READY_TIMEOUT_MS;
}

function defaultRepoSeedTimeoutMs(): number {
  const raw = String(process.env.DRONE_HUB_REPO_SEED_TIMEOUT_MS ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 10_000) return Math.max(10_000, Math.min(60 * 60_000, Math.floor(n)));
  return DEFAULT_REPO_SEED_TIMEOUT_MS;
}

function defaultSeedBootstrapTimeoutMs(): number {
  const raw = String(process.env.DRONE_HUB_SEED_BOOTSTRAP_TIMEOUT_MS ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 5_000) return Math.max(5_000, Math.min(10 * 60_000, Math.floor(n)));
  return DEFAULT_SEED_BOOTSTRAP_TIMEOUT_MS;
}

function defaultPromptEnqueueTimeoutMs(): number {
  const raw = String(process.env.DRONE_HUB_PROMPT_ENQUEUE_TIMEOUT_MS ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 30_000) return Math.max(30_000, Math.min(30 * 60_000, Math.floor(n)));
  return DEFAULT_PROMPT_ENQUEUE_TIMEOUT_MS;
}

function isValidDroneNameDashCase(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (s.length > 48) return false;
  // Conservative: docker-ish, URL-ish, and consistent with the hub UI.
  // - lower-case letters/numbers
  // - single hyphens between segments
  // - no leading/trailing hyphen
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
}

type BuiltinAgentId = 'cursor' | 'codex' | 'claude' | 'opencode';

type ChatAgentConfig =
  | { kind: 'builtin'; id: BuiltinAgentId }
  | { kind: 'custom'; id: string; label: string; command: string };

type DiscoveredModelOption = {
  id: string;
  label: string;
  isDefault?: boolean;
  isCurrent?: boolean;
};

type TranscriptTurn =
  | { at: string; prompt: string; session: string; logPath: string }
  | { at: string; id?: string; prompt: string; ok: boolean; output: string; error?: string };

type PendingPhase = 'starting' | 'creating' | 'seeding' | 'error';

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeChatName(raw: any): string {
  return String(raw ?? 'default').trim() || 'default';
}

function normalizeBuiltinAgentId(raw: any): BuiltinAgentId | null {
  const id = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (id === 'cursor' || id === 'codex' || id === 'claude' || id === 'opencode') return id;
  if (id === 'cloud' || id === 'claude-code' || id === 'claude_code') return 'claude';
  if (id === 'open-code' || id === 'open_code') return 'opencode';
  return null;
}

function isValidChatAgentConfig(v: any): v is ChatAgentConfig {
  if (!v || typeof v !== 'object') return false;
  if (v.kind === 'builtin') return normalizeBuiltinAgentId(v.id) !== null;
  if (v.kind === 'custom') {
    return Boolean(String(v.id ?? '').trim() && String(v.label ?? '').trim() && String(v.command ?? '').trim());
  }
  return false;
}

function parseSeedAgent(raw: any): ChatAgentConfig | null {
  if (!raw) return null;
  const kind = String(raw?.kind ?? raw?.type ?? '').trim().toLowerCase();
  const directBuiltin = normalizeBuiltinAgentId(kind);
  if (directBuiltin) return { kind: 'builtin', id: directBuiltin };
  if (kind === 'builtin') {
    const id = normalizeBuiltinAgentId(raw?.id);
    if (id) return { kind: 'builtin', id };
    return null;
  }
  if (kind === 'custom' || raw?.kind === 'custom') {
    const id = String(raw?.id ?? '').trim();
    const label = String(raw?.label ?? '').trim();
    const command = String(raw?.command ?? '').trim();
    if (!id || !label || !command) return null;
    return { kind: 'custom', id, label, command };
  }
  // Also accept already-normalized configs.
  if (isValidChatAgentConfig(raw)) return raw;
  return null;
}

const CHAT_MODEL_MAX_LEN = 160;
const CHAT_MODEL_DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;
const chatModelDiscoveryCache = new Map<
  string,
  {
    atMs: number;
    models: DiscoveredModelOption[];
    error?: string;
  }
>();
const cliModelFlagSupportCache = new Map<string, { atMs: number; supported: boolean }>();

function normalizeChatModel(raw: any): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length > CHAT_MODEL_MAX_LEN) return null;
  if (/[\r\n\t]/.test(s)) return null;
  return s;
}

function parseChatModelForUpdate(raw: any): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length > CHAT_MODEL_MAX_LEN) throw new Error(`model is too long (max ${CHAT_MODEL_MAX_LEN} chars)`);
  if (/[\r\n\t]/.test(s)) throw new Error('model contains invalid whitespace');
  return s;
}

function stripAnsiFromCliOutput(text: string): string {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[A-Z@-_]/g, '')
    .replace(/\r/g, '');
}

function modelDiscoveryCacheKey(opts: { droneName: string; chatName: string; agent: BuiltinAgentId }): string {
  return `${opts.droneName}::${opts.chatName}::${opts.agent}`;
}

function parseDiscoveredModelsFromOutput(raw: string): DiscoveredModelOption[] {
  const text = stripAnsiFromCliOutput(raw);
  const out: DiscoveredModelOption[] = [];
  const seen = new Set<string>();

  const add = (idRaw: any, labelRaw?: any, opts?: { isDefault?: boolean; isCurrent?: boolean }) => {
    const id = String(idRaw ?? '').trim();
    if (!id) return;
    if (id.length > CHAT_MODEL_MAX_LEN) return;
    if (seen.has(id)) return;
    seen.add(id);
    const label = String(labelRaw ?? '').trim() || id;
    out.push({ id, label, ...(opts?.isDefault ? { isDefault: true } : {}), ...(opts?.isCurrent ? { isCurrent: true } : {}) });
  };

  const addFromUnknown = (value: any) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) addFromUnknown(item);
      return;
    }
    if (typeof value === 'string') {
      add(value, value);
      return;
    }
    if (typeof value !== 'object') return;
    const id = (value as any).id ?? (value as any).model ?? (value as any).name ?? (value as any).slug;
    const label = (value as any).label ?? (value as any).displayName ?? (value as any).name ?? (value as any).model ?? id;
    add(id, label, { isDefault: Boolean((value as any).default), isCurrent: Boolean((value as any).current) });
    const nested = (value as any).models ?? (value as any).items ?? (value as any).data ?? null;
    if (nested) addFromUnknown(nested);
  };

  const trimmed = text.trim();
  if (!trimmed) return out;

  // Try full JSON payload first.
  try {
    const parsed = JSON.parse(trimmed);
    addFromUnknown(parsed);
  } catch {
    // ignore
  }

  // Try JSONL-ish lines.
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (!(line.startsWith('{') || line.startsWith('['))) continue;
    try {
      const parsed = JSON.parse(line);
      addFromUnknown(parsed);
    } catch {
      // ignore
    }
  }

  // Parse human-readable model lists (e.g. "id - Label (default)").
  for (const rawLine of lines) {
    const line = rawLine.replace(/^\s*[-*]\s+/, '');
    if (!line) continue;
    const low = line.toLowerCase();
    if (
      low.startsWith('usage:') ||
      low.startsWith('available models') ||
      low.startsWith('loading models') ||
      low.startsWith('tip:') ||
      low.startsWith('options:')
    ) {
      continue;
    }
    const withLabel = line.match(/^([A-Za-z0-9][A-Za-z0-9._:/+-]{0,159})\s*-\s*(.+)$/);
    if (withLabel) {
      const label = String(withLabel[2] ?? '').replace(/\s+\((default|current)\)\s*$/i, '').trim();
      add(withLabel[1], label || withLabel[1], {
        isDefault: /\(default\)\s*$/i.test(line),
        isCurrent: /\(current\)\s*$/i.test(line),
      });
      continue;
    }
    const idOnly = line.match(/^([A-Za-z0-9][A-Za-z0-9._:/+-]{0,159})$/);
    if (idOnly) add(idOnly[1], idOnly[1]);
  }

  return out;
}

function parseCodexModelsCache(raw: string): DiscoveredModelOption[] {
  const out: DiscoveredModelOption[] = [];
  const seen = new Set<string>();
  const add = (idRaw: any, labelRaw?: any, opts?: { isDefault?: boolean; isCurrent?: boolean }) => {
    const id = String(idRaw ?? '').trim();
    if (!id || seen.has(id) || id.length > CHAT_MODEL_MAX_LEN) return;
    seen.add(id);
    const label = String(labelRaw ?? '').trim() || id;
    out.push({ id, label, ...(opts?.isDefault ? { isDefault: true } : {}), ...(opts?.isCurrent ? { isCurrent: true } : {}) });
  };
  try {
    const parsed = JSON.parse(String(raw ?? ''));
    const list = Array.isArray((parsed as any)?.models) ? (parsed as any).models : [];
    const current = String((parsed as any)?.current_model ?? (parsed as any)?.currentModel ?? '').trim();
    const def = String((parsed as any)?.default_model ?? (parsed as any)?.defaultModel ?? '').trim();
    for (const m of list) {
      const id = (m as any)?.slug ?? (m as any)?.id ?? (m as any)?.model ?? (m as any)?.name;
      const label = (m as any)?.display_name ?? (m as any)?.displayName ?? (m as any)?.label ?? id;
      const modelId = String(id ?? '').trim();
      add(modelId, label, { isCurrent: current ? modelId === current : false, isDefault: def ? modelId === def : false });
    }
  } catch {
    return [];
  }
  return out;
}
async function discoverModelsForBuiltinAgent(opts: {
  containerName: string;
  droneName: string;
  chatName: string;
  agentId: BuiltinAgentId;
  forceRefresh?: boolean;
}): Promise<{ models: DiscoveredModelOption[]; source: 'live' | 'cache' | 'none'; discoveredAt: string; error?: string }> {
  const key = modelDiscoveryCacheKey({ droneName: opts.droneName, chatName: opts.chatName, agent: opts.agentId });
  const now = Date.now();
  const cached = chatModelDiscoveryCache.get(key);
  if (!opts.forceRefresh && cached && now - cached.atMs < CHAT_MODEL_DISCOVERY_CACHE_TTL_MS) {
    return {
      models: cached.models,
      source: 'cache',
      discoveredAt: new Date(cached.atMs).toISOString(),
      ...(cached.error ? { error: cached.error } : {}),
    };
  }

  const binByAgent: Record<BuiltinAgentId, string> = {
    cursor: 'agent',
    codex: 'codex',
    claude: 'claude',
    opencode: 'opencode',
  };
  const bin = binByAgent[opts.agentId];

  const exists = await dvmExec(opts.containerName, 'bash', ['-lc', `command -v ${bin} >/dev/null 2>&1`]);
  if (exists.code !== 0) {
    const error = `${bin} is not installed in this drone`;
    chatModelDiscoveryCache.set(key, { atMs: now, models: [], error });
    return { models: [], source: 'none', discoveredAt: new Date(now).toISOString(), error };
  }

  const help = await dvmExec(opts.containerName, 'bash', ['-lc', `${bin} --help`]);
  const helpText = stripAnsiFromCliOutput(`${help.stdout || ''}\n${help.stderr || ''}`);
  const hasModelsCommand = helpText
    .split('\n')
    .map((l) => l.trim())
    .some((l) => /^models?(?:\s{2,}.*)?$/i.test(l));
  const candidates: string[] = [];
  if (/\b--list-models\b/i.test(helpText)) candidates.push(`${bin} --list-models`);
  if (hasModelsCommand) {
    candidates.push(`${bin} models --json`);
    candidates.push(`${bin} models list --json`);
    candidates.push(`${bin} models`);
    candidates.push(`${bin} models list`);
  }
  // Explicit fallbacks for known CLIs.
  if (opts.agentId === 'cursor') {
    candidates.push('agent --list-models');
    candidates.push('agent models');
  }
  if (opts.agentId === 'codex') {
    // Probe common Codex model-list commands even when `--help` doesn't advertise them.
    candidates.push('codex models --json');
    candidates.push('codex models list --json');
    candidates.push('codex models');
    candidates.push('codex models list');
  }
  if (opts.agentId === 'claude') {
    candidates.push('claude models --json');
    candidates.push('claude models');
  }
  if (opts.agentId === 'opencode') {
    candidates.push('opencode models --json');
    candidates.push('opencode models');
  }

  const deduped = Array.from(new Set(candidates.map((c) => c.trim()).filter(Boolean)));
  for (const cmd of deduped) {
    const r = await dvmExec(opts.containerName, 'bash', ['-lc', cmd], { timeoutMs: defaultSeedBootstrapTimeoutMs() });
    const parsed = parseDiscoveredModelsFromOutput(`${r.stdout || ''}\n${r.stderr || ''}`);
    if (parsed.length > 0) {
      chatModelDiscoveryCache.set(key, { atMs: now, models: parsed });
      return { models: parsed, source: 'live', discoveredAt: new Date(now).toISOString() };
    }
  }

  // Codex fallback: read Codex's local model cache file when direct CLI listing is unavailable.
  if (opts.agentId === 'codex') {
    const cacheProbeScript = [
      'set -euo pipefail',
      'paths=("$HOME/.codex/models_cache.json" "/root/.codex/models_cache.json" "/dvm-data/home/.codex/models_cache.json")',
      'for p in "${paths[@]}"; do',
      '  if [ -f "$p" ]; then',
      '    echo "__PATH__\\t$p"',
      '    cat "$p"',
      '    exit 0',
      '  fi',
      'done',
      'exit 1',
    ].join('\n');
    const r = await dvmExec(opts.containerName, 'bash', ['-lc', cacheProbeScript], { timeoutMs: defaultSeedBootstrapTimeoutMs() });
    if (r.code === 0) {
      const combined = String(r.stdout || '');
      const jsonStart = combined.indexOf('{');
      if (jsonStart >= 0) {
        const parsedCache = parseCodexModelsCache(combined.slice(jsonStart));
        if (parsedCache.length > 0) {
          chatModelDiscoveryCache.set(key, { atMs: now, models: parsedCache });
          return { models: parsedCache, source: 'live', discoveredAt: new Date(now).toISOString() };
        }
      }
    }

    // Final Codex fallback: host-side cache file (helps when drone cache is cold).
    const hostCandidates = Array.from(
      new Set([
        path.join(os.homedir(), '.codex', 'models_cache.json'),
        '/root/.codex/models_cache.json',
      ]),
    );
    for (const p of hostCandidates) {
      try {
        const raw = await fs.readFile(p, 'utf8');
        const parsedCache = parseCodexModelsCache(raw);
        if (parsedCache.length > 0) {
          chatModelDiscoveryCache.set(key, { atMs: now, models: parsedCache });
          return { models: parsedCache, source: 'live', discoveredAt: new Date(now).toISOString() };
        }
      } catch {
        // ignore and continue
      }
    }
  }
  const error = deduped.length > 0
    ? `no models discovered for ${opts.agentId} (tried ${deduped.length} command${deduped.length === 1 ? '' : 's'})`
    : `no model discovery command available for ${opts.agentId}`;
  chatModelDiscoveryCache.set(key, { atMs: now, models: [], error });
  return { models: [], source: 'none', discoveredAt: new Date(now).toISOString(), error };
}

async function cliSupportsModelFlag(opts: { containerName: string; bin: string }): Promise<boolean> {
  const key = `${opts.containerName}::${opts.bin}`;
  const now = Date.now();
  const cached = cliModelFlagSupportCache.get(key);
  if (cached && now - cached.atMs < CHAT_MODEL_DISCOVERY_CACHE_TTL_MS) return cached.supported;
  const r = await dvmExec(opts.containerName, 'bash', ['-lc', `${opts.bin} --help`], {
    timeoutMs: defaultSeedBootstrapTimeoutMs(),
  });
  const text = stripAnsiFromCliOutput(`${r.stdout || ''}\n${r.stderr || ''}`);
  const supported = /\B--model\b/i.test(text) || /\B-m,\s*--model\b/i.test(text);
  cliModelFlagSupportCache.set(key, { atMs: now, supported });
  return supported;
}

async function updatePendingDrone(
  name: string,
  patch: Partial<{
    phase: PendingPhase;
    message: string;
    error: string;
    updatedAt: string;
  }>
) {
  await updateRegistry((regAny: any) => {
    const pending = regAny?.pending?.[name];
    if (!pending) return;
    regAny.pending = regAny.pending ?? {};
    regAny.pending[name] = {
      ...pending,
      ...patch,
      updatedAt: patch.updatedAt ?? nowIso(),
    };
  });
}

async function setDroneHubMeta(
  name: string,
  hub: null | { phase: 'starting' | 'seeding' | 'error'; message?: string; promptId?: string }
) {
  await updateRegistry((regAny: any) => {
    const d: any = regAny?.drones?.[name];
    if (!d) return;
    if (!hub) {
      delete d.hub;
    } else {
      d.hub = { phase: hub.phase, message: hub.message, updatedAt: nowIso(), ...(hub.promptId ? { promptId: hub.promptId } : {}) };
    }
    regAny.drones = regAny.drones ?? {};
    regAny.drones[name] = d;
  });
}

async function enqueueTranscriptPrompt(opts: {
  id?: string;
  drone: any;
  waitForDaemonMs?: number;
  kind: string;
  script: string;
}) {
  const d = opts.drone;
  // After hub restarts, a container may still run an older daemon.js.
  // Best-effort upgrade once per container so new prompt behavior is consistent.
  const daemonKey = `${String(d?.name ?? '')}:${Number(d?.containerPort ?? 0)}`;
  if (daemonKey && !DAEMON_UPGRADED_BY_CONTAINER.has(daemonKey)) {
    const existingTask = DAEMON_UPGRADE_TASKS.get(daemonKey);
    if (existingTask) {
      try {
        await existingTask;
      } catch {
        // ignore; we can still try with current daemon
      }
    } else {
      const task = (async () => {
        await upgradeDroneDaemonInContainer({
          containerName: String(d?.name ?? ''),
          containerPort: Number(d?.containerPort ?? 7777),
        });
      })();
      DAEMON_UPGRADE_TASKS.set(daemonKey, task);
      try {
        await task;
        DAEMON_UPGRADED_BY_CONTAINER.add(daemonKey);
      } catch {
        // ignore; fallback path below can still work with existing daemon
      } finally {
        DAEMON_UPGRADE_TASKS.delete(daemonKey);
      }
    }
  }
  const token = typeof d.token === 'string' ? d.token : '';
  const hostPort =
    typeof d.hostPort === 'number' && Number.isFinite(d.hostPort)
      ? d.hostPort
      : await resolveHostPort(d.name, d.containerPort);
  if (!hostPort || !token) throw new Error('drone daemon not reachable (missing hostPort/token)');
  const daemonReadyTimeoutMs =
    typeof opts.waitForDaemonMs === 'number' && Number.isFinite(opts.waitForDaemonMs) && opts.waitForDaemonMs > 0
      ? Math.floor(opts.waitForDaemonMs)
      : defaultDaemonReadyTimeoutMs();
  const daemonReadyAfterUpgradeTimeoutMs =
    typeof opts.waitForDaemonMs === 'number' && Number.isFinite(opts.waitForDaemonMs) && opts.waitForDaemonMs > 0
      ? Math.floor(opts.waitForDaemonMs)
      : Math.max(daemonReadyTimeoutMs, UPGRADE_DAEMON_READY_TIMEOUT_MS);
  const client = makeClient(hostPort, token);
  await waitForDroneDaemonReady(client, daemonReadyTimeoutMs);
  try {
    await dronePromptEnqueue(client, { id: String(opts.id ?? ''), kind: opts.kind, cmd: 'bash', args: ['-lc', opts.script] });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (isNotFoundErrorMessage(msg)) {
      await upgradeDroneDaemonInContainer({ containerName: d.name, containerPort: d.containerPort });
      await waitForDroneDaemonReady(client, daemonReadyAfterUpgradeTimeoutMs);
      await dronePromptEnqueue(client, { id: String(opts.id ?? ''), kind: opts.kind, cmd: 'bash', args: ['-lc', opts.script] });
      return;
    }
    throw e;
  }
}

async function sendPromptToChat(opts: {
  id?: string;
  droneName: string;
  chatName: string;
  prompt: string;
  cwd?: string | null;
  waitForDaemonMs?: number;
}) {
  const regAny: any = await loadRegistry();
  if (regAny?.pending?.[opts.droneName] && !regAny?.drones?.[opts.droneName]) {
    throw new Error(`drone "${opts.droneName}" is still starting`);
  }
  const d = (regAny as any).drones?.[opts.droneName];
  if (!d) throw new Error(`unknown drone: ${opts.droneName}`);

  const normalizedChat = opts.chatName || 'default';
  await ensureChatEntry({ droneName: opts.droneName, chatName: normalizedChat });

  const { chat } = await getChatEntry({ droneName: opts.droneName, chatName: normalizedChat });
  const agent = inferChatAgent(chat);
  const chatModel = normalizeChatModel((chat as any)?.model);

  const cwdRaw = typeof opts.cwd === 'string' ? opts.cwd : '';
  const defaultCwd = typeof d.cwd === 'string' && d.cwd.trim() ? d.cwd.trim() : '/dvm-data';
  const cwd = cwdRaw ? normalizeContainerPath(cwdRaw) : normalizeContainerPath(defaultCwd);

  if (agent.kind === 'builtin' && agent.id === 'cursor') {
    const chatId = await ensureCursorChatId({ droneName: opts.droneName, containerName: d.name, chatName: normalizedChat });
    const modelArg = chatModel ? ` --model ${bashQuote(chatModel)}` : '';
    const script = [
      'set -euo pipefail',
      `cd ${bashQuote(cwd)}`,
      `agent${modelArg} --resume ${bashQuote(chatId)} -f --approve-mcps --print ${bashQuote(opts.prompt)}`,
    ].join('\n');
    await enqueueTranscriptPrompt({ id: opts.id, drone: d, waitForDaemonMs: opts.waitForDaemonMs, kind: 'cursor', script });
    return { ok: true as const, agent, mode: 'transcript' as const, chat: normalizedChat, turnOk: true as const };
  }

  if (agent.kind === 'builtin' && agent.id === 'codex') {
    const modelArg = chatModel ? ` --model ${bashQuote(chatModel)}` : '';
    const existingThreadId = typeof (chat as any).codexThreadId === 'string' ? String((chat as any).codexThreadId).trim() : '';
    if (!existingThreadId) {
      const script = [
        'set -euo pipefail',
        `cd ${bashQuote(cwd)}`,
        `codex --ask-for-approval never exec${modelArg} --skip-git-repo-check --sandbox danger-full-access --json --color never ${bashQuote(opts.prompt)}`,
      ].join('\n');
      await enqueueTranscriptPrompt({ id: opts.id, drone: d, waitForDaemonMs: opts.waitForDaemonMs, kind: 'codex', script });
      return { ok: true as const, agent, mode: 'transcript' as const, chat: normalizedChat, codexThreadId: null, turnOk: true as const };
    }

    const script = [
      'set -euo pipefail',
      `cd ${bashQuote(cwd)}`,
      `codex --ask-for-approval never exec${modelArg} --skip-git-repo-check --sandbox danger-full-access --json --color never resume ${bashQuote(existingThreadId)} ${bashQuote(opts.prompt)}`,
    ].join('\n');
    await enqueueTranscriptPrompt({ id: opts.id, drone: d, waitForDaemonMs: opts.waitForDaemonMs, kind: 'codex', script });
    return {
      ok: true as const,
      agent,
      mode: 'transcript' as const,
      chat: normalizedChat,
      codexThreadId: existingThreadId,
      turnOk: true as const,
    };
  }

  if (agent.kind === 'builtin' && agent.id === 'claude') {
    const claudeSessionId = await ensureClaudeSessionId({ droneName: opts.droneName, chatName: normalizedChat });
    const supportsModel = chatModel ? await cliSupportsModelFlag({ containerName: d.name, bin: 'claude' }) : false;
    const modelArg = chatModel && supportsModel ? ` --model ${bashQuote(chatModel)}` : '';
    const script = [
      'set -euo pipefail',
      `cd ${bashQuote(cwd)}`,
      `claude --print --dangerously-skip-permissions --output-format text${modelArg} --session-id ${bashQuote(claudeSessionId)} ${bashQuote(opts.prompt)}`,
    ].join('\n');
    await enqueueTranscriptPrompt({ id: opts.id, drone: d, waitForDaemonMs: opts.waitForDaemonMs, kind: 'claude', script });
    return {
      ok: true as const,
      agent,
      mode: 'transcript' as const,
      chat: normalizedChat,
      claudeSessionId,
      turnOk: true as const,
    };
  }

  if (agent.kind === 'builtin' && agent.id === 'opencode') {
    const supportsModel = chatModel ? await cliSupportsModelFlag({ containerName: d.name, bin: 'opencode' }) : false;
    const modelArg = chatModel && supportsModel ? ` --model ${bashQuote(chatModel)}` : '';
    const openCodeSessionId =
      typeof (chat as any).openCodeSessionId === 'string' ? String((chat as any).openCodeSessionId).trim() : '';
    const title = openCodeSessionTitle(opts.droneName, normalizedChat);
    const resumeArg = openCodeSessionId ? ` --session ${bashQuote(openCodeSessionId)}` : '';
    const script = [
      'set -euo pipefail',
      `cd ${bashQuote(cwd)}`,
      `opencode run --format default --title ${bashQuote(title)}${modelArg}${resumeArg} ${bashQuote(opts.prompt)}`,
    ].join('\n');
    await enqueueTranscriptPrompt({ id: opts.id, drone: d, waitForDaemonMs: opts.waitForDaemonMs, kind: 'opencode', script });
    return {
      ok: true as const,
      agent,
      mode: 'transcript' as const,
      chat: normalizedChat,
      openCodeSessionId: openCodeSessionId || null,
      turnOk: true as const,
    };
  }

  // Custom agent: keep tmux-backed full CLI behavior.
  const tmuxCmd = await resolveChatTmuxCommand({ droneName: opts.droneName, chatName: normalizedChat });
  const { sessionName } = await ensureHubChatSessionRunning({
    containerName: d.name,
    chatName: normalizedChat,
    command: tmuxCmd,
    cwd,
  });
  await dvmSessionType(d.name, sessionName, { text: opts.prompt });
  await sleepMs(60);
  await dvmSessionType(d.name, sessionName, { keys: ['C-m'] });
  return { ok: true as const, agent, mode: 'cli' as const, chat: normalizedChat, sessionName, turnOk: true as const };
}

const PROVISIONING_TASKS = new Map<string, Promise<void>>();

const PROVISION_QUEUE: string[] = [];
const PROVISION_QUEUED = new Set<string>();
let PROVISION_ACTIVE = 0;
let PROVISION_PUMPING = false;

// Reconcile pending prompt completion (drone daemon → registry transcript turns).
//
// Without this, the Hub can show a stale "typing" badge for drones whose pending prompts
// have completed in the daemon but haven't been reconciled into registry turns yet.
const RECONCILE_TASKS = new Map<string, Promise<void>>();
const RECONCILE_QUEUE: Array<{ droneName: string; chatName: string }> = [];
const RECONCILE_QUEUED = new Set<string>();
let RECONCILE_ACTIVE = 0;
let RECONCILE_PUMPING = false;

function enqueueProvisioningForAllPending(regAny: any) {
  try {
    const pending = regAny?.pending && typeof regAny.pending === 'object' ? Object.values(regAny.pending) : [];
    for (const p of pending as any[]) {
      const name = String(p?.name ?? '').trim();
      if (!name) continue;
      const phase = String(p?.phase ?? 'starting').trim();
      if (phase === 'error') continue;
      enqueueProvisioning(name);
    }
  } catch {
    // ignore (best-effort)
  }
}

function provisionConcurrencyLimit(): number {
  const raw = String(process.env.DRONE_HUB_PROVISION_CONCURRENCY ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 1) return Math.max(1, Math.min(16, Math.floor(n)));
  return 3;
}

function reconcileConcurrencyLimit(): number {
  const raw = String(process.env.DRONE_HUB_RECONCILE_CONCURRENCY ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 1) return Math.max(1, Math.min(16, Math.floor(n)));
  // Default a bit higher so "Responding" clears quickly even with many drones.
  // You can override via DRONE_HUB_RECONCILE_CONCURRENCY.
  return 6;
}

function removeFromArrayInPlace<T>(arr: T[], pred: (v: T) => boolean): number {
  let removed = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i]!)) {
      arr.splice(i, 1);
      removed += 1;
    }
  }
  return removed;
}

function pumpProvisionQueue() {
  if (PROVISION_PUMPING) return;
  PROVISION_PUMPING = true;
  try {
    const limit = provisionConcurrencyLimit();
    while (PROVISION_ACTIVE < limit && PROVISION_QUEUE.length > 0) {
      const name = PROVISION_QUEUE.shift();
      if (!name) break;
      PROVISION_QUEUED.delete(name);
      if (PROVISIONING_TASKS.has(name)) continue;
      PROVISION_ACTIVE += 1;
      const p = provisionDroneFromPending(name)
        .catch(async (e: any) => {
          // Best-effort: if provisioning throws unexpectedly, surface it in pending state.
          const msg = e?.message ?? String(e);
          await updatePendingDrone(name, { phase: 'error', message: 'Failed to start', error: msg });
        })
        .finally(() => {
          PROVISION_ACTIVE -= 1;
          PROVISIONING_TASKS.delete(name);
          // Keep draining.
          pumpProvisionQueue();
        });
      PROVISIONING_TASKS.set(name, p);
      // Fire-and-forget: backend-driven async provisioning.
      void p;
    }
  } finally {
    PROVISION_PUMPING = false;
  }
}

function enqueueProvisioning(name: string) {
  const n = String(name ?? '').trim();
  if (!n) return;
  if (PROVISIONING_TASKS.has(n)) return;
  if (PROVISION_QUEUED.has(n)) return;
  PROVISION_QUEUED.add(n);
  PROVISION_QUEUE.push(n);
  pumpProvisionQueue();
}

function dequeueProvisioning(name: string) {
  const n = String(name ?? '').trim();
  if (!n) return;
  if (PROVISION_QUEUED.has(n)) {
    PROVISION_QUEUED.delete(n);
    removeFromArrayInPlace(PROVISION_QUEUE, (x) => String(x) === n);
  }
  // If it's already actively provisioning, we cannot safely cancel the spawned process here.
  // Deleting pending will still prevent it from being promoted into `drones` if provisioning checks registry.
}

function pumpReconcileQueue() {
  if (RECONCILE_PUMPING) return;
  RECONCILE_PUMPING = true;
  try {
    const limit = reconcileConcurrencyLimit();
    while (RECONCILE_ACTIVE < limit && RECONCILE_QUEUE.length > 0) {
      const next = RECONCILE_QUEUE.shift();
      if (!next) break;
      const droneName = String(next.droneName ?? '').trim();
      const chatName = String(next.chatName ?? '').trim() || 'default';
      if (!droneName) continue;
      const key = `${droneName}:${chatName}`;
      RECONCILE_QUEUED.delete(key);
      if (RECONCILE_TASKS.has(key)) continue;
      RECONCILE_ACTIVE += 1;
      const p = reconcileChatFromDaemon({ droneName, chatName })
        .catch(() => {
          // ignore (best-effort)
        })
        .finally(() => {
          RECONCILE_ACTIVE -= 1;
          RECONCILE_TASKS.delete(key);
          pumpReconcileQueue();
        });
      RECONCILE_TASKS.set(key, p);
      // Fire-and-forget; the list endpoint will observe results on subsequent polls.
      void p;
    }
  } finally {
    RECONCILE_PUMPING = false;
  }
}

function enqueueReconcile(droneName: string, chatName: string) {
  const dn = String(droneName ?? '').trim();
  const cn = String(chatName ?? '').trim() || 'default';
  if (!dn) return;
  const key = `${dn}:${cn}`;
  if (RECONCILE_TASKS.has(key)) return;
  if (RECONCILE_QUEUED.has(key)) return;
  RECONCILE_QUEUED.add(key);
  RECONCILE_QUEUE.push({ droneName: dn, chatName: cn });
  pumpReconcileQueue();
}

function looksLikeMissingContainerError(msg: string): boolean {
  const s = String(msg ?? '').toLowerCase();
  return (
    s.includes('no such container') ||
    s.includes('not found') ||
    s.includes('unknown container') ||
    s.includes('could not find') ||
    s.includes('does not exist')
  );
}

type PendingPromptState = 'queued' | 'sending' | 'sent' | 'failed';

type PendingPrompt = {
  id: string;
  at: string;
  prompt: string;
  cwd?: string | null;
  state: PendingPromptState;
  error?: string;
  updatedAt?: string;
};

// NOTE: Pending prompts are executed in the drone daemon (tmux-backed) and are restart-resumable.

async function readPendingPrompts(opts: { droneName: string; chatName: string }): Promise<PendingPrompt[]> {
  const regAny: any = await loadRegistry();
  const d = regAny?.drones?.[opts.droneName];
  if (!d) {
    if (regAny?.pending?.[opts.droneName]) throw new Error(`drone "${opts.droneName}" is still starting`);
    throw new Error(`unknown drone: ${opts.droneName}`);
  }
  const chatName = opts.chatName || 'default';
  const entry = d?.chats?.[chatName];
  const list = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
  return list
    .map((p: any) => ({
      id: String(p?.id ?? '').trim(),
      at: String(p?.at ?? '').trim(),
      prompt: String(p?.prompt ?? ''),
      cwd: typeof p?.cwd === 'string' ? String(p.cwd) : p?.cwd === null ? null : undefined,
      state:
        p?.state === 'sent' || p?.state === 'failed' || p?.state === 'sending' || p?.state === 'queued'
          ? (p.state as PendingPromptState)
          : 'sending',
      error: typeof p?.error === 'string' ? p.error : undefined,
      updatedAt: typeof p?.updatedAt === 'string' ? p.updatedAt : undefined,
    }))
    .filter((p: PendingPrompt) => p.id && p.prompt.trim())
    .slice(-50);
}

async function pushPendingPrompt(opts: { droneName: string; chatName: string; pending: PendingPrompt }): Promise<void> {
  await updateRegistry((regAny: any) => {
    const d = regAny?.drones?.[opts.droneName];
    if (!d) throw new Error(`unknown drone: ${opts.droneName}`);
    d.chats = d.chats ?? {};
    const chatName = opts.chatName || 'default';
    const entry = d.chats[chatName] ?? { createdAt: nowIso() };
    entry.pendingPrompts = Array.isArray(entry.pendingPrompts) ? entry.pendingPrompts : [];
    entry.pendingPrompts.push(opts.pending);
    // Keep bounded.
    entry.pendingPrompts = entry.pendingPrompts.slice(-60);
    d.chats[chatName] = entry;
    regAny.drones = regAny.drones ?? {};
    regAny.drones[opts.droneName] = d;
  });
}

async function updatePendingPrompt(opts: {
  droneName: string;
  chatName: string;
  id: string;
  patch: Partial<Pick<PendingPrompt, 'state' | 'error' | 'updatedAt'>>;
}): Promise<void> {
  await updateRegistry((regAny: any) => {
    const d = regAny?.drones?.[opts.droneName];
    if (!d) return;
    const chatName = opts.chatName || 'default';
    const entry = d?.chats?.[chatName];
    const list = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
    const idx = list.findIndex((p: any) => String(p?.id ?? '').trim() === opts.id);
    if (idx === -1) return;
    const cur = list[idx] ?? {};
    list[idx] = { ...cur, ...opts.patch, updatedAt: opts.patch.updatedAt ?? nowIso() };
    entry.pendingPrompts = list;
    d.chats = d.chats ?? {};
    d.chats[chatName] = entry;
    regAny.drones = regAny.drones ?? {};
    regAny.drones[opts.droneName] = d;
  });
}

// Hub-side pump for `pendingPrompts` entries that are persisted but not yet enqueued
// into the drone daemon (state: 'queued'). This is used to preserve session continuity
// for agents where the continuation/session id is only known after the first turn.
const PENDING_PROMPT_PUMP_TASKS = new Map<string, Promise<void>>();
const PENDING_PROMPT_PUMP_QUEUE: Array<{ droneName: string; chatName: string }> = [];
const PENDING_PROMPT_PUMP_QUEUED = new Set<string>();
let PENDING_PROMPT_PUMP_ACTIVE = 0;
let PENDING_PROMPT_PUMP_PUMPING = false;

function pendingPromptPumpConcurrencyLimit(): number {
  const raw = String(process.env.DRONE_HUB_PENDING_PROMPT_PUMP_CONCURRENCY ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 1) return Math.max(1, Math.min(16, Math.floor(n)));
  return 6;
}

async function pumpQueuedPendingPromptsForChat(opts: { droneName: string; chatName: string }): Promise<void> {
  const droneName = String(opts.droneName ?? '').trim();
  const chatName = String(opts.chatName ?? '').trim() || 'default';
  if (!droneName) return;

  // Avoid unbounded loops if state keeps changing due to concurrent requests.
  for (let attempts = 0; attempts < 50; attempts++) {
    const { d, chat } = await getChatEntry({ droneName, chatName });
    const agent = inferChatAgent(chat);
    if (!agent || agent.kind !== 'builtin') return;

    const entry: any = chat;
    const pendingList: any[] = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
    if (pendingList.length === 0) return;

    const turns: any[] = Array.isArray(entry?.turns) ? entry.turns : [];
    const transcriptDoneIds = new Set(turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean));

    const idx = pendingList.findIndex((p: any) => String(p?.state ?? '') === 'queued' && String(p?.id ?? '').trim());
    if (idx === -1) return;

    const p = pendingList[idx] ?? {};
    const id = String(p?.id ?? '').trim();
    const prompt = String(p?.prompt ?? '');
    const cwd = typeof p?.cwd === 'string' ? String(p.cwd) : null;
    if (!id || !prompt.trim()) {
      // Mark invalid entries as failed so they don't block forever.
      await updatePendingPrompt({ droneName, chatName, id, patch: { state: 'failed', error: 'invalid queued prompt' } }).catch(() => {});
      continue;
    }

    const sessionKnown =
      agent.id === 'codex'
        ? Boolean(String(entry?.codexThreadId ?? '').trim())
        : agent.id === 'opencode'
          ? Boolean(String(entry?.openCodeSessionId ?? '').trim())
          : true;
    const prior = pendingList
      .slice(0, idx)
      .map((x: any) => ({ id: String(x?.id ?? '').trim(), state: String(x?.state ?? '') }))
      .filter((x: any) => x.id);
    const defer = shouldDeferQueuedTranscriptPrompt({
      agentId: agent.id,
      sessionKnown,
      priorPendingPrompts: prior,
      transcriptDoneIds,
    });
    if (defer) return;

    // Transition queued -> sending before we attempt any daemon work.
    await updatePendingPrompt({ droneName, chatName, id, patch: { state: 'sending', error: undefined } });

    try {
      const enqueueTimeoutMs = defaultPromptEnqueueTimeoutMs();
      const r: any = await withTimeout(
        sendPromptToChat({ id, droneName, chatName, prompt, cwd, waitForDaemonMs: undefined }),
        enqueueTimeoutMs,
        `queued prompt enqueue failed for ${droneName}/${chatName}`,
      );
      if (r?.turnOk === false) {
        await updatePendingPrompt({
          droneName,
          chatName,
          id,
          patch: { state: 'failed', error: String(r?.error ?? 'failed') },
        });
      } else {
        await updatePendingPrompt({ droneName, chatName, id, patch: { state: 'sent' } });
        // Best-effort: reconcile soon after enqueue to keep UI fresh.
        enqueueReconcile(droneName, chatName);
      }
    } catch (e: any) {
      await updatePendingPrompt({
        droneName,
        chatName,
        id,
        patch: { state: 'failed', error: e?.message ?? String(e) },
      });
    }
  }
}

function pumpPendingPromptQueue() {
  if (PENDING_PROMPT_PUMP_PUMPING) return;
  PENDING_PROMPT_PUMP_PUMPING = true;
  try {
    const limit = pendingPromptPumpConcurrencyLimit();
    while (PENDING_PROMPT_PUMP_ACTIVE < limit && PENDING_PROMPT_PUMP_QUEUE.length > 0) {
      const next = PENDING_PROMPT_PUMP_QUEUE.shift();
      if (!next) break;
      const droneName = String(next.droneName ?? '').trim();
      const chatName = String(next.chatName ?? '').trim() || 'default';
      if (!droneName) continue;
      const key = `${droneName}:${chatName}`;
      PENDING_PROMPT_PUMP_QUEUED.delete(key);
      if (PENDING_PROMPT_PUMP_TASKS.has(key)) continue;
      PENDING_PROMPT_PUMP_ACTIVE += 1;
      const p = pumpQueuedPendingPromptsForChat({ droneName, chatName })
        .catch(() => {
          // ignore (best-effort)
        })
        .finally(() => {
          PENDING_PROMPT_PUMP_ACTIVE -= 1;
          PENDING_PROMPT_PUMP_TASKS.delete(key);
          pumpPendingPromptQueue();
        });
      PENDING_PROMPT_PUMP_TASKS.set(key, p);
      void p;
    }
  } finally {
    PENDING_PROMPT_PUMP_PUMPING = false;
  }
}

function enqueuePendingPromptPump(droneName: string, chatName: string) {
  const dn = String(droneName ?? '').trim();
  const cn = String(chatName ?? '').trim() || 'default';
  if (!dn) return;
  const key = `${dn}:${cn}`;
  if (PENDING_PROMPT_PUMP_TASKS.has(key)) return;
  if (PENDING_PROMPT_PUMP_QUEUED.has(key)) return;
  PENDING_PROMPT_PUMP_QUEUED.add(key);
  PENDING_PROMPT_PUMP_QUEUE.push({ droneName: dn, chatName: cn });
  pumpPendingPromptQueue();
}

function anyActivePendingPromptsForDrone(d: any): boolean {
  const chats = d?.chats && typeof d.chats === 'object' ? Object.values(d.chats) : [];
  for (const c of chats as any[]) {
    const pending = Array.isArray(c?.pendingPrompts) ? c.pendingPrompts : [];
    if (pending.length === 0) continue;
    const turns = Array.isArray(c?.turns) ? c.turns : [];
    const doneIds = new Set(turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean));
    for (const p of pending) {
      const st = String(p?.state ?? '');
      if (st === 'failed') continue;
      const id = String(p?.id ?? '').trim();
      if (!id || !doneIds.has(id)) return true;
    }
  }
  return false;
}

function chatHasReconcilablePendingPrompts(entry: any): boolean {
  const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
  if (pending.length === 0) return false;
  const turns = Array.isArray(entry?.turns) ? entry.turns : [];
  const doneIds = new Set(turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean));
  for (const p of pending) {
    const st = String(p?.state ?? '');
    if (st === 'failed') continue;
    // `queued` entries haven't been enqueued into the daemon yet, so there's nothing
    // to reconcile from daemon → transcript for them.
    if (st === 'queued') continue;
    const id = String(p?.id ?? '').trim();
    if (!id) continue;
    if (!doneIds.has(id)) return true;
  }
  return false;
}

async function reconcileChatFromDaemon(opts: { droneName: string; chatName: string }): Promise<void> {
  const regAny: any = await loadRegistry();
  const d = regAny?.drones?.[opts.droneName];
  if (!d) return;
  const token = typeof d.token === 'string' ? d.token : '';
  const hostPort =
    typeof d.hostPort === 'number' && Number.isFinite(d.hostPort)
      ? d.hostPort
      : await resolveHostPort(d.name, d.containerPort);
  if (!hostPort || !token) return;

  const entry = d?.chats?.[opts.chatName];
  if (!entry) return;
  const agent = inferChatAgent(entry);
  if (!agent || agent.kind !== 'builtin') return;

  const pendingList: any[] = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
  if (pendingList.length === 0) return;

  const turns: any[] = Array.isArray(entry?.turns) ? entry.turns : [];
  const transcriptIds = new Set(turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean));

  const client = makeClient(hostPort, token);
  let changed = false;
  for (let i = 0; i < pendingList.length; i++) {
    const p = pendingList[i] ?? {};
    const id = String(p?.id ?? '').trim();
    const state = String(p?.state ?? '');
    if (!id) continue;
    if (state === 'queued') continue;

    // If already in transcript, nothing to do.
    if (transcriptIds.has(id)) {
      if (state !== 'sent') {
        pendingList[i] = { ...p, state: 'sent', updatedAt: nowIso() };
        changed = true;
      }
      continue;
    }
    if (state === 'failed' && agent.id !== 'codex') continue;

    let jobResp: any = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      jobResp = await dronePromptGet(client, id);
    } catch {
      // If the daemon doesn't know about it yet, leave as-is.
      continue;
    }
    const job = jobResp?.job ?? null;
    const jobState = String(job?.state ?? '').trim();
    if (jobState === 'queued' || jobState === 'running') {
      if (state !== 'sent') {
        pendingList[i] = { ...p, state: 'sent', updatedAt: nowIso() };
        changed = true;
      }
      continue;
    }

    if (jobState === 'done') {
      const stdout = typeof job?.stdout === 'string' ? job.stdout : '';
      const stderr = typeof job?.stderr === 'string' ? job.stderr : '';
      const finishedAt = typeof job?.finishedAt === 'string' ? job.finishedAt : nowIso();
      const promptAt =
        typeof p?.at === 'string' && String(p.at).trim()
          ? String(p.at).trim()
          : typeof job?.startedAt === 'string' && String(job.startedAt).trim()
            ? String(job.startedAt).trim()
            : finishedAt;
      if (agent.id === 'codex') {
        const parsed = parseCodexJsonl(stdout || '');
        const threadId = parsed.threadId;
        const msg = parsed.message;
        if (threadId) {
          entry.codexThreadId = threadId;
          changed = true;
        }
        const output = String(msg ?? '').trimEnd();
        if (!output) {
          pendingList[i] = { ...p, state: 'failed', error: 'codex finished but no message was parsed', updatedAt: nowIso() };
          changed = true;
          continue;
        }
        // Record transcript turn (success).
        turns.push({ at: promptAt, promptAt, completedAt: finishedAt, id, prompt: String(p?.prompt ?? ''), ok: true, output });
        transcriptIds.add(id);
        pendingList[i] = { ...p, state: 'sent', updatedAt: nowIso() };
        changed = true;
        continue;
      }

      if (
        agent.id === 'opencode' &&
        !(typeof entry?.openCodeSessionId === 'string' && String(entry.openCodeSessionId).trim())
      ) {
        // Best-effort: discover session id after first successful run, so future turns
        // can continue the exact same OpenCode session.
        const openCodeSessionId =
          (await ensureOpenCodeSessionId({
            droneName: opts.droneName,
            containerName: d.name,
            chatName: opts.chatName,
          }).catch(() => null)) ?? null;
        if (openCodeSessionId) {
          entry.openCodeSessionId = openCodeSessionId;
          changed = true;
        }
      }

      // Non-Codex builtins: treat stdout as final output.
      const output = (stdout || stderr || '').trimEnd();
      turns.push({
        at: promptAt,
        promptAt,
        completedAt: finishedAt,
        id,
        prompt: String(p?.prompt ?? ''),
        ok: true,
        output: output || '(no output)',
      });
      transcriptIds.add(id);
      pendingList[i] = { ...p, state: 'sent', updatedAt: nowIso() };
      changed = true;
      continue;
    }

    if (jobState === 'failed') {
      if (agent.id === 'codex') {
        const stdout = String(job?.stdout ?? '');
        const stderr = String(job?.stderr ?? '');
        const parsed = parseCodexJsonl(stdout);
        const output = String(parsed.message ?? '').trimEnd();
        const finishedAt = typeof job?.finishedAt === 'string' ? job.finishedAt : nowIso();
        const promptAt =
          typeof p?.at === 'string' && String(p.at).trim()
            ? String(p.at).trim()
            : typeof job?.startedAt === 'string' && String(job.startedAt).trim()
              ? String(job.startedAt).trim()
              : finishedAt;
        if (parsed.threadId) {
          entry.codexThreadId = parsed.threadId;
          changed = true;
        }
        // Self-heal false failed states (daemon finalized too early) by trusting
        // completed Codex output when it is present in the persisted job payload.
        if (output) {
          turns.push({
            at: promptAt,
            promptAt,
            completedAt: finishedAt,
            id,
            prompt: String(p?.prompt ?? ''),
            ok: true,
            output,
          });
          transcriptIds.add(id);
          pendingList[i] = { ...p, state: 'sent', error: undefined, updatedAt: nowIso() };
          changed = true;
          continue;
        }
      }
      let errText =
        String(job?.error ?? '').trim() ||
        String(job?.stderr ?? '').trim() ||
        String(job?.stdout ?? '').trim() ||
        'failed';
      if (agent.id === 'codex') {
        errText = formatCodexJobFailure(
          String(job?.stdout ?? ''),
          String(job?.stderr ?? ''),
          errText,
        );
      }
      pendingList[i] = { ...p, state: 'failed', error: errText, updatedAt: nowIso() };
      changed = true;
      continue;
    }
  }

  if (changed) {
    entry.turns = turns;
    entry.pendingPrompts = pendingList;
    d.chats = d.chats ?? {};
    d.chats[opts.chatName] = entry;
    regAny.drones[opts.droneName] = d;
    await updateRegistry((regLatest: any) => {
      const dLatest = regLatest?.drones?.[opts.droneName];
      if (!dLatest) return;
      dLatest.chats = dLatest.chats ?? {};
      const cur = dLatest.chats[opts.chatName] ?? { createdAt: nowIso() };
      // Preserve other chat metadata, but apply transcript + pending updates atomically.
      cur.turns = turns;
      cur.pendingPrompts = pendingList;
      if (entry && typeof entry === 'object' && typeof (entry as any).codexThreadId === 'string' && String((entry as any).codexThreadId).trim()) {
        cur.codexThreadId = String((entry as any).codexThreadId).trim();
      }
      if (entry && typeof entry === 'object' && typeof (entry as any).claudeSessionId === 'string' && String((entry as any).claudeSessionId).trim()) {
        cur.claudeSessionId = String((entry as any).claudeSessionId).trim();
      }
      if (entry && typeof entry === 'object' && typeof (entry as any).openCodeSessionId === 'string' && String((entry as any).openCodeSessionId).trim()) {
        cur.openCodeSessionId = String((entry as any).openCodeSessionId).trim();
      }
      dLatest.chats[opts.chatName] = cur;
      regLatest.drones = regLatest.drones ?? {};
      regLatest.drones[opts.droneName] = dLatest;
    });

    // Best-effort: session ids may have been established (codexThreadId/openCodeSessionId)
    // or a prior prompt may have completed/failed, unblocking queued follow-ups.
    enqueuePendingPromptPump(opts.droneName, opts.chatName);
  }
}

async function enqueuePrompt(opts: {
  droneName: string;
  chatName: string;
  prompt: string;
  cwd?: string | null;
  waitForDaemonMs?: number;
}): Promise<{ id: string }> {
  const id = crypto.randomBytes(9).toString('hex');
  const at = nowIso();
  const chatName = normalizeChatName(opts.chatName);

  // Make sure chat exists before we write pending state.
  await ensureChatEntry({ droneName: opts.droneName, chatName });
  const { chat } = await getChatEntry({ droneName: opts.droneName, chatName });
  const agent = inferChatAgent(chat);
  const turns: any[] = Array.isArray((chat as any)?.turns) ? (chat as any).turns : [];
  const transcriptDoneIds = new Set(turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean));
  const priorPending: any[] = Array.isArray((chat as any)?.pendingPrompts) ? (chat as any).pendingPrompts : [];
  const sessionKnown =
    agent.kind !== 'builtin'
      ? true
      : agent.id === 'codex'
        ? Boolean(String((chat as any)?.codexThreadId ?? '').trim())
        : agent.id === 'opencode'
          ? Boolean(String((chat as any)?.openCodeSessionId ?? '').trim())
          : true;
  // Preserve prompt ordering: if earlier prompts are still hub-queued, queue this prompt too.
  const hasPriorQueued = priorPending.some((p: any) => String(p?.state ?? '') === 'queued');
  const defer =
    hasPriorQueued ||
    (agent.kind === 'builtin'
      ? shouldDeferQueuedTranscriptPrompt({
          agentId: agent.id,
          sessionKnown,
          priorPendingPrompts: priorPending
            .map((p: any) => ({ id: String(p?.id ?? '').trim(), state: String(p?.state ?? '') }))
            .filter((p: any) => p.id),
          transcriptDoneIds,
        })
      : false);

  await pushPendingPrompt({
    droneName: opts.droneName,
    chatName,
    pending: { id, at, prompt: opts.prompt, cwd: opts.cwd ?? null, state: defer ? 'queued' : 'sending', updatedAt: at },
  });

  if (defer) {
    // Persisted as queued; a reconcile/update that establishes session id will pump it.
    enqueuePendingPromptPump(opts.droneName, chatName);
    return { id };
  }

  try {
    const enqueueTimeoutMs = Math.max(
      defaultPromptEnqueueTimeoutMs(),
      (typeof opts.waitForDaemonMs === 'number' && Number.isFinite(opts.waitForDaemonMs) ? Math.floor(opts.waitForDaemonMs) : 0) +
        30_000,
    );
    // Enqueue work in the drone daemon (restart-resumable).
    // eslint-disable-next-line no-await-in-loop
    const r: any = await withTimeout(
      sendPromptToChat({
        id,
        droneName: opts.droneName,
        chatName,
        prompt: opts.prompt,
        cwd: opts.cwd ?? null,
        waitForDaemonMs: opts.waitForDaemonMs,
      }),
      enqueueTimeoutMs,
      `prompt enqueue failed for ${opts.droneName}/${chatName}`,
    );
    if (r?.turnOk === false) {
      await updatePendingPrompt({
        droneName: opts.droneName,
        chatName,
        id,
        patch: { state: 'failed', error: String(r?.error ?? 'failed') },
      });
    } else {
      await updatePendingPrompt({ droneName: opts.droneName, chatName, id, patch: { state: 'sent' } });
    }
  } catch (e: any) {
    await updatePendingPrompt({
      droneName: opts.droneName,
      chatName,
      id,
      patch: { state: 'failed', error: e?.message ?? String(e) },
    });
  }

  // Best-effort: if there are any deferred follow-ups, try to enqueue now.
  enqueuePendingPromptPump(opts.droneName, chatName);
  return { id };
}

async function provisionDroneFromPending(name: string) {
  const regAny: any = await loadRegistry();
  const pending = regAny?.pending?.[name];
  if (!pending) return;
  if (regAny?.drones?.[name]) {
    // Drone already exists; clear pending to avoid duplicates.
    await updateRegistry((regLatest: any) => {
      if (regLatest?.pending?.[name]) delete regLatest.pending[name];
    });
    return;
  }

  const repoPath = String(pending.repoPath ?? '').trim();
  const group = typeof pending.group === 'string' ? pending.group.trim() : '';
  const build = Boolean(pending.build);
  const containerPort = typeof pending.containerPort === 'number' && Number.isFinite(pending.containerPort) ? pending.containerPort : null;
  const cloneFrom = typeof pending.cloneFrom === 'string' ? pending.cloneFrom.trim() : '';
  const cloneChats = pending.cloneChats !== false;

  await updatePendingDrone(name, { phase: 'creating', message: 'Creating container…' });

  const droneCli = resolveDroneCliPath();
  const repoArg = repoPath ? repoPath : '-';
  const args: string[] = [droneCli, 'create', name, '--repo', repoArg];
  if (group) args.push('--group', group);
  if (!build) args.push('--no-build');
  if (containerPort != null) args.push('--container-port', String(containerPort));

  const r = await runNodeCli(args);
  if (r.code !== 0) {
    const errText = (r.stderr || r.stdout || `drone create failed (exit ${r.code})`).trim();
    // If the container already exists (often due to a prior partial run),
    // try to import it into the registry and continue.
    if (/already exists/i.test(errText)) {
      await updatePendingDrone(name, { phase: 'creating', message: 'Container exists; importing…' });
      const impArgs: string[] = [droneCli, 'import', name, '--repo', repoPath];
      if (group) impArgs.push('--group', group);
      if (containerPort != null) impArgs.push('--container-port', String(containerPort));
      const imp = await runNodeCli(impArgs);
      if (imp.code !== 0) {
        const impErr = (imp.stderr || imp.stdout || `drone import failed (exit ${imp.code})`).trim();
        await updatePendingDrone(name, { phase: 'error', message: 'Failed to start', error: `${errText}\n\nImport also failed:\n${impErr}` });
        return;
      }
      // Import succeeded; proceed to seeding step below.
    } else {
      await updatePendingDrone(name, { phase: 'error', message: 'Failed to start', error: errText });
      return;
    }
  }

  // If this drone is repo-attached, seed the container with the host repo before we enqueue any seed prompt.
  // This uses dvm's offline repo workflow (no host bind mount).
  if (repoPath) {
    await setDroneHubMeta(name, { phase: 'seeding', message: 'Seeding repo…' });
    try {
      const repoRoot = await gitTopLevel(repoPath);
      const baseRef = await gitCurrentBranchOrSha(repoRoot);

      await dvmRepoSeed({
        container: name,
        hostPath: repoRoot,
        dest: '/work/repo',
        baseRef: 'HEAD',
        branch: 'dvm/work',
        clean: true,
        timeoutMs: defaultRepoSeedTimeoutMs(),
      });

      // Persist canonical repo root + baseRef for future pulls.
      await updateRegistry((reg2: any) => {
        const d = reg2?.drones?.[name];
        if (!d) return;
        d.repoPath = repoRoot;
        // Default repo-attached drones to operate inside the container repo.
        d.cwd = '/work/repo';
        d.repo = d.repo ?? {};
        d.repo.dest = '/work/repo';
        d.repo.branch = 'dvm/work';
        d.repo.baseRef = baseRef;
        d.repo.seededAt = nowIso();
        reg2.drones = reg2.drones ?? {};
        reg2.drones[name] = d;
      });

      await setDroneHubMeta(name, null);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      await setDroneHubMeta(name, { phase: 'error', message: `Repo seed failed: ${msg}` });
      return;
    }
  }

  // Move from pending → drones and optionally seed.
  const seed = await updateRegistry((regLatest: any) => {
    const seed = regLatest?.pending?.[name]?.seed ?? pending.seed ?? null;
    if (regLatest?.pending?.[name]) delete regLatest.pending[name];
    return seed;
  });

  // Optional: clone chats/transcripts from an existing drone into this newly-created one.
  // This is best-effort and does NOT copy daemon-specific continuation IDs
  // (e.g. codexThreadId/chatId/claudeSessionId/openCodeSessionId).
  if (cloneFrom && cloneChats) {
    try {
      await updateRegistry((reg3Any: any) => {
        const src = reg3Any?.drones?.[cloneFrom];
        const dst = reg3Any?.drones?.[name];
        const srcChats = src?.chats && typeof src.chats === 'object' ? src.chats : null;
        if (!src || !dst || !srcChats) return;
        const cloned: any = {};
        for (const [chatName, entryRaw] of Object.entries(srcChats)) {
          const entry: any = entryRaw ?? {};
          const agent = inferChatAgent(entry);
          const model = normalizeChatModel(entry?.model);
          const createdAt = typeof entry?.createdAt === 'string' && entry.createdAt.trim() ? String(entry.createdAt) : nowIso();
          const turns = Array.isArray(entry?.turns) ? JSON.parse(JSON.stringify(entry.turns)) : undefined;
          cloned[String(chatName)] = {
            createdAt,
            agent,
            ...(model ? { model } : {}),
            ...(turns ? { turns } : {}),
          };
        }
        dst.chats = dst.chats ?? {};
        dst.chats = { ...dst.chats, ...cloned };
        reg3Any.drones = reg3Any.drones ?? {};
        reg3Any.drones[name] = dst;
      });
    } catch {
      // ignore (best-effort)
    }
  }

  if (!seed) return;

  const chatName = normalizeChatName(seed.chatName);
  const prompt = String(seed.prompt ?? '').trim();
  const seedAgent = parseSeedAgent(seed.agent);
  const seedModel = normalizeChatModel(seed.model);

  if (!seedAgent && !seedModel && !prompt) return;

  // Mark hub state on the real drone entry so the UI can show progress during seeding.
  await setDroneHubMeta(name, { phase: 'seeding', message: prompt ? 'Seeding initial message…' : 'Configuring agent…' });
  try {
    if (seedAgent || seedModel) {
      await ensureChatEntry({ droneName: name, chatName });
      await setChatAgentConfig({
        droneName: name,
        chatName,
        ...(seedAgent ? { agent: seedAgent } : {}),
        setModel: true,
        model: seedModel,
      });
    }
    if (prompt) {
      // Use the same pending-prompt mechanism as normal chat sends so the UI can show
      // the user's seed message immediately, then replace it with the final transcript turn.
      const cwd = typeof seed.cwd === 'string' ? seed.cwd : null;
      // Initial seed prompts can race daemon startup on cold containers; allow longer readiness wait.
      const seedPromptWaitMs = Math.max(defaultDaemonReadyTimeoutMs(), 120_000);
      await enqueuePrompt({ droneName: name, chatName, prompt, cwd, waitForDaemonMs: seedPromptWaitMs });
      // Once the prompt is enqueued, switch from "seeding" to the normal busy/pending-prompt UI.
      await setDroneHubMeta(name, null);
      return;
    }
    await setDroneHubMeta(name, null);
  } catch (e: any) {
    await setDroneHubMeta(name, { phase: 'error', message: e?.message ?? String(e) });
  }
}

function resolveDroneCliPath(): string {
  // dist/hub -> dist/cli.js
  return path.resolve(__dirname, '..', 'cli.js');
}

function resolveDroneDaemonJsPath(): string {
  // dist/hub -> dist/daemon.js
  return path.resolve(__dirname, '..', 'daemon.js');
}

function isNotFoundErrorMessage(msg: string): boolean {
  const s = String(msg ?? '').trim().toLowerCase();
  return s.startsWith('404') || s === 'not found' || s.includes('not found');
}

async function upgradeDroneDaemonInContainer(opts: { containerName: string; containerPort: number }) {
  // Install latest daemon.js into /dvm-data/drone/daemon.js and restart the tmux session.
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
  const tmpPath = `/tmp/drone-hub-install-daemon-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sh`;
  await fs.writeFile(tmpPath, installScript, { mode: 0o700 });
  try {
    await dvmScript(opts.containerName, tmpPath);
  } finally {
    try {
      await fs.rm(tmpPath, { force: true });
    } catch {
      // ignore
    }
  }

  // Restart daemon session so new code is loaded.
  await dvmExec(opts.containerName, 'bash', ['-lc', 'tmux kill-session -t drone-daemon 2>/dev/null || true']);
  await dvmSessionStart(
    opts.containerName,
    'drone-daemon',
    'bash',
    ['-lc', `node /dvm-data/drone/daemon.js --host 0.0.0.0 --port ${opts.containerPort} --data-dir /dvm-data/drone --token-file /dvm-data/drone/token`],
    true
  );
}

async function dockerContainerId(name: string): Promise<string> {
  const container = String(name || '').trim();
  if (!container) throw new Error('missing container name');
  const r = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn('docker', ['inspect', '-f', '{{.Id}}', container], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.once('error', (err: any) => resolve({ code: 127, stdout, stderr: `${stderr}${err?.message ?? String(err)}` }));
    child.once('close', (code) => resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr }));
  });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `docker inspect ${container} failed`).trim());
  const id = String(r.stdout || '').trim();
  if (!/^[0-9a-f]{12,64}$/i.test(id)) throw new Error(`unexpected docker id: ${id || '(empty)'}`);
  return id;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(p: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fileExists(p)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return await fileExists(p);
}

function appleScriptQuote(s: string): string {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function spawnTerminalWithBash(
  script: string,
  opts?: { terminal?: string | null; markerPath?: string | null }
): Promise<{ ok: true; launcher: string } | { ok: false; error: string }> {
  const platform = process.platform;
  const requestedRaw = String(opts?.terminal ?? '').trim();
  const requested = requestedRaw === 'terminal' ? 'osascript' : requestedRaw;
  const candidates: Array<{ cmd: string; args: string[] }> = (() => {
    if (platform === 'linux') {
      const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
      if (!hasDisplay) return [];
      return [
        // Prefer terminals that don't depend on a desktop DBus service.
        { cmd: 'kitty', args: ['bash', '-lc', script] },
        { cmd: 'xterm', args: ['-e', 'bash', '-lc', script] },
        // Then system/default emulator choices.
        //
        // NOTE: on Ubuntu/Debian, x-terminal-emulator is often gnome-terminal.wrapper, which does NOT support `-e`.
        // So we try the modern `-- COMMAND...` form first, then fall back to `-e` for emulators that still use it.
        { cmd: 'x-terminal-emulator', args: ['--window', '--', 'bash', '-lc', script] },
        { cmd: 'x-terminal-emulator', args: ['--', 'bash', '-lc', script] },
        { cmd: 'x-terminal-emulator', args: ['-e', 'bash', '-lc', script] },
        // gnome-terminal: try to avoid factory/server handoff issues.
        // Some environments "launch" gnome-terminal but drop the requested command.
        { cmd: 'gnome-terminal', args: ['--disable-factory', '--wait', '--window', '--', 'bash', '-lc', script] },
        { cmd: 'gnome-terminal', args: ['--wait', '--window', '--', 'bash', '-lc', script] },
        { cmd: 'gnome-terminal', args: ['--wait', '--', 'bash', '-lc', script] },
        { cmd: 'konsole', args: ['-e', 'bash', '-lc', script] },
        { cmd: 'alacritty', args: ['-e', 'bash', '-lc', script] },
      ];
    }

    if (platform === 'darwin') {
      const shellCmd = `bash -lc ${bashQuote(script)}`;
      return [
        {
          cmd: 'osascript',
          args: [
            '-e',
            `tell application "Terminal" to do script "${appleScriptQuote(shellCmd)}"`,
            '-e',
            'tell application "Terminal" to activate',
          ],
        },
      ];
    }

    if (platform === 'win32') {
      const psScript = `bash -lc '${String(script).replace(/'/g, "''")}'`;
      return [
        { cmd: 'wt', args: ['bash', '-lc', script] },
        { cmd: 'powershell.exe', args: ['-NoExit', '-Command', psScript] },
        { cmd: 'pwsh', args: ['-NoExit', '-Command', psScript] },
      ];
    }

    return [];
  })();

  if (platform === 'linux' && candidates.length === 0) {
    return { ok: false, error: 'No DISPLAY/WAYLAND_DISPLAY set; cannot spawn a GUI terminal.' };
  }
  if (candidates.length === 0) {
    return { ok: false, error: `Terminal launching is not supported on platform: ${platform}` };
  }

  const primary =
    requested && requested !== 'auto' ? candidates.filter((c) => c.cmd === requested) : candidates;

  if (requested && requested !== 'auto' && primary.length === 0) {
    return { ok: false, error: `Unknown terminal: ${requested}` };
  }

  // Marker file is used to confirm the terminal actually started `bash -lc <script>`.
  // Some terminals (notably gnome-terminal wrappers) can "spawn" successfully but fail to
  // launch a window/command due to DBus/session issues, while still returning 0.
  const markerPath = opts?.markerPath ? String(opts.markerPath) : null;

  const errors: string[] = [];
  const tryList = async (list: Array<{ cmd: string; args: string[] }>): Promise<{ ok: true; launcher: string } | null> => {
    for (const c of list) {
      // Remove any prior marker.
      if (markerPath) {
        try {
          await fs.rm(markerPath, { force: true });
        } catch {
          // ignore
        }
      }

      const result = await new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
        let settled = false;
        const done = (v: { ok: true } | { ok: false; error: string }) => {
          if (settled) return;
          settled = true;
          resolve(v);
        };

        const child = spawn(c.cmd, c.args, { detached: true, stdio: 'ignore', env: process.env });
        let exited = false;
        let exitCode: number | null = null;
        let exitSignal: NodeJS.Signals | null = null;

        child.once('exit', (code, signal) => {
          exited = true;
          exitCode = typeof code === 'number' ? code : null;
          exitSignal = signal ?? null;
        });

        child.once('spawn', () => {
          // Some terminal emulators will spawn then immediately exit non-zero if they can't
          // connect to the GUI session (DBus/DISPLAY/etc). Give it a brief window to fail,
          // otherwise treat as success and detach.
          setTimeout(() => {
            if (exited) {
              if (exitCode != null && exitCode !== 0) {
                done({ ok: false, error: `exited with code ${exitCode}${exitSignal ? ` (signal ${exitSignal})` : ''}` });
                return;
              }
              if (exitCode == null && exitSignal) {
                done({ ok: false, error: `exited by signal ${exitSignal}` });
                return;
              }
            }
            if (exited && exitCode == null && !exitSignal) {
              done({ ok: false, error: 'exited immediately' });
              return;
            }
            try {
              child.unref();
            } catch {
              // ignore
            }
            done({ ok: true });
          }, 800);
        });
        child.once('error', (err: any) => {
          done({ ok: false, error: err?.message ?? String(err) });
        });
      });

      if (result.ok) {
        if (markerPath) {
          const markerTimeoutMs =
            c.cmd === 'gnome-terminal' || c.cmd === 'x-terminal-emulator' ? 15000 : c.cmd === 'osascript' ? 12000 : 6000;
          const started = await waitForFile(markerPath, markerTimeoutMs);
          if (!started) {
            errors.push(`${c.cmd}: launched but did not start command (no marker)`);
            // Avoid launching additional windows when one terminal already opened but dropped
            // the command. Return a failure so the UI can offer manual fallback instead.
            return null;
          }
          try {
            await fs.rm(markerPath, { force: true });
          } catch {
            // ignore
          }
        }
        return { ok: true, launcher: `${c.cmd} ${c.args.join(' ')}` };
      }

      errors.push(`${c.cmd}: ${result.error}`);
    }

    return null;
  };

  const primaryOk = await tryList(primary);
  if (primaryOk) return primaryOk;

  return {
    ok: false,
    error:
      `Failed to launch a terminal emulator.${requested && requested !== 'auto' ? ` Requested: ${requested}.` : ''}\n\n` +
      errors.join('\n'),
  };
}

async function removeDroneByName(opts: { name: string; keepVolume: boolean; forget: boolean }) {
  const regSnapshot: any = await loadRegistry();
  const droneEntry = regSnapshot?.drones?.[opts.name] ?? null;
  const hadEntry = Boolean(droneEntry);
  const repoPathRaw = String(droneEntry?.repoPath ?? '').trim();

  let removeErr: string | null = null;
  let containerGone = false;

  // Deleting a drone can be racy: `dvm rm` may stop a container and then fail to remove it,
  // requiring a follow-up remove. The UI currently needs a second click in that case.
  // We retry here to make DELETE idempotent and "one click".
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await dvmRemove(opts.name, { keepVolume: opts.keepVolume });
      containerGone = true;
      removeErr = null;
      break;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (looksLikeMissingContainerError(msg)) {
        // If the container is already gone, treat as success and still clean registry metadata.
        containerGone = true;
        removeErr = null;
        break;
      }

      // Best-effort: if the remove errored but the container is actually gone, also treat as success.
      // eslint-disable-next-line no-await-in-loop
      const exists = await dvmContainerExists(opts.name);
      if (!exists) {
        containerGone = true;
        removeErr = null;
        break;
      }

      removeErr = msg;
      if (attempt < maxAttempts) {
        // eslint-disable-next-line no-await-in-loop
        await sleepMs(500);
      }
    }
  }

  if (containerGone && hadEntry && repoPathRaw) {
    try {
      const repoRoot = await gitTopLevel(repoPathRaw);
      const quarantineBranch = `quarantine/${opts.name}`;
      const wt = quarantineWorktreePath(repoRoot, opts.name);
      await cleanupQuarantineWorktree({ repoRoot, worktreePath: wt, branch: quarantineBranch });
    } catch {
      // Ignore quarantine cleanup failures during delete.
    }
  }

  let removedRegistry = false;
  // Only forget registry metadata once the container is actually gone.
  // Otherwise we can strand a drone in an "offline but still present" state that is harder to delete by group.
  if (hadEntry && opts.forget && containerGone) {
    removedRegistry = await updateRegistry((reg: any) => {
      if (reg?.drones?.[opts.name]) {
        delete reg.drones[opts.name];
        return true;
      }
      return false;
    });
  }

  return { hadEntry, removedRegistry, removeErr };
}

async function renameDroneByName(opts: {
  oldName: string;
  newName: string;
  startMode?: 'preserve' | 'always' | 'never';
  migrateVolumeName?: boolean;
}) {
  const oldName = String(opts.oldName ?? '').trim();
  const newName = String(opts.newName ?? '').trim();
  const startMode = opts.startMode ?? 'preserve';
  const migrateVolumeName = Boolean(opts.migrateVolumeName);

  const regSnapshot: any = await loadRegistry();
  const dronesObj = regSnapshot?.drones && typeof regSnapshot.drones === 'object' ? regSnapshot.drones : {};
  let oldKey = oldName;
  let oldEntry = dronesObj?.[oldKey] ?? null;
  if (!oldEntry) {
    const matches = Object.entries(dronesObj).filter(([, v]) => String((v as any)?.name ?? '').trim() === oldName);
    if (matches.length === 1) {
      oldKey = String(matches[0]?.[0] ?? oldName);
      oldEntry = matches[0]?.[1] ?? null;
    } else if (matches.length > 1) {
      return { ok: false as const, status: 409, error: `multiple registry entries match drone name: ${oldName}` };
    }
  }
  if (!oldEntry) {
    if (regSnapshot?.pending?.[oldName]) {
      return { ok: false as const, status: 409, error: `drone "${oldName}" is still starting` };
    }
    return { ok: false as const, status: 404, error: `unknown drone: ${oldName}` };
  }
  if (dronesObj?.[newName]) {
    return { ok: false as const, status: 409, error: `drone already exists: ${newName}` };
  }
  if (Object.values(dronesObj).some((v) => String((v as any)?.name ?? '').trim() === newName)) {
    return { ok: false as const, status: 409, error: `drone already exists: ${newName}` };
  }
  if (regSnapshot?.pending?.[newName]) {
    return { ok: false as const, status: 409, error: `cannot rename to ${newName}: pending drone already exists` };
  }

  const sourceContainerName = String(oldEntry?.name ?? oldName).trim() || oldName;
  await dvmRename(sourceContainerName, newName, { startMode, migrateVolumeName });

  let hostPort: number | null = null;
  try {
    hostPort = await resolveHostPort(newName, Number(oldEntry?.containerPort ?? 7777));
  } catch {
    hostPort = Number.isFinite(Number(oldEntry?.hostPort)) ? Number(oldEntry.hostPort) : null;
  }

  try {
    await updateRegistry((regAny: any) => {
      const regDrones = regAny?.drones && typeof regAny.drones === 'object' ? regAny.drones : {};
      const cur = regDrones?.[oldKey] ?? regDrones?.[oldName];
      if (!cur) throw new Error(`drone disappeared from registry during rename: ${oldName}`);
      if (regDrones?.[newName]) throw new Error(`drone already exists in registry: ${newName}`);
      delete regAny.drones[oldKey];
      if (oldName !== oldKey) delete regAny.drones[oldName];
      cur.name = newName;
      if (typeof hostPort === 'number' && Number.isFinite(hostPort)) cur.hostPort = hostPort;
      regAny.drones[newName] = cur;

      // Keep queued clone workflows coherent if they referenced the old name.
      if (regAny?.pending && typeof regAny.pending === 'object') {
        for (const p of Object.values(regAny.pending) as any[]) {
          if (String(p?.cloneFrom ?? '').trim() === oldName) {
            p.cloneFrom = newName;
          }
        }
      }
    });
  } catch (e) {
    // Best-effort rollback if host registry update fails after the container rename.
    try {
      await dvmRename(newName, sourceContainerName, { startMode: 'preserve', migrateVolumeName: false });
    } catch {
      // ignore rollback failure; return original error
    }
    throw e;
  }

  return {
    ok: true as const,
    oldName,
    newName,
    hostPort,
    containerPort: Number(oldEntry?.containerPort ?? 7777),
  };
}

async function resolveHostPort(container: string, containerPort: number): Promise<number | null> {
  try {
    const ports = await dvmPorts(container);
    const match = ports.find((p) => p.containerPort === containerPort);
    return match ? match.hostPort : null;
  } catch {
    return null;
  }
}

function makeClient(hostPort: number, token: string) {
  return { baseUrl: `http://127.0.0.1:${hostPort}`, token };
}

function resolveHubAgentCommand(): string {
  // CLI-agnostic by design: this is just a command run inside tmux.
  // Override via env for other CLIs (e.g. "my-agent --foo").
  return String(process.env.DRONE_HUB_AGENT_CMD ?? '').trim() || 'agent --approve-mcps';
}

function resolveBuiltinTmuxCommand(agent: ChatAgentConfig['id']): string {
  if (agent === 'cursor') {
    return String(process.env.DRONE_HUB_CURSOR_CMD ?? '').trim() || 'agent --approve-mcps';
  }
  if (agent === 'codex') {
    return String(process.env.DRONE_HUB_CODEX_CMD ?? '').trim() || 'codex';
  }
  if (agent === 'claude') {
    return String(process.env.DRONE_HUB_CLAUDE_CMD ?? '').trim() || 'claude';
  }
  if (agent === 'opencode') {
    return String(process.env.DRONE_HUB_OPENCODE_CMD ?? '').trim() || 'opencode';
  }
  return resolveHubAgentCommand();
}

function resolveHubTerminalShellCommand(): string {
  // Keep the in-app shell minimal by default (no login banner / host-heavy prompt).
  // Users can override this via DRONE_HUB_SHELL_CMD.
  return String(process.env.DRONE_HUB_SHELL_CMD ?? '').trim() || 'bash --noprofile --rcfile /tmp/.drone-hub-shell-rc -i';
}

function hubChatSessionName(chatName: string): string {
  return `drone-hub-chat-${sanitizeTmuxSessionName(chatName || 'default')}`;
}

function hubShellSessionName(): string {
  return 'drone-hub-shell';
}

const HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES = 300;
const HUB_WEB_TERMINAL_MAX_TAIL_LINES = 1000;
const HUB_WEB_TERMINAL_MAX_BYTES = 200_000;
const HUB_WEB_TERMINAL_WS_INPUT_FLUSH_MS = 24;
const HUB_WEB_TERMINAL_WS_INPUT_BURST_BYTES = 1024;
const HUB_WEB_TERMINAL_WS_INPUT_CHUNK_MAX = 16_384;

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function parseOptionalNonNegativeInt(raw: string | null): number | undefined {
  if (raw == null) return undefined;
  const v = Number(String(raw).trim());
  if (!Number.isFinite(v) || v < 0) return undefined;
  return Math.floor(v);
}

function clampIntParam(raw: string | null, defaultValue: number, min: number, max: number): number {
  const parsed = parseOptionalNonNegativeInt(raw);
  return clampInt(parsed ?? defaultValue, min, max);
}

function isHubWebTerminalSessionName(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!isSafeTmuxSessionName(s)) return false;
  if (s === hubShellSessionName()) return true;
  // One tmux session per chat.
  const prefix = 'drone-hub-chat-';
  return s.startsWith(prefix) && s.length > prefix.length;
}

function buildHubSessionShell(opts: { command: string; cwd: string }): string {
  const cmd = String(opts.command || '').trim() || 'bash --noprofile --rcfile /tmp/.drone-hub-shell-rc -i';
  const cwd = normalizeContainerPath(String(opts.cwd ?? '').trim() || '/dvm-data');
  const env = [
    'export TERM=xterm-256color',
    'export COLORTERM=truecolor',
    // Compact prompt so we avoid "root@<container-id>:/path#" noise in the dock.
    "export PS1='\\w $ '",
    'export PROMPT_COMMAND=',
  ].join('; ');
  return [
    'set -e',
    env,
    "printf \"%s\\n\" \"PS1='\\\\w $ '\" \"PROMPT_COMMAND=\" > /tmp/.drone-hub-shell-rc",
    'chmod 600 /tmp/.drone-hub-shell-rc 2>/dev/null || true',
    `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
    `cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data`,
    `exec ${cmd}`,
  ].join('; ');
}

async function ensureHubSessionRunning(opts: {
  containerName: string;
  sessionName: string;
  command: string;
  cwd?: string | null;
}) {
  const sessionName = sanitizeTmuxSessionName(opts.sessionName || 'default');
  // If a tmux session exists but its pane is dead (e.g. shell got terminated),
  // kill and recreate it so the web terminal always attaches to a live shell.
  try {
    const deadCheckScript = [
      'set -euo pipefail',
      `s=${bashQuote(sessionName)}`,
      'tmux has-session -t "$s" 2>/dev/null || exit 0',
      'dead="$(tmux display-message -p -t "$s:0.0" \'#{pane_dead}\' 2>/dev/null || echo 0)"',
      '[ "$dead" = "1" ] && tmux kill-session -t "$s" 2>/dev/null || true',
    ].join('\n');
    await dvmExec(opts.containerName, 'bash', ['-lc', deadCheckScript]);
  } catch {
    // Best-effort safety check; continue with normal start logic.
  }
  const shell = buildHubSessionShell({
    command: opts.command,
    cwd: String(opts.cwd ?? '').trim() || '/dvm-data',
  });
  try {
    await dvmSessionStart(opts.containerName, sessionName, 'bash', ['-lc', shell], true);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    // `--reuse` should avoid duplicates, but there can still be a small TOCTOU race.
    if (/duplicate session:/i.test(msg) || /Session already exists:/i.test(msg)) {
      // Treat as success; the session is running (or is being created).
    } else {
      throw e;
    }
  }
  return { sessionName };
}

async function ensureChatEntry(opts: { droneName: string; chatName: string }): Promise<void> {
  await updateRegistry((reg: any) => {
    const d = reg?.drones?.[opts.droneName];
    if (!d) throw new Error(`unknown drone: ${opts.droneName}`);
    d.chats = d.chats ?? {};
    if (!d.chats[opts.chatName]) {
      // Default new chats to builtin Cursor transcript mode (chat bubbles).
      // NOTE: chatId is intentionally omitted (it is created lazily on first prompt).
      d.chats[opts.chatName] = { createdAt: new Date().toISOString(), agent: { kind: 'builtin', id: 'cursor' } } as any;
      reg.drones = reg.drones ?? {};
      reg.drones[opts.droneName] = d;
    }
  });
}

function inferChatAgent(entry: any): ChatAgentConfig {
  const agent = entry?.agent as ChatAgentConfig | undefined;
  if (agent && agent.kind === 'builtin') {
    const builtinId = normalizeBuiltinAgentId(agent.id);
    if (builtinId) return { kind: 'builtin', id: builtinId };
  }
  if (agent && agent.kind === 'custom') {
    const id = String((agent as any).id ?? '').trim();
    const label = String((agent as any).label ?? '').trim() || id || 'Custom';
    const command = String((agent as any).command ?? '').trim() || resolveHubAgentCommand();
    return { kind: 'custom', id: id || 'custom', label, command };
  }
  if (typeof entry?.claudeSessionId === 'string' && entry.claudeSessionId.trim()) return { kind: 'builtin', id: 'claude' };
  if (typeof entry?.openCodeSessionId === 'string' && entry.openCodeSessionId.trim()) return { kind: 'builtin', id: 'opencode' };
  // Back-compat: if a Codex thread exists, this is a builtin Codex transcript chat.
  if (typeof entry?.codexThreadId === 'string' && entry.codexThreadId.trim()) return { kind: 'builtin', id: 'codex' };
  // Back-compat: if a legacy Cursor `chatId` exists, treat as builtin cursor transcript chat.
  if (typeof entry?.chatId === 'string' && entry.chatId.trim()) return { kind: 'builtin', id: 'cursor' };
  // Default unknown/missing metadata to builtin Cursor transcript mode.
  return { kind: 'builtin', id: 'cursor' };
}

async function getChatEntry(opts: { droneName: string; chatName: string }) {
  const reg = await loadRegistry();
  const d = reg.drones[opts.droneName];
  if (!d) throw new Error(`unknown drone: ${opts.droneName}`);
  const chat = d.chats?.[opts.chatName];
  if (!chat) throw new Error(`unknown chat: ${opts.chatName}`);
  return { reg, d, chat };
}

async function setChatAgentConfig(opts: {
  droneName: string;
  chatName: string;
  agent?: ChatAgentConfig;
  setModel?: boolean;
  model?: string | null;
}) {
  await updateRegistry((reg: any) => {
    const d = reg?.drones?.[opts.droneName];
    if (!d) throw new Error(`unknown drone: ${opts.droneName}`);
    d.chats = d.chats ?? {};
    const cur = d.chats?.[opts.chatName];
    if (!cur) throw new Error(`unknown chat: ${opts.chatName}`);
    if (opts.agent) cur.agent = opts.agent as any;
    if (opts.setModel) {
      if (opts.model) cur.model = opts.model;
      else delete cur.model;
    }
    d.chats[opts.chatName] = cur;
    reg.drones = reg.drones ?? {};
    reg.drones[opts.droneName] = d;
  });
}

async function resolveChatTmuxCommand(opts: { droneName: string; chatName: string }): Promise<string> {
  const { chat } = await getChatEntry(opts);
  const agent = inferChatAgent(chat);
  if (agent.kind === 'builtin') return resolveBuiltinTmuxCommand(agent.id);
  return agent.command || resolveHubAgentCommand();
}

async function ensureHubChatSessionRunning(opts: {
  containerName: string;
  chatName: string;
  command: string;
  cwd?: string | null;
}) {
  const sessionName = hubChatSessionName(opts.chatName || 'default');
  const agentCmd = String(opts.command || '').trim() || resolveHubAgentCommand();
  return await ensureHubSessionRunning({
    containerName: opts.containerName,
    sessionName,
    command: agentCmd,
    cwd: String(opts.cwd ?? '').trim() || '/dvm-data',
  });
}

function parseTurnSelection(selRaw: string, turnsLen: number): number[] {
  const sel = String(selRaw || 'last').trim().toLowerCase();
  if (sel === 'all') return Array.from({ length: turnsLen }, (_, i) => i);
  if (sel === 'last') return turnsLen > 0 ? [turnsLen - 1] : [];
  const n = Number(sel);
  if (!Number.isFinite(n) || n < 1 || Math.floor(n) !== n) throw new Error('invalid turn (expected 1-based integer, last, or all)');
  if (n > turnsLen) throw new Error(`turn out of range (max ${turnsLen})`);
  return [n - 1];
}

function parseUuid(text: string): string | null {
  const m = String(text).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

function openCodeSessionTitle(droneName: string, chatName: string): string {
  const d = sanitizeTmuxSessionName(droneName || 'drone');
  const c = sanitizeTmuxSessionName(chatName || 'default');
  return `drone-hub-${d}-${c}`;
}

async function ensureCursorChatId(opts: { droneName: string; containerName: string; chatName: string }): Promise<string> {
  const { chat } = await getChatEntry({ droneName: opts.droneName, chatName: opts.chatName });
  const existing = typeof (chat as any).chatId === 'string' ? String((chat as any).chatId).trim() : '';
  if (existing) return existing;
  const r = await dvmExec(opts.containerName, 'bash', ['-lc', 'agent create-chat'], {
    timeoutMs: defaultSeedBootstrapTimeoutMs(),
  });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'agent create-chat failed').trim());
  const id = parseUuid(`${r.stdout}\n${r.stderr}`);
  if (!id) throw new Error(`failed to parse chatId from agent create-chat output: ${r.stdout || r.stderr || '(empty)'}`);
  const finalId = await updateRegistry((reg: any) => {
    const d = reg?.drones?.[opts.droneName];
    if (!d) throw new Error(`unknown drone: ${opts.droneName}`);
    d.chats = d.chats ?? {};
    const cur = d.chats?.[opts.chatName];
    if (!cur) throw new Error(`unknown chat: ${opts.chatName}`);
    const already = typeof cur.chatId === 'string' ? String(cur.chatId).trim() : '';
    if (already) return already;
    cur.chatId = id;
    d.chats[opts.chatName] = cur;
    reg.drones = reg.drones ?? {};
    reg.drones[opts.droneName] = d;
    return id;
  });
  return finalId;
}

async function ensureClaudeSessionId(opts: { droneName: string; chatName: string }): Promise<string> {
  const { chat } = await getChatEntry({ droneName: opts.droneName, chatName: opts.chatName });
  const existing = typeof (chat as any).claudeSessionId === 'string' ? String((chat as any).claudeSessionId).trim() : '';
  if (existing) return existing;
  const id = crypto.randomUUID();
  return await updateRegistry((reg: any) => {
    const d = reg?.drones?.[opts.droneName];
    if (!d) throw new Error(`unknown drone: ${opts.droneName}`);
    d.chats = d.chats ?? {};
    const cur = d.chats?.[opts.chatName];
    if (!cur) throw new Error(`unknown chat: ${opts.chatName}`);
    const already = typeof cur.claudeSessionId === 'string' ? String(cur.claudeSessionId).trim() : '';
    if (already) return already;
    cur.claudeSessionId = id;
    d.chats[opts.chatName] = cur;
    reg.drones = reg.drones ?? {};
    reg.drones[opts.droneName] = d;
    return id;
  });
}

function parseOpenCodeSessionList(stdout: string, preferredTitle?: string | null): string | null {
  let parsed: any = null;
  try {
    parsed = JSON.parse(String(stdout ?? ''));
  } catch {
    return null;
  }
  const pick = (v: any): { id: string | null; title: string | null } => {
    const id = String(v?.id ?? v?.sessionId ?? v?.sessionID ?? v?.session_id ?? '').trim();
    const title = String(v?.title ?? v?.name ?? '').trim();
    return { id: id || null, title: title || null };
  };
  const preferred = String(preferredTitle ?? '')
    .trim()
    .toLowerCase();
  const all: Array<{ id: string | null; title: string | null }> = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      all.push(pick(item));
    }
  } else if (Array.isArray(parsed?.sessions)) {
    for (const item of parsed.sessions) {
      all.push(pick(item));
    }
  } else if (Array.isArray(parsed?.items)) {
    for (const item of parsed.items) {
      all.push(pick(item));
    }
  } else {
    all.push(pick(parsed));
  }

  if (preferred) {
    for (const item of all) {
      if (!item.id) continue;
      if (String(item.title ?? '').trim().toLowerCase() === preferred) {
        return item.id;
      }
    }
  }

  for (const item of all) {
    if (item.id) return item.id;
  }
  return null;
}

function parseOpenCodeSessionIdFromListOutputs(opts: {
  stdout: string;
  stderr: string;
  preferredTitle?: string | null;
}): string | null {
  const { stdout, stderr, preferredTitle } = opts;
  const candidates = [
    parseOpenCodeSessionList(String(stdout ?? '').trim(), preferredTitle),
    parseOpenCodeSessionList(String(stderr ?? '').trim(), preferredTitle),
  ];
  for (const id of candidates) {
    if (id) return id;
  }
  if (preferredTitle) {
    for (const id of [
      parseOpenCodeSessionList(String(stdout ?? '').trim()),
      parseOpenCodeSessionList(String(stderr ?? '').trim()),
    ]) {
      if (id) return id;
    }
  }
  return null;
}

async function ensureOpenCodeSessionId(opts: {
  droneName: string;
  containerName: string;
  chatName: string;
}): Promise<string | null> {
  const { chat } = await getChatEntry({ droneName: opts.droneName, chatName: opts.chatName });
  const existing = typeof (chat as any).openCodeSessionId === 'string' ? String((chat as any).openCodeSessionId).trim() : '';
  if (existing) return existing;

  const preferredTitle = openCodeSessionTitle(opts.droneName, opts.chatName);
  const listCmd = 'opencode session list --max-count 30 --format json';
  const r = await dvmExec(opts.containerName, 'bash', ['-lc', listCmd], {
    timeoutMs: defaultSeedBootstrapTimeoutMs(),
  });
  if (r.code !== 0) return null;
  const id = parseOpenCodeSessionIdFromListOutputs({
    stdout: String(r.stdout ?? ''),
    stderr: String(r.stderr ?? ''),
    preferredTitle,
  });
  if (!id) return null;

  return await updateRegistry((reg: any) => {
    const d = reg?.drones?.[opts.droneName];
    if (!d) throw new Error(`unknown drone: ${opts.droneName}`);
    d.chats = d.chats ?? {};
    const cur = d.chats?.[opts.chatName];
    if (!cur) throw new Error(`unknown chat: ${opts.chatName}`);
    const already = typeof cur.openCodeSessionId === 'string' ? String(cur.openCodeSessionId).trim() : '';
    if (already) return already;
    cur.openCodeSessionId = id;
    d.chats[opts.chatName] = cur;
    reg.drones = reg.drones ?? {};
    reg.drones[opts.droneName] = d;
    return id;
  });
}

function parseCodexJsonl(stdout: string): { threadId: string | null; message: string | null } {
  let threadId: string | null = null;
  let lastMsg: string | null = null;
  let streamedMsg = '';

  function takeText(v: any): string | null {
    if (typeof v === 'string' && v) return v;
    return null;
  }

  function extractItemText(item: any): string | null {
    if (!item || typeof item !== 'object') return null;
    const direct = takeText(item.text) ?? takeText(item.output_text);
    if (direct) return direct;
    const content = item.content;
    if (!Array.isArray(content)) return null;
    const parts: string[] = [];
    for (const c of content) {
      if (!c || typeof c !== 'object') continue;
      const t = takeText((c as any).text) ?? takeText((c as any).output_text);
      if (t) parts.push(t);
    }
    if (parts.length === 0) return null;
    return parts.join('\n');
  }

  const lines = String(stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    let obj: any = null;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    if (obj.type === 'thread.started' && typeof obj.thread_id === 'string') {
      threadId = obj.thread_id;
      continue;
    }
    if ((obj.type === 'item.completed' || obj.type === 'item.started') && obj.item && typeof obj.item === 'object') {
      const itemType = String(obj.item.type ?? '');
      const text = extractItemText(obj.item);
      if (text && (itemType === 'agent_message' || itemType === 'assistant_message')) {
        lastMsg = text;
      }
      continue;
    }

    // Some Codex JSONL variants emit assistant text directly as output-text events.
    if (obj.type === 'response.output_text.delta') {
      const delta = takeText(obj.delta);
      if (delta) streamedMsg += delta;
      continue;
    }
    if (obj.type === 'response.output_text.done') {
      const text = takeText(obj.text);
      if (text) lastMsg = text;
      continue;
    }

    const responseText = takeText(obj?.response?.output_text);
    if (responseText) {
      lastMsg = responseText;
    }
  }
  if (!lastMsg && streamedMsg) lastMsg = streamedMsg;
  return { threadId, message: lastMsg };
}

function formatCodexJobFailure(stdoutRaw: string, stderrRaw: string, fallbackRaw: string): string {
  const stdout = String(stdoutRaw ?? '').trim();
  const stderr = String(stderrRaw ?? '').trim();
  const fallback = String(fallbackRaw ?? '').trim() || 'Codex turn failed.';
  const merged = [stderr, stdout].filter(Boolean).join('\n');
  if (!merged) return fallback;

  const lifecycleOnlyTypes = new Set([
    'thread.started',
    'turn.started',
    'turn.completed',
    'item.started',
    'item.completed',
    'response.output_text.delta',
    'response.output_text.done',
  ]);
  const explicitErrors: string[] = [];
  let parsedCount = 0;
  let nonLifecycleEventSeen = false;
  let nonJsonLineSeen = false;

  for (const lineRaw of merged.split('\n')) {
    const line = String(lineRaw ?? '').trim();
    if (!line) continue;
    let obj: any = null;
    try {
      obj = JSON.parse(line);
    } catch {
      nonJsonLineSeen = true;
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    parsedCount += 1;
    const type = String(obj.type ?? '').trim();
    if (!lifecycleOnlyTypes.has(type)) nonLifecycleEventSeen = true;
    const push = (raw: any) => {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) return;
      if (!explicitErrors.includes(text)) explicitErrors.push(text);
    };
    push(obj.error);
    push(obj.message);
    if (obj.error && typeof obj.error === 'object') {
      push(obj.error.message);
    }
    if (obj.last_error && typeof obj.last_error === 'object') {
      push(obj.last_error.message);
    }
  }

  if (explicitErrors.length > 0) return explicitErrors.join('\n');
  const lifecycleOnly = parsedCount > 0 && !nonLifecycleEventSeen && !nonJsonLineSeen;
  if (lifecycleOnly) return 'Codex turn started but exited before producing a response.';
  return fallback;
}

async function recordTranscriptTurn(opts: {
  droneName: string;
  chatName: string;
  turn: { at: string; id?: string; prompt: string; ok: boolean; output: string; error?: string };
  agentPatch?: Partial<{ codexThreadId: string; claudeSessionId: string; openCodeSessionId: string }>;
}): Promise<void> {
  await updateRegistry((reg: any) => {
    const d = reg?.drones?.[opts.droneName];
    if (!d) throw new Error(`unknown drone: ${opts.droneName}`);
    d.chats = d.chats ?? {};
    const chat = d.chats?.[opts.chatName];
    if (!chat) throw new Error(`unknown chat: ${opts.chatName}`);
    chat.turns = Array.isArray(chat.turns) ? chat.turns : [];
    chat.turns.push(opts.turn);
    if (opts.agentPatch?.codexThreadId) {
      chat.codexThreadId = opts.agentPatch.codexThreadId;
    }
    if (opts.agentPatch?.claudeSessionId) {
      chat.claudeSessionId = opts.agentPatch.claudeSessionId;
    }
    if (opts.agentPatch?.openCodeSessionId) {
      chat.openCodeSessionId = opts.agentPatch.openCodeSessionId;
    }
    d.chats[opts.chatName] = chat;
    reg.drones = reg.drones ?? {};
    reg.drones[opts.droneName] = d;
  });
}

async function runNodeCli(args: string[], opts?: { cwd?: string; timeoutMs?: number }) {
  const envTimeoutRaw = String(process.env.DRONE_HUB_NODE_CLI_TIMEOUT_MS ?? '').trim();
  const envTimeout = envTimeoutRaw ? Number(envTimeoutRaw) : NaN;
  const timeoutMs =
    typeof opts?.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? opts.timeoutMs
      : Number.isFinite(envTimeout) && envTimeout > 0
        ? envTimeout
        : 10 * 60_000;

  const r = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, cwd: opts?.cwd });
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

    if (timeoutMs > 0) {
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
        }, 1500);
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

export async function startDroneHubApiServer(opts: { port: number; host?: string; apiToken: string; allowedOrigins?: string[] }) {
  loadHubEnv();
  const host = opts.host ?? '127.0.0.1';
  const apiToken = String(opts.apiToken ?? '').trim();
  if (!apiToken) throw new Error('missing hub API token');

  const allowedOrigins = new Set<string>();
  for (const o of opts.allowedOrigins ?? []) {
    const n = normalizeOrigin(o);
    if (n) allowedOrigins.add(n);
  }

  // Best-effort: resume any pending provisioning after hub restarts.
  // (Pending entries are persisted in the registry, but the in-memory queue is not.)
  try {
    const regAny: any = await loadRegistry();
    enqueueProvisioningForAllPending(regAny);
    // Best-effort: resume any hub-queued prompts after hub restarts.
    // These are prompts persisted in the registry but not yet enqueued into the daemon
    // (e.g. Codex/OpenCode follow-ups waiting for session ids to be discovered).
    try {
      const drones = regAny?.drones && typeof regAny.drones === 'object' ? Object.entries(regAny.drones) : [];
      for (const [droneName, d] of drones as any[]) {
        const chats = d?.chats && typeof d.chats === 'object' ? Object.entries(d.chats) : [];
        for (const [chatName, entry] of chats as any[]) {
          const pending = Array.isArray((entry as any)?.pendingPrompts) ? (entry as any).pendingPrompts : [];
          if (pending.some((p: any) => String(p?.state ?? '') === 'queued')) {
            enqueuePendingPromptPump(String(droneName), String(chatName));
          }
        }
      }
    } catch {
      // ignore (best-effort)
    }
  } catch {
    // ignore (best-effort)
  }

  type TerminalWebSocketContext = {
    droneName: string;
    sessionName: string;
    client: ReturnType<typeof makeClient>;
    since?: number;
    maxBytes: number;
  };

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, context: TerminalWebSocketContext) => {
    const ctx = context;
    let closed = false;
    let outputOffset = typeof ctx.since === 'number' && Number.isFinite(ctx.since) && ctx.since >= 0 ? Math.floor(ctx.since) : 0;
    let outputStreamAbortRef: AbortController | null = null;
    let outputReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let outputReconnectAttempt = 0;

    let inputBuffer = '';
    let inputFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let flushingInput = false;

    const wsSendJson = (payload: any) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        // ignore
      }
    };

    const cleanup = () => {
      closed = true;
      if (outputReconnectTimer != null) {
        clearTimeout(outputReconnectTimer);
        outputReconnectTimer = null;
      }
      if (outputStreamAbortRef) {
        try {
          outputStreamAbortRef.abort();
        } catch {
          // ignore
        }
        outputStreamAbortRef = null;
      }
      if (inputFlushTimer != null) {
        clearTimeout(inputFlushTimer);
        inputFlushTimer = null;
      }
    };

    const scheduleInputFlush = (delayMs: number) => {
      if (inputFlushTimer != null) return;
      inputFlushTimer = setTimeout(() => {
        inputFlushTimer = null;
        void flushInput();
      }, Math.max(0, Math.floor(delayMs)));
    };

    const flushInput = async () => {
      if (closed || flushingInput) return;
      const chunk = inputBuffer.slice(0, HUB_WEB_TERMINAL_WS_INPUT_CHUNK_MAX);
      if (!chunk) return;
      inputBuffer = inputBuffer.slice(chunk.length);
      flushingInput = true;
      try {
        await droneTerminalInput(ctx.client, { session: ctx.sessionName, data: chunk });
      } catch (e: any) {
        wsSendJson({ type: 'error', error: e?.message ?? String(e) });
      } finally {
        flushingInput = false;
        if (inputBuffer) void flushInput();
      }
    };

    const parseSseEvent = (eventName: string, dataText: string) => {
      if (!dataText) return;
      let payload: any = null;
      try {
        payload = JSON.parse(dataText);
      } catch {
        return;
      }

      if (eventName === 'ready') {
        const nextOffset = Number(payload?.since ?? payload?.nextOffset ?? payload?.offsetBytes ?? outputOffset);
        if (Number.isFinite(nextOffset) && nextOffset >= 0) outputOffset = Math.floor(nextOffset);
        return;
      }

      if (eventName === 'output') {
        const text = typeof payload?.chunk === 'string' ? payload.chunk : '';
        const nextOffset = Number(payload?.nextOffset ?? outputOffset + Buffer.byteLength(text, 'utf8'));
        if (Number.isFinite(nextOffset) && nextOffset >= 0) outputOffset = Math.floor(nextOffset);
        if (!text) return;
        wsSendJson({ type: 'output', name: ctx.droneName, sessionName: ctx.sessionName, offsetBytes: outputOffset, text });
        return;
      }

      if (eventName === 'error') {
        wsSendJson({ type: 'error', error: String(payload?.error ?? 'terminal stream error') });
      }
    };

    const scheduleOutputReconnect = (delayMs: number) => {
      if (closed) return;
      if (outputReconnectTimer != null) clearTimeout(outputReconnectTimer);
      outputReconnectTimer = setTimeout(() => {
        outputReconnectTimer = null;
        startOutputStream(outputOffset);
      }, Math.max(40, Math.floor(delayMs)));
    };

    const startOutputStream = (since: number) => {
      if (closed) return;
      if (outputStreamAbortRef) {
        try {
          outputStreamAbortRef.abort();
        } catch {
          // ignore
        }
      }
      const controller = new AbortController();
      outputStreamAbortRef = controller;
      const streamUrl = new URL('/v1/terminal/output/stream', ctx.client.baseUrl);
      streamUrl.searchParams.set('session', ctx.sessionName);
      streamUrl.searchParams.set('since', String(Math.max(0, Math.floor(since))));

      void fetch(streamUrl.toString(), {
        headers: {
          authorization: `Bearer ${ctx.client.token}`,
        },
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok || !res.body) {
            throw new Error(`terminal stream request failed: ${res.status} ${res.statusText}`);
          }

          outputReconnectAttempt = 0;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let sseBuffer = '';

          while (!closed) {
            const { value, done } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });

            let sepIdx = sseBuffer.indexOf('\n\n');
            while (sepIdx !== -1) {
              const frame = sseBuffer.slice(0, sepIdx);
              sseBuffer = sseBuffer.slice(sepIdx + 2);

              let eventName = 'message';
              const dataLines: string[] = [];
              for (const rawLine of frame.split('\n')) {
                const line = rawLine.replace(/\r$/, '');
                if (!line) continue;
                if (line.startsWith('event:')) {
                  eventName = line.slice('event:'.length).trim();
                  continue;
                }
                if (line.startsWith('data:')) {
                  dataLines.push(line.slice('data:'.length).trimStart());
                }
              }

              if (dataLines.length > 0) {
                parseSseEvent(eventName, dataLines.join('\n'));
              }
              sepIdx = sseBuffer.indexOf('\n\n');
            }
          }

          if (closed || controller.signal.aborted) return;
          outputReconnectAttempt = Math.min(12, outputReconnectAttempt + 1);
          const delay = Math.min(1600, 120 * Math.pow(1.7, outputReconnectAttempt));
          scheduleOutputReconnect(delay);
        })
        .catch((e: any) => {
          if (closed || controller.signal.aborted) return;
          outputReconnectAttempt = Math.min(12, outputReconnectAttempt + 1);
          const delay = Math.min(1800, 140 * Math.pow(1.8, outputReconnectAttempt));
          wsSendJson({ type: 'error', error: e?.message ?? String(e) });
          scheduleOutputReconnect(delay);
        });
    };

    const sendReadyAndStart = async () => {
      try {
        const sync: any = await droneTerminalOutput(ctx.client, {
          session: ctx.sessionName,
          since: ctx.since == null ? Number.MAX_SAFE_INTEGER : ctx.since,
          max: 1,
        });
        const nextOffset = Number(sync?.nextOffset ?? outputOffset);
        if (Number.isFinite(nextOffset) && nextOffset >= 0) outputOffset = Math.floor(nextOffset);
        wsSendJson({ type: 'ready', name: ctx.droneName, sessionName: ctx.sessionName, offsetBytes: outputOffset });
        if (ctx.since == null) {
          try {
            const prompt: any = await droneTerminalPrompt(ctx.client, { session: ctx.sessionName });
            const text = typeof prompt?.text === 'string' ? prompt.text : '';
            if (text) {
              wsSendJson({ type: 'output', name: ctx.droneName, sessionName: ctx.sessionName, offsetBytes: outputOffset, text });
            }
          } catch {
            // ignore prompt bootstrap failures; stream still works.
          }
        }
        startOutputStream(outputOffset);
      } catch (e: any) {
        wsSendJson({ type: 'error', error: e?.message ?? String(e) });
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };

    ws.on('message', (raw: RawData) => {
      if (closed) return;
      let text = '';
      if (typeof raw === 'string') text = raw;
      else if (Buffer.isBuffer(raw)) text = raw.toString('utf8');
      else if (Array.isArray(raw)) text = Buffer.concat(raw).toString('utf8');
      else text = String(raw ?? '');
      if (!text) return;

      let msg: any = null;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }

      if (msg?.type === 'ping') {
        wsSendJson({ type: 'pong' });
        return;
      }
      if (msg?.type !== 'input') return;

      const data = typeof msg?.data === 'string' ? msg.data : '';
      if (!data) return;
      if (Buffer.byteLength(data, 'utf8') > 128 * 1024) {
        wsSendJson({ type: 'error', error: 'input too large' });
        return;
      }

      inputBuffer += data;
      if (inputBuffer.length > 128 * 1024) inputBuffer = inputBuffer.slice(-128 * 1024);

      const immediate = /[\r\n\t\u0003\u0004\u001b]/.test(data);
      if (immediate || inputBuffer.length >= HUB_WEB_TERMINAL_WS_INPUT_BURST_BYTES) {
        if (inputFlushTimer != null) {
          clearTimeout(inputFlushTimer);
          inputFlushTimer = null;
        }
        void flushInput();
        return;
      }
      scheduleInputFlush(HUB_WEB_TERMINAL_WS_INPUT_FLUSH_MS);
    });

    ws.on('close', cleanup);
    ws.on('error', cleanup);

    void sendReadyAndStart();
  });

  const server = http.createServer(async (req, res) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase();
      const corsAllowed = withCors(req, res, allowedOrigins);
      if (method === 'OPTIONS') {
        if (!corsAllowed) {
          json(res, 403, { ok: false, error: 'origin not allowed' });
          return;
        }
        res.statusCode = 204;
        res.end();
        return;
      }

      const u = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = u.pathname;
      if (pathname.startsWith('/api/')) {
        if (!isHubApiAuthorized(req, apiToken)) {
          hubLog('warn', 'unauthorized api request', {
            method,
            path: pathname,
            origin: typeof req.headers.origin === 'string' ? req.headers.origin : null,
            userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
          });
          res.setHeader('www-authenticate', 'Bearer realm="drone-hub-api"');
          json(res, 401, { ok: false, error: 'unauthorized' });
          return;
        }
      }

      if (method === 'GET' && pathname === '/api/health') {
        json(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && pathname === '/api/version') {
        let mtime: string | null = null;
        try {
          const st = await fs.stat(__filename);
          mtime = st.mtime.toISOString();
        } catch {
          // ignore
        }
        json(res, 200, {
          ok: true,
          buildId: HUB_API_BUILD_ID,
          loadedAt: HUB_API_LOADED_AT,
          pid: process.pid,
          node: process.version,
          file: __filename,
          fileMtime: mtime,
          hasDisplay: Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY),
          hasDbus: Boolean(process.env.DBUS_SESSION_BUS_ADDRESS),
          env: {
            display: process.env.DISPLAY ?? null,
            waylandDisplay: process.env.WAYLAND_DISPLAY ?? null,
            xdgRuntimeDir: process.env.XDG_RUNTIME_DIR ?? null,
            xdgSessionType: process.env.XDG_SESSION_TYPE ?? null,
            desktopSession: process.env.DESKTOP_SESSION ?? null,
          },
        });
        return;
      }

      if (pathname === '/api/settings/openai' || pathname === '/api/settings/gemini') {
        const provider: LlmProviderId = pathname.endsWith('/gemini') ? 'gemini' : 'openai';
        if (method === 'GET') {
          const resolved = await resolveEffectiveProviderApiKeySettings(provider);
          json(res, 200, {
            ok: true,
            ...providerKeySettingsResponse(resolved),
          });
          return;
        }

        if (method === 'POST') {
          let body: any = null;
          try {
            body = await readJsonBody(req);
          } catch (e: any) {
            json(res, 400, { ok: false, error: e?.message ?? String(e) });
            return;
          }
          const apiKey = normalizeApiKey(body?.apiKey);
          if (!apiKey) {
            json(res, 400, { ok: false, error: 'API key is required.' });
            return;
          }
          await upsertStoredProviderApiKey(provider, apiKey);
          const resolved = await resolveEffectiveProviderApiKeySettings(provider);
          json(res, 200, {
            ok: true,
            ...providerKeySettingsResponse(resolved),
          });
          return;
        }

        if (method === 'DELETE') {
          await clearStoredProviderApiKey(provider);
          const resolved = await resolveEffectiveProviderApiKeySettings(provider);
          json(res, 200, {
            ok: true,
            ...providerKeySettingsResponse(resolved),
          });
          return;
        }
      }

      if (pathname === '/api/settings/llm') {
        if (method === 'GET') {
          json(res, 200, await resolveLlmSettingsResponse());
          return;
        }

        if (method === 'POST') {
          let body: any = null;
          try {
            body = await readJsonBody(req);
          } catch (e: any) {
            json(res, 400, { ok: false, error: e?.message ?? String(e) });
            return;
          }
          const provider = parseLlmProvider(body?.provider);
          if (!provider) {
            json(res, 400, { ok: false, error: 'provider must be openai or gemini' });
            return;
          }
          await upsertStoredLlmProvider(provider);
          json(res, 200, await resolveLlmSettingsResponse());
          return;
        }
      }

      if (pathname === '/api/settings/hub/logs') {
        if (method === 'GET') {
          const maxBytes = clampIntParam(
            u.searchParams.get('maxBytes'),
            HUB_SETTINGS_LOG_DEFAULT_MAX_BYTES,
            1,
            HUB_SETTINGS_LOG_MAX_BYTES,
          );
          const tailLines = clampIntParam(
            u.searchParams.get('tail'),
            HUB_SETTINGS_LOG_DEFAULT_TAIL_LINES,
            1,
            HUB_SETTINGS_LOG_MAX_TAIL_LINES,
          );
          try {
            const out = await readHubLogTail({ maxBytes, tailLines });
            json(res, 200, { ok: true, ...out, maxBytes, tailLines });
          } catch (e: any) {
            json(res, 500, { ok: false, error: e?.message ?? String(e) });
          }
          return;
        }
      }

      // POST /api/jobs/from-message
      // Converts an agent message into one or more "jobs" (dash-case name + title + details).
      if (method === 'POST' && pathname === '/api/jobs/from-message') {
        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const message = String(body?.message ?? '').trim();
        if (!message) {
          json(res, 400, { ok: false, error: 'missing message' });
          return;
        }

        try {
          const { provider } = await resolveEffectiveLlmProvider();
          const resolved = await resolveEffectiveProviderApiKeySettings(provider);
          if (!resolved.apiKey) {
            throw new Error(`Missing ${providerDisplayName(provider)} API key. Configure it in Settings.`);
          }
          const plan = await jobsPlanFromAgentMessage(message, { provider, apiKey: resolved.apiKey });
          const group = typeof plan?.group === 'string' ? plan.group : 'jobs';
          const jobs = Array.isArray(plan?.jobs) ? plan.jobs : [];
          // Back-compat: include `description` for older clients (maps to title).
          json(res, 200, {
            ok: true,
            group,
            jobs: jobs.map((j: any) => ({ ...j, description: j?.title ?? j?.description ?? '' })),
          });
          return;
        } catch (e: any) {
          json(res, 500, { ok: false, error: e?.message ?? String(e) });
          return;
        }
      }

      // POST /api/drones/name-from-message
      // Suggests a dash-case drone name from a user message.
      if (method === 'POST' && pathname === '/api/drones/name-from-message') {
        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const message = String(body?.message ?? '').trim();
        if (!message) {
          json(res, 400, { ok: false, error: 'missing message' });
          return;
        }

        let selectedProvider: LlmProviderId | null = null;
        try {
          const { provider } = await resolveEffectiveLlmProvider();
          selectedProvider = provider;
          const resolved = await resolveEffectiveProviderApiKeySettings(provider);
          if (!resolved.apiKey) {
            json(res, 412, {
              ok: false,
              error: `Missing ${providerDisplayName(provider)} API key. Configure it in Settings.`,
            });
            return;
          }
          const name = await suggestDroneNameFromMessage(message, { provider, apiKey: resolved.apiKey });
          json(res, 200, { ok: true, name });
          return;
        } catch (e: any) {
          hubLog('error', 'name-from-message request failed', {
            provider: selectedProvider,
            model: String(process.env.DRONE_HUB_DRONE_NAME_MODEL ?? '').trim() || null,
            error: e?.message ?? String(e),
          });
          json(res, 500, { ok: false, error: e?.message ?? String(e) });
          return;
        }
      }

      const parts = pathname.split('/').filter(Boolean);

      // GET /api/repos
      // Lists repositories registered via `drone repo`.
      if (method === 'GET' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'repos') {
        const regAny: any = await loadRegistry();
        const raw = regAny?.repos ?? null;
        const list: any[] = [];
        if (raw && typeof raw === 'object') {
          if (Array.isArray(raw)) {
            for (const r of raw) {
              const p = typeof (r as any)?.path === 'string' ? String((r as any).path).trim() : '';
              if (!p) continue;
              list.push({
                path: p,
                addedAt: typeof (r as any)?.addedAt === 'string' ? String((r as any).addedAt) : null,
                remoteUrl: typeof (r as any)?.remoteUrl === 'string' ? String((r as any).remoteUrl) : null,
                github: (r as any)?.github ?? null,
              });
            }
          } else {
            for (const v of Object.values(raw)) {
              const p = typeof (v as any)?.path === 'string' ? String((v as any).path).trim() : '';
              if (!p) continue;
              list.push({
                path: p,
                addedAt: typeof (v as any)?.addedAt === 'string' ? String((v as any).addedAt) : null,
                remoteUrl: typeof (v as any)?.remoteUrl === 'string' ? String((v as any).remoteUrl) : null,
                github: (v as any)?.github ?? null,
              });
            }
          }
        }
        list.sort((a, b) => String(a.path).localeCompare(String(b.path)));
        json(res, 200, { ok: true, repos: list, count: list.length });
        return;
      }

      // DELETE /api/repos?path=<repoPath>
      // Removes a registered repo.
      if (method === 'DELETE' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'repos') {
        const target = String(u.searchParams.get('path') ?? '').trim();
        if (!target) {
          json(res, 400, { ok: false, error: 'missing path' });
          return;
        }
        if (!path.isAbsolute(target)) {
          json(res, 400, { ok: false, error: 'invalid path (expected absolute path)' });
          return;
        }

        const removed = await updateRegistry((regAny: any) => {
          const raw = regAny?.repos ?? null;
          if (!raw || typeof raw !== 'object') return false;
          if (Array.isArray(raw)) {
            // Back-compat: list form (filter in place).
            const before = raw.length;
            regAny.repos = raw.filter((r: any) => String(r?.path ?? '').trim() !== target);
            return before !== regAny.repos.length;
          }
          // Map form: key is repo root (preferred).
          let did = false;
          if (raw[target]) {
            delete raw[target];
            did = true;
          } else {
            for (const [k, v] of Object.entries(raw)) {
              if (String((v as any)?.path ?? '').trim() === target) {
                delete (raw as any)[k];
                did = true;
              }
            }
          }
          regAny.repos = raw;
          return did;
        });

        json(res, 200, { ok: true, removed, path: target });
        return;
      }

      // POST /api/drones
      // Creates a new drone container (like `drone create`).
      if (method === 'POST' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'drones') {
        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const name = String(body?.name ?? '').trim();
        if (!name) {
          json(res, 400, { ok: false, error: 'missing name' });
          return;
        }
        if (!isValidDroneNameDashCase(name)) {
          json(res, 400, { ok: false, error: 'invalid name (expected dash-case, max 48 chars)' });
          return;
        }

        const groupRaw = typeof body?.group === 'string' ? body.group.trim() : '';
        const group = groupRaw ? groupRaw : null;
        const repoRaw = typeof body?.repoPath === 'string' ? body.repoPath.trim() : '';
        const repoPath = repoRaw ? repoRaw : '';
        const build = body?.build === true;
        const containerPortRaw = body?.containerPort;
        const containerPort =
          containerPortRaw == null
            ? null
            : Number(containerPortRaw);
        if (containerPort != null && (!Number.isFinite(containerPort) || containerPort <= 0 || Math.floor(containerPort) !== containerPort)) {
          json(res, 400, { ok: false, error: 'invalid containerPort' });
          return;
        }

        const droneCli = resolveDroneCliPath();
        if (!(await fileExists(droneCli))) {
          json(res, 500, { ok: false, error: `drone CLI not found at ${droneCli}` });
          return;
        }

        const seedPrompt = String(body?.seedPrompt ?? body?.initialMessage ?? body?.seed?.prompt ?? '').trim();
        const seedChatName = normalizeChatName(body?.seedChat ?? body?.seed?.chatName ?? body?.seed?.chat ?? 'default');
        const seedAgent = parseSeedAgent(body?.seedAgent ?? body?.agent ?? body?.seed?.agent);
        let seedModel: string | null = null;
        try {
          seedModel = parseChatModelForUpdate(body?.seedModel ?? body?.seed?.model);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        const seedCwdRaw = typeof body?.seedCwd === 'string' ? body.seedCwd : (typeof body?.seed?.cwd === 'string' ? body.seed.cwd : null);
        const cloneFromRaw = typeof body?.cloneFrom === 'string' ? body.cloneFrom.trim() : '';
        const cloneFrom = cloneFromRaw ? cloneFromRaw : null;
        const cloneChats = body?.cloneChats !== false;

        const preRegAny: any = await loadRegistry();
        if (preRegAny?.drones?.[name]) {
          json(res, 409, { ok: false, error: `drone already exists: ${name}` });
          return;
        }
        if (cloneFrom) {
          if (!isValidDroneNameDashCase(cloneFrom)) {
            json(res, 400, { ok: false, error: 'invalid cloneFrom (expected dash-case, max 48 chars)' });
            return;
          }
          if (cloneFrom === name) {
            json(res, 400, { ok: false, error: 'cloneFrom cannot equal name' });
            return;
          }
          if (!preRegAny?.drones?.[cloneFrom]) {
            json(res, 404, { ok: false, error: `unknown cloneFrom drone: ${cloneFrom}` });
            return;
          }
        }

        const pendingWrite: { ok: boolean; status?: number; error?: string } = await updateRegistry((regAny: any) => {
          if (regAny?.drones?.[name]) return { ok: false, status: 409, error: `drone already exists: ${name}` };
          if (cloneFrom && !regAny?.drones?.[cloneFrom]) return { ok: false, status: 404, error: `unknown cloneFrom drone: ${cloneFrom}` };
          regAny.pending = regAny.pending ?? {};
          if (!regAny.pending[name]) {
            regAny.pending[name] = {
              name,
              group: group ?? undefined,
              repoPath,
              containerPort: containerPort ?? 7777,
              build,
              createdAt: nowIso(),
              updatedAt: nowIso(),
              phase: 'starting',
              message: 'Starting…',
              ...(cloneFrom ? { cloneFrom, cloneChats: Boolean(cloneChats) } : {}),
              ...(seedPrompt || seedAgent || seedModel
                ? {
                    seed: {
                      chatName: seedChatName,
                      ...(seedModel ? { model: seedModel } : {}),
                      ...(seedPrompt ? { prompt: seedPrompt } : {}),
                      ...(seedCwdRaw ? { cwd: String(seedCwdRaw) } : {}),
                      ...(seedAgent ? { agent: seedAgent } : {}),
                    },
                  }
                : {}),
            };
          }
          return { ok: true };
        });
        if (!pendingWrite.ok) {
          json(res, pendingWrite.status ?? 500, { ok: false, error: pendingWrite.error ?? 'failed to queue drone' });
          return;
        }

        // Queue provisioning (bounded concurrency).
        enqueueProvisioning(name);

        json(res, 202, { ok: true, name, phase: 'starting' });
        return;
      }

      // POST /api/drones/batch
      // Enqueue multiple drone creations in one request (backend-driven).
      if (method === 'POST' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'drones' && parts[2] === 'batch') {
        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const listRaw = body?.drones ?? body?.items ?? body?.requests;
        const list: any[] = Array.isArray(listRaw) ? listRaw : [];
        if (!Array.isArray(listRaw) || list.length === 0) {
          json(res, 400, { ok: false, error: 'missing drones (expected non-empty array)' });
          return;
        }

        let accepted: Array<{ name: string; phase: 'starting' }> = [];
        let rejected: Array<{ name: string; error: string; status?: number }> = [];
        try {
          const result = await updateRegistry((regAny: any) => {
            regAny.pending = regAny.pending ?? {};
            const accepted: Array<{ name: string; phase: 'starting' }> = [];
            const rejected: Array<{ name: string; error: string; status?: number }> = [];
            const seenInRequest = new Set<string>();

            for (const raw of list) {
              const name = String(raw?.name ?? '').trim();
              if (!name) {
                rejected.push({ name: '', error: 'missing name', status: 400 });
                continue;
              }
              if (seenInRequest.has(name)) {
                rejected.push({ name, error: `duplicate name in request: ${name}`, status: 400 });
                continue;
              }
              seenInRequest.add(name);
              if (!isValidDroneNameDashCase(name)) {
                rejected.push({ name, error: 'invalid name (expected dash-case, max 48 chars)', status: 400 });
                continue;
              }

              if (regAny?.drones?.[name]) {
                rejected.push({ name, error: `drone already exists: ${name}`, status: 409 });
                continue;
              }

              // If pending already exists, treat as idempotent accept.
              if (!regAny.pending[name]) {
                const groupRaw = typeof raw?.group === 'string' ? raw.group.trim() : '';
                const group = groupRaw ? groupRaw : null;
                const repoRaw = typeof raw?.repoPath === 'string' ? raw.repoPath.trim() : '';
                const repoPath = repoRaw ? repoRaw : '';
                const build = raw?.build === true;
                const containerPortRaw = raw?.containerPort;
                const containerPort = containerPortRaw == null ? null : Number(containerPortRaw);
                if (containerPort != null && (!Number.isFinite(containerPort) || containerPort <= 0 || Math.floor(containerPort) !== containerPort)) {
                  rejected.push({ name, error: 'invalid containerPort', status: 400 });
                  continue;
                }

                const seedPrompt = String(raw?.seedPrompt ?? raw?.initialMessage ?? raw?.seed?.prompt ?? '').trim();
                const seedChatName = normalizeChatName(raw?.seedChat ?? raw?.seed?.chatName ?? raw?.seed?.chat ?? 'default');
                const seedAgent = parseSeedAgent(raw?.seedAgent ?? raw?.agent ?? raw?.seed?.agent);
                let seedModel: string | null = null;
                try {
                  seedModel = parseChatModelForUpdate(raw?.seedModel ?? raw?.seed?.model);
                } catch (e: any) {
                  rejected.push({ name, error: e?.message ?? String(e), status: 400 });
                  continue;
                }
                const seedCwdRaw =
                  typeof raw?.seedCwd === 'string' ? raw.seedCwd : typeof raw?.seed?.cwd === 'string' ? raw.seed.cwd : null;
                const cloneFromRaw = typeof raw?.cloneFrom === 'string' ? raw.cloneFrom.trim() : '';
                const cloneFrom = cloneFromRaw ? cloneFromRaw : null;
                const cloneChats = raw?.cloneChats !== false;
                if (cloneFrom) {
                  if (!isValidDroneNameDashCase(cloneFrom)) {
                    rejected.push({ name, error: 'invalid cloneFrom (expected dash-case, max 48 chars)', status: 400 });
                    continue;
                  }
                  if (cloneFrom === name) {
                    rejected.push({ name, error: 'cloneFrom cannot equal name', status: 400 });
                    continue;
                  }
                  if (!regAny?.drones?.[cloneFrom]) {
                    rejected.push({ name, error: `unknown cloneFrom drone: ${cloneFrom}`, status: 404 });
                    continue;
                  }
                }

                regAny.pending[name] = {
                  name,
                  group: group ?? undefined,
                  repoPath,
                  containerPort: containerPort ?? 7777,
                  build,
                  createdAt: nowIso(),
                  updatedAt: nowIso(),
                  phase: 'starting',
                  message: 'Starting…',
                  ...(cloneFrom ? { cloneFrom, cloneChats: Boolean(cloneChats) } : {}),
                  ...(seedPrompt || seedAgent || seedModel
                    ? {
                        seed: {
                          chatName: seedChatName,
                          ...(seedModel ? { model: seedModel } : {}),
                          ...(seedPrompt ? { prompt: seedPrompt } : {}),
                          ...(seedCwdRaw ? { cwd: String(seedCwdRaw) } : {}),
                          ...(seedAgent ? { agent: seedAgent } : {}),
                        },
                      }
                    : {}),
                };
              }

              accepted.push({ name, phase: 'starting' });
            }

            return { accepted, rejected };
          });
          accepted = result.accepted;
          rejected = result.rejected;
        } catch (e: any) {
          json(res, 500, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        // Enqueue provisioning after pending is persisted.
        for (const a of accepted) enqueueProvisioning(a.name);

        json(res, 202, { ok: true, accepted, rejected, total: list.length });
        return;
      }

      // GET /api/drones
      if (method === 'GET' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'drones') {
        const regAny: any = await loadRegistry();

        // Best-effort: if the Hub restarted while drones were pending, resume provisioning.
        // This endpoint is polled frequently, so it serves as a natural "self-heal" hook.
        enqueueProvisioningForAllPending(regAny);

        // Best-effort: keep the "typing" badge accurate even when a drone isn't selected.
        // We don't await this work; it updates registry in the background and will be reflected
        // in the next polls.
        try {
          for (const d of Object.values(regAny.drones ?? {}) as any[]) {
            const droneName = String(d?.name ?? '').trim();
            if (!droneName) continue;
            if (!d?.chats || typeof d.chats !== 'object') continue;
            for (const [chatName, entry] of Object.entries(d.chats)) {
              if (chatHasReconcilablePendingPrompts(entry)) enqueueReconcile(droneName, String(chatName));
            }
          }
        } catch {
          // ignore
        }

        // Reconcile seeding prompt completion (restart-resumable).
        // If a seed prompt finished in the drone daemon, clear hub.seeding (or surface error).
        let hubMetaChanged = false;
        for (const d of Object.values(regAny.drones ?? {}) as any[]) {
          const hub = d?.hub;
          if (!hub || String(hub?.phase ?? '') !== 'seeding') continue;
          const promptId = String(hub?.promptId ?? '').trim();
          if (!promptId) continue;
          const token = typeof d.token === 'string' ? d.token : '';
          const hostPort =
            typeof d.hostPort === 'number' && Number.isFinite(d.hostPort)
              ? d.hostPort
              : await resolveHostPort(d.name, d.containerPort);
          if (!hostPort || !token) continue;
          try {
            // eslint-disable-next-line no-await-in-loop
            const r: any = await dronePromptGet(makeClient(hostPort, token), promptId);
            const job = r?.job ?? null;
            const st = String(job?.state ?? '').trim();
            if (st === 'done') {
              delete d.hub;
              hubMetaChanged = true;
            } else if (st === 'failed') {
              d.hub = { phase: 'error', message: String(job?.error ?? 'Seed failed'), updatedAt: nowIso() };
              hubMetaChanged = true;
            }
          } catch {
            // ignore; keep seeding
          }
        }
        const hubPatches: Array<{ name: string; hub: any | null }> = [];
        if (hubMetaChanged) {
          // NOTE: Apply patches under a lock to avoid clobbering concurrent registry writers.
          for (const d of Object.values(regAny.drones ?? {}) as any[]) {
            const hub = d?.hub;
            if (!hub || String(hub?.phase ?? '') !== 'seeding') continue;
            const promptId = String(hub?.promptId ?? '').trim();
            if (!promptId) continue;
            // Only patch drones where we already cleared/updated hub during the loop above.
            // (Those changes were made in-place on `regAny`.)
            if (!d.hub) {
              hubPatches.push({ name: String(d?.name ?? '').trim(), hub: null });
            } else if (String(d?.hub?.phase ?? '') === 'error') {
              hubPatches.push({ name: String(d?.name ?? '').trim(), hub: d.hub });
            }
          }
          if (hubPatches.length > 0) {
            try {
              await updateRegistry((regLatest: any) => {
                for (const p of hubPatches) {
                  const n = String(p?.name ?? '').trim();
                  if (!n) continue;
                  const d = regLatest?.drones?.[n];
                  if (!d) continue;
                  if (p.hub == null) {
                    delete d.hub;
                  } else {
                    d.hub = p.hub;
                  }
                  regLatest.drones = regLatest.drones ?? {};
                  regLatest.drones[n] = d;
                }
              });
            } catch {
              // ignore
            }
          }
        }

        // Auto-clear stale "repo pull conflict" hub errors once no merge conflicts remain.
        // This keeps the sidebar/header badge in sync after users finish conflict resolution.
        const autoClearedConflictErrors = new Set<string>();
        for (const d of Object.values(regAny.drones ?? {}) as any[]) {
          const name = String(d?.name ?? '').trim();
          if (!name) continue;
          if (String(d?.hub?.phase ?? '').trim().toLowerCase() !== 'error') continue;
          const lastPullMode = String(d?.repo?.lastPull?.mode ?? '').trim().toLowerCase();
          if (lastPullMode !== 'host-conflicts-ready') continue;
          const repoPathRaw = String(d?.repoPath ?? '').trim();
          if (!repoPathRaw) continue;
          try {
            // eslint-disable-next-line no-await-in-loop
            const repoRoot = await gitTopLevel(repoPathRaw);
            // eslint-disable-next-line no-await-in-loop
            const changes = await gitRepoChangesSummary(repoRoot);
            if (Number(changes?.counts?.conflicted ?? 0) === 0) {
              delete d.hub;
              d.repo = d.repo ?? {};
              d.repo.lastPullError = null;
              autoClearedConflictErrors.add(name);
            }
          } catch {
            // ignore; keep current hub error until we can verify repo state
          }
        }
        if (autoClearedConflictErrors.size > 0) {
          try {
            const names = Array.from(autoClearedConflictErrors);
            await updateRegistry((regLatest: any) => {
              for (const rawName of names) {
                const name = String(rawName ?? '').trim();
                if (!name) continue;
                const d = regLatest?.drones?.[name];
                if (!d) continue;
                if (String(d?.hub?.phase ?? '').trim().toLowerCase() === 'error') delete d.hub;
                d.repo = d.repo ?? {};
                if (typeof d.repo.lastPullError === 'string') d.repo.lastPullError = null;
                regLatest.drones = regLatest.drones ?? {};
                regLatest.drones[name] = d;
              }
            });
          } catch {
            // ignore
          }
        }
        const pendingList: any[] = Object.values(regAny?.pending ?? {});

        const pendingSummaries = pendingList.map((p) => {
          const repoAttached = Boolean(String(p?.repoPath ?? '').trim());
          const phase = String(p?.phase ?? 'starting') as PendingPhase;
          const seed = p?.seed;
          const hasSeed =
            seed &&
            typeof seed === 'object' &&
            (Boolean((seed as any)?.agent) ||
              Boolean(String((seed as any)?.prompt ?? '').trim()) ||
              Boolean(String((seed as any)?.chatName ?? '').trim()) ||
              Boolean(String((seed as any)?.cwd ?? '').trim()));
          const message =
            typeof p?.message === 'string' ? p.message : phase === 'error' ? 'Failed' : hasSeed ? 'Seeding…' : 'Starting…';
          const err = typeof p?.error === 'string' ? p.error : null;
          // Important: pending entries with a seed prompt are not necessarily *currently* "seeding".
          // They can still be creating the container, so reflect the actual phase to avoid confusion.
          const hubPhase: any = phase === 'error' ? 'error' : phase === 'seeding' ? 'seeding' : 'starting';
          return {
            name: String(p?.name ?? ''),
            group: typeof p?.group === 'string' && p.group.trim() ? p.group.trim() : null,
            createdAt: String(p?.createdAt ?? nowIso()),
            repoAttached,
            repoPath: repoAttached ? String(p?.repoPath ?? '') : '',
            containerPort: typeof p?.containerPort === 'number' && Number.isFinite(p.containerPort) ? p.containerPort : 7777,
            hostPort: null,
            statusOk: false,
            status: null,
            statusError: phase === 'error' ? (err ?? message ?? 'failed') : null,
            chats: [],
            hubPhase,
            hubMessage: phase === 'error' ? (err ?? message ?? null) : message,
            busy: false,
          };
        });

        const realSummaries = await Promise.all(
          Object.values(regAny.drones ?? {}).map(async (d: any) => {
            const hostPort =
              typeof d.hostPort === 'number' && Number.isFinite(d.hostPort)
                ? d.hostPort
                : await resolveHostPort(d.name, d.containerPort);

            const hubPhase = typeof d?.hub?.phase === 'string' ? String(d.hub.phase) : null;
            const hubMessage = typeof d?.hub?.message === 'string' ? String(d.hub.message) : null;
            const repoAttached = Boolean(String(d?.repo?.dest ?? '').trim()) || Boolean(String(d?.repo?.seededAt ?? '').trim());

            let statusOk = false;
            let status: any = null;
            let statusError: string | null = null;
            const token = typeof d.token === 'string' ? d.token : '';
            if (hostPort && token) {
              try {
                status = await droneStatus(makeClient(hostPort, token));
                statusOk = true;
              } catch (e: any) {
                statusError = e?.message ?? String(e);
              }
            } else if (!hostPort) {
              statusError = 'no host port mapped (container likely stopped)';
            } else {
              statusError = 'missing token (still starting?)';
            }

            return {
              name: d.name,
              group: d.group ?? null,
              createdAt: d.createdAt,
              repoAttached,
              repoPath: repoAttached ? String(d.repoPath ?? '') : '',
              containerPort: d.containerPort,
              hostPort: hostPort ?? null,
              statusOk,
              status,
              statusError,
              chats: Object.keys(d.chats ?? {}),
              hubPhase,
              hubMessage,
              busy: anyActivePendingPromptsForDrone(d),
            };
          })
        );

        // Deduplicate by name (prefer real drone over pending).
        const byName = new Map<string, any>();
        for (const p of pendingSummaries) {
          if (p?.name) byName.set(p.name, p);
        }
        for (const d of realSummaries) {
          if (d?.name) byName.set(d.name, d);
        }
        const drones = Array.from(byName.values()).filter((x) => x?.name);

        json(res, 200, { ok: true, drones });
        return;
      }

      // POST /api/drones/:name/hub/error/clear
      // Manually clear Hub-side error badge/message for a drone.
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'hub' &&
        parts[4] === 'error' &&
        parts[5] === 'clear'
      ) {
        const droneName = decodeURIComponent(parts[2]);
        if (!(await resolveDroneOrRespond(res, droneName))) return;
        let cleared = false;
        await updateRegistry((reg2: any) => {
          const dd = reg2?.drones?.[droneName];
          if (!dd) return;
          if (String(dd?.hub?.phase ?? '').trim().toLowerCase() === 'error') {
            delete dd.hub;
            cleared = true;
          }
          dd.repo = dd.repo ?? {};
          if (typeof dd.repo.lastPullError === 'string') dd.repo.lastPullError = null;
          reg2.drones = reg2.drones ?? {};
          reg2.drones[droneName] = dd;
        });
        json(res, 200, { ok: true, name: droneName, cleared });
        return;
      }

      // GET /api/drones/:name/ports
      // Exposes *all* host->container port mappings (like `dvm ports <name>`).
      // GET /api/drones/:name/fs/list?path=/...
      // Lists files/folders in a container path.
      if (method === 'GET' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'fs' && parts[4] === 'list') {
        const droneName = decodeURIComponent(parts[2]);
        const d = await resolveDroneOrRespond(res, droneName);
        if (!d) return;

        const targetPath = normalizeContainerPath(u.searchParams.get('path') ?? '/');
        const script = [
          'set -euo pipefail',
          `target=${bashQuote(targetPath)}`,
          'if [ ! -d "$target" ]; then',
          '  echo "__ERR__\tnot-dir"',
          '  exit 3',
          'fi',
          'cd "$target"',
          'resolved=$(pwd -P)',
          'printf "__PATH__\t%s\n" "$resolved"',
          'shopt -s dotglob nullglob',
          'for p in ./*; do',
          '  [ -e "$p" ] || continue',
          '  name=$(basename -- "$p")',
          '  kind=o',
          '  if [ -d "$p" ]; then kind=d; elif [ -f "$p" ]; then kind=f; fi',
          '  size=$(stat -c %s -- "$p" 2>/dev/null || echo 0)',
          '  mtime=$(stat -c %Y -- "$p" 2>/dev/null || echo 0)',
          '  printf "%s\t%s\t%s\t%s\n" "$name" "$kind" "$size" "$mtime"',
          'done',
        ].join('\n');

        try {
          const r = await dvmExec(String(d?.name ?? droneName), 'bash', ['-lc', script]);
          if (r.code !== 0) {
            const out = `${r.stdout || ''}\n${r.stderr || ''}`;
            if (/\bnot-dir\b/i.test(out)) {
              json(res, 404, { ok: false, error: `path is not a directory: ${targetPath}`, name: droneName, path: targetPath });
              return;
            }
            json(res, 500, { ok: false, error: (r.stderr || r.stdout || 'failed to list files').trim(), name: droneName, path: targetPath });
            return;
          }

          const parsed = parseContainerFsListOutput(r.stdout || '');
          json(res, 200, {
            ok: true,
            name: droneName,
            path: parsed.resolvedPath,
            entries: parsed.entries,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = looksLikeMissingContainerError(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, name: droneName, path: targetPath });
          return;
        }
      }

      // GET /api/drones/:name/fs/thumb?path=/...
      // Returns image bytes for thumbnail rendering.
      if (method === 'GET' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'fs' && parts[4] === 'thumb') {
        const droneName = decodeURIComponent(parts[2]);
        const d = await resolveDroneOrRespond(res, droneName);
        if (!d) return;

        const targetPath = normalizeContainerPath(u.searchParams.get('path') ?? '');
        if (!targetPath || targetPath === '/') {
          json(res, 400, { ok: false, error: 'missing file path' });
          return;
        }
        if (!isLikelyImagePath(targetPath)) {
          json(res, 415, { ok: false, error: 'not an image file' });
          return;
        }

        const script = [
          'set -euo pipefail',
          `target=${bashQuote(targetPath)}`,
          `max=${String(FS_THUMB_MAX_BYTES)}`,
          'if [ ! -f "$target" ]; then',
          '  echo "__ERR__\tnot-file"',
          '  exit 3',
          'fi',
          'size=$(wc -c < "$target" | tr -d "[:space:]")',
          'if [ -z "$size" ]; then size=0; fi',
          'if [ "$size" -gt "$max" ]; then',
          '  printf "__ERR__\ttoo-large\t%s\n" "$size"',
          '  exit 4',
          'fi',
          'mime=""',
          'if command -v file >/dev/null 2>&1; then',
          '  mime=$(file -Lb --mime-type -- "$target" 2>/dev/null || true)',
          'fi',
          'printf "__META__\t%s\t%s\n" "$mime" "$size"',
          'base64 < "$target" | tr -d "\\n"',
        ].join('\n');

        try {
          const r = await dvmExec(String(d?.name ?? droneName), 'bash', ['-lc', script]);
          const stdout = String(r.stdout ?? '');
          if (r.code !== 0) {
            if (stdout.includes('__ERR__\tnot-file')) {
              json(res, 404, { ok: false, error: `file not found: ${targetPath}` });
              return;
            }
            const large = stdout.match(/__ERR__\ttoo-large\t(\d+)/);
            if (large) {
              json(res, 413, { ok: false, error: `image too large (${large[1]} bytes, max ${FS_THUMB_MAX_BYTES})` });
              return;
            }
            json(res, 500, { ok: false, error: (r.stderr || r.stdout || 'failed reading thumbnail').trim() });
            return;
          }

          const firstNl = stdout.indexOf('\n');
          if (firstNl < 0) {
            json(res, 500, { ok: false, error: 'thumbnail response malformed' });
            return;
          }
          const metaLine = stdout.slice(0, firstNl);
          const b64 = stdout.slice(firstNl + 1).trim();
          const meta = metaLine.split('\t');
          if (meta.length < 3 || meta[0] !== '__META__') {
            json(res, 500, { ok: false, error: 'thumbnail metadata missing' });
            return;
          }

          const mimeRaw = String(meta[1] ?? '').trim().toLowerCase();
          const mime = mimeRaw.startsWith('image/') ? mimeRaw : guessImageMimeType(targetPath);
          if (!mime.startsWith('image/')) {
            json(res, 415, { ok: false, error: 'not an image file' });
            return;
          }

          let buf: Buffer;
          try {
            buf = Buffer.from(b64, 'base64');
          } catch {
            json(res, 500, { ok: false, error: 'failed decoding image bytes' });
            return;
          }

          res.statusCode = 200;
          res.setHeader('content-type', mime);
          res.setHeader('cache-control', 'no-store');
          res.end(buf);
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = looksLikeMissingContainerError(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // GET /api/drones/:name/preview/:containerPort/*
      // Reverse-proxies HTTP traffic to a container port (resolved via host mapping).
      if (method === 'GET' && parts.length >= 5 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'preview') {
        const droneName = decodeURIComponent(parts[2]);
        const containerPort = Number(parts[4]);
        if (!Number.isFinite(containerPort) || containerPort <= 0 || Math.floor(containerPort) !== containerPort) {
          json(res, 400, { ok: false, error: 'invalid container port' });
          return;
        }

        const d = await resolveDroneOrRespond(res, droneName);
        if (!d) return;

        try {
          const ports = await dvmPorts(String(d?.name ?? droneName));
          const mapped = ports.find(
            (p) =>
              Number(p?.containerPort) === containerPort &&
              typeof p?.hostPort === 'number' &&
              Number.isFinite(p.hostPort),
          );
          if (!mapped?.hostPort) {
            json(res, 404, { ok: false, error: `container port ${containerPort} is not mapped on host` });
            return;
          }

          const restPath = parts.length > 5 ? `/${parts.slice(5).map((seg) => encodeURIComponent(seg)).join('/')}` : '/';
          const targetUrl = `http://127.0.0.1:${mapped.hostPort}${restPath}${u.search || ''}`;
          const upstream = await fetch(targetUrl, {
            method: 'GET',
            headers: {
              accept: String(req.headers.accept ?? '*/*'),
              'accept-language': String(req.headers['accept-language'] ?? ''),
              'user-agent': String(req.headers['user-agent'] ?? 'drone-hub-preview-proxy'),
            },
            redirect: 'manual',
            cache: 'no-store',
          });

          res.statusCode = upstream.status;
          upstream.headers.forEach((value, key) => {
            const k = key.toLowerCase();
            if (k === 'content-length' || k === 'transfer-encoding' || k === 'connection') return;
            // Keep iframe preview usable even when upstream sends restrictive frame headers.
            if (k === 'x-frame-options' || k === 'content-security-policy') return;
            res.setHeader(key, value);
          });
          res.setHeader('cache-control', 'no-store');
          const body = Buffer.from(await upstream.arrayBuffer());
          res.end(body);
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          json(res, 502, { ok: false, error: `preview proxy failed: ${msg}` });
          return;
        }
      }

      if (method === 'GET' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'ports') {
        const droneName = decodeURIComponent(parts[2]);
        const d = await resolveDroneOrRespond(res, droneName);
        if (!d) return;
        try {
          const ports = await dvmPorts(String(d?.name ?? droneName));
          json(res, 200, { ok: true, name: droneName, ports });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = looksLikeMissingContainerError(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, name: droneName });
          return;
        }
      }

      // GET /api/drones/:name/repo/changes
      // Returns repo status in a machine-friendly shape for source-control style UIs.
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'changes'
      ) {
        const droneName = decodeURIComponent(parts[2]);
        const d = await resolveDroneOrRespond(res, droneName);
        if (!d) return;
        const repoAttached = Boolean(String(d?.repo?.dest ?? '').trim()) || Boolean(String(d?.repo?.seededAt ?? '').trim());
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathInContainer = droneRepoPathInContainer(d);
        try {
          const { repoRoot, summary } = await droneRepoChangesSummary({
            container: droneName,
            repoPathInContainer,
          });
          json(res, 200, {
            ok: true,
            name: droneName,
            repoRoot,
            branch: summary.branch,
            counts: summary.counts,
            entries: summary.entries,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          json(res, 500, { ok: false, error: msg });
          return;
        }
      }

      // GET /api/drones/:name/repo/diff?path=<repo-relative>&kind=staged|unstaged
      // Returns unified diff text for a single file path.
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'diff'
      ) {
        const droneName = decodeURIComponent(parts[2]);
        const d = await resolveDroneOrRespond(res, droneName);
        if (!d) return;
        const repoAttached = Boolean(String(d?.repo?.dest ?? '').trim()) || Boolean(String(d?.repo?.seededAt ?? '').trim());
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathInContainer = droneRepoPathInContainer(d);

        const filePath = String(u.searchParams.get('path') ?? '').trim();
        if (!filePath) {
          json(res, 400, { ok: false, error: 'missing diff path' });
          return;
        }
        const rawKind = String(u.searchParams.get('kind') ?? 'unstaged').trim().toLowerCase();
        const kind = rawKind === 'staged' ? 'staged' : 'unstaged';

        try {
          const repoRootRaw = await runGitInDroneOrThrow({
            container: droneName,
            repoPathInContainer,
            args: ['rev-parse', '--show-toplevel'],
          });
          const repoRoot = String(repoRootRaw.stdout ?? '').trim() || repoPathInContainer;
          const diff = await droneRepoDiffForPath({
            container: droneName,
            repoPathInContainer,
            filePath,
            kind,
            contextLines: 3,
          });
          json(res, 200, {
            ok: true,
            name: droneName,
            repoRoot,
            path: diff.path,
            kind: diff.kind,
            diff: diff.diff,
            truncated: diff.truncated,
            fromUntracked: diff.fromUntracked,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          json(res, 500, { ok: false, error: msg });
          return;
        }
      }

      // POST /api/drones/:name/repo/reseed
      // Re-seed the container repo from the host repo (offline, no bind mount).
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'reseed'
      ) {
        const droneName = decodeURIComponent(parts[2]);
        const d = await resolveDroneOrRespond(res, droneName);
        if (!d) return;
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        await setDroneHubMeta(droneName, { phase: 'seeding', message: 'Seeding repo…' });
        try {
          const repoRoot = await gitTopLevel(repoPathRaw);
          const baseRef = await gitCurrentBranchOrSha(repoRoot);
          await dvmRepoSeed({
            container: droneName,
            hostPath: repoRoot,
            dest: '/work/repo',
            baseRef: 'HEAD',
            branch: 'dvm/work',
            clean: true,
            timeoutMs: defaultRepoSeedTimeoutMs(),
          });
          await updateRegistry((reg2: any) => {
            const dd = reg2?.drones?.[droneName];
            if (!dd) return;
            dd.repoPath = repoRoot;
            dd.cwd = '/work/repo';
            dd.repo = dd.repo ?? {};
            dd.repo.dest = '/work/repo';
            dd.repo.branch = 'dvm/work';
            dd.repo.baseRef = baseRef;
            dd.repo.seededAt = nowIso();
            dd.repo.lastSeedError = null;
            reg2.drones = reg2.drones ?? {};
            reg2.drones[droneName] = dd;
          });
          await setDroneHubMeta(droneName, null);
          json(res, 200, { ok: true, name: droneName, repoRoot, baseRef });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          await updateRegistry((reg2: any) => {
            const dd = reg2?.drones?.[droneName];
            if (!dd) return;
            dd.repo = dd.repo ?? {};
            dd.repo.lastSeedError = msg;
            reg2.drones = reg2.drones ?? {};
            reg2.drones[droneName] = dd;
          });
          await setDroneHubMeta(droneName, { phase: 'error', message: `Repo seed failed: ${msg}` });
          json(res, 500, { ok: false, error: msg });
          return;
        }
      }

      // POST /api/drones/:name/repo/pull
      // Pull container repo changes onto the host repo as a normal git merge (no auto-commit).
      // Exports a bundle from the container, imports it to a temporary host ref, then merges that ref.
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull'
      ) {
        const droneName = decodeURIComponent(parts[2]);
        const d = await resolveDroneOrRespond(res, droneName);
        if (!d) return;
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }

        await setDroneHubMeta(droneName, { phase: 'seeding', message: 'Pulling repo changes…' });

        let repoRoot = '';
        let fromRef = '';
        let exportPath = '';
        let importRefName = '';
        let importRefSha = '';
        const repoPathInContainer = String(d?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
        let stashed = false;
        let stashPopOk: boolean | null = null;
        let stashPopText: string | null = null;
        let exportedHeadSha: string | null = null;
        let baseAdvanced = false;
        let baseAdvanceError: string | null = null;
        let prePullBaseSha: string | null = null;
        let prePullBaseAdvanced = false;
        let prePullBaseAdvanceError: string | null = null;
        let hostConflictState = false;
        let noChangesToPull = false;

        const tryAdvanceContainerExportBase = async () => {
          if (!exportedHeadSha) return;
          try {
            await dvmRepoSetBaseSha({ container: droneName, repoPathInContainer, baseSha: exportedHeadSha });
            baseAdvanced = true;
          } catch (e: any) {
            baseAdvanceError = e?.message ?? String(e);
          }
        };

        try {
          repoRoot = await gitTopLevel(repoPathRaw);
          fromRef = String(d?.repo?.baseRef ?? '').trim() || (await gitCurrentBranchOrSha(repoRoot));

          // Guard host repo before modifying it.
          const clean = await gitIsClean(repoRoot);
          if (!clean) {
            hubLog('warn', 'Repo pull blocked by local host changes', { droneName, repoRoot });
            await setDroneHubMeta(droneName, null);
            json(res, 409, {
              ok: false,
              error: 'Host repo has local changes. Please stash or commit them before pulling changes.',
            });
            return;
          }
          if (clean) {
            const lastPullAny = d?.repo?.lastPull && typeof d.repo.lastPull === 'object' ? d.repo.lastPull : null;
            const lastMode = String((lastPullAny as any)?.mode ?? '').trim().toLowerCase();
            const lastExportedHeadSha = String((lastPullAny as any)?.exportedHeadSha ?? '').trim().toLowerCase();
            if (lastMode === 'host-conflicts-ready' && /^[0-9a-f]{40}$/.test(lastExportedHeadSha)) {
              prePullBaseSha = lastExportedHeadSha;
              try {
                await dvmRepoSetBaseSha({ container: droneName, repoPathInContainer, baseSha: lastExportedHeadSha });
                prePullBaseAdvanced = true;
              } catch (e: any) {
                prePullBaseAdvanceError = e?.message ?? String(e);
              }
            }
          }

          try {
            exportedHeadSha = await dvmRepoHeadSha({ container: droneName, repoPathInContainer });
          } catch (e: any) {
            baseAdvanceError = e?.message ?? String(e);
          }

          // Export container repo delta as a git bundle, then import to a temporary host ref.
          const patchesOutRoot = droneRootPath('repo-exports');
          await fs.mkdir(patchesOutRoot, { recursive: true });
          try {
            const exported = await dvmRepoExport({
              container: droneName,
              repoPathInContainer,
              outDir: patchesOutRoot,
              format: 'bundle',
            });
            exportPath = exported.exportedPath;
          } catch (e: any) {
            const exportMsg = e?.message ?? String(e);
            if (looksLikeEmptyBundleExportError(exportMsg)) {
              noChangesToPull = true;
            } else {
              throw e;
            }
          }

          if (noChangesToPull) {
            await tryAdvanceContainerExportBase();
            await updateRegistry((reg2: any) => {
              const dd = reg2?.drones?.[droneName];
              if (!dd) return;
              dd.repo = dd.repo ?? {};
              dd.repo.baseRef = fromRef;
              dd.repo.dest = dd.repo.dest ?? '/work/repo';
              dd.repo.branch = dd.repo.branch ?? 'dvm/work';
              dd.repo.lastPullAt = nowIso();
              dd.repo.lastPullError = null;
              dd.repo.lastPull = {
                mode: 'no-changes',
                exportFormat: 'bundle',
                exportPath: null,
                importedRef: null,
                importedRefSha: null,
                mergeSourceRef: null,
                stashed,
                stashPopOk,
                stashPopText,
                exportedHeadSha,
                baseAdvanced,
                baseAdvanceError,
                prePullBaseSha,
                prePullBaseAdvanced,
                prePullBaseAdvanceError,
              };
              reg2.drones = reg2.drones ?? {};
              reg2.drones[droneName] = dd;
            });
            hubLog('info', 'Repo pull completed with no new commits', { droneName, repoRoot, fromRef, exportedHeadSha });
            await setDroneHubMeta(droneName, null);
            json(res, 200, {
              ok: true,
              name: droneName,
              mode: 'no-changes',
              repoRoot,
              fromRef,
              noChanges: true,
              stashed,
              stashPopOk,
              stashPopText,
              exportedHeadSha,
              baseAdvanced,
              baseAdvanceError,
              prePullBaseSha,
              prePullBaseAdvanced,
              prePullBaseAdvanceError,
            });
            return;
          }

          const safeDroneRefSeg =
            String(droneName ?? '')
              .toLowerCase()
              .replace(/[^a-z0-9_.-]+/g, '-')
              .replace(/^-+|-+$/g, '') || 'drone';
          const importRunId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
          importRefName = `refs/drone/imports/${safeDroneRefSeg}/${importRunId}`;
          try {
            importRefSha = await importBundleHeadToHostRef({ repoRoot, bundlePath: exportPath, refName: importRefName });
          } catch (e: any) {
            const importMsg = e?.message ?? String(e);
            if (looksLikeBundleMissingPrerequisiteError(importMsg)) {
              const userMsg = 'Host repo is missing prerequisite commits for this drone export. Re-seed the drone and pull again.';
              hubLog('error', 'Repo pull bundle import missing prerequisites', {
                droneName,
                repoRoot,
                fromRef,
                importRefName,
                error: importMsg,
              });
              await updateRegistry((reg2: any) => {
                const dd = reg2?.drones?.[droneName];
                if (!dd) return;
                dd.repo = dd.repo ?? {};
                dd.repo.lastPullAt = nowIso();
                dd.repo.lastPullError = `${userMsg}\n\n${importMsg}`;
                dd.repo.lastPull = {
                  mode: 'bundle-import-missing-prereq',
                  exportFormat: 'bundle',
                  exportPath: exportPath || null,
                  importedRef: importRefName || null,
                  importedRefSha: null,
                  mergeSourceRef: importRefName || null,
                  stashed,
                  stashPopOk,
                  stashPopText,
                  exportedHeadSha,
                  baseAdvanced,
                  baseAdvanceError,
                  prePullBaseSha,
                  prePullBaseAdvanced,
                  prePullBaseAdvanceError,
                };
                reg2.drones = reg2.drones ?? {};
                reg2.drones[droneName] = dd;
              });
              await setDroneHubMeta(droneName, { phase: 'error', message: 'Repo pull needs reseed (history mismatch)' });
              json(res, 409, {
                ok: false,
                error: userMsg,
                code: 'bundle_missing_prereq',
                reseedRequired: true,
                stashed,
                stashPopOk,
                stashPopText,
                exportedHeadSha,
                baseAdvanced,
                baseAdvanceError,
                prePullBaseSha,
                prePullBaseAdvanced,
                prePullBaseAdvanceError,
              });
              return;
            }
            throw e;
          }

          // Merge imported drone commits into the host branch.
          // We intentionally do not auto-commit; users review/resolve and commit as normal.
          hostConflictState = true;
          await mergeBranchIntoMainWorkingTreeNoCommit({ repoRoot, branch: importRefName });

          await tryAdvanceContainerExportBase();

          await updateRegistry((reg2: any) => {
            const dd = reg2?.drones?.[droneName];
            if (!dd) return;
            dd.repo = dd.repo ?? {};
            dd.repo.baseRef = fromRef;
            dd.repo.dest = dd.repo.dest ?? '/work/repo';
            dd.repo.branch = dd.repo.branch ?? 'dvm/work';
            dd.repo.lastPullAt = nowIso();
            dd.repo.lastPullError = null;
            dd.repo.lastPull = {
              mode: 'bundle-merge-no-commit',
              exportFormat: 'bundle',
              exportPath,
              importedRef: importRefName,
              importedRefSha: importRefSha || null,
              mergeSourceRef: importRefName,
              quarantineBranch: null,
              worktreePath: null,
              stashed,
              stashPopOk,
              stashPopText,
              exportedHeadSha,
              baseAdvanced,
              baseAdvanceError,
              prePullBaseSha,
              prePullBaseAdvanced,
              prePullBaseAdvanceError,
            };
            reg2.drones = reg2.drones ?? {};
            reg2.drones[droneName] = dd;
          });

          await setDroneHubMeta(droneName, null);
          json(res, 200, {
            ok: true,
            name: droneName,
            mode: 'bundle-merge-no-commit',
            repoRoot,
            fromRef,
            exportFormat: 'bundle',
            exportPath,
            importedRef: importRefName,
            importedRefSha: importRefSha || null,
            mergeSourceRef: importRefName,
            stashed,
            stashPopOk,
            stashPopText,
            exportedHeadSha,
            baseAdvanced,
            baseAdvanceError,
            prePullBaseSha,
            prePullBaseAdvanced,
            prePullBaseAdvanceError,
          });
          return;
        } catch (e: any) {
          let msg = e?.message ?? String(e);
          let patchErr = isRepoPatchApplyError(e) ? e : null;

          if (patchErr?.kind === 'patch_apply_conflict') {
            if (!hostConflictState) {
              const fullMsg = `${msg}\n\nFailed importing bundle or preparing merge. Host repo was not modified.`;
              hubLog('error', 'Repo pull failed before host merge state', {
                droneName,
                repoRoot,
                fromRef,
                importRefName,
                error: msg,
              });
              await updateRegistry((reg2: any) => {
                const dd = reg2?.drones?.[droneName];
                if (!dd) return;
                dd.repo = dd.repo ?? {};
                dd.repo.lastPullAt = nowIso();
                dd.repo.lastPullError = fullMsg;
                dd.repo.lastPull = {
                  mode: 'bundle-prepare-conflict',
                  exportFormat: 'bundle',
                  exportPath: exportPath || null,
                  importedRef: importRefName || null,
                  importedRefSha: importRefSha || null,
                  mergeSourceRef: importRefName || null,
                  quarantineBranch: null,
                  worktreePath: null,
                  stashed,
                  stashPopOk,
                  stashPopText,
                  exportedHeadSha,
                  baseAdvanced,
                  baseAdvanceError,
                  prePullBaseSha,
                  prePullBaseAdvanced,
                  prePullBaseAdvanceError,
                };
                reg2.drones = reg2.drones ?? {};
                reg2.drones[droneName] = dd;
              });
              await setDroneHubMeta(droneName, { phase: 'error', message: 'Repo pull failed while importing bundle' });
              json(res, 500, {
                ok: false,
                error: fullMsg,
                code: patchErr.kind,
                patchName: patchErr.patchName ?? null,
                conflictFiles: patchErr.conflictFiles ?? [],
                hostConflictState: false,
                stashed,
                stashPopOk,
                stashPopText,
                exportedHeadSha,
                baseAdvanced,
                baseAdvanceError,
                prePullBaseSha,
                prePullBaseAdvanced,
                prePullBaseAdvanceError,
              });
              return;
            }

            const guidance = [
              'Conflicts were applied to your host repo as normal Git merge conflict markers.',
              'Conflict marker mapping: <<<<<<< ours is your current host branch; >>>>>>> theirs is the pulled drone branch.',
              'Resolve conflicts in your current branch, then stage and commit as usual.',
              stashed
                ? 'Your previous local changes were auto-stashed and left in stash. After resolving pull conflicts, run `git stash pop` when ready.'
                : '',
            ]
              .filter(Boolean)
              .join(' ');
            const fullMsg = `${msg}\n\n${guidance}`;
            hubLog('warn', 'Repo pull produced host merge conflicts', {
              droneName,
              repoRoot,
              fromRef,
              importRefName,
            });
            await updateRegistry((reg2: any) => {
              const dd = reg2?.drones?.[droneName];
              if (!dd) return;
              dd.repo = dd.repo ?? {};
              dd.repo.lastPullAt = nowIso();
              dd.repo.lastPullError = fullMsg;
              dd.repo.lastPull = {
                mode: 'host-conflicts-ready',
                exportFormat: 'bundle',
                exportPath: exportPath || null,
                importedRef: importRefName || null,
                importedRefSha: importRefSha || null,
                mergeSourceRef: importRefName || null,
                patchesDir: null,
                diffPath: null,
                quarantineBranch: null,
                worktreePath: null,
                stashed,
                stashPopOk,
                stashPopText,
                exportedHeadSha,
                baseAdvanced,
                baseAdvanceError,
                prePullBaseSha,
                prePullBaseAdvanced,
                prePullBaseAdvanceError,
              };
              reg2.drones = reg2.drones ?? {};
              reg2.drones[droneName] = dd;
            });
            await setDroneHubMeta(
              droneName,
              {
                phase: 'error',
                message: `Repo pull conflict${patchErr.patchName ? ` (${patchErr.patchName})` : ''}: resolve conflicts in host repo`,
              }
            );
            json(res, 409, {
              ok: false,
              error: fullMsg,
              code: 'host_conflicts_ready',
              patchName: patchErr.patchName ?? null,
              conflictFiles: patchErr.conflictFiles ?? [],
              diffPath: null,
              hostConflictState: true,
              stashed,
              stashPopOk,
              stashPopText,
              exportedHeadSha,
              baseAdvanced,
              baseAdvanceError,
              prePullBaseSha,
              prePullBaseAdvanced,
              prePullBaseAdvanceError,
            });
            return;
          }

          const statusCode = 500;
          hubLog('error', 'Repo pull failed', {
            droneName,
            repoRoot,
            fromRef,
            importRefName,
            error: msg,
          });
          await updateRegistry((reg2: any) => {
            const dd = reg2?.drones?.[droneName];
            if (!dd) return;
            dd.repo = dd.repo ?? {};
            dd.repo.lastPullAt = nowIso();
            dd.repo.lastPullError = msg;
            dd.repo.lastPull = {
              mode: 'pull-failed',
              exportFormat: 'bundle',
              exportPath: exportPath || null,
              importedRef: importRefName || null,
              importedRefSha: importRefSha || null,
              mergeSourceRef: importRefName || null,
              stashed,
              stashPopOk,
              stashPopText,
              exportedHeadSha,
              baseAdvanced,
              baseAdvanceError,
              prePullBaseSha,
              prePullBaseAdvanced,
              prePullBaseAdvanceError,
            };
            reg2.drones = reg2.drones ?? {};
            reg2.drones[droneName] = dd;
          });
          await setDroneHubMeta(droneName, { phase: 'error', message: `Repo pull failed: ${msg}` });
          json(res, statusCode, {
            ok: false,
            error: msg,
            code: patchErr?.kind ?? null,
            patchName: patchErr?.patchName ?? null,
            conflictFiles: patchErr?.conflictFiles ?? [],
          });
          return;
        } finally {
          if (exportPath) {
            try {
              await fs.rm(exportPath, { recursive: true, force: true });
            } catch (e: any) {
              hubLog('warn', 'Repo pull export cleanup failed', {
                droneName,
                exportPath,
                error: e?.message ?? String(e),
              });
            }
          }
          if (repoRoot && importRefName) {
            await deleteHostRefBestEffort({ repoRoot, refName: importRefName });
          }
        }
      }

      // POST /api/drones/group-set
      // Assign one or more drones to a group (or clear group when omitted/null/"ungrouped").
      if (method === 'POST' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'drones' && parts[2] === 'group-set') {
        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const rawList = Array.isArray(body?.drones) ? body.drones : [];
        if (rawList.length === 0) {
          json(res, 400, { ok: false, error: 'missing drones (expected non-empty array)' });
          return;
        }

        const seen = new Set<string>();
        const dronesToMove: string[] = [];
        for (const rawName of rawList) {
          const name = String(rawName ?? '').trim();
          if (!name) {
            json(res, 400, { ok: false, error: 'invalid drone name (empty)' });
            return;
          }
          if (!isValidDroneNameDashCase(name)) {
            json(res, 400, { ok: false, error: `invalid drone name: ${name}` });
            return;
          }
          if (seen.has(name)) continue;
          seen.add(name);
          dronesToMove.push(name);
        }

        const groupRaw = body?.group;
        if (!(groupRaw == null || typeof groupRaw === 'string')) {
          json(res, 400, { ok: false, error: 'invalid group (expected string or null)' });
          return;
        }
        const groupValue = String(groupRaw ?? '').trim();
        const nextGroup = !groupValue || isUngroupedGroupName(groupValue) ? null : groupValue;

        const result = await updateRegistry((regAny: any) => {
          const moved: Array<{ name: string; previousGroup: string | null; group: string | null }> = [];
          const rejected: Array<{ name: string; error: string }> = [];

          for (const name of dronesToMove) {
            const real = regAny?.drones?.[name] ?? null;
            const pending = regAny?.pending?.[name] ?? null;
            const source = real ?? pending;
            if (!source) {
              rejected.push({ name, error: `unknown drone: ${name}` });
              continue;
            }

            const prevRaw = String(source?.group ?? '').trim();
            const previousGroup = !prevRaw || isUngroupedGroupName(prevRaw) ? null : prevRaw;

            if (real) {
              if (nextGroup == null) {
                delete real.group;
              } else {
                real.group = nextGroup;
              }
              regAny.drones = regAny.drones ?? {};
              regAny.drones[name] = real;
            }
            if (pending) {
              if (nextGroup == null) {
                delete pending.group;
              } else {
                pending.group = nextGroup;
              }
              regAny.pending = regAny.pending ?? {};
              regAny.pending[name] = pending;
            }

            moved.push({ name, previousGroup, group: nextGroup });
          }

          return { moved, rejected };
        });

        json(res, 200, { ok: true, group: nextGroup, moved: result.moved, rejected: result.rejected, total: dronesToMove.length });
        return;
      }

      // POST /api/drones/:name/rename
      if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'rename') {
        const oldName = decodeURIComponent(parts[2]);
        if (!isValidDroneNameDashCase(oldName)) {
          json(res, 400, { ok: false, error: `invalid drone name: ${oldName}` });
          return;
        }

        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const newName = String(body?.newName ?? '').trim();
        if (!isValidDroneNameDashCase(newName)) {
          json(res, 400, { ok: false, error: 'invalid newName (expected dash-case, max 48 chars)' });
          return;
        }
        if (oldName === newName) {
          json(res, 200, { ok: true, oldName, newName, renamed: false, reason: 'same-name' });
          return;
        }

        const startModeRaw = String(body?.startMode ?? '').trim().toLowerCase();
        const startMode: 'preserve' | 'always' | 'never' =
          startModeRaw === 'always' ? 'always' : startModeRaw === 'never' ? 'never' : 'preserve';
        const migrateVolumeName = Boolean(body?.migrateVolumeName);

        const renamed = await renameDroneByName({ oldName, newName, startMode, migrateVolumeName });
        if (!renamed.ok) {
          json(res, renamed.status, { ok: false, error: renamed.error });
          return;
        }

        json(res, 200, renamed);
        return;
      }

      // DELETE /api/drones/:name?keepVolume=0|1&forget=0|1
      if (method === 'DELETE' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'drones') {
        const droneName = decodeURIComponent(parts[2]);
        const keepVolume = parseBoolParam(u.searchParams.get('keepVolume'), false);
        const forget = parseBoolParam(u.searchParams.get('forget'), true);

        const pendingResult = await updateRegistry((regAny: any) => {
          if (regAny?.drones?.[droneName]) return { kind: 'real' as const };
          if (regAny?.pending?.[droneName]) {
            delete regAny.pending[droneName];
            return { kind: 'pending' as const };
          }
          return { kind: 'none' as const };
        });
        if (pendingResult.kind === 'pending') {
          dequeueProvisioning(droneName);
          json(res, 200, { ok: true, name: droneName, removedRegistry: false, removedPending: true });
          return;
        }
        if (pendingResult.kind === 'none') {
          json(res, 404, { ok: false, error: `unknown drone: ${droneName}` });
          return;
        }

        const r = await removeDroneByName({ name: droneName, keepVolume, forget });
        if (r.removeErr) {
          json(res, 500, {
            ok: false,
            name: droneName,
            error: r.removeErr,
            removedRegistry: r.removedRegistry,
          });
          return;
        }

        json(res, 200, { ok: true, name: droneName, removedRegistry: r.removedRegistry });
        return;
      }

      // DELETE /api/groups/:group?keepVolume=0|1&forget=0|1
      // NOTE: Groups are host-side metadata in the drone registry file. Deleting a group deletes all drones inside it.
      if (method === 'DELETE' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'groups') {
        const groupRaw = decodeURIComponent(parts[2]);
        const group = groupRaw.trim();
        if (!group) {
          json(res, 400, { ok: false, error: 'invalid group name' });
          return;
        }

        const keepVolume = parseBoolParam(u.searchParams.get('keepVolume'), false);
        const forget = parseBoolParam(u.searchParams.get('forget'), true);
        const wantsUngrouped = isUngroupedGroupName(group);

        const regAny: any = await loadRegistry();
        const realTargets = Object.values(regAny.drones ?? {})
          .filter((d: any) => {
            const droneGroup = String(d?.group ?? '').trim();
            if (wantsUngrouped) return !droneGroup || isUngroupedGroupName(droneGroup);
            return droneGroup === group;
          })
          .map((d: any) => String(d?.name ?? '').trim())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));

        const pendingTargets = Object.values(regAny.pending ?? {})
          .filter((d: any) => {
            const droneGroup = String(d?.group ?? '').trim();
            if (wantsUngrouped) return !droneGroup || isUngroupedGroupName(droneGroup);
            return droneGroup === group;
          })
          .map((d: any) => String(d?.name ?? '').trim())
          .filter(Boolean)
          .sort((a: string, b: string) => a.localeCompare(b));

        const targets = Array.from(new Set([...realTargets, ...pendingTargets])).sort((a, b) => a.localeCompare(b));

        if (targets.length === 0) {
          json(res, 404, { ok: false, error: `unknown group (or empty): ${group}` });
          return;
        }

        const removed: string[] = [];
        const pendingDeleted: string[] = [];
        const errors: Array<{ name: string; error: string; removedRegistry: boolean }> = [];

        for (const name of targets) {
          if (regAny?.pending?.[name] && !regAny?.drones?.[name]) {
            delete regAny.pending[name];
            pendingDeleted.push(name);
            removed.push(name);
            dequeueProvisioning(name);
            continue;
          }
          const r = await removeDroneByName({ name, keepVolume, forget });
          if (r.removeErr) {
            errors.push({ name, error: r.removeErr, removedRegistry: r.removedRegistry });
            continue;
          }
          removed.push(name);
        }

        if (errors.length > 0) {
          json(res, 500, { ok: false, group, removed, errors, total: targets.length });
          return;
        }

        // Persist any pending deletions (real deletions already saved by removeDroneByName).
        if (pendingDeleted.length > 0) {
          try {
            await updateRegistry((regLatest: any) => {
              for (const n of pendingDeleted) {
                if (regLatest?.pending?.[n] && !regLatest?.drones?.[n]) delete regLatest.pending[n];
              }
            });
          } catch {
            // ignore
          }
        }

        json(res, 200, { ok: true, group, removed, total: targets.length });
        return;
      }

      // POST /api/drones/:name/terminal/open?mode=shell|agent&chat=<chatName>&cwd=/path
      // Opens (or reuses) a tmux-backed terminal session for in-app web terminal use.
      if (method === 'POST' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'terminal' && parts[4] === 'open') {
        const droneName = decodeURIComponent(parts[2]);
        const d = await resolveDroneOrRespond(res, droneName);
        if (!d) return;

        const modeRaw = String(u.searchParams.get('mode') ?? 'shell')
          .trim()
          .toLowerCase();
        const mode: 'shell' | 'agent' = modeRaw === 'agent' ? 'agent' : 'shell';
        const chatName = normalizeChatName(u.searchParams.get('chat') ?? 'default');
        const defaultCwd = defaultDroneHomeCwd(d);
        const cwd = normalizeContainerPath(u.searchParams.get('cwd') ?? defaultCwd);

        try {
          try {
            await upgradeDroneDaemonInContainer({
              containerName: String(d?.name ?? droneName),
              containerPort: Number(d?.containerPort ?? 7777),
            });
          } catch {
            // Best-effort daemon refresh; continue if upgrade fails.
          }
          if (mode === 'agent') {
            await ensureChatEntry({ droneName, chatName });
            const tmuxCmd = await resolveChatTmuxCommand({ droneName, chatName });
            const { sessionName } = await ensureHubChatSessionRunning({
              containerName: String(d?.name ?? droneName),
              chatName,
              command: tmuxCmd,
              cwd,
            });
            json(res, 200, { ok: true, name: droneName, mode, chat: chatName, cwd, sessionName });
            return;
          }

          const sessionName = hubShellSessionName();
          await ensureHubSessionRunning({
            containerName: String(d?.name ?? droneName),
            sessionName,
            command: resolveHubTerminalShellCommand(),
            cwd,
          });
          json(res, 200, { ok: true, name: droneName, mode, chat: null, cwd, sessionName });
          return;
        } catch (e: any) {
          json(res, 500, { ok: false, error: e?.message ?? String(e), name: droneName, mode, chat: mode === 'agent' ? chatName : null });
          return;
        }
      }

      // GET /api/drones/:name/terminal/:session/output?since=<bytes>&maxBytes=<bytes>&tail=<lines>
      // Read output from a tmux-backed terminal session.
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'terminal' &&
        parts[5] === 'output'
      ) {
        const droneName = decodeURIComponent(parts[2]);
        const sessionName = decodeURIComponent(parts[4]);
        if (!isSafeTmuxSessionName(sessionName)) {
          json(res, 400, { ok: false, error: 'invalid session name' });
          return;
        }
        if (!isHubWebTerminalSessionName(sessionName)) {
          json(res, 404, { ok: false, error: 'unknown session', name: droneName, sessionName });
          return;
        }

        const d = await resolveDroneOrRespond(res, droneName);
        if (!d) return;

        const sinceRaw = u.searchParams.get('since');
        const maxBytesRaw = u.searchParams.get('maxBytes');
        const tailRaw = u.searchParams.get('tail');
        const since = parseOptionalNonNegativeInt(sinceRaw);
        const maxBytes = clampIntParam(maxBytesRaw, HUB_WEB_TERMINAL_MAX_BYTES, 1, HUB_WEB_TERMINAL_MAX_BYTES);
        const tailLines = clampIntParam(tailRaw, HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES, 0, HUB_WEB_TERMINAL_MAX_TAIL_LINES);

        try {
          const out = await dvmSessionRead({
            container: String(d?.name ?? droneName),
            session: sessionName,
            since,
            maxBytes: since != null ? maxBytes : undefined,
            tailLines: since != null ? undefined : tailLines,
          });
          json(res, 200, { ok: true, name: droneName, sessionName, ...out });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /Session not found:/i.test(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, name: droneName, sessionName });
          return;
        }
      }

      // POST /api/drones/:name/terminal/:session/input
      // Sends raw text into a tmux-backed terminal session.
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'terminal' &&
        parts[5] === 'input'
      ) {
        const droneName = decodeURIComponent(parts[2]);
        const sessionName = decodeURIComponent(parts[4]);
        if (!isSafeTmuxSessionName(sessionName)) {
          json(res, 400, { ok: false, error: 'invalid session name' });
          return;
        }
        if (!isHubWebTerminalSessionName(sessionName)) {
          json(res, 404, { ok: false, error: 'unknown session', name: droneName, sessionName });
          return;
        }

        const d = await resolveDroneOrRespond(res, droneName);
        if (!d) return;

        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const data = typeof body?.data === 'string' ? body.data : '';
        if (!data) {
          json(res, 400, { ok: false, error: 'missing input data' });
          return;
        }
        if (Buffer.byteLength(data, 'utf8') > 128 * 1024) {
          json(res, 413, { ok: false, error: 'input too large' });
          return;
        }

        try {
          await dvmSessionType(String(d?.name ?? droneName), sessionName, { text: data });
          json(res, 202, { ok: true, name: droneName, sessionName, bytes: Buffer.byteLength(data, 'utf8') });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /Session not found:/i.test(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, name: droneName, sessionName });
          return;
        }
      }

      // POST /api/drones/:name/open-terminal?mode=ssh|agent&chat=<chatName>
      // Opens a *real* terminal on the host machine (not a simulated web terminal).
      if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'open-terminal') {
        const droneName = decodeURIComponent(parts[2]);
        const modeRaw = String(u.searchParams.get('mode') ?? 'ssh').trim().toLowerCase();
        const mode = modeRaw === 'ssh' || modeRaw === 'agent' ? (modeRaw as 'ssh' | 'agent') : null;
        if (!mode) {
          json(res, 400, { ok: false, error: `invalid mode: ${modeRaw} (expected ssh|agent)` });
          return;
        }

        const reg = await loadRegistry();
        const drone = reg.drones[droneName];
        if (!drone) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneName}` });
          return;
        }

        const chatName = String(u.searchParams.get('chat') ?? 'default').trim() || 'default';
        if (mode === 'agent') {
          await ensureChatEntry({ droneName, chatName });
        }

        // CLI-agnostic "continuation": keep one tmux session per chat.
        // This avoids relying on any CLI-specific resume flag.
        const sessionName = hubChatSessionName(chatName);
        const terminal = String(u.searchParams.get('terminal') ?? '').trim() || null;
        const markerBase = process.env.XDG_RUNTIME_DIR && process.env.XDG_RUNTIME_DIR.trim() ? process.env.XDG_RUNTIME_DIR.trim() : os.tmpdir();
        const markerPath = `${markerBase}/drone-hub-terminal-${process.pid}-${crypto.randomBytes(4).toString('hex')}.ok`;
        const markerSnippet = `printf %s ok > ${bashQuote(markerPath)}`;
        const agentCmd = mode === 'agent' ? await resolveChatTmuxCommand({ droneName, chatName }) : resolveHubAgentCommand();
        const agentSessionEnv = [
          // Match non-tmux-ish colors as closely as possible.
          'export TERM=xterm-256color',
          'export COLORTERM=truecolor',
        ].join('; ');
        const defaultCwd = defaultDroneHomeCwd(drone);
        const cwd = normalizeContainerPath(u.searchParams.get('cwd') ?? defaultCwd);
        const manualSshCmd = buildDockerExecShellCommand(droneName, cwd);
        const sshCmd = manualSshCmd;
        const agentShell = `set -e; ${agentSessionEnv}; mkdir -p ${bashQuote(cwd)} 2>/dev/null || true; cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data; exec ${agentCmd}`;
        const agentStartCmd = buildDvmCommand([
          'session',
          'start',
          droneName,
          sessionName,
          '--reuse',
          '--',
          'bash',
          '-lc',
          agentShell,
        ]);
        const agentAttachCmd = buildDvmCommand(['session', 'attach', droneName, sessionName]);
        const tmuxTuneCmds = [
          // Disable status line (green bar) and "freeze-on-exit".
          // IMPORTANT: use `--` so dvm exec doesn't parse tmux flags like -g/-t.
          buildDvmCommand(['exec', droneName, '--', 'tmux', 'set-option', '-g', 'status', 'off']),
          buildDvmCommand(['exec', droneName, '--', 'tmux', 'set-window-option', '-g', 'remain-on-exit', 'off']),
          // Improve color fidelity inside tmux.
          buildDvmCommand(['exec', droneName, '--', 'tmux', 'set-option', '-g', 'default-terminal', 'xterm-256color']),
          buildDvmCommand([
            'exec',
            droneName,
            '--',
            'tmux',
            'set-option',
            '-ga',
            'terminal-overrides',
            ',xterm-256color:Tc,screen-256color:Tc,screen:Tc,xterm-kitty:Tc',
          ]),
          // Newer tmux supports terminal-features/terminal-overrides RGB; best-effort.
          buildDvmCommand([
            'exec',
            droneName,
            '--',
            'tmux',
            'set-option',
            '-ga',
            'terminal-features',
            ',xterm-256color:RGB,screen-256color:RGB,xterm-kitty:RGB',
          ]),
        ];
        const manualAgentCmd = `${buildDvmManualCommand([
          'session',
          'start',
          droneName,
          sessionName,
          '--reuse',
          '--',
          'bash',
          '-lc',
          `set -e; ${agentSessionEnv}; mkdir -p ${bashQuote(cwd)} 2>/dev/null || true; cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data; exec ${agentCmd}`,
        ])} && ${tmuxTuneCmds.map((c) => `${c} || true`).join(' && ')} && ${buildDvmManualCommand(['session', 'attach', droneName, sessionName])}`;

        const manualCommand = mode === 'ssh' ? manualSshCmd : manualAgentCmd;
        const command =
          mode === 'ssh'
            ? [
                'set +e',
                // Marker: prove that bash actually started (used by the launcher).
                markerSnippet,
                sshCmd,
                'code=$?',
                'echo',
                'echo "SSH exited with code $code"',
                'exec bash',
              ].join('; ')
            : [
                'set +e',
                markerSnippet,
                // Start (or reuse) a tmux-backed session that runs the Agent CLI, then attach to it.
                // This is more reliable than trying to attach to transient `drone agent` sessions.
                `echo "Starting Agent session (${sessionName})..."`,
                `${agentStartCmd} || true`,
                // Tune tmux for better UX/colors even when reusing the session.
                ...tmuxTuneCmds.map((c) => `${c} || true`),
                `${agentAttachCmd} || true`,
                'echo',
                'echo "If attach failed, you can run manually:"',
                `echo ${bashQuote(agentAttachCmd)}`,
                'echo',
                'echo "Falling back to a shell..."',
                sshCmd,
                'code=$?',
                'echo',
                'echo "Exited with code $code"',
                // Keep the terminal open after detach/exit.
                'exec bash',
              ].join('; ');

        const launched = await spawnTerminalWithBash(command, { terminal, markerPath });
        if (!launched.ok) {
          json(res, 500, {
            ok: false,
            error: launched.error,
            command,
            manualCommand,
            chat: chatName,
            sessionName,
            note: 'You can run this command manually in a terminal.',
          });
          return;
        }

        json(res, 200, { ok: true, name: droneName, mode, chat: chatName, sessionName, command, manualCommand, launcher: launched.launcher });
        return;
      }

      // POST /api/drones/:name/open-editor?editor=code|cursor&cwd=/path
      // Opens a local editor attached to the docker container (VS Code Dev Containers style).
      if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'open-editor') {
        const droneName = decodeURIComponent(parts[2]);
        const editorRaw = String(u.searchParams.get('editor') ?? 'code').trim().toLowerCase();
        const editor = editorRaw === 'code' || editorRaw === 'cursor' ? (editorRaw as 'code' | 'cursor') : null;
        if (!editor) {
          json(res, 400, { ok: false, error: `invalid editor: ${editorRaw} (expected code|cursor)` });
          return;
        }

        const reg = await loadRegistry();
        const drone = reg.drones[droneName];
        if (!drone) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneName}` });
          return;
        }

        const defaultCwd = defaultDroneHomeCwd(drone);
        const cwd = normalizeContainerPath(u.searchParams.get('cwd') ?? defaultCwd);
        const id = await dockerContainerId(drone.name);
        // Dev Containers "attached-container" URIs expect a hex-encoded JSON payload as the authority suffix.
        // If we pass a raw docker ID, the extension will try to decode it and we end up with a corrupted
        // container identifier (seen as "��..." in logs).
        const containerName = `/${String(drone.name ?? '').trim()}`;
        const authorityJson = JSON.stringify({ settingType: 'container', containerId: id, containerName });
        const authority = hexEncodeUtf8(authorityJson);
        const uri = `vscode-remote://attached-container+${authority}${encodeRemotePath(cwd)}`;
        const manualCommand = `${editor} --folder-uri ${shellQuoteIfNeeded(uri)}`;

        const launched = await new Promise<{ ok: true; launcher: string } | { ok: false; error: string }>((resolve) => {
          const child = spawn(editor, ['--folder-uri', uri], { detached: true, stdio: 'ignore', env: process.env });
          child.once('error', (err: any) => resolve({ ok: false, error: err?.message ?? String(err) }));
          child.once('spawn', () => {
            try {
              child.unref();
            } catch {
              // ignore
            }
            resolve({ ok: true, launcher: `${editor} --folder-uri ${uri}` });
          });
        });

        if (!launched.ok) {
          json(res, 500, { ok: false, error: launched.error, uri, manualCommand, note: 'Install the editor and run the command manually.' });
          return;
        }

        json(res, 200, { ok: true, name: droneName, editor, cwd, uri, manualCommand, launcher: launched.launcher });
        return;
      }

      // POST /api/drones/:name/chats/:chat/prompt
      // Chat input. For builtin transcript agents (cursor/codex/claude/opencode):
      // record a clean transcript turn.
      // For custom agents: send input into a tmux session (full CLI view).
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'prompt'
      ) {
        const droneName = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]);
        if (!(await resolveDroneOrRespond(res, droneName))) return;

        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const prompt = String(body?.prompt ?? '').trim();
        if (!prompt) {
          json(res, 400, { ok: false, error: 'missing prompt' });
          return;
        }

        try {
          const chat = normalizeChatName(chatName);
          const r = await enqueuePrompt({
            droneName,
            chatName: chat,
            prompt,
            cwd: typeof body?.cwd === 'string' ? body.cwd : null,
          });
          json(res, 202, { ok: true, accepted: true, name: droneName, chat, promptId: r.id });
          return;
        } catch (e: any) {
          json(res, 500, { ok: false, error: e?.message ?? String(e) });
          return;
        }
      }

      // GET /api/drones/:name/chats/:chat/pending
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'pending'
      ) {
        const droneName = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        try {
          await reconcileChatFromDaemon({ droneName, chatName });
          const list = await readPendingPrompts({ droneName, chatName });
          json(res, 200, { ok: true, name: droneName, chat: chatName, pending: list });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /still starting/i.test(msg) ? 409 : /unknown drone/i.test(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // GET /api/drones/:name/chats/:chat/output?since=<bytes>&maxBytes=<bytes>&tail=<lines>
      // Read the tmux session log for the given chat.
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'output'
      ) {
        const droneName = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]);

        const reg = await loadRegistry();
        const d = reg.drones[droneName];
        if (!d) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneName}` });
          return;
        }

        const normalizedChat = chatName || 'default';
        const sessionName = hubChatSessionName(normalizedChat);

        const viewRaw = String(u.searchParams.get('view') ?? 'log')
          .trim()
          .toLowerCase();
        const view = viewRaw === 'screen' ? 'screen' : 'log';

        const sinceRaw = u.searchParams.get('since');
        const maxBytesRaw = u.searchParams.get('maxBytes');
        const tailRaw = u.searchParams.get('tail');
        const since = sinceRaw != null ? Number(sinceRaw) : undefined;
        const maxBytes = maxBytesRaw != null ? Number(maxBytesRaw) : undefined;
        const tailLines = tailRaw != null ? Number(tailRaw) : 200;

        try {
          await ensureChatEntry({ droneName, chatName: normalizedChat });
          const tmuxCmd = await resolveChatTmuxCommand({ droneName, chatName: normalizedChat });
          await ensureHubChatSessionRunning({ containerName: d.name, chatName: normalizedChat, command: tmuxCmd });

          if (view === 'screen') {
            const nRaw = Number.isFinite(tailLines) ? Math.floor(tailLines) : 200;
            const n = Math.max(20, Math.min(5000, nRaw || 200));
            const script = [
              'set -euo pipefail',
              `session=${JSON.stringify(sessionName)}`,
              `n=${JSON.stringify(String(n))}`,
              // Try to capture the last N lines of pane history; if tmux rejects -S (older tmux),
              // fall back to capturing the visible pane only.
              'tmux capture-pane -p -t "$session" -S "-$n" 2>/dev/null || tmux capture-pane -p -t "$session" 2>/dev/null || true',
            ].join('\n');
            const r = await dvmExec(d.name, 'bash', ['-lc', script]);
            if (r.code !== 0) {
              throw new Error((r.stderr || r.stdout || 'tmux capture-pane failed').trim());
            }
            json(res, 200, {
              ok: true,
              name: droneName,
              chat: normalizedChat,
              sessionName,
              view,
              tailLines: n,
              text: r.stdout || '',
            });
            return;
          }

          const out = await dvmSessionRead({
            container: d.name,
            session: sessionName,
            since: typeof since === 'number' && Number.isFinite(since) ? since : undefined,
            maxBytes: typeof maxBytes === 'number' && Number.isFinite(maxBytes) ? maxBytes : undefined,
            tailLines: typeof since === 'number' && Number.isFinite(since) ? undefined : tailLines,
          });
          json(res, 200, { ok: true, name: droneName, chat: normalizedChat, sessionName, view, ...out });
          return;
        } catch (e: any) {
          json(res, 500, { ok: false, error: e?.message ?? String(e), name: droneName, chat: normalizedChat, sessionName });
          return;
        }
      }

      // GET /api/drones/:name/chats/:chat/models?refresh=1
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'models'
      ) {
        const droneName = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]) || 'default';
        const forceRefresh = parseBoolParam(u.searchParams.get('refresh'), false);
        try {
          await ensureChatEntry({ droneName, chatName });
          const { d, chat } = await getChatEntry({ droneName, chatName });
          const agent = inferChatAgent(chat);
          if (agent.kind !== 'builtin') {
            json(res, 200, {
              ok: true,
              name: droneName,
              chat: chatName,
              agent,
              model: normalizeChatModel((chat as any)?.model),
              models: [],
              source: 'none',
              discoveredAt: nowIso(),
              error: 'model discovery is only available for builtin agents',
            });
            return;
          }
          const discovered = await discoverModelsForBuiltinAgent({
            containerName: d.name,
            droneName,
            chatName,
            agentId: agent.id,
            forceRefresh,
          });
          json(res, 200, {
            ok: true,
            name: droneName,
            chat: chatName,
            agent,
            model: normalizeChatModel((chat as any)?.model),
            models: discovered.models,
            source: discovered.source,
            discoveredAt: discovered.discoveredAt,
            ...(discovered.error ? { error: discovered.error } : {}),
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /unknown drone/i.test(msg) ? 404 : /unknown chat/i.test(msg) ? 404 : /still starting/i.test(msg) ? 409 : 500;
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // GET /api/drones/:name/chats
      if (method === 'GET' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'chats') {
        const droneName = decodeURIComponent(parts[2]);
        const reg = await loadRegistry();
        const d = reg.drones[droneName];
        if (!d) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneName}` });
          return;
        }
        const chats = d.chats ?? {};
        json(res, 200, { ok: true, name: droneName, chats: Object.keys(chats) });
        return;
      }

      // GET /api/drones/:name/chats/:chat
      if (method === 'GET' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'chats') {
        const droneName = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]);
        const reg = await loadRegistry();
        const d = reg.drones[droneName];
        if (!d) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneName}` });
          return;
        }
        const c = d.chats?.[chatName];
        if (!c) {
          json(res, 404, { ok: false, error: `unknown chat: ${chatName}` });
          return;
        }
        const agent = inferChatAgent(c as any);
        json(res, 200, {
          ok: true,
          name: droneName,
          chat: chatName,
          agent,
          // Back-compat: older clients expect these fields.
          chatId: (c as any).chatId ?? null,
          codexThreadId: (c as any).codexThreadId ?? null,
          claudeSessionId: (c as any).claudeSessionId ?? null,
          openCodeSessionId: (c as any).openCodeSessionId ?? null,
          model: (c as any).model ?? null,
          turns: (c as any).turns ?? [],
          // New: tmux session is the continuation mechanism.
          sessionName: hubChatSessionName(chatName || 'default'),
          createdAt: c.createdAt,
        });
        return;
      }

      // POST /api/drones/:name/chats/:chat/config
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'config'
      ) {
        const droneName = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]) || 'default';

        if (!(await resolveDroneOrRespond(res, droneName))) return;

        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const agentRaw = body?.agent;
        const kind = String(agentRaw?.kind ?? agentRaw?.type ?? '').trim().toLowerCase();
        const hasModelField =
          Boolean(body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'model')) ||
          Boolean(body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'chatModel'));
        let model: string | null = null;
        if (hasModelField) {
          try {
            model = parseChatModelForUpdate(
              body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'model')
                ? body.model
                : body?.chatModel
            );
          } catch (e: any) {
            json(res, 400, { ok: false, error: e?.message ?? String(e) });
            return;
          }
        }
        try {
          await ensureChatEntry({ droneName, chatName });
          const builtinId = normalizeBuiltinAgentId(kind === 'builtin' ? agentRaw?.id : kind);
          if (builtinId) {
            const agent: ChatAgentConfig = { kind: 'builtin', id: builtinId };
            await setChatAgentConfig({ droneName, chatName, agent, setModel: hasModelField, model });
            json(res, 200, { ok: true, name: droneName, chat: chatName, agent, ...(hasModelField ? { model } : {}) });
            return;
          }
          if (kind === 'custom') {
            const id = String(agentRaw?.id ?? '').trim();
            const label = String(agentRaw?.label ?? '').trim();
            const command = String(agentRaw?.command ?? '').trim();
            if (!id) throw new Error('missing agent.id');
            if (!label) throw new Error('missing agent.label');
            if (!command) throw new Error('missing agent.command');
            const agent: ChatAgentConfig = { kind: 'custom', id, label, command };
            await setChatAgentConfig({ droneName, chatName, agent, setModel: hasModelField, model });
            json(res, 200, { ok: true, name: droneName, chat: chatName, agent, ...(hasModelField ? { model } : {}) });
            return;
          }
          if (hasModelField) {
            await setChatAgentConfig({ droneName, chatName, setModel: true, model });
            json(res, 200, { ok: true, name: droneName, chat: chatName, model });
            return;
          }
          json(res, 400, {
            ok: false,
            error: `invalid request (expected agent cursor|codex|claude|opencode|custom or model)`,
          });
          return;
        } catch (e: any) {
          json(res, 500, { ok: false, error: e?.message ?? String(e) });
          return;
        }
      }

      // GET /api/drones/:name/chats/:chat/transcript?turn=last|all|N
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'transcript'
      ) {
        const droneName = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]) || 'default';
        try {
          await reconcileChatFromDaemon({ droneName, chatName });
          const reg = await loadRegistry();
          const d = reg.drones[droneName];
          if (!d) {
            json(res, 404, { ok: false, error: `unknown drone: ${droneName}` });
            return;
          }
          const c = d.chats?.[chatName];
          if (!c) {
            json(res, 404, { ok: false, error: `unknown chat: ${chatName}` });
            return;
          }
          const agent = inferChatAgent(c as any);
          if (agent.kind === 'custom') {
            json(res, 410, {
              ok: false,
              error: 'transcript is only available for builtin agents (cursor/codex/claude/opencode). Use /output for custom agents.',
              agent,
            });
            return;
          }

          const turns = (c as any).turns as TranscriptTurn[] | undefined;
          const rawList = Array.isArray(turns) ? turns : [];
          // Sort by prompt time (promptAt/at) so "last" means most recent chronologically,
          // even if reconciliation appends older completions later.
          const list = rawList
            .map((t, idx) => ({ t, idx }))
            .sort((a, b) => {
              const aIso = String((a.t as any)?.promptAt ?? (a.t as any)?.at ?? '');
              const bIso = String((b.t as any)?.promptAt ?? (b.t as any)?.at ?? '');
              const aMs = new Date(aIso).getTime();
              const bMs = new Date(bIso).getTime();
              const aa = Number.isFinite(aMs) ? aMs : 0;
              const bb = Number.isFinite(bMs) ? bMs : 0;
              if (aa !== bb) return aa - bb;
              return a.idx - b.idx;
            })
            .map((x) => x.t);
          const sel = u.searchParams.get('turn') ?? 'last';
          const idxs = parseTurnSelection(sel, list.length);

          const transcripts: any[] = [];
          for (const i of idxs) {
            const t: any = list[i];
            const at = String(t?.at ?? new Date().toISOString());
            const promptAt = typeof t?.promptAt === 'string' && t.promptAt.trim() ? String(t.promptAt).trim() : undefined;
            const completedAt =
              typeof t?.completedAt === 'string' && t.completedAt.trim() ? String(t.completedAt).trim() : undefined;
            const id = typeof t?.id === 'string' && t.id.trim() ? String(t.id).trim() : undefined;
            const prompt = String(t?.prompt ?? '');
            if (typeof t?.ok === 'boolean') {
              const ok = Boolean(t.ok);
              const output = ok ? String(t.output ?? '') : '';
              const error = ok ? undefined : String(t.error ?? 'failed');
              transcripts.push({
                turn: i + 1,
                at,
                ...(promptAt ? { promptAt } : {}),
                ...(completedAt ? { completedAt } : {}),
                ...(id ? { id } : {}),
                prompt,
                session: '',
                logPath: '',
                ok,
                ...(ok ? { output } : { output: '', error }),
              });
              continue;
            }

            // Legacy turns referenced logPath. Best-effort read.
            const logPath = String(t?.logPath ?? '');
            const session = String(t?.session ?? '');
            if (!logPath) {
              transcripts.push({
                turn: i + 1,
                at,
                ...(promptAt ? { promptAt } : {}),
                ...(completedAt ? { completedAt } : {}),
                prompt,
                session,
                logPath,
                ok: false,
                error: 'missing logPath',
                output: '',
              });
              continue;
            }
            const cmd = `cat ${bashQuote(logPath)} 2>/dev/null || (echo "missing log: ${logPath}" 1>&2; exit 1)`;
            const r = await dvmExec(d.name, 'bash', ['-lc', cmd]);
            if (r.code !== 0) {
              transcripts.push({
                turn: i + 1,
                at,
                ...(promptAt ? { promptAt } : {}),
                ...(completedAt ? { completedAt } : {}),
                prompt,
                session,
                logPath,
                ok: false,
                error: (r.stderr || r.stdout || 'failed reading log').trim(),
                output: '',
              });
              continue;
            }
            transcripts.push({
              turn: i + 1,
              at,
              ...(promptAt ? { promptAt } : {}),
              ...(completedAt ? { completedAt } : {}),
              prompt,
              session,
              logPath,
              ok: true,
              output: String(r.stdout ?? '').trimEnd(),
            });
          }

          json(res, 200, { ok: true, name: droneName, chat: chatName, selection: sel, transcripts, agent });
          return;
        } catch (e: any) {
          json(res, 500, { ok: false, error: e?.message ?? String(e) });
          return;
        }
      }

      if (pathname.startsWith('/api/')) {
        hubLog('warn', 'api route not found', {
          method,
          path: pathname,
          query: u.search || '',
        });
      }
      json(res, 404, { ok: false, error: 'not found' });
    } catch (err: any) {
      hubLog('error', 'request handler crashed', {
        method: String(req.method ?? 'GET').toUpperCase(),
        path: String(req.url ?? ''),
        error: err?.message ?? String(err),
      });
      json(res, 500, { ok: false, error: err?.message ?? String(err) });
    }
  });

  server.on('upgrade', async (req, socket, head) => {
    try {
      const originRaw = typeof req.headers.origin === 'string' ? req.headers.origin : '';
      if (originRaw) {
        const origin = normalizeOrigin(originRaw);
        if (!origin || !allowedOrigins.has(origin)) {
          rejectWebSocketUpgrade(socket, 403, 'Forbidden');
          return;
        }
      }

      const u = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = u.pathname;
      const parts = pathname.split('/').filter(Boolean);
      const isTerminalStreamRoute =
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'terminal' &&
        parts[5] === 'stream';
      if (!isTerminalStreamRoute) {
        rejectWebSocketUpgrade(socket, 404, 'Not Found');
        return;
      }

      if (!isHubApiAuthorizedForWebSocket(req, u, apiToken)) {
        rejectWebSocketUpgrade(socket, 401, 'Unauthorized');
        return;
      }

      const droneName = decodeURIComponent(parts[2]);
      const sessionName = decodeURIComponent(parts[4]);
      if (!isSafeTmuxSessionName(sessionName)) {
        rejectWebSocketUpgrade(socket, 400, 'Bad Request');
        return;
      }
      if (!isHubWebTerminalSessionName(sessionName)) {
        rejectWebSocketUpgrade(socket, 404, 'Not Found');
        return;
      }

      const since = parseOptionalNonNegativeInt(u.searchParams.get('since'));
      const maxBytes = clampIntParam(u.searchParams.get('maxBytes'), HUB_WEB_TERMINAL_MAX_BYTES, 1, HUB_WEB_TERMINAL_MAX_BYTES);

      const d = await resolveDroneOrRejectUpgrade(socket, droneName);
      if (!d) return;
      const token = typeof d?.token === 'string' ? String(d.token).trim() : '';
      const hostPort =
        typeof d?.hostPort === 'number' && Number.isFinite(d.hostPort)
          ? d.hostPort
          : await resolveHostPort(String(d?.name ?? droneName), Number(d?.containerPort ?? 7777));
      if (!hostPort || !token) {
        rejectWebSocketUpgrade(socket, 503, 'Service Unavailable');
        return;
      }

      const wsContext: TerminalWebSocketContext = {
        droneName,
        sessionName,
        client: makeClient(hostPort, token),
        since,
        maxBytes,
      };

      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        wss.emit('connection', ws, req, wsContext);
      });
    } catch {
      rejectWebSocketUpgrade(socket, 500, 'Internal Server Error');
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port, host, () => resolve()));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : opts.port;

  return {
    host,
    port: actualPort,
    close: async () => {
      try {
        wss.clients.forEach((c: WebSocket) => {
          try {
            c.close();
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
