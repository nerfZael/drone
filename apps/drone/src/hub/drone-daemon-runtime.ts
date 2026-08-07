import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  hostDroneDaemonDataPath,
  hostDroneDaemonLogPath,
  hostDroneDaemonTokenPath,
} from '../host/runtime';

export function resolveDroneDaemonJsPath(baseDir: string = __dirname): string {
  const candidates = [
    // Built hub: dist/hub -> dist/daemon.js
    path.resolve(baseDir, '..', 'daemon.js'),
    // Source/dev hub: src/hub -> dist/daemon.js
    path.resolve(baseDir, '..', '..', 'dist', 'daemon.js'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0] ?? path.resolve(baseDir, '..', 'daemon.js');
}

export function resolveDroneDaemonRuntimeDir(baseDir: string = __dirname): string {
  return path.dirname(resolveDroneDaemonJsPath(baseDir));
}

export function isDroneDaemonCommandForPort(commandRaw: string, portRaw: number): boolean {
  const command = String(commandRaw ?? '').trim();
  const port = Math.floor(Number(portRaw));
  if (!command || !Number.isFinite(port) || port <= 0) return false;
  const daemonEntry = /(?:^|[\s"'])(?:[^\s"']*[\\/])?daemon\.(?:js|ts)(?=$|[\s"'])/i;
  const portArgument = new RegExp(
    `(?:^|\\s)--port(?:=|\\s+)["']?${port}["']?(?=\\s|$)`,
  );
  return daemonEntry.test(command) && portArgument.test(command);
}

export async function assertDroneDaemonRuntimeReady(runtimeDir: string): Promise<void> {
  for (const fileName of ['daemon.js', 'blip.js', 'mcp-http-stdio-bridge.js']) {
    const filePath = path.join(runtimeDir, fileName);
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      throw new Error(`Missing ${filePath}. Run: bun run --filter drone build`);
    }
  }
}

export function hostDroneDaemonLaunchEnvironment(
  sourceEnv: NodeJS.ProcessEnv = process.env,
  executablePath: string = process.execPath,
): NodeJS.ProcessEnv {
  const executableDir = path.dirname(executablePath);
  const currentPath = String(sourceEnv.PATH ?? '');
  const pathEntries = currentPath.split(path.delimiter).filter(Boolean);
  return {
    ...sourceEnv,
    PATH: pathEntries.includes(executableDir)
      ? currentPath
      : [executableDir, currentPath].filter(Boolean).join(path.delimiter),
  };
}

export async function launchHostDroneDaemon(opts: {
  droneId: string;
  hostPort: number;
  token: string;
  daemonPath?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<number> {
  const droneId = String(opts.droneId ?? '').trim();
  const hostPort = Number(opts.hostPort);
  const token = String(opts.token ?? '').trim();
  if (!droneId) throw new Error('missing host drone id');
  if (!Number.isFinite(hostPort) || hostPort <= 0) {
    throw new Error('missing host runtime daemon port');
  }
  if (!token) throw new Error('missing host runtime daemon token');

  const daemonPath = String(opts.daemonPath ?? resolveDroneDaemonJsPath()).trim();
  const daemonDataDir = hostDroneDaemonDataPath(droneId);
  const tokenPath = hostDroneDaemonTokenPath(droneId);
  const logPath = hostDroneDaemonLogPath(droneId);
  const daemonEnv = hostDroneDaemonLaunchEnvironment(opts.env);
  await fs.promises.mkdir(daemonDataDir, { recursive: true });
  await fs.promises.writeFile(tokenPath, token, 'utf8');
  if (process.platform !== 'win32') {
    try {
      await fs.promises.chmod(tokenPath, 0o600);
    } catch {
      // Best effort on filesystems without POSIX modes.
    }
  }

  const log = await fs.promises.open(logPath, 'a');
  let child: ReturnType<typeof spawn> | null = null;
  try {
    child = spawn(
      process.execPath,
      [
        daemonPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(Math.floor(hostPort)),
        '--data-dir',
        daemonDataDir,
        '--token-file',
        tokenPath,
      ],
      {
        detached: true,
        stdio: ['ignore', log.fd, log.fd],
        env: daemonEnv,
      },
    );
    await new Promise<void>((resolve, reject) => {
      let spawned = false;
      child?.once('spawn', () => {
        spawned = true;
        resolve();
      });
      child?.once('error', (error) => {
        if (!spawned) reject(error);
      });
    });
    child.unref();
  } finally {
    await log.close();
  }
  if (!child?.pid || !Number.isFinite(child.pid)) {
    throw new Error('failed to launch host daemon process');
  }
  return Math.floor(child.pid);
}
