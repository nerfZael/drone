import {
  managedDroneStateFingerprint,
  type ManagedDroneDesiredState,
} from '../managed-drone-state';
import {
  DroneApiRequestError,
  type DroneClient,
  type DroneDaemonConnection,
} from '../host/api';

type SyncOptions = { droneId: string; droneEntry: any };

type ManagedDroneStateSyncDependencies = {
  normalizeDroneIdentity: (value: unknown) => string;
  droneRuntime: (droneEntry: any) => 'container' | 'host';
  syncHostManagedFiles: (opts: SyncOptions) => Promise<void>;
  listSkills: () => Promise<any[]>;
  mcpServersForProjection: (opts: {
    runtime: 'container';
    droneId: string;
    droneEntry: any;
  }) => Promise<any[]>;
  resolveAgentsFile: (opts: SyncOptions) => Promise<{ path: string; content: string } | null>;
  buildSkillTargets: (droneEntry: any) => Array<{
    rootPath: string;
    cleanupOnly?: boolean;
    agent: any;
  }>;
  renderSkillPackages: (skills: any[], agent: any) => ManagedDroneDesiredState['skillTargets'][number]['packages'];
  buildMcpTargets: (droneEntry: any) => Array<{ configPath: string; agent: any }>;
  renderMcpProjection: (
    agent: any,
    servers: any[],
  ) => ManagedDroneDesiredState['mcpTargets'][number]['projection'];
  withDroneOpLock: <T>(key: string, run: () => Promise<T>) => Promise<T>;
  daemonClientForDrone: (droneEntry: DroneDaemonConnection) => DroneClient;
  daemonHealth: (client: DroneClient) => Promise<{ capabilities?: unknown }>;
  managedDroneSync: (client: DroneClient, payload: ManagedDroneDesiredState & { fingerprint: string }) => Promise<unknown>;
  upgradeDaemon: (opts: { containerName: string; containerPort: number }) => Promise<void>;
  waitForDaemonReady: (client: DroneClient) => Promise<void>;
};

const REQUIRED_CAPABILITY = 'managed-state-v1';

function daemonCapabilityCacheKey(droneId: string, droneEntry: any): string {
  return [
    droneId,
    String(droneEntry?.containerName ?? droneEntry?.name ?? ''),
    Number(droneEntry?.hostPort ?? 0),
  ].join(':');
}

export function createManagedDroneStateSyncService(deps: ManagedDroneStateSyncDependencies) {
  const capableDaemons = new Set<string>();

  async function ensureCapability(
    droneId: string,
    droneEntry: any,
    client: DroneClient,
    forceProbe = false,
  ): Promise<void> {
    const cacheKey = daemonCapabilityCacheKey(droneId, droneEntry);
    if (!forceProbe && capableDaemons.has(cacheKey)) return;

    const health = await deps.daemonHealth(client);
    const capabilities = Array.isArray(health?.capabilities) ? health.capabilities : [];
    if (capabilities.includes(REQUIRED_CAPABILITY)) {
      capableDaemons.add(cacheKey);
      return;
    }

    const containerName = String(droneEntry?.containerName ?? droneEntry?.name ?? '').trim();
    const containerPort = Number(droneEntry?.containerPort ?? NaN);
    if (!containerName || !Number.isFinite(containerPort) || containerPort <= 0) {
      throw new Error(`drone daemon does not support ${REQUIRED_CAPABILITY}`);
    }
    await deps.upgradeDaemon({ containerName, containerPort: Math.floor(containerPort) });
    await deps.waitForDaemonReady(client);
    const upgradedHealth = await deps.daemonHealth(client);
    const upgradedCapabilities = Array.isArray(upgradedHealth?.capabilities)
      ? upgradedHealth.capabilities
      : [];
    if (!upgradedCapabilities.includes(REQUIRED_CAPABILITY)) {
      throw new Error(`upgraded drone daemon does not support ${REQUIRED_CAPABILITY}`);
    }
    capableDaemons.add(cacheKey);
  }

  async function syncManagedFilesForDrone(opts: SyncOptions): Promise<void> {
    const droneId = deps.normalizeDroneIdentity(opts.droneId);
    const droneEntry = opts.droneEntry;
    if (!droneId || !droneEntry) return;
    if (deps.droneRuntime(droneEntry) === 'host') {
      await deps.withDroneOpLock(`drone:${droneId}`, async () => {
        await deps.syncHostManagedFiles({ droneId, droneEntry });
      });
      return;
    }

    await deps.withDroneOpLock(`drone:${droneId}`, async () => {
      const [skills, servers, agentsFile] = await Promise.all([
        deps.listSkills(),
        deps.mcpServersForProjection({ runtime: 'container', droneId, droneEntry }),
        deps.resolveAgentsFile({ droneId, droneEntry }),
      ]);
      const desiredState: ManagedDroneDesiredState = {
        version: 1,
        skillTargets: deps.buildSkillTargets(droneEntry).map((target) => ({
          rootPath: target.rootPath,
          ...(target.cleanupOnly ? { cleanupOnly: true } : {}),
          packages: target.cleanupOnly ? [] : deps.renderSkillPackages(skills, target.agent),
        })),
        mcpTargets: deps.buildMcpTargets(droneEntry).map((target) => ({
          configPath: target.configPath,
          projection: deps.renderMcpProjection(target.agent, servers),
        })),
        ...(agentsFile ? { agentsFile } : {}),
      };
      const payload = {
        ...desiredState,
        fingerprint: managedDroneStateFingerprint(desiredState),
      };
      const client = deps.daemonClientForDrone(droneEntry);
      await ensureCapability(droneId, droneEntry, client);
      try {
        await deps.managedDroneSync(client, payload);
      } catch (error) {
        if (!(error instanceof DroneApiRequestError) || error.statusCode !== 404) throw error;
        capableDaemons.delete(daemonCapabilityCacheKey(droneId, droneEntry));
        await ensureCapability(droneId, droneEntry, client, true);
        await deps.managedDroneSync(client, payload);
      }
    });
  }

  return { syncManagedFilesForDrone };
}
