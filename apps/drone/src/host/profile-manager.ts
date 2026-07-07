import fs from 'node:fs/promises';
import path from 'node:path';
import * as dvmPackage from 'dvm';
import { resetDroneRootDirCache } from './paths';
import {
  DEFAULT_PROFILE_NAME,
  defaultProfileDroneRootDir,
  defaultProfileDvmRootDir,
  ensureProfileDirs,
  legacyDefaultDroneRootDir,
  legacyDefaultDvmRootDir,
  listProfiles,
  normalizeProfileName,
  profileDroneRootDir,
  profileDvmRootDir,
  profileRootDir,
  readActiveProfileName,
  writeActiveProfileName,
} from './profiles';
import { dvmRemove } from './dvm';
import { normalizeDroneRuntime } from './runtime';
import { clearWelcomeDismissedAtForScope, resolveHubSetupScopeKey } from './setup-state';
import { readRegistryJsonFromSqlitePath } from './sqlite-registry-store';

export type HubLaunchEnvSnapshot = {
  llmProvider: 'openai' | 'gemini' | null;
  llmProviderRaw: string | null;
  openai: {
    hasValue: boolean;
    rawLength: number | null;
    trimmedLength: number | null;
    fingerprint: string | null;
  };
  gemini: {
    hasValue: boolean;
    rawLength: number | null;
    trimmedLength: number | null;
    fingerprint: string | null;
  };
};

export type HubState = {
  version: 1;
  pid: number;
  apiHost: string;
  apiPort: number;
  uiPort: number;
  containerMcp?: {
    host: string;
    port: number;
    url: string;
  } | null;
  voiceStream?: {
    port: number;
    url: string;
  } | null;
  startedAt: string;
  logPath: string;
  launchEnv: HubLaunchEnvSnapshot | null;
};

export type HubStateSync = {
  state: HubState;
  apiToken: string;
  mcpToken?: string | null;
  previousRootDir?: string | null;
};

export type ProfileSummary = {
  name: string;
  active: boolean;
  rootDir: string;
  droneDataDir: string;
  dvmDataDir: string;
};

export type ProfileListState = {
  activeProfile: string | null;
  mode: 'profile';
  droneDataDir: string;
  dvmDataDir: string;
  profiles: ProfileSummary[];
};

export type CreateProfileResult = {
  created: string;
  activeProfile: string | null;
  stoppedHub: boolean;
  rootDir: string;
  droneDataDir: string;
  dvmDataDir: string;
};

export type UseProfileResult = {
  activeProfile: string;
  stoppedHub: boolean;
  droneDataDir: string;
  dvmDataDir: string;
};

export type DeleteProfileResult = {
  deleted: string;
  stoppedHub: boolean;
  removedContainers: string[];
  removedHostRoots: string[];
};

export type RenameProfileResult = {
  renamedFrom: string;
  renamedTo: string;
  activeProfile: string | null;
  rootDir: string;
  droneDataDir: string;
  dvmDataDir: string;
};

function droneDir(rootDir?: string): string {
  return rootDir ? path.resolve(rootDir) : defaultProfileDroneRootDir();
}

function hubStatePath(rootDir?: string): string {
  return path.join(droneDir(rootDir), 'hub.json');
}

function hubTokenPath(rootDir?: string): string {
  return path.join(droneDir(rootDir), 'hub.token');
}

function hubMcpTokenPath(rootDir?: string): string {
  return path.join(droneDir(rootDir), 'hub.mcp.token');
}

async function ensureDroneDir(rootDir?: string): Promise<void> {
  await fs.mkdir(droneDir(rootDir), { recursive: true });
}

function pidIsRunning(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return String(error?.code ?? '') === 'EPERM';
  }
}

async function setPrivateFileModeBestEffort(targetPath: string): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    await fs.chmod(targetPath, 0o600);
  } catch (error: any) {
    const code = String(error?.code ?? '');
    if (code === 'ENOSYS' || code === 'EINVAL' || code === 'EPERM') return;
    throw error;
  }
}

async function readHubState(rootDir?: string): Promise<HubState | null> {
  try {
    const raw = await fs.readFile(hubStatePath(rootDir), 'utf8');
    const parsed: any = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Number(parsed.version) !== 1) return null;
    const pid = Number(parsed.pid);
    const apiPort = Number(parsed.apiPort);
    const uiPort = Number(parsed.uiPort);
    if (!Number.isFinite(pid) || !Number.isFinite(apiPort) || !Number.isFinite(uiPort)) return null;
    return {
      version: 1,
      pid,
      apiHost: typeof parsed.apiHost === 'string' ? parsed.apiHost : '127.0.0.1',
      apiPort,
      uiPort,
      containerMcp: parseHubContainerMcpState(parsed.containerMcp),
      voiceStream: parseHubVoiceStreamState(parsed.voiceStream),
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date().toISOString(),
      logPath: typeof parsed.logPath === 'string' ? parsed.logPath : path.join(droneDir(rootDir), 'hub.log'),
      launchEnv: parsed.launchEnv ?? null,
    };
  } catch {
    return null;
  }
}

function parseHubContainerMcpState(raw: unknown): HubState['containerMcp'] {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as any;
  const host = typeof value.host === 'string' ? value.host.trim() : '';
  const port = Number(value.port);
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  if (!host || !Number.isFinite(port) || port <= 0 || !url) return null;
  return { host, port: Math.floor(port), url };
}

function parseHubVoiceStreamState(raw: unknown): HubState['voiceStream'] {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as any;
  const port = Number(value.port);
  const url = typeof value.url === 'string' ? value.url : '';
  if (!Number.isFinite(port) || port <= 0 || !url) return null;
  return { port, url };
}

async function writeHubState(state: HubState, rootDir?: string): Promise<void> {
  await ensureDroneDir(rootDir);
  const targetPath = hubStatePath(rootDir);
  await fs.writeFile(targetPath, JSON.stringify(state, null, 2), 'utf8');
  await setPrivateFileModeBestEffort(targetPath);
}

async function writeHubApiToken(token: string, rootDir?: string): Promise<void> {
  await ensureDroneDir(rootDir);
  const targetPath = hubTokenPath(rootDir);
  await fs.writeFile(targetPath, `${String(token ?? '').trim()}\n`, 'utf8');
  await setPrivateFileModeBestEffort(targetPath);
}

async function writeHubMcpToken(token: string, rootDir?: string): Promise<void> {
  await ensureDroneDir(rootDir);
  const targetPath = hubMcpTokenPath(rootDir);
  await fs.writeFile(targetPath, `${String(token ?? '').trim()}\n`, 'utf8');
  await setPrivateFileModeBestEffort(targetPath);
}

async function clearHubApiTokenBestEffort(rootDir?: string): Promise<void> {
  try {
    await fs.rm(hubTokenPath(rootDir), { force: true });
  } catch {
    // ignore
  }
}

async function clearHubMcpTokenBestEffort(rootDir?: string): Promise<void> {
  try {
    await fs.rm(hubMcpTokenPath(rootDir), { force: true });
  } catch {
    // ignore
  }
}

async function removeHubStateBestEffort(rootDir?: string): Promise<void> {
  try {
    await fs.rm(hubStatePath(rootDir), { force: true });
  } catch {
    // ignore
  }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!pidIsRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return !pidIsRunning(pid);
}

async function stopHubProcess(pid: number): Promise<void> {
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

async function stopHostDaemonByPid(pidRaw: unknown): Promise<void> {
  const targetPid = Number(pidRaw);
  if (!Number.isFinite(targetPid) || targetPid <= 0) return;
  const isRunning = () => {
    try {
      process.kill(targetPid, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (!isRunning()) return;
  try {
    process.kill(targetPid, 'SIGTERM');
  } catch {
    return;
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isRunning()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    process.kill(targetPid, 'SIGKILL');
  } catch {
    // ignore
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function dirHasEntries(targetPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(targetPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function moveTreeIfNeeded(sourcePath: string, targetPath: string): Promise<boolean> {
  if (!(await pathExists(sourcePath))) return false;
  if (await dirHasEntries(targetPath)) return false;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.rename(sourcePath, targetPath);
    return true;
  } catch {
    await fs.cp(sourcePath, targetPath, { recursive: true });
    await fs.rm(sourcePath, { recursive: true, force: true });
    return true;
  }
}

async function moveTreeRequired(sourcePath: string, targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.rename(sourcePath, targetPath);
    return;
  } catch {
    await fs.cp(sourcePath, targetPath, { recursive: true });
    await fs.rm(sourcePath, { recursive: true, force: true });
  }
}

async function migrateLegacyRootsToDefaultProfileIfNeeded(profileName: string): Promise<void> {
  if (profileName !== DEFAULT_PROFILE_NAME) return;
  await ensureProfileDirs(profileName);
  await moveTreeIfNeeded(legacyDefaultDroneRootDir(), profileDroneRootDir(profileName));
  await moveTreeIfNeeded(legacyDefaultDvmRootDir(), profileDvmRootDir(profileName));
}

async function stopHubAtRootIfRunning(rootDir: string): Promise<boolean> {
  const current = await readHubState(rootDir);
  if (!current || !pidIsRunning(current.pid)) {
    await removeHubStateBestEffort(rootDir);
    await clearHubApiTokenBestEffort(rootDir);
    await clearHubMcpTokenBestEffort(rootDir);
    return false;
  }
  await stopHubProcess(current.pid);
  await removeHubStateBestEffort(rootDir);
  await clearHubApiTokenBestEffort(rootDir);
  await clearHubMcpTokenBestEffort(rootDir);
  return true;
}

async function readRegistrySnapshotAtRoot(rootDir: string): Promise<any> {
  try {
    const raw = readRegistryJsonFromSqlitePath(path.join(rootDir, 'hub.sqlite')) ?? (await fs.readFile(path.join(rootDir, 'registry.json'), 'utf8'));
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function deleteProfileResources(profileName: string): Promise<{
  removedContainers: string[];
  removedHostRoots: string[];
  stoppedHub: boolean;
}> {
  const droneDirForProfile = profileDroneRootDir(profileName);
  const reg = await readRegistrySnapshotAtRoot(droneDirForProfile);
  const removedContainers: string[] = [];
  const removedHostRoots: string[] = [];
  const failures: string[] = [];
  const stoppedHub = await stopHubAtRootIfRunning(droneDirForProfile);
  const drones = reg?.drones && typeof reg.drones === 'object' && !Array.isArray(reg.drones) ? Object.values(reg.drones) : [];

  for (const droneAny of drones) {
    const drone = droneAny as any;
    const runtime = normalizeDroneRuntime(drone?.runtime);
    if (runtime === 'host') {
      const hostPid = Number(drone?.host?.pid);
      const hostRootDir = String(drone?.host?.rootDir ?? '').trim();
      try {
        if (Number.isFinite(hostPid) && hostPid > 0) {
          await stopHostDaemonByPid(hostPid);
        }
        if (hostRootDir) {
          await fs.rm(hostRootDir, { recursive: true, force: true });
          removedHostRoots.push(hostRootDir);
        }
      } catch (error: any) {
        failures.push(`host runtime ${String(drone?.name ?? drone?.id ?? '(unknown)')}: ${error?.message ?? String(error)}`);
      }
      continue;
    }

    const containerName = String(drone?.containerName ?? drone?.name ?? '').trim();
    if (!containerName) continue;
    try {
      await dvmRemove(containerName, { keepVolume: false });
      removedContainers.push(containerName);
    } catch (error: any) {
      failures.push(`container ${containerName}: ${error?.message ?? String(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`failed deleting profile resources:\n- ${failures.join('\n- ')}`);
  }

  return { removedContainers, removedHostRoots, stoppedHub };
}

function resetActiveProfileCaches(): void {
  resetDroneRootDirCache();
  const resetDvmRootDirCache = (dvmPackage as any)?.resetDvmRootDirCache;
  if (typeof resetDvmRootDirCache === 'function') {
    resetDvmRootDirCache();
  }
}

async function syncRunningHubStateForProfile(profileName: string, sync: HubStateSync): Promise<void> {
  const nextRootDir = profileDroneRootDir(profileName);
  const previousRootDir = sync.previousRootDir ? path.resolve(sync.previousRootDir) : null;
  await writeHubState(sync.state, nextRootDir);
  await writeHubApiToken(sync.apiToken, nextRootDir);
  if (sync.mcpToken) await writeHubMcpToken(sync.mcpToken, nextRootDir);
  if (previousRootDir && previousRootDir !== nextRootDir) {
    await removeHubStateBestEffort(previousRootDir);
    await clearHubApiTokenBestEffort(previousRootDir);
    await clearHubMcpTokenBestEffort(previousRootDir);
  }
}

export async function listProfilesState(): Promise<ProfileListState> {
  const activeProfile = (await readActiveProfileName()) ?? DEFAULT_PROFILE_NAME;
  const profiles = await listProfiles();
  return {
    activeProfile,
    mode: 'profile',
    droneDataDir: profileDroneRootDir(activeProfile),
    dvmDataDir: profileDvmRootDir(activeProfile),
    profiles: profiles.map((name) => ({
      name,
      active: name === activeProfile,
      rootDir: profileRootDir(name),
      droneDataDir: profileDroneRootDir(name),
      dvmDataDir: profileDvmRootDir(name),
    })),
  };
}

export async function ensureDefaultProfileForFirstRun(): Promise<{
  bootstrapped: boolean;
  activeProfile: string | null;
}> {
  const activeProfile = await readActiveProfileName();
  if (activeProfile) {
    await migrateLegacyRootsToDefaultProfileIfNeeded(activeProfile);
    resetActiveProfileCaches();
    return { bootstrapped: false, activeProfile };
  }
  if (String(process.env.DRONE_DATA_DIR ?? '').trim() || String(process.env.DVM_DATA_DIR ?? '').trim()) {
    return { bootstrapped: false, activeProfile: null };
  }
  const profiles = await listProfiles();
  if (profiles.includes(DEFAULT_PROFILE_NAME)) {
    await writeActiveProfileName(DEFAULT_PROFILE_NAME);
    await migrateLegacyRootsToDefaultProfileIfNeeded(DEFAULT_PROFILE_NAME);
    resetActiveProfileCaches();
    return { bootstrapped: true, activeProfile: DEFAULT_PROFILE_NAME };
  }
  if (profiles.length > 0) {
    await writeActiveProfileName(profiles[0]);
    resetActiveProfileCaches();
    return { bootstrapped: true, activeProfile: profiles[0] };
  }
  await createProfile(DEFAULT_PROFILE_NAME, { use: true, stopCurrentHub: false });
  return { bootstrapped: true, activeProfile: DEFAULT_PROFILE_NAME };
}

export async function createProfile(nameRaw: string, opts?: { use?: boolean; stopCurrentHub?: boolean }): Promise<CreateProfileResult> {
  const profileName = normalizeProfileName(nameRaw);
  if (!profileName) throw new Error('invalid profile name (use lowercase letters, numbers, ".", "_" or "-")');
  let stoppedHub = false;
  const currentActive = opts?.use ? await readActiveProfileName() : null;
  const currentDroneDir = currentActive ? profileDroneRootDir(currentActive) : legacyDefaultDroneRootDir();
  if (opts?.use) {
    if (opts.stopCurrentHub !== false) {
      stoppedHub = await stopHubAtRootIfRunning(currentDroneDir);
    }
  }
  await ensureProfileDirs(profileName);
  await migrateLegacyRootsToDefaultProfileIfNeeded(profileName);
  if (opts?.use) {
    await writeActiveProfileName(profileName);
    resetActiveProfileCaches();
  }
  return {
    created: profileName,
    activeProfile: opts?.use ? profileName : await readActiveProfileName(),
    stoppedHub,
    rootDir: profileRootDir(profileName),
    droneDataDir: profileDroneRootDir(profileName),
    dvmDataDir: profileDvmRootDir(profileName),
  };
}

export async function useProfile(nameRaw: string, opts?: { stopCurrentHub?: boolean; syncRunningHubState?: HubStateSync | null }): Promise<UseProfileResult> {
  const profileName = normalizeProfileName(nameRaw);
  if (!profileName) throw new Error('invalid profile name (use lowercase letters, numbers, ".", "_" or "-")');

  if (profileName === DEFAULT_PROFILE_NAME) {
    await ensureProfileDirs(profileName);
  } else if (!(await pathExists(profileRootDir(profileName)))) {
    throw new Error(`unknown profile: ${profileName}`);
  }

  const currentActive = await readActiveProfileName();
  const currentDroneDir = currentActive ? profileDroneRootDir(currentActive) : legacyDefaultDroneRootDir();
  let stoppedHub = false;
  if (opts?.stopCurrentHub !== false) {
    stoppedHub = await stopHubAtRootIfRunning(currentDroneDir);
  }
  await migrateLegacyRootsToDefaultProfileIfNeeded(profileName);
  await writeActiveProfileName(profileName);
  resetActiveProfileCaches();
  if (opts?.syncRunningHubState) {
    await syncRunningHubStateForProfile(profileName, {
      ...opts.syncRunningHubState,
      previousRootDir: opts.syncRunningHubState.previousRootDir ?? currentDroneDir,
    });
  }

  return {
    activeProfile: profileName,
    stoppedHub,
    droneDataDir: profileDroneRootDir(profileName),
    dvmDataDir: profileDvmRootDir(profileName),
  };
}

export async function deleteProfile(nameRaw: string, opts?: { allowDeleteActive?: boolean }): Promise<DeleteProfileResult> {
  const profileName = normalizeProfileName(nameRaw);
  if (!profileName) throw new Error('invalid profile name');
  const activeProfile = await readActiveProfileName();
  if (!opts?.allowDeleteActive && activeProfile === profileName) {
    throw new Error(`cannot delete active profile: ${profileName} (switch to another profile first)`);
  }
  if (!(await pathExists(profileRootDir(profileName)))) {
    throw new Error(`unknown profile: ${profileName}`);
  }

  const { removedContainers, removedHostRoots, stoppedHub } = await deleteProfileResources(profileName);
  await fs.rm(profileRootDir(profileName), { recursive: true, force: true });
  await clearWelcomeDismissedAtForScope(resolveHubSetupScopeKey(profileName));
  return {
    deleted: profileName,
    stoppedHub,
    removedContainers,
    removedHostRoots,
  };
}

export async function renameProfile(
  nameRaw: string,
  nextNameRaw: string,
  opts?: { syncRunningHubState?: HubStateSync | null },
): Promise<RenameProfileResult> {
  const profileName = normalizeProfileName(nameRaw);
  if (!profileName) throw new Error('invalid profile name');
  const nextProfileName = normalizeProfileName(nextNameRaw);
  if (!nextProfileName) throw new Error('invalid new profile name');
  if (!(await pathExists(profileRootDir(profileName)))) {
    throw new Error(`unknown profile: ${profileName}`);
  }
  if (profileName !== nextProfileName && (await pathExists(profileRootDir(nextProfileName)))) {
    throw new Error(`profile already exists: ${nextProfileName}`);
  }
  if (profileName === nextProfileName) {
    const activeProfile = await readActiveProfileName();
    return {
      renamedFrom: profileName,
      renamedTo: nextProfileName,
      activeProfile,
      rootDir: profileRootDir(nextProfileName),
      droneDataDir: profileDroneRootDir(nextProfileName),
      dvmDataDir: profileDvmRootDir(nextProfileName),
    };
  }

  const sourceRootDir = profileRootDir(profileName);
  const sourceDroneRootDir = profileDroneRootDir(profileName);
  await moveTreeRequired(sourceRootDir, profileRootDir(nextProfileName));
  const activeProfile = await readActiveProfileName();
  if (activeProfile === profileName) {
    await writeActiveProfileName(nextProfileName);
    resetActiveProfileCaches();
    if (opts?.syncRunningHubState) {
      await syncRunningHubStateForProfile(nextProfileName, {
        ...opts.syncRunningHubState,
        previousRootDir: opts.syncRunningHubState.previousRootDir ?? sourceDroneRootDir,
      });
    }
  }
  return {
    renamedFrom: profileName,
    renamedTo: nextProfileName,
    activeProfile: activeProfile === profileName ? nextProfileName : activeProfile,
    rootDir: profileRootDir(nextProfileName),
    droneDataDir: profileDroneRootDir(nextProfileName),
    dvmDataDir: profileDvmRootDir(nextProfileName),
  };
}
