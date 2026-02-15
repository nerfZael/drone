import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';

function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
): { code: number; stdout: string; stderr: string } {
  const res = cp.spawnSync(cmd, args, {
    encoding: 'utf8',
    cwd: opts?.cwd,
    env: opts?.env,
    timeout: opts?.timeoutMs ?? 180_000,
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

function ensureCliBuild(appRoot: string, dvmRoot: string): void {
  const droneCli = path.join(appRoot, 'dist', 'cli.js');
  const droneDaemon = path.join(appRoot, 'dist', 'daemon.js');
  const dvmCli = path.join(dvmRoot, 'dist', 'cli.js');

  if (!fs.existsSync(dvmCli)) {
    runOrThrow('bun', ['run', 'build'], { cwd: dvmRoot, timeoutMs: 240_000 });
  }
  if (!fs.existsSync(droneCli) || !fs.existsSync(droneDaemon)) {
    runOrThrow('bun', ['run', 'build'], { cwd: appRoot, timeoutMs: 240_000 });
  }
}

describe('drone docker lifecycle regression', () => {
  test(
    'create -> status/exec -> remove with hard cleanup',
    () => {
      const docker = dockerUsable();
      if (!docker.ok) {
        if (process.env.CI) {
          throw new Error(`Docker is required for drone lifecycle regression tests in CI. ${docker.detail}`);
        }
        // eslint-disable-next-line no-console
        console.warn(`Skipping drone docker lifecycle regression test: ${docker.detail}`);
        return;
      }

      const appRoot = path.resolve(__dirname, '..');
      const dvmRoot = path.resolve(appRoot, '..', 'dvm');
      ensureCliBuild(appRoot, dvmRoot);

      const droneCli = path.join(appRoot, 'dist', 'cli.js');
      const dvmCli = path.join(dvmRoot, 'dist', 'cli.js');
      const testId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const droneName = `drone-reg-${testId}`;
      const renamedDroneName = `${droneName}-renamed`;
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-regression-'));
      const xdgDataHome = path.join(tempRoot, 'xdg-data');
      fs.mkdirSync(xdgDataHome, { recursive: true });
      fs.mkdirSync(path.join(xdgDataHome, 'drone'), { recursive: true });
      const env = {
        ...process.env,
        XDG_DATA_HOME: xdgDataHome,
        DVM_CLI_PATH: dvmCli,
        NO_COLOR: '1',
      };

      try {
        const created = runOrThrow(
          'node',
          [droneCli, 'create', droneName, '--repo', '-', '--group', 'regression', '--container-port', '7777'],
          { cwd: appRoot, env, timeoutMs: 240_000 }
        );
        const createPayload = JSON.parse(created.stdout) as { ok?: boolean; name?: string };
        expect(createPayload.ok).toBe(true);
        expect(createPayload.name).toBe(droneName);

        const renamed = runOrThrow('node', [droneCli, 'rename', droneName, renamedDroneName], {
          cwd: appRoot,
          env,
          timeoutMs: 90_000,
        });
        const renamePayload = JSON.parse(renamed.stdout) as { ok?: boolean; oldName?: string; newName?: string };
        expect(renamePayload.ok).toBe(true);
        expect(renamePayload.oldName).toBe(droneName);
        expect(renamePayload.newName).toBe(renamedDroneName);

        const status = runOrThrow('node', [droneCli, 'status', renamedDroneName], { cwd: appRoot, env, timeoutMs: 60_000 });
        const statusPayload = JSON.parse(status.stdout) as {
          name?: string;
          hostPort?: number;
          containerPort?: number;
          status?: { ok?: boolean };
        };
        expect(statusPayload.name).toBe(renamedDroneName);
        expect(Number.isFinite(statusPayload.hostPort)).toBe(true);
        expect(statusPayload.containerPort).toBe(7777);
        expect(statusPayload.status?.ok).toBe(true);

        const exec = runOrThrow('node', [droneCli, 'exec', renamedDroneName, '--', 'sh', '-lc', 'echo DRONE_LIFECYCLE_OK'], {
          cwd: appRoot,
          env,
          timeoutMs: 60_000,
        });
        expect(exec.stdout).toContain('DRONE_LIFECYCLE_OK');

        const removed = runOrThrow('node', [droneCli, 'rm', renamedDroneName, '--keep-volume'], {
          cwd: appRoot,
          env,
          timeoutMs: 90_000,
        });
        const removePayload = JSON.parse(removed.stdout) as { ok?: boolean; name?: string };
        expect(removePayload.ok).toBe(true);
        expect(removePayload.name).toBe(renamedDroneName);
      } finally {
        runNoThrow('node', [droneCli, 'rm', renamedDroneName, '--keep-volume'], { cwd: appRoot, env, timeoutMs: 30_000 });
        runNoThrow('node', [droneCli, 'rm', droneName, '--keep-volume'], { cwd: appRoot, env, timeoutMs: 30_000 });
        runNoThrow('node', [dvmCli, 'rm', renamedDroneName, '--keep-volume'], { cwd: dvmRoot, env, timeoutMs: 30_000 });
        runNoThrow('node', [dvmCli, 'rm', droneName, '--keep-volume'], { cwd: dvmRoot, env, timeoutMs: 30_000 });
        runNoThrow('docker', ['rm', '-f', renamedDroneName], { timeoutMs: 30_000 });
        runNoThrow('docker', ['rm', '-f', droneName], { timeoutMs: 30_000 });
        runNoThrow('docker', ['volume', 'rm', '-f', `dvm-${renamedDroneName}-data`], { timeoutMs: 30_000 });
        runNoThrow('docker', ['volume', 'rm', '-f', `dvm-${droneName}-data`], { timeoutMs: 30_000 });
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    },
    { timeout: 300_000 }
  );

  test(
    'rename rolls back container rename when registry update fails',
    () => {
      const docker = dockerUsable();
      if (!docker.ok) {
        if (process.env.CI) {
          throw new Error(`Docker is required for drone lifecycle regression tests in CI. ${docker.detail}`);
        }
        // eslint-disable-next-line no-console
        console.warn(`Skipping drone docker rollback regression test: ${docker.detail}`);
        return;
      }

      const appRoot = path.resolve(__dirname, '..');
      const dvmRoot = path.resolve(appRoot, '..', 'dvm');
      ensureCliBuild(appRoot, dvmRoot);

      const droneCli = path.join(appRoot, 'dist', 'cli.js');
      const dvmCli = path.join(dvmRoot, 'dist', 'cli.js');
      const testId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const droneName = `drone-rb-${testId}`;
      const renamedDroneName = `${droneName}-renamed`;
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-regression-rb-'));
      const xdgDataHome = path.join(tempRoot, 'xdg-data');
      fs.mkdirSync(xdgDataHome, { recursive: true });
      fs.mkdirSync(path.join(xdgDataHome, 'drone'), { recursive: true });
      const env = {
        ...process.env,
        XDG_DATA_HOME: xdgDataHome,
        DVM_CLI_PATH: dvmCli,
        NO_COLOR: '1',
      };
      const registryDir = path.join(xdgDataHome, 'drone');

      try {
        runOrThrow(
          'node',
          [droneCli, 'create', droneName, '--repo', '-', '--group', 'regression', '--container-port', '7777'],
          { cwd: appRoot, env, timeoutMs: 240_000 }
        );

        // Make registry directory read-only so CLI rename fails after Docker rename.
        fs.chmodSync(registryDir, 0o500);
        const renameAttempt = run('node', [droneCli, 'rename', droneName, renamedDroneName], {
          cwd: appRoot,
          env,
          timeoutMs: 90_000,
        });
        expect(renameAttempt.code).not.toBe(0);
        fs.chmodSync(registryDir, 0o700);

        // Rollback should leave old container/name intact.
        const oldStatus = runOrThrow('node', [droneCli, 'status', droneName], { cwd: appRoot, env, timeoutMs: 60_000 });
        const oldStatusPayload = JSON.parse(oldStatus.stdout) as { name?: string };
        expect(oldStatusPayload.name).toBe(droneName);

        const newStatus = run('node', [droneCli, 'status', renamedDroneName], { cwd: appRoot, env, timeoutMs: 60_000 });
        expect(newStatus.code).not.toBe(0);
      } finally {
        try {
          fs.chmodSync(registryDir, 0o700);
        } catch {
          // ignore
        }
        runNoThrow('node', [droneCli, 'rm', renamedDroneName, '--keep-volume'], { cwd: appRoot, env, timeoutMs: 30_000 });
        runNoThrow('node', [droneCli, 'rm', droneName, '--keep-volume'], { cwd: appRoot, env, timeoutMs: 30_000 });
        runNoThrow('node', [dvmCli, 'rm', renamedDroneName, '--keep-volume'], { cwd: dvmRoot, env, timeoutMs: 30_000 });
        runNoThrow('node', [dvmCli, 'rm', droneName, '--keep-volume'], { cwd: dvmRoot, env, timeoutMs: 30_000 });
        runNoThrow('docker', ['rm', '-f', renamedDroneName], { timeoutMs: 30_000 });
        runNoThrow('docker', ['rm', '-f', droneName], { timeoutMs: 30_000 });
        runNoThrow('docker', ['volume', 'rm', '-f', `dvm-${renamedDroneName}-data`], { timeoutMs: 30_000 });
        runNoThrow('docker', ['volume', 'rm', '-f', `dvm-${droneName}-data`], { timeoutMs: 30_000 });
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    },
    { timeout: 300_000 }
  );

  test(
    'hub rename endpoint supports success and error responses',
    async () => {
      const docker = dockerUsable();
      if (!docker.ok) {
        if (process.env.CI) {
          throw new Error(`Docker is required for drone lifecycle regression tests in CI. ${docker.detail}`);
        }
        // eslint-disable-next-line no-console
        console.warn(`Skipping drone hub rename endpoint regression test: ${docker.detail}`);
        return;
      }

      const appRoot = path.resolve(__dirname, '..');
      const dvmRoot = path.resolve(appRoot, '..', 'dvm');
      ensureCliBuild(appRoot, dvmRoot);

      const droneCli = path.join(appRoot, 'dist', 'cli.js');
      const dvmCli = path.join(dvmRoot, 'dist', 'cli.js');
      const testId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const droneName = `drone-hub-rn-${testId}`;
      const renamedDroneName = `${droneName}-renamed`;
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-regression-hub-rn-'));
      const xdgDataHome = path.join(tempRoot, 'xdg-data');
      fs.mkdirSync(xdgDataHome, { recursive: true });
      fs.mkdirSync(path.join(xdgDataHome, 'drone'), { recursive: true });
      const env = {
        ...process.env,
        XDG_DATA_HOME: xdgDataHome,
        DVM_CLI_PATH: dvmCli,
        NO_COLOR: '1',
      };

      const prevXdgDataHome = process.env.XDG_DATA_HOME;
      const prevDvmCliPath = process.env.DVM_CLI_PATH;
      const prevNoColor = process.env.NO_COLOR;
      let hub: { port: number; close: () => Promise<void> } | null = null;
      const apiToken = `test-token-${testId}`;

      try {
        runOrThrow(
          'node',
          [droneCli, 'create', droneName, '--repo', '-', '--group', 'regression', '--container-port', '7777'],
          { cwd: appRoot, env, timeoutMs: 240_000 }
        );

        // Simulate a legacy/drifted registry key where entry.name remains correct
        // but the object key no longer matches.
        const registryPath = path.join(xdgDataHome, 'drone', 'registry.json');
        const registryRaw = fs.readFileSync(registryPath, 'utf8');
        const registry = JSON.parse(registryRaw) as any;
        const byName = Object.entries(registry?.drones ?? {}).find(
          ([, value]) => String((value as any)?.name ?? '').trim() === droneName
        ) as [string, any] | undefined;
        if (!byName) throw new Error(`Expected registry entry for ${droneName}`);
        const [entryKey, entry] = byName;
        delete registry.drones[entryKey];
        registry.drones[`legacy-key-${droneName}`] = entry;
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');

        process.env.XDG_DATA_HOME = xdgDataHome;
        process.env.DVM_CLI_PATH = dvmCli;
        process.env.NO_COLOR = '1';
        hub = await startDroneHubApiServer({ port: 0, host: '127.0.0.1', apiToken });

        const base = `http://127.0.0.1:${hub.port}`;
        const success = await fetch(`${base}/api/drones/${encodeURIComponent(droneName)}/rename`, {
          method: 'POST',
          signal: AbortSignal.timeout(30_000),
          headers: {
            authorization: `Bearer ${apiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ newName: renamedDroneName, startMode: 'preserve', migrateVolumeName: false }),
        });
        expect(success.status).toBe(200);
        const successPayload = (await success.json()) as { ok?: boolean; oldName?: string; newName?: string };
        expect(successPayload.ok).toBe(true);
        expect(successPayload.oldName).toBe(droneName);
        expect(successPayload.newName).toBe(renamedDroneName);

        // Old name should now fail (404 unknown drone).
        const missing = await fetch(`${base}/api/drones/${encodeURIComponent(droneName)}/rename`, {
          method: 'POST',
          signal: AbortSignal.timeout(30_000),
          headers: {
            authorization: `Bearer ${apiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ newName: `${droneName}-again` }),
        });
        expect(missing.status).toBe(404);
      } finally {
        if (hub) {
          try {
            await hub.close();
          } catch {
            // ignore
          }
        }
        if (prevXdgDataHome == null) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = prevXdgDataHome;
        if (prevDvmCliPath == null) delete process.env.DVM_CLI_PATH;
        else process.env.DVM_CLI_PATH = prevDvmCliPath;
        if (prevNoColor == null) delete process.env.NO_COLOR;
        else process.env.NO_COLOR = prevNoColor;

        runNoThrow('node', [droneCli, 'rm', renamedDroneName, '--keep-volume'], { cwd: appRoot, env, timeoutMs: 30_000 });
        runNoThrow('node', [droneCli, 'rm', droneName, '--keep-volume'], { cwd: appRoot, env, timeoutMs: 30_000 });
        runNoThrow('node', [dvmCli, 'rm', renamedDroneName, '--keep-volume'], { cwd: dvmRoot, env, timeoutMs: 30_000 });
        runNoThrow('node', [dvmCli, 'rm', droneName, '--keep-volume'], { cwd: dvmRoot, env, timeoutMs: 30_000 });
        runNoThrow('docker', ['rm', '-f', renamedDroneName], { timeoutMs: 30_000 });
        runNoThrow('docker', ['rm', '-f', droneName], { timeoutMs: 30_000 });
        runNoThrow('docker', ['volume', 'rm', '-f', `dvm-${renamedDroneName}-data`], { timeoutMs: 30_000 });
        runNoThrow('docker', ['volume', 'rm', '-f', `dvm-${droneName}-data`], { timeoutMs: 30_000 });
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    },
    { timeout: 420_000 }
  );
});
