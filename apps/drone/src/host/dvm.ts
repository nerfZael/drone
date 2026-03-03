import { spawn } from 'node:child_process';
import { createDvmApi } from 'dvm';
import type { DvmCreateContainerOptions } from 'dvm';

export type RunResult = { code: number; stdout: string; stderr: string };

const dvm = createDvmApi();

export async function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
): Promise<RunResult> {
  return await new Promise<RunResult>((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts?.cwd,
      env: opts?.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let done = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (res: RunResult) => {
      if (done) return;
      done = true;
      if (timeout) clearTimeout(timeout);
      resolve(res);
    };

    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.on('error', (err: any) => {
      finish({ code: 127, stdout, stderr: `${stderr}${err?.message ?? String(err)}` });
    });
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr }));

    const timeoutMs =
      typeof opts?.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
        ? Math.floor(opts.timeoutMs)
        : 0;
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
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  const ms =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.floor(timeoutMs)
      : 0;
  if (!ms) return await promise;

  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function dvmPorts(container: string): Promise<Array<{ hostPort: number; containerPort: number }>> {
  return await dvm.getContainerPorts(container);
}

export async function dvmCreate(container: string, opts: DvmCreateContainerOptions): Promise<void> {
  await dvm.createContainer(container, opts);
}

export async function dvmClone(
  source: string,
  container: string,
  opts?: { start?: boolean; reuseNamedVolumes?: boolean; copyPersistenceVolume?: boolean }
): Promise<void> {
  await dvm.cloneContainer(source, container, opts);
}

export async function dvmLs(): Promise<string[]> {
  return await dvm.listContainerNames({ all: true });
}

export async function dvmExec(
  container: string,
  cmd: string,
  args: string[] = [],
  opts?: { timeoutMs?: number }
): Promise<RunResult> {
  return await dvm.exec(container, cmd, args, { timeoutMs: opts?.timeoutMs });
}

export async function dvmRemove(container: string, opts?: { keepVolume?: boolean }): Promise<void> {
  await dvm.removeContainer(container, opts);
}

export async function dvmStop(container: string): Promise<void> {
  await dvm.stopContainer(container);
}

export async function dvmStart(container: string): Promise<void> {
  await dvm.startContainer(container);
}

export async function dvmRename(
  oldName: string,
  newName: string,
  opts?: { startMode?: 'preserve' | 'always' | 'never'; migrateVolumeName?: boolean }
): Promise<void> {
  await dvm.renameContainer(oldName, newName, opts);
}

export async function dvmSessionStart(
  container: string,
  session: string,
  cmd: string,
  args: string[] = [],
  reuse = true
): Promise<void> {
  await dvm.sessionStart(container, session, cmd, args, { reuse });
}

export async function dvmSessionType(container: string, session: string, opts: { text?: string; keys?: string[] }): Promise<void> {
  await dvm.sessionType(container, session, opts);
}

export async function dvmSessionRead(opts: {
  container: string;
  session: string;
  since?: number;
  maxBytes?: number;
  tailLines?: number;
}): Promise<{ offsetBytes: number; text: string }> {
  return await dvm.sessionRead(opts.container, opts.session, {
    since: opts.since,
    maxBytes: opts.maxBytes,
    tailLines: opts.tailLines,
  });
}

export async function dvmScript(container: string, scriptPath: string, args: string[] = []): Promise<void> {
  await dvm.runScript(container, scriptPath, args);
}

export async function dvmCopyToContainer(
  container: string,
  srcPath: string,
  destPath: string,
  opts?: { clean?: boolean; timeoutMs?: number }
): Promise<void> {
  await withTimeout(dvm.copyToContainer(container, srcPath, destPath, { clean: Boolean(opts?.clean) }), opts?.timeoutMs);
}

export async function dvmCopyFromContainer(
  container: string,
  srcPath: string,
  destPath: string,
  opts?: { clean?: boolean; timeoutMs?: number }
): Promise<void> {
  await withTimeout(dvm.copyFromContainer(container, srcPath, destPath, { clean: Boolean(opts?.clean) }), opts?.timeoutMs);
}

function parseShaFromOutput(text: string): string | null {
  const m = String(text || '').match(/\b[0-9a-f]{40}\b/i);
  if (!m) return null;
  return m[0].toLowerCase();
}

export async function dvmRepoSeed(opts: {
  container: string;
  hostPath: string;
  dest?: string;
  baseRef?: string;
  branch?: string;
  clean?: boolean;
  timeoutMs?: number;
}): Promise<void> {
  await withTimeout(
    dvm.repoSeed({
      containerName: opts.container,
      hostRepoPath: opts.hostPath,
      destinationPath: opts.dest,
      baseRef: opts.baseRef,
      branch: opts.branch,
      clean: opts.clean,
    }),
    opts.timeoutMs
  );
}

export async function dvmRepoExport(opts: {
  container: string;
  repoPathInContainer?: string;
  outDir: string;
  format?: 'patches' | 'bundle' | 'diff';
  base?: string;
}): Promise<{ exportedPath: string }> {
  const out = await dvm.repoExport({
    containerName: opts.container,
    repoPathInContainer: opts.repoPathInContainer,
    outRoot: opts.outDir,
    format: opts.format,
    base: opts.base,
  });
  return { exportedPath: out.exportedPath };
}

export async function dvmRepoHeadSha(opts: { container: string; repoPathInContainer?: string }): Promise<string> {
  const repoPath = opts.repoPathInContainer ?? '/work/repo';
  const script = ['set -euo pipefail', `cd ${JSON.stringify(repoPath)}`, 'git rev-parse HEAD'].join('\n');
  const r = await dvmExec(opts.container, 'bash', ['-lc', script]);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `failed to read repo HEAD in ${opts.container}`);
  const sha = parseShaFromOutput(r.stdout);
  if (!sha) throw new Error(`failed to parse repo HEAD in ${opts.container}: ${r.stdout || '(empty stdout)'}`);
  return sha;
}

export async function dvmRepoSetBaseSha(opts: { container: string; repoPathInContainer?: string; baseSha: string }): Promise<void> {
  const repoPath = opts.repoPathInContainer ?? '/work/repo';
  const baseSha = String(opts.baseSha ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(baseSha)) throw new Error(`invalid base SHA: ${opts.baseSha ?? '(empty)'}`);
  const script = ['set -euo pipefail', `cd ${JSON.stringify(repoPath)}`, `git config dvm.baseSha ${JSON.stringify(baseSha)}`, 'git config --get dvm.baseSha'].join('\n');
  const r = await dvmExec(opts.container, 'bash', ['-lc', script]);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `failed to set dvm.baseSha in ${opts.container}`);
  const configured = parseShaFromOutput(r.stdout);
  if (configured !== baseSha) {
    throw new Error(`dvm.baseSha verification failed in ${opts.container}: expected ${baseSha}, got ${configured ?? '(none)'}`);
  }
}

export async function dvmBaseSet(container: string, opts?: { timeoutMs?: number }): Promise<{ baseImage: string }> {
  const name = String(container ?? '').trim();
  if (!name) throw new Error('missing container name');
  const out = await withTimeout(dvm.setBaseImage(name), opts?.timeoutMs);
  return { baseImage: out.baseImage };
}
