import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';

function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
): { code: number; stdout: string; stderr: string } {
  const res = cp.spawnSync(cmd, args, {
    encoding: 'utf8',
    cwd: opts?.cwd,
    env: opts?.env,
    timeout: opts?.timeoutMs ?? 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout = String(res.stdout ?? '');
  const stderr = String(res.stderr ?? '');
  const code = typeof res.status === 'number' ? res.status : 1;
  return { code, stdout, stderr };
}

function runOrThrow(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
): { stdout: string; stderr: string } {
  const r = run(cmd, args, opts);
  if (r.code !== 0) {
    throw new Error(
      [
        `Command failed: ${cmd} ${args.join(' ')}`,
        `exit: ${String(r.code)}`,
        r.stdout.trim() ? `stdout:\n${r.stdout.trim()}` : '',
        r.stderr.trim() ? `stderr:\n${r.stderr.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')
    );
  }
  return { stdout: r.stdout, stderr: r.stderr };
}

function runNoThrow(cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }): void {
  run(cmd, args, opts);
}

function dockerUsable(): { ok: boolean; detail: string } {
  const r = run('docker', ['info'], { timeoutMs: 20_000 });
  if (r.code === 0) return { ok: true, detail: '' };
  const detail = [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join(' | ');
  return { ok: false, detail };
}

function parseListedContainerNames(lsOutput: string): string[] {
  const names: string[] = [];
  for (const line of String(lsOutput).split('\n')) {
    const m = line.match(/^\s*Name:\s*(.+?)\s*$/);
    if (m && m[1]) names.push(m[1]);
  }
  return names;
}

describe('dvm docker lifecycle regression', () => {
  jest.setTimeout(300_000);

  test('create -> upload/copy -> download -> rename -> remove with cleanup', () => {
    const docker = dockerUsable();
    if (!docker.ok) {
      if (process.env.CI) {
        throw new Error(`Docker is required for dvm lifecycle regression tests in CI. ${docker.detail}`);
      }
      // eslint-disable-next-line no-console
      console.warn(`Skipping dvm docker lifecycle regression test: ${docker.detail}`);
      return;
    }

    const appRoot = path.resolve(__dirname, '..', '..');
    const dvmCli = path.join(appRoot, 'dist', 'cli.js');
    const testId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const originalName = `dvm-reg-${testId}`;
    const renamedName = `${originalName}-renamed`;
    const renamedStoppedName = `${originalName}-stopped`;
    const renamedStartedName = `${originalName}-started`;
    const migratedName = `${originalName}-migrated`;

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dvm-regression-'));
    const xdgDataHome = path.join(tempRoot, 'xdg-data');
    fs.mkdirSync(xdgDataHome, { recursive: true });
    const env = { ...process.env, XDG_DATA_HOME: xdgDataHome, NO_COLOR: '1' };

    const uploadSrc = path.join(tempRoot, 'upload.txt');
    const uploadDestDir = '/tmp/upload-target';
    const downloadDst = path.join(tempRoot, 'downloaded.txt');
    const uploadContent = `UPLOAD_OK_${testId}`;
    const containerContent = `DOWNLOAD_OK_${testId}`;
    fs.writeFileSync(uploadSrc, uploadContent, 'utf8');

    try {
      runOrThrow('node', [dvmCli, 'create', originalName, '--image', 'bash:5.2'], { cwd: appRoot, env });

      runOrThrow('node', [dvmCli, 'copy', originalName, uploadSrc, uploadDestDir], { cwd: appRoot, env });
      const uploadedPath = `${uploadDestDir}/${path.basename(uploadSrc)}`;
      const uploaded = runOrThrow('node', [dvmCli, 'exec', originalName, '--', 'sh', '-lc', `cat ${JSON.stringify(uploadedPath)}`], {
        cwd: appRoot,
        env,
      });
      expect(uploaded.stdout).toContain(uploadContent);

      runOrThrow(
        'node',
        [dvmCli, 'exec', originalName, '--', 'sh', '-lc', `printf %s ${JSON.stringify(containerContent)} > /tmp/from-container.txt`],
        { cwd: appRoot, env }
      );
      runOrThrow('node', [dvmCli, 'download', originalName, '/tmp/from-container.txt', downloadDst], { cwd: appRoot, env });
      expect(fs.readFileSync(downloadDst, 'utf8')).toBe(containerContent);

      runOrThrow('node', [dvmCli, 'rename', originalName, renamedName], { cwd: appRoot, env });
      const listed = runOrThrow('node', [dvmCli, 'ls'], { cwd: appRoot, env });
      const listedNames = parseListedContainerNames(listed.stdout);
      expect(listedNames).toContain(renamedName);
      expect(listedNames).not.toContain(originalName);

      // Fast rename keeps the existing persistence volume by default.
      const inspectRaw = runOrThrow('docker', ['inspect', renamedName], { timeoutMs: 30_000 }).stdout;
      const inspect = JSON.parse(inspectRaw) as Array<any>;
      const labels = inspect[0]?.Config?.Labels ?? {};
      expect(labels['me.drone.dvm.persistence.volume']).toBe(`dvm-${originalName}-data`);
      const mountedNames = (inspect[0]?.Mounts ?? []).map((m: any) => String(m?.Name ?? '')).filter(Boolean);
      expect(mountedNames).toContain(`dvm-${originalName}-data`);
      const oldVol = run('docker', ['volume', 'inspect', `dvm-${originalName}-data`], { timeoutMs: 30_000 });
      const newVol = run('docker', ['volume', 'inspect', `dvm-${renamedName}-data`], { timeoutMs: 30_000 });
      expect(oldVol.code).toBe(0);
      expect(newVol.code).not.toBe(0);

      // Verify rename start modes and optional volume-name migration.
      const marker = `MARKER_${testId}`;
      runOrThrow('node', [dvmCli, 'exec', renamedName, '--', 'sh', '-lc', `printf %s ${JSON.stringify(marker)} > /dvm-data/rename-marker.txt`], {
        cwd: appRoot,
        env,
      });
      runOrThrow('node', [dvmCli, 'stop', renamedName], { cwd: appRoot, env });

      // `--no-start` keeps the renamed container stopped.
      runOrThrow('node', [dvmCli, 'rename', renamedName, renamedStoppedName, '--no-start'], { cwd: appRoot, env });
      const stoppedInspect = JSON.parse(runOrThrow('docker', ['inspect', renamedStoppedName], { timeoutMs: 30_000 }).stdout) as Array<any>;
      expect(Boolean(stoppedInspect[0]?.State?.Running)).toBe(false);

      // `--start` forces running state after rename.
      runOrThrow('node', [dvmCli, 'rename', renamedStoppedName, renamedStartedName, '--start'], { cwd: appRoot, env });
      const startedInspect = JSON.parse(runOrThrow('docker', ['inspect', renamedStartedName], { timeoutMs: 30_000 }).stdout) as Array<any>;
      expect(Boolean(startedInspect[0]?.State?.Running)).toBe(true);

      // `--migrate-volume-name` creates/moves to dvm-<new>-data.
      runOrThrow('node', [dvmCli, 'rename', renamedStartedName, migratedName, '--migrate-volume-name'], { cwd: appRoot, env });
      const migratedInspect = JSON.parse(runOrThrow('docker', ['inspect', migratedName], { timeoutMs: 30_000 }).stdout) as Array<any>;
      const migratedLabels = migratedInspect[0]?.Config?.Labels ?? {};
      expect(migratedLabels['me.drone.dvm.persistence.volume']).toBe(`dvm-${migratedName}-data`);
      const migratedMountNames = (migratedInspect[0]?.Mounts ?? []).map((m: any) => String(m?.Name ?? '')).filter(Boolean);
      expect(migratedMountNames).toContain(`dvm-${migratedName}-data`);
      const oldAfterMigrate = run('docker', ['volume', 'inspect', `dvm-${originalName}-data`], { timeoutMs: 30_000 });
      const migratedVol = run('docker', ['volume', 'inspect', `dvm-${migratedName}-data`], { timeoutMs: 30_000 });
      expect(oldAfterMigrate.code).not.toBe(0);
      expect(migratedVol.code).toBe(0);
      const markerCheck = runOrThrow('node', [dvmCli, 'exec', migratedName, '--', 'sh', '-lc', 'cat /dvm-data/rename-marker.txt'], {
        cwd: appRoot,
        env,
      });
      expect(markerCheck.stdout).toContain(marker);

      // Rename may preserve a non-running state; make the post-rename exec deterministic.
      runOrThrow('node', [dvmCli, 'start', migratedName], { cwd: appRoot, env });

      const renamedExec = runOrThrow('node', [dvmCli, 'exec', migratedName, '--', 'sh', '-lc', 'echo DVM_RENAME_OK'], {
        cwd: appRoot,
        env,
      });
      expect(renamedExec.stdout).toContain('DVM_RENAME_OK');

      // NOTE:
      // `dvm ssh` uses `docker exec -it` and requires an attached TTY.
      // This test suite runs subprocesses with piped stdio, so SSH cannot be
      // validated reliably here without a pseudo-terminal harness.
    } finally {
      runNoThrow('node', [dvmCli, 'rm', migratedName, '--keep-volume'], { cwd: appRoot, env, timeoutMs: 30_000 });
      runNoThrow('node', [dvmCli, 'rm', renamedStartedName, '--keep-volume'], { cwd: appRoot, env, timeoutMs: 30_000 });
      runNoThrow('node', [dvmCli, 'rm', renamedStoppedName, '--keep-volume'], { cwd: appRoot, env, timeoutMs: 30_000 });
      runNoThrow('node', [dvmCli, 'rm', renamedName, '--keep-volume'], { cwd: appRoot, env, timeoutMs: 30_000 });
      runNoThrow('node', [dvmCli, 'rm', originalName, '--keep-volume'], { cwd: appRoot, env, timeoutMs: 30_000 });

      runNoThrow('docker', ['rm', '-f', migratedName], { timeoutMs: 30_000 });
      runNoThrow('docker', ['rm', '-f', renamedStartedName], { timeoutMs: 30_000 });
      runNoThrow('docker', ['rm', '-f', renamedStoppedName], { timeoutMs: 30_000 });
      runNoThrow('docker', ['rm', '-f', renamedName], { timeoutMs: 30_000 });
      runNoThrow('docker', ['rm', '-f', originalName], { timeoutMs: 30_000 });
      runNoThrow('docker', ['volume', 'rm', '-f', `dvm-${migratedName}-data`], { timeoutMs: 30_000 });
      runNoThrow('docker', ['volume', 'rm', '-f', `dvm-${renamedStartedName}-data`], { timeoutMs: 30_000 });
      runNoThrow('docker', ['volume', 'rm', '-f', `dvm-${renamedStoppedName}-data`], { timeoutMs: 30_000 });
      runNoThrow('docker', ['volume', 'rm', '-f', `dvm-${renamedName}-data`], { timeoutMs: 30_000 });
      runNoThrow('docker', ['volume', 'rm', '-f', `dvm-${originalName}-data`], { timeoutMs: 30_000 });

      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

});
