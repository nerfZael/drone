import path from 'node:path';
import { droneRootPath } from './paths';

export type DroneRuntime = 'container' | 'host';
export const DRONE_DAEMON_SESSION_NAME = 'drone-daemon';

export function missingHostDependencyMessage(binary: string, contextRaw?: string): string {
  const tool = String(binary ?? '').trim() || 'required tool';
  const context = String(contextRaw ?? '').trim() || 'this operation';
  return `${context} require ${tool} on the host PATH`;
}

function shellQuote(raw: string): string {
  return `'${String(raw ?? '').replace(/'/g, `'\\''`)}'`;
}

function safePathSegment(raw: string, fallback: string): string {
  const cleaned = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return cleaned || fallback;
}

export function normalizeDroneRuntime(raw: unknown): DroneRuntime {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'host' ? 'host' : 'container';
}

export function isHostRuntime(raw: unknown): boolean {
  return normalizeDroneRuntime(raw) === 'host';
}

export function hostDroneRootPath(droneIdRaw: string): string {
  const droneId = safePathSegment(droneIdRaw, 'drone');
  return droneRootPath('host-drones', droneId);
}

export function hostDroneWorkspacePath(droneIdRaw: string): string {
  return path.join(hostDroneRootPath(droneIdRaw), 'workspace');
}

export function hostDroneDaemonDataPath(droneIdRaw: string): string {
  return path.join(hostDroneRootPath(droneIdRaw), 'daemon');
}

export function hostDroneDaemonTokenPath(droneIdRaw: string): string {
  return path.join(hostDroneDaemonDataPath(droneIdRaw), 'token');
}

export function hostDroneDaemonLogPath(droneIdRaw: string): string {
  return path.join(hostDroneRootPath(droneIdRaw), 'daemon.log');
}

export function removeRetiredContainerCliScripts(): string {
  return [
    'set -euo pipefail',
    'rm -f /usr/local/bin/fleet /usr/local/bin/tasks',
  ].join('\n');
}

export function installBlipCliScript(opts?: { runtimeDir?: string; binPath?: string }): string {
  const runtimeDir = String(opts?.runtimeDir ?? '/dvm-data/drone/dist').trim() || '/dvm-data/drone/dist';
  const binPath = String(opts?.binPath ?? '/usr/local/bin/blip').trim() || '/usr/local/bin/blip';
  const blipJs = path.posix.join(runtimeDir, 'blip.js');
  return [
    'set -euo pipefail',
    `mkdir -p ${shellQuote(path.posix.dirname(binPath))}`,
    `cat > ${shellQuote(binPath)} <<'EOF'`,
    '#!/usr/bin/env bash',
    `exec node ${shellQuote(blipJs)} "$@"`,
    'EOF',
    `chmod 755 ${shellQuote(binPath)}`,
  ].join('\n');
}

export function buildContainerDroneDaemonLaunchScript(
  containerPortRaw: number,
  opts?: {
    runtimeDir?: string;
    legacyDaemonPath?: string;
    dataDir?: string;
    tokenPath?: string;
    host?: string;
  }
): string {
  const containerPort = Number(containerPortRaw);
  if (!Number.isFinite(containerPort) || containerPort <= 0 || Math.floor(containerPort) !== containerPort) {
    throw new Error(`invalid container daemon port: ${containerPortRaw}`);
  }

  const runtimeDir = String(opts?.runtimeDir ?? '/dvm-data/drone/dist').trim() || '/dvm-data/drone/dist';
  const legacyDaemonPath = String(opts?.legacyDaemonPath ?? '/dvm-data/drone/daemon.js').trim() || '/dvm-data/drone/daemon.js';
  const dataDir = String(opts?.dataDir ?? '/dvm-data/drone').trim() || '/dvm-data/drone';
  const tokenPath = String(opts?.tokenPath ?? '/dvm-data/drone/token').trim() || '/dvm-data/drone/token';
  const host = String(opts?.host ?? '0.0.0.0').trim() || '0.0.0.0';
  const runtimeDaemonPath = path.posix.join(runtimeDir, 'daemon.js');

  return [
    'set -euo pipefail',
    `if [ -f ${shellQuote(runtimeDaemonPath)} ]; then`,
    `  daemon_js=${shellQuote(runtimeDaemonPath)}`,
    `elif [ -f ${shellQuote(legacyDaemonPath)} ]; then`,
    `  daemon_js=${shellQuote(legacyDaemonPath)}`,
    'else',
    `  echo ${shellQuote(`missing drone daemon runtime (${runtimeDaemonPath} or ${legacyDaemonPath})`)} 1>&2`,
    '  exit 1',
    'fi',
    `exec node "$daemon_js" --host ${shellQuote(host)} --port ${shellQuote(String(containerPort))} --data-dir ${shellQuote(dataDir)} --token-file ${shellQuote(tokenPath)}`,
  ].join('\n');
}
