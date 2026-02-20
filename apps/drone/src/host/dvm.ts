import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type RunResult = { code: number; stdout: string; stderr: string };

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

function defaultDvmCliPath(): string {
  // When developing inside this monorepo, `drone` can invoke the local dvm build.
  // dist/host -> dist -> drone -> apps -> dvm/dist/cli.js
  return path.resolve(__dirname, '../../../dvm/dist/cli.js');
}

export function resolveDvmCliPath(): string {
  return process.env.DVM_CLI_PATH ?? defaultDvmCliPath();
}

async function runDvm(args: string[], opts?: { timeoutMs?: number }): Promise<RunResult> {
  const dvmCli = resolveDvmCliPath();
  if (!fs.existsSync(dvmCli)) {
    return { code: 127, stdout: '', stderr: `dvm CLI not found at ${dvmCli} (set DVM_CLI_PATH or build apps/dvm)` };
  }
  return await run('node', [dvmCli, ...args], { timeoutMs: opts?.timeoutMs });
}

export function parsePortsOutput(text: string): Array<{ hostPort: number; containerPort: number }> {
  const ports: Array<{ hostPort: number; containerPort: number }> = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+):(\d+)\s*$/);
    if (!m) continue;
    ports.push({ hostPort: Number(m[1]), containerPort: Number(m[2]) });
  }
  return ports.filter((p) => Number.isFinite(p.hostPort) && Number.isFinite(p.containerPort));
}

export async function dvmPorts(container: string): Promise<Array<{ hostPort: number; containerPort: number }>> {
  const r = await runDvm(['ports', container]);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm ports ${container} failed`);
  return parsePortsOutput(r.stdout);
}

export async function dvmCreate(container: string, args: string[]): Promise<void> {
  const r = await runDvm(['create', container, ...args]);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm create ${container} failed`);
}

export function parseLsOutput(text: string): string[] {
  // dvm ls output format (human-friendly):
  // Name: <container>
  //   Image: ...
  //   Status: ...
  //   Ports: ...
  const names: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*Name:\s*(.+?)\s*$/);
    if (!m) continue;
    const name = m[1].trim();
    if (name) names.push(name);
  }
  return [...new Set(names)];
}

export async function dvmLs(): Promise<string[]> {
  const r = await runDvm(['ls']);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || 'dvm ls failed');
  return parseLsOutput(r.stdout);
}

export async function dvmExec(
  container: string,
  cmd: string,
  args: string[] = [],
  opts?: { timeoutMs?: number }
): Promise<RunResult> {
  return await runDvm(['exec', container, '--', cmd, ...args], { timeoutMs: opts?.timeoutMs });
}

export async function dvmRemove(container: string, opts?: { keepVolume?: boolean }): Promise<void> {
  const argv = ['rm', container];
  if (opts?.keepVolume) argv.push('--keep-volume');
  const r = await runDvm(argv);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm rm ${container} failed`);
}

export async function dvmStop(container: string): Promise<void> {
  const r = await runDvm(['stop', container]);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm stop ${container} failed`);
}

export async function dvmStart(container: string): Promise<void> {
  const r = await runDvm(['start', container]);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm start ${container} failed`);
}

export async function dvmRename(
  oldName: string,
  newName: string,
  opts?: { startMode?: 'preserve' | 'always' | 'never'; migrateVolumeName?: boolean }
): Promise<void> {
  const argv = ['rename', oldName, newName];
  if (opts?.migrateVolumeName) argv.push('--migrate-volume-name');
  const startMode = opts?.startMode ?? 'preserve';
  if (startMode === 'always') argv.push('--start');
  if (startMode === 'never') argv.push('--no-start');
  const r = await runDvm(argv);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm rename ${oldName} ${newName} failed`);
}

export async function dvmSessionStart(container: string, session: string, cmd: string, args: string[] = [], reuse = true): Promise<void> {
  const argv = ['session', 'start', container, session];
  if (reuse) argv.push('--reuse');
  argv.push('--', cmd, ...args);
  const r = await runDvm(argv);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm session start ${container} ${session} failed`);
}

export async function dvmSessionSend(container: string, session: string, text: string): Promise<void> {
  // Use `--` so text beginning with "-" isn't parsed as an option.
  const argv = ['session', 'send', container, session, '--', text];
  const r = await runDvm(argv);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm session send ${container} ${session} failed`);
}

export async function dvmSessionType(container: string, session: string, opts: { text?: string; keys?: string[] }): Promise<void> {
  const argv = ['session', 'type', container, session];
  const keys = Array.isArray(opts.keys) ? opts.keys.map(String).filter(Boolean) : [];
  for (const k of keys) argv.push('--key', k);
  if (typeof opts.text === 'string') {
    // Use `--` so text beginning with "-" isn't parsed as an option.
    argv.push('--', opts.text);
  }
  const r = await runDvm(argv);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm session type ${container} ${session} failed`);
}

export async function dvmSessionRead(opts: {
  container: string;
  session: string;
  since?: number;
  maxBytes?: number;
  tailLines?: number;
}): Promise<{ offsetBytes: number; text: string }> {
  const argv = ['session', 'read', opts.container, opts.session, '--json'];
  if (typeof opts.since === 'number' && Number.isFinite(opts.since) && opts.since >= 0) {
    argv.push('--since', String(Math.floor(opts.since)));
    if (typeof opts.maxBytes === 'number' && Number.isFinite(opts.maxBytes) && opts.maxBytes > 0) {
      argv.push('--max-bytes', String(Math.floor(opts.maxBytes)));
    }
  } else if (typeof opts.tailLines === 'number' && Number.isFinite(opts.tailLines) && opts.tailLines > 0) {
    argv.push('--tail', String(Math.floor(opts.tailLines)));
  }
  const r = await runDvm(argv);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm session read ${opts.container} ${opts.session} failed`);
  try {
    const parsed = JSON.parse((r.stdout || '').trim()) as { offsetBytes?: any; text?: any };
    const offsetBytes = Number(parsed?.offsetBytes ?? 0);
    const text = typeof parsed?.text === 'string' ? parsed.text : '';
    return { offsetBytes: Number.isFinite(offsetBytes) && offsetBytes >= 0 ? offsetBytes : 0, text };
  } catch {
    // Fallback: treat as plain text and report end offset as 0 (unknown).
    return { offsetBytes: 0, text: r.stdout || '' };
  }
}

export async function dvmScript(container: string, scriptPath: string, args: string[] = []): Promise<void> {
  const argv = ['script', container, scriptPath];
  if (args.length > 0) argv.push('--', ...args);
  const r = await runDvm(argv);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm script ${container} ${scriptPath} failed`);
}

export async function dvmCopyToContainer(
  container: string,
  srcPath: string,
  destPath: string,
  opts?: { clean?: boolean; timeoutMs?: number }
): Promise<void> {
  const argv = ['copy', container, srcPath, destPath];
  if (opts?.clean) argv.push('--clean');
  const r = await runDvm(argv, { timeoutMs: opts?.timeoutMs });
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm copy ${container} ${srcPath} ${destPath} failed`);
}

function parseRepoExportPath(stdout: string): string | null {
  // dvm prints: "Exported <format> -> <path>"
  const lines = String(stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const l of lines.slice().reverse()) {
    const m = l.match(/^Exported\s+\w+\s+->\s+(.+)\s*$/);
    if (m && m[1]) return m[1].trim();
  }
  return null;
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
  const argv = ['repo', 'seed', opts.container, '--path', opts.hostPath];
  if (opts.dest) argv.push('--dest', opts.dest);
  if (opts.baseRef) argv.push('--base-ref', opts.baseRef);
  if (opts.branch) argv.push('--branch', opts.branch);
  if (opts.clean) argv.push('--clean');
  const r = await runDvm(argv, { timeoutMs: opts.timeoutMs });
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm repo seed ${opts.container} failed`);
}

export async function dvmRepoExport(opts: {
  container: string;
  repoPathInContainer?: string;
  outDir: string;
  format?: 'patches' | 'bundle' | 'diff';
  base?: string;
}): Promise<{ exportedPath: string; stdout: string }> {
  const format = opts.format ?? 'patches';
  const argv = [
    'repo',
    'export',
    opts.container,
    '--repo',
    opts.repoPathInContainer ?? '/work/repo',
    '--out',
    opts.outDir,
    '--format',
    format,
  ];
  if (opts.base) argv.push('--base', opts.base);
  const r = await runDvm(argv);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm repo export ${opts.container} failed`);
  const exportedPath = parseRepoExportPath(r.stdout) ?? '';
  if (!exportedPath) {
    throw new Error(`dvm repo export did not report an output path:\n\n${r.stdout || '(no stdout)'}`);
  }
  return { exportedPath, stdout: r.stdout };
}

export async function dvmRepoHeadSha(opts: { container: string; repoPathInContainer?: string }): Promise<string> {
  const repoPath = opts.repoPathInContainer ?? '/work/repo';
  const script = [
    'set -euo pipefail',
    `cd ${JSON.stringify(repoPath)}`,
    'git rev-parse HEAD',
  ].join('\n');
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
  const script = [
    'set -euo pipefail',
    `cd ${JSON.stringify(repoPath)}`,
    `git config dvm.baseSha ${JSON.stringify(baseSha)}`,
    `rm -f ${JSON.stringify(path.posix.join(repoPath, '.dvm-base-sha'))} || true`,
    'git config --get dvm.baseSha',
  ].join('\n');
  const r = await dvmExec(opts.container, 'bash', ['-lc', script]);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `failed to set dvm.baseSha in ${opts.container}`);
  const configured = parseShaFromOutput(r.stdout);
  if (configured !== baseSha) {
    throw new Error(`dvm.baseSha verification failed in ${opts.container}: expected ${baseSha}, got ${configured ?? '(none)'}`);
  }
}

function parseBaseImageFromBaseSetOutput(stdout: string): string | null {
  const lines = String(stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice().reverse()) {
    const m = line.match(/^Base image:\s*(.+?)\s*$/i);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

export async function dvmBaseSet(container: string, opts?: { timeoutMs?: number }): Promise<{ baseImage: string | null; stdout: string }> {
  const name = String(container ?? '').trim();
  if (!name) throw new Error('missing container name');
  const r = await runDvm(['base', 'set', name], { timeoutMs: opts?.timeoutMs });
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `dvm base set ${name} failed`);
  return { baseImage: parseBaseImageFromBaseSetOutput(r.stdout), stdout: r.stdout };
}
