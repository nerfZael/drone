import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import { health } from '../host/api';
import {
  dvmClone,
  dvmCopyToContainer,
  dvmCreate,
  dvmExec,
  dvmPorts,
  dvmRemove,
  dvmSessionStart,
} from '../host/dvm';
import { loadRegistry, registryHasDisplayName, updateRegistry } from '../host/registry';
import {
  buildContainerDroneDaemonLaunchScript,
  DRONE_DAEMON_SESSION_NAME,
  hostDroneDaemonDataPath,
  hostDroneDaemonTokenPath,
  hostDroneRootPath,
  hostDroneWorkspacePath,
  installBlipCliScript,
  missingHostDependencyMessage,
  removeRetiredContainerCliScripts,
  type DroneRuntime,
} from '../host/runtime';
import {
  assertDroneDaemonRuntimeReady,
  launchHostDroneDaemon,
  assertContainerDroneRuntimePayloadReady,
  resolveDroneDaemonJsPath,
  resolveDroneDaemonRuntimeDir,
  resolveContainerDroneRuntimePayloadDir,
} from './drone-daemon-runtime';
import { ensureCanonicalGroup } from './groups-repositories';
import { upsertCanonicalDroneLifecycle } from './drone-lifecycle-service';

export type CreateDroneRuntimeInput = {
  name: string;
  runtime: DroneRuntime;
  repoPath: string;
  group?: string;
  containerPort: number;
  cwd?: string;
  mkdir?: boolean;
  droneId?: string;
  cloneContainer?: string;
  persistVolume?: boolean;
  onPhaseTiming?: (phase: string, durationMs: number) => void;
};

export type ImportContainerDroneRuntimeInput = Omit<
  CreateDroneRuntimeInput,
  'runtime' | 'cloneContainer'
> & {
  containerName?: string;
};

export type CreatedDroneRuntime = {
  ok: true;
  id: string;
  runtime: DroneRuntime;
  name: string;
  containerName: string;
  hostPort: number;
  containerPort: number;
  daemonPid?: number;
  cwd?: string;
};

export class DroneRuntimeContainerExistsError extends Error {
  readonly code = 'DRONE_RUNTIME_CONTAINER_EXISTS';
  readonly containerName: string;

  constructor(containerName: string, cause: unknown) {
    const detail = String((cause as any)?.message ?? cause ?? '').trim();
    super(detail || `Container ${containerName} already exists`);
    this.name = 'DroneRuntimeContainerExistsError';
    this.containerName = containerName;
  }
}

export type DroneRuntimeCreationDeps = {
  assertRuntimeReady: (runtimeDir: string) => Promise<void>;
  assertContainerRuntimeReady: (runtimeDir: string) => Promise<void>;
  allocateHostPort: () => Promise<number>;
  allocateHostPorts: (count: number) => Promise<number[]>;
  copyToContainer: typeof dvmCopyToContainer;
  createContainer: typeof dvmCreate;
  cloneContainer: typeof dvmClone;
  execContainer: typeof dvmExec;
  getContainerPorts: typeof dvmPorts;
  hostCommandExists: (command: string) => Promise<boolean>;
  launchHostDaemon: typeof launchHostDroneDaemon;
  loadRegistry: typeof loadRegistry;
  persistRealDroneEntry: (droneId: string, entry: any) => Promise<void>;
  removeContainer: typeof dvmRemove;
  sessionStart: typeof dvmSessionStart;
  stopHostDaemon: (pid: number) => Promise<void>;
  ensureGroup: typeof ensureCanonicalGroup;
  waitForHealth: (hostPort: number, token: string, timeoutMs?: number) => Promise<void>;
};

const defaultDeps: DroneRuntimeCreationDeps = {
  assertRuntimeReady: assertDroneDaemonRuntimeReady,
  assertContainerRuntimeReady: assertContainerDroneRuntimePayloadReady,
  allocateHostPort: getFreeTcpPort,
  allocateHostPorts: getUniqueFreeTcpPorts,
  copyToContainer: dvmCopyToContainer,
  createContainer: dvmCreate,
  cloneContainer: dvmClone,
  execContainer: dvmExec,
  getContainerPorts: dvmPorts,
  hostCommandExists,
  launchHostDaemon: launchHostDroneDaemon,
  loadRegistry,
  persistRealDroneEntry: async (droneId, entry) => {
    const canonical = await upsertCanonicalDroneLifecycle('real', droneId, entry);
    if (canonical) return;
    // Bun/native-binding compatibility only. Production Node must commit the
    // lifecycle row before any legacy projection exists.
    await updateRegistry((registry: any) => {
      registry.drones = registry.drones ?? {};
      registry.drones[droneId] = entry;
    });
  },
  removeContainer: dvmRemove,
  sessionStart: dvmSessionStart,
  stopHostDaemon: stopHostDaemonByPid,
  ensureGroup: ensureCanonicalGroup,
  waitForHealth,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function measureRuntimePhase<T>(
  input: Pick<CreateDroneRuntimeInput, 'onPhaseTiming'>,
  phase: string,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await run();
  } finally {
    try {
      input.onPhaseTiming?.(phase, performance.now() - startedAt);
    } catch {
      // Observability must never change runtime creation behavior.
    }
  }
}

function shellQuote(raw: string): string {
  return `'${String(raw).replace(/'/g, `'\\''`)}'`;
}

function normalizeDisplayName(raw: unknown): string {
  const name = String(raw ?? '').trim();
  if (!name) throw new Error('missing drone name');
  if (name.length > 80) throw new Error('invalid drone name (max 80 chars)');
  if (/[\r\n]/.test(name)) throw new Error('invalid drone name (no newlines)');
  return name;
}

function stableContainerNameFromDroneId(droneId: string): string {
  const id = String(droneId ?? '').trim();
  if (!id) throw new Error('missing drone id for container name');
  const uuid = id.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  if (uuid) return `drone-${uuid.toLowerCase()}`;
  const hex = crypto.createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 32);
  return `drone-${hex}`;
}

async function getFreeTcpPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('failed to allocate port');
  return address.port;
}

async function getUniqueFreeTcpPorts(count: number): Promise<number[]> {
  const ports: number[] = [];
  const seen = new Set<number>();
  const maxAttempts = Math.max(20, count * 12);
  for (let attempt = 0; attempt < maxAttempts && ports.length < count; attempt += 1) {
    const port = await getFreeTcpPort();
    if (seen.has(port)) continue;
    seen.add(port);
    ports.push(port);
  }
  if (ports.length !== count) throw new Error(`failed to allocate ${count} unique host ports`);
  return ports;
}

function isPortAllocationConflictError(error: unknown): boolean {
  const message = String((error as any)?.message ?? error ?? '').toLowerCase();
  return (
    message.includes('port is already allocated') ||
    message.includes('address already in use') ||
    (message.includes('bind for') && message.includes('failed')) ||
    (message.includes('failed to set up container networking') && message.includes('bind'))
  );
}

function isContainerAlreadyExistsError(error: unknown): boolean {
  return String((error as any)?.message ?? error ?? '')
    .toLowerCase()
    .includes('already exists');
}

async function resolveHostPort(
  deps: DroneRuntimeCreationDeps,
  containerName: string,
  containerPort: number,
): Promise<number> {
  const ports = await deps.getContainerPorts(containerName);
  const match = ports.find((port) => port.containerPort === containerPort);
  if (!match) {
    throw new Error(
      `No host port mapped for ${containerName}:${containerPort} (run: dvm ports ${containerName})`,
    );
  }
  return match.hostPort;
}

async function waitForHealth(hostPort: number, token: string, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();
  while (true) {
    try {
      await health({ baseUrl: `http://127.0.0.1:${hostPort}`, token });
      return;
    } catch {
      if (Date.now() - startedAt > timeoutMs)
        throw new Error('Timed out waiting for daemon health');
      await sleep(300);
    }
  }
}

async function hostCommandExists(command: string): Promise<boolean> {
  const name = String(command ?? '').trim();
  if (!name) return false;
  return await new Promise<boolean>((resolve) => {
    const child = spawn('bash', ['-lc', `command -v ${shellQuote(name)} >/dev/null 2>&1`], {
      stdio: 'ignore',
    });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

async function stopHostDaemonByPid(pidRaw: unknown): Promise<void> {
  const pid = Math.floor(Number(pidRaw));
  if (!Number.isFinite(pid) || pid <= 0) return;
  const isRunning = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (!isRunning()) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isRunning()) return;
    await sleep(100);
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Best-effort cleanup.
  }
}

async function ensureContainerCwd(
  deps: DroneRuntimeCreationDeps,
  containerName: string,
  cwd: string | undefined,
  mkdir: boolean,
): Promise<void> {
  if (!cwd) return;
  const missingCwdMessage = `cwd does not exist: ${cwd} (pass --mkdir to create)`;
  const command = mkdir
    ? `mkdir -p ${shellQuote(cwd)}`
    : `test -d ${shellQuote(cwd)} || { printf '%s\\n' ${shellQuote(missingCwdMessage)} 1>&2; exit 1; }`;
  const result = await deps.execContainer(containerName, 'bash', ['-lc', command]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `failed ensuring --cwd: ${cwd}`);
  }
}

async function persistCreatedEntry(
  deps: DroneRuntimeCreationDeps,
  stableId: string,
  displayName: string,
  entry: any,
): Promise<void> {
  const registry = await deps.loadRegistry();
  if (registryHasDisplayName(registry, displayName, { excludeId: stableId })) {
    throw new Error(`drone already exists: ${displayName}`);
  }
  await deps.persistRealDroneEntry(stableId, entry);
}

async function copyMinimalDaemonRuntime(
  deps: DroneRuntimeCreationDeps,
  containerName: string,
  runtimeDir: string,
): Promise<void> {
  const clear = await deps.execContainer(containerName, 'bash', [
    '-lc',
    'mkdir -p /dvm-data/drone && rm -rf /dvm-data/drone/dist && mkdir -p /dvm-data/drone/dist',
  ]);
  if (clear.code !== 0) {
    throw new Error(clear.stderr || clear.stdout || 'failed clearing daemon runtime in container');
  }
  await deps.copyToContainer(
    containerName,
    resolveContainerDroneRuntimePayloadDir(runtimeDir),
    '/dvm-data/drone/dist',
    { clean: false },
  );
}

export async function createDroneRuntime(
  input: CreateDroneRuntimeInput,
  overrides: Partial<DroneRuntimeCreationDeps> = {},
): Promise<CreatedDroneRuntime> {
  const deps = { ...defaultDeps, ...overrides };
  const displayName = normalizeDisplayName(input.name);
  const stableId = String(input.droneId ?? '').trim() || crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const runtimeDir = resolveDroneDaemonRuntimeDir();
  await measureRuntimePhase(input, 'validateArtifacts', async () => {
    await deps.assertRuntimeReady(runtimeDir);
    if (input.runtime === 'container') await deps.assertContainerRuntimeReady(runtimeDir);
  });

  if (input.runtime === 'host') {
    if (input.cloneContainer) {
      throw new Error('--clone-container is only supported for container runtime');
    }
    if (!(await deps.hostCommandExists('tmux'))) {
      throw new Error(missingHostDependencyMessage('tmux', 'host runtime drones'));
    }
    const hostPort = await measureRuntimePhase(input, 'allocatePorts', deps.allocateHostPort);
    const hostPid = await measureRuntimePhase(input, 'launchHostDaemon', async () =>
      deps.launchHostDaemon({
        droneId: stableId,
        hostPort,
        token,
        daemonPath: resolveDroneDaemonJsPath(),
      }),
    );
    try {
      const workspaceDir = hostDroneWorkspacePath(stableId);
      const effectiveCwd = input.cwd || input.repoPath || workspaceDir;
      await measureRuntimePhase(input, 'ensureCwd', async () => {
        if (!input.repoPath) await fs.mkdir(workspaceDir, { recursive: true });
        if (effectiveCwd) {
          if (input.mkdir) {
            await fs.mkdir(effectiveCwd, { recursive: true });
          } else {
            const stat = await fs.stat(effectiveCwd).catch(() => null);
            if (!stat?.isDirectory()) {
              throw new Error(`cwd does not exist: ${effectiveCwd} (pass --mkdir to create)`);
            }
          }
        }
      });
      await measureRuntimePhase(input, 'waitForDaemon', async () =>
        deps.waitForHealth(hostPort, token),
      );
      const canonicalGroup = await measureRuntimePhase(input, 'ensureGroup', async () =>
        input.group ? deps.ensureGroup(input.group, input.repoPath) : Promise.resolve(null),
      );
      const containerName = stableContainerNameFromDroneId(stableId);
      const createdAt = new Date().toISOString();
      await measureRuntimePhase(input, 'persistLifecycle', async () =>
        persistCreatedEntry(deps, stableId, displayName, {
          id: stableId,
          runtime: 'host',
          name: displayName,
          containerName,
          group: input.group,
          groupId: canonicalGroup?.id,
          cwd: effectiveCwd,
          hostPort,
          containerPort: hostPort,
          token,
          repoPath: input.repoPath,
          ...(input.repoPath ? { repo: { dest: input.repoPath } } : {}),
          createdAt,
          host: {
            pid: hostPid,
            workspaceDir,
            rootDir: hostDroneRootPath(stableId),
            dataDir: hostDroneDaemonDataPath(stableId),
            tokenPath: hostDroneDaemonTokenPath(stableId),
          },
        }),
      );
      return {
        ok: true,
        id: stableId,
        runtime: 'host',
        name: displayName,
        containerName,
        hostPort,
        containerPort: hostPort,
        daemonPid: hostPid,
        ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
      };
    } catch (error) {
      await deps.stopHostDaemon(hostPid);
      throw error;
    }
  }

  const containerName = stableContainerNameFromDroneId(stableId);
  let hostPort = 0;
  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let createdThisAttempt = false;
    try {
      const [daemonPort, rdpPort, noVncPort, port3000, port3001, port5173, port5174] =
        await measureRuntimePhase(input, 'allocatePorts', async () => deps.allocateHostPorts(7));
      const ports = [
        { hostPort: daemonPort, containerPort: input.containerPort, hostIp: '127.0.0.1' },
        { hostPort: rdpPort, containerPort: 3389 },
        { hostPort: noVncPort, containerPort: 6080 },
        { hostPort: port3000, containerPort: 3000 },
        { hostPort: port3001, containerPort: 3001 },
        { hostPort: port5173, containerPort: 5173 },
        { hostPort: port5174, containerPort: 5174 },
      ];
      if (input.cloneContainer) {
        await measureRuntimePhase(input, 'cloneContainer', async () =>
          deps.cloneContainer(input.cloneContainer!, containerName, {
            start: true,
            copyPersistenceVolume: true,
            ...(typeof input.persistVolume === 'boolean'
              ? { persistVolume: input.persistVolume }
              : {}),
            ports,
          }),
        );
        createdThisAttempt = true;
      } else {
        await measureRuntimePhase(input, 'createContainer', async () =>
          deps.createContainer(containerName, {
            ...(input.persistVolume === false ? { persist: false } : {}),
            ports,
          }),
        );
        createdThisAttempt = true;
      }
      hostPort = await measureRuntimePhase(input, 'resolveHostPort', async () =>
        resolveHostPort(deps, containerName, input.containerPort),
      );
      break;
    } catch (error) {
      const portConflict = isPortAllocationConflictError(error);
      if (createdThisAttempt || portConflict) {
        try {
          await measureRuntimePhase(input, 'cleanupFailedContainer', async () =>
            deps.removeContainer(containerName),
          );
        } catch {
          // Best-effort cleanup between allocation retries.
        }
      }
      if (!portConflict) {
        if (isContainerAlreadyExistsError(error)) {
          throw new DroneRuntimeContainerExistsError(containerName, error);
        }
        throw error;
      }
      if (attempt === attempts) throw error;
      await sleep(125 * attempt);
    }
  }
  if (!hostPort) throw new Error(`failed creating ${containerName}: no daemon host port mapped`);

  try {
    await measureRuntimePhase(input, 'ensureCwd', async () =>
      ensureContainerCwd(deps, containerName, input.cwd, Boolean(input.mkdir)),
    );
    const writeToken = await measureRuntimePhase(input, 'writeToken', async () =>
      deps.execContainer(containerName, 'bash', [
        '-lc',
        `mkdir -p /dvm-data/drone && umask 077 && printf %s '${token}' > /dvm-data/drone/token`,
      ]),
    );
    if (writeToken.code !== 0) {
      throw new Error(writeToken.stderr || writeToken.stdout || 'failed writing token in container');
    }

    await measureRuntimePhase(input, 'copyDaemonRuntime', async () =>
      copyMinimalDaemonRuntime(deps, containerName, runtimeDir),
    );
    const removeRetired = await measureRuntimePhase(input, 'removeRetiredClis', async () =>
      deps.execContainer(containerName, 'bash', ['-lc', removeRetiredContainerCliScripts()]),
    );
    if (removeRetired.code !== 0) {
      throw new Error(
        removeRetired.stderr ||
          removeRetired.stdout ||
          'failed removing retired CLIs from container',
      );
    }
    const installBlip = await measureRuntimePhase(input, 'installBlipCli', async () =>
      deps.execContainer(containerName, 'bash', ['-lc', installBlipCliScript()]),
    );
    if (installBlip.code !== 0) {
      throw new Error(
        installBlip.stderr || installBlip.stdout || 'failed installing blip CLI in container',
      );
    }
    await measureRuntimePhase(input, 'startDaemon', async () =>
      deps.sessionStart(
        containerName,
        DRONE_DAEMON_SESSION_NAME,
        'bash',
        ['-lc', buildContainerDroneDaemonLaunchScript(input.containerPort)],
        true,
      ),
    );
    await measureRuntimePhase(input, 'waitForDaemon', async () =>
      deps.waitForHealth(hostPort, token),
    );
  } catch (error) {
    try {
      await measureRuntimePhase(input, 'cleanupFailedContainer', async () =>
        deps.removeContainer(containerName),
      );
    } catch {
      // Preserve the provisioning error when best-effort cleanup also fails.
    }
    throw error;
  }

  try {
    const canonicalGroup = await measureRuntimePhase(input, 'ensureGroup', async () =>
      input.group ? deps.ensureGroup(input.group, input.repoPath) : Promise.resolve(null),
    );
    await measureRuntimePhase(input, 'persistLifecycle', async () =>
      persistCreatedEntry(deps, stableId, displayName, {
        id: stableId,
        runtime: 'container',
        name: displayName,
        containerName,
        group: input.group,
        groupId: canonicalGroup?.id,
        cwd: input.cwd,
        hostPort,
        containerPort: input.containerPort,
        token,
        repoPath: input.repoPath,
        ...(input.persistVolume === false ? { persistVolume: false } : {}),
        createdAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    try {
      await measureRuntimePhase(input, 'cleanupFailedContainer', async () =>
        deps.removeContainer(containerName),
      );
    } catch {
      // Preserve the persistence error when best-effort cleanup also fails.
    }
    throw error;
  }

  return {
    ok: true,
    id: stableId,
    runtime: 'container',
    name: displayName,
    containerName,
    hostPort,
    containerPort: input.containerPort,
    ...(input.cwd ? { cwd: input.cwd } : {}),
  };
}

export async function importContainerDroneRuntime(
  input: ImportContainerDroneRuntimeInput,
  overrides: Partial<DroneRuntimeCreationDeps> = {},
): Promise<CreatedDroneRuntime> {
  const deps = { ...defaultDeps, ...overrides };
  const displayName = normalizeDisplayName(input.name);
  const registrySnapshot = await measureRuntimePhase(input, 'loadRegistry', async () =>
    deps.loadRegistry(),
  );
  const existing = Object.entries((registrySnapshot as any)?.drones ?? {}).find(
    ([key, value]) =>
      String(key) === displayName || String((value as any)?.name ?? '').trim() === displayName,
  );
  const existingId = String((existing?.[1] as any)?.id ?? existing?.[0] ?? '').trim();
  const stableId = String(input.droneId ?? '').trim() || existingId || crypto.randomUUID();
  const containerName =
    String(input.containerName ?? '').trim() || stableContainerNameFromDroneId(stableId);
  const hostPort = await measureRuntimePhase(input, 'resolveHostPort', async () =>
    resolveHostPort(deps, containerName, input.containerPort),
  );
  const tokenResult = await measureRuntimePhase(input, 'readToken', async () =>
    deps.execContainer(containerName, 'bash', [
      '-lc',
      'cat /dvm-data/drone/token 2>/dev/null || true',
    ]),
  );
  const token = String(tokenResult.stdout ?? '').trim();
  if (!token) {
    throw new Error(
      `missing token in container: ${containerName} (expected /dvm-data/drone/token)`,
    );
  }
  await measureRuntimePhase(input, 'waitForDaemon', async () =>
    deps.waitForHealth(hostPort, token),
  );
  await measureRuntimePhase(input, 'ensureCwd', async () =>
    ensureContainerCwd(deps, containerName, input.cwd, Boolean(input.mkdir)),
  );
  const canonicalGroup = await measureRuntimePhase(input, 'ensureGroup', async () =>
    input.group ? deps.ensureGroup(input.group, input.repoPath) : Promise.resolve(null),
  );
  await measureRuntimePhase(input, 'persistLifecycle', async () =>
    persistCreatedEntry(deps, stableId, displayName, {
      id: stableId,
      runtime: 'container',
      name: displayName,
      containerName,
      group: input.group,
      groupId: canonicalGroup?.id,
      cwd: input.cwd,
      hostPort,
      containerPort: input.containerPort,
      token,
      repoPath: input.repoPath,
      ...(input.persistVolume === false ? { persistVolume: false } : {}),
      createdAt: new Date().toISOString(),
    }),
  );
  return {
    ok: true,
    id: stableId,
    runtime: 'container',
    name: displayName,
    containerName,
    hostPort,
    containerPort: input.containerPort,
    ...(input.cwd ? { cwd: input.cwd } : {}),
  };
}
