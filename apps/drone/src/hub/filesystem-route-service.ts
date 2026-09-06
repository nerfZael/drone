import crypto from 'node:crypto';
import { createReadStream, watch as watchFs } from 'node:fs';
import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { browserCacheControlForFileRevision, buildContainerFsListScript } from './filesystem-media';
import {
  buildContainerMediaRangeScript,
  parseRequestedByteRange,
  readHostMediaRange,
  type ResolvedByteRange,
} from './filesystem-media-range';
import { bashQuote, normalizeContainerPath } from './hub-format';
import { readJsonBody, sendJson as json } from './hub-http';
import { listGitIgnoredPaths } from './listGitIgnoredPaths';
import type { FilesystemRouteDependencies } from './routes/filesystem-routes';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './routes/legacy-route';

export function writeFileSseFrame(res: ServerResponse, frame: string): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    if (res.write(frame)) return true;
  } catch {
    // A failed write is handled like a backpressured client below.
  }
  res.destroy();
  return false;
}

export class FilesystemService {
  readonly handle: LegacyRouteHandler;

  constructor(deps: FilesystemRouteDependencies) {
    this.handle = createFilesystemServiceHandler(deps);
  }
}

function createFilesystemServiceHandler(deps: FilesystemRouteDependencies): LegacyRouteHandler {
  const {
    FS_EDITOR_MAX_BYTES,
    FS_LIST_TIMEOUT_MS,
    FS_MEDIA_MAX_BYTES,
    FS_QUICK_OPEN_MAX_RESULTS,
    FS_TEXT_CHUNK_MAX_BYTES,
    FS_THUMB_MAX_BYTES,
    NON_REPO_HOME_CWD,
    bufferLooksBinary,
    buildFsSearchScript,
    clampIntParam,
    defaultDroneHomeCwd,
    droneRuntime,
    dvmCopyFromContainer,
    dvmExec,
    dvmPorts,
    guessImageMimeType,
    guessVideoMimeType,
    handleFsActionRoute,
    handleFsUploadRoute,
    hostFsErrorStatus,
    hostMimeType,
    isLikelyImagePath,
    isLikelyTextMimeType,
    isLikelyVideoPath,
    listHostFsDirectory,
    looksLikeMissingContainerError,
    normalizeFsPathForRuntime,
    parseContainerFsListOutput,
    parseFsSearchOutput,
    readHostFileBytes,
    resolveDroneOrRespond,
    runHostCommand,
    withLockedDroneContainer,
    withReadonlyDroneContainer,
  } = deps;
  const isEmptyTextFile = (filePath: string, sizeRaw: number | null | undefined) =>
    sizeRaw != null &&
    Number(sizeRaw) === 0 &&
    !isLikelyImagePath(filePath) &&
    !isLikelyVideoPath(filePath);
  const inferPreviewType = (filePath: string, rawMime: string, sizeRaw?: number | null) => {
    const mimeRaw = String(rawMime ?? '')
      .trim()
      .toLowerCase();
    const emptyTextFile = isEmptyTextFile(filePath, sizeRaw);
    const mime = emptyTextFile
      ? 'text/plain'
      : mimeRaw.startsWith('image/')
        ? mimeRaw
        : mimeRaw.startsWith('video/')
          ? mimeRaw
          : isLikelyImagePath(filePath)
            ? guessImageMimeType(filePath)
            : isLikelyVideoPath(filePath)
              ? guessVideoMimeType(filePath)
              : mimeRaw || 'application/octet-stream';
    const kind = mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/')
        ? 'video'
        : isLikelyTextMimeType(mime)
          ? 'text'
          : 'binary';
    return { kind, mime };
  };
  const sha256 = (value: Buffer | string) =>
    `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
  const cacheControlForServedFile = (input: {
    res: ServerResponse;
    requestedRevision: unknown;
    bytes?: Buffer;
    servedRevision?: string | null;
    droneId: string;
    droneName: string;
    targetPath: string;
  }): string | null => {
    const requestedRevision = String(input.requestedRevision ?? '').trim();
    if (!requestedRevision) return 'no-store';
    const servedRevision = input.servedRevision ?? (input.bytes ? sha256(input.bytes) : '');
    const cacheControl = browserCacheControlForFileRevision(requestedRevision, servedRevision);
    if (cacheControl !== 'no-store') return cacheControl;
    json(input.res, 409, {
      ok: false,
      code: 'FILE_REVISION_MISMATCH',
      error: 'file revision changed',
      id: input.droneId,
      name: input.droneName,
      path: input.targetPath,
      currentRevision: servedRevision,
    });
    return null;
  };
  const sendMediaBytes = (input: {
    res: ServerResponse;
    bytes: Buffer;
    totalBytes: number;
    range: ResolvedByteRange;
    mime: string;
    cacheControl: string;
    headOnly?: boolean;
  }) => {
    input.res.statusCode = input.range.kind === 'range' ? 206 : 200;
    input.res.setHeader('content-type', input.mime);
    input.res.setHeader('cache-control', input.cacheControl);
    input.res.setHeader('accept-ranges', 'bytes');
    if (input.range.kind === 'range') {
      input.res.setHeader(
        'content-range',
        `bytes ${input.range.start}-${input.range.end}/${input.totalBytes}`,
      );
    }
    input.res.setHeader('content-length', String(input.range.length));
    input.res.end(input.headOnly ? undefined : input.bytes);
  };
  const addHostGitIgnoreMetadata = async <T extends { path: string }>(
    directoryPath: string,
    entries: T[],
  ): Promise<Array<T & { isGitIgnored: boolean }>> => {
    const ignoredPaths = await listGitIgnoredPaths({
      directoryPath,
      entryPaths: entries.map((entry) => entry.path),
      runCommand: runHostCommand,
      timeoutMs: FS_LIST_TIMEOUT_MS,
    });
    return entries.map((entry) => ({
      ...entry,
      isGitIgnored: ignoredPaths.has(path.resolve(entry.path)),
    }));
  };
  const hashHostFileWithSize = async (
    filePath: string,
  ): Promise<{ revision: string; size: number }> =>
    await new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      let size = 0;
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => {
        hash.update(chunk);
        size += Buffer.byteLength(chunk);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve({ revision: `sha256:${hash.digest('hex')}`, size }));
    });
  const hashHostFile = async (filePath: string): Promise<string> =>
    (await hashHostFileWithSize(filePath)).revision;
  const readFileRevision = async ({
    drone,
    droneName,
    targetPath,
  }: {
    drone: any;
    droneName: string;
    targetPath: string;
  }): Promise<{ path: string; size: number; mtimeMs: number | null; revision: string }> => {
    if (droneRuntime(drone) === 'host') {
      const resolvedPath = path.resolve(targetPath);
      const stat = await fs.stat(resolvedPath);
      if (!stat.isFile()) {
        const error = new Error(`file not found: ${resolvedPath}`) as Error & { code?: string };
        error.code = 'ENOENT';
        throw error;
      }
      const scanned = await hashHostFileWithSize(resolvedPath);
      if (scanned.size !== stat.size) {
        throw Object.assign(new Error('file changed while it was being read'), {
          statusCode: 409,
          code: 'FILE_CHANGED_DURING_READ',
        });
      }
      return {
        path: resolvedPath,
        size: Number.isFinite(stat.size) ? Math.max(0, Math.floor(stat.size)) : 0,
        mtimeMs: Number.isFinite(stat.mtimeMs) ? Math.max(0, Math.floor(stat.mtimeMs)) : null,
        revision: scanned.revision,
      };
    }
    return await withReadonlyDroneContainer(
      { requestedDroneName: droneName, droneEntry: drone },
      async ({ containerName }: any) => {
        const script = [
          'set -euo pipefail',
          `target=${bashQuote(targetPath)}`,
          'if [ ! -f "$target" ]; then echo "__ERR__\tnot-file"; exit 3; fi',
          'size=$(stat -c %s -- "$target" 2>/dev/null || echo 0)',
          'mtime=$(stat -c %Y -- "$target" 2>/dev/null || echo 0)',
          'revision=$(sha256sum -- "$target" | cut -d " " -f 1)',
          'size_after=$(stat -c %s -- "$target" 2>/dev/null || echo -1)',
          'if [ "$size_after" != "$size" ]; then echo "__ERR__\tchanged"; exit 6; fi',
          'printf "__META__\\t%s\\t%s\\t%s\\n" "$size" "$mtime" "$revision"',
        ].join('\n');
        const result = await dvmExec(containerName, 'bash', ['-lc', script]);
        const line = String(result.stdout ?? '').trim();
        if (result.code !== 0 || !line.startsWith('__META__\t')) {
          throw new Error(
            /__ERR__\s+not-file\b/i.test(`${result.stdout}\n${result.stderr}`)
              ? `file not found: ${targetPath}`
              : (result.stderr || result.stdout || 'failed reading file revision').trim(),
          );
        }
        const parts = line.split('\t');
        const size = Number(parts[1] ?? 0);
        const mtime = Number(parts[2] ?? 0);
        const digest = String(parts[3] ?? '').trim();
        if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error('file revision response malformed');
        return {
          path: targetPath,
          size: Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0,
          mtimeMs: Number.isFinite(mtime) ? Math.max(0, Math.floor(mtime * 1000)) : null,
          revision: `sha256:${digest.toLowerCase()}`,
        };
      },
    );
  };
  const readFileFingerprint = async ({
    drone,
    droneName,
    targetPath,
  }: {
    drone: any;
    droneName: string;
    targetPath: string;
  }): Promise<{ path: string; size: number; mtimeMs: number | null }> => {
    if (droneRuntime(drone) === 'host') {
      const resolvedPath = path.resolve(targetPath);
      const stat = await fs.stat(resolvedPath);
      if (!stat.isFile()) {
        const error = new Error(`file not found: ${resolvedPath}`) as Error & { code?: string };
        error.code = 'ENOENT';
        throw error;
      }
      return {
        path: resolvedPath,
        size: Number.isFinite(stat.size) ? Math.max(0, Math.floor(stat.size)) : 0,
        mtimeMs: Number.isFinite(stat.mtimeMs) ? Math.max(0, Math.floor(stat.mtimeMs)) : null,
      };
    }
    return await withReadonlyDroneContainer(
      { requestedDroneName: droneName, droneEntry: drone },
      async ({ containerName }: any) => {
        const script = [
          'set -euo pipefail',
          `target=${bashQuote(targetPath)}`,
          'if [ ! -f "$target" ]; then echo "__ERR__\tnot-file"; exit 3; fi',
          'size=$(stat -c %s -- "$target" 2>/dev/null || echo 0)',
          'mtime=$(stat -c %Y -- "$target" 2>/dev/null || echo 0)',
          'printf "__META__\\t%s\\t%s\\n" "$size" "$mtime"',
        ].join('\n');
        const result = await dvmExec(containerName, 'bash', ['-lc', script]);
        const line = String(result.stdout ?? '').trim();
        if (result.code !== 0 || !line.startsWith('__META__\t')) {
          throw new Error(
            /__ERR__\s+not-file\b/i.test(`${result.stdout}\n${result.stderr}`)
              ? `file not found: ${targetPath}`
              : (result.stderr || result.stdout || 'failed reading file metadata').trim(),
          );
        }
        const parts = line.split('\t');
        const size = Number(parts[1] ?? 0);
        const mtime = Number(parts[2] ?? 0);
        return {
          path: targetPath,
          size: Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0,
          mtimeMs: Number.isFinite(mtime) ? Math.max(0, Math.floor(mtime * 1000)) : null,
        };
      },
    );
  };
  const writeFileSseEvent = (res: ServerResponse, event: string, data: unknown): boolean => {
    return writeFileSseFrame(res, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  return async ({ req, res, url: u, method, parts }) => {
    const handled = await (async (): Promise<false | void> => {
      // GET /api/drones/:id/ports
      // Exposes *all* host->container port mappings (like `dvm ports <container>`).
      // GET /api/drones/:id/fs/list?path=/...
      // Lists files/folders in a container path.
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'fs' &&
        parts[4] === 'list'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        const targetPath = normalizeFsPathForRuntime(drone, u.searchParams.get('path') ?? '', {
          fallbackToHome: true,
        });
        if (runtime === 'host') {
          try {
            const parsed = await listHostFsDirectory(targetPath);
            const entries = await addHostGitIgnoreMetadata(parsed.resolvedPath, parsed.entries);
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              path: parsed.resolvedPath,
              entries,
            });
            return;
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            const code = hostFsErrorStatus(e);
            json(res, code, {
              ok: false,
              error: msg,
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }
        }
        const script = buildContainerFsListScript(targetPath, NON_REPO_HOME_CWD);

        try {
          const r = await withReadonlyDroneContainer(
            { requestedDroneName: droneName, droneEntry: resolved.drone },
            async ({ containerName }: any) => {
              return await dvmExec(containerName, 'bash', ['-lc', script], {
                timeoutMs: FS_LIST_TIMEOUT_MS,
              });
            },
          );
          if (r.code !== 0) {
            const out = `${r.stdout || ''}\n${r.stderr || ''}`;
            if (/\bnot-dir\b/i.test(out)) {
              json(res, 404, {
                ok: false,
                error: `path is not a directory: ${targetPath}`,
                id: droneId,
                name: droneName,
                path: targetPath,
              });
              return;
            }
            if (r.code === 124) {
              json(res, 504, {
                ok: false,
                error: (r.stderr || 'timed out listing files').trim(),
                id: droneId,
                name: droneName,
                path: targetPath,
              });
              return;
            }
            json(res, 500, {
              ok: false,
              error: (r.stderr || r.stdout || 'failed to list files').trim(),
              id: droneId,
              name: droneName,
              path: targetPath,
            });
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
          json(res, code, {
            ok: false,
            error: msg,
            id: droneId,
            name: droneName,
            path: targetPath,
          });
          return;
        }
      }

      // GET /api/drones/:id/fs/search?query=...&limit=...
      // Lists searchable file paths for Quick Open in the current drone workspace.
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'fs' &&
        parts[4] === 'search'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;
        const query = String(u.searchParams.get('query') ?? '')
          .trim()
          .toLowerCase();
        const limitRaw = Number(u.searchParams.get('limit') ?? 80);
        const limit = Math.min(
          FS_QUICK_OPEN_MAX_RESULTS,
          Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 80),
        );
        const root = defaultDroneHomeCwd(drone);

        if (runtime === 'host') {
          try {
            const script = buildFsSearchScript({ root, query, limit, pathFlavor: 'host' });
            const r = await runHostCommand('bash', ['-lc', script], { timeoutMs: 10_000 });
            const out = `${String(r.stdout ?? '')}\n${String(r.stderr ?? '')}`;
            if (r.code !== 0) {
              if (/\bnot-dir\b/i.test(out)) {
                json(res, 404, {
                  ok: false,
                  error: `path is not a directory: ${root}`,
                  id: droneId,
                  name: droneName,
                  root,
                });
                return;
              }
              json(res, 500, {
                ok: false,
                error: (r.stderr || r.stdout || 'failed searching files').trim(),
                id: droneId,
                name: droneName,
                root,
              });
              return;
            }
            const parsed = parseFsSearchOutput(r.stdout || '', root);
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              root: parsed.root,
              entries: parsed.entries,
            });
            return;
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            const code = hostFsErrorStatus(e);
            json(res, code, { ok: false, error: msg, id: droneId, name: droneName, root });
            return;
          }
        }

        const script = buildFsSearchScript({ root, query, limit, pathFlavor: 'posix' });
        try {
          const r = await withReadonlyDroneContainer(
            { requestedDroneName: droneName, droneEntry: resolved.drone },
            async ({ containerName }: any) => {
              return await dvmExec(containerName, 'bash', ['-lc', script]);
            },
          );
          const out = `${String(r.stdout ?? '')}\n${String(r.stderr ?? '')}`;
          if (r.code !== 0) {
            if (/\bnot-dir\b/i.test(out)) {
              json(res, 404, {
                ok: false,
                error: `path is not a directory: ${root}`,
                id: droneId,
                name: droneName,
                root,
              });
              return;
            }
            json(res, 500, {
              ok: false,
              error: (r.stderr || r.stdout || 'failed searching files').trim(),
              id: droneId,
              name: droneName,
              root,
            });
            return;
          }
          const parsed = parseFsSearchOutput(r.stdout || '', root);
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            root: parsed.root,
            entries: parsed.entries,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = looksLikeMissingContainerError(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, id: droneId, name: droneName, root });
          return;
        }
      }

      // GET /api/drones/:id/fs/thumb?path=/...
      // Returns image bytes for thumbnail rendering.
      // GET /api/drones/:id/fs/text-chunk?path=/...&offset=0&limit=...
      // GET /api/drones/:id/fs/chunk?path=/...&offset=0&limit=...
      // Reads a bounded UTF-8 or base64 chunk for large read-only viewing.
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'fs' &&
        (parts[4] === 'text-chunk' || parts[4] === 'chunk')
      ) {
        const binaryChunk = parts[4] === 'chunk';
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        const targetPath = normalizeFsPathForRuntime(drone, u.searchParams.get('path') ?? '', {
          fallbackToHome: false,
        });
        if (!targetPath || targetPath === '/') {
          json(res, 400, { ok: false, error: 'missing file path' });
          return;
        }
        const rawOffset = Number(u.searchParams.get('offset') ?? 0);
        const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);
        const limit = clampIntParam(
          u.searchParams.get('limit'),
          FS_TEXT_CHUNK_MAX_BYTES,
          1,
          FS_TEXT_CHUNK_MAX_BYTES,
        );

        if (runtime === 'host') {
          try {
            const resolvedPath = path.resolve(targetPath);
            const st = await fs.stat(resolvedPath);
            if (!st.isFile()) {
              json(res, 404, {
                ok: false,
                error: `file not found: ${resolvedPath}`,
                id: droneId,
                name: droneName,
                path: resolvedPath,
              });
              return;
            }
            const size = Number.isFinite(st.size) ? Math.max(0, Math.floor(st.size)) : 0;
            const start = Math.min(offset, size);
            const readLength = Math.min(limit, Math.max(0, size - start));
            const buf = Buffer.alloc(readLength);
            if (readLength > 0) {
              const handle = await fs.open(resolvedPath, 'r');
              try {
                await handle.read(buf, 0, readLength, start);
              } finally {
                await handle.close();
              }
            }
            const mime = await hostMimeType(resolvedPath);
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              path: resolvedPath,
              kind: binaryChunk ? 'binary-chunk' : 'text-chunk',
              mime: mime || 'text/plain',
              size,
              mtimeMs: Number.isFinite(st.mtimeMs) ? Math.max(0, Math.floor(st.mtimeMs)) : null,
              offset: start,
              nextOffset: start + readLength,
              eof: start + readLength >= size,
              ...(binaryChunk
                ? { dataBase64: buf.toString('base64') }
                : { content: buf.toString('utf8') }),
            });
            return;
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            const code = hostFsErrorStatus(e);
            json(res, code, {
              ok: false,
              error: msg,
              id: droneId,
              name: droneName,
              path: path.resolve(targetPath),
            });
            return;
          }
        }

        const script = [
          'set -euo pipefail',
          `target=${bashQuote(targetPath)}`,
          `offset=${String(offset)}`,
          `limit=${String(limit)}`,
          'if [ ! -f "$target" ]; then echo "__ERR__\tnot-file"; exit 3; fi',
          'size=$(wc -c < "$target" | tr -d "[:space:]")',
          'if [ -z "$size" ]; then size=0; fi',
          'mtime=$(stat -c %Y -- "$target" 2>/dev/null || echo 0)',
          'mime=""',
          'if command -v file >/dev/null 2>&1; then mime=$(file -Lb --mime-type -- "$target" 2>/dev/null || true); fi',
          'if [ "$offset" -gt "$size" ]; then offset="$size"; fi',
          'remaining=$((size - offset))',
          'count="$limit"',
          'if [ "$remaining" -lt "$count" ]; then count="$remaining"; fi',
          'printf "__META__\t%s\t%s\t%s\t%s\t%s\n" "$mime" "$size" "$mtime" "$offset" "$count"',
          'if [ "$count" -gt 0 ]; then dd if="$target" bs=1 skip="$offset" count="$count" status=none | base64 | tr -d "\\n"; fi',
        ].join('\n');
        try {
          const r = await withReadonlyDroneContainer(
            { requestedDroneName: droneName, droneEntry: resolved.drone },
            async ({ containerName }: any) => {
              return await dvmExec(containerName, 'bash', ['-lc', script]);
            },
          );
          const out = `${String(r.stdout ?? '')}\n${String(r.stderr ?? '')}`;
          if (r.code !== 0) {
            if (/__ERR__\s+not-file\b/i.test(out)) {
              json(res, 404, {
                ok: false,
                error: `file not found: ${targetPath}`,
                id: droneId,
                name: droneName,
                path: targetPath,
              });
              return;
            }
            json(res, 500, {
              ok: false,
              error: (r.stderr || r.stdout || 'failed reading file chunk').trim(),
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }
          const stdout = String(r.stdout ?? '');
          const firstNl = stdout.indexOf('\n');
          if (firstNl < 0) {
            json(res, 500, {
              ok: false,
              error: 'file chunk response malformed',
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }
          const meta = stdout.slice(0, firstNl).split('\t');
          if (meta.length < 6 || meta[0] !== '__META__') {
            json(res, 500, {
              ok: false,
              error: 'file chunk metadata missing',
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }
          const mimeRaw = String(meta[1] ?? '')
            .trim()
            .toLowerCase();
          const sizeNum = Number(meta[2] ?? 0);
          const mtimeSec = Number(meta[3] ?? 0);
          const chunkOffset = Number(meta[4] ?? 0);
          const count = Number(meta[5] ?? 0);
          const buf = Buffer.from(stdout.slice(firstNl + 1).trim(), 'base64');
          const safeSize = Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : 0;
          const safeOffset = Number.isFinite(chunkOffset)
            ? Math.max(0, Math.floor(chunkOffset))
            : 0;
          const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            path: targetPath,
            kind: binaryChunk ? 'binary-chunk' : 'text-chunk',
            mime: mimeRaw || 'text/plain',
            size: safeSize,
            mtimeMs: Number.isFinite(mtimeSec) ? Math.max(0, Math.floor(mtimeSec * 1000)) : null,
            offset: safeOffset,
            nextOffset: safeOffset + safeCount,
            eof: safeOffset + safeCount >= safeSize,
            ...(binaryChunk
              ? { dataBase64: buf.toString('base64') }
              : { content: buf.toString('utf8') }),
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = looksLikeMissingContainerError(msg) ? 404 : 500;
          json(res, code, {
            ok: false,
            error: code === 500 ? 'failed reading file chunk' : msg,
            id: droneId,
            name: droneName,
            path: targetPath,
          });
          return;
        }
      }

      // GET /api/drones/:id/fs/file?path=/...
      // Reads file data for editor/preview usage (UTF-8 text content or binary metadata).
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'fs' &&
        parts[4] === 'file-events'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
        const targetPath = normalizeFsPathForRuntime(
          resolved.drone,
          u.searchParams.get('path') ?? '',
          { fallbackToHome: false },
        );
        if (!targetPath || targetPath === '/') {
          json(res, 400, { ok: false, error: 'missing file path' });
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream; charset=utf-8');
        res.setHeader('cache-control', 'no-cache, no-transform');
        res.setHeader('connection', 'keep-alive');
        req.socket.setTimeout(0);
        (res as any).flushHeaders?.();

        let closed = false;
        let cleanup: () => void = () => undefined;
        const publish = (event: string, data: unknown) => {
          const written = writeFileSseEvent(res, event, data);
          if (!written) cleanup();
          return written;
        };
        let busy = false;
        let forceAfterBusy = false;
        let lastRevision: string | null = null;
        let lastFingerprint: { size: number; mtimeMs: number | null } | null = null;
        let lastHashAt = 0;
        let lastMissing = false;
        const poll = async (forceHash = false) => {
          if (closed) return;
          if (busy) {
            if (forceHash) forceAfterBusy = true;
            return;
          }
          busy = true;
          try {
            const fingerprint = await readFileFingerprint({
              drone: resolved.drone,
              droneName,
              targetPath,
            });
            const fingerprintChanged =
              lastFingerprint == null ||
              fingerprint.size !== lastFingerprint.size ||
              fingerprint.mtimeMs !== lastFingerprint.mtimeMs;
            lastFingerprint = {
              size: fingerprint.size,
              mtimeMs: fingerprint.mtimeMs,
            };
            if (fingerprint.size > FS_EDITOR_MAX_BYTES) {
              const metadataRevision = `metadata:${fingerprint.size}:${fingerprint.mtimeMs ?? 'unknown'}`;
              const event =
                lastRevision == null
                  ? 'snapshot'
                  : metadataRevision !== lastRevision
                    ? 'changed'
                    : null;
              lastRevision = metadataRevision;
              lastHashAt = Date.now();
              lastMissing = false;
              if (event) {
                publish(event, {
                  ok: true,
                  id: droneId,
                  ...fingerprint,
                  revision: metadataRevision,
                });
              }
              return;
            }
            const shouldHash =
              forceHash ||
              lastRevision == null ||
              fingerprintChanged ||
              Date.now() - lastHashAt >= 30_000;
            if (!shouldHash) {
              lastMissing = false;
              return;
            }
            const current = await readFileRevision({
              drone: resolved.drone,
              droneName,
              targetPath,
            });
            lastHashAt = Date.now();
            const event =
              lastRevision == null
                ? 'snapshot'
                : current.revision !== lastRevision
                  ? 'changed'
                  : null;
            lastRevision = current.revision;
            lastMissing = false;
            if (event) publish(event, { ok: true, id: droneId, ...current });
          } catch (error: any) {
            const message = String(error?.message ?? error);
            const missing = /not found|not-file|ENOENT/i.test(message);
            if (missing && !lastMissing) {
              lastMissing = true;
              lastRevision = null;
              lastFingerprint = null;
              lastHashAt = 0;
              publish('deleted', { ok: false, id: droneId, path: targetPath });
            } else if (!missing) {
              publish('stream-error', {
                ok: false,
                id: droneId,
                path: targetPath,
                error: message,
              });
            }
          } finally {
            busy = false;
            if (forceAfterBusy && !closed) {
              forceAfterBusy = false;
              void poll(true);
            }
          }
        };
        const hostRuntime = droneRuntime(resolved.drone) === 'host';
        const resolvedHostPath = hostRuntime ? path.resolve(targetPath) : null;
        let hostWatcher: ReturnType<typeof watchFs> | null = null;
        if (resolvedHostPath) {
          try {
            hostWatcher = watchFs(
              path.dirname(resolvedHostPath),
              { persistent: false },
              (_eventType, filename) => {
                if (filename == null || String(filename) === path.basename(resolvedHostPath)) {
                  void poll(true);
                }
              },
            );
          } catch {
            hostWatcher = null;
          }
        }
        hostWatcher?.on('error', () => {
          // The periodic revision check remains the correctness fallback.
        });
        const timer = setInterval(() => void poll(hostRuntime), hostRuntime ? 30_000 : 2_000);
        timer.unref?.();
        const heartbeat = setInterval(() => {
          if (!closed && !writeFileSseFrame(res, ': keepalive\n\n')) cleanup();
        }, 15_000);
        heartbeat.unref?.();
        cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(timer);
          clearInterval(heartbeat);
          hostWatcher?.close();
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
        void poll(true);
        return;
      }

      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'fs' &&
        parts[4] === 'file'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        const targetPath = normalizeFsPathForRuntime(drone, u.searchParams.get('path') ?? '', {
          fallbackToHome: false,
        });
        if (!targetPath || targetPath === '/') {
          json(res, 400, { ok: false, error: 'missing file path' });
          return;
        }
        const metadataOnly = u.searchParams.get('metadata') === '1';
        const includeRevision = u.searchParams.get('revision') !== '0';

        if (runtime === 'host') {
          try {
            if (metadataOnly) {
              const resolvedPath = path.resolve(targetPath);
              const stat = await fs.stat(resolvedPath);
              if (!stat.isFile()) {
                const error = new Error(`file not found: ${resolvedPath}`) as Error & {
                  code?: string;
                };
                error.code = 'ENOENT';
                throw error;
              }
              const { kind, mime } = inferPreviewType(
                resolvedPath,
                (await hostMimeType(resolvedPath)) ?? '',
                stat.size,
              );
              const scanned = includeRevision ? await hashHostFileWithSize(resolvedPath) : null;
              if (scanned && scanned.size !== stat.size) {
                throw Object.assign(new Error('file changed while it was being read'), {
                  statusCode: 409,
                  code: 'FILE_CHANGED_DURING_READ',
                });
              }
              json(res, 200, {
                ok: true,
                id: droneId,
                name: droneName,
                path: resolvedPath,
                kind,
                mime,
                size: Number.isFinite(stat.size) ? Math.max(0, Math.floor(stat.size)) : 0,
                mtimeMs: Number.isFinite(stat.mtimeMs)
                  ? Math.max(0, Math.floor(stat.mtimeMs))
                  : null,
                revision: scanned?.revision ?? null,
              });
              return;
            }
            const read = await readHostFileBytes({ targetPath, maxBytes: FS_EDITOR_MAX_BYTES });
            const mimeRaw = String(read.mime ?? '')
              .trim()
              .toLowerCase();
            const emptyTextFile = isEmptyTextFile(targetPath, read.buf.length);
            const textLike =
              emptyTextFile || (isLikelyTextMimeType(mimeRaw) && !bufferLooksBinary(read.buf));
            if (!textLike) {
              const inferredMime = mimeRaw.startsWith('image/')
                ? mimeRaw
                : mimeRaw.startsWith('video/')
                  ? mimeRaw
                  : isLikelyImagePath(targetPath)
                    ? guessImageMimeType(targetPath)
                    : isLikelyVideoPath(targetPath)
                      ? guessVideoMimeType(targetPath)
                      : mimeRaw || 'application/octet-stream';
              const kind = inferredMime.startsWith('image/')
                ? 'image'
                : inferredMime.startsWith('video/')
                  ? 'video'
                  : 'binary';
              json(res, 200, {
                ok: true,
                id: droneId,
                name: droneName,
                path: path.resolve(targetPath),
                kind,
                mime: inferredMime,
                size: read.size,
                mtimeMs: read.mtimeMs,
                revision: sha256(read.buf),
              });
              return;
            }

            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              path: path.resolve(targetPath),
              kind: 'text',
              mime: emptyTextFile ? 'text/plain' : mimeRaw || 'text/plain',
              content: read.buf.toString('utf8'),
              size: read.size,
              mtimeMs: read.mtimeMs,
              revision: sha256(read.buf),
            });
            return;
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            const explicitStatus = Number((e as any)?.statusCode ?? 0);
            const code = explicitStatus > 0 ? explicitStatus : hostFsErrorStatus(e);
            json(res, code, {
              ok: false,
              error: msg,
              id: droneId,
              name: droneName,
              path: path.resolve(targetPath),
            });
            return;
          }
        }

        const isRepoRootBareNameRef = (() => {
          const repoPrefix = '/work/repo/';
          if (!targetPath.startsWith(repoPrefix)) return false;
          const rel = targetPath.slice(repoPrefix.length);
          return Boolean(rel) && !rel.includes('/');
        })();
        const bareName = isRepoRootBareNameRef ? targetPath.slice('/work/repo/'.length) : '';
        const buildReadScript = (pathForRead: string) =>
          [
            'set -euo pipefail',
            `target=${bashQuote(pathForRead)}`,
            `max=${String(FS_EDITOR_MAX_BYTES)}`,
            'if [ ! -f "$target" ]; then',
            '  echo "__ERR__\tnot-file"',
            '  exit 3',
            'fi',
            'size=$(wc -c < "$target" | tr -d "[:space:]")',
            'if [ -z "$size" ]; then size=0; fi',
            'mtime=$(stat -c %Y -- "$target" 2>/dev/null || echo 0)',
            'mime=""',
            'if command -v file >/dev/null 2>&1; then',
            '  mime=$(file -Lb --mime-type -- "$target" 2>/dev/null || true)',
            'fi',
            ...(metadataOnly
              ? []
              : [
                  'if [ "$size" -gt "$max" ]; then',
                  '  printf "__ERR__\ttoo-large\t%s\n" "$size"',
                  '  exit 4',
                  'fi',
                ]),
            ...(includeRevision
              ? [
                  'revision=$(sha256sum -- "$target" | cut -d " " -f 1)',
                  'size_after=$(wc -c < "$target" | tr -d "[:space:]")',
                  'if [ "$size_after" != "$size" ]; then echo "__ERR__\tchanged"; exit 6; fi',
                ]
              : ['revision=""']),
            'printf "__META__\t%s\t%s\t%s\t%s\n" "$mime" "$size" "$mtime" "$revision"',
            ...(metadataOnly ? [] : ['base64 < "$target" | tr -d "\\n"']),
          ].join('\n');

        try {
          const result = await withReadonlyDroneContainer(
            { requestedDroneName: droneName, droneEntry: resolved.drone },
            async ({ containerName }: any) => {
              const runRead = async (pathForRead: string) => {
                return await dvmExec(containerName, 'bash', ['-lc', buildReadScript(pathForRead)]);
              };

              let effectivePath = targetPath;
              let r = await runRead(effectivePath);
              let out = `${String(r.stdout ?? '')}\n${String(r.stderr ?? '')}`;

              // Best effort convenience for bare-name refs (e.g., "foo.test.ts"):
              // if exactly one file in /work/repo matches, open it; if many match, return an explicit ambiguity error.
              if (
                r.code !== 0 &&
                /__ERR__\s+not-file\b/i.test(out) &&
                isRepoRootBareNameRef &&
                bareName
              ) {
                const findScript = [
                  'set -euo pipefail',
                  'root=/work/repo',
                  `name=${bashQuote(bareName)}`,
                  'if [ ! -d "$root" ]; then exit 0; fi',
                  'find "$root" -type f -name "$name" -print 2>/dev/null | head -n 12',
                ].join('\n');
                const search = await dvmExec(containerName, 'bash', ['-lc', findScript]);
                const candidates = String(search.stdout ?? '')
                  .split('\n')
                  .map((line) => String(line).trim())
                  .filter(Boolean)
                  .map((line) => normalizeContainerPath(line));
                if (candidates.length === 1) {
                  effectivePath = candidates[0];
                  r = await runRead(effectivePath);
                  out = `${String(r.stdout ?? '')}\n${String(r.stderr ?? '')}`;
                } else if (candidates.length > 1) {
                  return {
                    kind: 'ambiguous' as const,
                    candidates: candidates.slice(0, 8),
                  };
                }
              }

              return {
                kind: 'read' as const,
                r,
                out,
                effectivePath,
              };
            },
          );
          if (result.kind === 'ambiguous') {
            const preview =
              result.candidates.length > 0 ? ` e.g. ${result.candidates.join(', ')}` : '';
            json(res, 409, {
              ok: false,
              error: `ambiguous file reference "${bareName}". Use a relative path.${preview}`,
              id: droneId,
              name: droneName,
              path: targetPath,
              candidates: result.candidates,
            });
            return;
          }

          const { r, out, effectivePath } = result;
          const stdout = String(r.stdout ?? '');
          if (r.code !== 0) {
            if (/__ERR__\s+not-file\b/i.test(out)) {
              json(res, 404, {
                ok: false,
                error: `file not found: ${effectivePath}`,
                id: droneId,
                name: droneName,
                path: effectivePath,
              });
              return;
            }
            const large = out.match(/__ERR__\s+too-large\s+(\d+)/i);
            if (large) {
              json(res, 413, {
                ok: false,
                error: `file too large (${large[1]} bytes, max ${FS_EDITOR_MAX_BYTES})`,
                id: droneId,
                name: droneName,
                path: effectivePath,
              });
              return;
            }
            json(res, 500, {
              ok: false,
              error: 'failed reading file',
              id: droneId,
              name: droneName,
              path: effectivePath,
            });
            return;
          }

          const firstNl = stdout.indexOf('\n');
          if (firstNl < 0) {
            json(res, 500, {
              ok: false,
              error: 'file response malformed',
              id: droneId,
              name: droneName,
              path: effectivePath,
            });
            return;
          }
          const metaLine = stdout.slice(0, firstNl);
          const b64 = stdout.slice(firstNl + 1).trim();
          const meta = metaLine.split('\t');
          if (meta.length < 4 || meta[0] !== '__META__') {
            json(res, 500, {
              ok: false,
              error: 'file metadata missing',
              id: droneId,
              name: droneName,
              path: effectivePath,
            });
            return;
          }

          const mimeRaw = String(meta[1] ?? '')
            .trim()
            .toLowerCase();
          const sizeNum = Number(meta[2] ?? 0);
          const mtimeSec = Number(meta[3] ?? 0);
          const revision = /^[a-f0-9]{64}$/i.test(String(meta[4] ?? ''))
            ? `sha256:${String(meta[4]).toLowerCase()}`
            : null;
          if (metadataOnly) {
            const { kind, mime } = inferPreviewType(effectivePath, mimeRaw, sizeNum);
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              path: effectivePath,
              kind,
              mime,
              size: Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : 0,
              mtimeMs: Number.isFinite(mtimeSec) ? Math.max(0, Math.floor(mtimeSec * 1000)) : null,
              revision,
            });
            return;
          }

          let buf: Buffer;
          try {
            buf = Buffer.from(b64, 'base64');
          } catch {
            json(res, 500, {
              ok: false,
              error: 'failed decoding file bytes',
              id: droneId,
              name: droneName,
              path: effectivePath,
            });
            return;
          }

          const emptyTextFile = isEmptyTextFile(effectivePath, buf.length);
          const textLike =
            emptyTextFile || (isLikelyTextMimeType(mimeRaw) && !bufferLooksBinary(buf));
          if (!textLike) {
            const inferredMime = mimeRaw.startsWith('image/')
              ? mimeRaw
              : mimeRaw.startsWith('video/')
                ? mimeRaw
                : isLikelyImagePath(effectivePath)
                  ? guessImageMimeType(effectivePath)
                  : isLikelyVideoPath(effectivePath)
                    ? guessVideoMimeType(effectivePath)
                    : mimeRaw || 'application/octet-stream';
            const kind = inferredMime.startsWith('image/')
              ? 'image'
              : inferredMime.startsWith('video/')
                ? 'video'
                : 'binary';
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              path: effectivePath,
              kind,
              mime: inferredMime,
              size: Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : 0,
              mtimeMs: Number.isFinite(mtimeSec) ? Math.max(0, Math.floor(mtimeSec * 1000)) : null,
              revision: revision ?? sha256(buf),
            });
            return;
          }

          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            path: effectivePath,
            kind: 'text',
            mime: emptyTextFile ? 'text/plain' : mimeRaw || 'text/plain',
            content: buf.toString('utf8'),
            size: Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : 0,
            mtimeMs: Number.isFinite(mtimeSec) ? Math.max(0, Math.floor(mtimeSec * 1000)) : null,
            revision: revision ?? sha256(buf),
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (/__ERR__\s+not-file\b/i.test(msg)) {
            json(res, 404, {
              ok: false,
              error: `file not found: ${targetPath}`,
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }
          const large = msg.match(/__ERR__\s+too-large\s+(\d+)/i);
          if (large) {
            json(res, 413, {
              ok: false,
              error: `file too large (${large[1]} bytes, max ${FS_EDITOR_MAX_BYTES})`,
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }
          const code = looksLikeMissingContainerError(msg) ? 404 : 500;
          json(res, code, {
            ok: false,
            error: code === 500 ? 'failed reading file' : msg,
            id: droneId,
            name: droneName,
            path: targetPath,
          });
          return;
        }
      }

      // POST /api/drones/:id/fs/file
      // Writes UTF-8 text file content for editor usage.
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'fs' &&
        parts[4] === 'file'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const targetPath = normalizeFsPathForRuntime(drone, body?.path ?? '', {
          fallbackToHome: false,
        });
        if (!targetPath || targetPath === '/') {
          json(res, 400, { ok: false, error: 'missing file path' });
          return;
        }
        if (typeof body?.content !== 'string') {
          json(res, 400, { ok: false, error: 'content must be a string' });
          return;
        }
        const content = String(body?.content ?? '');
        const expectedRevision =
          typeof body?.expectedRevision === 'string' && body.expectedRevision.trim()
            ? body.expectedRevision.trim()
            : null;
        const nextBytes = Buffer.byteLength(content, 'utf8');
        if (nextBytes > FS_EDITOR_MAX_BYTES) {
          json(res, 413, {
            ok: false,
            error: `file too large (${nextBytes} bytes, max ${FS_EDITOR_MAX_BYTES})`,
          });
          return;
        }
        if (runtime === 'host') {
          try {
            const resolvedPath = path.resolve(targetPath);
            const st = await fs.stat(resolvedPath);
            if (!st.isFile()) {
              json(res, 404, {
                ok: false,
                error: `file not found: ${resolvedPath}`,
                id: droneId,
                name: droneName,
                path: resolvedPath,
              });
              return;
            }
            if (expectedRevision) {
              const currentRevision = await hashHostFile(resolvedPath);
              if (currentRevision !== expectedRevision) {
                json(res, 409, {
                  ok: false,
                  error: 'file changed on disk',
                  code: 'FILE_CONFLICT',
                  id: droneId,
                  name: droneName,
                  path: resolvedPath,
                  currentRevision,
                });
                return;
              }
            }
            await fs.writeFile(resolvedPath, content, 'utf8');
            const after = await fs.stat(resolvedPath);
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              path: resolvedPath,
              size: Number.isFinite(after.size) ? Math.max(0, Math.floor(after.size)) : 0,
              mtimeMs: Number.isFinite(after.mtimeMs)
                ? Math.max(0, Math.floor(after.mtimeMs))
                : null,
              revision: sha256(content),
            });
            return;
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            const code = hostFsErrorStatus(e);
            json(res, code, {
              ok: false,
              error: msg,
              id: droneId,
              name: droneName,
              path: path.resolve(targetPath),
            });
            return;
          }
        }
        const contentBase64 = Buffer.from(content, 'utf8').toString('base64');

        try {
          const result = await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: resolved.drone },
            async ({ containerName }: any) => {
              const writeScript = [
                'set -euo pipefail',
                `target=${bashQuote(targetPath)}`,
                `data=${bashQuote(contentBase64)}`,
                'if [ ! -f "$target" ]; then',
                '  echo "__ERR__\tnot-file"',
                '  exit 3',
                'fi',
                ...(expectedRevision
                  ? [
                      'revision=$(sha256sum -- "$target" | cut -d " " -f 1)',
                      `if [ "sha256:$revision" != ${bashQuote(expectedRevision)} ]; then`,
                      '  printf "__ERR__\\tconflict\\t%s\\n" "$revision"',
                      '  exit 4',
                      'fi',
                    ]
                  : []),
                'printf "%s" "$data" | base64 -d > "$target"',
              ].join('\n');

              const writeOut = await dvmExec(containerName, 'bash', ['-lc', writeScript]);
              if (writeOut.code !== 0) {
                const out = `${writeOut.stdout || ''}\n${writeOut.stderr || ''}`;
                if (/\bnot-file\b/i.test(out)) {
                  const err = new Error(`file not found: ${targetPath}`) as Error & {
                    statusCode?: number;
                  };
                  err.statusCode = 404;
                  throw err;
                }
                const conflict = out.match(/__ERR__\s+conflict\s+([a-f0-9]{64})/i);
                if (conflict) {
                  const err = new Error('file changed on disk') as Error & {
                    statusCode?: number;
                    currentRevision?: string;
                  };
                  err.statusCode = 409;
                  err.currentRevision = `sha256:${conflict[1].toLowerCase()}`;
                  throw err;
                }
                throw new Error(
                  (writeOut.stderr || writeOut.stdout || 'failed writing file').trim(),
                );
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
                throw new Error(
                  (statOut.stderr || statOut.stdout || 'failed reading saved file metadata').trim(),
                );
              }
              const line = String(statOut.stdout ?? '').trim();
              const parts = line.split('\t');
              const sizeNum = Number(parts[1] ?? 0);
              const mtimeSec = Number(parts[2] ?? 0);
              return {
                size: Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : 0,
                mtimeMs: Number.isFinite(mtimeSec)
                  ? Math.max(0, Math.floor(mtimeSec * 1000))
                  : null,
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
            revision: sha256(content),
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const explicitStatus = Number((e as any)?.statusCode ?? 0);
          const code =
            explicitStatus > 0 ? explicitStatus : looksLikeMissingContainerError(msg) ? 404 : 500;
          json(res, code, {
            ok: false,
            error: msg,
            id: droneId,
            name: droneName,
            path: targetPath,
            ...((e as any)?.currentRevision
              ? { code: 'FILE_CONFLICT', currentRevision: (e as any).currentRevision }
              : {}),
          });
          return;
        }
      }

      // POST /api/drones/:id/fs/upload
      // Writes one uploaded file into a target directory inside the container.
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'fs' &&
        parts[4] === 'upload'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        await handleFsUploadRoute({ req, res, u, resolved, droneRef });
        return;
      }

      // POST /api/drones/:id/fs/action
      // Creates, renames, deletes, moves, or copies files/folders.
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'fs' &&
        parts[4] === 'action'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        await handleFsActionRoute({ req, res, resolved, droneRef });
        return;
      }

      // GET /api/drones/:id/fs/download?path=/...
      // Downloads one file or directory (directory is returned as .tar.gz).
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'fs' &&
        parts[4] === 'download'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;
        const targetPath = normalizeFsPathForRuntime(drone, u.searchParams.get('path') ?? '', {
          fallbackToHome: false,
        });
        if (!targetPath || targetPath === '/') {
          json(res, 400, { ok: false, error: 'missing path' });
          return;
        }

        const targetBaseName =
          path.basename(String(targetPath).replace(/[\/\\]+$/g, '')) || 'download';
        const safeBaseName =
          targetBaseName
            .replace(/[\0\r\n\t]/g, '')
            .replace(/[\/\\]+/g, '')
            .trim() || 'download';
        const tmpDir = path.join(
          os.tmpdir(),
          `drone-hub-fs-download-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
        );
        const hostExtractDir = path.join(tmpDir, 'extract');

        const cleanup = async () => {
          try {
            await fs.rm(tmpDir, { recursive: true, force: true });
          } catch {
            // ignore cleanup failures
          }
        };

        try {
          await fs.mkdir(hostExtractDir, { recursive: true });
          if (runtime === 'host') {
            const resolvedTargetPath = path.resolve(targetPath);
            await fs.stat(resolvedTargetPath);
            const destinationPath = path.join(hostExtractDir, safeBaseName);
            await fs.cp(resolvedTargetPath, destinationPath, { recursive: true });
          } else {
            await withReadonlyDroneContainer(
              { requestedDroneName: droneName, droneEntry: resolved.drone },
              async ({ containerName }: any) => {
                await dvmCopyFromContainer(containerName, targetPath, hostExtractDir);
              },
            );
          }

          const copiedPath = path.join(hostExtractDir, safeBaseName);
          const copiedStat = await fs.stat(copiedPath);

          let downloadPath = copiedPath;
          let downloadName = safeBaseName;
          let contentType = 'application/octet-stream';
          if (copiedStat.isDirectory()) {
            downloadName = `${safeBaseName}.tar.gz`;
            downloadPath = path.join(tmpDir, downloadName);
            const tar = await runHostCommand('tar', [
              '-czf',
              downloadPath,
              '-C',
              hostExtractDir,
              safeBaseName,
            ]);
            if (tar.code !== 0) {
              throw new Error(
                (tar.stderr || tar.stdout || 'failed creating directory archive').trim(),
              );
            }
            contentType = 'application/gzip';
          }

          const outStat = await fs.stat(downloadPath);
          const safeDownloadName =
            downloadName
              .replace(/["\\]/g, '_')
              .replace(/[\r\n\t]/g, '')
              .trim() || 'download';
          const contentDisposition = `attachment; filename="${safeDownloadName}"; filename*=UTF-8''${encodeURIComponent(safeDownloadName)}`;

          res.statusCode = 200;
          res.setHeader('content-type', contentType);
          res.setHeader('content-disposition', contentDisposition);
          res.setHeader('content-length', String(outStat.size));
          res.setHeader('cache-control', 'no-store');

          let cleaned = false;
          const cleanupOnce = () => {
            if (cleaned) return;
            cleaned = true;
            void cleanup();
          };
          const stream = createReadStream(downloadPath);
          stream.once('error', (err) => {
            cleanupOnce();
            if (!res.headersSent) {
              json(res, 500, {
                ok: false,
                error: err?.message ?? String(err),
                id: droneId,
                name: droneName,
                path: targetPath,
              });
              return;
            }
            try {
              res.destroy(err as Error);
            } catch {
              // ignore destroy failure
            }
          });
          stream.once('end', cleanupOnce);
          res.once('close', cleanupOnce);
          stream.pipe(res);
          return;
        } catch (e: any) {
          await cleanup();
          const msg = e?.message ?? String(e);
          const explicitStatus = Number((e as any)?.statusCode ?? 0);
          const missingPath = /no such file|cannot stat|could not find|not found|lstat/i.test(msg);
          const code =
            explicitStatus > 0
              ? explicitStatus
              : runtime === 'host'
                ? hostFsErrorStatus(e)
                : missingPath || looksLikeMissingContainerError(msg)
                  ? 404
                  : 500;
          json(res, code, {
            ok: false,
            error: msg,
            id: droneId,
            name: droneName,
            path: targetPath,
          });
          return;
        }
      }

      // GET/HEAD /api/drones/:id/fs/media?path=/...
      // Returns image/video bytes for preview rendering.
      if (
        (method === 'GET' || method === 'HEAD') &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'fs' &&
        parts[4] === 'media'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        const targetPath = normalizeFsPathForRuntime(drone, u.searchParams.get('path') ?? '', {
          fallbackToHome: false,
        });
        if (!targetPath || targetPath === '/') {
          json(res, 400, { ok: false, error: 'missing file path' });
          return;
        }
        const requestedRevision = u.searchParams.get('revision');
        const requestedRange = parseRequestedByteRange(req.headers.range);
        const requestedMaxBytes = Number(u.searchParams.get('maxBytes'));
        const mediaMaxBytes =
          Number.isSafeInteger(requestedMaxBytes) && requestedMaxBytes > 0
            ? Math.min(FS_MEDIA_MAX_BYTES, requestedMaxBytes)
            : FS_MEDIA_MAX_BYTES;
        const headOnly = method === 'HEAD';
        const abortController = new AbortController();
        req.once('aborted', () => abortController.abort());
        res.once('close', () => {
          if (!res.writableEnded) abortController.abort();
        });

        if (runtime === 'host') {
          try {
            const resolvedPath = path.resolve(targetPath);
            const read = await readHostMediaRange({
              targetPath: resolvedPath,
              maxBytes: mediaMaxBytes,
              requestedRange,
              includeRevision: Boolean(String(requestedRevision ?? '').trim()),
              retainBytes: !headOnly,
              signal: abortController.signal,
            });
            const mimeRaw = String(await hostMimeType(resolvedPath))
              .trim()
              .toLowerCase();
            const mime = mimeRaw.startsWith('image/')
              ? mimeRaw
              : mimeRaw.startsWith('video/')
                ? mimeRaw
                : isLikelyImagePath(targetPath)
                  ? guessImageMimeType(targetPath)
                  : isLikelyVideoPath(targetPath)
                    ? guessVideoMimeType(targetPath)
                    : 'application/octet-stream';
            if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
              json(res, 415, {
                ok: false,
                error: 'not an image or video file',
                id: droneId,
                name: droneName,
                path: path.resolve(targetPath),
              });
              return;
            }

            const cacheControl = cacheControlForServedFile({
              res,
              requestedRevision,
              servedRevision: read.servedRevision,
              droneId,
              droneName,
              targetPath: resolvedPath,
            });
            if (cacheControl == null) return;
            sendMediaBytes({
              res,
              bytes: read.bytes,
              totalBytes: read.totalBytes,
              range: read.range,
              mime,
              cacheControl,
              headOnly,
            });
            return;
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            const explicitStatus = Number((e as any)?.statusCode ?? 0);
            if (explicitStatus === 416) {
              res.statusCode = 416;
              res.setHeader('accept-ranges', 'bytes');
              res.setHeader('content-range', `bytes */${Math.max(0, Number(e?.size) || 0)}`);
              res.end();
              return;
            }
            if (explicitStatus === 413) {
              const size = Number((e as any)?.size ?? NaN);
              const sizeText = Number.isFinite(size)
                ? `${Math.max(0, Math.floor(size))}`
                : 'unknown';
              json(res, 413, {
                ok: false,
                error: `media too large (${sizeText} bytes, max ${mediaMaxBytes})`,
                id: droneId,
                name: droneName,
                path: path.resolve(targetPath),
              });
              return;
            }
            const code = explicitStatus > 0 ? explicitStatus : hostFsErrorStatus(e);
            json(res, code, {
              ok: false,
              error: code === 500 ? 'failed reading media' : msg,
              id: droneId,
              name: droneName,
              path: path.resolve(targetPath),
            });
            return;
          }
        }

        const script = buildContainerMediaRangeScript({
          targetPath,
          maxBytes: mediaMaxBytes,
          requestedRange,
          includeRevision: Boolean(String(requestedRevision ?? '').trim()),
          includeBody: !headOnly,
        });

        try {
          const r = await withReadonlyDroneContainer(
            { requestedDroneName: droneName, droneEntry: resolved.drone },
            async ({ containerName }: any) => {
              return await dvmExec(containerName, 'bash', ['-lc', script], {
                timeoutMs: 60_000,
                maxOutputBytes: Math.ceil((mediaMaxBytes * 4) / 3) + 64 * 1024,
                signal: abortController.signal,
              });
            },
          );
          const stdout = String(r.stdout ?? '');
          const out = `${stdout}\n${String(r.stderr ?? '')}`;
          if (r.code !== 0) {
            if (/__ERR__\s+not-file\b/i.test(out)) {
              json(res, 404, {
                ok: false,
                error: `file not found: ${targetPath}`,
                id: droneId,
                name: droneName,
                path: targetPath,
              });
              return;
            }
            const large = out.match(/__ERR__\s+too-large\s+(\d+)/i);
            if (large) {
              json(res, 413, {
                ok: false,
                error: `media too large (${large[1]} bytes, max ${mediaMaxBytes})`,
                id: droneId,
                name: droneName,
                path: targetPath,
              });
              return;
            }
            const invalidRange = out.match(/__ERR__\s+range\s+(\d+)/i);
            if (invalidRange) {
              res.statusCode = 416;
              res.setHeader('accept-ranges', 'bytes');
              res.setHeader('content-range', `bytes */${invalidRange[1]}`);
              res.end();
              return;
            }
            json(res, 500, {
              ok: false,
              error: 'failed reading media',
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }

          const firstNl = stdout.indexOf('\n');
          if (firstNl < 0) {
            json(res, 500, {
              ok: false,
              error: 'media response malformed',
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }
          const metaLine = stdout.slice(0, firstNl);
          const b64 = stdout.slice(firstNl + 1).trim();
          const meta = metaLine.split('\t');
          if (meta.length < 8 || meta[0] !== '__META__') {
            json(res, 500, {
              ok: false,
              error: 'media metadata missing',
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }

          const mimeRaw = String(meta[1] ?? '')
            .trim()
            .toLowerCase();
          const mime = mimeRaw.startsWith('image/')
            ? mimeRaw
            : mimeRaw.startsWith('video/')
              ? mimeRaw
              : isLikelyImagePath(targetPath)
                ? guessImageMimeType(targetPath)
                : isLikelyVideoPath(targetPath)
                  ? guessVideoMimeType(targetPath)
                  : 'application/octet-stream';
          if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
            json(res, 415, {
              ok: false,
              error: 'not an image or video file',
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }

          const total = Number(meta[2]);
          const start = Number(meta[3]);
          const count = Number(meta[4]);
          const partial = meta[5] === '1';
          const servedRevision = String(meta[6] ?? '').trim();
          const actualSize = Number(meta[7]);
          if (
            !Number.isSafeInteger(total) ||
            total < 0 ||
            !Number.isSafeInteger(start) ||
            start < 0 ||
            !Number.isSafeInteger(count) ||
            count < 0 ||
            !Number.isSafeInteger(actualSize) ||
            actualSize < 0
          ) {
            json(res, 500, {
              ok: false,
              error: 'media metadata invalid',
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }
          if (actualSize !== total) {
            json(res, 409, {
              ok: false,
              code: 'FILE_CHANGED_DURING_READ',
              error: 'file changed while it was being read',
              id: droneId,
              name: droneName,
              path: targetPath,
              ...(servedRevision ? { currentRevision: `sha256:${servedRevision}` } : {}),
            });
            return;
          }

          let buf: Buffer;
          try {
            buf = Buffer.from(b64, 'base64');
          } catch {
            json(res, 500, {
              ok: false,
              error: 'failed decoding media bytes',
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }
          if (
            (!headOnly && buf.length !== count) ||
            (headOnly && buf.length !== 0) ||
            start + count > total
          ) {
            json(res, 409, {
              ok: false,
              code: 'FILE_CHANGED_DURING_READ',
              error: 'file changed while it was being read',
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }

          const cacheControl = cacheControlForServedFile({
            res,
            requestedRevision,
            ...(servedRevision
              ? { servedRevision: `sha256:${servedRevision}` }
              : partial
                ? {}
                : { bytes: buf }),
            droneId,
            droneName,
            targetPath,
          });
          if (cacheControl == null) return;
          const range: ResolvedByteRange = partial
            ? { kind: 'range', start, end: start + count - 1, length: count }
            : { kind: 'full', start: 0, end: Math.max(-1, total - 1), length: total };
          sendMediaBytes({
            res,
            bytes: buf,
            totalBytes: total,
            range,
            mime,
            cacheControl,
            headOnly,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (/__ERR__\s+not-file\b/i.test(msg)) {
            json(res, 404, {
              ok: false,
              error: `file not found: ${targetPath}`,
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }
          const large = msg.match(/__ERR__\s+too-large\s+(\d+)/i);
          if (large) {
            json(res, 413, {
              ok: false,
              error: `media too large (${large[1]} bytes, max ${mediaMaxBytes})`,
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }
          const invalidRange = msg.match(/__ERR__\s+range\s+(\d+)/i);
          if (invalidRange) {
            res.statusCode = 416;
            res.setHeader('accept-ranges', 'bytes');
            res.setHeader('content-range', `bytes */${invalidRange[1]}`);
            res.end();
            return;
          }
          const code = looksLikeMissingContainerError(msg) ? 404 : 500;
          json(res, code, {
            ok: false,
            error: code === 500 ? 'failed reading media' : msg,
            id: droneId,
            name: droneName,
            path: targetPath,
          });
          return;
        }
      }

      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'fs' &&
        parts[4] === 'thumb'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        const targetPath = normalizeFsPathForRuntime(drone, u.searchParams.get('path') ?? '', {
          fallbackToHome: false,
        });
        if (!targetPath || targetPath === '/') {
          json(res, 400, { ok: false, error: 'missing file path' });
          return;
        }
        const requestedRevision = u.searchParams.get('revision');
        if (!isLikelyImagePath(targetPath)) {
          json(res, 415, { ok: false, error: 'not an image file' });
          return;
        }

        if (runtime === 'host') {
          try {
            const read = await readHostFileBytes({ targetPath, maxBytes: FS_THUMB_MAX_BYTES });
            const mimeRaw = String(read.mime ?? '')
              .trim()
              .toLowerCase();
            const mime = mimeRaw.startsWith('image/') ? mimeRaw : guessImageMimeType(targetPath);
            if (!mime.startsWith('image/')) {
              json(res, 415, {
                ok: false,
                error: 'not an image file',
                id: droneId,
                name: droneName,
                path: path.resolve(targetPath),
              });
              return;
            }

            const cacheControl = cacheControlForServedFile({
              res,
              requestedRevision,
              bytes: read.buf,
              droneId,
              droneName,
              targetPath: path.resolve(targetPath),
            });
            if (cacheControl == null) return;

            res.statusCode = 200;
            res.setHeader('content-type', mime);
            res.setHeader('cache-control', cacheControl);
            res.end(read.buf);
            return;
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            const explicitStatus = Number((e as any)?.statusCode ?? 0);
            if (explicitStatus === 413) {
              const size = Number((e as any)?.size ?? NaN);
              const sizeText = Number.isFinite(size)
                ? `${Math.max(0, Math.floor(size))}`
                : 'unknown';
              json(res, 413, {
                ok: false,
                error: `image too large (${sizeText} bytes, max ${FS_THUMB_MAX_BYTES})`,
                id: droneId,
                name: droneName,
                path: path.resolve(targetPath),
              });
              return;
            }
            const code = explicitStatus > 0 ? explicitStatus : hostFsErrorStatus(e);
            json(res, code, {
              ok: false,
              error: code === 500 ? 'failed reading thumbnail' : msg,
              id: droneId,
              name: droneName,
              path: path.resolve(targetPath),
            });
            return;
          }
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
          const r = await withReadonlyDroneContainer(
            { requestedDroneName: droneName, droneEntry: resolved.drone },
            async ({ containerName }: any) => {
              return await dvmExec(containerName, 'bash', ['-lc', script]);
            },
          );
          const stdout = String(r.stdout ?? '');
          const out = `${stdout}\n${String(r.stderr ?? '')}`;
          if (r.code !== 0) {
            if (/__ERR__\s+not-file\b/i.test(out)) {
              json(res, 404, {
                ok: false,
                error: `file not found: ${targetPath}`,
                id: droneId,
                name: droneName,
                path: targetPath,
              });
              return;
            }
            const large = out.match(/__ERR__\s+too-large\s+(\d+)/i);
            if (large) {
              json(res, 413, {
                ok: false,
                error: `image too large (${large[1]} bytes, max ${FS_THUMB_MAX_BYTES})`,
                id: droneId,
                name: droneName,
                path: targetPath,
              });
              return;
            }
            json(res, 500, {
              ok: false,
              error: 'failed reading thumbnail',
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }

          const firstNl = stdout.indexOf('\n');
          if (firstNl < 0) {
            json(res, 500, {
              ok: false,
              error: 'thumbnail response malformed',
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }
          const metaLine = stdout.slice(0, firstNl);
          const b64 = stdout.slice(firstNl + 1).trim();
          const meta = metaLine.split('\t');
          if (meta.length < 3 || meta[0] !== '__META__') {
            json(res, 500, {
              ok: false,
              error: 'thumbnail metadata missing',
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }

          const mimeRaw = String(meta[1] ?? '')
            .trim()
            .toLowerCase();
          const mime = mimeRaw.startsWith('image/') ? mimeRaw : guessImageMimeType(targetPath);
          if (!mime.startsWith('image/')) {
            json(res, 415, {
              ok: false,
              error: 'not an image file',
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }

          let buf: Buffer;
          try {
            buf = Buffer.from(b64, 'base64');
          } catch {
            json(res, 500, {
              ok: false,
              error: 'failed decoding image bytes',
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }

          const cacheControl = cacheControlForServedFile({
            res,
            requestedRevision,
            bytes: buf,
            droneId,
            droneName,
            targetPath,
          });
          if (cacheControl == null) return;

          res.statusCode = 200;
          res.setHeader('content-type', mime);
          res.setHeader('cache-control', cacheControl);
          res.end(buf);
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (/__ERR__\s+not-file\b/i.test(msg)) {
            json(res, 404, {
              ok: false,
              error: `file not found: ${targetPath}`,
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }
          const large = msg.match(/__ERR__\s+too-large\s+(\d+)/i);
          if (large) {
            json(res, 413, {
              ok: false,
              error: `image too large (${large[1]} bytes, max ${FS_THUMB_MAX_BYTES})`,
              id: droneId,
              name: droneName,
              path: targetPath,
            });
            return;
          }
          const code = looksLikeMissingContainerError(msg) ? 404 : 500;
          json(res, code, {
            ok: false,
            error: code === 500 ? 'failed reading thumbnail' : msg,
            id: droneId,
            name: droneName,
            path: targetPath,
          });
          return;
        }
      }

      // GET /api/drones/:id/preview/:containerPort/*
      // Reverse-proxies HTTP traffic to a container port (resolved via host mapping).
      if (
        method === 'GET' &&
        parts.length >= 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'preview'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const containerPort = Number(parts[4]);
        if (
          !Number.isFinite(containerPort) ||
          containerPort <= 0 ||
          Math.floor(containerPort) !== containerPort
        ) {
          json(res, 400, { ok: false, error: 'invalid container port' });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        try {
          let mappedHostPort = 0;
          if (runtime === 'host') {
            mappedHostPort = containerPort;
          } else {
            const ports = await withReadonlyDroneContainer(
              { requestedDroneName: droneName, droneEntry: drone },
              async ({ containerName }: any) => {
                return await dvmPorts(containerName);
              },
            );
            const mapped = ports.find(
              (p: any) =>
                Number(p?.containerPort) === containerPort &&
                typeof p?.hostPort === 'number' &&
                Number.isFinite(p.hostPort),
            );
            mappedHostPort = Number(mapped?.hostPort ?? 0);
          }
          if (!mappedHostPort) {
            json(res, 404, {
              ok: false,
              error: `container port ${containerPort} is not mapped on host`,
              id: droneId,
              name: droneName,
            });
            return;
          }

          const restPath =
            parts.length > 5
              ? `/${parts
                  .slice(5)
                  .map((seg) => encodeURIComponent(seg))
                  .join('/')}`
              : '/';
          const targetUrl = `http://127.0.0.1:${mappedHostPort}${restPath}${u.search || ''}`;
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
          json(res, 502, {
            ok: false,
            error: `preview proxy failed: ${msg}`,
            id: droneId,
            name: droneName,
          });
          return;
        }
      }

      if (
        method === 'GET' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'ports'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;
        try {
          const ports =
            runtime === 'host'
              ? (() => {
                  const hostPort = Number((drone as any)?.hostPort ?? NaN);
                  const containerPort = Number((drone as any)?.containerPort ?? hostPort);
                  if (
                    !Number.isFinite(hostPort) ||
                    hostPort <= 0 ||
                    !Number.isFinite(containerPort) ||
                    containerPort <= 0
                  )
                    return [];
                  return [
                    { hostPort: Math.floor(hostPort), containerPort: Math.floor(containerPort) },
                  ];
                })()
              : await withReadonlyDroneContainer(
                  { requestedDroneName: droneName, droneEntry: drone },
                  async ({ containerName }: any) => {
                    return await dvmPorts(containerName);
                  },
                );
          json(res, 200, { ok: true, id: droneId, name: droneName, runtime, ports });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = looksLikeMissingContainerError(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, id: droneId, name: droneName });
          return;
        }
      }

      return false;
    })();
    return handled !== false;
  };
}
