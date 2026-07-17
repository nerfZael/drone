import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { MESH_BINARY_CHUNK_BYTES, WORKSPACE_CAPABILITY } from '@drone/device-protocol';
import type { CapabilityHandler } from '../../device-mesh-types';
import { isAssistantTransferTemporaryName } from '../../../assistant/is-assistant-transfer-temporary-name';
import { CommandJobStore } from './command-job-store';
import { CrossDeviceAssistantPolicyStore } from './policy-store';

const MAX_FILE_BYTES = 192 * 1024;
const MAX_SEARCH_ENTRIES = 5_000;
const MAX_CONTENT_SEARCH_BYTES = 16 * 1024 * 1024;
const MAX_TRANSFER_DIRECTORY_ENTRIES = 500;

async function readTransferBytes(
  handle: FileHandle,
  buffer: Buffer,
  position: number,
): Promise<boolean> {
  let read = 0;
  while (read < buffer.length) {
    const result = await handle.read(buffer, read, buffer.length - read, position + read);
    if (result.bytesRead <= 0) return false;
    read += result.bytesRead;
  }
  return true;
}

async function writeTransferBytes(
  handle: FileHandle,
  buffer: Buffer,
  position: number,
): Promise<void> {
  let written = 0;
  while (written < buffer.length) {
    const result = await handle.write(
      buffer,
      written,
      buffer.length - written,
      position + written,
    );
    if (result.bytesWritten <= 0) throw new Error('destination stopped writing transfer data');
    written += result.bytesWritten;
  }
}

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Object.assign(new Error('workspace payload must be an object'), {
      code: 'INVALID_REQUEST',
    });
  return value as Record<string, any>;
}

function relativePath(value: unknown): string {
  const result = String(value ?? '.').trim() || '.';
  if (path.isAbsolute(result) || result.split(/[\\/]+/).includes('..'))
    throw Object.assign(new Error('path must stay inside the configured workspace root'), {
      code: 'PATH_OUTSIDE_ROOT',
    });
  return result;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function existingPath(root: string, relative: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  const realTarget = await fs.realpath(path.resolve(realRoot, relative));
  if (!isInside(realRoot, realTarget))
    throw Object.assign(new Error('resolved path leaves the configured workspace root'), {
      code: 'PATH_OUTSIDE_ROOT',
    });
  return realTarget;
}

async function writePath(root: string, relative: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  const target = path.resolve(realRoot, relative);
  if (!isInside(realRoot, target))
    throw Object.assign(new Error('path leaves the configured workspace root'), {
      code: 'PATH_OUTSIDE_ROOT',
    });
  if (target === realRoot) return target;
  let ancestor = path.dirname(target);
  while (ancestor !== realRoot) {
    try {
      const realAncestor = await fs.realpath(ancestor);
      if (!isInside(realRoot, realAncestor)) throw new Error('outside root');
      break;
    } catch (error: any) {
      if (error?.code !== 'ENOENT')
        throw Object.assign(new Error('write path passes through an unsafe link'), {
          code: 'PATH_OUTSIDE_ROOT',
        });
      ancestor = path.dirname(ancestor);
    }
  }
  const existing = await fs.realpath(target).catch((error: any) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (existing && !isInside(realRoot, existing))
    throw Object.assign(new Error('resolved path leaves the configured workspace root'), {
      code: 'PATH_OUTSIDE_ROOT',
    });
  return target;
}

function textResult(text: string, details: Record<string, unknown>) {
  return { text, details };
}

function transferId(value: unknown): string {
  const result = String(value ?? '').trim();
  if (!/^[a-zA-Z0-9_-]{1,220}$/.test(result))
    throw Object.assign(new Error('invalid transfer id'), { code: 'INVALID_REQUEST' });
  return result;
}

function transferTempPath(target: string, id: string): string {
  return path.join(path.dirname(target), `.blip-transfer-${id}.part`);
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
    : fallback;
}

export function createWorkspaceCapability(
  policies: CrossDeviceAssistantPolicyStore,
): CapabilityHandler {
  const commandJobs = new CommandJobStore();
  const unsubscribe = policies.onChange(() => {
    void commandJobs.cancelUnauthorized(async (deviceId, workspaceId) =>
      Boolean((await policies.deviceGrant(deviceId, workspaceId))?.execute),
    );
  });
  return {
    descriptor: WORKSPACE_CAPABILITY,
    close: () => {
      unsubscribe();
      commandJobs.close();
    },
    revokeDevice: (deviceId) => commandJobs.cancelForDevice(deviceId),
    async invoke(operation, rawPayload, context) {
      const payload = object(rawPayload);
      if (operation === 'workspaces.list') {
        const roots = await policies.grantedRoots(context.sourceDevice.id);
        return {
          workspaces: roots.map(({ id, label, read, write, execute }) => ({
            id,
            name: label || id,
            read,
            write,
            execute,
          })),
        };
      }
      const rootId = String(payload.workspaceId ?? payload.rootId ?? '').trim();
      const grant = await policies.deviceGrant(context.sourceDevice.id, rootId);
      if (!grant) {
        throw Object.assign(new Error('this device does not have access to that workspace'), {
          code: 'WORKSPACE_POLICY_DENIED',
        });
      }
      const required =
        operation === 'files.write' ||
        operation === 'files.transfer.mkdir' ||
        operation === 'files.transfer.prepare' ||
        operation === 'files.transfer.write' ||
        operation === 'files.transfer.commit' ||
        operation === 'files.transfer.abort'
          ? 'write'
          : operation.startsWith('commands.')
            ? 'execute'
            : 'read';
      if (!grant[required])
        throw Object.assign(new Error(`this device does not have ${required} workspace access`), {
          code: 'WORKSPACE_POLICY_DENIED',
        });
      const root = await policies.root(rootId);
      if (!root)
        throw Object.assign(new Error('configured workspace root was not found'), {
          code: 'ROOT_NOT_FOUND',
        });
      const rootPath = await fs.realpath(root.path);
      if (operation === 'commands.start')
        return commandJobs.start({
          sourceDeviceId: context.sourceDevice.id,
          workspaceId: rootId,
          rootPath,
          command: payload.command,
          timeoutMs: payload.timeoutMs,
        });
      if (operation === 'commands.status')
        return commandJobs.status(context.sourceDevice.id, rootId, payload.jobId);
      if (operation === 'commands.output')
        return await commandJobs.output({
          sourceDeviceId: context.sourceDevice.id,
          workspaceId: rootId,
          jobId: payload.jobId,
          cursor: payload.cursor,
          waitMs: payload.waitMs,
        });
      if (operation === 'commands.cancel')
        return commandJobs.cancel(context.sourceDevice.id, rootId, payload.jobId);
      if (operation === 'commands.run') {
        const job = commandJobs.start({
          sourceDeviceId: context.sourceDevice.id,
          workspaceId: rootId,
          rootPath,
          command: payload.command,
          timeoutMs: payload.timeoutMs,
          maximumTimeoutMs: 60 * 60_000,
        });
        let cursor = 0;
        let text = '';
        let current: any = job;
        do {
          current = await commandJobs.output({
            sourceDeviceId: context.sourceDevice.id,
            workspaceId: rootId,
            jobId: job.jobId,
            cursor,
            waitMs: 5_000,
          });
          cursor = current.cursor;
          text += current.chunks.map((chunk: any) => String(chunk.text ?? '')).join('');
        } while (current.status === 'running');
        return textResult(text || '(no output)', current);
      }
      const requestedPath = relativePath(payload.path);

      if (operation === 'files.transfer.stat') {
        const target = await existingPath(rootPath, requestedPath);
        const info = await fs.stat(target);
        if (!info.isFile() && !info.isDirectory())
          throw Object.assign(new Error('transfer source is not a file or directory'), {
            code: 'INVALID_REQUEST',
          });
        return {
          type: info.isDirectory() ? 'directory' : 'file',
          size: info.isFile() ? info.size : 0,
          mtimeMs: info.mtimeMs,
        };
      }

      if (operation === 'files.transfer.list') {
        const target = await existingPath(rootPath, requestedPath);
        const entries = await fs.readdir(target, { withFileTypes: true });
        if (entries.length > MAX_TRANSFER_DIRECTORY_ENTRIES)
          throw Object.assign(
            new Error(`directory contains more than ${MAX_TRANSFER_DIRECTORY_ENTRIES} entries`),
            { code: 'INVALID_REQUEST' },
          );
        return {
          entries: await Promise.all(
            entries
              .filter(
                (entry) =>
                  (entry.isFile() || entry.isDirectory()) &&
                  !isAssistantTransferTemporaryName(entry.name),
              )
              .map(async (entry) => {
                const absolute = await existingPath(rootPath, path.join(requestedPath, entry.name));
                const info = await fs.stat(absolute);
                return {
                  name: entry.name,
                  type: entry.isDirectory() ? 'directory' : 'file',
                  size: entry.isFile() ? info.size : 0,
                  mtimeMs: info.mtimeMs,
                };
              }),
          ),
        };
      }

      if (operation === 'files.transfer.read') {
        const target = await existingPath(rootPath, requestedPath);
        const offset = boundedInteger(payload.offset, 0, 0, Number.MAX_SAFE_INTEGER);
        const length = boundedInteger(
          payload.length,
          MESH_BINARY_CHUNK_BYTES,
          1,
          MESH_BINARY_CHUNK_BYTES,
        );
        const handle = await fs.open(target, 'r');
        try {
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, offset);
          return {
            dataBase64: buffer.subarray(0, bytesRead).toString('base64'),
            bytes: bytesRead,
          };
        } finally {
          await handle.close();
        }
      }

      if (operation === 'files.transfer.mkdir') {
        await fs.mkdir(await writePath(rootPath, requestedPath), { recursive: true });
        return { ok: true };
      }

      if (operation === 'files.transfer.prepare') {
        const target = await writePath(rootPath, requestedPath);
        const id = transferId(payload.transferId);
        const size = boundedInteger(payload.size, 0, 0, Number.MAX_SAFE_INTEGER);
        const existing = await fs.stat(target).catch((error: any) => {
          if (error?.code === 'ENOENT') return null;
          throw error;
        });
        if (existing && !existing.isFile())
          throw Object.assign(new Error('destination path is not a file'), {
            code: 'INVALID_REQUEST',
          });
        if (existing && payload.overwrite !== true)
          throw Object.assign(new Error('destination file already exists'), {
            code: 'FILE_EXISTS',
          });
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temp = transferTempPath(target, id);
        let partial = await fs.lstat(temp).catch((error: any) => {
          if (error?.code === 'ENOENT') return null;
          throw error;
        });
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

      if (operation === 'files.transfer.write') {
        const target = await writePath(rootPath, requestedPath);
        const id = transferId(payload.transferId);
        const offset = boundedInteger(payload.offset, 0, 0, Number.MAX_SAFE_INTEGER);
        const data = Buffer.from(String(payload.dataBase64 ?? ''), 'base64');
        if (data.length > MESH_BINARY_CHUNK_BYTES)
          throw Object.assign(new Error('transfer chunk is too large'), {
            code: 'INVALID_REQUEST',
          });
        const temp = transferTempPath(target, id);
        const tempInfo = await fs.lstat(temp);
        if (!tempInfo.isFile())
          throw Object.assign(new Error('transfer temporary path is not a file'), {
            code: 'INVALID_REQUEST',
          });
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

      if (operation === 'files.transfer.commit') {
        const target = await writePath(rootPath, requestedPath);
        const id = transferId(payload.transferId);
        const size = boundedInteger(payload.size, 0, 0, Number.MAX_SAFE_INTEGER);
        const temp = transferTempPath(target, id);
        const info = await fs.lstat(temp).catch((error: any) => {
          if (error?.code !== 'ENOENT') throw error;
          return null;
        });
        if (!info) {
          const committed = await fs.stat(target).catch(() => null);
          if (committed?.isFile() && committed.size === size) return { ok: true };
          throw Object.assign(new Error('transfer temporary file was not found'), {
            code: 'TRANSFER_INCOMPLETE',
          });
        }
        if (!info.isFile())
          throw Object.assign(new Error('transfer temporary path is not a file'), {
            code: 'INVALID_REQUEST',
          });
        if (info.size !== size)
          throw Object.assign(new Error('transfer is incomplete'), {
            code: 'TRANSFER_INCOMPLETE',
          });
        if (payload.overwrite !== true) {
          const existing = await fs.stat(target).catch((error: any) => {
            if (error?.code === 'ENOENT') return null;
            throw error;
          });
          if (existing)
            throw Object.assign(new Error('destination file already exists'), {
              code: 'FILE_EXISTS',
            });
        }
        await fs.rename(temp, target);
        return { ok: true };
      }

      if (operation === 'files.transfer.abort') {
        const target = await writePath(rootPath, requestedPath);
        await fs.rm(transferTempPath(target, transferId(payload.transferId)), { force: true });
        return { ok: true };
      }

      if (operation === 'files.list') {
        const target = await existingPath(rootPath, requestedPath);
        const limit = boundedInteger(payload.limit, 200, 1, 500);
        const entries = (await fs.readdir(target, { withFileTypes: true }))
          .filter((entry) => payload.includeHidden === true || !entry.name.startsWith('.'))
          .sort(
            (a, b) =>
              Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
          )
          .slice(0, limit);
        const details = await Promise.all(
          entries.map(async (entry) => {
            const absolute = await existingPath(rootPath, path.join(requestedPath, entry.name));
            const info = await fs.stat(absolute);
            return {
              path: path.relative(rootPath, absolute) || '.',
              type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
              size: info.size,
              modifiedAt: info.mtime.toISOString(),
            };
          }),
        );
        return textResult(
          details
            .map((entry) => `${entry.type === 'directory' ? 'dir ' : 'file'} ${entry.path}`)
            .join('\n') || '(empty)',
          { entries: details, truncated: entries.length === limit },
        );
      }

      if (operation === 'files.read') {
        const target = await existingPath(rootPath, requestedPath);
        const buffer = await fs.readFile(target);
        if (buffer.length > MAX_FILE_BYTES)
          throw Object.assign(new Error('file is too large'), { code: 'FILE_TOO_LARGE' });
        if (buffer.includes(0))
          throw Object.assign(new Error('file appears to be binary'), { code: 'BINARY_FILE' });
        const lines = buffer.toString('utf8').split(/\r?\n/);
        const offset = boundedInteger(payload.offset, 0, 0, lines.length);
        const limit = boundedInteger(payload.limit, 200, 1, 1000);
        const selected = lines.slice(offset, offset + limit);
        const text = selected
          .map((line, index) => `${String(offset + index + 1).padStart(6, ' ')} | ${line}`)
          .join('\n');
        return textResult(text, {
          path: requestedPath,
          offset,
          lineCount: lines.length,
          returnedLines: selected.length,
          truncated: offset + limit < lines.length,
          sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        });
      }

      if (operation === 'files.write') {
        const content = String(payload.content ?? '');
        if (payload.mode !== 'create' && payload.mode !== 'overwrite')
          throw Object.assign(new Error('write mode must be create or overwrite'), {
            code: 'INVALID_REQUEST',
          });
        if (Buffer.byteLength(content) > MAX_FILE_BYTES)
          throw Object.assign(new Error('file content is too large'), { code: 'FILE_TOO_LARGE' });
        const target = await writePath(rootPath, requestedPath);
        const current = await fs.readFile(target).catch((error: any) => {
          if (error?.code === 'ENOENT') return null;
          throw error;
        });
        const exists = current !== null;
        if (payload.mode === 'create' && exists)
          throw Object.assign(new Error('file already exists'), { code: 'FILE_EXISTS' });
        if (payload.mode === 'overwrite' && !exists)
          throw Object.assign(new Error('file does not exist'), { code: 'FILE_NOT_FOUND' });
        if (
          current !== null &&
          typeof payload.baseHash === 'string' &&
          payload.baseHash &&
          crypto.createHash('sha256').update(current).digest('hex') !== payload.baseHash
        )
          throw Object.assign(new Error('baseHash does not match the current file'), {
            code: 'BASE_HASH_MISMATCH',
          });
        if (!exists) await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
        return textResult(`wrote ${requestedPath}`, {
          path: requestedPath,
          bytes: Buffer.byteLength(content),
          created: !exists,
        });
      }

      if (operation === 'files.search') {
        const searchRoot = await existingPath(rootPath, requestedPath);
        const query = String(payload.query ?? '').trim();
        if (!query)
          throw Object.assign(new Error('search query is required'), { code: 'INVALID_REQUEST' });
        if (payload.mode !== 'name' && payload.mode !== 'content')
          throw Object.assign(new Error('search mode must be name or content'), {
            code: 'INVALID_REQUEST',
          });
        const limit = boundedInteger(payload.limit, 100, 1, 200);
        const matches: Array<{ path: string; line?: number; preview?: string }> = [];
        const queue = [searchRoot];
        let scannedEntries = 0;
        let scannedBytes = 0;
        let searchBudgetExhausted = false;
        while (
          queue.length > 0 &&
          matches.length < limit &&
          scannedEntries < MAX_SEARCH_ENTRIES &&
          !searchBudgetExhausted
        ) {
          const current = queue.shift()!;
          for (const entry of await fs.readdir(current, { withFileTypes: true })) {
            scannedEntries += 1;
            if (
              entry.name.startsWith('.') ||
              matches.length >= limit ||
              scannedEntries > MAX_SEARCH_ENTRIES
            )
              continue;
            const absolute = await existingPath(
              rootPath,
              path.join(path.relative(rootPath, current), entry.name),
            );
            if (entry.isDirectory()) queue.push(absolute);
            else if (entry.isFile()) {
              const relative = path.relative(rootPath, absolute);
              if (payload.mode === 'name') {
                if (relative.toLowerCase().includes(query.toLowerCase()))
                  matches.push({ path: relative });
              } else {
                const info = await fs.stat(absolute);
                if (info.size > MAX_FILE_BYTES) continue;
                if (scannedBytes + info.size > MAX_CONTENT_SEARCH_BYTES) {
                  searchBudgetExhausted = true;
                  break;
                }
                scannedBytes += info.size;
                const buffer = await fs.readFile(absolute);
                if (buffer.length > MAX_FILE_BYTES || buffer.includes(0)) continue;
                for (const [index, line] of buffer.toString('utf8').split(/\r?\n/).entries()) {
                  if (line.toLowerCase().includes(query.toLowerCase()))
                    matches.push({
                      path: relative,
                      line: index + 1,
                      preview: line.trim().slice(0, 300),
                    });
                  if (matches.length >= limit) break;
                }
              }
            }
          }
        }
        return textResult(
          matches
            .map((match) =>
              match.line ? `${match.path}:${match.line}:${match.preview}` : match.path,
            )
            .join('\n') || '(no matches)',
          {
            matches,
            scannedEntries,
            scannedBytes,
            truncated:
              matches.length === limit ||
              scannedEntries >= MAX_SEARCH_ENTRIES ||
              searchBudgetExhausted,
          },
        );
      }

      throw Object.assign(new Error(`unsupported workspace operation: ${operation}`), {
        code: 'UNSUPPORTED_OPERATION',
      });
    },
  };
}
