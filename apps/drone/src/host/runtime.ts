import path from 'node:path';
import { droneRootPath } from './paths';

export type DroneRuntime = 'container' | 'host';

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
