import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { watchFileChanges } from '../daemon-file-events';
import type { DroneClient } from '../host/api';
import { subscribeDaemonFileEvents } from './daemon-file-events';
import { bashQuote } from './hub-format';

const FILE_REVISION_BACKSTOP_MS = 30_000;

export type FileRevisionEvent = 'snapshot' | 'changed' | 'deleted' | 'stream-error';

export type FileRevisionWatchDependencies = {
  FS_EDITOR_MAX_BYTES: number;
  droneRuntime: (drone: any) => string;
  withReadonlyDroneContainer: (options: any, run: (context: any) => Promise<any>) => Promise<any>;
  dvmExec: (container: string, command: string, args: string[], options?: any) => Promise<{ code: number; stdout: string; stderr: string }>;
  resolveDaemonClient: (drone: any) => Promise<DroneClient | null>;
};

export async function hashHostFileWithSize(
  filePath: string,
): Promise<{ revision: string; size: number }> {
  return await new Promise((resolve, reject) => {
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
}

/**
 * Follows one open file for an editor tab: `snapshot` with its revision when
 * the watch starts (or the file comes back), `changed` when its contents
 * differ from the last revision sent, `deleted` when it goes away.
 *
 * Host files are watched by the Hub and container files by the drone's daemon.
 * Watch events can be lost (a mount edited from outside the container, an
 * overflowing kernel queue, a dead watcher), so the contents are still
 * compared now and then. That bounds how stale an open file can get.
 */
export function createFileRevisionWatcher(deps: FileRevisionWatchDependencies) {
  const { FS_EDITOR_MAX_BYTES, droneRuntime, withReadonlyDroneContainer } = deps;
  // The canonical container context already supplies an exact Docker name.
  const dvmExec = (container: string, command: string, args: string[]) =>
    deps.dvmExec(container, command, args, { containerAlreadyReady: true });

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

  return function watchFileRevision(
    input: { drone: any; droneId: string; droneName: string; targetPath: string },
    publish: (event: FileRevisionEvent, data: Record<string, unknown>) => void,
  ): () => void {
    const { drone, droneId, droneName, targetPath } = input;
    let closed = false;
    let busy = false;
    let changedWhileBusy = false;
    let lastRevision: string | null = null;
    let lastMissing = false;
    // Compares the file with the last revision sent and reports a difference.
    const checkRevision = async () => {
      if (closed) return;
      if (busy) {
        changedWhileBusy = true;
        return;
      }
      busy = true;
      try {
        const fingerprint = await readFileFingerprint({ drone, droneName, targetPath });
        if (closed) return;
        if (fingerprint.size > FS_EDITOR_MAX_BYTES) {
          // Too large to edit, so too large to hash on every change: its size and time stand in.
          const metadataRevision = `metadata:${fingerprint.size}:${fingerprint.mtimeMs ?? 'unknown'}`;
          const event = lastRevision == null ? 'snapshot' : metadataRevision !== lastRevision ? 'changed' : null;
          lastRevision = metadataRevision;
          lastMissing = false;
          if (event) publish(event, { ok: true, id: droneId, ...fingerprint, revision: metadataRevision });
          return;
        }
        const current = await readFileRevision({ drone, droneName, targetPath });
        if (closed) return;
        const event = lastRevision == null ? 'snapshot' : current.revision !== lastRevision ? 'changed' : null;
        lastRevision = current.revision;
        lastMissing = false;
        if (event) publish(event, { ok: true, id: droneId, ...current });
      } catch (error: any) {
        if (closed) return;
        const message = String(error?.message ?? error);
        const missing = /not found|not-file|ENOENT/i.test(message);
        if (missing && !lastMissing) {
          lastMissing = true;
          lastRevision = null;
          publish('deleted', { ok: false, id: droneId, path: targetPath });
        } else if (!missing) {
          publish('stream-error', { ok: false, id: droneId, path: targetPath, error: message });
        }
      } finally {
        busy = false;
        if (changedWhileBusy && !closed) {
          changedWhileBusy = false;
          void checkRevision();
        }
      }
    };
    const stopWatching =
      droneRuntime(drone) === 'host'
        ? watchFileChanges(path.resolve(targetPath), () => void checkRevision())
        : subscribeDaemonFileEvents(
            { resolveClient: () => deps.resolveDaemonClient(drone) },
            targetPath,
            () => void checkRevision(),
          );
    const backstop = setInterval(() => void checkRevision(), FILE_REVISION_BACKSTOP_MS);
    backstop.unref?.();
    void checkRevision();
    return () => {
      closed = true;
      clearInterval(backstop);
      stopWatching();
    };
  };
}
