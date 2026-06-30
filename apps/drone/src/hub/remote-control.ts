import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveDetachedCliLaunchSpec } from './hub-launch';
import {
  normalizeRemotePublicUrl,
  pidIsRunning,
  readRemoteHubDesiredState,
  readRemoteHubState,
  readRemoteNgrokState,
  remoteHubLogPath,
  remoteNgrokLogPath,
  removeRemoteHubStateIfOwnedByPid,
  removeRemoteNgrokStateIfOwnedByPid,
  type RemoteHubState,
  writeRemoteHubDesiredState,
  writeRemoteNgrokState,
} from './remote-state';

type StartRemoteHubDetachedOptions = {
  port?: number | string;
  host?: string;
  publicUrl?: string | null;
  cliFilename?: string;
  createPairing?: boolean;
  force?: boolean;
};

type EnsureRemoteHubDetachedOptions = {
  cliFilename?: string;
  force?: boolean;
};

type StopRemoteHubDetachedOptions = {
  disableDesired?: boolean;
  stopNgrok?: boolean;
};

export type RedactedRemoteHubState = Omit<RemoteHubState, 'controlToken'> & {
  url: string;
};

type EnsureRemoteHubDetachedResult = {
  desired: boolean;
  started: boolean;
  alreadyRunning: boolean;
  state: RedactedRemoteHubState | null;
  error?: string;
};

type StopRemoteNgrokResult = {
  stopped: boolean;
  pid?: number;
  reason?: string;
};

let ensureDesiredRemoteHubPromise: Promise<EnsureRemoteHubDetachedResult> | null = null;
let ensureDesiredRemoteHubRetryAtMs = 0;
let ensureDesiredRemoteHubLastError: string | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRemotePort(raw: unknown): number {
  const port = Number(raw ?? 8790);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('invalid remote Hub port');
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

export async function getRemoteHubPairingStatus(
  state: RemoteHubState | null,
  tokenRaw: unknown,
): Promise<{ ok: true; active: boolean; expiresAt: string | null }> {
  if (!state || !pidIsRunning(state.pid)) throw new Error('remote Hub is not running');
  const token = String(tokenRaw ?? '').trim();
  if (!token) throw new Error('pairing token is required');
  const response = await fetch(
    `http://127.0.0.1:${state.port}/api/local/pairings/${encodeURIComponent(token)}/status`,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${state.controlToken}` },
    },
  );
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!response.ok) throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
  return {
    ok: true,
    active: data?.active === true,
    expiresAt: typeof data?.expiresAt === 'string' ? data.expiresAt : null,
  };
}

export async function startRemoteHubDetached(options: StartRemoteHubDetachedOptions = {}): Promise<{
  alreadyRunning: boolean;
  state: RedactedRemoteHubState;
  pairing?: any;
}> {
  const current = await readRemoteHubState();
  if (current && pidIsRunning(current.pid)) {
    if (options.force) {
      await stopRemoteHubDetached({ disableDesired: false, stopNgrok: false });
    } else {
      await writeRemoteHubDesiredState({
        version: 1,
        enabled: true,
        host: current.host,
        port: current.port,
        publicUrl: current.publicUrl,
        updatedAt: new Date().toISOString(),
      });
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
    const launch = resolveDetachedCliLaunchSpec({
      cliFilename: resolveCliFilename(options.cliFilename),
    });
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
      {
        detached: true,
        stdio: ['ignore', logHandle.fd, logHandle.fd],
        env: { ...process.env, DRONE_HUB_REMOTE_DAEMON: '1' },
      },
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
    await writeRemoteHubDesiredState({
      version: 1,
      enabled: true,
      host,
      port: state.port,
      publicUrl,
      updatedAt: new Date().toISOString(),
    });
    const pairing = options.createPairing
      ? await createRemoteHubPairing(state).catch(() => null)
      : null;
    return {
      alreadyRunning: false,
      state: redactRemoteHubState(state),
      ...(pairing ? { pairing } : {}),
    };
  } finally {
    await logHandle.close().catch(() => {});
  }
}

export async function stopRemoteHubDetached(): Promise<{
  stopped: boolean;
  pid?: number;
  reason?: string;
  ngrok?: StopRemoteNgrokResult;
}>;
export async function stopRemoteHubDetached(options: StopRemoteHubDetachedOptions): Promise<{
  stopped: boolean;
  pid?: number;
  reason?: string;
  ngrok?: StopRemoteNgrokResult;
}>;
export async function stopRemoteHubDetached(options: StopRemoteHubDetachedOptions = {}): Promise<{
  stopped: boolean;
  pid?: number;
  reason?: string;
  ngrok?: StopRemoteNgrokResult;
}> {
  const current = await readRemoteHubState();
  if (options.disableDesired !== false) {
    await writeRemoteHubDesiredState({
      version: 1,
      enabled: false,
      host: current?.host ?? '127.0.0.1',
      port: current?.port ?? 8790,
      publicUrl: current?.publicUrl ?? null,
      updatedAt: new Date().toISOString(),
    });
  }
  const state = await readRemoteHubState();
  if (!state) {
    const ngrok = options.stopNgrok === false ? null : await stopRemoteNgrokTunnel();
    return { stopped: false, reason: 'not running', ...(ngrok?.stopped ? { ngrok } : {}) };
  }
  if (pidIsRunning(state.pid)) {
    await stopProcess(state.pid);
  }
  await removeRemoteHubStateIfOwnedByPid(state.pid);
  const ngrok = options.stopNgrok === false ? null : await stopRemoteNgrokTunnel({ port: state.port });
  return { stopped: true, pid: state.pid, ...(ngrok?.stopped ? { ngrok } : {}) };
}

export async function ensureDesiredRemoteHubDetached(
  options: EnsureRemoteHubDetachedOptions = {},
): Promise<EnsureRemoteHubDetachedResult> {
  const desired = await readRemoteHubDesiredState();
  if (!desired?.enabled) {
    const current = await readRemoteHubState();
    const running = Boolean(current && pidIsRunning(current.pid));
    return {
      desired: false,
      started: false,
      alreadyRunning: running,
      state: running && current ? redactRemoteHubState(current) : null,
    };
  }
  const current = await readRemoteHubState();
  if (!options.force && current && pidIsRunning(current.pid)) {
    ensureDesiredRemoteHubRetryAtMs = 0;
    ensureDesiredRemoteHubLastError = null;
    return {
      desired: true,
      started: false,
      alreadyRunning: true,
      state: redactRemoteHubState(current),
    };
  }
  if (ensureDesiredRemoteHubPromise) return ensureDesiredRemoteHubPromise;
  if (ensureDesiredRemoteHubRetryAtMs > Date.now()) {
    return {
      desired: true,
      started: false,
      alreadyRunning: false,
      state: null,
      ...(ensureDesiredRemoteHubLastError ? { error: ensureDesiredRemoteHubLastError } : {}),
    };
  }
  const promise: Promise<EnsureRemoteHubDetachedResult> = (async () => {
    try {
      const result = await startRemoteHubDetached({
        port: desired.port,
        host: desired.host,
        publicUrl: desired.publicUrl,
        cliFilename: options.cliFilename,
        force: options.force,
      });
      ensureDesiredRemoteHubRetryAtMs = 0;
      ensureDesiredRemoteHubLastError = null;
      return {
        desired: true,
        started: !result.alreadyRunning,
        alreadyRunning: result.alreadyRunning,
        state: result.state,
      };
    } catch (error: any) {
      ensureDesiredRemoteHubLastError = error?.message ?? String(error);
      ensureDesiredRemoteHubRetryAtMs = Date.now() + 10_000;
      return {
        desired: true,
        started: false,
        alreadyRunning: false,
        state: null,
        error: ensureDesiredRemoteHubLastError ?? 'remote Hub start failed',
      };
    } finally {
      ensureDesiredRemoteHubPromise = null;
    }
  })();
  ensureDesiredRemoteHubPromise = promise;
  return promise;
}

export async function startRemoteNgrokTunnel(portRaw: unknown): Promise<{
  ok: true;
  logPath: string;
  pid?: number;
  alreadyRunning?: boolean;
}> {
  const port = normalizeRemotePort(portRaw);
  if (port <= 0) throw new Error('ngrok requires a fixed local port');
  const current = await readRemoteNgrokState();
  if (current && current.port === port && pidIsRunning(current.pid)) {
    return { ok: true, logPath: current.logPath, pid: current.pid, alreadyRunning: true };
  }
  if (current && pidIsRunning(current.pid)) {
    await stopRemoteNgrokTunnel();
  } else if (current) {
    await removeRemoteNgrokStateIfOwnedByPid(current.pid);
  }
  const logPath = remoteNgrokLogPath();
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const logHandle = await fs.open(logPath, 'a');
  try {
    const child = spawn('ngrok', ['http', String(port)], {
      detached: true,
      stdio: ['ignore', logHandle.fd, logHandle.fd],
      env: process.env,
    });
    let spawnError: Error | null = null;
    child.once('error', (error) => {
      spawnError = error;
    });
    child.unref();
    await sleep(250);
    if (spawnError) throw spawnError;
    if (!child.pid) throw new Error('ngrok did not report a pid');
    await writeRemoteNgrokState({
      version: 1,
      pid: child.pid,
      port,
      startedAt: new Date().toISOString(),
      logPath,
    });
    return { ok: true, logPath, pid: child.pid };
  } finally {
    await logHandle.close().catch(() => {});
  }
}

export async function stopRemoteNgrokTunnel(options: { port?: number | string } = {}): Promise<StopRemoteNgrokResult> {
  const state = await readRemoteNgrokState();
  if (!state) return { stopped: false, reason: 'not running' };
  const requestedPort =
    options.port == null || String(options.port).trim() === ''
      ? null
      : normalizeRemotePort(options.port);
  if (requestedPort != null && state.port !== requestedPort) {
    return { stopped: false, reason: 'different port' };
  }
  if (pidIsRunning(state.pid)) {
    await stopProcess(state.pid);
    await removeRemoteNgrokStateIfOwnedByPid(state.pid);
    return { stopped: true, pid: state.pid };
  }
  await removeRemoteNgrokStateIfOwnedByPid(state.pid);
  return { stopped: false, pid: state.pid, reason: 'stale state file' };
}
