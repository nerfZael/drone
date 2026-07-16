import crypto from 'node:crypto';
import type http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { URL } from 'node:url';

import type { ResolvedDrone } from './drone-lifecycle-service';
import type { ContainerFsEntry } from './filesystem-media';
import { createAssistantFilesystemService } from './assistant-filesystem-service';

type FilesystemRuntimeDependencyName =
  | 'NON_REPO_HOME_CWD'
  | 'bashQuote'
  | 'defaultDroneHomeCwd'
  | 'droneRepoPathInContainer'
  | 'droneRuntime'
  | 'dvmCopyToContainer'
  | 'dvmExec'
  | 'extensionLower'
  | 'isLikelyImagePath'
  | 'isLikelyVideoPath'
  | 'isRepoAttachedDrone'
  | 'json'
  | 'looksLikeMissingContainerError'
  | 'normalizeContainerPath'
  | 'normalizeDroneCwdForRuntime'
  | 'readJsonBody'
  | 'resolveEffectiveFilesystemSettings'
  | 'runHostCommand'
  | 'sortFsEntries'
  | 'withLockedDroneContainer'
  | 'withReadonlyDroneContainer';

export type FilesystemRuntimeDependencies = {
  [Key in FilesystemRuntimeDependencyName]: any;
};

export function createFilesystemRuntime(dependencies: FilesystemRuntimeDependencies) {
  const {
    NON_REPO_HOME_CWD,
    bashQuote,
    defaultDroneHomeCwd,
    droneRepoPathInContainer,
    droneRuntime,
    dvmCopyToContainer,
    dvmExec,
    extensionLower,
    isLikelyImagePath,
    isLikelyVideoPath,
    isRepoAttachedDrone,
    json,
    looksLikeMissingContainerError,
    normalizeContainerPath,
    normalizeDroneCwdForRuntime,
    readJsonBody,
    resolveEffectiveFilesystemSettings,
    runHostCommand,
    sortFsEntries,
    withLockedDroneContainer,
    withReadonlyDroneContainer,
  } = dependencies;

  async function handleFsUploadRoute(opts: {
    req: http.IncomingMessage;
    res: http.ServerResponse;
    u: URL;
    resolved: ResolvedDrone;
    droneRef: string;
  }): Promise<void> {
    const { req, res, u, resolved, droneRef } = opts;
    const droneId = resolved.id;
    const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
    const runtime = droneRuntime(resolved.drone);
    const fail = (statusCode: number, message: string) => {
      const err = new Error(message) as Error & { statusCode?: number };
      err.statusCode = statusCode;
      return err;
    };
    const { uploadMaxBytes: fsUploadMaxBytes } = await resolveEffectiveFilesystemSettings();
    const headerValue = (name: string): string => {
      const raw = req.headers[name.toLowerCase()];
      if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
      return String(raw ?? '').trim();
    };
    const failFileTooLarge = (sizeBytes: number) =>
      fail(
        413,
        `file too large (${sizeBytes} bytes, max ${fsUploadMaxBytes}). Increase "Upload max file size" in Settings.`,
      );
    const normalizeUploadFileName = (raw: string): string =>
      path.posix
        .basename(raw)
        .replace(/[\0\r\n\t]/g, '')
        .replace(/[\/\\]+/g, '')
        .trim();
    const decodeUploadNameHeader = (): string => {
      const encoded = headerValue('x-upload-name');
      if (!encoded) return '';
      try {
        return decodeURIComponent(encoded);
      } catch {
        throw fail(400, 'invalid x-upload-name header');
      }
    };
    const writeUploadStreamToTmpPath = async (tmpPath: string): Promise<void> => {
      const fh = await fs.open(tmpPath, 'w');
      try {
        let total = 0;
        for await (const chunkRaw of req) {
          const chunk = Buffer.isBuffer(chunkRaw) ? chunkRaw : Buffer.from(chunkRaw as any);
          total += chunk.length;
          if (total > fsUploadMaxBytes) throw failFileTooLarge(total);
          await fh.write(chunk);
        }
        await fh.sync();
      } finally {
        await fh.close();
      }
    };
    const copyTmpFileToRuntimeAndReadMeta = async (opts: {
      tmpPath: string;
      targetDir: string;
      fileName: string;
    }): Promise<{
      path: string;
      size: number;
      mtimeMs: number | null;
    }> => {
      const { tmpPath, targetDir, fileName } = opts;
      if (runtime === 'host') {
        const hostTargetDir = path.resolve(
          String(targetDir ?? '').trim() || normalizeDroneCwdForRuntime(resolved.drone, null),
        );
        const preflight = await fs.stat(hostTargetDir);
        if (!preflight.isDirectory()) throw fail(404, `path is not a directory: ${hostTargetDir}`);
        const hostTargetPath = path.join(hostTargetDir, fileName);
        await fs.copyFile(tmpPath, hostTargetPath);
        const st = await fs.stat(hostTargetPath);
        if (!st.isFile()) throw fail(404, `uploaded file not found: ${hostTargetPath}`);
        return {
          path: path.resolve(hostTargetPath),
          size: Number.isFinite(st.size) ? Math.max(0, Math.floor(st.size)) : 0,
          mtimeMs: Number.isFinite(st.mtimeMs) ? Math.max(0, Math.floor(st.mtimeMs)) : null,
        };
      }
      return await withLockedDroneContainer(
        { requestedDroneName: droneName, droneEntry: resolved.drone },
        async ({ containerName }: any) => {
          const preflightScript = [
            'set -euo pipefail',
            `target_dir=${bashQuote(targetDir)}`,
            'if [ ! -d "$target_dir" ]; then',
            '  echo "__ERR__\tnot-dir"',
            '  exit 3',
            'fi',
          ].join('\n');
          const preflight = await dvmExec(containerName, 'bash', ['-lc', preflightScript]);
          if (preflight.code !== 0) {
            const out = `${String(preflight.stdout ?? '')}\n${String(preflight.stderr ?? '')}`;
            if (/\bnot-dir\b/i.test(out)) throw fail(404, `path is not a directory: ${targetDir}`);
            throw new Error(
              (preflight.stderr || preflight.stdout || 'failed checking upload path').trim(),
            );
          }

          await dvmCopyToContainer(containerName, tmpPath, targetDir);

          const targetPath = normalizeContainerPath(path.posix.join(targetDir, fileName));
          const statScript = [
            'set -euo pipefail',
            `target=${bashQuote(targetPath)}`,
            'if [ ! -f "$target" ]; then',
            '  echo "__ERR__\tnot-file"',
            '  exit 3',
            'fi',
            'size=$(stat -c %s -- "$target" 2>/dev/null || echo 0)',
            'mtime=$(stat -c %Y -- "$target" 2>/dev/null || echo 0)',
            'printf "__META__\t%s\t%s\n" "$size" "$mtime"',
          ].join('\n');
          const statOut = await dvmExec(containerName, 'bash', ['-lc', statScript]);
          if (statOut.code !== 0) {
            const out = `${String(statOut.stdout ?? '')}\n${String(statOut.stderr ?? '')}`;
            if (/\bnot-file\b/i.test(out))
              throw fail(404, `uploaded file not found: ${targetPath}`);
            throw new Error(
              (statOut.stderr || statOut.stdout || 'failed reading uploaded file metadata').trim(),
            );
          }
          const line = String(statOut.stdout ?? '').trim();
          const parts = line.split('\t');
          const sizeNum = Number(parts[1] ?? 0);
          const mtimeSec = Number(parts[2] ?? 0);
          return {
            path: targetPath,
            size: Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : 0,
            mtimeMs: Number.isFinite(mtimeSec) ? Math.max(0, Math.floor(mtimeSec * 1000)) : null,
          };
        },
      );
    };
    const respondUploadSuccess = (result: {
      path: string;
      size: number;
      mtimeMs: number | null;
    }) => {
      json(res, 200, {
        ok: true,
        id: droneId,
        name: droneName,
        path: result.path,
        size: result.size,
        mtimeMs: result.mtimeMs,
      });
    };

    const contentType = headerValue('content-type').toLowerCase();
    const isJsonUpload = contentType.includes('application/json');
    let targetDir = normalizeFsPathForRuntime(resolved.drone, u.searchParams.get('path') ?? '', {
      fallbackToHome: true,
    });
    let fileNameRaw = String(u.searchParams.get('name') ?? '').trim();

    const tmpDir = path.join(
      os.tmpdir(),
      `drone-hub-fs-upload-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
    );

    try {
      if (isJsonUpload) {
        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          throw fail(400, e?.message ?? String(e));
        }
        if (!targetDir)
          targetDir = normalizeFsPathForRuntime(resolved.drone, body?.path ?? '', {
            fallbackToHome: true,
          });
        if (!fileNameRaw) fileNameRaw = String(body?.name ?? '').trim();
        if (typeof body?.dataBase64 !== 'string') throw fail(400, 'dataBase64 must be a string');
        const dataBase64 = String(body?.dataBase64 ?? '').replace(/\s+/g, '');
        if (
          dataBase64.length > 0 &&
          (!/^[A-Za-z0-9+/=]+$/.test(dataBase64) || dataBase64.length % 4 !== 0)
        ) {
          throw fail(400, 'invalid base64 payload');
        }
        let bytes: Buffer;
        try {
          bytes = Buffer.from(dataBase64, 'base64');
        } catch {
          throw fail(400, 'invalid base64 payload');
        }
        if (bytes.length > fsUploadMaxBytes) throw failFileTooLarge(bytes.length);
        const fileName = normalizeUploadFileName(fileNameRaw);
        if (!targetDir) throw fail(400, 'missing directory path');
        if (!fileName || fileName === '.' || fileName === '..')
          throw fail(400, 'invalid file name');
        const tmpPath = path.join(tmpDir, fileName);
        await fs.mkdir(tmpDir, { recursive: true });
        await fs.writeFile(tmpPath, bytes);
        const result = await copyTmpFileToRuntimeAndReadMeta({ tmpPath, targetDir, fileName });
        respondUploadSuccess(result);
        return;
      }

      if (!targetDir)
        targetDir = normalizeFsPathForRuntime(resolved.drone, headerValue('x-upload-path'), {
          fallbackToHome: true,
        });
      if (!fileNameRaw) fileNameRaw = decodeUploadNameHeader();
      const fileName = normalizeUploadFileName(fileNameRaw);
      if (!targetDir) throw fail(400, 'missing directory path');
      if (!fileName || fileName === '.' || fileName === '..') throw fail(400, 'invalid file name');
      const tmpPath = path.join(tmpDir, fileName);
      await fs.mkdir(tmpDir, { recursive: true });
      await writeUploadStreamToTmpPath(tmpPath);
      const result = await copyTmpFileToRuntimeAndReadMeta({ tmpPath, targetDir, fileName });
      respondUploadSuccess(result);
      return;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      const explicitStatus = Number((e as any)?.statusCode ?? 0);
      const code =
        explicitStatus > 0
          ? explicitStatus
          : runtime === 'host'
            ? hostFsErrorStatus(e)
            : looksLikeMissingContainerError(msg)
              ? 404
              : 500;
      json(res, code, {
        ok: false,
        error: msg,
        id: droneId,
        name: droneName,
        path: targetDir || undefined,
      });
      return;
    } finally {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    }
  }

  function normalizeFsPathForRuntime(
    drone: any,
    raw: unknown,
    opts?: { fallbackToHome?: boolean },
  ): string {
    const runtime = droneRuntime(drone);
    if (runtime === 'host') {
      const text = typeof raw === 'string' ? String(raw).trim() : '';
      if (!text && opts?.fallbackToHome === false) return '';
      return normalizeDroneCwdForRuntime(drone, text || null);
    }
    const text = typeof raw === 'string' ? String(raw) : '';
    return normalizeContainerPath(text || '/');
  }

  function hostFsErrorStatus(error: unknown): number {
    const code = String((error as any)?.code ?? '')
      .trim()
      .toUpperCase();
    if (code === 'ENOENT' || code === 'ENOTDIR') return 404;
    if (code === 'EACCES' || code === 'EPERM') return 403;
    return 500;
  }

  async function hostMimeType(pathRaw: string): Promise<string | null> {
    const targetPath = String(pathRaw ?? '').trim();
    if (!targetPath) return null;
    try {
      const r = await runHostCommand('file', ['-Lb', '--mime-type', '--', targetPath], {
        timeoutMs: 2500,
      });
      if (r.code !== 0) return null;
      const mime = String(r.stdout ?? '')
        .trim()
        .toLowerCase();
      if (!mime) return null;
      return mime.split(/\s+/)[0] || null;
    } catch {
      return null;
    }
  }

  async function listHostFsDirectory(
    targetPathRaw: string,
  ): Promise<{ resolvedPath: string; entries: ContainerFsEntry[] }> {
    const resolvedPath = path.resolve(
      String(targetPathRaw ?? '').trim() || path.resolve(os.homedir()),
    );
    const dirStat = await fs.stat(resolvedPath);
    if (!dirStat.isDirectory()) {
      const err = new Error(`path is not a directory: ${resolvedPath}`) as Error & {
        code?: string;
      };
      err.code = 'ENOTDIR';
      throw err;
    }

    const dirents = await fs.readdir(resolvedPath, { withFileTypes: true });
    const entries: ContainerFsEntry[] = [];
    for (const d of dirents) {
      const name = String(d?.name ?? '').trim();
      if (!name || name === '.' || name === '..') continue;
      const fullPath = path.join(resolvedPath, name);
      let stat: any = null;
      try {
        stat = await fs.lstat(fullPath);
      } catch {
        stat = null;
      }
      const kind: ContainerFsEntry['kind'] =
        d.isDirectory() || Boolean(stat?.isDirectory())
          ? 'directory'
          : d.isFile() || Boolean(stat?.isFile())
            ? 'file'
            : 'other';
      const ext = kind === 'file' ? extensionLower(name) || null : null;
      entries.push({
        name,
        path: fullPath,
        kind,
        size: stat && Number.isFinite(stat.size) ? Math.max(0, Math.floor(stat.size)) : null,
        mtimeMs:
          stat && Number.isFinite(stat.mtimeMs) ? Math.max(0, Math.floor(stat.mtimeMs)) : null,
        ext,
        isImage: kind === 'file' ? isLikelyImagePath(name) : false,
        isVideo: kind === 'file' ? isLikelyVideoPath(name) : false,
      });
    }
    sortFsEntries(entries);
    return { resolvedPath, entries };
  }

  function parseFsSearchOutput(
    text: string,
    fallbackRoot: string,
  ): { root: string; entries: ContainerFsEntry[] } {
    const lines = String(text ?? '')
      .split('\n')
      .map((line) => line.replace(/\r$/, ''))
      .filter(Boolean);
    let root = normalizeContainerPath(fallbackRoot) || fallbackRoot || '/';
    const entries: ContainerFsEntry[] = [];

    for (const line of lines) {
      if (line.startsWith('__ROOT__\t')) {
        root = line.slice('__ROOT__\t'.length).trim() || root;
        continue;
      }
      const parts = line.split('\t');
      if (parts.length < 4) continue;
      const relativePath = String(parts[0] ?? '').trim();
      const fullPath = String(parts[1] ?? '').trim();
      if (!relativePath || !fullPath) continue;
      const sizeNum = Number(parts[2] ?? 0);
      const mtimeSec = Number(parts[3] ?? 0);
      const name =
        path.posix.basename(relativePath.replace(/\\/g, '/')) ||
        path.basename(fullPath) ||
        fullPath;
      entries.push({
        name,
        path: fullPath,
        relativePath,
        kind: 'file',
        size: Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : null,
        mtimeMs: Number.isFinite(mtimeSec) ? Math.max(0, Math.floor(mtimeSec * 1000)) : null,
        ext: extensionLower(name) || null,
        isImage: isLikelyImagePath(name),
        isVideo: isLikelyVideoPath(name),
      });
    }

    return { root, entries };
  }

  function buildFsSearchScript(opts: {
    root: string;
    query: string;
    limit: number;
    pathFlavor: 'posix' | 'host';
  }): string {
    const excludeCase = [
      '.git/*',
      'node_modules/*',
      'dist/*',
      'build/*',
      '.next/*',
      '.turbo/*',
      'coverage/*',
      '.cache/*',
    ].join('|');
    const rgGlobs = [
      '--glob "!.git/**"',
      '--glob "!node_modules/**"',
      '--glob "!dist/**"',
      '--glob "!build/**"',
      '--glob "!.next/**"',
      '--glob "!.turbo/**"',
      '--glob "!coverage/**"',
      '--glob "!.cache/**"',
    ].join(' ');
    const joinFullPath =
      opts.pathFlavor === 'host'
        ? 'full="$resolved/$rel"'
        : 'if [ "$resolved" = "/" ]; then full="/$rel"; else full="$resolved/$rel"; fi';
    return [
      'set -euo pipefail',
      `root=${bashQuote(opts.root)}`,
      `query=${bashQuote(opts.query.toLowerCase())}`,
      `limit=${String(opts.limit)}`,
      `if [ "$root" = ${bashQuote(NON_REPO_HOME_CWD)} ]; then mkdir -p ${bashQuote(NON_REPO_HOME_CWD)} 2>/dev/null || true; fi`,
      'if [ ! -d "$root" ]; then echo "__ERR__\tnot-dir"; exit 3; fi',
      'cd "$root"',
      'resolved=$(pwd -P)',
      'printf "__ROOT__\t%s\n" "$resolved"',
      'list_files() {',
      '  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
      '    git ls-files -co --exclude-standard -- . 2>/dev/null || true',
      '  elif command -v rg >/dev/null 2>&1; then',
      `    rg --files --hidden ${rgGlobs} . 2>/dev/null || true`,
      '  else',
      '    find . \\( -path "*/.git/*" -o -path "*/node_modules/*" -o -path "*/dist/*" -o -path "*/build/*" -o -path "*/.next/*" -o -path "*/.turbo/*" -o -path "*/coverage/*" -o -path "*/.cache/*" \\) -prune -o -type f -print 2>/dev/null || true',
      '  fi',
      '}',
      'count=0',
      'while IFS= read -r rel; do',
      '  rel="${rel#./}"',
      '  [ -n "$rel" ] || continue',
      `  case "$rel" in ${excludeCase}) continue ;; esac`,
      '  if [ -n "$query" ]; then',
      '    lower=$(printf "%s" "$rel" | tr "[:upper:]" "[:lower:]")',
      '    case "$lower" in *"$query"*) ;; *) continue ;; esac',
      '  fi',
      '  [ -f "$rel" ] || continue',
      `  ${joinFullPath}`,
      '  size=$(stat -c %s -- "$rel" 2>/dev/null || stat -f %z -- "$rel" 2>/dev/null || echo 0)',
      '  mtime=$(stat -c %Y -- "$rel" 2>/dev/null || stat -f %m -- "$rel" 2>/dev/null || echo 0)',
      '  printf "%s\t%s\t%s\t%s\n" "$rel" "$full" "$size" "$mtime"',
      '  count=$((count + 1))',
      '  [ "$count" -lt "$limit" ] || break',
      'done < <(list_files)',
    ].join('\n');
  }

  type FsMutationAction =
    | 'create-file'
    | 'create-directory'
    | 'rename'
    | 'delete'
    | 'move'
    | 'copy';

  type FsMutationResult = {
    action: FsMutationAction;
    path?: string;
    targetPath?: string;
    paths?: string[];
    targetDir?: string;
  };

  function fsMutationError(statusCode: number, message: string): Error & { statusCode?: number } {
    const err = new Error(message) as Error & { statusCode?: number };
    err.statusCode = statusCode;
    return err;
  }

  function fsMutationStatus(error: unknown): number {
    const explicit = Number((error as any)?.statusCode ?? 0);
    if (explicit > 0) return explicit;
    const code = String((error as any)?.code ?? '')
      .trim()
      .toUpperCase();
    if (code === 'ENOENT' || code === 'ENOTDIR') return 404;
    if (code === 'EEXIST' || code === 'ENOTEMPTY') return 409;
    if (code === 'EACCES' || code === 'EPERM') return 403;
    return 500;
  }

  function normalizeFsChildName(raw: unknown): string {
    const name = String(raw ?? '')
      .replace(/[\0\r\n\t]/g, '')
      .trim();
    if (/[\/\\]/.test(name)) return '';
    return name;
  }

  function assertValidFsChildName(name: string): void {
    if (!name || name === '.' || name === '..') {
      throw fsMutationError(400, 'invalid name');
    }
  }

  function fsPathBaseNameForRuntime(runtime: 'host' | 'container', rawPath: string): string {
    const text = String(rawPath ?? '').replace(/[\/\\]+$/g, '');
    return runtime === 'host' ? path.basename(text) : path.posix.basename(text);
  }

  function fsPathParentForRuntime(runtime: 'host' | 'container', rawPath: string): string {
    return runtime === 'host'
      ? path.dirname(rawPath)
      : normalizeContainerPath(path.posix.dirname(rawPath));
  }

  function fsJoinChildForRuntime(
    runtime: 'host' | 'container',
    parentPath: string,
    name: string,
  ): string {
    return runtime === 'host'
      ? path.resolve(path.join(parentPath, name))
      : normalizeContainerPath(path.posix.join(parentPath, name));
  }

  function fsPathStartsWithOrEqualsForRuntime(
    runtime: 'host' | 'container',
    parentPath: string,
    childPath: string,
  ): boolean {
    const parent =
      runtime === 'host'
        ? path.resolve(parentPath)
        : normalizeContainerPath(parentPath).replace(/\/+$/g, '') || '/';
    const child =
      runtime === 'host'
        ? path.resolve(childPath)
        : normalizeContainerPath(childPath).replace(/\/+$/g, '') || '/';
    if (parent === child) return true;
    const sep = runtime === 'host' ? path.sep : '/';
    return child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
  }

  function normalizeFsMutationPathsForRuntime(drone: any, rawPaths: unknown): string[] {
    const values = Array.isArray(rawPaths) ? rawPaths : rawPaths == null ? [] : [rawPaths];
    return values
      .map((value) => normalizeFsPathForRuntime(drone, value, { fallbackToHome: false }))
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
  }

  async function assertHostDirectory(targetPath: string): Promise<void> {
    const st = await fs.stat(targetPath);
    if (!st.isDirectory()) {
      throw fsMutationError(404, `path is not a directory: ${targetPath}`);
    }
  }

  async function assertHostPathDoesNotExist(targetPath: string): Promise<void> {
    try {
      await fs.lstat(targetPath);
      throw fsMutationError(409, `path already exists: ${targetPath}`);
    } catch (e: any) {
      if (String(e?.code ?? '').toUpperCase() === 'ENOENT') return;
      throw e;
    }
  }

  async function mutateHostFs(
    action: FsMutationAction,
    body: any,
    drone: any,
  ): Promise<FsMutationResult> {
    const runtime = 'host' as const;
    if (action === 'create-file' || action === 'create-directory') {
      const targetDir = normalizeFsPathForRuntime(drone, body?.targetDir ?? body?.path ?? '', {
        fallbackToHome: true,
      });
      const name = normalizeFsChildName(body?.name);
      assertValidFsChildName(name);
      await assertHostDirectory(targetDir);
      const targetPath = fsJoinChildForRuntime(runtime, targetDir, name);
      await assertHostPathDoesNotExist(targetPath);
      if (action === 'create-file') {
        const fh = await fs.open(targetPath, 'wx');
        await fh.close();
      } else {
        await fs.mkdir(targetPath);
      }
      return { action, path: targetPath, targetDir };
    }

    if (action === 'rename') {
      const sourcePath = normalizeFsPathForRuntime(drone, body?.path ?? '', {
        fallbackToHome: false,
      });
      if (!sourcePath || sourcePath === path.parse(sourcePath).root)
        throw fsMutationError(400, 'missing path');
      const name = normalizeFsChildName(body?.name);
      assertValidFsChildName(name);
      const targetPath = fsJoinChildForRuntime(
        runtime,
        fsPathParentForRuntime(runtime, sourcePath),
        name,
      );
      await assertHostPathDoesNotExist(targetPath);
      await fs.rename(sourcePath, targetPath);
      return { action, path: sourcePath, targetPath };
    }

    if (action === 'delete') {
      const paths = normalizeFsMutationPathsForRuntime(drone, body?.paths ?? body?.path);
      if (paths.length === 0) throw fsMutationError(400, 'missing paths');
      for (const sourcePath of paths) {
        if (!sourcePath || sourcePath === path.parse(sourcePath).root)
          throw fsMutationError(400, 'cannot delete root');
        await fs.rm(sourcePath, { recursive: true, force: false });
      }
      return { action, paths };
    }

    if (action === 'move' || action === 'copy') {
      const paths = normalizeFsMutationPathsForRuntime(drone, body?.paths ?? body?.path);
      const targetDir = normalizeFsPathForRuntime(drone, body?.targetDir ?? '', {
        fallbackToHome: false,
      });
      if (paths.length === 0) throw fsMutationError(400, 'missing paths');
      if (!targetDir) throw fsMutationError(400, 'missing target directory');
      await assertHostDirectory(targetDir);
      for (const sourcePath of paths) {
        if (!sourcePath || sourcePath === path.parse(sourcePath).root)
          throw fsMutationError(400, 'invalid source path');
        const name = fsPathBaseNameForRuntime(runtime, sourcePath);
        assertValidFsChildName(name);
        const targetPath = fsJoinChildForRuntime(runtime, targetDir, name);
        if (fsPathStartsWithOrEqualsForRuntime(runtime, sourcePath, targetPath)) {
          throw fsMutationError(
            400,
            `cannot ${action === 'move' ? 'move' : 'copy'} a directory into itself`,
          );
        }
        await assertHostPathDoesNotExist(targetPath);
        if (action === 'move') {
          await fs.rename(sourcePath, targetPath);
        } else {
          await fs.cp(sourcePath, targetPath, {
            recursive: true,
            errorOnExist: true,
            force: false,
          });
        }
      }
      return { action, paths, targetDir };
    }

    throw fsMutationError(400, 'unsupported filesystem action');
  }

  function containerFsMutationScript(
    action: FsMutationAction,
    body: any,
    drone: any,
  ): { script: string; result: FsMutationResult } {
    const runtime = 'container' as const;
    const failFn = [
      'fail() {',
      '  code="$1"; shift',
      '  printf "__ERR__\\t%s\\t%s\\n" "$code" "$*"',
      '  exit "$code"',
      '}',
    ];

    const lines = ['set -euo pipefail', ...failFn];

    if (action === 'create-file' || action === 'create-directory') {
      const targetDir = normalizeFsPathForRuntime(drone, body?.targetDir ?? body?.path ?? '', {
        fallbackToHome: true,
      });
      const name = normalizeFsChildName(body?.name);
      assertValidFsChildName(name);
      const targetPath = fsJoinChildForRuntime(runtime, targetDir, name);
      lines.push(
        `target_dir=${bashQuote(targetDir)}`,
        `target=${bashQuote(targetPath)}`,
        '[ -d "$target_dir" ] || fail 4 "path is not a directory: $target_dir"',
        '[ ! -e "$target" ] && [ ! -L "$target" ] || fail 5 "path already exists: $target"',
        action === 'create-file' ? ': > "$target"' : 'mkdir -- "$target"',
        'printf "__OK__\\n"',
      );
      return { script: lines.join('\n'), result: { action, path: targetPath, targetDir } };
    }

    if (action === 'rename') {
      const sourcePath = normalizeFsPathForRuntime(drone, body?.path ?? '', {
        fallbackToHome: false,
      });
      if (!sourcePath || sourcePath === '/') throw fsMutationError(400, 'missing path');
      const name = normalizeFsChildName(body?.name);
      assertValidFsChildName(name);
      const targetPath = fsJoinChildForRuntime(
        runtime,
        fsPathParentForRuntime(runtime, sourcePath),
        name,
      );
      lines.push(
        `source=${bashQuote(sourcePath)}`,
        `target=${bashQuote(targetPath)}`,
        '[ -e "$source" ] || [ -L "$source" ] || fail 4 "path not found: $source"',
        '[ ! -e "$target" ] && [ ! -L "$target" ] || fail 5 "path already exists: $target"',
        'mv -- "$source" "$target"',
        'printf "__OK__\\n"',
      );
      return { script: lines.join('\n'), result: { action, path: sourcePath, targetPath } };
    }

    if (action === 'delete') {
      const paths = normalizeFsMutationPathsForRuntime(drone, body?.paths ?? body?.path);
      if (paths.length === 0) throw fsMutationError(400, 'missing paths');
      for (const sourcePath of paths) {
        if (!sourcePath || sourcePath === '/') throw fsMutationError(400, 'cannot delete root');
        lines.push(
          `source=${bashQuote(sourcePath)}`,
          '[ -e "$source" ] || [ -L "$source" ] || fail 4 "path not found: $source"',
          'rm -rf -- "$source"',
        );
      }
      lines.push('printf "__OK__\\n"');
      return { script: lines.join('\n'), result: { action, paths } };
    }

    if (action === 'move' || action === 'copy') {
      const paths = normalizeFsMutationPathsForRuntime(drone, body?.paths ?? body?.path);
      const targetDir = normalizeFsPathForRuntime(drone, body?.targetDir ?? '', {
        fallbackToHome: false,
      });
      if (paths.length === 0) throw fsMutationError(400, 'missing paths');
      if (!targetDir) throw fsMutationError(400, 'missing target directory');
      lines.push(
        `target_dir=${bashQuote(targetDir)}`,
        '[ -d "$target_dir" ] || fail 4 "path is not a directory: $target_dir"',
      );
      for (const sourcePath of paths) {
        if (!sourcePath || sourcePath === '/') throw fsMutationError(400, 'invalid source path');
        const name = fsPathBaseNameForRuntime(runtime, sourcePath);
        assertValidFsChildName(name);
        const targetPath = fsJoinChildForRuntime(runtime, targetDir, name);
        lines.push(
          `source=${bashQuote(sourcePath)}`,
          `target=${bashQuote(targetPath)}`,
          '[ -e "$source" ] || [ -L "$source" ] || fail 4 "path not found: $source"',
          '[ ! -e "$target" ] && [ ! -L "$target" ] || fail 5 "path already exists: $target"',
        );
        if (action === 'move') {
          lines.push(
            'case "$target" in "$source"|"$source"/*) fail 2 "cannot move a directory into itself" ;; esac',
          );
          lines.push('mv -- "$source" "$target"');
        } else {
          lines.push(
            'case "$target" in "$source"|"$source"/*) fail 2 "cannot copy a directory into itself" ;; esac',
          );
          lines.push('cp -a -- "$source" "$target"');
        }
      }
      lines.push('printf "__OK__\\n"');
      return { script: lines.join('\n'), result: { action, paths, targetDir } };
    }

    throw fsMutationError(400, 'unsupported filesystem action');
  }

  async function mutateContainerFs(
    action: FsMutationAction,
    body: any,
    resolved: ResolvedDrone,
    droneName: string,
  ): Promise<FsMutationResult> {
    const { script, result } = containerFsMutationScript(action, body, resolved.drone);
    await withLockedDroneContainer(
      { requestedDroneName: droneName, droneEntry: resolved.drone },
      async ({ containerName }: any) => {
        const out = await dvmExec(containerName, 'bash', ['-lc', script]);
        if (out.code === 0) return;
        const text = `${String(out.stdout ?? '')}\n${String(out.stderr ?? '')}`;
        const errMatch = text.match(/__ERR__\t(\d+)\t([^\n\r]*)/);
        if (errMatch) {
          const code = Number(errMatch[1] ?? 0);
          const status = code === 4 ? 404 : code === 5 ? 409 : code === 2 ? 400 : 500;
          throw fsMutationError(
            status,
            String(errMatch[2] ?? '').trim() || 'filesystem action failed',
          );
        }
        throw new Error((out.stderr || out.stdout || 'filesystem action failed').trim());
      },
    );
    return result;
  }

  async function handleFsActionRoute(opts: {
    req: http.IncomingMessage;
    res: http.ServerResponse;
    resolved: ResolvedDrone;
    droneRef: string;
  }): Promise<void> {
    const { req, res, resolved, droneRef } = opts;
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

    const action = String(body?.action ?? '').trim() as FsMutationAction;
    const allowedActions: FsMutationAction[] = [
      'create-file',
      'create-directory',
      'rename',
      'delete',
      'move',
      'copy',
    ];
    if (!allowedActions.includes(action)) {
      json(res, 400, {
        ok: false,
        error: 'unsupported filesystem action',
        id: droneId,
        name: droneName,
      });
      return;
    }

    try {
      const result =
        runtime === 'host'
          ? await mutateHostFs(action, body, drone)
          : await mutateContainerFs(action, body, resolved, droneName);
      json(res, 200, {
        ok: true,
        id: droneId,
        name: droneName,
        ...result,
      });
      return;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      const code =
        runtime === 'host'
          ? fsMutationStatus(e)
          : Number((e as any)?.statusCode ?? 0) ||
            (looksLikeMissingContainerError(msg) ? 404 : 500);
      json(res, code, { ok: false, error: msg, id: droneId, name: droneName });
      return;
    }
  }

  const assistantFilesystemService = createAssistantFilesystemService({
    nonRepoHomeCwd: NON_REPO_HOME_CWD,
    droneRuntime,
    defaultDroneHomeCwd,
    normalizeDroneCwdForRuntime,
    hostMimeType,
    listHostFsDirectory,
    isRepoAttachedDrone,
    droneRepoPathInContainer,
    withReadonlyDroneContainer,
    withLockedDroneContainer,
  });
  const {
    assistantAbortDroneTransferFile,
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
  } = assistantFilesystemService;

  return {
    assistantFilesystemService,
    handleFsUploadRoute,
    normalizeFsPathForRuntime,
    hostFsErrorStatus,
    hostMimeType,
    listHostFsDirectory,
    parseFsSearchOutput,
    buildFsSearchScript,
    handleFsActionRoute,
    assistantAbortDroneTransferFile,
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
