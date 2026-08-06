import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';
import type { URL } from 'node:url';

export const DAEMON_JSON_MAX_BYTES = 8 * 1024 * 1024;
const WORKSPACE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const WORKSPACE_CHUNK_MAX_BYTES = 128 * 1024;
const WORKSPACE_EXEC_COMMAND_MAX_BYTES = 128 * 1024;
const WORKSPACE_EXEC_OUTPUT_MAX_BYTES = 4 * 1024 * 1024;
const WORKSPACE_EXEC_MAX_TIMEOUT_MS = 10 * 60 * 1000;
const WORKSPACE_BATCH_MAX_OPERATIONS = 500;
const WORKSPACE_GIT_HASH_MAX_PATHS = 5_000;
const WORKSPACE_GIT_HASH_CACHE_MAX_ENTRIES = 20_000;

type WorkspaceGitHashCacheEntry = {
  fingerprint: string;
  hash: string;
  lineCount: number;
  binary: boolean;
};

const workspaceGitHashCache = new Map<string, WorkspaceGitHashCacheEntry>();

function rememberWorkspaceGitHash(filePath: string, entry: WorkspaceGitHashCacheEntry): void {
  workspaceGitHashCache.delete(filePath);
  workspaceGitHashCache.set(filePath, entry);
  while (workspaceGitHashCache.size > WORKSPACE_GIT_HASH_CACHE_MAX_ENTRIES) {
    const oldestPath = workspaceGitHashCache.keys().next().value;
    if (typeof oldestPath !== 'string') break;
    workspaceGitHashCache.delete(oldestPath);
  }
}

export class DaemonHttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

export async function readLimitedBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const contentLength = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    req.resume();
    throw new DaemonHttpError(413, `request body too large (max ${maxBytes} bytes)`);
  }

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        settled = true;
        chunks.length = 0;
        reject(new DaemonHttpError(413, `request body too large (max ${maxBytes} bytes)`));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, bytes));
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    req.on('aborted', () => {
      if (settled) return;
      settled = true;
      reject(new DaemonHttpError(400, 'request aborted'));
    });
  });
}

export async function readLimitedJson(
  req: http.IncomingMessage,
  maxBytes = DAEMON_JSON_MAX_BYTES,
): Promise<any> {
  const raw = (await readLimitedBody(req, maxBytes)).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new DaemonHttpError(400, 'invalid JSON body');
  }
}

function requiredAbsolutePath(raw: unknown, label = 'path'): string {
  const value = String(raw ?? '').trim();
  if (!value || value.includes('\0') || !path.isAbsolute(value)) {
    throw new DaemonHttpError(400, `${label} must be an absolute path`);
  }
  return path.resolve(value);
}

function requiredMutablePath(raw: unknown, label = 'path'): string {
  const value = requiredAbsolutePath(raw, label);
  if (value === path.parse(value).root) {
    throw new DaemonHttpError(400, `${label} cannot be a filesystem root`);
  }
  return value;
}

function integerParam(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function requiredIntegerParam(raw: unknown, label: string, min: number, max: number): number {
  if (raw == null || String(raw).trim() === '') {
    throw new DaemonHttpError(400, `missing ${label}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new DaemonHttpError(400, `${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

async function fileMetadata(filePath: string): Promise<{ size: number; mtimeMs: number }> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new DaemonHttpError(404, `file not found: ${filePath}`);
  return {
    size: Math.max(0, Math.floor(stat.size)),
    mtimeMs: Math.max(0, Math.floor(stat.mtimeMs)),
  };
}

async function statOrNull(filePath: string): Promise<Awaited<ReturnType<typeof fs.stat>> | null> {
  try {
    return await fs.stat(filePath);
  } catch (error: any) {
    const code = String(error?.code ?? '');
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

async function lstatOrNull(filePath: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(filePath);
  } catch (error: any) {
    const code = String(error?.code ?? '');
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

async function readBoundedFile(
  filePath: string,
  maxBytes: number,
): Promise<{ content: Buffer; size: number; mtimeMs: number }> {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new DaemonHttpError(404, `file not found: ${filePath}`);
    const size = Math.max(0, Math.floor(stat.size));
    if (size > maxBytes) {
      throw new DaemonHttpError(413, `file too large (${size} bytes, max ${maxBytes})`);
    }
    const content = Buffer.alloc(size);
    let offset = 0;
    while (offset < content.length) {
      const read = await handle.read(content, offset, content.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    return {
      content: content.subarray(0, offset),
      size: offset,
      mtimeMs: Math.max(0, Math.floor(stat.mtimeMs)),
    };
  } finally {
    await handle.close();
  }
}

async function writeFileAtomic(filePath: string, content: Buffer | string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.drone-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  let mode: number | undefined;
  try {
    mode = (await fs.stat(filePath)).mode;
  } catch (error: any) {
    if (String(error?.code ?? '') !== 'ENOENT') throw error;
  }
  try {
    await fs.writeFile(temporaryPath, content, mode == null ? undefined : { mode });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function appendBounded(
  chunks: Buffer[],
  chunk: Buffer,
  capturedBytes: number,
  maxBytes: number,
): number {
  const remaining = Math.max(0, maxBytes - capturedBytes);
  if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
  return capturedBytes + Math.min(remaining, chunk.length);
}

async function runWorkspaceCommand(body: any): Promise<any> {
  if (typeof body?.cmd !== 'string') throw new DaemonHttpError(400, 'cmd must be a string');
  const command = body.cmd.trim();
  if (!command) throw new DaemonHttpError(400, 'missing cmd');
  if (body?.args != null && !Array.isArray(body.args)) {
    throw new DaemonHttpError(400, 'args must be an array of strings');
  }
  const args: string[] = body?.args ?? [];
  if (!args.every((value: unknown) => typeof value === 'string')) {
    throw new DaemonHttpError(400, 'args must be an array of strings');
  }
  const commandBytes =
    Buffer.byteLength(command, 'utf8') +
    args.reduce((total: number, value: string) => total + Buffer.byteLength(value, 'utf8'), 0);
  if (commandBytes > WORKSPACE_EXEC_COMMAND_MAX_BYTES) {
    throw new DaemonHttpError(
      413,
      `command too large (max ${WORKSPACE_EXEC_COMMAND_MAX_BYTES} bytes)`,
    );
  }
  if (body?.cwd != null && typeof body.cwd !== 'string') {
    throw new DaemonHttpError(400, 'cwd must be an absolute path string');
  }
  const cwd = body?.cwd == null ? undefined : requiredAbsolutePath(body.cwd, 'cwd');
  const timeoutMs = integerParam(body?.timeoutMs, 30_000, 1, WORKSPACE_EXEC_MAX_TIMEOUT_MS);
  const maxOutputBytes = integerParam(
    body?.maxOutputBytes,
    WORKSPACE_EXEC_OUTPUT_MAX_BYTES,
    1,
    WORKSPACE_EXEC_OUTPUT_MAX_BYTES,
  );

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutCapturedBytes = 0;
    let stderrCapturedBytes = 0;
    let timedOut = false;
    let finished = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // Process already exited.
      }
    };
    const terminate = () => {
      kill('SIGTERM');
      if (killTimer) return;
      killTimer = setTimeout(() => kill('SIGKILL'), 1500);
      killTimer.unref?.();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timeout.unref?.();

    child.stdout.on('data', (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      stdoutBytes += chunk.length;
      stdoutCapturedBytes = appendBounded(stdoutChunks, chunk, stdoutCapturedBytes, maxOutputBytes);
    });
    child.stderr.on('data', (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      stderrBytes += chunk.length;
      stderrCapturedBytes = appendBounded(stderrChunks, chunk, stderrCapturedBytes, maxOutputBytes);
    });
    child.on('error', (error: any) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        code: 127,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: `${Buffer.concat(stderrChunks).toString('utf8')}${error?.message ?? String(error)}`,
        stdoutBytes,
        stderrBytes,
        stdoutTruncated: stdoutBytes > maxOutputBytes,
        stderrTruncated: stderrBytes > maxOutputBytes,
        timedOut,
      });
    });
    child.on('close', (code, exitSignal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        code: timedOut ? 124 : (code ?? 1),
        signal: exitSignal ?? null,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        stdoutBytes,
        stderrBytes,
        stdoutTruncated: stdoutBytes > maxOutputBytes,
        stderrTruncated: stderrBytes > maxOutputBytes,
        timedOut,
      });
    });
  });
}

function pathInsideRoot(root: string, relativePath: string): string {
  if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) {
    throw new DaemonHttpError(400, 'Git hash paths must be non-empty relative paths');
  }
  const resolved = path.resolve(root, relativePath);
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSeparator)) {
    throw new DaemonHttpError(400, `Git hash path leaves repository: ${relativePath}`);
  }
  return resolved;
}

function gitHashPathChunks(repoRoot: string, relativePaths: string[]): string[][] {
  const fixedArgs = ['-C', repoRoot, 'hash-object', '--no-filters', '--'];
  const fixedBytes =
    Buffer.byteLength('git', 'utf8') +
    fixedArgs.reduce((total, value) => total + Buffer.byteLength(value, 'utf8'), 0);
  const chunks: string[][] = [];
  let chunk: string[] = [];
  let chunkBytes = fixedBytes;

  for (const relativePath of relativePaths) {
    const pathBytes = Buffer.byteLength(relativePath, 'utf8');
    if (fixedBytes + pathBytes > WORKSPACE_EXEC_COMMAND_MAX_BYTES) {
      throw new DaemonHttpError(413, `Git hash path is too long: ${relativePath}`);
    }
    if (
      chunk.length > 0 &&
      (chunk.length >= 400 || chunkBytes + pathBytes > WORKSPACE_EXEC_COMMAND_MAX_BYTES)
    ) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = fixedBytes;
    }
    chunk.push(relativePath);
    chunkBytes += pathBytes;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

async function hashWorkspaceGitFiles(body: any): Promise<{
  hashes: Array<{ path: string; hash: string; lineCount: number; binary: boolean }>;
  cacheHits: number;
  hashed: number;
  durationMs: number;
}> {
  const startedAt = performance.now();
  const repoRoot = requiredAbsolutePath(body?.repoRoot, 'repoRoot');
  const rawPaths: unknown[] = Array.isArray(body?.paths) ? body.paths : [];
  if (rawPaths.length > WORKSPACE_GIT_HASH_MAX_PATHS) {
    throw new DaemonHttpError(413, `too many Git hash paths (max ${WORKSPACE_GIT_HASH_MAX_PATHS})`);
  }
  if (!rawPaths.every((value) => typeof value === 'string')) {
    throw new DaemonHttpError(400, 'Git hash paths must be strings');
  }
  const stringPaths = rawPaths as string[];
  const relativePaths: string[] = Array.from(
    new Set(stringPaths.map((value) => value.trim())),
  );
  const states = new Map<string, { absolutePath: string; fingerprint: string; symbolicLink: boolean }>();
  for (let offset = 0; offset < relativePaths.length; offset += 200) {
    const chunk = relativePaths.slice(offset, offset + 200);
    const chunkStates = await Promise.all(
      chunk.map(async (relativePath) => {
        const absolutePath = pathInsideRoot(repoRoot, relativePath);
        try {
          const stat = await fs.lstat(absolutePath, { bigint: true });
          if (!stat.isFile() && !stat.isSymbolicLink()) return null;
          return {
            relativePath,
            absolutePath,
            fingerprint: `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.ino}`,
            symbolicLink: stat.isSymbolicLink(),
          };
        } catch (error: any) {
          const code = String(error?.code ?? '');
          if (code === 'ENOENT' || code === 'ENOTDIR') return null;
          throw error;
        }
      }),
    );
    for (const state of chunkStates) {
      if (state) states.set(state.relativePath, state);
    }
  }

  const hashes = new Map<string, WorkspaceGitHashCacheEntry>();
  const misses: string[] = [];
  let cacheHits = 0;
  for (const relativePath of relativePaths) {
    const state = states.get(relativePath);
    if (!state) continue;
    const cached = workspaceGitHashCache.get(state.absolutePath);
    if (cached?.fingerprint === state.fingerprint) {
      hashes.set(relativePath, cached);
      rememberWorkspaceGitHash(state.absolutePath, cached);
      cacheHits += 1;
    } else {
      misses.push(relativePath);
    }
  }

  const regularMisses = misses.filter((relativePath) => !states.get(relativePath)?.symbolicLink);
  for (const chunk of gitHashPathChunks(repoRoot, regularMisses)) {
    const result = await runWorkspaceCommand({
      cmd: 'git',
      args: ['-C', repoRoot, 'hash-object', '--no-filters', '--', ...chunk],
      timeoutMs: 30_000,
      maxOutputBytes: WORKSPACE_EXEC_OUTPUT_MAX_BYTES,
    });
    if (result.code !== 0 || result.stdoutTruncated || result.stderrTruncated) {
      throw new DaemonHttpError(
        500,
        String(result.stderr || result.stdout || 'git hash-object failed').trim(),
      );
    }
    const outputHashes = String(result.stdout ?? '')
      .trim()
      .split(/\r?\n/);
    for (let index = 0; index < chunk.length; index += 1) {
      const relativePath = chunk[index];
      const hash = String(outputHashes[index] ?? '')
        .trim()
        .toLowerCase();
      const state = states.get(relativePath);
      if (!state || !/^[0-9a-f]{40}$/.test(hash)) continue;
      const content = await fs.readFile(state.absolutePath);
      const binary = content.includes(0);
      let lineCount = 0;
      if (!binary && content.length > 0) {
        for (const byte of content) {
          if (byte === 10) lineCount += 1;
        }
        if (content[content.length - 1] !== 10) lineCount += 1;
      }
      const entry = { fingerprint: state.fingerprint, hash, lineCount, binary };
      hashes.set(relativePath, entry);
      rememberWorkspaceGitHash(state.absolutePath, entry);
    }
  }

  for (const relativePath of misses) {
    const state = states.get(relativePath);
    if (!state?.symbolicLink) continue;
    const content = await fs.readlink(state.absolutePath, { encoding: 'buffer' });
    const header = Buffer.from(`blob ${content.length}\0`, 'utf8');
    let lineCount = 0;
    for (const byte of content) {
      if (byte === 10) lineCount += 1;
    }
    if (content.length > 0 && content[content.length - 1] !== 10) lineCount += 1;
    const entry = {
      fingerprint: state.fingerprint,
      hash: crypto.createHash('sha1').update(header).update(content).digest('hex'),
      lineCount,
      binary: false,
    };
    hashes.set(relativePath, entry);
    rememberWorkspaceGitHash(state.absolutePath, entry);
  }

  return {
    hashes: relativePaths.flatMap((relativePath) => {
      const entry = hashes.get(relativePath);
      return entry
        ? [{ path: relativePath, hash: entry.hash, lineCount: entry.lineCount, binary: entry.binary }]
        : [];
    }),
    cacheHits,
    hashed: misses.length,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
  };
}

async function applyWorkspaceBatch(body: any): Promise<{ applied: number }> {
  const operations = Array.isArray(body?.operations) ? body.operations : [];
  if (operations.length === 0) throw new DaemonHttpError(400, 'missing operations');
  if (operations.length > WORKSPACE_BATCH_MAX_OPERATIONS) {
    throw new DaemonHttpError(413, `too many operations (max ${WORKSPACE_BATCH_MAX_OPERATIONS})`);
  }

  const normalizedOperations = operations.map((operation: any) => {
    const type = String(operation?.type ?? '');
    if (type === 'write') {
      const filePath = requiredMutablePath(operation.path);
      if (typeof operation.content !== 'string') {
        throw new DaemonHttpError(400, `write content must be a string: ${filePath}`);
      }
      const content = operation.content;
      if (Buffer.byteLength(content, 'utf8') > WORKSPACE_FILE_MAX_BYTES) {
        throw new DaemonHttpError(413, `file too large: ${filePath}`);
      }
      return { type, filePath, content } as const;
    }
    if (type === 'move') {
      const fromPath = requiredMutablePath(operation.fromPath, 'fromPath');
      const toPath = requiredMutablePath(operation.toPath, 'toPath');
      return { type, fromPath, toPath } as const;
    }
    if (type === 'delete') {
      return { type, filePath: requiredMutablePath(operation.path) } as const;
    }
    throw new DaemonHttpError(400, `unsupported batch operation: ${type || '(missing)'}`);
  });

  for (const operation of normalizedOperations) {
    if (operation.type === 'move') {
      const source = await statOrNull(operation.fromPath);
      if (!source?.isFile()) {
        throw new DaemonHttpError(404, `file not found: ${operation.fromPath}`);
      }
      if (await statOrNull(operation.toPath)) {
        throw new DaemonHttpError(409, `destination exists: ${operation.toPath}`);
      }
    } else if (operation.type === 'delete') {
      const target = await statOrNull(operation.filePath);
      if (!target?.isFile()) {
        throw new DaemonHttpError(404, `file not found: ${operation.filePath}`);
      }
    }
  }

  for (const operation of normalizedOperations) {
    if (operation.type === 'write') {
      await writeFileAtomic(operation.filePath, operation.content);
      continue;
    }
    if (operation.type === 'move') {
      const { fromPath, toPath } = operation;
      await fs.mkdir(path.dirname(toPath), { recursive: true });
      await fs.rename(fromPath, toPath);
      continue;
    }
    if (operation.type === 'delete') {
      const { filePath } = operation;
      await fs.rm(filePath);
    }
  }
  return { applied: operations.length };
}

export async function handleDaemonWorkspaceRequest(input: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  pathname: string;
  url: URL;
}): Promise<boolean> {
  const { req, res, method, pathname, url } = input;

  if (pathname === '/v1/workspace/file' && method === 'GET') {
    const filePath = requiredAbsolutePath(url.searchParams.get('path'));
    const read = await readBoundedFile(filePath, WORKSPACE_FILE_MAX_BYTES);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('x-drone-file-size', String(read.size));
    res.setHeader('x-drone-file-mtime-ms', String(read.mtimeMs));
    res.end(read.content);
    return true;
  }

  if (pathname === '/v1/workspace/file' && method === 'PUT') {
    const filePath = requiredMutablePath(url.searchParams.get('path'));
    const content = await readLimitedBody(req, WORKSPACE_FILE_MAX_BYTES);
    await writeFileAtomic(filePath, content);
    sendJson(res, 200, { ok: true, path: filePath, ...(await fileMetadata(filePath)) });
    return true;
  }

  if (pathname === '/v1/workspace/chunk' && method === 'GET') {
    const filePath = requiredAbsolutePath(url.searchParams.get('path'));
    const offset = requiredIntegerParam(
      url.searchParams.get('offset'),
      'offset',
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const length = requiredIntegerParam(
      url.searchParams.get('length'),
      'length',
      1,
      WORKSPACE_CHUNK_MAX_BYTES,
    );
    const handle = await fs.open(filePath, 'r');
    try {
      if (!(await handle.stat()).isFile()) {
        throw new DaemonHttpError(404, `file not found: ${filePath}`);
      }
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      res.statusCode = 200;
      res.setHeader('content-type', 'application/octet-stream');
      res.end(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
    return true;
  }

  if (pathname === '/v1/workspace/chunk' && method === 'PUT') {
    const filePath = requiredMutablePath(url.searchParams.get('path'));
    const offset = requiredIntegerParam(
      url.searchParams.get('offset'),
      'offset',
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const content = await readLimitedBody(req, WORKSPACE_CHUNK_MAX_BYTES);
    const info = await lstatOrNull(filePath);
    if (!info?.isFile() || info.isSymbolicLink()) {
      throw new DaemonHttpError(400, 'transfer temporary path is not a regular file');
    }
    const handle = await fs.open(filePath, 'r+');
    try {
      const current = (await handle.stat()).size;
      if (current === offset + content.length) {
        const existing = Buffer.alloc(content.length);
        const read = await handle.read(existing, 0, existing.length, offset);
        if (read.bytesRead === content.length && existing.equals(content)) {
          sendJson(res, 200, { ok: true, offset: current });
          return true;
        }
      }
      if (current !== offset) {
        throw new DaemonHttpError(
          409,
          `transfer offset mismatch: expected ${current}, received ${offset}`,
        );
      }
      await handle.write(content, 0, content.length, offset);
      await handle.sync();
      sendJson(res, 200, { ok: true, offset: offset + content.length });
    } finally {
      await handle.close();
    }
    return true;
  }

  if (pathname === '/v1/workspace/exec' && method === 'POST') {
    sendJson(res, 200, { ok: true, ...(await runWorkspaceCommand(await readLimitedJson(req))) });
    return true;
  }

  if (pathname === '/v1/workspace/git/hashes' && method === 'POST') {
    sendJson(res, 200, { ok: true, ...(await hashWorkspaceGitFiles(await readLimitedJson(req))) });
    return true;
  }

  if (pathname === '/v1/workspace/batch' && method === 'POST') {
    sendJson(res, 200, { ok: true, ...(await applyWorkspaceBatch(await readLimitedJson(req))) });
    return true;
  }

  return false;
}
