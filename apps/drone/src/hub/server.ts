import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';

import { RawData, WebSocket, WebSocketServer } from 'ws';

import { droneRootPath } from '../host/paths';
import { loadRegistry, updateRegistry } from '../host/registry';
import {
  dvmBaseSet,
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
  dvmStart,
  dvmStop,
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
import { jobsPlanFromAgentMessage, suggestDroneNameFromMessage } from './jobs-from-message';
import { tldrFromAgentMessage } from './tldr-from-message';
import { shouldDeferQueuedTranscriptPrompt, stalePendingPromptState } from './pendingPromptEnqueue';
import {
  cleanupQuarantineWorktree,
  deleteHostRefBestEffort,
  gitCurrentBranchOrSha,
  gitIsClean,
  gitIsAncestor,
  gitMergeBase,
  gitMergePreviewNameStatusEntries,
  gitRepoChangesSummary,
  importBundleHeadToHostRef,
  mergeBranchIntoMainWorkingTreeNoCommit,
  gitStashPop,
  gitStashPush,
  gitTopLevel,
  isRepoPatchApplyError,
  quarantineWorktreePath,
} from './repoOps';
import { isHubApiAuthorized, isHubApiAuthorizedForWebSocket, rejectWebSocketUpgrade } from './hub-auth';
import { bashQuote, encodeRemotePath, hexEncodeUtf8, normalizeContainerPath, parseBoolParam, shellQuoteIfNeeded } from './hub-format';
import { readJsonBody, withCors } from './hub-http';
import {
  copyChatAttachmentsToContainer,
  normalizeChatImageAttachments,
  promptWithImageAttachments,
  type ChatImageAttachment,
} from './chat-attachments';
import {
  droneRepoChangesSummary,
  droneRepoDiffForPath,
  droneRepoPullChangesSummary,
  droneRepoPullDiffForPath,
  nameStatusCharToType,
  runGitInDroneOrThrow,
  type RepoPullChangeEntry,
} from './drone-repo';
import {
  closeGithubPullRequestForRepoRoot,
  inspectGithubRepoForRepoRoot,
  isGithubPullRequestError,
  listGithubPullRequestChangesForRepoRoot,
  listGithubPullRequestsForRepoRoot,
  mergeGithubPullRequestForRepoRoot,
  normalizeGithubPullRequestListState,
  normalizeGithubPullRequestMergeMethod,
} from './github-pull-requests';
import {
  archiveRetentionMs,
  clearStoredProviderApiKey,
  hubLog,
  loadHubEnv,
  parseArchiveRetentionId,
  parseArchiveRuntimePolicy,
  parseDroneDeleteMode,
  parseLlmProvider,
  providerDisplayName,
  providerKeySettingsResponse,
  resolveDeleteActionSettingsResponse,
  resolveEffectiveDeleteActionSettings,
  resolveEffectiveLlmProvider,
  resolveEffectiveProviderApiKeySettings,
  resolveLlmSettingsResponse,
  upsertStoredDeleteActionSettings,
  upsertStoredLlmProvider,
  upsertStoredProviderApiKey,
  type ArchiveRetentionId,
  type ArchiveRuntimePolicy,
  type LlmProviderId,
} from './hub-settings';

const HUB_API_LOADED_AT = new Date().toISOString();
const HUB_API_BUILD_ID = crypto.randomBytes(6).toString('hex');

const HUB_SETTINGS_LOG_DEFAULT_TAIL_LINES = 600;
const HUB_SETTINGS_LOG_MAX_TAIL_LINES = 5000;
const HUB_SETTINGS_LOG_DEFAULT_MAX_BYTES = 200_000;
const HUB_SETTINGS_LOG_MAX_BYTES = 1_000_000;

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

function normalizeApiKey(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

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

const DRONE_OP_LOCKS = new Map<string, Promise<void>>();

async function withDroneOpLock<T>(keyRaw: string, fn: () => Promise<T>): Promise<T> {
  const key = String(keyRaw ?? '').trim();
  if (!key) return await fn();
  const prev = DRONE_OP_LOCKS.get(key) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const chained = prev.then(() => gate);
  DRONE_OP_LOCKS.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    try {
      release();
    } finally {
      if (DRONE_OP_LOCKS.get(key) === chained) DRONE_OP_LOCKS.delete(key);
    }
  }
}

async function withLockedDroneContainer<T>(
  opts: { requestedDroneName: string; droneEntry: any },
  fn: (ctx: { registryDroneName: string; containerName: string; droneEntry: any; droneId: string | null }) => Promise<T>,
): Promise<T> {
  const requestedDroneName = String(opts.requestedDroneName ?? '').trim();
  const seedEntry = opts.droneEntry;
  const seedId = normalizeDroneIdentity(seedEntry?.id) || null;
  const lockKey = seedId ? `drone:${seedId}` : `drone-name:${String(seedEntry?.containerName ?? seedEntry?.name ?? requestedDroneName)}`;

  return await withDroneOpLock(lockKey, async () => {
    let registryDroneName = requestedDroneName;
    let containerName = String(seedEntry?.containerName ?? seedEntry?.name ?? requestedDroneName).trim() || requestedDroneName;
    let droneEntry = seedEntry;

    if (seedId) {
      const regLatest: any = await loadRegistry();
      const found = findDroneEntryByIdentity(regLatest, seedId);
      if (found) {
        registryDroneName = String(found.key ?? requestedDroneName).trim() || requestedDroneName;
        droneEntry = found.entry ?? droneEntry;
        const resolvedContainerName = String((found.entry as any)?.containerName ?? (found.entry as any)?.name ?? found.key ?? '').trim();
        if (resolvedContainerName) containerName = resolvedContainerName;
      }
    }

    return await fn({ registryDroneName, containerName, droneEntry, droneId: seedId });
  });
}

type ResolvedDrone = { id: string; drone: any };

function findDroneIdByRef(regAny: any, refRaw: string): { kind: 'real' | 'pending'; id: string } | null {
  const ref = String(refRaw ?? '').trim();
  if (!ref) return null;
  if (regAny?.drones?.[ref]) return { kind: 'real', id: ref };
  if (regAny?.pending?.[ref]) return { kind: 'pending', id: ref };
  for (const [id, d] of Object.entries(regAny?.drones ?? {})) {
    if (String((d as any)?.name ?? '').trim() === ref) return { kind: 'real', id: String(id) };
  }
  for (const [id, d] of Object.entries(regAny?.pending ?? {})) {
    if (String((d as any)?.name ?? '').trim() === ref) return { kind: 'pending', id: String(id) };
  }
  return null;
}

async function resolveDroneFromRegistry(
  droneRef: string,
  onStillStarting: () => void,
  onUnknown: () => void,
): Promise<ResolvedDrone | null> {
  const regAny: any = await loadRegistry();
  const found = findDroneIdByRef(regAny, droneRef);
  if (!found) {
    onUnknown();
    return null;
  }
  if (found.kind === 'pending' && !regAny?.drones?.[found.id]) {
    onStillStarting();
    return null;
  }
  const drone = regAny?.drones?.[found.id] ?? null;
  if (!drone) {
    onUnknown();
    return null;
  }
  return { id: found.id, drone };
}

async function resolveDroneOrRespond(res: http.ServerResponse, droneRef: string): Promise<ResolvedDrone | null> {
  const ref = String(droneRef ?? '').trim();
  return resolveDroneFromRegistry(
    ref,
    () => {
      json(res, 409, { ok: false, error: `drone "${ref}" is still starting` });
    },
    () => {
      json(res, 404, { ok: false, error: `unknown drone: ${ref}` });
    },
  );
}

async function resolveDroneOrRejectUpgrade(socket: any, droneRef: string): Promise<ResolvedDrone | null> {
  return resolveDroneFromRegistry(
    droneRef,
    () => {
      rejectWebSocketUpgrade(socket, 409, 'Conflict');
    },
    () => {
      rejectWebSocketUpgrade(socket, 404, 'Not Found');
    },
  );
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

const NON_REPO_HOME_CWD = '/dvm-data/home';

function defaultDroneHomeCwd(drone: any): string {
  return isRepoAttachedDrone(drone) ? '/work/repo' : NON_REPO_HOME_CWD;
}

function droneRepoPathInContainer(drone: any): string {
  const raw = String(drone?.repo?.dest ?? '/work/repo').trim();
  return normalizeContainerPath(raw || '/work/repo');
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
const FS_EDITOR_MAX_BYTES = 512 * 1024;

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

function isLikelyTextMimeType(rawMimeType: string): boolean {
  const mime = String(rawMimeType ?? '').trim().toLowerCase();
  if (!mime) return true;
  if (mime.startsWith('text/')) return true;
  if (mime === 'application/json') return true;
  if (mime === 'application/xml') return true;
  if (mime === 'application/yaml') return true;
  if (mime === 'application/x-yaml') return true;
  if (mime === 'application/x-sh') return true;
  if (mime === 'application/x-shellscript') return true;
  if (mime === 'application/javascript') return true;
  if (mime === 'application/x-javascript') return true;
  if (mime === 'application/typescript') return true;
  if (mime === 'application/x-typescript') return true;
  if (mime === 'application/sql') return true;
  return false;
}

function bufferLooksBinary(buf: Buffer): boolean {
  if (!buf || buf.length === 0) return false;
  if (buf.includes(0)) return true;
  let suspicious = 0;
  for (const byte of buf.values()) {
    if ((byte >= 0 && byte <= 8) || byte === 11 || byte === 12 || (byte >= 14 && byte <= 31)) {
      suspicious += 1;
    }
  }
  return suspicious / buf.length > 0.08;
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

const GROUP_NAME_MAX_LEN = 64;
function normalizeGroupName(raw: any): string {
  return String(raw ?? '').trim();
}
function validateGroupNameOrThrow(raw: any, label: string = 'group'): string {
  const name = normalizeGroupName(raw);
  if (!name) throw new Error(`invalid ${label} (must be non-empty)`);
  if (name.length > GROUP_NAME_MAX_LEN) throw new Error(`invalid ${label} (max ${GROUP_NAME_MAX_LEN} chars)`);
  if (isUngroupedGroupName(name)) throw new Error(`invalid ${label} ("Ungrouped" is reserved)`);
  return name;
}

const DRONE_DISPLAY_NAME_MAX_LEN = 80;
function normalizeDroneDisplayName(raw: any): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (s.length > DRONE_DISPLAY_NAME_MAX_LEN) throw new Error(`invalid drone name (max ${DRONE_DISPLAY_NAME_MAX_LEN} chars)`);
  if (/[\r\n]/.test(s)) throw new Error('invalid drone name (no newlines)');
  return s;
}
function droneDisplayNameExists(regAny: any, nameRaw: string): boolean {
  const name = String(nameRaw ?? '').trim();
  if (!name) return false;
  for (const d of Object.values(regAny?.drones ?? {}) as any[]) {
    if (String(d?.name ?? '').trim() === name) return true;
  }
  for (const d of Object.values(regAny?.pending ?? {}) as any[]) {
    if (String(d?.name ?? '').trim() === name) return true;
  }
  return false;
}
function allocateUntitledDisplayName(regAny: any): string {
  const usedNums = new Set<number>();
  const consider = (n: any) => {
    const s = String(n?.name ?? '').trim();
    const m = s.match(/^untitled\s+(\d+)$/i);
    if (!m) return;
    const v = Number(m[1]);
    if (Number.isFinite(v) && v >= 1 && Math.floor(v) === v) usedNums.add(v);
  };
  for (const d of Object.values(regAny?.drones ?? {}) as any[]) consider(d);
  for (const d of Object.values(regAny?.pending ?? {}) as any[]) consider(d);
  for (let i = 1; i <= 9999; i += 1) {
    if (!usedNums.has(i)) return `Untitled ${i}`;
  }
  // Fallback (extremely unlikely)
  return `Untitled ${Date.now().toString(36)}`;
}
function ensureGroupRegistered(regAny: any, groupName: string | null | undefined, atIso: string): void {
  const g = normalizeGroupName(groupName);
  if (!g || isUngroupedGroupName(g)) return;
  regAny.groups = regAny.groups ?? {};
  if (!regAny.groups[g]) {
    regAny.groups[g] = { name: g, createdAt: atIso, updatedAt: atIso };
  }
}
function listAllKnownGroups(regAny: any): string[] {
  const out = new Set<string>();
  for (const k of Object.keys(regAny?.groups ?? {})) {
    const g = normalizeGroupName(k);
    if (g && !isUngroupedGroupName(g)) out.add(g);
  }
  for (const d of Object.values(regAny?.drones ?? {}) as any[]) {
    const g = normalizeGroupName(d?.group);
    if (g && !isUngroupedGroupName(g)) out.add(g);
  }
  for (const d of Object.values(regAny?.pending ?? {}) as any[]) {
    const g = normalizeGroupName(d?.group);
    if (g && !isUngroupedGroupName(g)) out.add(g);
  }
  return Array.from(out.values()).sort((a, b) => a.localeCompare(b));
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

function normalizeDroneIdentity(raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return '';
  if (id.length > 128) return '';
  return id;
}

function makeDroneIdentity(): string {
  return crypto.randomUUID();
}

function findDroneEntryByIdentity(regAny: any, droneId: string): { key: string; entry: any } | null {
  const byId = normalizeDroneIdentity(droneId);
  if (!byId) return null;
  for (const [key, entry] of Object.entries(regAny?.drones ?? {})) {
    if (normalizeDroneIdentity((entry as any)?.id) === byId) {
      return { key: String(key), entry };
    }
  }
  return null;
}

async function resolveDroneNameByIdentity(droneId: string): Promise<string | null> {
  const regAny: any = await loadRegistry();
  const found = findDroneEntryByIdentity(regAny, droneId);
  if (!found) return null;
  const entryName = String(found.entry?.name ?? '').trim();
  if (entryName) return entryName;
  const keyName = String(found.key ?? '').trim();
  return keyName || null;
}

async function resolveDroneContainerNameByIdentity(droneId: string): Promise<string | null> {
  const regAny: any = await loadRegistry();
  const found = findDroneEntryByIdentity(regAny, droneId);
  if (!found) return null;
  const cn = String((found.entry as any)?.containerName ?? (found.entry as any)?.name ?? found.key ?? '').trim();
  return cn || null;
}

async function setDroneHubMetaByIdentity(
  opts: {
    droneId: string;
    hub: null | { phase: 'starting' | 'seeding' | 'error'; message?: string; promptId?: string };
  }
) {
  await updateRegistry((regAny: any) => {
    const found = findDroneEntryByIdentity(regAny, opts.droneId);
    if (!found) return;
    const d: any = found.entry;
    if (!opts.hub) {
      delete d.hub;
    } else {
      d.hub = {
        phase: opts.hub.phase,
        message: opts.hub.message,
        updatedAt: nowIso(),
        ...(opts.hub.promptId ? { promptId: opts.hub.promptId } : {}),
      };
    }
    regAny.drones = regAny.drones ?? {};
    regAny.drones[found.key] = d;
  });
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
const PULL_PREVIEW_HOST_MERGE_CACHE_TTL_MS = 25_000;
const pullPreviewHostMergeCache = new Map<string, { atMs: number; entries: RepoPullChangeEntry[] }>();
const GITHUB_PULL_REQUEST_LIST_CACHE_TTL_MS = 12_000;
const githubPullRequestListCache = new Map<
  string,
  {
    atMs: number;
    payload: {
      repoRoot: string;
      state: 'open' | 'closed' | 'all';
      github: { owner: string; repo: string };
      count: number;
      pullRequests: any[];
    };
  }
>();

function clearGithubPullRequestListCache(repoRootRaw: string): void {
  const repoRoot = String(repoRootRaw ?? '').trim();
  if (!repoRoot) return;
  for (const key of githubPullRequestListCache.keys()) {
    if (key.startsWith(`${repoRoot}\u0000`)) githubPullRequestListCache.delete(key);
  }
}

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
  droneIdRaw: string,
  patch: Partial<{
    phase: PendingPhase;
    message: string;
    error: string;
    updatedAt: string;
  }>
) {
  await updateRegistry((regAny: any) => {
    const droneId = normalizeDroneIdentity(droneIdRaw);
    const pending = droneId ? regAny?.pending?.[droneId] : null;
    if (!pending) return;
    regAny.pending = regAny.pending ?? {};
    regAny.pending[droneId] = {
      ...pending,
      ...patch,
      updatedAt: patch.updatedAt ?? nowIso(),
    };
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
  const containerName = String(d?.containerName ?? d?.name ?? '').trim();
  // After hub restarts, a container may still run an older daemon.js.
  // Best-effort upgrade once per container so new prompt behavior is consistent.
  const daemonKey = `${containerName}:${Number(d?.containerPort ?? 0)}`;
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
          containerName,
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
      : await resolveHostPort(containerName, d.containerPort);
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
      await upgradeDroneDaemonInContainer({ containerName, containerPort: d.containerPort });
      await waitForDroneDaemonReady(client, daemonReadyAfterUpgradeTimeoutMs);
      await dronePromptEnqueue(client, { id: String(opts.id ?? ''), kind: opts.kind, cmd: 'bash', args: ['-lc', opts.script] });
      return;
    }
    throw e;
  }
}

async function sendPromptToChat(opts: {
  id?: string;
  droneId: string;
  chatName: string;
  prompt: string;
  attachments?: ChatImageAttachment[];
  cwd?: string | null;
  waitForDaemonMs?: number;
}) {
  const droneId = normalizeDroneIdentity(opts.droneId);
  if (!droneId) throw new Error('missing droneId');

  const regAny: any = await loadRegistry();
  if (regAny?.pending?.[droneId] && !regAny?.drones?.[droneId]) {
    throw new Error(`drone "${droneId}" is still starting`);
  }
  const dSeed = (regAny as any).drones?.[droneId];
  if (!dSeed) throw new Error(`unknown drone: ${droneId}`);

  const lockKey = `drone:${droneId}`;

  return await withDroneOpLock(lockKey, async () => {
    const regLatest: any = await loadRegistry();
    if (regLatest?.pending?.[droneId] && !regLatest?.drones?.[droneId]) {
      throw new Error(`drone "${droneId}" is still starting`);
    }
    const d: any = (regLatest as any).drones?.[droneId] ?? null;
    if (!d) throw new Error(`unknown drone: ${droneId}`);
    const droneLabel = String(d?.name ?? '').trim() || droneId;
    const containerName = String(d?.containerName ?? '').trim() || String(d?.name ?? '').trim() || droneId;

    const normalizedChat = opts.chatName || 'default';
    await ensureChatEntry({ droneId, chatName: normalizedChat });

    const { chat } = await getChatEntry({ droneId, chatName: normalizedChat });
    const agent = inferChatAgent(chat);
    const chatModel = normalizeChatModel((chat as any)?.model);

    const cwdRaw = typeof opts.cwd === 'string' ? opts.cwd : '';
    const defaultCwd = typeof d.cwd === 'string' && d.cwd.trim() ? d.cwd.trim() : '/dvm-data';
    const cwd = cwdRaw ? normalizeContainerPath(cwdRaw) : normalizeContainerPath(defaultCwd);

    const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
    const promptId = String(opts.id ?? '').trim() || crypto.randomBytes(9).toString('hex');
    const attachmentsDir =
      attachments.length > 0 ? normalizeContainerPath(`/dvm-data/drone-hub/attachments/${normalizedChat}/${promptId}`) : '';
    const attachmentsForPrompt =
      attachments.length > 0
        ? attachments.map((a) => ({
            name: a.name,
            mime: a.mime,
            size: a.size,
            path: path.posix.join(attachmentsDir, a.fileName),
          }))
        : [];
    const effectivePrompt = promptWithImageAttachments(opts.prompt, attachmentsForPrompt);
    if (attachments.length > 0) {
      await copyChatAttachmentsToContainer({ containerName, containerDir: attachmentsDir, attachments });
    }

    if (agent.kind === 'builtin' && agent.id === 'cursor') {
      const chatId = await ensureCursorChatId({ droneId, containerName, chatName: normalizedChat });
      const modelArg = chatModel ? ` --model ${bashQuote(chatModel)}` : '';
      const script = [
        'set -euo pipefail',
        `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
        `cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data || cd /`,
        `agent${modelArg} --resume ${bashQuote(chatId)} -f --approve-mcps --print ${bashQuote(effectivePrompt)}`,
      ].join('\n');
      await enqueueTranscriptPrompt({ id: opts.id, drone: d, waitForDaemonMs: opts.waitForDaemonMs, kind: 'cursor', script });
      return { ok: true as const, agent, mode: 'transcript' as const, chat: normalizedChat, turnOk: true as const };
    }

    if (agent.kind === 'builtin' && agent.id === 'codex') {
      const modelArg = chatModel ? ` --model ${bashQuote(chatModel)}` : '';
      const existingThreadId =
        typeof (chat as any).codexThreadId === 'string' ? String((chat as any).codexThreadId).trim() : '';
      if (!existingThreadId) {
        const script = [
          'set -euo pipefail',
          `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
          `cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data || cd /`,
          `codex --ask-for-approval never exec${modelArg} --skip-git-repo-check --sandbox danger-full-access --json --color never ${bashQuote(effectivePrompt)}`,
        ].join('\n');
        await enqueueTranscriptPrompt({ id: opts.id, drone: d, waitForDaemonMs: opts.waitForDaemonMs, kind: 'codex', script });
        return { ok: true as const, agent, mode: 'transcript' as const, chat: normalizedChat, codexThreadId: null, turnOk: true as const };
      }

      const script = [
        'set -euo pipefail',
        `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
        `cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data || cd /`,
        `codex --ask-for-approval never exec${modelArg} --skip-git-repo-check --sandbox danger-full-access --json --color never resume ${bashQuote(existingThreadId)} ${bashQuote(effectivePrompt)}`,
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
      const claudeSessionId = await ensureClaudeSessionId({ droneId, chatName: normalizedChat });
      const supportsModel = chatModel ? await cliSupportsModelFlag({ containerName, bin: 'claude' }) : false;
      const modelArg = chatModel && supportsModel ? ` --model ${bashQuote(chatModel)}` : '';
      const script = [
        'set -euo pipefail',
        `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
        `cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data || cd /`,
        `claude --print --dangerously-skip-permissions --output-format text${modelArg} --session-id ${bashQuote(claudeSessionId)} ${bashQuote(effectivePrompt)}`,
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
      const supportsModel = chatModel ? await cliSupportsModelFlag({ containerName, bin: 'opencode' }) : false;
      const modelArg = chatModel && supportsModel ? ` --model ${bashQuote(chatModel)}` : '';
      const openCodeSessionId =
        typeof (chat as any).openCodeSessionId === 'string' ? String((chat as any).openCodeSessionId).trim() : '';
      const title = openCodeSessionTitle(droneLabel, normalizedChat);
      const resumeArg = openCodeSessionId ? ` --session ${bashQuote(openCodeSessionId)}` : '';
      const script = [
        'set -euo pipefail',
        `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
        `cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data || cd /`,
        `opencode run --format default --title ${bashQuote(title)}${modelArg}${resumeArg} ${bashQuote(effectivePrompt)}`,
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
    const tmuxCmd = await resolveChatTmuxCommand({ droneId, chatName: normalizedChat });
    const { sessionName } = await ensureHubChatSessionRunning({
      containerName,
      chatName: normalizedChat,
      command: tmuxCmd,
      cwd,
    });
    await dvmSessionType(containerName, sessionName, { text: effectivePrompt });
    await sleepMs(60);
    await dvmSessionType(containerName, sessionName, { keys: ['C-m'] });
    return { ok: true as const, agent, mode: 'cli' as const, chat: normalizedChat, sessionName, turnOk: true as const };
  });
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
    const pending = regAny?.pending && typeof regAny.pending === 'object' ? Object.entries(regAny.pending) : [];
    for (const [idRaw, p] of pending as any[]) {
      const id = normalizeDroneIdentity(idRaw);
      if (!id) continue;
      const phase = String(p?.phase ?? 'starting').trim();
      if (phase === 'error') continue;
      enqueueProvisioning(id);
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
      const droneId = normalizeDroneIdentity(next.droneName);
      const chatName = String(next.chatName ?? '').trim() || 'default';
      if (!droneId) continue;
      const key = `${droneId}:${chatName}`;
      RECONCILE_QUEUED.delete(key);
      if (RECONCILE_TASKS.has(key)) continue;
      RECONCILE_ACTIVE += 1;
      const p = reconcileChatFromDaemon({ droneId, chatName })
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

function enqueueReconcile(droneIdRaw: string, chatName: string) {
  const dn = normalizeDroneIdentity(droneIdRaw);
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

function looksLikeContainerNotRunningError(msg: string): boolean {
  const s = String(msg ?? '').toLowerCase();
  return (
    s.includes('is not running') ||
    s.includes('already stopped') ||
    s.includes('cannot stop') && s.includes('not running')
  );
}

function looksLikeContainerAlreadyRunningError(msg: string): boolean {
  const s = String(msg ?? '').toLowerCase();
  return s.includes('already running') || (s.includes('cannot start') && s.includes('running'));
}

function looksLikeRepoUnavailableError(msg: string): boolean {
  const s = String(msg ?? '').toLowerCase();
  return (
    s.includes('not a git repository') ||
    s.includes('cannot change to') ||
    s.includes('unable to read current working directory')
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

function isSafePromptId(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (s.length > 96) return false;
  // IMPORTANT: prompt ids are used as filenames in the drone daemon (jobs/<id>.json).
  // Keep this extremely strict to avoid traversal/injection.
  return /^[A-Za-z0-9._-]+$/.test(s);
}

function promptJobTmuxSessionName(promptIdRaw: string): string {
  // Keep this aligned with daemon.ts `promptSessionName`.
  const cleaned = String(promptIdRaw ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 48);
  return `drone-prompt-${cleaned || 'job'}`;
}

async function readPendingPrompts(opts: { droneId: string; chatName: string }): Promise<PendingPrompt[]> {
  const regAny: any = await loadRegistry();
  const droneId = normalizeDroneIdentity(opts.droneId);
  const d = droneId ? regAny?.drones?.[droneId] : null;
  if (!d) {
    if (droneId && regAny?.pending?.[droneId] && !regAny?.drones?.[droneId]) throw new Error(`drone "${droneId}" is still starting`);
    throw new Error(`unknown drone: ${opts.droneId}`);
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

async function pushPendingPrompt(opts: { droneId: string; chatName: string; pending: PendingPrompt }): Promise<void> {
  await updateRegistry((regAny: any) => {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const d = droneId ? regAny?.drones?.[droneId] : null;
    if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
    d.chats = d.chats ?? {};
    const chatName = opts.chatName || 'default';
    const entry = d.chats[chatName] ?? { createdAt: nowIso() };
    entry.pendingPrompts = Array.isArray(entry.pendingPrompts) ? entry.pendingPrompts : [];
    const id = String(opts.pending?.id ?? '').trim();
    if (!id) return;
    const existingIdx = entry.pendingPrompts.findIndex((p: any) => String(p?.id ?? '').trim() === id);
    if (existingIdx === -1) {
      entry.pendingPrompts.push(opts.pending);
    } else {
      // Idempotency: refresh the existing row without duplicating.
      const cur = entry.pendingPrompts[existingIdx] ?? {};
      entry.pendingPrompts[existingIdx] = { ...cur, ...opts.pending, updatedAt: opts.pending.updatedAt ?? nowIso() };
    }
    // Keep bounded.
    entry.pendingPrompts = entry.pendingPrompts.slice(-60);
    d.chats[chatName] = entry;
    regAny.drones = regAny.drones ?? {};
    regAny.drones[droneId] = d;
  });
}

async function updatePendingPrompt(opts: {
  droneId: string;
  chatName: string;
  id: string;
  patch: Partial<Pick<PendingPrompt, 'state' | 'error' | 'updatedAt'>>;
}): Promise<void> {
  await updateRegistry((regAny: any) => {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const droneKey = droneId;
    const d = droneId ? regAny?.drones?.[droneId] : null;
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
    regAny.drones[droneKey] = d;
  });
}

// Hub-side pump for `pendingPrompts` entries that are persisted but not yet enqueued
// into the drone daemon (state: 'queued'). This is used to preserve session continuity
// for agents where the continuation/session id is only known after the first turn.
const PENDING_PROMPT_PUMP_TASKS = new Map<string, Promise<void>>();
const PENDING_PROMPT_PUMP_QUEUE: Array<{ droneId: string; chatName: string }> = [];
const PENDING_PROMPT_PUMP_QUEUED = new Set<string>();
let PENDING_PROMPT_PUMP_ACTIVE = 0;
let PENDING_PROMPT_PUMP_PUMPING = false;

function pendingPromptPumpConcurrencyLimit(): number {
  const raw = String(process.env.DRONE_HUB_PENDING_PROMPT_PUMP_CONCURRENCY ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 1) return Math.max(1, Math.min(16, Math.floor(n)));
  return 6;
}

async function pumpQueuedPendingPromptsForChat(opts: { droneId: string; chatName: string }): Promise<void> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = String(opts.chatName ?? '').trim() || 'default';
  if (!droneId) return;

  // Avoid unbounded loops if state keeps changing due to concurrent requests.
  for (let attempts = 0; attempts < 50; attempts++) {
    const { d, chat } = await getChatEntry({ droneId, chatName });
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
      await updatePendingPrompt({ droneId, chatName, id, patch: { state: 'failed', error: 'invalid queued prompt' } }).catch(() => {});
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
    await updatePendingPrompt({ droneId, chatName, id, patch: { state: 'sending', error: undefined } });

    try {
      const enqueueTimeoutMs = defaultPromptEnqueueTimeoutMs();
      const r: any = await withTimeout(
        sendPromptToChat({ id, droneId, chatName, prompt, cwd, waitForDaemonMs: undefined }),
        enqueueTimeoutMs,
        `queued prompt enqueue failed for ${droneId}/${chatName}`,
      );
      if (r?.turnOk === false) {
        await updatePendingPrompt({
          droneId,
          chatName,
          id,
          patch: { state: 'failed', error: String(r?.error ?? 'failed') },
        });
      } else {
        await updatePendingPrompt({ droneId, chatName, id, patch: { state: 'sent' } });
        // Best-effort: reconcile soon after enqueue to keep UI fresh.
        enqueueReconcile(droneId, chatName);
      }
    } catch (e: any) {
      await updatePendingPrompt({
        droneId,
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
      const droneId = normalizeDroneIdentity(next.droneId);
      const chatName = String(next.chatName ?? '').trim() || 'default';
      if (!droneId) continue;
      const key = `${droneId}:${chatName}`;
      PENDING_PROMPT_PUMP_QUEUED.delete(key);
      if (PENDING_PROMPT_PUMP_TASKS.has(key)) continue;
      PENDING_PROMPT_PUMP_ACTIVE += 1;
      const p = pumpQueuedPendingPromptsForChat({ droneId, chatName })
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

function enqueuePendingPromptPump(droneIdRaw: string, chatName: string) {
  const dn = normalizeDroneIdentity(droneIdRaw);
  const cn = String(chatName ?? '').trim() || 'default';
  if (!dn) return;
  const key = `${dn}:${cn}`;
  if (PENDING_PROMPT_PUMP_TASKS.has(key)) return;
  if (PENDING_PROMPT_PUMP_QUEUED.has(key)) return;
  PENDING_PROMPT_PUMP_QUEUED.add(key);
  PENDING_PROMPT_PUMP_QUEUE.push({ droneId: dn, chatName: cn });
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

async function reconcileChatFromDaemon(opts: { droneId: string; chatName: string }): Promise<void> {
  const regAny: any = await loadRegistry();
  const droneId = normalizeDroneIdentity(opts.droneId);
  const d = droneId ? regAny?.drones?.[droneId] : null;
  if (!d) return;
  const token = typeof d.token === 'string' ? d.token : '';
  const containerName = String(d?.containerName ?? d?.name ?? droneId).trim() || droneId;
  const hostPort =
    typeof d.hostPort === 'number' && Number.isFinite(d.hostPort)
      ? d.hostPort
      : await resolveHostPort(containerName, d.containerPort);
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
      // If daemon job lookups keep failing for too long, fail stale pending rows so
      // they do not block queued follow-up prompts indefinitely.
      const staleState = stalePendingPromptState({
        state,
        updatedAt: typeof p?.updatedAt === 'string' ? p.updatedAt : null,
        at: typeof p?.at === 'string' ? p.at : null,
        enqueueTimeoutMs: defaultPromptEnqueueTimeoutMs(),
      });
      if (staleState === 'sending' || staleState === 'sent') {
        pendingList[i] = {
          ...p,
          state: 'failed',
          error:
            staleState === 'sending'
              ? 'prompt enqueue timed out (hub restart or daemon unavailable)'
              : 'prompt status unavailable for too long (daemon unavailable or restarted)',
          updatedAt: nowIso(),
        };
        changed = true;
      }
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
            droneId,
            droneLabel: String(d?.name ?? '').trim() || droneId,
            containerName: String(d?.containerName ?? d?.name ?? droneId).trim() || droneId,
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
    regAny.drones[droneId] = d;
    await updateRegistry((regLatest: any) => {
      const dLatest = regLatest?.drones?.[droneId];
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
      regLatest.drones[droneId] = dLatest;
    });

    // Best-effort: session ids may have been established (codexThreadId/openCodeSessionId)
    // or a prior prompt may have completed/failed, unblocking queued follow-ups.
    enqueuePendingPromptPump(droneId, opts.chatName);
  }
}

async function enqueuePrompt(opts: {
  id?: string;
  droneId: string;
  chatName: string;
  prompt: string;
  attachments?: ChatImageAttachment[];
  cwd?: string | null;
  waitForDaemonMs?: number;
}): Promise<{ id: string }> {
  const preferredIdRaw = typeof opts.id === 'string' ? opts.id.trim() : '';
  if (preferredIdRaw && !isSafePromptId(preferredIdRaw)) {
    throw new Error('invalid promptId');
  }
  const id = preferredIdRaw || crypto.randomBytes(9).toString('hex');
  const at = nowIso();
  const chatName = normalizeChatName(opts.chatName);
  const droneId = normalizeDroneIdentity(opts.droneId);
  if (!droneId) throw new Error('missing droneId');

  // Make sure chat exists before we write pending state.
  await ensureChatEntry({ droneId, chatName });
  const { d, chat } = await getChatEntry({ droneId, chatName });
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
    droneId,
    chatName,
    pending: { id, at, prompt: opts.prompt, cwd: opts.cwd ?? null, state: defer ? 'queued' : 'sending', updatedAt: at },
  });

  if (defer) {
    // Persisted as queued; a reconcile/update that establishes session id will pump it.
    enqueuePendingPromptPump(droneId, chatName);
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
        droneId,
        chatName,
        prompt: opts.prompt,
        attachments: Array.isArray(opts.attachments) ? opts.attachments : [],
        cwd: opts.cwd ?? null,
        waitForDaemonMs: opts.waitForDaemonMs,
      }),
      enqueueTimeoutMs,
      `prompt enqueue failed for ${droneId}/${chatName}`,
    );
    if (r?.turnOk === false) {
      await updatePendingPrompt({
        droneId,
        chatName,
        id,
        patch: { state: 'failed', error: String(r?.error ?? 'failed') },
      });
    } else {
      await updatePendingPrompt({ droneId, chatName, id, patch: { state: 'sent' } });
    }
  } catch (e: any) {
    await updatePendingPrompt({
      droneId,
      chatName,
      id,
      patch: { state: 'failed', error: e?.message ?? String(e) },
    });
  }

  // Best-effort: if there are any deferred follow-ups, try to enqueue now.
  enqueuePendingPromptPump(droneId, chatName);
  return { id };
}

type UnifiedPromptCreateOpts = {
  group?: string | null;
  repoPath?: string | null;
  build?: boolean;
  containerPort?: number | null;
};

async function createOrEnqueuePromptUnified(opts: {
  id?: string;
  droneId: string;
  chatName: string;
  prompt: string;
  attachments?: ChatImageAttachment[];
  cwd?: string | null;
}): Promise<
  | { kind: 'enqueued'; id: string }
  | { kind: 'error'; status: number; error: string }
> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(String(opts.chatName ?? '').trim() || 'default');
  const prompt = String(opts.prompt ?? '').trim();
  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  const preferredIdRaw = typeof opts.id === 'string' ? opts.id.trim() : '';
  if (preferredIdRaw && !isSafePromptId(preferredIdRaw)) {
    return { kind: 'error', status: 400, error: 'invalid promptId' };
  }
  const fallbackId = preferredIdRaw || crypto.randomBytes(9).toString('hex');

  if (!droneId) return { kind: 'error', status: 400, error: 'missing drone id' };
  if (!prompt) return { kind: 'error', status: 400, error: 'missing prompt' };

  const regSnap: any = await loadRegistry();
  if (regSnap?.drones?.[droneId]) {
    const r = await enqueuePrompt({
      id: fallbackId,
      droneId,
      chatName,
      prompt,
      attachments,
      cwd: opts.cwd ?? null,
    });
    return { kind: 'enqueued', id: r.id };
  }

  // In v2, all addressing is by stable id; callers should create drones explicitly via POST /api/drones.
  if (regSnap?.pending?.[droneId] && !regSnap?.drones?.[droneId]) {
    return { kind: 'error', status: 409, error: `drone "${droneId}" is still starting` };
  }
  return { kind: 'error', status: 404, error: `unknown drone: ${droneId}` };
}

async function provisionDroneFromPending(name: string) {
  const regAny: any = await loadRegistry();
  const pending = regAny?.pending?.[name];
  if (!pending) return;
  const pendingDroneId = normalizeDroneIdentity(pending?.id);
  if (!pendingDroneId) {
    await updatePendingDrone(name, { phase: 'error', message: 'Failed to start', error: 'missing pending drone identity' });
    return;
  }
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
  const displayName = String(pending?.name ?? '').trim() || name;
  const args: string[] = [droneCli, 'create', displayName, '--repo', repoArg, '--drone-id', pendingDroneId];
  if (group) args.push('--group', group);
  if (!build) args.push('--no-build');
  if (containerPort != null) args.push('--container-port', String(containerPort));
  if (!repoPath) args.push('--cwd', NON_REPO_HOME_CWD, '--mkdir');

  const r = await runNodeCli(args);
  if (r.code !== 0) {
    const errText = (r.stderr || r.stdout || `drone create failed (exit ${r.code})`).trim();
    // If the container already exists (often due to a prior partial run),
    // try to import it into the registry and continue.
    if (/already exists/i.test(errText)) {
      await updatePendingDrone(name, { phase: 'creating', message: 'Container exists; importing…' });
      const impArgs: string[] = [droneCli, 'import', displayName, '--repo', repoArg, '--drone-id', pendingDroneId];
      if (group) impArgs.push('--group', group);
      if (containerPort != null) impArgs.push('--container-port', String(containerPort));
      if (!repoPath) impArgs.push('--cwd', NON_REPO_HOME_CWD, '--mkdir');
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
    await setDroneHubMetaByIdentity({
      droneId: pendingDroneId,
      hub: { phase: 'seeding', message: 'Seeding repo…' },
    });
    try {
      const repoRoot = await gitTopLevel(repoPath);
      const baseRef = await gitCurrentBranchOrSha(repoRoot);
      const repoSeedContainer = await resolveDroneContainerNameByIdentity(pendingDroneId);
      if (!repoSeedContainer) throw new Error('drone disappeared during repo seed');

      await dvmRepoSeed({
        container: repoSeedContainer,
        hostPath: repoRoot,
        dest: '/work/repo',
        baseRef: 'HEAD',
        branch: 'dvm/work',
        clean: true,
        timeoutMs: defaultRepoSeedTimeoutMs(),
      });

      // Persist canonical repo root + baseRef for future pulls.
      await updateRegistry((reg2: any) => {
        const found = findDroneEntryByIdentity(reg2, pendingDroneId);
        if (!found) return;
        const d = found.entry;
        d.repoPath = repoRoot;
        // Default repo-attached drones to operate inside the container repo.
        d.cwd = '/work/repo';
        d.repo = d.repo ?? {};
        d.repo.dest = '/work/repo';
        d.repo.branch = 'dvm/work';
        d.repo.baseRef = baseRef;
        d.repo.seededAt = nowIso();
        reg2.drones = reg2.drones ?? {};
        reg2.drones[found.key] = d;
      });

      await setDroneHubMetaByIdentity({ droneId: pendingDroneId, hub: null });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      await setDroneHubMetaByIdentity({
        droneId: pendingDroneId,
        hub: { phase: 'error', message: `Repo seed failed: ${msg}` },
      });
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
        const dstFound = findDroneEntryByIdentity(reg3Any, pendingDroneId);
        if (!dstFound) return;
        const dst = dstFound.entry;
        const srcChats = src?.chats && typeof src.chats === 'object' ? src.chats : null;
        if (!src || !srcChats) return;
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
        reg3Any.drones[dstFound.key] = dst;
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
  const seedPromptIdRaw = typeof (seed as any).promptId === 'string' ? String((seed as any).promptId).trim() : '';
  const seedPromptId =
    prompt && seedPromptIdRaw && isSafePromptId(seedPromptIdRaw)
      ? seedPromptIdRaw
      : prompt
        ? crypto.randomBytes(9).toString('hex')
        : undefined;

  if (!seedAgent && !seedModel && !prompt) return;

  // Mark hub state on the real drone entry so the UI can show progress during seeding.
  await setDroneHubMetaByIdentity({
    droneId: pendingDroneId,
    hub: {
      phase: 'seeding',
      message: prompt ? 'Seeding initial message…' : 'Configuring agent…',
      ...(seedPromptId ? { promptId: seedPromptId } : {}),
    },
  });
  try {
    if (seedAgent || seedModel) {
      await ensureChatEntry({ droneId: pendingDroneId, chatName });
      await setChatAgentConfig({
        droneId: pendingDroneId,
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
      await enqueuePrompt({ id: seedPromptId, droneId: pendingDroneId, chatName, prompt, cwd, waitForDaemonMs: seedPromptWaitMs });
      // Once the prompt is enqueued, switch from "seeding" to the normal busy/pending-prompt UI.
      await setDroneHubMetaByIdentity({ droneId: pendingDroneId, hub: null });
      return;
    }
    await setDroneHubMetaByIdentity({ droneId: pendingDroneId, hub: null });
  } catch (e: any) {
    await setDroneHubMetaByIdentity({
      droneId: pendingDroneId,
      hub: { phase: 'error', message: e?.message ?? String(e) },
    });
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

async function removeDroneContainerAndCleanup(opts: {
  droneId: string;
  containerName: string;
  repoPathRaw: string;
  keepVolume: boolean;
}): Promise<{ containerGone: boolean; removeErr: string | null }> {
  let removeErr: string | null = null;
  let containerGone = false;

  // Deleting a drone can be racy: `dvm rm` may stop a container and then fail to remove it,
  // requiring a follow-up remove. The UI currently needs a second click in that case.
  // We retry here to make DELETE idempotent and "one click".
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await dvmRemove(opts.containerName, { keepVolume: opts.keepVolume });
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
      const exists = await dvmContainerExists(opts.containerName);
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

  if (containerGone && opts.repoPathRaw) {
    try {
      const repoRoot = await gitTopLevel(opts.repoPathRaw);
      const quarantineBranch = `quarantine/${opts.droneId}`;
      const wt = quarantineWorktreePath(repoRoot, opts.droneId);
      await cleanupQuarantineWorktree({ repoRoot, worktreePath: wt, branch: quarantineBranch });
    } catch {
      // Ignore quarantine cleanup failures during delete.
    }
  }

  return { containerGone, removeErr };
}

async function removeDroneById(opts: { id: string; keepVolume: boolean; forget: boolean }) {
  const droneId = normalizeDroneIdentity(opts.id);
  if (!droneId) return { hadEntry: false, removedRegistry: false, removeErr: `invalid drone id: ${String(opts.id ?? '')}` };

  const regSnapshot: any = await loadRegistry();
  const droneEntry = regSnapshot?.drones?.[droneId] ?? null;
  const hadEntry = Boolean(droneEntry);
  const repoPathRaw = String(droneEntry?.repoPath ?? '').trim();
  const containerName = String(droneEntry?.containerName ?? droneEntry?.name ?? `drone-${droneId}`).trim() || `drone-${droneId}`;

  const { containerGone, removeErr } = await removeDroneContainerAndCleanup({
    droneId,
    containerName,
    repoPathRaw,
    keepVolume: opts.keepVolume,
  });

  let removedRegistry = false;
  // Only forget registry metadata once the container is actually gone.
  // Otherwise we can strand a drone in an "offline but still present" state that is harder to delete by group.
  if (hadEntry && opts.forget && containerGone) {
    removedRegistry = await updateRegistry((reg: any) => {
      if (reg?.drones?.[droneId]) {
        delete reg.drones[droneId];
        return true;
      }
      return false;
    });
  }

  return { hadEntry, removedRegistry, removeErr };
}

const DEFAULT_ARCHIVE_RETENTION: ArchiveRetentionId = '1d';
const DEFAULT_ARCHIVE_RUNTIME_POLICY: ArchiveRuntimePolicy = 'keep-running';

function normalizeArchiveRetention(raw: unknown): ArchiveRetentionId {
  return parseArchiveRetentionId(raw) ?? DEFAULT_ARCHIVE_RETENTION;
}

function normalizeArchiveRuntimePolicy(raw: unknown): ArchiveRuntimePolicy {
  return parseArchiveRuntimePolicy(raw) ?? DEFAULT_ARCHIVE_RUNTIME_POLICY;
}

function parseIsoToMs(raw: unknown): number | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function resolveArchiveDeleteAtIso(archivedEntry: any): string {
  const explicit = String(archivedEntry?.deleteAt ?? '').trim();
  if (explicit && Number.isFinite(Date.parse(explicit))) return explicit;
  const archivedAtMs = parseIsoToMs(archivedEntry?.archivedAt) ?? Date.now();
  const retention = normalizeArchiveRetention(archivedEntry?.archiveRetention);
  return new Date(archivedAtMs + archiveRetentionMs(retention)).toISOString();
}

function allocateRestoredDroneName(regAny: any, preferredRaw: unknown): string {
  const preferred = String(preferredRaw ?? '').trim();
  const fallback = preferred || allocateUntitledDisplayName(regAny);
  if (!droneDisplayNameExists(regAny, fallback)) return fallback;

  const maxBaseLen = Math.max(8, DRONE_DISPLAY_NAME_MAX_LEN - 8);
  const base = fallback.length > maxBaseLen ? fallback.slice(0, maxBaseLen).trim() : fallback;
  for (let i = 2; i <= 999; i += 1) {
    const candidate = `${base} (${i})`;
    if (candidate.length > DRONE_DISPLAY_NAME_MAX_LEN) continue;
    if (!droneDisplayNameExists(regAny, candidate)) return candidate;
  }
  return allocateUntitledDisplayName(regAny);
}

async function archiveDroneById(opts: {
  id: string;
  archiveRetention: ArchiveRetentionId;
  archiveRuntimePolicy: ArchiveRuntimePolicy;
}): Promise<{
  hadEntry: boolean;
  archived: boolean;
  id: string;
  name: string;
  archiveRetention: ArchiveRetentionId;
  archiveRuntimePolicy: ArchiveRuntimePolicy;
  archivedAt: string | null;
  deleteAt: string | null;
}> {
  const droneId = normalizeDroneIdentity(opts.id);
  if (!droneId) {
    return {
      hadEntry: false,
      archived: false,
      id: String(opts.id ?? ''),
      name: String(opts.id ?? ''),
      archiveRetention: normalizeArchiveRetention(opts.archiveRetention),
      archiveRuntimePolicy: normalizeArchiveRuntimePolicy(opts.archiveRuntimePolicy),
      archivedAt: null,
      deleteAt: null,
    };
  }
  const retention = normalizeArchiveRetention(opts.archiveRetention);
  const runtimePolicy = normalizeArchiveRuntimePolicy(opts.archiveRuntimePolicy);
  return await updateRegistry((regAny: any) => {
    const droneEntry = regAny?.drones?.[droneId];
    if (!droneEntry) {
      return {
        hadEntry: false,
        archived: false,
        id: droneId,
        name: droneId,
        archiveRetention: retention,
        archiveRuntimePolicy: runtimePolicy,
        archivedAt: null,
        deleteAt: null,
      };
    }

    const now = nowIso();
    const deleteAt = new Date(Date.now() + archiveRetentionMs(retention)).toISOString();
    const name = String(droneEntry?.name ?? '').trim() || droneId;
    const containerName = String(droneEntry?.containerName ?? droneEntry?.name ?? `drone-${droneId}`).trim() || `drone-${droneId}`;
    const archivedEntry = {
      ...droneEntry,
      id: droneId,
      name,
      containerName,
      archivedAt: now,
      deleteAt,
      archiveRetention: retention,
      archiveRuntimePolicy: runtimePolicy,
    };

    regAny.archived = regAny.archived ?? {};
    regAny.archived[droneId] = archivedEntry;
    if (regAny?.drones?.[droneId]) delete regAny.drones[droneId];
    if (regAny?.pending?.[droneId]) delete regAny.pending[droneId];

    return {
      hadEntry: true,
      archived: true,
      id: droneId,
      name,
      archiveRetention: retention,
      archiveRuntimePolicy: runtimePolicy,
      archivedAt: now,
      deleteAt,
    };
  });
}

async function restoreArchivedDroneById(opts: { id: string }): Promise<{
  hadEntry: boolean;
  restored: boolean;
  id: string;
  name: string;
  renamed: boolean;
  error: string | null;
}> {
  const droneId = normalizeDroneIdentity(opts.id);
  if (!droneId) {
    return {
      hadEntry: false,
      restored: false,
      id: String(opts.id ?? ''),
      name: String(opts.id ?? ''),
      renamed: false,
      error: `invalid drone id: ${String(opts.id ?? '')}`,
    };
  }

  const regSnapshot: any = await loadRegistry();
  const archivedEntry = regSnapshot?.archived?.[droneId] ?? null;
  if (!archivedEntry) {
    return {
      hadEntry: false,
      restored: false,
      id: droneId,
      name: droneId,
      renamed: false,
      error: `unknown archived drone: ${droneId}`,
    };
  }

  const containerName = String(archivedEntry?.containerName ?? archivedEntry?.name ?? `drone-${droneId}`).trim() || `drone-${droneId}`;
  const archiveRuntimePolicy = normalizeArchiveRuntimePolicy(archivedEntry?.archiveRuntimePolicy);
  const containerExists = await dvmContainerExists(containerName);
  if (!containerExists) {
    return {
      hadEntry: true,
      restored: false,
      id: droneId,
      name: String(archivedEntry?.name ?? '').trim() || droneId,
      renamed: false,
      error: `container "${containerName}" no longer exists`,
    };
  }

  if (archiveRuntimePolicy === 'stop') {
    try {
      await dvmStart(containerName);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (!looksLikeContainerAlreadyRunningError(msg)) {
        return {
          hadEntry: true,
          restored: false,
          id: droneId,
          name: String(archivedEntry?.name ?? '').trim() || droneId,
          renamed: false,
          error: `failed to start archived drone container "${containerName}": ${msg}`,
        };
      }
    }
  }

  return await updateRegistry((regAny: any) => {
    const latest = regAny?.archived?.[droneId];
    if (!latest) {
      return {
        hadEntry: false,
        restored: false,
        id: droneId,
        name: droneId,
        renamed: false,
        error: `unknown archived drone: ${droneId}`,
      };
    }

    const previousName = String(latest?.name ?? '').trim() || droneId;
    const restoredName = allocateRestoredDroneName(regAny, previousName);
    const restoredEntry: any = {
      ...latest,
      id: droneId,
      name: restoredName,
      containerName,
    };
    delete restoredEntry.archivedAt;
    delete restoredEntry.deleteAt;
    delete restoredEntry.archiveRetention;
    delete restoredEntry.archiveRuntimePolicy;

    regAny.drones = regAny.drones ?? {};
    regAny.drones[droneId] = restoredEntry;
    if (regAny?.archived?.[droneId]) delete regAny.archived[droneId];
    if (regAny?.pending?.[droneId]) delete regAny.pending[droneId];
    if (Object.keys(regAny?.archived ?? {}).length === 0) delete regAny.archived;

    return {
      hadEntry: true,
      restored: true,
      id: droneId,
      name: restoredName,
      renamed: restoredName !== previousName,
      error: null,
    };
  });
}

async function removeArchivedDroneById(opts: { id: string; keepVolume: boolean }): Promise<{
  hadEntry: boolean;
  removedArchive: boolean;
  id: string;
  name: string;
  removeErr: string | null;
}> {
  const droneId = normalizeDroneIdentity(opts.id);
  if (!droneId) {
    return {
      hadEntry: false,
      removedArchive: false,
      id: String(opts.id ?? ''),
      name: String(opts.id ?? ''),
      removeErr: `invalid drone id: ${String(opts.id ?? '')}`,
    };
  }

  const regSnapshot: any = await loadRegistry();
  const archivedEntry = regSnapshot?.archived?.[droneId] ?? null;
  const hadEntry = Boolean(archivedEntry);
  const name = String(archivedEntry?.name ?? '').trim() || droneId;
  if (!archivedEntry) {
    return {
      hadEntry: false,
      removedArchive: false,
      id: droneId,
      name,
      removeErr: `unknown archived drone: ${droneId}`,
    };
  }

  const repoPathRaw = String(archivedEntry?.repoPath ?? '').trim();
  const containerName = String(archivedEntry?.containerName ?? archivedEntry?.name ?? `drone-${droneId}`).trim() || `drone-${droneId}`;
  const { containerGone, removeErr } = await removeDroneContainerAndCleanup({
    droneId,
    containerName,
    repoPathRaw,
    keepVolume: opts.keepVolume,
  });

  let removedArchive = false;
  if (containerGone) {
    removedArchive = await updateRegistry((regAny: any) => {
      if (!regAny?.archived?.[droneId]) return false;
      delete regAny.archived[droneId];
      if (Object.keys(regAny.archived).length === 0) delete regAny.archived;
      return true;
    });
  }

  return { hadEntry, removedArchive, id: droneId, name, removeErr };
}

let ARCHIVE_CLEANUP_TASK: Promise<void> | null = null;
const ARCHIVE_CLEANUP_INTERVAL_MS = 5 * 60_000;
const ARCHIVE_CLEANUP_MAX_DELETES_PER_RUN = 25;
let ARCHIVE_CLEANUP_INTERVAL: ReturnType<typeof setInterval> | null = null;

function triggerArchiveCleanup(reason: string) {
  void cleanupExpiredArchivedDrones({ reason }).catch((e: any) => {
    hubLog('warn', 'archive cleanup failed', {
      reason,
      error: e?.message ?? String(e),
    });
  });
}

async function cleanupExpiredArchivedDrones(opts?: { maxDeletes?: number; reason?: string }): Promise<void> {
  if (ARCHIVE_CLEANUP_TASK) {
    await ARCHIVE_CLEANUP_TASK;
    return;
  }
  const maxDeletes =
    typeof opts?.maxDeletes === 'number' && Number.isFinite(opts.maxDeletes)
      ? Math.max(1, Math.floor(opts.maxDeletes))
      : ARCHIVE_CLEANUP_MAX_DELETES_PER_RUN;

  ARCHIVE_CLEANUP_TASK = (async () => {
    const regAny: any = await loadRegistry();
    const nowMs = Date.now();
    const expiredIds = (Object.entries(regAny?.archived ?? {}) as Array<[string, any]>)
      .map(([id, entry]) => {
        const parsedId = normalizeDroneIdentity(id);
        if (!parsedId) return null;
        const deleteAtIso = resolveArchiveDeleteAtIso(entry);
        const deleteAtMs = parseIsoToMs(deleteAtIso);
        if (deleteAtMs == null || deleteAtMs > nowMs) return null;
        return parsedId;
      })
      .filter((id): id is string => Boolean(id))
      .slice(0, maxDeletes);

    for (const droneId of expiredIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await removeArchivedDroneById({ id: droneId, keepVolume: false });
        if (r.removeErr) {
          hubLog('warn', 'archive TTL delete failed', {
            id: droneId,
            error: r.removeErr,
            reason: opts?.reason ?? null,
          });
        } else {
          hubLog('info', 'archive TTL deleted drone', { id: droneId, reason: opts?.reason ?? null });
        }
      } catch (e: any) {
        hubLog('warn', 'archive TTL delete failed (exception)', {
          id: droneId,
          error: e?.message ?? String(e),
          reason: opts?.reason ?? null,
        });
      }
    }
  })().finally(() => {
    ARCHIVE_CLEANUP_TASK = null;
  });

  await ARCHIVE_CLEANUP_TASK;
}

async function renameDroneByName(opts: {
  oldName: string;
  newName: string;
  startMode?: 'preserve' | 'always' | 'never';
  migrateVolumeName?: boolean;
}) {
  return {
    ok: false as const,
    status: 410 as const,
    error: 'deprecated: renames are id-based; use /api/drones/:id/rename to update the display name (containers are never renamed)',
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

function looksLikeUnauthorizedDaemonError(raw: unknown): boolean {
  const msg = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!msg) return false;
  return msg === 'unauthorized' || msg.includes(' 401') || msg.startsWith('401 ') || msg.includes('forbidden');
}

async function readDroneTokenFromContainer(containerName: string): Promise<string> {
  const r = await dvmExec(containerName, 'bash', ['-lc', 'cat /dvm-data/drone/token 2>/dev/null || true']);
  return String(r.stdout ?? '').trim();
}

async function refreshRegistryTokenFromContainer(opts: { droneId: string }): Promise<string | null> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  if (!droneId) return null;
  const lockKey = `drone:${droneId}`;

  return await withDroneOpLock(lockKey, async () => {
    const regAny: any = await loadRegistry();
    const entry: any = regAny?.drones?.[droneId] ?? null;
    if (!entry) return null;

    let token = '';
    try {
      token = await readDroneTokenFromContainer(String(entry?.containerName ?? entry?.name ?? `drone-${droneId}`));
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (looksLikeMissingContainerError(msg)) {
        try {
          const reg2: any = await loadRegistry();
          const entry2: any = reg2?.drones?.[droneId] ?? null;
          if (entry2) {
            token = await readDroneTokenFromContainer(String(entry2?.containerName ?? entry2?.name ?? `drone-${droneId}`));
          }
        } catch {
          token = '';
        }
      }
    }
    token = String(token ?? '').trim();
    if (!token) return null;

    await updateRegistry((regUpdate: any) => {
      const d = regUpdate?.drones?.[droneId];
      if (!d) return;
      const current = typeof d.token === 'string' ? String(d.token) : '';
      if (current === token) return;
      d.token = token;
      regUpdate.drones = regUpdate.drones ?? {};
      regUpdate.drones[droneId] = d;
    });

    return token;
  });
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

async function ensureChatEntry(opts: { droneId: string; chatName: string }): Promise<void> {
  await updateRegistry((reg: any) => {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const d = droneId ? reg?.drones?.[droneId] : null;
    if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
    d.chats = d.chats ?? {};
    if (!d.chats[opts.chatName]) {
      // Default new chats to builtin Cursor transcript mode (chat bubbles).
      // NOTE: chatId is intentionally omitted (it is created lazily on first prompt).
      d.chats[opts.chatName] = { createdAt: new Date().toISOString(), agent: { kind: 'builtin', id: 'cursor' } } as any;
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = d;
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

async function getChatEntry(opts: { droneId: string; chatName: string }) {
  const reg = await loadRegistry();
  const droneId = normalizeDroneIdentity(opts.droneId);
  const d = droneId ? (reg as any).drones?.[droneId] : null;
  if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
  const chat = d.chats?.[opts.chatName];
  if (!chat) throw new Error(`unknown chat: ${opts.chatName}`);
  return { reg, d, chat, droneId };
}

async function setChatAgentConfig(opts: {
  droneId: string;
  chatName: string;
  agent?: ChatAgentConfig;
  setModel?: boolean;
  model?: string | null;
}) {
  await updateRegistry((reg: any) => {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const d = droneId ? reg?.drones?.[droneId] : null;
    if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
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
    reg.drones[droneId] = d;
  });
}

async function resolveChatTmuxCommand(opts: { droneId: string; chatName: string }): Promise<string> {
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

async function ensureCursorChatId(opts: { droneId: string; containerName: string; chatName: string }): Promise<string> {
  const { chat } = await getChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
  const existing = typeof (chat as any).chatId === 'string' ? String((chat as any).chatId).trim() : '';
  if (existing) return existing;
  const r = await dvmExec(opts.containerName, 'bash', ['-lc', 'agent create-chat'], {
    timeoutMs: defaultSeedBootstrapTimeoutMs(),
  });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'agent create-chat failed').trim());
  const id = parseUuid(`${r.stdout}\n${r.stderr}`);
  if (!id) throw new Error(`failed to parse chatId from agent create-chat output: ${r.stdout || r.stderr || '(empty)'}`);
  const finalId = await updateRegistry((reg: any) => {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const d = droneId ? reg?.drones?.[droneId] : null;
    if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
    d.chats = d.chats ?? {};
    const cur = d.chats?.[opts.chatName];
    if (!cur) throw new Error(`unknown chat: ${opts.chatName}`);
    const already = typeof cur.chatId === 'string' ? String(cur.chatId).trim() : '';
    if (already) return already;
    cur.chatId = id;
    d.chats[opts.chatName] = cur;
    reg.drones = reg.drones ?? {};
    reg.drones[droneId] = d;
    return id;
  });
  return finalId;
}

async function ensureClaudeSessionId(opts: { droneId: string; chatName: string }): Promise<string> {
  const { chat } = await getChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
  const existing = typeof (chat as any).claudeSessionId === 'string' ? String((chat as any).claudeSessionId).trim() : '';
  if (existing) return existing;
  const id = crypto.randomUUID();
  return await updateRegistry((reg: any) => {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const d = droneId ? reg?.drones?.[droneId] : null;
    if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
    d.chats = d.chats ?? {};
    const cur = d.chats?.[opts.chatName];
    if (!cur) throw new Error(`unknown chat: ${opts.chatName}`);
    const already = typeof cur.claudeSessionId === 'string' ? String(cur.claudeSessionId).trim() : '';
    if (already) return already;
    cur.claudeSessionId = id;
    d.chats[opts.chatName] = cur;
    reg.drones = reg.drones ?? {};
    reg.drones[droneId] = d;
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
  droneId: string;
  droneLabel?: string | null;
  containerName: string;
  chatName: string;
}): Promise<string | null> {
  const { chat } = await getChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
  const existing = typeof (chat as any).openCodeSessionId === 'string' ? String((chat as any).openCodeSessionId).trim() : '';
  if (existing) return existing;

  const preferredTitle = openCodeSessionTitle(String(opts.droneLabel ?? opts.droneId), opts.chatName);
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
    const droneId = normalizeDroneIdentity(opts.droneId);
    const d = droneId ? reg?.drones?.[droneId] : null;
    if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
    d.chats = d.chats ?? {};
    const cur = d.chats?.[opts.chatName];
    if (!cur) throw new Error(`unknown chat: ${opts.chatName}`);
    const already = typeof cur.openCodeSessionId === 'string' ? String(cur.openCodeSessionId).trim() : '';
    if (already) return already;
    cur.openCodeSessionId = id;
    d.chats[opts.chatName] = cur;
    reg.drones = reg.drones ?? {};
    reg.drones[droneId] = d;
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
    // Best-effort: ensure any existing group names are persisted as group entries.
    // This prevents groups from "disappearing" once the last drone is deleted.
    try {
      await updateRegistry((regLatest: any) => {
        const at = nowIso();
        for (const d of Object.values(regLatest?.drones ?? {}) as any[]) {
          ensureGroupRegistered(regLatest, d?.group ?? null, at);
        }
        for (const d of Object.values(regLatest?.pending ?? {}) as any[]) {
          ensureGroupRegistered(regLatest, d?.group ?? null, at);
        }
      });
    } catch {
      // ignore (best-effort)
    }
  } catch {
    // ignore (best-effort)
  }

  if (!ARCHIVE_CLEANUP_INTERVAL) {
    ARCHIVE_CLEANUP_INTERVAL = setInterval(() => {
      triggerArchiveCleanup('interval');
    }, ARCHIVE_CLEANUP_INTERVAL_MS);
    try {
      (ARCHIVE_CLEANUP_INTERVAL as any).unref?.();
    } catch {
      // ignore
    }
  }
  triggerArchiveCleanup('startup');

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

      if (pathname === '/api/settings/delete-action') {
        if (method === 'GET') {
          json(res, 200, await resolveDeleteActionSettingsResponse());
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
          const mode = parseDroneDeleteMode(body?.mode);
          const archiveRetention = parseArchiveRetentionId(body?.archiveRetention);
          const archiveRuntimePolicy = parseArchiveRuntimePolicy(body?.archiveRuntimePolicy);
          if (!mode) {
            json(res, 400, { ok: false, error: 'mode must be permanent or archive' });
            return;
          }
          if (body?.archiveRetention != null && !archiveRetention) {
            json(res, 400, { ok: false, error: 'archiveRetention must be one of: 1h, 8h, 1d, 1w' });
            return;
          }
          if (body?.archiveRuntimePolicy != null && !archiveRuntimePolicy) {
            json(res, 400, { ok: false, error: 'archiveRuntimePolicy must be one of: keep-running, stop' });
            return;
          }
          await upsertStoredDeleteActionSettings({
            mode,
            archiveRetention: archiveRetention ?? undefined,
            archiveRuntimePolicy: archiveRuntimePolicy ?? undefined,
          });
          json(res, 200, await resolveDeleteActionSettingsResponse());
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

      // POST /api/tldr/from-message
      // Summarizes an agent response in chat context (short Markdown TLDR).
      if (method === 'POST' && pathname === '/api/tldr/from-message') {
        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const response = String(body?.response ?? '').trim();
        const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
        const context = Array.isArray(body?.context) ? body.context : [];
        if (!response) {
          json(res, 400, { ok: false, error: 'missing response' });
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
          const tldr = await tldrFromAgentMessage(
            {
              prompt,
              response,
              context: context
                .map((t: any) => ({
                  turn: typeof t?.turn === 'number' ? t.turn : Number(t?.turn ?? 0) || 0,
                  prompt: String(t?.prompt ?? ''),
                  response: String(t?.response ?? ''),
                }))
                .filter((t: any) => typeof t?.response === 'string'),
            },
            { provider, apiKey: resolved.apiKey },
          );
          json(res, 200, { ok: true, tldr });
          return;
        } catch (e: any) {
          hubLog('error', 'tldr/from-message request failed', {
            provider: selectedProvider,
            model: String(process.env.DRONE_HUB_TLDR_MODEL ?? '').trim() || null,
            error: e?.message ?? String(e),
          });
          json(res, 500, { ok: false, error: e?.message ?? String(e) });
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

        const nameRaw = body?.name;

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

        const preRegAny: any = await loadRegistry();
        let name = '';
        try {
          name = normalizeDroneDisplayName(nameRaw);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        if (!name) name = allocateUntitledDisplayName(preRegAny);
        if (droneDisplayNameExists(preRegAny, name)) {
          json(res, 409, { ok: false, error: `drone already exists: ${name}` });
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
        const cloneFromFound = cloneFrom ? findDroneIdByRef(preRegAny, cloneFrom) : null;
        const cloneFromId = cloneFromFound && cloneFromFound.kind === 'real' ? cloneFromFound.id : null;
        if (cloneFrom && !cloneFromId) {
          json(res, 404, { ok: false, error: `unknown cloneFrom drone: ${cloneFrom}` });
          return;
        }
        const droneId = makeDroneIdentity();
        const pendingWrite: { ok: boolean; status?: number; error?: string } = await updateRegistry((regAny: any) => {
          if (droneDisplayNameExists(regAny, name)) return { ok: false, status: 409, error: `drone already exists: ${name}` };
          regAny.pending = regAny.pending ?? {};
          const at = nowIso();
          ensureGroupRegistered(regAny, group ?? null, at);
          regAny.pending[droneId] = {
            id: droneId,
            name,
            group: group ?? undefined,
            repoPath,
            containerPort: containerPort ?? 7777,
            build,
            createdAt: at,
            updatedAt: at,
            phase: 'starting',
            message: 'Starting…',
            ...(cloneFromId ? { cloneFrom: cloneFromId, cloneChats: Boolean(cloneChats) } : {}),
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
          return { ok: true };
        });
        if (!pendingWrite.ok) {
          json(res, pendingWrite.status ?? 500, { ok: false, error: pendingWrite.error ?? 'failed to queue drone' });
          return;
        }

        // Queue provisioning (bounded concurrency).
        enqueueProvisioning(droneId);

        json(res, 202, { ok: true, id: droneId, name, phase: 'starting' });
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

        let accepted: Array<{ id: string; name: string; phase: 'starting' }> = [];
        let rejected: Array<{ name: string; error: string; status?: number }> = [];
        try {
          const result = await updateRegistry((regAny: any) => {
            regAny.pending = regAny.pending ?? {};
            const accepted: Array<{ id: string; name: string; phase: 'starting' }> = [];
            const rejected: Array<{ name: string; error: string; status?: number }> = [];
            const seenInRequest = new Set<string>();

            for (const raw of list) {
              let name = '';
              try {
                name = normalizeDroneDisplayName(raw?.name);
              } catch (e: any) {
                rejected.push({ name: String(raw?.name ?? '').trim(), error: e?.message ?? String(e), status: 400 });
                continue;
              }
              if (!name) name = allocateUntitledDisplayName(regAny);
              if (seenInRequest.has(name)) {
                rejected.push({ name, error: `duplicate name in request: ${name}`, status: 400 });
                continue;
              }
              seenInRequest.add(name);
              if (droneDisplayNameExists(regAny, name)) {
                rejected.push({ name, error: `drone already exists: ${name}`, status: 409 });
                continue;
              }

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
              const cloneFromFound = cloneFrom ? findDroneIdByRef(regAny, cloneFrom) : null;
              const cloneFromId = cloneFromFound && cloneFromFound.kind === 'real' ? cloneFromFound.id : null;
              if (cloneFrom && !cloneFromId) {
                rejected.push({ name, error: `unknown cloneFrom drone: ${cloneFrom}`, status: 404 });
                continue;
              }

              const id = makeDroneIdentity();
              const at = nowIso();
              ensureGroupRegistered(regAny, group ?? null, at);
              regAny.pending[id] = {
                id,
                name,
                group: group ?? undefined,
                repoPath,
                containerPort: containerPort ?? 7777,
                build,
                createdAt: at,
                updatedAt: at,
                phase: 'starting',
                message: 'Starting…',
                ...(cloneFromId ? { cloneFrom: cloneFromId, cloneChats: Boolean(cloneChats) } : {}),
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

              accepted.push({ id, name, phase: 'starting' });
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
        for (const a of accepted) enqueueProvisioning(a.id);

        json(res, 202, { ok: true, accepted, rejected, total: list.length });
        return;
      }

      // GET /api/drones
      if (method === 'GET' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'drones') {
        triggerArchiveCleanup('api:drones');
        const regAny: any = await loadRegistry();

        // Best-effort: if the Hub restarted while drones were pending, resume provisioning.
        // This endpoint is polled frequently, so it serves as a natural "self-heal" hook.
        enqueueProvisioningForAllPending(regAny);

        // Best-effort: keep the "typing" badge accurate even when a drone isn't selected.
        // We don't await this work; it updates registry in the background and will be reflected
        // in the next polls.
        try {
          for (const [droneId, d] of Object.entries(regAny.drones ?? {})) {
            const id = normalizeDroneIdentity(droneId);
            if (!id) continue;
            if (!d || typeof d !== 'object') continue;
            if (!(d as any)?.chats || typeof (d as any).chats !== 'object') continue;
            for (const [chatName, entry] of Object.entries((d as any).chats)) {
              if (chatHasReconcilablePendingPrompts(entry)) enqueueReconcile(id, String(chatName));
            }
          }
        } catch {
          // ignore
        }

        // Reconcile seeding prompt completion (restart-resumable).
        // If a seed prompt finished in the drone daemon, clear hub.seeding (or surface error).
        const hubPatches: Array<{ id: string; hub: any | null }> = [];
        for (const [droneId, d] of Object.entries(regAny.drones ?? {}) as any[]) {
          const hub = d?.hub;
          if (!hub || String(hub?.phase ?? '') !== 'seeding') continue;
          const id = normalizeDroneIdentity(droneId);
          if (!id) continue;
          let changedForDrone = false;
          let nextHub: any = hub;
          let promptId = String(nextHub?.promptId ?? '').trim();

          if (!promptId) {
            const chats = d?.chats && typeof d.chats === 'object' ? Object.values(d.chats) : [];
            for (const entry of chats as any[]) {
              const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
              const candidate = pending.find((p: any) => {
                const id = String(p?.id ?? '').trim();
                const st = String(p?.state ?? '').trim();
                return Boolean(id) && st !== 'failed';
              });
              const id = String(candidate?.id ?? '').trim();
              if (!id) continue;
              promptId = id;
              nextHub = { ...nextHub, promptId };
              changedForDrone = true;
              break;
            }
            // Back-compat: clear stale "seeding" markers with no active pending work.
            if (!promptId && !anyActivePendingPromptsForDrone(d)) {
              nextHub = null;
              changedForDrone = true;
            }
          }

          if (nextHub && promptId) {
            const token = typeof d.token === 'string' ? d.token : '';
            const containerName = String(d?.containerName ?? d?.name ?? '').trim();
            const hostPort =
              typeof d.hostPort === 'number' && Number.isFinite(d.hostPort)
                ? d.hostPort
                : await resolveHostPort(containerName || String(d.name ?? ''), d.containerPort);
            if (hostPort && token) {
              try {
                // eslint-disable-next-line no-await-in-loop
                const r: any = await dronePromptGet(makeClient(hostPort, token), promptId);
                const job = r?.job ?? null;
                const st = String(job?.state ?? '').trim();
                if (st === 'done') {
                  nextHub = null;
                  changedForDrone = true;
                } else if (st === 'failed') {
                  nextHub = { phase: 'error', message: String(job?.error ?? 'Seed failed'), updatedAt: nowIso() };
                  changedForDrone = true;
                }
              } catch {
                // ignore; keep seeding
              }
            }
          }

          if (changedForDrone) {
            if (nextHub == null) {
              delete d.hub;
            } else {
              d.hub = nextHub;
            }
            hubPatches.push({ id, hub: nextHub ?? null });
          }
        }
        if (hubPatches.length > 0) {
          // NOTE: Apply patches under a lock to avoid clobbering concurrent registry writers.
          try {
            await updateRegistry((regLatest: any) => {
              for (const p of hubPatches) {
                const id = normalizeDroneIdentity(p?.id);
                if (!id) continue;
                const d = regLatest?.drones?.[id];
                if (!d) continue;
                if (p.hub == null) {
                  delete d.hub;
                } else {
                  d.hub = p.hub;
                }
                regLatest.drones = regLatest.drones ?? {};
                regLatest.drones[id] = d;
              }
            });
          } catch {
            // ignore
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
            id: normalizeDroneIdentity(p?.id) || null,
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
            const containerName = String(d?.containerName ?? d?.name ?? '').trim();
            const hostPort =
              typeof d.hostPort === 'number' && Number.isFinite(d.hostPort)
                ? d.hostPort
                : await resolveHostPort(containerName || String(d.name ?? ''), d.containerPort);

            const hubPhase = typeof d?.hub?.phase === 'string' ? String(d.hub.phase) : null;
            const hubMessage = typeof d?.hub?.message === 'string' ? String(d.hub.message) : null;
            const repoAttached = Boolean(String(d?.repo?.dest ?? '').trim()) || Boolean(String(d?.repo?.seededAt ?? '').trim());

            let statusOk = false;
            let status: any = null;
            let statusError: string | null = null;
            const droneId = normalizeDroneIdentity(d?.id);
            const token = typeof d.token === 'string' ? d.token : '';
            if (hostPort && token) {
              try {
                status = await droneStatus(makeClient(hostPort, token));
                statusOk = true;
              } catch (e: any) {
                const firstErr = e?.message ?? String(e);
                if (looksLikeUnauthorizedDaemonError(firstErr)) {
                  try {
                    const refreshedToken = droneId ? await refreshRegistryTokenFromContainer({ droneId }) : null;
                    if (refreshedToken && refreshedToken !== token) {
                      status = await droneStatus(makeClient(hostPort, refreshedToken));
                      statusOk = true;
                      statusError = null;
                      hubLog('warn', 'refreshed stale drone token after unauthorized status', {
                        droneName: d.name,
                        hadId: Boolean(droneId),
                      });
                    } else {
                      statusError = firstErr;
                    }
                  } catch (e2: any) {
                    statusError = e2?.message ?? String(e2);
                  }
                } else {
                  statusError = firstErr;
                }
              }
            } else if (!hostPort) {
              statusError = 'no host port mapped (container likely stopped)';
            } else {
              statusError = 'missing token (still starting?)';
            }

            return {
              id: normalizeDroneIdentity(d?.id) || null,
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

        // Deduplicate by id (prefer real drone over pending).
        const byId = new Map<string, any>();
        for (const p of pendingSummaries) {
          const id = String(p?.id ?? '').trim();
          if (id) byId.set(id, p);
        }
        for (const d of realSummaries) {
          const id = String(d?.id ?? '').trim();
          if (id) byId.set(id, d);
        }
        const drones = Array.from(byId.values()).filter((x) => x?.id && x?.name);

        json(res, 200, { ok: true, drones });
        return;
      }

      // POST /api/drones/:id/hub/error/clear
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
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const resolvedName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
        let cleared = false;
        await updateRegistry((reg2: any) => {
          const dd = reg2?.drones?.[droneId];
          if (!dd) return;
          if (String(dd?.hub?.phase ?? '').trim().toLowerCase() === 'error') {
            delete dd.hub;
            cleared = true;
          }
          dd.repo = dd.repo ?? {};
          if (typeof dd.repo.lastPullError === 'string') dd.repo.lastPullError = null;
          reg2.drones = reg2.drones ?? {};
          reg2.drones[droneId] = dd;
        });
        json(res, 200, { ok: true, id: droneId, name: resolvedName, cleared });
        return;
      }

      // GET /api/drones/:id/ports
      // Exposes *all* host->container port mappings (like `dvm ports <container>`).
      // GET /api/drones/:id/fs/list?path=/...
      // Lists files/folders in a container path.
      if (method === 'GET' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'fs' && parts[4] === 'list') {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

        const targetPath = normalizeContainerPath(u.searchParams.get('path') ?? '/');
        const script = [
          'set -euo pipefail',
          `target=${bashQuote(targetPath)}`,
          // Defensive bootstrap: the Hub defaults non-repo drones to `/dvm-data/home`,
          // but early explorer requests can arrive before that directory exists.
          't="${target%/}"; [ -z "$t" ] && t="/"',
          `if [ "$t" = ${bashQuote(NON_REPO_HOME_CWD)} ]; then mkdir -p ${bashQuote(NON_REPO_HOME_CWD)} 2>/dev/null || true; fi`,
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
          const r = await withLockedDroneContainer({ requestedDroneName: droneName, droneEntry: resolved.drone }, async ({ containerName }) => {
            return await dvmExec(containerName, 'bash', ['-lc', script]);
          });
          if (r.code !== 0) {
            const out = `${r.stdout || ''}\n${r.stderr || ''}`;
            if (/\bnot-dir\b/i.test(out)) {
              json(res, 404, { ok: false, error: `path is not a directory: ${targetPath}`, id: droneId, name: droneName, path: targetPath });
              return;
            }
            json(res, 500, { ok: false, error: (r.stderr || r.stdout || 'failed to list files').trim(), id: droneId, name: droneName, path: targetPath });
            return;
          }

          const parsed = parseContainerFsListOutput(r.stdout || '');
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            path: parsed.resolvedPath,
            entries: parsed.entries,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = looksLikeMissingContainerError(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, id: droneId, name: droneName, path: targetPath });
          return;
        }
      }

      // GET /api/drones/:id/fs/thumb?path=/...
      // Returns image bytes for thumbnail rendering.
      // GET /api/drones/:id/fs/file?path=/...
      // Reads UTF-8 text file content for editor usage.
      if (method === 'GET' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'fs' && parts[4] === 'file') {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

        const targetPath = normalizeContainerPath(u.searchParams.get('path') ?? '');
        if (!targetPath || targetPath === '/') {
          json(res, 400, { ok: false, error: 'missing file path' });
          return;
        }

        const script = [
          'set -euo pipefail',
          `target=${bashQuote(targetPath)}`,
          `max=${String(FS_EDITOR_MAX_BYTES)}`,
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
          'mtime=$(stat -c %Y -- "$target" 2>/dev/null || echo 0)',
          'mime=""',
          'if command -v file >/dev/null 2>&1; then',
          '  mime=$(file -Lb --mime-type -- "$target" 2>/dev/null || true)',
          'fi',
          'printf "__META__\t%s\t%s\t%s\n" "$mime" "$size" "$mtime"',
          'base64 < "$target" | tr -d "\\n"',
        ].join('\n');

        try {
          const r = await withLockedDroneContainer({ requestedDroneName: droneName, droneEntry: resolved.drone }, async ({ containerName }) => {
            return await dvmExec(containerName, 'bash', ['-lc', script]);
          });
          const stdout = String(r.stdout ?? '');
          if (r.code !== 0) {
            if (stdout.includes('__ERR__\tnot-file')) {
              json(res, 404, { ok: false, error: `file not found: ${targetPath}`, id: droneId, name: droneName, path: targetPath });
              return;
            }
            const large = stdout.match(/__ERR__\ttoo-large\t(\d+)/);
            if (large) {
              json(res, 413, { ok: false, error: `file too large (${large[1]} bytes, max ${FS_EDITOR_MAX_BYTES})`, id: droneId, name: droneName, path: targetPath });
              return;
            }
            json(res, 500, { ok: false, error: (r.stderr || r.stdout || 'failed reading file').trim(), id: droneId, name: droneName, path: targetPath });
            return;
          }

          const firstNl = stdout.indexOf('\n');
          if (firstNl < 0) {
            json(res, 500, { ok: false, error: 'file response malformed', id: droneId, name: droneName, path: targetPath });
            return;
          }
          const metaLine = stdout.slice(0, firstNl);
          const b64 = stdout.slice(firstNl + 1).trim();
          const meta = metaLine.split('\t');
          if (meta.length < 4 || meta[0] !== '__META__') {
            json(res, 500, { ok: false, error: 'file metadata missing', id: droneId, name: droneName, path: targetPath });
            return;
          }

          const mimeRaw = String(meta[1] ?? '').trim().toLowerCase();
          const sizeNum = Number(meta[2] ?? 0);
          const mtimeSec = Number(meta[3] ?? 0);

          let buf: Buffer;
          try {
            buf = Buffer.from(b64, 'base64');
          } catch {
            json(res, 500, { ok: false, error: 'failed decoding file bytes', id: droneId, name: droneName, path: targetPath });
            return;
          }

          if (!isLikelyTextMimeType(mimeRaw) || bufferLooksBinary(buf)) {
            json(res, 415, { ok: false, error: 'file is not a UTF-8 text file', id: droneId, name: droneName, path: targetPath });
            return;
          }

          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            path: targetPath,
            content: buf.toString('utf8'),
            size: Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : 0,
            mtimeMs: Number.isFinite(mtimeSec) ? Math.max(0, Math.floor(mtimeSec * 1000)) : null,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = looksLikeMissingContainerError(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, id: droneId, name: droneName, path: targetPath });
          return;
        }
      }

      // POST /api/drones/:id/fs/file
      // Writes UTF-8 text file content for editor usage.
      if (method === 'POST' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'fs' && parts[4] === 'file') {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const targetPath = normalizeContainerPath(body?.path ?? '');
        if (!targetPath || targetPath === '/') {
          json(res, 400, { ok: false, error: 'missing file path' });
          return;
        }
        if (typeof body?.content !== 'string') {
          json(res, 400, { ok: false, error: 'content must be a string' });
          return;
        }
        const content = String(body?.content ?? '');
        const nextBytes = Buffer.byteLength(content, 'utf8');
        if (nextBytes > FS_EDITOR_MAX_BYTES) {
          json(res, 413, { ok: false, error: `file too large (${nextBytes} bytes, max ${FS_EDITOR_MAX_BYTES})` });
          return;
        }
        const contentBase64 = Buffer.from(content, 'utf8').toString('base64');

        try {
          const result = await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: resolved.drone },
            async ({ containerName }) => {
              const preflightScript = [
                'set -euo pipefail',
                `target=${bashQuote(targetPath)}`,
                'if [ ! -f "$target" ]; then',
                '  echo "__ERR__\tnot-file"',
                '  exit 3',
                'fi',
                'echo "__OK__"',
              ].join('\n');

              const preflight = await dvmExec(containerName, 'bash', ['-lc', preflightScript]);
              if (preflight.code !== 0) {
                const out = `${preflight.stdout || ''}\n${preflight.stderr || ''}`;
                if (/\bnot-file\b/i.test(out)) {
                  const err = new Error(`file not found: ${targetPath}`) as Error & { statusCode?: number };
                  err.statusCode = 404;
                  throw err;
                }
                throw new Error((preflight.stderr || preflight.stdout || 'failed checking file before save').trim());
              }

              const writeScript = [
                'set -euo pipefail',
                `target=${bashQuote(targetPath)}`,
                `data=${bashQuote(contentBase64)}`,
                'printf "%s" "$data" | base64 -d > "$target"',
              ].join('\n');
              const writeOut = await dvmExec(containerName, 'bash', ['-lc', writeScript]);
              if (writeOut.code !== 0) {
                throw new Error((writeOut.stderr || writeOut.stdout || 'failed writing file').trim());
              }

              const statScript = [
                'set -euo pipefail',
                `target=${bashQuote(targetPath)}`,
                'size=$(stat -c %s -- "$target" 2>/dev/null || echo 0)',
                'mtime=$(stat -c %Y -- "$target" 2>/dev/null || echo 0)',
                'printf "__META__\t%s\t%s\n" "$size" "$mtime"',
              ].join('\n');
              const statOut = await dvmExec(containerName, 'bash', ['-lc', statScript]);
              if (statOut.code !== 0) {
                throw new Error((statOut.stderr || statOut.stdout || 'failed reading saved file metadata').trim());
              }
              const line = String(statOut.stdout ?? '').trim();
              const parts = line.split('\t');
              const sizeNum = Number(parts[1] ?? 0);
              const mtimeSec = Number(parts[2] ?? 0);
              return {
                size: Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : 0,
                mtimeMs: Number.isFinite(mtimeSec) ? Math.max(0, Math.floor(mtimeSec * 1000)) : null,
              };
            },
          );

          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            path: targetPath,
            size: result.size,
            mtimeMs: result.mtimeMs,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const explicitStatus = Number((e as any)?.statusCode ?? 0);
          const code = explicitStatus > 0 ? explicitStatus : looksLikeMissingContainerError(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, id: droneId, name: droneName, path: targetPath });
          return;
        }
      }

      if (method === 'GET' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'fs' && parts[4] === 'thumb') {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

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
          const r = await withLockedDroneContainer({ requestedDroneName: droneName, droneEntry: resolved.drone }, async ({ containerName }) => {
            return await dvmExec(containerName, 'bash', ['-lc', script]);
          });
          const stdout = String(r.stdout ?? '');
          if (r.code !== 0) {
            if (stdout.includes('__ERR__\tnot-file')) {
              json(res, 404, { ok: false, error: `file not found: ${targetPath}`, id: droneId, name: droneName, path: targetPath });
              return;
            }
            const large = stdout.match(/__ERR__\ttoo-large\t(\d+)/);
            if (large) {
              json(res, 413, { ok: false, error: `image too large (${large[1]} bytes, max ${FS_THUMB_MAX_BYTES})`, id: droneId, name: droneName, path: targetPath });
              return;
            }
            json(res, 500, { ok: false, error: (r.stderr || r.stdout || 'failed reading thumbnail').trim(), id: droneId, name: droneName, path: targetPath });
            return;
          }

          const firstNl = stdout.indexOf('\n');
          if (firstNl < 0) {
            json(res, 500, { ok: false, error: 'thumbnail response malformed', id: droneId, name: droneName, path: targetPath });
            return;
          }
          const metaLine = stdout.slice(0, firstNl);
          const b64 = stdout.slice(firstNl + 1).trim();
          const meta = metaLine.split('\t');
          if (meta.length < 3 || meta[0] !== '__META__') {
            json(res, 500, { ok: false, error: 'thumbnail metadata missing', id: droneId, name: droneName, path: targetPath });
            return;
          }

          const mimeRaw = String(meta[1] ?? '').trim().toLowerCase();
          const mime = mimeRaw.startsWith('image/') ? mimeRaw : guessImageMimeType(targetPath);
          if (!mime.startsWith('image/')) {
            json(res, 415, { ok: false, error: 'not an image file', id: droneId, name: droneName, path: targetPath });
            return;
          }

          let buf: Buffer;
          try {
            buf = Buffer.from(b64, 'base64');
          } catch {
            json(res, 500, { ok: false, error: 'failed decoding image bytes', id: droneId, name: droneName, path: targetPath });
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
          json(res, code, { ok: false, error: msg, id: droneId, name: droneName, path: targetPath });
          return;
        }
      }

      // GET /api/drones/:id/preview/:containerPort/*
      // Reverse-proxies HTTP traffic to a container port (resolved via host mapping).
      if (method === 'GET' && parts.length >= 5 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'preview') {
        const droneRef = decodeURIComponent(parts[2]);
        const containerPort = Number(parts[4]);
        if (!Number.isFinite(containerPort) || containerPort <= 0 || Math.floor(containerPort) !== containerPort) {
          json(res, 400, { ok: false, error: 'invalid container port' });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

        try {
          const ports = await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: resolved.drone },
            async ({ containerName }) => {
            return await dvmPorts(containerName);
            },
          );
          const mapped = ports.find(
            (p) =>
              Number(p?.containerPort) === containerPort &&
              typeof p?.hostPort === 'number' &&
              Number.isFinite(p.hostPort),
          );
          if (!mapped?.hostPort) {
            json(res, 404, { ok: false, error: `container port ${containerPort} is not mapped on host`, id: droneId, name: droneName });
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
          json(res, 502, { ok: false, error: `preview proxy failed: ${msg}`, id: droneId, name: droneName });
          return;
        }
      }

      if (method === 'GET' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'ports') {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
        try {
          const ports = await withLockedDroneContainer({ requestedDroneName: droneName, droneEntry: resolved.drone }, async ({ containerName }) => {
            return await dvmPorts(containerName);
          });
          json(res, 200, { ok: true, id: droneId, name: droneName, ports });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = looksLikeMissingContainerError(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, id: droneId, name: droneName });
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
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoAttached = Boolean(String(d?.repo?.dest ?? '').trim()) || Boolean(String(d?.repo?.seededAt ?? '').trim());
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathInContainer = droneRepoPathInContainer(d);
        try {
          const { repoRoot, summary } = await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: d },
            async ({ containerName }) => {
              return await droneRepoChangesSummary({
                container: containerName,
                repoPathInContainer,
              });
            },
          );
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot,
            branch: summary.branch,
            counts: summary.counts,
            entries: summary.entries,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const missingContainer = looksLikeMissingContainerError(msg);
          const repoUnavailable = looksLikeRepoUnavailableError(msg);
          const status = missingContainer ? 404 : repoUnavailable ? 409 : 500;
          json(res, status, {
            ok: false,
            error: repoUnavailable ? 'repository is not ready yet' : msg,
            ...(repoUnavailable ? { code: 'repo_unavailable' } : {}),
            id: droneId,
            name: droneName,
          });
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
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
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
          await withLockedDroneContainer({ requestedDroneName: droneName, droneEntry: d }, async ({ containerName }) => {
            const repoRootRaw = await runGitInDroneOrThrow({
              container: containerName,
              repoPathInContainer,
              args: ['rev-parse', '--show-toplevel'],
            });
            const repoRoot = String(repoRootRaw.stdout ?? '').trim() || repoPathInContainer;
            const diff = await droneRepoDiffForPath({
              container: containerName,
              repoPathInContainer,
              filePath,
              kind,
              contextLines: 3,
            });
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              repoRoot,
              path: diff.path,
              kind: diff.kind,
              diff: diff.diff,
              truncated: diff.truncated,
              fromUntracked: diff.fromUntracked,
            });
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const missingContainer = looksLikeMissingContainerError(msg);
          const repoUnavailable = looksLikeRepoUnavailableError(msg);
          const status = missingContainer ? 404 : repoUnavailable ? 409 : 500;
          json(res, status, {
            ok: false,
            error: repoUnavailable ? 'repository is not ready yet' : msg,
            ...(repoUnavailable ? { code: 'repo_unavailable' } : {}),
            id: droneId,
            name: droneName,
          });
          return;
        }
      }

      // GET /api/drones/:name/repo/pull/changes
      // "PR perspective": committed delta between dvm.baseSha..HEAD in the container repo.
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull' &&
        parts[5] === 'changes'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoAttached = Boolean(String(d?.repo?.dest ?? '').trim()) || Boolean(String(d?.repo?.seededAt ?? '').trim());
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathInContainer = droneRepoPathInContainer(d);
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        let pullPreviewBaseSha: string | undefined;
        const lastPullAny = d?.repo?.lastPull && typeof d.repo.lastPull === 'object' ? d.repo.lastPull : null;
        const lastPullMode = String((lastPullAny as any)?.mode ?? '').trim().toLowerCase();
        const lastExportedHeadSha = String((lastPullAny as any)?.exportedHeadSha ?? '').trim().toLowerCase();
        if (lastPullMode === 'host-conflicts-ready' && /^[0-9a-f]{40}$/.test(lastExportedHeadSha) && repoPathRaw) {
          try {
            const repoRoot = await gitTopLevel(repoPathRaw);
            const clean = await gitIsClean(repoRoot);
            if (clean) {
              // Match pull behavior: once host conflicts are fully resolved and committed,
              // preview from the last exported drone head so counts align with the next pull.
              pullPreviewBaseSha = lastExportedHeadSha;
            }
          } catch {
            // ignore and fall back to repo-configured dvm.baseSha
          }
        }
        try {
          let summary = await withLockedDroneContainer({ requestedDroneName: droneName, droneEntry: d }, async ({ containerName }) => {
            return await droneRepoPullChangesSummary({
              container: containerName,
              repoPathInContainer,
              baseSha: pullPreviewBaseSha,
            });
          });
          if (repoPathRaw) {
            try {
              const lastPullAny = d?.repo?.lastPull && typeof d.repo.lastPull === 'object' ? d.repo.lastPull : null;
              const lastPullMode = String((lastPullAny as any)?.mode ?? '').trim().toLowerCase();
              const lastExportedHeadSha = String((lastPullAny as any)?.exportedHeadSha ?? '').trim().toLowerCase();
              if (
                lastPullMode === 'bundle-merge-no-commit' &&
                /^[0-9a-f]{40}$/.test(lastExportedHeadSha) &&
                summary.baseSha === lastExportedHeadSha &&
                /^[0-9a-f]{40}$/.test(summary.headSha)
              ) {
                const repoRoot = await gitTopLevel(repoPathRaw);
                const hostSummary = await gitRepoChangesSummary(repoRoot);
                const hostHeadSha = String(hostSummary.branch.oid ?? '').trim().toLowerCase();
                if (/^[0-9a-f]{40}$/.test(hostHeadSha)) {
                  const hostContainsLastExport = await gitIsAncestor(repoRoot, lastExportedHeadSha, 'HEAD');
                  if (!hostContainsLastExport) {
                    const recoveryBaseSha = await gitMergeBase(repoRoot, 'HEAD', lastExportedHeadSha);
                    if (recoveryBaseSha && recoveryBaseSha !== summary.baseSha) {
                      summary = await withLockedDroneContainer({ requestedDroneName: droneName, droneEntry: d }, async ({ containerName }) => {
                        return await droneRepoPullChangesSummary({
                          container: containerName,
                          repoPathInContainer,
                          baseSha: recoveryBaseSha,
                        });
                      });
                    }
                  }
                }
              }
            } catch (e: any) {
              hubLog('warn', 'Pull preview recovery-base calculation failed; using container base', {
                droneName,
                repoPathRaw,
                error: e?.message ?? String(e),
              });
            }
          }
          let entriesForPreview: RepoPullChangeEntry[] = summary.entries;
          if (repoPathRaw && summary.entries.length > 0) {
            try {
              const repoRoot = await gitTopLevel(repoPathRaw);
              const hostSummary = await gitRepoChangesSummary(repoRoot);
              const hostHeadSha = String(hostSummary.branch.oid ?? '').trim().toLowerCase();
              if (/^[0-9a-f]{40}$/.test(hostHeadSha)) {
                const cacheKey = [droneId, repoRoot, hostHeadSha, summary.baseSha, summary.headSha].join('\u0000');
                const now = Date.now();
                const cached = pullPreviewHostMergeCache.get(cacheKey);
                if (cached && now - cached.atMs < PULL_PREVIEW_HOST_MERGE_CACHE_TTL_MS) {
                  entriesForPreview = cached.entries;
                } else {
                  let exportPath = '';
                  let importRefName = '';
                  try {
                    const patchesOutRoot = droneRootPath('repo-exports');
                    await fs.mkdir(patchesOutRoot, { recursive: true });
                    const safeDroneRefSeg =
                      String(droneName ?? '')
                        .toLowerCase()
                        .replace(/[^a-z0-9_.-]+/g, '-')
                        .replace(/^-+|-+$/g, '') || 'drone';
                    const importRunId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
                    importRefName = `refs/drone/imports/${safeDroneRefSeg}/preview-${importRunId}`;
                    try {
                      const exported = await withLockedDroneContainer(
                        { requestedDroneName: droneName, droneEntry: d },
                        async ({ containerName }) => {
                          return await dvmRepoExport({
                            container: containerName,
                            repoPathInContainer,
                            outDir: patchesOutRoot,
                            format: 'bundle',
                            base: summary.baseSha,
                          });
                        },
                      );
                      exportPath = exported.exportedPath;
                    } catch (e: any) {
                      const msg = e?.message ?? String(e);
                      if (looksLikeEmptyBundleExportError(msg)) {
                        entriesForPreview = [];
                      } else {
                        throw e;
                      }
                    }

                    if (exportPath) {
                      await importBundleHeadToHostRef({ repoRoot, bundlePath: exportPath, refName: importRefName });
                      const mergedNameStatus = await gitMergePreviewNameStatusEntries({
                        repoRoot,
                        oursRef: 'HEAD',
                        theirsRef: importRefName,
                      });
                      entriesForPreview = mergedNameStatus.map((entry) => ({
                        path: entry.path,
                        originalPath: entry.originalPath,
                        statusChar: entry.statusChar,
                        statusType: nameStatusCharToType(entry.statusChar),
                      }));
                    }

                    if (pullPreviewHostMergeCache.size > 200) pullPreviewHostMergeCache.clear();
                    pullPreviewHostMergeCache.set(cacheKey, { atMs: now, entries: entriesForPreview });
                  } finally {
                    if (exportPath) {
                      try {
                        await fs.rm(exportPath, { recursive: true, force: true });
                      } catch {
                        // ignore
                      }
                    }
                    if (importRefName) {
                      await deleteHostRefBestEffort({ repoRoot, refName: importRefName });
                    }
                  }
                }
              }
            } catch (e: any) {
              hubLog('warn', 'Pull preview host-merge calculation failed; using container-range fallback', {
                droneName,
                repoPathRaw,
                error: e?.message ?? String(e),
              });
            }
          }
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot: summary.repoRoot,
            baseSha: summary.baseSha,
            headSha: summary.headSha,
            counts: { changed: entriesForPreview.length },
            entries: entriesForPreview,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const missingBase = /missing dvm\.baseSha/i.test(msg);
          json(res, missingBase ? 409 : 500, {
            ok: false,
            error: missingBase ? 'Drone repo is missing its base SHA. Re-seed the drone to enable pull preview.' : msg,
            ...(missingBase ? { code: 'missing_base' } : {}),
          });
          return;
        }
      }

      // GET /api/drones/:name/repo/pull/diff?path=<repo-relative>&base=<sha>&head=<sha>
      // Unified diff for a single file between base..head (defaults to base=dvm.baseSha and head=HEAD).
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull' &&
        parts[5] === 'diff'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
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
        const baseSha = String(u.searchParams.get('base') ?? '').trim().toLowerCase();
        const headSha = String(u.searchParams.get('head') ?? '').trim().toLowerCase();

        try {
          const diff = await withLockedDroneContainer({ requestedDroneName: droneName, droneEntry: d }, async ({ containerName }) => {
            return await droneRepoPullDiffForPath({
              container: containerName,
              repoPathInContainer,
              filePath,
              baseSha: /^[0-9a-f]{40}$/.test(baseSha) ? baseSha : undefined,
              headSha: /^[0-9a-f]{40}$/.test(headSha) ? headSha : undefined,
              contextLines: 3,
            });
          });
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot: diff.repoRoot,
            baseSha: diff.baseSha,
            headSha: diff.headSha,
            path: diff.path,
            diff: diff.diff,
            truncated: diff.truncated,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const missingBase = /missing dvm\.baseSha/i.test(msg);
          json(res, missingBase ? 409 : 500, {
            ok: false,
            error: missingBase ? 'Drone repo is missing its base SHA. Re-seed the drone to enable pull preview.' : msg,
            ...(missingBase ? { code: 'missing_base' } : {}),
          });
          return;
        }
      }

      // GET /api/drones/:name/repo/pull-requests?state=open|closed|all
      // Lists pull requests for the host repo's GitHub remote.
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull-requests'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoAttached = Boolean(String(d?.repo?.dest ?? '').trim()) || Boolean(String(d?.repo?.seededAt ?? '').trim());
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 409, { ok: false, error: 'host repo path is unavailable for this drone', code: 'repo_path_missing', id: droneId, name: droneName });
          return;
        }
        const state = normalizeGithubPullRequestListState(u.searchParams.get('state'), 'open');

        let repoRoot = '';
        try {
          repoRoot = await gitTopLevel(repoPathRaw);
          const cacheKey = `${repoRoot}\u0000${state}`;
          const now = Date.now();
          const cached = githubPullRequestListCache.get(cacheKey);
          let payload =
            cached && now - cached.atMs < GITHUB_PULL_REQUEST_LIST_CACHE_TTL_MS
              ? cached.payload
              : null;

          if (!payload) {
            const listed = await listGithubPullRequestsForRepoRoot({ repoRoot, state });
            payload = {
              repoRoot,
              state,
              github: listed.repo,
              count: listed.pullRequests.length,
              pullRequests: listed.pullRequests,
            };
            if (githubPullRequestListCache.size > 400) githubPullRequestListCache.clear();
            githubPullRequestListCache.set(cacheKey, { atMs: now, payload });
          }

          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            ...payload,
          });
          return;
        } catch (e: any) {
          let diagnostics: {
            repoRoot: string | null;
            origin: string | null;
            github: { owner: string; repo: string } | null;
          } | null = null;
          if (repoRoot) {
            try {
              const debug = await inspectGithubRepoForRepoRoot(repoRoot);
              diagnostics = {
                repoRoot,
                origin: debug.remoteUrl ? String(debug.remoteUrl).trim() : null,
                github: debug.parsedRepo ?? null,
              };
            } catch {
              diagnostics = {
                repoRoot,
                origin: null,
                github: null,
              };
            }
          }
          if (isGithubPullRequestError(e)) {
            json(res, e.statusCode, {
              ok: false,
              error: e.message,
              ...(e.code ? { code: e.code } : {}),
              ...(diagnostics ? { diagnostics } : {}),
              id: droneId,
              name: droneName,
            });
            return;
          }
          const msg = e?.message ?? String(e);
          json(res, 500, {
            ok: false,
            error: msg,
            ...(diagnostics ? { diagnostics } : {}),
            id: droneId,
            name: droneName,
          });
          return;
        }
      }

      // GET /api/drones/:name/repo/pull-requests/:number/changes
      // Lists exact GitHub PR file changes/diffs for a specific PR number.
      if (
        method === 'GET' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull-requests' &&
        parts[6] === 'changes'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoAttached = Boolean(String(d?.repo?.dest ?? '').trim()) || Boolean(String(d?.repo?.seededAt ?? '').trim());
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 409, { ok: false, error: 'host repo path is unavailable for this drone', code: 'repo_path_missing', id: droneId, name: droneName });
          return;
        }
        const pullNumber = Number.parseInt(String(parts[5] ?? '').trim(), 10);
        if (!Number.isFinite(pullNumber) || pullNumber <= 0 || Math.floor(pullNumber) !== pullNumber) {
          json(res, 400, { ok: false, error: 'invalid pull request number', code: 'invalid_pull_number', id: droneId, name: droneName });
          return;
        }

        try {
          const repoRoot = await gitTopLevel(repoPathRaw);
          const pr = await listGithubPullRequestChangesForRepoRoot({ repoRoot, pullNumber });
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot,
            github: pr.repo,
            pullRequest: pr.pullRequest,
            counts: pr.counts,
            entries: pr.entries,
          });
          return;
        } catch (e: any) {
          if (isGithubPullRequestError(e)) {
            json(res, e.statusCode, {
              ok: false,
              error: e.message,
              ...(e.code ? { code: e.code } : {}),
              id: droneId,
              name: droneName,
            });
            return;
          }
          const msg = e?.message ?? String(e);
          json(res, 500, { ok: false, error: msg, id: droneId, name: droneName });
          return;
        }
      }

      // POST /api/drones/:name/repo/pull-requests/:number/merge
      // Merges a pull request on GitHub.
      if (
        method === 'POST' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull-requests' &&
        parts[6] === 'merge'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoAttached = Boolean(String(d?.repo?.dest ?? '').trim()) || Boolean(String(d?.repo?.seededAt ?? '').trim());
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 409, { ok: false, error: 'host repo path is unavailable for this drone', code: 'repo_path_missing', id: droneId, name: droneName });
          return;
        }

        const pullNumber = Number.parseInt(String(parts[5] ?? '').trim(), 10);
        if (!Number.isFinite(pullNumber) || pullNumber <= 0 || Math.floor(pullNumber) !== pullNumber) {
          json(res, 400, { ok: false, error: 'invalid pull request number', code: 'invalid_pull_number', id: droneId, name: droneName });
          return;
        }

        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e), id: droneId, name: droneName });
          return;
        }
        const mergeMethod = normalizeGithubPullRequestMergeMethod(body?.method, 'merge');

        try {
          const repoRoot = await gitTopLevel(repoPathRaw);
          const merged = await mergeGithubPullRequestForRepoRoot({ repoRoot, pullNumber, method: mergeMethod });
          clearGithubPullRequestListCache(repoRoot);
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot,
            github: merged.repo,
            number: merged.number,
            merged: merged.merged,
            message: merged.message,
            sha: merged.sha,
            method: mergeMethod,
          });
          return;
        } catch (e: any) {
          if (isGithubPullRequestError(e)) {
            json(res, e.statusCode, {
              ok: false,
              error: e.message,
              ...(e.code ? { code: e.code } : {}),
              id: droneId,
              name: droneName,
            });
            return;
          }
          const msg = e?.message ?? String(e);
          json(res, 500, { ok: false, error: msg, id: droneId, name: droneName });
          return;
        }
      }

      // POST /api/drones/:name/repo/pull-requests/:number/close
      // Closes a pull request on GitHub without merging.
      if (
        method === 'POST' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull-requests' &&
        parts[6] === 'close'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoAttached = Boolean(String(d?.repo?.dest ?? '').trim()) || Boolean(String(d?.repo?.seededAt ?? '').trim());
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 409, { ok: false, error: 'host repo path is unavailable for this drone', code: 'repo_path_missing', id: droneId, name: droneName });
          return;
        }

        const pullNumber = Number.parseInt(String(parts[5] ?? '').trim(), 10);
        if (!Number.isFinite(pullNumber) || pullNumber <= 0 || Math.floor(pullNumber) !== pullNumber) {
          json(res, 400, { ok: false, error: 'invalid pull request number', code: 'invalid_pull_number', id: droneId, name: droneName });
          return;
        }

        try {
          const repoRoot = await gitTopLevel(repoPathRaw);
          const closed = await closeGithubPullRequestForRepoRoot({ repoRoot, pullNumber });
          clearGithubPullRequestListCache(repoRoot);
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot,
            github: closed.repo,
            number: closed.number,
            state: closed.state,
            title: closed.title,
            htmlUrl: closed.htmlUrl,
          });
          return;
        } catch (e: any) {
          if (isGithubPullRequestError(e)) {
            json(res, e.statusCode, {
              ok: false,
              error: e.message,
              ...(e.code ? { code: e.code } : {}),
              id: droneId,
              name: droneName,
            });
            return;
          }
          const msg = e?.message ?? String(e);
          json(res, 500, { ok: false, error: msg, id: droneId, name: droneName });
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
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        await setDroneHubMetaByIdentity({ droneId, hub: { phase: 'seeding', message: 'Seeding repo…' } });
        try {
          const repoRoot = await gitTopLevel(repoPathRaw);
          const baseRef = await gitCurrentBranchOrSha(repoRoot);
          await withLockedDroneContainer({ requestedDroneName: droneName, droneEntry: d }, async ({ containerName }) => {
            await dvmRepoSeed({
              container: containerName,
              hostPath: repoRoot,
              dest: '/work/repo',
              baseRef: 'HEAD',
              branch: 'dvm/work',
              clean: true,
              timeoutMs: defaultRepoSeedTimeoutMs(),
            });
          });
          await updateRegistry((reg2: any) => {
            const dd = reg2?.drones?.[droneId];
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
            reg2.drones[droneId] = dd;
          });
          await setDroneHubMetaByIdentity({ droneId, hub: null });
          json(res, 200, { ok: true, id: droneId, name: droneName, repoRoot, baseRef });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          await updateRegistry((reg2: any) => {
            const dd = reg2?.drones?.[droneId];
            if (!dd) return;
            dd.repo = dd.repo ?? {};
            dd.repo.lastSeedError = msg;
            reg2.drones = reg2.drones ?? {};
            reg2.drones[droneId] = dd;
          });
          await setDroneHubMetaByIdentity({ droneId, hub: { phase: 'error', message: `Repo seed failed: ${msg}` } });
          json(res, 500, { ok: false, error: msg });
          return;
        }
      }

      // POST /api/drones/:id/repo/pull
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
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const d = resolved.drone;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }

        await setDroneHubMetaByIdentity({ droneId, hub: { phase: 'seeding', message: 'Pulling repo changes…' } });

        let repoRoot = '';
        let fromRef = '';
        let exportPath = '';
        let importRefName = '';
        let importRefSha = '';
        const repoPathInContainer = String(d?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
        const containerName = String((d as any)?.containerName ?? (d as any)?.name ?? droneName).trim() || droneName;
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
            await dvmRepoSetBaseSha({ container: containerName, repoPathInContainer, baseSha: exportedHeadSha });
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
            await setDroneHubMetaByIdentity({ droneId, hub: null });
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
                await dvmRepoSetBaseSha({ container: containerName, repoPathInContainer, baseSha: lastExportedHeadSha });
                prePullBaseAdvanced = true;
              } catch (e: any) {
                prePullBaseAdvanceError = e?.message ?? String(e);
              }
            } else if (lastMode === 'bundle-merge-no-commit' && /^[0-9a-f]{40}$/.test(lastExportedHeadSha)) {
              try {
                const hostContainsLastExport = await gitIsAncestor(repoRoot, lastExportedHeadSha, 'HEAD');
                if (!hostContainsLastExport) {
                  const recoveryBaseSha = await gitMergeBase(repoRoot, 'HEAD', lastExportedHeadSha);
                  if (recoveryBaseSha && recoveryBaseSha !== lastExportedHeadSha) {
                    prePullBaseSha = recoveryBaseSha;
                    try {
                      await dvmRepoSetBaseSha({ container: containerName, repoPathInContainer, baseSha: recoveryBaseSha });
                      prePullBaseAdvanced = true;
                    } catch (e: any) {
                      prePullBaseAdvanceError = e?.message ?? String(e);
                    }
                  }
                }
              } catch (e: any) {
                if (!prePullBaseAdvanceError) prePullBaseAdvanceError = e?.message ?? String(e);
              }
            }
          }

          try {
            exportedHeadSha = await dvmRepoHeadSha({ container: containerName, repoPathInContainer });
          } catch (e: any) {
            baseAdvanceError = e?.message ?? String(e);
          }

          // Export container repo delta as a git bundle, then import to a temporary host ref.
          const patchesOutRoot = droneRootPath('repo-exports');
          await fs.mkdir(patchesOutRoot, { recursive: true });
          try {
            const exported = await dvmRepoExport({
              container: containerName,
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
              const dd = reg2?.drones?.[droneId];
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
              reg2.drones[droneId] = dd;
            });
            hubLog('info', 'Repo pull completed with no new commits', { droneName, repoRoot, fromRef, exportedHeadSha });
            await setDroneHubMetaByIdentity({ droneId, hub: null });
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
                const dd = reg2?.drones?.[droneId];
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
                reg2.drones[droneId] = dd;
              });
              await setDroneHubMetaByIdentity({ droneId, hub: { phase: 'error', message: 'Repo pull needs reseed (history mismatch)' } });
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
            const dd = reg2?.drones?.[droneId];
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
            reg2.drones[droneId] = dd;
          });

          await setDroneHubMetaByIdentity({ droneId, hub: null });
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
                const dd = reg2?.drones?.[droneId];
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
                reg2.drones[droneId] = dd;
              });
              await setDroneHubMetaByIdentity({ droneId, hub: { phase: 'error', message: 'Repo pull failed while importing bundle' } });
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
              const dd = reg2?.drones?.[droneId];
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
              reg2.drones[droneId] = dd;
            });
            await setDroneHubMetaByIdentity({
              droneId,
              hub: {
                phase: 'error',
                message: `Repo pull conflict${patchErr.patchName ? ` (${patchErr.patchName})` : ''}: resolve conflicts in host repo`,
              },
            });
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
            const dd = reg2?.drones?.[droneId];
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
            reg2.drones[droneId] = dd;
          });
          await setDroneHubMetaByIdentity({ droneId, hub: { phase: 'error', message: `Repo pull failed: ${msg}` } });
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

        const rawList = Array.isArray(body?.droneIds) ? body.droneIds : Array.isArray(body?.drones) ? body.drones : [];
        if (rawList.length === 0) {
          json(res, 400, { ok: false, error: 'missing droneIds (expected non-empty array)' });
          return;
        }

        const seen = new Set<string>();
        const dronesToMove: string[] = [];
        for (const rawId of rawList) {
          const id = normalizeDroneIdentity(String(rawId ?? '').trim());
          if (!id) {
            json(res, 400, { ok: false, error: 'invalid drone id (empty)' });
            return;
          }
          if (seen.has(id)) continue;
          seen.add(id);
          dronesToMove.push(id);
        }

        const groupRaw = body?.group;
        if (!(groupRaw == null || typeof groupRaw === 'string')) {
          json(res, 400, { ok: false, error: 'invalid group (expected string or null)' });
          return;
        }
        const groupValue = String(groupRaw ?? '').trim();
        const nextGroup = !groupValue || isUngroupedGroupName(groupValue) ? null : groupValue;

        const result = await updateRegistry((regAny: any) => {
          const at = nowIso();
          if (nextGroup) ensureGroupRegistered(regAny, nextGroup, at);
          const moved: Array<{ id: string; name: string; previousGroup: string | null; group: string | null }> = [];
          const rejected: Array<{ id: string; error: string }> = [];

          for (const id of dronesToMove) {
            const real = regAny?.drones?.[id] ?? null;
            const pending = regAny?.pending?.[id] ?? null;
            const source = real ?? pending;
            if (!source) {
              rejected.push({ id, error: `unknown drone: ${id}` });
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
              regAny.drones[id] = real;
            }
            if (pending) {
              if (nextGroup == null) {
                delete pending.group;
              } else {
                pending.group = nextGroup;
              }
              regAny.pending = regAny.pending ?? {};
              regAny.pending[id] = pending;
            }

            moved.push({ id, name: String(source?.name ?? ''), previousGroup, group: nextGroup });
          }

          return { moved, rejected };
        });

        json(res, 200, { ok: true, group: nextGroup, moved: result.moved, rejected: result.rejected, total: dronesToMove.length });
        return;
      }

      // POST /api/drones/:id/rename
      if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'rename') {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const oldName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        let newName = '';
        try {
          newName = normalizeDroneDisplayName(body?.newName);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        if (oldName === newName) {
          json(res, 200, { ok: true, id: droneId, oldName, newName, renamed: false, reason: 'same-name' });
          return;
        }
        const renamed = await updateRegistry((regAny: any) => {
          for (const [k, v] of Object.entries(regAny?.drones ?? {})) {
            const id = String(k);
            if (id === droneId) continue;
            if (String((v as any)?.name ?? '').trim() === newName) return { ok: false, status: 409, error: `drone already exists: ${newName}` };
          }
          for (const [k, v] of Object.entries(regAny?.pending ?? {})) {
            const id = String(k);
            if (id === droneId) continue;
            if (String((v as any)?.name ?? '').trim() === newName) return { ok: false, status: 409, error: `pending drone already exists: ${newName}` };
          }
          const d = regAny?.drones?.[droneId];
          if (!d) return { ok: false, status: 404, error: `unknown drone: ${droneId}` };
          d.name = newName;
          regAny.drones = regAny.drones ?? {};
          regAny.drones[droneId] = d;
          return { ok: true, id: droneId, oldName, newName, renamed: true };
        });
        if (!(renamed as any).ok) {
          json(res, (renamed as any).status ?? 500, { ok: false, error: (renamed as any).error ?? 'rename failed' });
          return;
        }

        json(res, 200, renamed);
        return;
      }

      // POST /api/drones/:id/base-image
      // Sets the given drone's container as the DVM base image (same as: `dvm base set <container>`).
      if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'base-image') {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

        try {
          const out = await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: resolved.drone },
            async ({ containerName }) => {
              const r = await dvmBaseSet(containerName, { timeoutMs: 10 * 60 * 1000 });
              return { containerName, baseImage: r.baseImage };
            },
          );
          json(res, 200, { ok: true, id: droneId, name: droneName, containerName: out.containerName, baseImage: out.baseImage });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const status = /not found/i.test(msg) ? 404 : 500;
          json(res, status, { ok: false, error: msg });
          return;
        }
      }

      // DELETE /api/drones/:id?keepVolume=0|1&forget=0|1
      if (method === 'DELETE' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'drones') {
        const droneRef = decodeURIComponent(parts[2]);
        const regAnySnapshot: any = await loadRegistry();
        const found = findDroneIdByRef(regAnySnapshot, droneRef);
        if (!found) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
          return;
        }
        const droneId = normalizeDroneIdentity(found.id) || found.id;
        const snapshotDrone =
          found.kind === 'pending' && !regAnySnapshot?.drones?.[droneId]
            ? regAnySnapshot?.pending?.[droneId]
            : regAnySnapshot?.drones?.[droneId];
        const droneName = String(snapshotDrone?.name ?? droneRef).trim() || droneRef;
        const keepVolume = parseBoolParam(u.searchParams.get('keepVolume'), false);
        const forget = parseBoolParam(u.searchParams.get('forget'), true);

        const pendingResult = await updateRegistry((regAny: any) => {
          if (regAny?.drones?.[droneId]) return { kind: 'real' as const };
          if (regAny?.pending?.[droneId]) {
            delete regAny.pending[droneId];
            return { kind: 'pending' as const };
          }
          return { kind: 'none' as const };
        });
        if (pendingResult.kind === 'pending') {
          dequeueProvisioning(droneId);
          json(res, 200, { ok: true, id: droneId, name: droneName, removedRegistry: false, removedPending: true });
          return;
        }
        if (pendingResult.kind === 'none') {
          json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
          return;
        }

        const r = await removeDroneById({ id: droneId, keepVolume, forget });
        if (r.removeErr) {
          json(res, 500, {
            ok: false,
            id: droneId,
            name: droneName,
            error: r.removeErr,
            removedRegistry: r.removedRegistry,
          });
          return;
        }

        json(res, 200, { ok: true, id: droneId, name: droneName, removedRegistry: r.removedRegistry });
        return;
      }

      // POST /api/drones/:id/archive
      if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'archive') {
        const droneRef = decodeURIComponent(parts[2]);
        const regAnySnapshot: any = await loadRegistry();
        const found = findDroneIdByRef(regAnySnapshot, droneRef);
        if (!found) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
          return;
        }
        const droneId = normalizeDroneIdentity(found.id) || found.id;
        const snapshotDrone =
          found.kind === 'pending' && !regAnySnapshot?.drones?.[droneId]
            ? regAnySnapshot?.pending?.[droneId]
            : regAnySnapshot?.drones?.[droneId];
        const droneName = String(snapshotDrone?.name ?? droneRef).trim() || droneRef;
        const deleteSettings = await resolveEffectiveDeleteActionSettings();
        const archiveRetention = deleteSettings.archiveRetention;
        const archiveRuntimePolicy = deleteSettings.archiveRuntimePolicy;

        const pendingResult = await updateRegistry((regAny: any) => {
          if (regAny?.drones?.[droneId]) return { kind: 'real' as const };
          if (regAny?.pending?.[droneId]) {
            delete regAny.pending[droneId];
            return { kind: 'pending' as const };
          }
          return { kind: 'none' as const };
        });
        if (pendingResult.kind === 'pending') {
          dequeueProvisioning(droneId);
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            archived: false,
            removedPending: true,
            archiveRetention,
            archiveRuntimePolicy,
            archivedAt: null,
            deleteAt: null,
          });
          return;
        }
        if (pendingResult.kind === 'none') {
          json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
          return;
        }

        if (archiveRuntimePolicy === 'stop') {
          const containerName = String(snapshotDrone?.containerName ?? snapshotDrone?.name ?? `drone-${droneId}`).trim() || `drone-${droneId}`;
          try {
            await dvmStop(containerName);
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            if (!looksLikeContainerNotRunningError(msg) && !looksLikeMissingContainerError(msg)) {
              json(res, 500, {
                ok: false,
                error: `failed to stop drone container "${containerName}" before archive: ${msg}`,
              });
              return;
            }
          }
        }

        const r = await archiveDroneById({ id: droneId, archiveRetention, archiveRuntimePolicy });
        if (!r.hadEntry || !r.archived) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
          return;
        }
        json(res, 200, {
          ok: true,
          id: r.id,
          name: r.name,
          archived: r.archived,
          archiveRetention: r.archiveRetention,
          archiveRuntimePolicy: r.archiveRuntimePolicy,
          archivedAt: r.archivedAt,
          deleteAt: r.deleteAt,
        });
        return;
      }

      // GET /api/archive/drones
      if (method === 'GET' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'archive' && parts[2] === 'drones') {
        triggerArchiveCleanup('api:archive-drones');
        const regAny: any = await loadRegistry();
        const nowMs = Date.now();
        const archived = (Object.entries(regAny?.archived ?? {}) as Array<[string, any]>)
          .map(([id, entry]) => {
            const droneId = normalizeDroneIdentity(id);
            if (!droneId) return null;
            const archivedAt = String(entry?.archivedAt ?? '').trim() || String(entry?.createdAt ?? nowIso());
            const deleteAt = resolveArchiveDeleteAtIso(entry);
            const deleteAtMs = parseIsoToMs(deleteAt);
            if (deleteAtMs != null && deleteAtMs <= nowMs) return null;
            const retention = normalizeArchiveRetention(entry?.archiveRetention);
            const runtimePolicy = normalizeArchiveRuntimePolicy(entry?.archiveRuntimePolicy);
            return {
              id: droneId,
              name: String(entry?.name ?? '').trim() || droneId,
              group: typeof entry?.group === 'string' && entry.group.trim() ? String(entry.group).trim() : null,
              createdAt: String(entry?.createdAt ?? '').trim() || null,
              archivedAt,
              deleteAt,
              deleteInMs: deleteAtMs == null ? null : Math.max(0, deleteAtMs - nowMs),
              archiveRetention: retention,
              archiveRetentionMs: archiveRetentionMs(retention),
              archiveRuntimePolicy: runtimePolicy,
              containerName: String(entry?.containerName ?? '').trim() || `drone-${droneId}`,
              repoPath: String(entry?.repoPath ?? '').trim() || '',
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
          .sort((a, b) => {
            const ams = parseIsoToMs(a.archivedAt) ?? 0;
            const bms = parseIsoToMs(b.archivedAt) ?? 0;
            return bms - ams;
          });
        json(res, 200, { ok: true, archived, total: archived.length, now: new Date(nowMs).toISOString() });
        return;
      }

      // POST /api/archive/drones/:id/restore
      if (method === 'POST' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'archive' && parts[2] === 'drones' && parts[4] === 'restore') {
        const archivedDroneRef = decodeURIComponent(parts[3]);
        const droneId = normalizeDroneIdentity(archivedDroneRef);
        if (!droneId) {
          json(res, 400, { ok: false, error: `invalid drone id: ${archivedDroneRef}` });
          return;
        }
        const r = await restoreArchivedDroneById({ id: droneId });
        if (!r.hadEntry) {
          json(res, 404, { ok: false, error: r.error ?? `unknown archived drone: ${droneId}` });
          return;
        }
        if (!r.restored) {
          json(res, 409, { ok: false, id: r.id, name: r.name, error: r.error ?? 'restore failed' });
          return;
        }
        json(res, 200, { ok: true, id: r.id, name: r.name, renamed: r.renamed });
        return;
      }

      // DELETE /api/archive/drones/:id?keepVolume=0|1
      if (method === 'DELETE' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'archive' && parts[2] === 'drones') {
        const archivedDroneRef = decodeURIComponent(parts[3]);
        const droneId = normalizeDroneIdentity(archivedDroneRef);
        if (!droneId) {
          json(res, 400, { ok: false, error: `invalid drone id: ${archivedDroneRef}` });
          return;
        }
        const keepVolume = parseBoolParam(u.searchParams.get('keepVolume'), false);
        const r = await removeArchivedDroneById({ id: droneId, keepVolume });
        if (!r.hadEntry) {
          json(res, 404, { ok: false, error: r.removeErr ?? `unknown archived drone: ${droneId}` });
          return;
        }
        if (r.removeErr) {
          json(res, 500, {
            ok: false,
            id: r.id,
            name: r.name,
            error: r.removeErr,
            removedArchive: r.removedArchive,
          });
          return;
        }
        json(res, 200, { ok: true, id: r.id, name: r.name, removedArchive: r.removedArchive });
        return;
      }

      // GET /api/groups
      // Groups are host-side metadata in the registry file and persist even if empty.
      if (method === 'GET' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'groups') {
        const regAny: any = await loadRegistry();
        const names = listAllKnownGroups(regAny);

        const counts = new Map<string, { drones: number; pending: number }>();
        for (const d of Object.values(regAny.drones ?? {}) as any[]) {
          const g = normalizeGroupName(d?.group);
          if (!g || isUngroupedGroupName(g)) continue;
          const cur = counts.get(g) ?? { drones: 0, pending: 0 };
          cur.drones += 1;
          counts.set(g, cur);
        }
        for (const d of Object.values(regAny.pending ?? {}) as any[]) {
          const g = normalizeGroupName(d?.group);
          if (!g || isUngroupedGroupName(g)) continue;
          const cur = counts.get(g) ?? { drones: 0, pending: 0 };
          cur.pending += 1;
          counts.set(g, cur);
        }

        const groups = names.map((name) => {
          const entry = regAny?.groups?.[name] ?? null;
          const c = counts.get(name) ?? { drones: 0, pending: 0 };
          return {
            name,
            createdAt: typeof entry?.createdAt === 'string' ? String(entry.createdAt) : null,
            updatedAt: typeof entry?.updatedAt === 'string' ? String(entry.updatedAt) : null,
            droneCount: c.drones,
            pendingCount: c.pending,
            totalCount: c.drones + c.pending,
          };
        });

        json(res, 200, { ok: true, groups, total: groups.length });
        return;
      }

      // POST /api/groups
      // Create an empty group entry (independent of drone count).
      if (method === 'POST' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'groups') {
        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        let name = '';
        try {
          name = validateGroupNameOrThrow(body?.name ?? body?.group ?? body?.groupName ?? body?.groupId ?? '', 'group name');
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const at = nowIso();
        const r = await updateRegistry((regAny: any) => {
          regAny.groups = regAny.groups ?? {};
          if (regAny.groups[name]) return { ok: false, status: 409 as const, error: `group already exists: ${name}` };
          regAny.groups[name] = { name, createdAt: at, updatedAt: at };
          return { ok: true as const };
        });
        if (!r.ok) {
          json(res, r.status ?? 500, { ok: false, error: r.error ?? 'failed to create group' });
          return;
        }

        json(res, 201, { ok: true, name, createdAt: at });
        return;
      }

      // POST /api/groups/:group/rename
      // Renames a group and migrates drone assignments to the new name.
      if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'groups' && parts[3] === 'rename') {
        const oldNameRaw = decodeURIComponent(parts[2]);
        const oldName = normalizeGroupName(oldNameRaw);
        if (!oldName) {
          json(res, 400, { ok: false, error: 'invalid group name' });
          return;
        }
        if (isUngroupedGroupName(oldName)) {
          json(res, 400, { ok: false, error: 'cannot rename Ungrouped' });
          return;
        }

        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        let newName = '';
        try {
          newName = validateGroupNameOrThrow(body?.newName ?? body?.name ?? '', 'newName');
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        if (oldName === newName) {
          json(res, 200, { ok: true, oldName, newName, renamed: false, reason: 'same-name' });
          return;
        }

        const at = nowIso();
        const result = await updateRegistry((regAny: any) => {
          regAny.groups = regAny.groups ?? {};

          let usedOld = false;
          let usedNew = false;
          let movedDrones = 0;
          let movedPending = 0;

          for (const d of Object.values(regAny?.drones ?? {}) as any[]) {
            const g = normalizeGroupName(d?.group);
            if (g === oldName) usedOld = true;
            if (g === newName) usedNew = true;
          }
          for (const d of Object.values(regAny?.pending ?? {}) as any[]) {
            const g = normalizeGroupName(d?.group);
            if (g === oldName) usedOld = true;
            if (g === newName) usedNew = true;
          }

          const hasOldEntry = Boolean(regAny.groups[oldName]);
          if (!hasOldEntry && !usedOld) return { ok: false as const, status: 404 as const, error: `unknown group: ${oldName}` };
          if (regAny.groups[newName] || usedNew) return { ok: false as const, status: 409 as const, error: `group already exists: ${newName}` };

          // Migrate drone assignments.
          for (const [name, d] of Object.entries(regAny?.drones ?? {}) as any) {
            const g = normalizeGroupName(d?.group);
            if (g !== oldName) continue;
            d.group = newName;
            regAny.drones = regAny.drones ?? {};
            regAny.drones[String(name)] = d;
            movedDrones += 1;
          }
          for (const [name, d] of Object.entries(regAny?.pending ?? {}) as any) {
            const g = normalizeGroupName(d?.group);
            if (g !== oldName) continue;
            d.group = newName;
            regAny.pending = regAny.pending ?? {};
            regAny.pending[String(name)] = d;
            movedPending += 1;
          }

          // Rename/seed the group entry.
          if (regAny.groups[oldName]) {
            const entry = regAny.groups[oldName];
            delete regAny.groups[oldName];
            regAny.groups[newName] = {
              ...(entry && typeof entry === 'object' ? entry : {}),
              name: newName,
              updatedAt: at,
            };
          } else {
            regAny.groups[newName] = { name: newName, createdAt: at, updatedAt: at };
          }

          return { ok: true as const, movedDrones, movedPending };
        });

        if (!result.ok) {
          json(res, result.status ?? 500, { ok: false, error: result.error ?? 'failed to rename group' });
          return;
        }

        json(res, 200, { ok: true, oldName, newName, renamed: true, movedDrones: result.movedDrones, movedPending: result.movedPending });
        return;
      }

      // DELETE /api/groups/:group?keepVolume=0|1&forget=0|1
      // NOTE: Deleting a group deletes all drones inside it, and removes the group entry (if any).
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
        const groupExists = !wantsUngrouped && Boolean(regAny?.groups?.[group]);

        const realTargets = (Object.entries(regAny.drones ?? {}) as Array<[string, any]>)
          .map(([id, d]) => ({ id: normalizeDroneIdentity(id), name: String(d?.name ?? '').trim(), group: String(d?.group ?? '').trim() }))
          .filter((t) => Boolean(t.id))
          .filter((t) => {
            if (wantsUngrouped) return !t.group || isUngroupedGroupName(t.group);
            return t.group === group;
          });

        const pendingTargets = (Object.entries(regAny.pending ?? {}) as Array<[string, any]>)
          .map(([id, d]) => ({ id: normalizeDroneIdentity(id), name: String(d?.name ?? '').trim(), group: String(d?.group ?? '').trim() }))
          .filter((t) => Boolean(t.id))
          .filter((t) => {
            if (wantsUngrouped) return !t.group || isUngroupedGroupName(t.group);
            return t.group === group;
          });

        const targetById = new Map<string, { id: string; name: string }>();
        for (const t of [...realTargets, ...pendingTargets]) {
          if (!t.id) continue;
          if (!targetById.has(t.id)) targetById.set(t.id, { id: t.id, name: t.name || t.id });
        }
        const targets = Array.from(targetById.values()).sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

        // Allow deleting an explicitly-created empty group.
        if (targets.length === 0) {
          if (!groupExists) {
            json(res, 404, { ok: false, error: `unknown group (or empty): ${group}` });
            return;
          }
          try {
            await updateRegistry((regLatest: any) => {
              if (regLatest?.groups?.[group]) delete regLatest.groups[group];
            });
          } catch {
            // ignore
          }
          json(res, 200, { ok: true, group, removed: [], total: 0, deletedGroup: true });
          return;
        }

        const removed: Array<{ id: string; name: string }> = [];
        const pendingDeleted: string[] = [];
        const errors: Array<{ id: string; name: string; error: string; removedRegistry: boolean }> = [];

        for (const t of targets) {
          const id = t.id;
          const name = t.name;
          if (regAny?.pending?.[id] && !regAny?.drones?.[id]) {
            delete regAny.pending[id];
            pendingDeleted.push(id);
            removed.push({ id, name });
            dequeueProvisioning(id);
            continue;
          }
          const r = await removeDroneById({ id, keepVolume, forget });
          if (r.removeErr) {
            errors.push({ id, name, error: r.removeErr, removedRegistry: r.removedRegistry });
            continue;
          }
          removed.push({ id, name });
        }

        if (errors.length > 0) {
          json(res, 500, { ok: false, group, removed, errors, total: targets.length });
          return;
        }

        // Persist any pending deletions and remove the group entry (if any).
        try {
          await updateRegistry((regLatest: any) => {
            for (const n of pendingDeleted) {
              if (regLatest?.pending?.[n] && !regLatest?.drones?.[n]) delete regLatest.pending[n];
            }
            if (!wantsUngrouped && regLatest?.groups?.[group]) delete regLatest.groups[group];
          });
        } catch {
          // ignore (drones are already deleted)
        }

        json(res, 200, { ok: true, group, removed, total: targets.length, deletedGroup: !wantsUngrouped });
        return;
      }

      // POST /api/drones/:id/terminal/open?mode=shell|agent&chat=<chatName>&cwd=/path
      // Opens (or reuses) a tmux-backed terminal session for in-app web terminal use.
      if (method === 'POST' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'terminal' && parts[4] === 'open') {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const d = resolved.drone;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;

        const modeRaw = String(u.searchParams.get('mode') ?? 'shell')
          .trim()
          .toLowerCase();
        const mode: 'shell' | 'agent' = modeRaw === 'agent' ? 'agent' : 'shell';
        const chatName = normalizeChatName(u.searchParams.get('chat') ?? 'default');
        const defaultCwd = defaultDroneHomeCwd(d);
        const cwd = normalizeContainerPath(u.searchParams.get('cwd') ?? defaultCwd);

        try {
          await withLockedDroneContainer({ requestedDroneName: droneName, droneEntry: d }, async ({ containerName, droneEntry, droneId: lockedId }) => {
            const idForOps = normalizeDroneIdentity(lockedId) || normalizeDroneIdentity((droneEntry as any)?.id) || droneId;
            try {
              await upgradeDroneDaemonInContainer({
                containerName,
                containerPort: Number((droneEntry as any)?.containerPort ?? 7777),
              });
            } catch {
              // Best-effort daemon refresh; continue if upgrade fails.
            }
            if (mode === 'agent') {
              await ensureChatEntry({ droneId: idForOps, chatName });
              const tmuxCmd = await resolveChatTmuxCommand({ droneId: idForOps, chatName });
              const { sessionName } = await ensureHubChatSessionRunning({
                containerName,
                chatName,
                command: tmuxCmd,
                cwd,
              });
              json(res, 200, { ok: true, id: idForOps, name: droneName, mode, chat: chatName, cwd, sessionName });
              return;
            }

            const sessionName = hubShellSessionName();
            await ensureHubSessionRunning({
              containerName,
              sessionName,
              command: resolveHubTerminalShellCommand(),
              cwd,
            });
            json(res, 200, { ok: true, id: idForOps, name: droneName, mode, chat: null, cwd, sessionName });
          });
          return;
        } catch (e: any) {
          json(res, 500, { ok: false, error: e?.message ?? String(e), id: droneId, name: droneName, mode, chat: mode === 'agent' ? chatName : null });
          return;
        }
      }

      // GET /api/drones/:id/terminal/:session/output?since=<bytes>&maxBytes=<bytes>&tail=<lines>
      // Read output from a tmux-backed terminal session.
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'terminal' &&
        parts[5] === 'output'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const sessionName = decodeURIComponent(parts[4]);
        if (!isSafeTmuxSessionName(sessionName)) {
          json(res, 400, { ok: false, error: 'invalid session name' });
          return;
        }
        if (!isHubWebTerminalSessionName(sessionName)) {
          json(res, 404, { ok: false, error: 'unknown session', name: droneRef, sessionName });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

        const sinceRaw = u.searchParams.get('since');
        const maxBytesRaw = u.searchParams.get('maxBytes');
        const tailRaw = u.searchParams.get('tail');
        const since = parseOptionalNonNegativeInt(sinceRaw);
        const maxBytes = clampIntParam(maxBytesRaw, HUB_WEB_TERMINAL_MAX_BYTES, 1, HUB_WEB_TERMINAL_MAX_BYTES);
        const tailLines = clampIntParam(tailRaw, HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES, 0, HUB_WEB_TERMINAL_MAX_TAIL_LINES);

        try {
          const out = await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: resolved.drone },
            async ({ containerName }) => {
            return await dvmSessionRead({
              container: containerName,
              session: sessionName,
              since,
              maxBytes: since != null ? maxBytes : undefined,
              tailLines: since != null ? undefined : tailLines,
            });
            },
          );
          json(res, 200, { ok: true, id: droneId, name: droneName, sessionName, ...out });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /Session not found:/i.test(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, id: droneId, name: droneName, sessionName });
          return;
        }
      }

      // POST /api/drones/:id/terminal/:session/input
      // Sends raw text into a tmux-backed terminal session.
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'terminal' &&
        parts[5] === 'input'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const sessionName = decodeURIComponent(parts[4]);
        if (!isSafeTmuxSessionName(sessionName)) {
          json(res, 400, { ok: false, error: 'invalid session name' });
          return;
        }
        if (!isHubWebTerminalSessionName(sessionName)) {
          json(res, 404, { ok: false, error: 'unknown session', name: droneRef, sessionName });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

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
          await withLockedDroneContainer({ requestedDroneName: droneName, droneEntry: resolved.drone }, async ({ containerName }) => {
            await dvmSessionType(containerName, sessionName, { text: data });
          });
          json(res, 202, { ok: true, id: droneId, name: droneName, sessionName, bytes: Buffer.byteLength(data, 'utf8') });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /Session not found:/i.test(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, id: droneId, name: droneName, sessionName });
          return;
        }
      }

      // POST /api/drones/:id/open-terminal?mode=ssh|agent&chat=<chatName>
      // Opens a *real* terminal on the host machine (not a simulated web terminal).
      if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'open-terminal') {
        const droneRef = decodeURIComponent(parts[2]);
        const modeRaw = String(u.searchParams.get('mode') ?? 'ssh').trim().toLowerCase();
        const mode = modeRaw === 'ssh' || modeRaw === 'agent' ? (modeRaw as 'ssh' | 'agent') : null;
        if (!mode) {
          json(res, 400, { ok: false, error: `invalid mode: ${modeRaw} (expected ssh|agent)` });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;
        const containerName = String((drone as any)?.containerName ?? (drone as any)?.name ?? droneId).trim() || droneId;

        const chatName = String(u.searchParams.get('chat') ?? 'default').trim() || 'default';
        if (mode === 'agent') {
          await ensureChatEntry({ droneId, chatName });
        }

        // CLI-agnostic "continuation": keep one tmux session per chat.
        // This avoids relying on any CLI-specific resume flag.
        const sessionName = hubChatSessionName(chatName);
        const terminal = String(u.searchParams.get('terminal') ?? '').trim() || null;
        const markerBase = process.env.XDG_RUNTIME_DIR && process.env.XDG_RUNTIME_DIR.trim() ? process.env.XDG_RUNTIME_DIR.trim() : os.tmpdir();
        const markerPath = `${markerBase}/drone-hub-terminal-${process.pid}-${crypto.randomBytes(4).toString('hex')}.ok`;
        const markerSnippet = `printf %s ok > ${bashQuote(markerPath)}`;
        const agentCmd =
          mode === 'agent' ? await resolveChatTmuxCommand({ droneId, chatName }) : resolveHubAgentCommand();
        const agentSessionEnv = [
          // Match non-tmux-ish colors as closely as possible.
          'export TERM=xterm-256color',
          'export COLORTERM=truecolor',
        ].join('; ');
        const defaultCwd = defaultDroneHomeCwd(drone);
        const cwd = normalizeContainerPath(u.searchParams.get('cwd') ?? defaultCwd);
        const manualSshCmd = buildDockerExecShellCommand(containerName, cwd);
        const sshCmd = manualSshCmd;
        const agentShell = `set -e; ${agentSessionEnv}; mkdir -p ${bashQuote(cwd)} 2>/dev/null || true; cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data; exec ${agentCmd}`;
        const agentStartCmd = buildDvmCommand([
          'session',
          'start',
          containerName,
          sessionName,
          '--reuse',
          '--',
          'bash',
          '-lc',
          agentShell,
        ]);
        const agentAttachCmd = buildDvmCommand(['session', 'attach', containerName, sessionName]);
        const tmuxTuneCmds = [
          // Disable status line (green bar) and "freeze-on-exit".
          // IMPORTANT: use `--` so dvm exec doesn't parse tmux flags like -g/-t.
          buildDvmCommand(['exec', containerName, '--', 'tmux', 'set-option', '-g', 'status', 'off']),
          buildDvmCommand(['exec', containerName, '--', 'tmux', 'set-window-option', '-g', 'remain-on-exit', 'off']),
          // Improve color fidelity inside tmux.
          buildDvmCommand(['exec', containerName, '--', 'tmux', 'set-option', '-g', 'default-terminal', 'xterm-256color']),
          buildDvmCommand([
            'exec',
            containerName,
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
            containerName,
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
          containerName,
          sessionName,
          '--reuse',
          '--',
          'bash',
          '-lc',
          `set -e; ${agentSessionEnv}; mkdir -p ${bashQuote(cwd)} 2>/dev/null || true; cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data; exec ${agentCmd}`,
        ])} && ${tmuxTuneCmds.map((c) => `${c} || true`).join(' && ')} && ${buildDvmManualCommand(['session', 'attach', containerName, sessionName])}`;

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

        json(res, 200, {
          ok: true,
          id: droneId,
          name: droneName,
          mode,
          chat: chatName,
          sessionName,
          command,
          manualCommand,
          launcher: launched.launcher,
        });
        return;
      }

      // POST /api/drones/:id/open-editor?editor=code|cursor&cwd=/path
      // Opens a local editor attached to the docker container (VS Code Dev Containers style).
      if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'open-editor') {
        const droneRef = decodeURIComponent(parts[2]);
        const editorRaw = String(u.searchParams.get('editor') ?? 'code').trim().toLowerCase();
        const editor = editorRaw === 'code' || editorRaw === 'cursor' ? (editorRaw as 'code' | 'cursor') : null;
        if (!editor) {
          json(res, 400, { ok: false, error: `invalid editor: ${editorRaw} (expected code|cursor)` });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        const defaultCwd = defaultDroneHomeCwd(drone);
        const cwd = normalizeContainerPath(u.searchParams.get('cwd') ?? defaultCwd);
        const containerNameRaw = String((drone as any)?.containerName ?? (drone as any)?.name ?? `drone-${droneId}`).trim();
        const id = await dockerContainerId(containerNameRaw);
        // Dev Containers "attached-container" URIs expect a hex-encoded JSON payload as the authority suffix.
        // If we pass a raw docker ID, the extension will try to decode it and we end up with a corrupted
        // container identifier (seen as "��..." in logs).
        const containerName = `/${containerNameRaw}`;
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

        json(res, 200, { ok: true, id: droneId, name: droneName, editor, cwd, uri, manualCommand, launcher: launched.launcher });
        return;
      }

      // POST /api/drones/:id/chats/:chat/prompt
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
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]);
        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        let prompt = String(body?.prompt ?? '').trim();
        let attachments: ChatImageAttachment[] = [];
        try {
          attachments = normalizeChatImageAttachments(body?.attachments);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        if (!prompt && attachments.length === 0) {
          json(res, 400, { ok: false, error: 'missing prompt' });
          return;
        }
        if (!prompt && attachments.length > 0) {
          prompt = attachments.length === 1 ? '[image attachment]' : `[${attachments.length} image attachments]`;
        }

        try {
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const droneId = resolved.id;
          const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
          const chat = normalizeChatName(chatName);
          const promptIdRaw = String(body?.promptId ?? body?.prompt_id ?? body?.id ?? '').trim();
          if (promptIdRaw && !isSafePromptId(promptIdRaw)) {
            json(res, 400, { ok: false, error: 'invalid promptId' });
            return;
          }

          const r = await createOrEnqueuePromptUnified({
            id: promptIdRaw || undefined,
            droneId,
            chatName: chat,
            prompt,
            attachments,
            cwd: typeof body?.cwd === 'string' ? body.cwd : null,
          });

          if (r.kind === 'error') {
            json(res, r.status, { ok: false, error: r.error });
            return;
          }
          json(res, 202, { ok: true, accepted: true, id: droneId, name: droneName, chat, promptId: r.id });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /still starting/i.test(msg) ? 409 : /unknown drone/i.test(msg) ? 404 : /invalid promptId/i.test(msg) ? 400 : 500;
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // GET /api/drones/:id/chats/:chat/pending
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'pending'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        try {
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const droneId = resolved.id;
          const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
          await reconcileChatFromDaemon({ droneId, chatName });
          const list = await readPendingPrompts({ droneId, chatName });
          json(res, 200, { ok: true, id: droneId, name: droneName, chat: chatName, pending: list });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /still starting/i.test(msg) ? 409 : /unknown drone/i.test(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // POST /api/drones/:id/chats/:chat/pending/:promptId/unstick
      if (
        method === 'POST' &&
        parts.length === 8 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'pending' &&
        parts[7] === 'unstick'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        const promptId = String(decodeURIComponent(parts[6] ?? '')).trim();
        if (!isSafePromptId(promptId)) {
          json(res, 400, { ok: false, error: 'invalid promptId' });
          return;
        }
        try {
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const droneId = resolved.id;
          const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

          await reconcileChatFromDaemon({ droneId, chatName });
          const pendingBefore = await readPendingPrompts({ droneId, chatName });
          const pendingItemBefore = pendingBefore.find((p) => p.id === promptId) ?? null;
          const regBefore: any = await loadRegistry();
          const turnsBefore: any[] = Array.isArray(regBefore?.drones?.[droneId]?.chats?.[chatName]?.turns)
            ? regBefore.drones[droneId].chats[chatName].turns
            : [];
          const alreadyRecovered = turnsBefore.some((t: any) => String(t?.id ?? '').trim() === promptId);
          if (!pendingItemBefore && alreadyRecovered) {
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              chat: chatName,
              promptId,
              recovered: true,
              pendingState: null,
              alreadyRecovered: true,
            });
            return;
          }
          if (!pendingItemBefore) {
            json(res, 404, { ok: false, error: `unknown pending prompt: ${promptId}` });
            return;
          }

          const sessionName = promptJobTmuxSessionName(promptId);
          await withLockedDroneContainer({ requestedDroneName: droneName, droneEntry: resolved.drone }, async ({ containerName }) => {
            const script = `tmux kill-session -t ${bashQuote(sessionName)} 2>/dev/null || true`;
            await dvmExec(containerName, 'bash', ['-lc', script]);
          });

          let jobState: string | null = null;
          const regAfterKill: any = await loadRegistry();
          const dAfterKill = regAfterKill?.drones?.[droneId] ?? null;
          const token = typeof dAfterKill?.token === 'string' ? String(dAfterKill.token).trim() : '';
          const containerName =
            String(dAfterKill?.containerName ?? dAfterKill?.name ?? droneId).trim() || droneId;
          const hostPort =
            typeof dAfterKill?.hostPort === 'number' && Number.isFinite(dAfterKill.hostPort)
              ? dAfterKill.hostPort
              : await resolveHostPort(containerName, dAfterKill?.containerPort);
          if (token && hostPort) {
            const client = makeClient(hostPort, token);
            for (let attempt = 0; attempt < 10; attempt++) {
              try {
                // eslint-disable-next-line no-await-in-loop
                const r: any = await dronePromptGet(client, promptId);
                const nextState = String(r?.job?.state ?? '').trim();
                if (nextState) jobState = nextState;
                if (nextState && nextState !== 'queued' && nextState !== 'running') break;
              } catch {
                // keep best-effort behavior; reconcile below will handle stale rows.
              }
              // eslint-disable-next-line no-await-in-loop
              await sleepMs(250);
            }
          }

          await reconcileChatFromDaemon({ droneId, chatName });
          const pendingAfter = await readPendingPrompts({ droneId, chatName });
          const pendingItemAfter = pendingAfter.find((p) => p.id === promptId) ?? null;
          const regAfter: any = await loadRegistry();
          const turnsAfter: any[] = Array.isArray(regAfter?.drones?.[droneId]?.chats?.[chatName]?.turns)
            ? regAfter.drones[droneId].chats[chatName].turns
            : [];
          const recovered = turnsAfter.some((t: any) => String(t?.id ?? '').trim() === promptId);

          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            chat: chatName,
            promptId,
            sessionName,
            recovered,
            pendingState: pendingItemAfter?.state ?? null,
            jobState,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /still starting/i.test(msg) ? 409 : /unknown drone/i.test(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // GET /api/drones/:id/chats/:chat/output?since=<bytes>&maxBytes=<bytes>&tail=<lines>
      // Read the tmux session log for the given chat.
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'output'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatNameRaw = decodeURIComponent(parts[4]);
        const normalizedChat = normalizeChatName(chatNameRaw || 'default');
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
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const droneId = resolved.id;
          const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

          await withLockedDroneContainer({ requestedDroneName: droneName, droneEntry: resolved.drone }, async ({ containerName, droneId: lockedId }) => {
            const idForOps = normalizeDroneIdentity(lockedId) || droneId;
            await ensureChatEntry({ droneId: idForOps, chatName: normalizedChat });
            const tmuxCmd = await resolveChatTmuxCommand({ droneId: idForOps, chatName: normalizedChat });
            await ensureHubChatSessionRunning({ containerName, chatName: normalizedChat, command: tmuxCmd });

            if (view === 'screen') {
              const nRaw = Number.isFinite(tailLines) ? Math.floor(tailLines) : 200;
              const n = Math.max(20, Math.min(5000, nRaw || 200));
              const script = [
                'set -euo pipefail',
                `session=${JSON.stringify(sessionName)}`,
                `n=${JSON.stringify(String(n))}`,
                'tmux capture-pane -p -t "$session" -S "-$n" 2>/dev/null || tmux capture-pane -p -t "$session" 2>/dev/null || true',
              ].join('\n');
              const r = await dvmExec(containerName, 'bash', ['-lc', script]);
              if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'tmux capture-pane failed').trim());
              json(res, 200, { ok: true, id: idForOps, name: droneName, chat: normalizedChat, sessionName, view, tailLines: n, text: r.stdout || '' });
              return;
            }

            const out = await dvmSessionRead({
              container: containerName,
              session: sessionName,
              since: typeof since === 'number' && Number.isFinite(since) ? since : undefined,
              maxBytes: typeof maxBytes === 'number' && Number.isFinite(maxBytes) ? maxBytes : undefined,
              tailLines: typeof since === 'number' && Number.isFinite(since) ? undefined : tailLines,
            });
            json(res, 200, { ok: true, id: idForOps, name: droneName, chat: normalizedChat, sessionName, view, ...out });
          });
          return;
        } catch (e: any) {
          json(res, 500, { ok: false, error: e?.message ?? String(e), name: droneRef, chat: normalizedChat, sessionName });
          return;
        }
      }

      // GET /api/drones/:id/chats/:chat/models?refresh=1
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'models'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]) || 'default';
        const forceRefresh = parseBoolParam(u.searchParams.get('refresh'), false);
        try {
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const droneId = resolved.id;
          const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
          await ensureChatEntry({ droneId, chatName });
          const { d, chat } = await getChatEntry({ droneId, chatName });
          const agent = inferChatAgent(chat);
          if (agent.kind !== 'builtin') {
            json(res, 200, {
              ok: true,
              id: droneId,
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
            containerName: String((d as any)?.containerName ?? (d as any)?.name ?? droneId).trim() || droneId,
            droneName: droneId,
            chatName,
            agentId: agent.id,
            forceRefresh,
          });
          json(res, 200, {
            ok: true,
            id: droneId,
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

      // GET /api/drones/:id/chats
      if (method === 'GET' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'chats') {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
        const chats = (resolved.drone as any)?.chats ?? {};
        json(res, 200, { ok: true, id: droneId, name: droneName, chats: Object.keys(chats) });
        return;
      }

      // GET /api/drones/:id/chats/:chat
      if (method === 'GET' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'drones' && parts[3] === 'chats') {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
        const c = (resolved.drone as any)?.chats?.[chatName];
        if (!c) {
          json(res, 404, { ok: false, error: `unknown chat: ${chatName}` });
          return;
        }
        const agent = inferChatAgent(c as any);
        json(res, 200, {
          ok: true,
          id: droneId,
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

      // POST /api/drones/:id/chats/:chat/config
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'config'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]) || 'default';

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

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
          await ensureChatEntry({ droneId, chatName });
          const builtinId = normalizeBuiltinAgentId(kind === 'builtin' ? agentRaw?.id : kind);
          if (builtinId) {
            const agent: ChatAgentConfig = { kind: 'builtin', id: builtinId };
            await setChatAgentConfig({ droneId, chatName, agent, setModel: hasModelField, model });
            json(res, 200, { ok: true, id: droneId, name: droneName, chat: chatName, agent, ...(hasModelField ? { model } : {}) });
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
            await setChatAgentConfig({ droneId, chatName, agent, setModel: hasModelField, model });
            json(res, 200, { ok: true, id: droneId, name: droneName, chat: chatName, agent, ...(hasModelField ? { model } : {}) });
            return;
          }
          if (hasModelField) {
            await setChatAgentConfig({ droneId, chatName, setModel: true, model });
            json(res, 200, { ok: true, id: droneId, name: droneName, chat: chatName, model });
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

      // GET /api/drones/:id/chats/:chat/transcript?turn=last|all|N
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'transcript'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]) || 'default';
        try {
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const droneId = resolved.id;
          const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
          await reconcileChatFromDaemon({ droneId, chatName });
          const reg = await loadRegistry();
          const d = (reg as any).drones?.[droneId] ?? null;
          if (!d) {
            json(res, 404, { ok: false, error: `unknown drone: ${droneId}` });
            return;
          }
          const containerName = String((d as any)?.containerName ?? (d as any)?.name ?? droneId).trim() || droneId;
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
            const r = await dvmExec(containerName, 'bash', ['-lc', cmd]);
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

          json(res, 200, { ok: true, id: droneId, name: droneName, chat: chatName, selection: sel, transcripts, agent });
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
  const httpSockets = new Set<any>();
  server.on('connection', (socket) => {
    httpSockets.add(socket);
    socket.on('close', () => {
      httpSockets.delete(socket);
    });
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

      const droneRef = decodeURIComponent(parts[2]);
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

      const resolved = await resolveDroneOrRejectUpgrade(socket, droneRef);
      if (!resolved) return;
      const d = resolved.drone;
      const droneId = resolved.id;
      const token = typeof d?.token === 'string' ? String(d.token).trim() : '';
      const containerName = String((d as any)?.containerName ?? (d as any)?.name ?? droneId).trim() || droneId;
      const hostPort =
        typeof d?.hostPort === 'number' && Number.isFinite(d.hostPort)
          ? d.hostPort
          : await resolveHostPort(containerName, Number(d?.containerPort ?? 7777));
      if (!hostPort || !token) {
        rejectWebSocketUpgrade(socket, 503, 'Service Unavailable');
        return;
      }

      const wsContext: TerminalWebSocketContext = {
        droneName: droneId,
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
      const waitWithTimeout = async (p: Promise<void>, timeoutMs: number): Promise<void> => {
        await Promise.race([
          p,
          new Promise<void>((resolve) => {
            setTimeout(() => resolve(), Math.max(1, Math.floor(timeoutMs)));
          }),
        ]);
      };
      try {
        wss.clients.forEach((c: WebSocket) => {
          try {
            c.close();
          } catch {
            // ignore
          }
          try {
            c.terminate();
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }
      await waitWithTimeout(
        new Promise<void>((resolve) => {
          try {
            wss.close(() => resolve());
          } catch {
            resolve();
          }
        }),
        2_500
      );
      const serverClose = new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        (server as any).closeIdleConnections?.();
      } catch {
        // ignore
      }
      for (const socket of httpSockets) {
        try {
          socket.destroy();
        } catch {
          // ignore
        }
      }
      await waitWithTimeout(serverClose, 5_000);
      if (ARCHIVE_CLEANUP_INTERVAL) {
        try {
          clearInterval(ARCHIVE_CLEANUP_INTERVAL);
        } catch {
          // ignore
        }
        ARCHIVE_CLEANUP_INTERVAL = null;
      }
    },
  };
}
