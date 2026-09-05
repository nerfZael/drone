import fs from 'node:fs/promises';
import path from 'node:path';

import {
  workspaceBatch,
  workspaceExec,
  workspaceReadChunk,
  workspaceReadFile,
  workspaceWriteChunk,
  workspaceWriteFile,
  daemonClientForDrone,
  type WorkspaceBatchOperation,
} from '../host/api';
import { run as runHostCommand } from '../host/dvm';
import type { DroneRuntime } from '../host/runtime';
import {
  ASSISTANT_BASH_MAX_COMMAND_BYTES,
  ASSISTANT_BASH_MAX_OUTPUT_BYTES,
  ASSISTANT_CHANGED_FILES_LIMIT,
  ASSISTANT_SEARCH_MAX_CONTEXT_LINES,
  FS_EDITOR_MAX_BYTES,
  FS_LIST_TIMEOUT_MS,
  buildContainerFsListScript,
  parseContainerFsListOutput,
  type ContainerFsEntry,
} from './filesystem-media';
import {
  applyAssistantReadLineRange,
  clampAssistantBashTimeoutMs,
  ensureAssistantTextFile,
  normalizeAssistantSearchContext,
  parseAssistantFindOutput,
  parseAssistantSearchContextOutput,
  parseAssistantSearchOutput,
  truncateUtf8Bytes,
} from './assistant-filesystem-utils';
import { bashQuote, normalizeContainerPath } from './hub-format';
import { resolveDroneFromRegistryRef } from './drone-lifecycle-service';
import { readTransferBytes, writeTransferBytes } from './assistant/transfer-file-io';
import {
  createDroneDaemonGitRunner,
  createDroneDaemonWorktreeHasher,
  droneRepoChangesSummary,
} from './drone-repo';
import { gitRepoChangesSummary, gitTopLevel } from './repoOps';

type ContainerAccess = {
  droneEntry: any;
};

export type AssistantFilesystemDependencies = {
  nonRepoHomeCwd: string;
  droneRuntime: (drone: any) => DroneRuntime;
  defaultDroneHomeCwd: (drone: any) => string;
  normalizeDroneCwdForRuntime: (drone: any, cwd: unknown) => string;
  hostMimeType: (targetPath: string) => Promise<string | null>;
  listHostFsDirectory: (
    targetPath: string,
  ) => Promise<{ resolvedPath: string; entries: ContainerFsEntry[] }>;
  isRepoAttachedDrone: (drone: any) => boolean;
  droneRepoPathInContainer: (drone: any) => string;
  withReadonlyDroneContainer: <T>(
    input: { requestedDroneName: string; droneEntry: any },
    operation: (access: ContainerAccess) => Promise<T>,
  ) => Promise<T>;
  withLockedDroneContainer: <T>(
    input: { requestedDroneName: string; droneEntry: any },
    operation: (access: ContainerAccess) => Promise<T>,
  ) => Promise<T>;
};

export function createAssistantFilesystemService(deps: AssistantFilesystemDependencies) {
  const {
    droneRuntime,
    defaultDroneHomeCwd,
    normalizeDroneCwdForRuntime,
    hostMimeType,
    listHostFsDirectory,
    isRepoAttachedDrone,
    droneRepoPathInContainer,
    withReadonlyDroneContainer,
    withLockedDroneContainer,
  } = deps;
  const NON_REPO_HOME_CWD = deps.nonRepoHomeCwd;

  async function runContainerCommand(
    drone: any,
    cmd: string,
    args: string[],
    opts?: { timeoutMs?: number },
  ) {
    const client = daemonClientForDrone(drone);
    const result = await workspaceExec(client, {
      cmd,
      args,
      ...(opts?.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    });
    if (result.stdoutTruncated || result.stderrTruncated) {
      throw new Error('container command output exceeded the daemon response limit');
    }
    return result;
  }

  async function readHostFileBytes(opts: {
    targetPath: string;
    maxBytes: number;
  }): Promise<{ buf: Buffer; size: number; mtimeMs: number | null; mime: string | null }> {
    const targetPath = path.resolve(String(opts.targetPath ?? '').trim());
    const st = await fs.stat(targetPath);
    if (!st.isFile()) {
      const err = new Error(`file not found: ${targetPath}`) as Error & { code?: string };
      err.code = 'ENOENT';
      throw err;
    }
    const size = Number.isFinite(st.size) ? Math.max(0, Math.floor(st.size)) : 0;
    if (size > opts.maxBytes) {
      const err = new Error(`file too large (${size} bytes, max ${opts.maxBytes})`) as Error & {
        statusCode?: number;
        size?: number;
      };
      err.statusCode = 413;
      err.size = size;
      throw err;
    }
    const buf = await fs.readFile(targetPath);
    const mime = await hostMimeType(targetPath);
    return {
      buf,
      size,
      mtimeMs: Number.isFinite(st.mtimeMs) ? Math.max(0, Math.floor(st.mtimeMs)) : null,
      mime,
    };
  }

  function normalizeAssistantFsPathForRuntime(
    drone: any,
    raw: unknown,
    opts?: { fallbackToHome?: boolean },
  ): string {
    const text = typeof raw === 'string' ? String(raw).trim() : '';
    if (!text && opts?.fallbackToHome === false) return '';
    const runtime = droneRuntime(drone);
    if (runtime === 'host') return normalizeDroneCwdForRuntime(drone, text || null);
    const fallback = defaultDroneHomeCwd(drone);
    if (!text) return normalizeContainerPath(fallback || NON_REPO_HOME_CWD);
    if (text.startsWith('/')) return normalizeContainerPath(text);
    return normalizeContainerPath(path.posix.join(fallback || NON_REPO_HOME_CWD, text));
  }

  function assistantRelativePathForDrone(
    drone: any,
    targetPathRaw: unknown,
    rootPathRaw?: unknown,
  ): string | null {
    const runtime = droneRuntime(drone);
    if (runtime === 'host') {
      const root = path.resolve(String(rootPathRaw ?? '').trim() || defaultDroneHomeCwd(drone));
      const target = path.resolve(String(targetPathRaw ?? '').trim());
      const rel = path.relative(root, target);
      if (!rel) return '.';
      if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
      return rel.split(path.sep).join('/');
    }

    const root = normalizeContainerPath(
      String(rootPathRaw ?? '').trim() || defaultDroneHomeCwd(drone),
    );
    const target = normalizeContainerPath(String(targetPathRaw ?? '').trim());
    const rel = path.posix.relative(root, target);
    if (!rel) return '.';
    if (rel === '..' || rel.startsWith('../') || path.posix.isAbsolute(rel)) return null;
    return rel;
  }

  function withAssistantRelativePath<T extends { path: string }>(
    drone: any,
    item: T,
    rootPath?: unknown,
  ): T & { relativePath: string | null } {
    return {
      ...item,
      relativePath: assistantRelativePathForDrone(drone, item.path, rootPath),
    };
  }

  async function resolveAssistantDroneFsTarget(opts: {
    droneId: string;
    path?: unknown;
    fallbackToHome?: boolean;
  }): Promise<{ id: string; drone: any; name: string; runtime: DroneRuntime; targetPath: string }> {
    const ref = String(opts.droneId ?? '').trim();
    if (!ref) throw new Error('missing droneId');
    let resolvedError = '';
    const resolved = await resolveDroneFromRegistryRef(ref, {
      onStillStarting: () => {
        resolvedError = `drone "${ref}" is still starting`;
      },
      onUnknown: () => {
        resolvedError = `unknown drone: ${ref}`;
      },
    });
    if (!resolved) throw new Error(resolvedError || `unknown drone: ${ref}`);
    const targetPath = normalizeAssistantFsPathForRuntime(resolved.drone, opts.path ?? '', {
      fallbackToHome: opts.fallbackToHome,
    });
    const name = String(resolved.drone?.name ?? resolved.id).trim() || resolved.id;
    return {
      id: resolved.id,
      drone: resolved.drone,
      name,
      runtime: droneRuntime(resolved.drone),
      targetPath,
    };
  }

  async function assistantStatDronePath(opts: { droneId: string; path: string }): Promise<any> {
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: false,
    });
    if (!target.targetPath || target.targetPath === '/') throw new Error('missing path');
    if (target.runtime === 'host') {
      const resolvedPath = path.resolve(target.targetPath);
      try {
        const st = await fs.lstat(resolvedPath);
        return {
          droneId: target.id,
          path: resolvedPath,
          exists: true,
          kind: st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other',
          size: Number.isFinite(st.size) ? Math.max(0, Math.floor(st.size)) : null,
          mtimeMs: Number.isFinite(st.mtimeMs) ? Math.max(0, Math.floor(st.mtimeMs)) : null,
        };
      } catch (e: any) {
        const code = String(e?.code ?? '')
          .trim()
          .toUpperCase();
        if (code === 'ENOENT' || code === 'ENOTDIR')
          return { droneId: target.id, path: resolvedPath, exists: false };
        throw e;
      }
    }

    const script = [
      'set -euo pipefail',
      `target=${bashQuote(target.targetPath)}`,
      'if [ ! -e "$target" ]; then echo "__MISSING__"; exit 0; fi',
      'kind=o',
      'if [ -d "$target" ]; then kind=d; elif [ -f "$target" ]; then kind=f; fi',
      'size=$(stat -c %s -- "$target" 2>/dev/null || echo 0)',
      'mtime=$(stat -c %Y -- "$target" 2>/dev/null || echo 0)',
      'printf "__META__\t%s\t%s\t%s\n" "$kind" "$size" "$mtime"',
    ].join('\n');
    const r = await withReadonlyDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) => {
        return await runContainerCommand(droneEntry, 'bash', ['-lc', script]);
      },
    );
    if (r.code !== 0)
      throw new Error((r.stderr || r.stdout || 'failed reading path metadata').trim());
    const stdout = String(r.stdout ?? '').trim();
    if (stdout === '__MISSING__')
      return { droneId: target.id, path: target.targetPath, exists: false };
    const meta = stdout.split('\t');
    if (meta.length < 4 || meta[0] !== '__META__') throw new Error('path metadata missing');
    const sizeNum = Number(meta[2] ?? 0);
    const mtimeSec = Number(meta[3] ?? 0);
    return {
      droneId: target.id,
      path: target.targetPath,
      exists: true,
      kind: meta[1] === 'd' ? 'directory' : meta[1] === 'f' ? 'file' : 'other',
      size: Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : null,
      mtimeMs: Number.isFinite(mtimeSec) ? Math.max(0, Math.floor(mtimeSec * 1000)) : null,
    };
  }

  async function assistantListDroneFiles(opts: { droneId: string; path?: string }): Promise<any> {
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: true,
    });
    if (target.runtime === 'host') {
      const parsed = await listHostFsDirectory(target.targetPath);
      return {
        droneId: target.id,
        path: parsed.resolvedPath,
        relativePath: assistantRelativePathForDrone(target.drone, parsed.resolvedPath),
        entries: parsed.entries.map((entry) => withAssistantRelativePath(target.drone, entry)),
      };
    }

    const script = buildContainerFsListScript(target.targetPath, NON_REPO_HOME_CWD, false);
    const r = await withReadonlyDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) => {
        return await runContainerCommand(droneEntry, 'bash', ['-lc', script], {
          timeoutMs: FS_LIST_TIMEOUT_MS,
        });
      },
    );
    if (r.code !== 0) {
      const out = `${r.stdout || ''}\n${r.stderr || ''}`;
      if (/\bnot-dir\b/i.test(out))
        throw new Error(`path is not a directory: ${target.targetPath}`);
      throw new Error((r.stderr || r.stdout || 'failed to list files').trim());
    }
    const parsed = parseContainerFsListOutput(r.stdout || '');
    return {
      droneId: target.id,
      path: parsed.resolvedPath,
      relativePath: assistantRelativePathForDrone(target.drone, parsed.resolvedPath),
      entries: parsed.entries.map((entry) => withAssistantRelativePath(target.drone, entry)),
    };
  }

  async function assistantReadDroneFile(opts: {
    droneId: string;
    path: string;
    startLine?: number;
    endLine?: number;
  }): Promise<any> {
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: false,
    });
    if (!target.targetPath || target.targetPath === '/') throw new Error('missing file path');
    if (target.runtime === 'host') {
      const read = await readHostFileBytes({
        targetPath: target.targetPath,
        maxBytes: FS_EDITOR_MAX_BYTES,
      });
      ensureAssistantTextFile(target.targetPath, read.buf, read.mime);
      const ranged = applyAssistantReadLineRange(read.buf.toString('utf8'), opts);
      return {
        droneId: target.id,
        path: path.resolve(target.targetPath),
        relativePath: assistantRelativePathForDrone(target.drone, target.targetPath),
        kind: 'text',
        content: ranged.content,
        size: read.size,
        mtimeMs: read.mtimeMs,
        ...(ranged.lineRange ? { lineRange: ranged.lineRange } : {}),
      };
    }

    const read = await withReadonlyDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) =>
        await workspaceReadFile(daemonClientForDrone(droneEntry), target.targetPath),
    );
    ensureAssistantTextFile(target.targetPath, read.data, null);
    const ranged = applyAssistantReadLineRange(read.data.toString('utf8'), opts);
    return {
      droneId: target.id,
      path: target.targetPath,
      relativePath: assistantRelativePathForDrone(target.drone, target.targetPath),
      kind: 'text',
      content: ranged.content,
      size: read.size,
      mtimeMs: read.mtimeMs,
      ...(ranged.lineRange ? { lineRange: ranged.lineRange } : {}),
    };
  }

  // Bounded local workspace-engine I/O. Remote adapters stream binary HTTP bodies;
  // this buffer size does not impose network chunk requests or a wire limit.
  const ASSISTANT_TRANSFER_CHUNK_BYTES = 128 * 1024;

  function assistantTransferId(raw: unknown): string {
    const value = String(raw ?? '').trim();
    if (!/^[a-zA-Z0-9_-]{1,220}$/.test(value)) throw new Error('invalid transfer id');
    return value;
  }

  function assistantTransferTempPath(
    runtime: DroneRuntime,
    targetPath: string,
    id: string,
  ): string {
    const parent = runtime === 'host' ? path.dirname(targetPath) : path.posix.dirname(targetPath);
    return runtime === 'host'
      ? path.join(parent, `.blip-transfer-${id}.part`)
      : path.posix.join(parent, `.blip-transfer-${id}.part`);
  }

  async function assistantReadDroneFileChunk(opts: {
    droneId: string;
    path: string;
    offset: number;
    length: number;
  }): Promise<{ dataBase64: string; bytes: number }> {
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: false,
    });
    const offset = Math.max(0, Math.floor(Number(opts.offset)));
    const length = Math.max(
      1,
      Math.min(ASSISTANT_TRANSFER_CHUNK_BYTES, Math.floor(Number(opts.length))),
    );
    if (!Number.isFinite(offset) || !Number.isFinite(length))
      throw new Error('invalid transfer range');
    if (target.runtime === 'host') {
      const handle = await fs.open(target.targetPath, 'r');
      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return { dataBase64: buffer.subarray(0, bytesRead).toString('base64'), bytes: bytesRead };
      } finally {
        await handle.close();
      }
    }
    const data = await withReadonlyDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) =>
        await workspaceReadChunk(daemonClientForDrone(droneEntry), {
          path: target.targetPath,
          offset,
          length,
        }),
    );
    return { dataBase64: data.toString('base64'), bytes: data.length };
  }

  async function assistantCreateDroneTransferDirectory(opts: {
    droneId: string;
    path: string;
  }): Promise<void> {
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: false,
    });
    if (target.runtime === 'host') {
      await fs.mkdir(target.targetPath, { recursive: true });
      return;
    }
    const result = await withLockedDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) =>
        await runContainerCommand(droneEntry, 'bash', [
          '-lc',
          `mkdir -p -- ${bashQuote(target.targetPath)}`,
        ]),
    );
    if (result.code !== 0)
      throw new Error(
        (result.stderr || result.stdout || 'failed creating transfer directory').trim(),
      );
  }

  async function assistantPrepareDroneTransferFile(opts: {
    droneId: string;
    path: string;
    transferId: string;
    size: number;
    overwrite: boolean;
  }): Promise<{ offset: number }> {
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: false,
    });
    const id = assistantTransferId(opts.transferId);
    const size = Math.max(0, Math.floor(Number(opts.size)));
    if (!Number.isFinite(size)) throw new Error('invalid transfer size');
    const temp = assistantTransferTempPath(target.runtime, target.targetPath, id);
    if (target.runtime === 'host') {
      const existing = await fs
        .stat(target.targetPath)
        .catch((error: any) => (error?.code === 'ENOENT' ? null : Promise.reject(error)));
      if (existing && !existing.isFile())
        throw Object.assign(new Error('destination path is not a file'), {
          code: 'INVALID_REQUEST',
        });
      if (existing && !opts.overwrite)
        throw Object.assign(new Error('destination file already exists'), { code: 'FILE_EXISTS' });
      await fs.mkdir(path.dirname(target.targetPath), { recursive: true });
      let partial = await fs
        .lstat(temp)
        .catch((error: any) => (error?.code === 'ENOENT' ? null : Promise.reject(error)));
      if (partial && (!partial.isFile() || partial.size > size)) {
        await fs.rm(temp, { force: true });
        partial = null;
      }
      if (!partial) {
        const handle = await fs.open(temp, 'wx');
        await handle.close();
      }
      return { offset: partial?.size ?? 0 };
    }
    const script = [
      'set -euo pipefail',
      `target=${bashQuote(target.targetPath)}`,
      `temp=${bashQuote(temp)}`,
      `size=${size}`,
      '[ ! -e "$target" ] || [ -f "$target" ] || { echo "__TYPE__"; exit 5; }',
      opts.overwrite ? ':' : '[ ! -e "$target" ] || { echo "__EXISTS__"; exit 5; }',
      'mkdir -p -- "$(dirname -- "$target")"',
      'if { [ -e "$temp" ] || [ -L "$temp" ]; } && { [ -L "$temp" ] || [ ! -f "$temp" ] || [ "$(stat -c %s -- "$temp")" -gt "$size" ]; }; then rm -f -- "$temp"; fi',
      'if [ ! -e "$temp" ] && [ ! -L "$temp" ]; then (set -o noclobber; : > "$temp"); fi',
      '[ ! -L "$temp" ] && [ -f "$temp" ] || { echo "invalid transfer temporary path" >&2; exit 7; }',
      'stat -c %s -- "$temp"',
    ].join('\n');
    const result = await withLockedDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) => await runContainerCommand(droneEntry, 'bash', ['-lc', script]),
    );
    if (result.code !== 0) {
      if (String(result.stdout).includes('__TYPE__'))
        throw Object.assign(new Error('destination path is not a file'), {
          code: 'INVALID_REQUEST',
        });
      if (String(result.stdout).includes('__EXISTS__'))
        throw Object.assign(new Error('destination file already exists'), { code: 'FILE_EXISTS' });
      throw new Error((result.stderr || result.stdout || 'failed preparing transfer').trim());
    }
    return { offset: Math.max(0, Number(String(result.stdout).trim()) || 0) };
  }

  async function assistantWriteDroneTransferChunk(opts: {
    droneId: string;
    path: string;
    transferId: string;
    offset: number;
    dataBase64: string;
  }): Promise<{ offset: number }> {
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: false,
    });
    const id = assistantTransferId(opts.transferId);
    const offset = Math.max(0, Math.floor(Number(opts.offset)));
    const data = Buffer.from(String(opts.dataBase64 ?? ''), 'base64');
    if (!Number.isFinite(offset) || data.length > ASSISTANT_TRANSFER_CHUNK_BYTES)
      throw new Error('invalid transfer chunk');
    const temp = assistantTransferTempPath(target.runtime, target.targetPath, id);
    if (target.runtime === 'host') {
      const tempInfo = await fs.lstat(temp);
      if (!tempInfo.isFile()) throw new Error('transfer temporary path is not a file');
      const handle = await fs.open(temp, 'r+');
      try {
        const info = await handle.stat();
        if (info.size === offset + data.length) {
          const existing = Buffer.alloc(data.length);
          if ((await readTransferBytes(handle, existing, offset)) && existing.equals(data))
            return { offset: info.size };
        }
        if (info.size !== offset)
          throw Object.assign(
            new Error(`transfer offset mismatch: expected ${info.size}, received ${offset}`),
            { code: 'TRANSFER_OFFSET_MISMATCH' },
          );
        await writeTransferBytes(handle, data, offset);
        await handle.sync();
        return { offset: offset + data.length };
      } finally {
        await handle.close();
      }
    }
    return await withLockedDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) =>
        await workspaceWriteChunk(daemonClientForDrone(droneEntry), { path: temp, offset, data }),
    );
  }

  async function assistantCommitDroneTransferFile(opts: {
    droneId: string;
    path: string;
    transferId: string;
    size: number;
    overwrite: boolean;
  }): Promise<void> {
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: false,
    });
    const temp = assistantTransferTempPath(
      target.runtime,
      target.targetPath,
      assistantTransferId(opts.transferId),
    );
    const size = Math.max(0, Math.floor(Number(opts.size)));
    if (target.runtime === 'host') {
      const info = await fs
        .lstat(temp)
        .catch((error: any) => (error?.code === 'ENOENT' ? null : Promise.reject(error)));
      if (!info) {
        const committed = await fs.stat(target.targetPath).catch(() => null);
        if (committed?.isFile() && committed.size === size) return;
        throw new Error('transfer temporary file was not found');
      }
      if (!info.isFile()) throw new Error('transfer temporary path is not a file');
      if (info.size !== size) throw new Error('transfer is incomplete');
      if (!opts.overwrite && (await fs.stat(target.targetPath).catch(() => null)))
        throw Object.assign(new Error('destination file already exists'), { code: 'FILE_EXISTS' });
      await fs.rename(temp, target.targetPath);
      return;
    }
    const script = [
      'set -euo pipefail',
      `target=${bashQuote(target.targetPath)}`,
      `temp=${bashQuote(temp)}`,
      `size=${size}`,
      'if [ ! -e "$temp" ]; then [ -f "$target" ] && [ "$(stat -c %s -- "$target")" -eq "$size" ] && exit 0; echo "transfer temporary file was not found" >&2; exit 7; fi',
      '[ ! -L "$temp" ] && [ -f "$temp" ] || { echo "invalid transfer temporary path" >&2; exit 7; }',
      '[ "$(stat -c %s -- "$temp")" -eq "$size" ] || { echo "incomplete transfer" >&2; exit 7; }',
      opts.overwrite ? ':' : '[ ! -e "$target" ] || { echo "__EXISTS__"; exit 5; }',
      'mv -f -- "$temp" "$target"',
    ].join('\n');
    const result = await withLockedDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) => await runContainerCommand(droneEntry, 'bash', ['-lc', script]),
    );
    if (result.code !== 0) {
      if (String(result.stdout).includes('__EXISTS__'))
        throw Object.assign(new Error('destination file already exists'), { code: 'FILE_EXISTS' });
      throw new Error((result.stderr || result.stdout || 'failed committing transfer').trim());
    }
  }

  async function assistantAbortDroneTransferFile(opts: {
    droneId: string;
    path: string;
    transferId: string;
  }): Promise<void> {
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: false,
    });
    const temp = assistantTransferTempPath(
      target.runtime,
      target.targetPath,
      assistantTransferId(opts.transferId),
    );
    if (target.runtime === 'host') {
      await fs.rm(temp, { force: true });
      return;
    }
    await withLockedDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) => {
        await runContainerCommand(droneEntry, 'bash', ['-lc', `rm -f -- ${bashQuote(temp)}`]);
      },
    );
  }

  async function assistantWriteDroneFile(opts: {
    droneId: string;
    path: string;
    content: string;
  }): Promise<any> {
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: false,
    });
    if (!target.targetPath || target.targetPath === '/') throw new Error('missing file path');
    const content = String(opts.content ?? '');
    const nextBytes = Buffer.byteLength(content, 'utf8');
    if (nextBytes > FS_EDITOR_MAX_BYTES)
      throw new Error(`file too large (${nextBytes} bytes, max ${FS_EDITOR_MAX_BYTES})`);

    if (target.runtime === 'host') {
      const resolvedPath = path.resolve(target.targetPath);
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.writeFile(resolvedPath, content, 'utf8');
      const after = await fs.stat(resolvedPath);
      return {
        droneId: target.id,
        path: resolvedPath,
        relativePath: assistantRelativePathForDrone(target.drone, resolvedPath),
        size: Number.isFinite(after.size) ? Math.max(0, Math.floor(after.size)) : 0,
        mtimeMs: Number.isFinite(after.mtimeMs) ? Math.max(0, Math.floor(after.mtimeMs)) : null,
      };
    }

    const written = await withLockedDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) =>
        await workspaceWriteFile(
          daemonClientForDrone(droneEntry),
          target.targetPath,
          Buffer.from(content, 'utf8'),
        ),
    );
    return {
      droneId: target.id,
      path: target.targetPath,
      relativePath: assistantRelativePathForDrone(target.drone, target.targetPath),
      size: written.size,
      mtimeMs: written.mtimeMs,
    };
  }

  async function assistantBatchDroneFiles(opts: {
    droneId: string;
    operations: WorkspaceBatchOperation[];
  }): Promise<void> {
    if (!Array.isArray(opts.operations) || opts.operations.length === 0) return;
    const first = opts.operations[0];
    const firstPath = first.type === 'move' ? first.fromPath : first.path;
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: firstPath,
      fallbackToHome: false,
    });

    if (target.runtime === 'host') {
      for (const operation of opts.operations) {
        if (operation.type === 'move') {
          await assistantMoveDroneFile({
            droneId: opts.droneId,
            fromPath: operation.fromPath,
            toPath: operation.toPath,
          });
        } else if (operation.type === 'write') {
          await assistantWriteDroneFile({
            droneId: opts.droneId,
            path: operation.path,
            content: operation.content,
          });
        } else {
          await assistantDeleteDroneFile({ droneId: opts.droneId, path: operation.path });
        }
      }
      return;
    }

    const normalized: WorkspaceBatchOperation[] = [];
    for (const operation of opts.operations) {
      if (operation.type === 'move') {
        const from = await resolveAssistantDroneFsTarget({
          droneId: opts.droneId,
          path: operation.fromPath,
          fallbackToHome: false,
        });
        const to = await resolveAssistantDroneFsTarget({
          droneId: opts.droneId,
          path: operation.toPath,
          fallbackToHome: false,
        });
        normalized.push({ type: 'move', fromPath: from.targetPath, toPath: to.targetPath });
      } else if (operation.type === 'write') {
        const resolved = await resolveAssistantDroneFsTarget({
          droneId: opts.droneId,
          path: operation.path,
          fallbackToHome: false,
        });
        normalized.push({ type: 'write', path: resolved.targetPath, content: operation.content });
      } else {
        const resolved = await resolveAssistantDroneFsTarget({
          droneId: opts.droneId,
          path: operation.path,
          fallbackToHome: false,
        });
        normalized.push({ type: 'delete', path: resolved.targetPath });
      }
    }

    await withLockedDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) => await workspaceBatch(daemonClientForDrone(droneEntry), normalized),
    );
  }

  async function assistantDeleteDroneFile(opts: { droneId: string; path: string }): Promise<any> {
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: false,
    });
    if (!target.targetPath || target.targetPath === '/') throw new Error('missing file path');
    if (target.runtime === 'host') {
      const resolvedPath = path.resolve(target.targetPath);
      const st = await fs.stat(resolvedPath);
      if (!st.isFile()) throw new Error(`file not found: ${resolvedPath}`);
      await fs.rm(resolvedPath);
      return { droneId: target.id, path: resolvedPath, deleted: true };
    }
    const script = [
      'set -euo pipefail',
      `target=${bashQuote(target.targetPath)}`,
      'if [ ! -f "$target" ]; then echo "__ERR__\tnot-file"; exit 3; fi',
      'rm -- "$target"',
    ].join('\n');
    const r = await withLockedDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) => {
        return await runContainerCommand(droneEntry, 'bash', ['-lc', script]);
      },
    );
    if (r.code !== 0) {
      const out = `${r.stdout || ''}\n${r.stderr || ''}`;
      if (/__ERR__\s+not-file\b/i.test(out))
        throw new Error(`file not found: ${target.targetPath}`);
      throw new Error((r.stderr || r.stdout || 'failed deleting file').trim());
    }
    return { droneId: target.id, path: target.targetPath, deleted: true };
  }

  async function assistantCreateDroneDirectory(opts: {
    droneId: string;
    path: string;
    recursive?: boolean;
  }): Promise<any> {
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: false,
    });
    if (!target.targetPath || target.targetPath === '/') throw new Error('missing directory path');
    if (target.runtime === 'host') {
      const resolvedPath = path.resolve(target.targetPath);
      await fs.mkdir(resolvedPath, { recursive: opts.recursive === true });
      return { droneId: target.id, path: resolvedPath, recursive: opts.recursive === true };
    }
    const command = opts.recursive === true ? 'mkdir -p -- "$target"' : 'mkdir -- "$target"';
    const script = ['set -euo pipefail', `target=${bashQuote(target.targetPath)}`, command].join(
      '\n',
    );
    const result = await withLockedDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) => runContainerCommand(droneEntry, 'bash', ['-lc', script]),
    );
    if (result.code !== 0)
      throw new Error((result.stderr || result.stdout || 'failed creating directory').trim());
    return { droneId: target.id, path: target.targetPath, recursive: opts.recursive === true };
  }

  async function assistantDeleteDroneDirectory(opts: {
    droneId: string;
    path: string;
    recursive?: boolean;
  }): Promise<any> {
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: false,
    });
    if (!target.targetPath || target.targetPath === '/') throw new Error('missing directory path');
    if (target.runtime === 'host') {
      const resolvedPath = path.resolve(target.targetPath);
      const info = await fs.stat(resolvedPath);
      if (!info.isDirectory()) throw new Error(`path is not a directory: ${resolvedPath}`);
      await fs.rm(resolvedPath, { recursive: opts.recursive === true });
      return {
        droneId: target.id,
        path: resolvedPath,
        deleted: true,
        recursive: opts.recursive === true,
      };
    }
    const command = opts.recursive === true ? 'rm -r -- "$target"' : 'rmdir -- "$target"';
    const script = [
      'set -euo pipefail',
      `target=${bashQuote(target.targetPath)}`,
      'if [ ! -d "$target" ]; then echo "__ERR__\\tnot-directory"; exit 3; fi',
      command,
    ].join('\n');
    const result = await withLockedDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) => runContainerCommand(droneEntry, 'bash', ['-lc', script]),
    );
    if (result.code !== 0) {
      const output = `${result.stdout || ''}\n${result.stderr || ''}`;
      if (/__ERR__\s+not-directory\b/i.test(output))
        throw new Error(`path is not a directory: ${target.targetPath}`);
      throw new Error((result.stderr || result.stdout || 'failed deleting directory').trim());
    }
    return {
      droneId: target.id,
      path: target.targetPath,
      deleted: true,
      recursive: opts.recursive === true,
    };
  }

  async function assistantMoveDroneFile(opts: {
    droneId: string;
    fromPath: string;
    toPath: string;
  }): Promise<any> {
    const from = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.fromPath,
      fallbackToHome: false,
    });
    const to = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.toPath,
      fallbackToHome: false,
    });
    if (!from.targetPath || from.targetPath === '/' || !to.targetPath || to.targetPath === '/')
      throw new Error('missing file path');
    if (from.runtime === 'host') {
      const fromPath = path.resolve(from.targetPath);
      const toPath = path.resolve(to.targetPath);
      await fs.mkdir(path.dirname(toPath), { recursive: true });
      await fs.rename(fromPath, toPath);
      return { droneId: from.id, path: fromPath, movedTo: toPath };
    }
    const script = [
      'set -euo pipefail',
      `from_path=${bashQuote(from.targetPath)}`,
      `to_path=${bashQuote(to.targetPath)}`,
      'if [ ! -f "$from_path" ]; then echo "__ERR__\tnot-file"; exit 3; fi',
      'mkdir -p "$(dirname -- "$to_path")"',
      'mv -- "$from_path" "$to_path"',
    ].join('\n');
    const r = await withLockedDroneContainer(
      { requestedDroneName: from.name, droneEntry: from.drone },
      async ({ droneEntry }) => {
        return await runContainerCommand(droneEntry, 'bash', ['-lc', script]);
      },
    );
    if (r.code !== 0) {
      const out = `${r.stdout || ''}\n${r.stderr || ''}`;
      if (/__ERR__\s+not-file\b/i.test(out)) throw new Error(`file not found: ${from.targetPath}`);
      throw new Error((r.stderr || r.stdout || 'failed moving file').trim());
    }
    return { droneId: from.id, path: from.targetPath, movedTo: to.targetPath };
  }

  async function assistantMoveDronePath(opts: {
    droneId: string;
    fromPath: string;
    toPath: string;
    overwrite?: boolean;
  }): Promise<any> {
    const from = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.fromPath,
      fallbackToHome: false,
    });
    const to = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.toPath,
      fallbackToHome: false,
    });
    if (!from.targetPath || from.targetPath === '/' || !to.targetPath || to.targetPath === '/')
      throw new Error('missing path');
    if (from.runtime === 'host') {
      const fromPath = path.resolve(from.targetPath);
      const toPath = path.resolve(to.targetPath);
      await fs.stat(fromPath);
      try {
        await fs.stat(toPath);
        if (!opts.overwrite) throw new Error(`destination exists: ${toPath}`);
        await fs.rm(toPath, { recursive: true, force: true });
      } catch (error: any) {
        if (String(error?.code ?? '') !== 'ENOENT') throw error;
      }
      await fs.mkdir(path.dirname(toPath), { recursive: true });
      await fs.rename(fromPath, toPath);
      return { droneId: from.id, path: fromPath, movedTo: toPath };
    }
    const script = [
      'set -euo pipefail',
      `from_path=${bashQuote(from.targetPath)}`,
      `to_path=${bashQuote(to.targetPath)}`,
      `overwrite=${opts.overwrite === true ? '1' : '0'}`,
      'if [ ! -e "$from_path" ]; then echo "__ERR__\\tmissing-source"; exit 3; fi',
      'if [ -e "$to_path" ]; then if [ "$overwrite" = "1" ]; then rm -rf -- "$to_path"; else echo "__ERR__\\tdestination-exists"; exit 4; fi; fi',
      'mkdir -p "$(dirname -- "$to_path")"',
      'mv -- "$from_path" "$to_path"',
    ].join('\n');
    const result = await withLockedDroneContainer(
      { requestedDroneName: from.name, droneEntry: from.drone },
      async ({ droneEntry }) => runContainerCommand(droneEntry, 'bash', ['-lc', script]),
    );
    if (result.code !== 0) {
      const output = `${result.stdout || ''}\n${result.stderr || ''}`;
      if (/__ERR__\s+missing-source\b/i.test(output))
        throw new Error(`path not found: ${from.targetPath}`);
      if (/__ERR__\s+destination-exists\b/i.test(output))
        throw new Error(`destination exists: ${to.targetPath}`);
      throw new Error((result.stderr || result.stdout || 'failed moving path').trim());
    }
    return { droneId: from.id, path: from.targetPath, movedTo: to.targetPath };
  }

  async function assistantSearchDroneFiles(opts: {
    droneId: string;
    path?: string;
    query: string;
    limit?: number;
    contextBefore?: number;
    contextAfter?: number;
  }): Promise<any> {
    const query = String(opts.query ?? '').trim();
    if (!query) throw new Error('missing query');
    const limit = Number.isFinite(Number(opts.limit))
      ? Math.max(1, Math.min(100, Math.floor(Number(opts.limit))))
      : 20;
    const contextBefore = normalizeAssistantSearchContext(opts.contextBefore, 'contextBefore');
    const contextAfter = normalizeAssistantSearchContext(opts.contextAfter, 'contextAfter');
    const scanLimit = limit + 1;
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: true,
    });
    const script =
      contextBefore > 0 || contextAfter > 0
        ? [
            'set -euo pipefail',
            `root=${bashQuote(target.targetPath)}`,
            `query=${bashQuote(query)}`,
            `limit=${String(scanLimit)}`,
            `before=${String(contextBefore)}`,
            `after=${String(contextAfter)}`,
            'if [ ! -e "$root" ]; then echo "__ERR__\tnot-found"; exit 3; fi',
            'if command -v rg >/dev/null 2>&1; then',
            '  search_cmd() { rg -n -I --hidden --glob "!node_modules/**" --glob "!.git/**" -- "$query" "$root" || true; }',
            'else',
            '  search_cmd() { grep -RInI --exclude-dir=.git --exclude-dir=node_modules -- "$query" "$root" 2>/dev/null || true; }',
            'fi',
            'match_id=0',
            'search_cmd | head -n "$limit" | while IFS= read -r hit; do',
            '  [ -n "$hit" ] || continue',
            '  file=${hit%%:*}',
            '  rest=${hit#*:}',
            '  line_no=${rest%%:*}',
            '  match_text=${rest#*:}',
            '  case "$line_no" in ""|*[!0-9]*) continue ;; esac',
            '  [ -f "$file" ] || continue',
            '  start=$((line_no - before))',
            '  if [ "$start" -lt 1 ]; then start=1; fi',
            '  end=$((line_no + after))',
            '  file_b64=$(printf "%s" "$file" | base64 | tr -d "\\n")',
            '  match_b64=$(printf "%s" "$match_text" | base64 | tr -d "\\n")',
            '  match_id=$((match_id + 1))',
            '  printf "__MATCH__\\t%s\\t%s\\t%s\\t%s\\n" "$match_id" "$file_b64" "$line_no" "$match_b64"',
            '  current=$start',
            '  sed -n "${start},${end}p" "$file" | while IFS= read -r context_text || [ -n "$context_text" ]; do',
            '    kind=match',
            '    if [ "$current" -lt "$line_no" ]; then kind=before; fi',
            '    if [ "$current" -gt "$line_no" ]; then kind=after; fi',
            '    context_b64=$(printf "%s" "$context_text" | base64 | tr -d "\\n")',
            '    printf "__CONTEXT__\\t%s\\t%s\\t%s\\t%s\\t%s\\n" "$match_id" "$file_b64" "$current" "$kind" "$context_b64"',
            '    current=$((current + 1))',
            '  done',
            'done',
          ].join('\n')
        : [
            'set -euo pipefail',
            `root=${bashQuote(target.targetPath)}`,
            `query=${bashQuote(query)}`,
            `limit=${String(scanLimit)}`,
            'if [ ! -e "$root" ]; then echo "__ERR__\tnot-found"; exit 3; fi',
            'if command -v rg >/dev/null 2>&1; then',
            '  rg -n -I --hidden --glob "!node_modules/**" --glob "!.git/**" -- "$query" "$root" | head -n "$limit" || true',
            'else',
            '  grep -RInI --exclude-dir=.git --exclude-dir=node_modules -- "$query" "$root" 2>/dev/null | head -n "$limit" || true',
            'fi',
          ].join('\n');
    const r =
      target.runtime === 'host'
        ? await runHostCommand('bash', ['-lc', script], { timeoutMs: 10_000 })
        : await withReadonlyDroneContainer(
            { requestedDroneName: target.name, droneEntry: target.drone },
            async ({ droneEntry }) => {
              return await runContainerCommand(droneEntry, 'bash', ['-lc', script]);
            },
          );
    if (r.code !== 0) {
      const out = `${r.stdout || ''}\n${r.stderr || ''}`;
      if (/__ERR__\s+not-found\b/i.test(out))
        throw new Error(`path not found: ${target.targetPath}`);
      throw new Error((r.stderr || r.stdout || 'failed searching files').trim());
    }
    const parsedMatches =
      contextBefore > 0 || contextAfter > 0
        ? parseAssistantSearchContextOutput(r.stdout || '', limit)
        : parseAssistantSearchOutput(r.stdout || '', limit);
    const rawMatchCount =
      contextBefore > 0 || contextAfter > 0
        ? String(r.stdout || '')
            .split('\n')
            .filter((line) => line.startsWith('__MATCH__\t')).length
        : String(r.stdout || '')
            .split('\n')
            .filter(Boolean).length;
    const matches = parsedMatches.map((match) => withAssistantRelativePath(target.drone, match));
    return {
      droneId: target.id,
      path: target.targetPath,
      relativePath: assistantRelativePathForDrone(target.drone, target.targetPath),
      query,
      limit,
      ...(contextBefore > 0 || contextAfter > 0 ? { contextBefore, contextAfter } : {}),
      caps: {
        limit,
        maxContextBefore: ASSISTANT_SEARCH_MAX_CONTEXT_LINES,
        maxContextAfter: ASSISTANT_SEARCH_MAX_CONTEXT_LINES,
      },
      truncated: rawMatchCount > limit,
      matches,
    };
  }

  async function assistantFindDroneFiles(opts: {
    droneId: string;
    path?: string;
    pattern?: string;
    limit?: number;
  }): Promise<any> {
    const pattern = String(opts.pattern ?? '*').trim() || '*';
    const limit = Number.isFinite(Number(opts.limit))
      ? Math.max(1, Math.min(500, Math.floor(Number(opts.limit))))
      : 100;
    const scanLimit = limit + 1;
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.path,
      fallbackToHome: true,
    });
    const script = [
      'set -euo pipefail',
      `root=${bashQuote(target.targetPath)}`,
      `pattern=${bashQuote(pattern)}`,
      `limit=${String(scanLimit)}`,
      'if [ ! -d "$root" ]; then echo "__ERR__\tnot-dir"; exit 3; fi',
      'case "$pattern" in',
      '  *"*"*|*"?"*|*"["*) effective="$pattern" ;;',
      '  *) effective="*$pattern*" ;;',
      'esac',
      'if [ "$pattern" = "*" ]; then effective="*"; fi',
      'find "$root" \\( -path "*/.git" -o -path "*/node_modules" \\) -prune -o \\( -name "$effective" -o -path "$root/$effective" \\) -print | head -n "$limit" | while IFS= read -r p; do',
      '  [ -e "$p" ] || continue',
      '  kind=o',
      '  if [ -d "$p" ]; then kind=d; elif [ -f "$p" ]; then kind=f; fi',
      '  size=$(stat -c %s -- "$p" 2>/dev/null || echo 0)',
      '  mtime=$(stat -c %Y -- "$p" 2>/dev/null || echo 0)',
      '  printf "%s\t%s\t%s\t%s\n" "$p" "$kind" "$size" "$mtime"',
      'done',
    ].join('\n');
    const r =
      target.runtime === 'host'
        ? await runHostCommand('bash', ['-lc', script], { timeoutMs: 10_000 })
        : await withReadonlyDroneContainer(
            { requestedDroneName: target.name, droneEntry: target.drone },
            async ({ droneEntry }) => {
              return await runContainerCommand(droneEntry, 'bash', ['-lc', script]);
            },
          );
    if (r.code !== 0) {
      const out = `${r.stdout || ''}\n${r.stderr || ''}`;
      if (/__ERR__\s+not-dir\b/i.test(out))
        throw new Error(`path is not a directory: ${target.targetPath}`);
      throw new Error((r.stderr || r.stdout || 'failed finding files').trim());
    }
    return {
      droneId: target.id,
      path: target.targetPath,
      relativePath: assistantRelativePathForDrone(target.drone, target.targetPath),
      pattern,
      limit,
      truncated:
        String(r.stdout || '')
          .split('\n')
          .filter(Boolean).length > limit,
      matches: parseAssistantFindOutput(r.stdout || '', limit).map((entry) =>
        withAssistantRelativePath(target.drone, entry),
      ),
    };
  }

  function assistantChangedFileStatus(entry: any): string {
    if (entry?.isConflicted) return 'conflicted';
    if (entry?.isUntracked) return 'untracked';
    const status = entry?.stagedType ?? entry?.unstagedType;
    return status == null ? 'unknown' : String(status);
  }

  function assistantChangedFilePathForRuntime(
    drone: any,
    repoRoot: string,
    relativePath: string,
  ): string {
    if (droneRuntime(drone) === 'host') return path.resolve(repoRoot, relativePath);
    return normalizeContainerPath(path.posix.join(repoRoot, relativePath));
  }

  function formatAssistantChangedFilesResult(opts: {
    droneId: string;
    drone: any;
    repoRoot: string;
    summary: any;
  }): any {
    const entries = Array.isArray(opts.summary?.entries) ? opts.summary.entries : [];
    const allFiles = entries.map((entry: any) => {
      const relativePath = String(entry?.path ?? '').trim();
      const originalRelativePath = String(entry?.originalPath ?? '').trim() || null;
      return {
        path: assistantChangedFilePathForRuntime(opts.drone, opts.repoRoot, relativePath),
        relativePath,
        ...(originalRelativePath
          ? {
              originalPath: assistantChangedFilePathForRuntime(
                opts.drone,
                opts.repoRoot,
                originalRelativePath,
              ),
              originalRelativePath,
            }
          : {}),
        status: assistantChangedFileStatus(entry),
        staged: Boolean(
          entry?.stagedChar &&
          entry.stagedChar !== '.' &&
          entry.stagedChar !== '?' &&
          entry.stagedChar !== '!',
        ),
        unstaged: Boolean(
          entry?.unstagedChar && entry.unstagedChar !== '.' && entry.unstagedChar !== '!',
        ),
        untracked: Boolean(entry?.isUntracked),
        conflicted: Boolean(entry?.isConflicted),
        stagedStatus: entry?.stagedType ?? null,
        unstagedStatus: entry?.unstagedType ?? null,
        stagedChar: String(entry?.stagedChar ?? '.'),
        unstagedChar: String(entry?.unstagedChar ?? '.'),
      };
    });
    const files = allFiles.slice(0, ASSISTANT_CHANGED_FILES_LIMIT);
    return {
      droneId: opts.droneId,
      repoRoot: opts.repoRoot,
      files,
      counts: opts.summary?.counts ?? {
        changed: entries.length,
        staged: allFiles.filter((file: any) => file.staged).length,
        unstaged: allFiles.filter((file: any) => file.unstaged).length,
        untracked: allFiles.filter((file: any) => file.untracked).length,
        conflicted: allFiles.filter((file: any) => file.conflicted).length,
      },
      limit: ASSISTANT_CHANGED_FILES_LIMIT,
      truncated: entries.length > ASSISTANT_CHANGED_FILES_LIMIT,
    };
  }

  async function assistantListDroneChangedFiles(opts: { droneId: string }): Promise<any> {
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      fallbackToHome: true,
    });
    if (!isRepoAttachedDrone(target.drone))
      throw new Error(`drone is not repo-attached: ${target.name}`);

    if (target.runtime === 'host') {
      const repoPathRaw = String(target.drone?.repoPath ?? '').trim();
      if (!repoPathRaw) throw new Error(`drone has no host repo path: ${target.name}`);
      const repoRoot = await gitTopLevel(repoPathRaw);
      const summary = await gitRepoChangesSummary(repoRoot);
      return formatAssistantChangedFilesResult({
        droneId: target.id,
        drone: target.drone,
        repoRoot,
        summary,
      });
    }

    const repoPathInContainer = droneRepoPathInContainer(target.drone);
    const result = await withReadonlyDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) => {
        return await droneRepoChangesSummary({
          container: target.name,
          repoPathInContainer,
          runGit: createDroneDaemonGitRunner(droneEntry),
          hashWorktreeFiles: createDroneDaemonWorktreeHasher(droneEntry),
        });
      },
    );
    return formatAssistantChangedFilesResult({
      droneId: target.id,
      drone: target.drone,
      repoRoot: result.repoRoot,
      summary: result.summary,
    });
  }

  async function assistantRunDroneBash(opts: {
    droneId: string;
    command: string;
    cwd?: string;
    timeoutMs?: number;
  }): Promise<any> {
    const command = String(opts.command ?? '');
    if (!command.trim()) throw new Error('missing command');
    const commandBytes = Buffer.byteLength(command, 'utf8');
    if (commandBytes > ASSISTANT_BASH_MAX_COMMAND_BYTES) {
      throw new Error(
        `command too large (${commandBytes} bytes, max ${ASSISTANT_BASH_MAX_COMMAND_BYTES})`,
      );
    }
    const timeoutMs = clampAssistantBashTimeoutMs(opts.timeoutMs);
    const target = await resolveAssistantDroneFsTarget({
      droneId: opts.droneId,
      path: opts.cwd,
      fallbackToHome: true,
    });
    if (target.runtime !== 'container')
      throw new Error('bash is only supported for container drones');

    const script = [
      'set -uo pipefail',
      `cwd=${bashQuote(target.targetPath)}`,
      `cmd=${bashQuote(command)}`,
      `max=${String(ASSISTANT_BASH_MAX_OUTPUT_BYTES)}`,
      `timeout_s=${String(Math.max(1, Math.ceil(timeoutMs / 1000)))}`,
      'if [ ! -d "$cwd" ]; then echo "__ERR__\tnot-dir"; exit 3; fi',
      'cd "$cwd" || exit 3',
      'resolved=$(pwd -P)',
      'tmp=$(mktemp -d "${TMPDIR:-/tmp}/assistant-bash.XXXXXX")',
      'cleanup() { rm -rf "$tmp"; }',
      'trap cleanup EXIT',
      'stdout_file="$tmp/stdout"',
      'stderr_file="$tmp/stderr"',
      'if command -v timeout >/dev/null 2>&1; then',
      '  timeout -k 2s "${timeout_s}s" bash -lc "$cmd" >"$stdout_file" 2>"$stderr_file"',
      '  code=$?',
      'else',
      '  bash -lc "$cmd" >"$stdout_file" 2>"$stderr_file"',
      '  code=$?',
      'fi',
      'stdout_size=$(wc -c < "$stdout_file" | tr -d "[:space:]")',
      'stderr_size=$(wc -c < "$stderr_file" | tr -d "[:space:]")',
      'cwd_b64=$(printf "%s" "$resolved" | base64 | tr -d "\\n")',
      'stdout_b64=$(head -c "$max" "$stdout_file" | base64 | tr -d "\\n")',
      'stderr_b64=$(head -c "$max" "$stderr_file" | base64 | tr -d "\\n")',
      'printf "__META__\t%s\t%s\t%s\t%s\n" "$cwd_b64" "$code" "${stdout_size:-0}" "${stderr_size:-0}"',
      'printf "__STDOUT_B64__\t%s\n" "$stdout_b64"',
      'printf "__STDERR_B64__\t%s\n" "$stderr_b64"',
      'exit 0',
    ].join('\n');
    const r = await withLockedDroneContainer(
      { requestedDroneName: target.name, droneEntry: target.drone },
      async ({ droneEntry }) => {
        return await runContainerCommand(droneEntry, 'bash', ['-lc', script], {
          timeoutMs: timeoutMs + 5000,
        });
      },
    );
    const stdoutRaw = String(r.stdout ?? '');
    const combinedOut = `${stdoutRaw}\n${String(r.stderr ?? '')}`;
    if (r.code === 3 && /__ERR__\s+not-dir\b/i.test(combinedOut))
      throw new Error(`cwd is not a directory: ${target.targetPath}`);
    const lines = stdoutRaw.split('\n');
    const meta = (lines.find((line) => line.startsWith('__META__\t')) ?? '').split('\t');
    const stdoutB64 = (lines.find((line) => line.startsWith('__STDOUT_B64__\t')) ?? '').slice(
      '__STDOUT_B64__\t'.length,
    );
    const stderrB64 = (lines.find((line) => line.startsWith('__STDERR_B64__\t')) ?? '').slice(
      '__STDERR_B64__\t'.length,
    );
    const hasStructuredOutput = meta.length >= 5 && meta[0] === '__META__';
    const cwd = hasStructuredOutput
      ? Buffer.from(meta[1] ?? '', 'base64').toString('utf8') || target.targetPath
      : target.targetPath;
    const code = hasStructuredOutput ? Number(meta[2] ?? 1) : r.code;
    const stdoutSize = hasStructuredOutput
      ? Number(meta[3] ?? 0)
      : Buffer.byteLength(stdoutRaw, 'utf8');
    const stderrSize = hasStructuredOutput
      ? Number(meta[4] ?? 0)
      : Buffer.byteLength(String(r.stderr ?? ''), 'utf8');
    const structuredStdout = hasStructuredOutput
      ? Buffer.from(stdoutB64, 'base64').toString('utf8')
      : stdoutRaw;
    const structuredStderr = hasStructuredOutput
      ? Buffer.from(stderrB64, 'base64').toString('utf8')
      : String(r.stderr ?? '');
    const stdout = truncateUtf8Bytes(structuredStdout, ASSISTANT_BASH_MAX_OUTPUT_BYTES);
    const stderr = truncateUtf8Bytes(structuredStderr, ASSISTANT_BASH_MAX_OUTPUT_BYTES);
    const timedOut =
      code === 124 ||
      code === 137 ||
      r.code === 124 ||
      /Timed out after/i.test(String(r.stderr ?? ''));
    return {
      ok: true,
      droneId: target.id,
      cwd,
      command,
      code: Number.isFinite(code) ? Math.floor(code) : r.code,
      stdout: stdout.text,
      stderr: stderr.text,
      timeoutMs,
      timedOut,
      stdoutTruncated: stdout.truncated || stdoutSize > ASSISTANT_BASH_MAX_OUTPUT_BYTES,
      stderrTruncated: stderr.truncated || stderrSize > ASSISTANT_BASH_MAX_OUTPUT_BYTES,
    };
  }

  return {
    assistantAbortDroneTransferFile,
    assistantBatchDroneFiles,
    assistantCommitDroneTransferFile,
    assistantCreateDroneDirectory,
    assistantCreateDroneTransferDirectory,
    assistantDeleteDroneDirectory,
    assistantDeleteDroneFile,
    assistantFindDroneFiles,
    assistantListDroneChangedFiles,
    assistantListDroneFiles,
    assistantMoveDroneFile,
    assistantMoveDronePath,
    assistantPrepareDroneTransferFile,
    assistantReadDroneFile,
    assistantReadDroneFileChunk,
    assistantRunDroneBash,
    assistantSearchDroneFiles,
    assistantStatDronePath,
    assistantWriteDroneFile,
    assistantWriteDroneTransferChunk,
    readHostFileBytes,
  };
}
