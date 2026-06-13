import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveDetachedCliLaunchSpec } from './hub-launch';
import {
  normalizeRemotePublicUrl,
  pidIsRunning,
  readRemoteHubState,
  remoteHubLogPath,
  removeRemoteHubStateIfOwnedByPid,
  type RemoteHubState,
} from './remote-state';

type StartRemoteHubDetachedOptions = {
  port?: number | string;
  host?: string;
  publicUrl?: string | null;
  cliFilename?: string;
  createPairing?: boolean;
  force?: boolean;
};

export type RedactedRemoteHubState = Omit<RemoteHubState, 'controlToken'> & {
  url: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRemotePort(raw: unknown): number {
  const port = Number(raw ?? 8790);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid remote Hub port');
  return port;
}

function normalizeRemoteHost(raw: unknown): string {
  return String(raw || '127.0.0.1').trim() || '127.0.0.1';
}

function parseOptionalPublicUrl(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const url = normalizeRemotePublicUrl(value);
  if (!url) throw new Error('invalid remote public URL');
  return url;
}

function resolveCliFilename(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (value) return value;
  const argvCli = String(process.argv[1] ?? '').trim();
  if (argvCli) return argvCli;
  throw new Error('could not resolve Drone CLI path');
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!pidIsRunning(pid)) return true;
    await sleep(80);
  }
  return !pidIsRunning(pid);
}

async function stopProcess(pid: number): Promise<void> {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }

  const exited = await waitForPidExit(pid, 8_000);
  if (exited) return;

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
  await waitForPidExit(pid, 2_000);
}

export function redactRemoteHubState(state: RemoteHubState): RedactedRemoteHubState {
  return {
    version: state.version,
    pid: state.pid,
    host: state.host,
    port: state.port,
    publicUrl: state.publicUrl,
    startedAt: state.startedAt,
    logPath: state.logPath,
    url: state.publicUrl ?? `http://${state.host}:${state.port}`,
  };
}

export async function createRemoteHubPairing(state: RemoteHubState | null): Promise<any> {
  if (!state || !pidIsRunning(state.pid)) throw new Error('remote Hub is not running');
  const response = await fetch(`http://127.0.0.1:${state.port}/api/local/pairings`, {
    method: 'POST',
    headers: { authorization: `Bearer ${state.controlToken}` },
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!response.ok) throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
  return data;
}

export async function startRemoteHubDetached(options: StartRemoteHubDetachedOptions = {}): Promise<{
  alreadyRunning: boolean;
  state: RedactedRemoteHubState;
  pairing?: any;
}> {
  const current = await readRemoteHubState();
  if (current && pidIsRunning(current.pid)) {
    if (options.force) {
      await stopRemoteHubDetached();
    } else {
      return { alreadyRunning: true, state: redactRemoteHubState(current) };
    }
  }

  const port = normalizeRemotePort(options.port);
  const host = normalizeRemoteHost(options.host);
  const publicUrl = parseOptionalPublicUrl(options.publicUrl);
  const controlToken = crypto.randomBytes(32).toString('base64url');
  const logPath = remoteHubLogPath();
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const logHandle = await fs.open(logPath, 'a');
  try {
    const launch = resolveDetachedCliLaunchSpec({ cliFilename: resolveCliFilename(options.cliFilename) });
    const child = spawn(
      launch.command,
      [
        ...launch.args,
        'hub',
        'remote-run',
        '--port',
        String(port),
        '--host',
        host,
        '--control-token',
        controlToken,
        ...(publicUrl ? ['--public-url', publicUrl] : []),
      ],
      { detached: true, stdio: ['ignore', logHandle.fd, logHandle.fd], env: { ...process.env, DRONE_HUB_REMOTE_DAEMON: '1' } },
    );
    let spawnError: Error | null = null;
    child.once('error', (error) => {
      spawnError = error;
    });
    child.unref();

    let state: RemoteHubState | null = null;
    for (let i = 0; i < 60; i++) {
      if (spawnError) throw spawnError;
      const next = await readRemoteHubState();
      if (next && next.pid === child.pid) {
        state = next;
        break;
      }
      await sleep(80);
    }
    if (!state) {
      throw new Error(`remote Hub did not start; see ${logPath}`);
    }
    const pairing = options.createPairing ? await createRemoteHubPairing(state).catch(() => null) : null;
    return {
      alreadyRunning: false,
      state: redactRemoteHubState(state),
      ...(pairing ? { pairing } : {}),
    };
  } finally {
    await logHandle.close().catch(() => {});
  }
}

export async function stopRemoteHubDetached(): Promise<{ stopped: boolean; pid?: number; reason?: string }> {
  const state = await readRemoteHubState();
  if (!state) return { stopped: false, reason: 'not running' };
  if (pidIsRunning(state.pid)) {
    await stopProcess(state.pid);
  }
  await removeRemoteHubStateIfOwnedByPid(state.pid);
  return { stopped: true, pid: state.pid };
}
