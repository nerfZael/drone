import fs from 'node:fs/promises';
import path from 'node:path';

import { droneRootPath } from '../host/paths';

export type RemoteHubState = {
  version: 1;
  pid: number;
  host: string;
  port: number;
  publicUrl: string | null;
  controlToken: string;
  startedAt: string;
  logPath: string;
};

export function remoteHubStatePath(): string {
  return path.join(droneRootPath(), 'remote-hub.json');
}

export function remoteHubLogPath(): string {
  return path.join(droneRootPath(), 'remote-hub.log');
}

export function normalizeRemotePublicUrl(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function pidIsRunning(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return String(e?.code ?? '') === 'EPERM';
  }
}

export async function readRemoteHubState(): Promise<RemoteHubState | null> {
  try {
    const raw = await fs.readFile(remoteHubStatePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<RemoteHubState>;
    if (!parsed || parsed.version !== 1) return null;
    const pid = Number(parsed.pid);
    const port = Number(parsed.port);
    const host = typeof parsed.host === 'string' && parsed.host.trim() ? parsed.host.trim() : '127.0.0.1';
    const publicUrl = normalizeRemotePublicUrl(parsed.publicUrl);
    const controlToken = typeof parsed.controlToken === 'string' ? parsed.controlToken.trim() : '';
    const startedAt = typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date().toISOString();
    const logPath = typeof parsed.logPath === 'string' && parsed.logPath.trim() ? parsed.logPath.trim() : remoteHubLogPath();
    if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(port) || port <= 0 || !controlToken) return null;
    return { version: 1, pid: Math.floor(pid), host, port: Math.floor(port), publicUrl, controlToken, startedAt, logPath };
  } catch {
    return null;
  }
}

export async function writeRemoteHubState(state: RemoteHubState): Promise<void> {
  await fs.mkdir(path.dirname(remoteHubStatePath()), { recursive: true });
  await fs.writeFile(remoteHubStatePath(), JSON.stringify(state, null, 2), 'utf8');
  if (process.platform !== 'win32') {
    await fs.chmod(remoteHubStatePath(), 0o600).catch(() => {});
  }
}

export async function removeRemoteHubStateIfOwnedByPid(pid: number): Promise<void> {
  const state = await readRemoteHubState();
  if (!state || state.pid !== pid) return;
  await fs.rm(remoteHubStatePath(), { force: true }).catch(() => {});
}
