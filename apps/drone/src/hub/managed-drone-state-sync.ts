import {
  managedDroneStateFingerprint,
  type ManagedDroneDesiredState,
} from '../managed-drone-state';
import { DroneApiRequestError, type DroneClient, type DroneDaemonConnection } from '../host/api';
import { CODEX_ROOT_THREAD_RECOVERY_CAPABILITY } from '../daemon-capabilities';

type SyncOptions = { droneId: string; droneEntry: any };

export type ManagedDroneStateSyncTiming = {
  droneId: string;
  runtime: 'container' | 'host';
  containerName: string | null;
  outcome: 'completed' | 'failed';
  durationMs: number;
  daemonApplyDurationMs: number | null;
  daemonPhases: Record<string, number> | null;
  phases: Record<string, number>;
};

export type ManagedDroneStateSyncResult = {
  fingerprint: string | null;
  changed: boolean | null;
  agentsFileApplied: boolean;
};

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
  renderSkillPackages: (
    skills: any[],
    agent: any,
  ) => ManagedDroneDesiredState['skillTargets'][number]['packages'];
  buildMcpTargets: (droneEntry: any) => Array<{ configPath: string; agent: any }>;
  renderMcpProjection: (
    agent: any,
    servers: any[],
  ) => ManagedDroneDesiredState['mcpTargets'][number]['projection'];
  withDroneOpLock: <T>(key: string, run: () => Promise<T>) => Promise<T>;
  daemonClientForDrone: (droneEntry: DroneDaemonConnection) => DroneClient;
  daemonHealth: (client: DroneClient) => Promise<{ capabilities?: unknown }>;
  managedDroneSync: (
    client: DroneClient,
    payload: ManagedDroneDesiredState & { fingerprint: string },
  ) => Promise<unknown>;
  upgradeDaemon: (opts: { containerName: string; containerPort: number }) => Promise<void>;
  waitForDaemonReady: (client: DroneClient) => Promise<void>;
  onTiming?: (timing: ManagedDroneStateSyncTiming) => void;
};

const REQUIRED_CAPABILITY = CODEX_ROOT_THREAD_RECOVERY_CAPABILITY;

export function createManagedDroneStateSyncService(deps: ManagedDroneStateSyncDependencies) {
  async function ensureCapability(
    droneEntry: any,
    client: DroneClient,
    measure: <T>(name: string, run: () => Promise<T>) => Promise<T>,
  ): Promise<void> {
    const health = await measure(
      'probeDaemonCapability',
      async () => await deps.daemonHealth(client),
    );
    const capabilities = Array.isArray(health?.capabilities) ? health.capabilities : [];
    if (capabilities.includes(REQUIRED_CAPABILITY)) return;

    const containerName = String(droneEntry?.containerName ?? droneEntry?.name ?? '').trim();
    const containerPort = Number(droneEntry?.containerPort ?? NaN);
    if (!containerName || !Number.isFinite(containerPort) || containerPort <= 0) {
      throw new Error(`drone daemon does not support ${REQUIRED_CAPABILITY}`);
    }
    await measure(
      'upgradeDaemon',
      async () =>
        await deps.upgradeDaemon({ containerName, containerPort: Math.floor(containerPort) }),
    );
    await measure('waitForUpgradedDaemon', async () => await deps.waitForDaemonReady(client));
    const upgradedHealth = await measure(
      'verifyUpgradedDaemonCapability',
      async () => await deps.daemonHealth(client),
    );
    const upgradedCapabilities = Array.isArray(upgradedHealth?.capabilities)
      ? upgradedHealth.capabilities
      : [];
    if (!upgradedCapabilities.includes(REQUIRED_CAPABILITY)) {
      throw new Error(`upgraded drone daemon does not support ${REQUIRED_CAPABILITY}`);
    }
  }

  async function syncManagedFilesForDrone(opts: SyncOptions): Promise<ManagedDroneStateSyncResult> {
    const droneId = deps.normalizeDroneIdentity(opts.droneId);
    const droneEntry = opts.droneEntry;
    if (!droneId || !droneEntry) {
      return { fingerprint: null, changed: null, agentsFileApplied: false };
    }
    const runtime = deps.droneRuntime(droneEntry);
    const containerName =
      runtime === 'container'
        ? String(droneEntry?.containerName ?? droneEntry?.name ?? '').trim() || null
        : null;
    const startedAt = performance.now();
    const phases = new Map<string, number>();
    let outcome: ManagedDroneStateSyncTiming['outcome'] = 'failed';
    let daemonApplyDurationMs: number | null = null;
    let daemonPhases: Record<string, number> | null = null;
    let appliedFingerprint: string | null = null;
    let appliedChanged: boolean | null = null;
    let agentsFileApplied = false;
    const record = (name: string, durationMs: number) => {
      if (!Number.isFinite(durationMs)) return;
      const rounded = Math.max(0, Math.round(durationMs * 10) / 10);
      phases.set(name, Math.round(((phases.get(name) ?? 0) + rounded) * 10) / 10);
    };
    const measure = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
      const phaseStartedAt = performance.now();
      try {
        return await run();
      } finally {
        record(name, performance.now() - phaseStartedAt);
      }
    };
    const lockRequestedAt = performance.now();

    try {
      await deps.withDroneOpLock(`drone:${droneId}`, async () => {
        record('droneLockWait', performance.now() - lockRequestedAt);
        if (runtime === 'host') {
          await measure(
            'syncHostManagedFiles',
            async () => await deps.syncHostManagedFiles({ droneId, droneEntry }),
          );
          return;
        }

        const [skills, servers, agentsFile] = await measure(
          'loadProjectionInputs',
          async () =>
            await Promise.all([
              deps.listSkills(),
              deps.mcpServersForProjection({ runtime: 'container', droneId, droneEntry }),
              deps.resolveAgentsFile({ droneId, droneEntry }),
            ]),
        );
        const payloadStartedAt = performance.now();
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
        agentsFileApplied = Boolean(agentsFile);
        record('buildPayload', performance.now() - payloadStartedAt);
        const clientStartedAt = performance.now();
        const client = deps.daemonClientForDrone(droneEntry);
        record('resolveDaemonClient', performance.now() - clientStartedAt);
        try {
          let response = await measure(
            'applyManagedStateRequest',
            async () => await deps.managedDroneSync(client, payload),
          );
          const responseCapabilities = Array.isArray((response as any)?.capabilities)
            ? (response as any).capabilities
            : [];
          if (
            runtime === 'container' &&
            !responseCapabilities.includes(REQUIRED_CAPABILITY)
          ) {
            await ensureCapability(droneEntry, client, measure);
            response = await measure(
              'retryManagedStateAfterDaemonUpgrade',
              async () => await deps.managedDroneSync(client, payload),
            );
          }
          appliedFingerprint =
            String((response as any)?.fingerprint ?? '').trim() || payload.fingerprint;
          appliedChanged =
            typeof (response as any)?.changed === 'boolean' ? (response as any).changed : null;
          const reportedDuration = Number((response as any)?.durationMs);
          if (Number.isFinite(reportedDuration) && reportedDuration >= 0) {
            daemonApplyDurationMs = Math.round(reportedDuration * 10) / 10;
          }
          if (
            (response as any)?.phases &&
            typeof (response as any).phases === 'object' &&
            !Array.isArray((response as any).phases)
          ) {
            daemonPhases = { ...(response as any).phases };
          }
        } catch (error) {
          if (!(error instanceof DroneApiRequestError) || error.statusCode !== 404) throw error;
          // The managed-state request is itself the cheapest and most authoritative capability
          // probe. Only pay for a separate health request and daemon upgrade when an older daemon
          // actually reports that the endpoint is missing.
          await ensureCapability(droneEntry, client, measure);
          const response = await measure(
            'retryManagedStateRequest',
            async () => await deps.managedDroneSync(client, payload),
          );
          appliedFingerprint =
            String((response as any)?.fingerprint ?? '').trim() || payload.fingerprint;
          appliedChanged =
            typeof (response as any)?.changed === 'boolean' ? (response as any).changed : null;
          const reportedDuration = Number((response as any)?.durationMs);
          if (Number.isFinite(reportedDuration) && reportedDuration >= 0) {
            daemonApplyDurationMs = Math.round(reportedDuration * 10) / 10;
          }
          if (
            (response as any)?.phases &&
            typeof (response as any).phases === 'object' &&
            !Array.isArray((response as any).phases)
          ) {
            daemonPhases = { ...(response as any).phases };
          }
        }
      });
      outcome = 'completed';
      return {
        fingerprint: appliedFingerprint,
        changed: appliedChanged,
        agentsFileApplied,
      };
    } finally {
      try {
        deps.onTiming?.({
          droneId,
          runtime,
          containerName,
          outcome,
          durationMs: Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10),
          daemonApplyDurationMs,
          daemonPhases,
          phases: Object.fromEntries(phases),
        });
      } catch {
        // Timing observers must not affect synchronization.
      }
    }
  }

  return { syncManagedFilesForDrone };
}
