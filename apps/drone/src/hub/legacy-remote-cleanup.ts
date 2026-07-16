import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { droneRootPath } from '../host/paths';

type LegacyProcessKind = 'remote-hub' | 'ngrok';

type LegacyRemoteCleanupDependencies = {
  commandForPid?: (pid: number) => Promise<string | null>;
  isPidRunning?: (pid: number) => boolean;
  stopPid?: (pid: number) => Promise<boolean>;
  warn?: (message: string) => void;
};

type LegacyProcessState = {
  pid: number;
  port: number | null;
};

export type LegacyRemoteCleanupResult = {
  stoppedPids: number[];
  removedFiles: string[];
  warnings: string[];
};

const LEGACY_FILES = [
  'remote-hub.json',
  'remote-hub-desired.json',
  'remote-ngrok.json',
  'remote-hub.log',
  'remote-ngrok.log',
] as const;

function positivePid(raw: unknown): number | null {
  const pid = Number(raw);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function positivePort(raw: unknown): number | null {
  const port = Number(raw);
  return Number.isSafeInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function defaultPidIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return String(error?.code ?? '') === 'EPERM';
  }
}

async function execFileStdout(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr ?? '').trim() || error.message));
        return;
      }
      resolve(String(stdout ?? ''));
    });
  });
}

async function defaultCommandForPid(pid: number): Promise<string | null> {
  if (process.platform === 'linux') {
    try {
      const command = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8');
      const normalized = command.replace(/\0/g, ' ').trim();
      if (normalized) return normalized;
    } catch {
      // Fall through to the portable process lookup.
    }
  }
  try {
    if (process.platform === 'win32') {
      const command = await execFileStdout('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\").CommandLine`,
      ]);
      return command.trim() || null;
    }
    const command = await execFileStdout('ps', ['-p', String(pid), '-o', 'args=']);
    return command.trim() || null;
  } catch {
    return null;
  }
}

export function isLegacyRemoteHubCommand(command: string): boolean {
  return /(?:^|\s)hub\s+remote-run(?:\s|$)/i.test(command.trim());
}

export function isLegacyRemoteNgrokCommand(command: string, port: number | null): boolean {
  const normalized = command.trim();
  if (!/(?:^|[\\/\s"])(?:ngrok|ngrok\.exe)(?:["\s]|$)/i.test(normalized)) return false;
  if (!/(?:^|\s)http(?:\s|$)/i.test(normalized)) return false;
  return port == null || new RegExp(`(?:^|[:\\s])${port}(?:[/\\s]|$)`).test(normalized);
}

async function waitForPidExit(pid: number, isPidRunning: (pid: number) => boolean): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return !isPidRunning(pid);
}

async function defaultStopPid(pid: number): Promise<boolean> {
  if (process.platform === 'win32') {
    try {
      await execFileStdout('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
    } catch {
      // The process may already have exited.
    }
    return !defaultPidIsRunning(pid);
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return !defaultPidIsRunning(pid);
    }
  }
  if (await waitForPidExit(pid, defaultPidIsRunning)) return true;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Check the final state below.
    }
  }
  return await waitForPidExit(pid, defaultPidIsRunning);
}

async function readLegacyProcessState(filePath: string): Promise<LegacyProcessState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
    const pid = positivePid(parsed?.pid);
    if (!pid) return null;
    return { pid, port: positivePort(parsed?.port) };
  } catch {
    return null;
  }
}

function commandMatches(kind: LegacyProcessKind, command: string, port: number | null): boolean {
  return kind === 'remote-hub'
    ? isLegacyRemoteHubCommand(command)
    : isLegacyRemoteNgrokCommand(command, port);
}

/**
 * Stops the detached RemoteHub processes left by older Drone releases and
 * removes only their legacy state/log files. A live PID is never signalled
 * unless its command line identifies the expected legacy process.
 */
export async function cleanupLegacyRemoteHub(
  rootDir = droneRootPath(),
  dependencies: LegacyRemoteCleanupDependencies = {},
): Promise<LegacyRemoteCleanupResult> {
  const commandForPid = dependencies.commandForPid ?? defaultCommandForPid;
  const isPidRunning = dependencies.isPidRunning ?? defaultPidIsRunning;
  const stopPid = dependencies.stopPid ?? defaultStopPid;
  const warnings: string[] = [];
  const stoppedPids: number[] = [];
  const preservedStateFiles = new Set<string>();
  const warn = (message: string) => {
    warnings.push(message);
    dependencies.warn?.(message);
  };

  const candidates: Array<{ kind: LegacyProcessKind; stateFile: string }> = [
    { kind: 'remote-hub', stateFile: 'remote-hub.json' },
    { kind: 'ngrok', stateFile: 'remote-ngrok.json' },
  ];
  for (const candidate of candidates) {
    const statePath = path.join(rootDir, candidate.stateFile);
    const state = await readLegacyProcessState(statePath);
    if (!state || !isPidRunning(state.pid)) continue;
    const command = await commandForPid(state.pid);
    if (!command) {
      preservedStateFiles.add(candidate.stateFile);
      warn(`Could not verify legacy ${candidate.kind} process ${state.pid}; its state file was preserved.`);
      continue;
    }
    if (!commandMatches(candidate.kind, command, state.port)) {
      warn(`Skipped recycled PID ${state.pid}; it is not a legacy ${candidate.kind} process.`);
      continue;
    }
    if (await stopPid(state.pid)) {
      stoppedPids.push(state.pid);
    } else {
      preservedStateFiles.add(candidate.stateFile);
      warn(`Legacy ${candidate.kind} process ${state.pid} did not stop; its state file was preserved.`);
    }
  }

  const removedFiles: string[] = [];
  for (const name of LEGACY_FILES) {
    if (preservedStateFiles.has(name)) continue;
    const filePath = path.join(rootDir, name);
    const existed = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false);
    try {
      await fs.rm(filePath, { force: true });
      if (existed) removedFiles.push(name);
    } catch (error: any) {
      warn(`Could not remove legacy RemoteHub file ${name}: ${error?.message ?? String(error)}`);
    }
  }
  return { stoppedPids, removedFiles, warnings };
}
