import { ManagedLoop } from '../background/managed-loop';

type CachedDroneStatusSummary = {
  hostPort: number | null;
  statusOk: boolean;
  status: any;
  statusError: string | null;
  statusChecking?: boolean;
};

type DroneStatusRuntimeDependencies = {
  loadModel: () => Promise<any>;
  log: (level: 'warn', message: string, meta: Record<string, unknown>) => void;
  makeClient: (hostPort: number, token: string) => any;
  normalizeDroneId: (value: unknown) => string;
  normalizeRuntime: (value: unknown) => string;
  onChanged: (source: string) => void;
  onTiming?: (timing: DroneStatusRefreshTiming) => void;
  readStatus: (client: any) => Promise<any>;
  resolveHostPort: (containerName: string, containerPort: number) => Promise<number | null>;
};

export type DroneStatusRefreshTiming = {
  source: string;
  droneCount: number;
  changedCount: number;
  totalMs: number;
  phases: Array<{
    name: 'loadModel' | 'probeStatuses' | 'resolvePorts' | 'readStatuses' | 'notify';
    durationMs: number;
    operationCount?: number;
  }>;
};

type DroneStatusProbeTiming = {
  portLookupMs: number;
  portLookupCount: number;
  statusReadMs: number;
  statusReadCount: number;
};

const STATUS_REFRESH_CONCURRENCY = 4;
const STATUS_REFRESH_INTERVAL_MS = 15_000;
const STATUS_CACHE_MAX_ENTRIES = 500;

export function createDroneStatusRuntime(deps: DroneStatusRuntimeDependencies) {
  const cache = new Map<string, CachedDroneStatusSummary>();
  let loop: ManagedLoop | null = null;
  let refreshSource = 'interval';

  function cachedForEntry(drone: any): CachedDroneStatusSummary {
    pruneCache();
    return cache.get(cacheKey(drone)) ?? checkingSummary(drone);
  }

  function schedule(source: string, delayMs = 0): void {
    refreshSource = source;
    loop?.wake(delayMs);
  }

  function start(): void {
    if (loop) return;
    refreshSource = 'startup';
    loop = new ManagedLoop({
      intervalMs: STATUS_REFRESH_INTERVAL_MS,
      run: async () => {
        const source = refreshSource;
        refreshSource = 'interval';
        await refresh(source);
      },
    });
    loop.start();
  }

  async function stop(): Promise<void> {
    const activeLoop = loop;
    loop = null;
    await activeLoop?.stop();
  }

  async function refresh(source: string): Promise<void> {
    const startedAt = performance.now();
    const phases: DroneStatusRefreshTiming['phases'] = [];
    let droneCount = 0;
    let changedCount = 0;
    try {
      let phaseStartedAt = performance.now();
      const model = await deps.loadModel();
      phases.push({ name: 'loadModel', durationMs: performance.now() - phaseStartedAt });
      const drones = Object.values(model?.drones ?? {}) as any[];
      droneCount = drones.length;
      phaseStartedAt = performance.now();
      const probeTiming: DroneStatusProbeTiming = {
        portLookupMs: 0,
        portLookupCount: 0,
        statusReadMs: 0,
        statusReadCount: 0,
      };
      const changed = await mapConcurrent(drones, STATUS_REFRESH_CONCURRENCY, async (drone) =>
        refreshEntry(drone, probeTiming),
      );
      phases.push({ name: 'probeStatuses', durationMs: performance.now() - phaseStartedAt });
      phases.push({
        name: 'resolvePorts',
        durationMs: probeTiming.portLookupMs,
        operationCount: probeTiming.portLookupCount,
      });
      phases.push({
        name: 'readStatuses',
        durationMs: probeTiming.statusReadMs,
        operationCount: probeTiming.statusReadCount,
      });
      changedCount = changed.filter(Boolean).length;
      phaseStartedAt = performance.now();
      if (changedCount > 0) deps.onChanged(source);
      phases.push({ name: 'notify', durationMs: performance.now() - phaseStartedAt });
    } catch (error: any) {
      deps.log('warn', 'drone status refresh failed', {
        source,
        error: error?.message ?? String(error),
      });
    } finally {
      try {
        deps.onTiming?.({
          source,
          droneCount,
          changedCount,
          totalMs: performance.now() - startedAt,
          phases,
        });
      } catch {
        // Diagnostics must not change refresh behavior.
      }
    }
  }

  async function refreshEntry(drone: any, timing: DroneStatusProbeTiming): Promise<boolean> {
    const key = cacheKey(drone);
    const previous = cache.get(key);
    let next: CachedDroneStatusSummary;
    try {
      next = await probe(drone, timing);
    } catch (error: any) {
      next = {
        hostPort:
          typeof drone?.hostPort === 'number' && Number.isFinite(drone.hostPort)
            ? drone.hostPort
            : null,
        statusOk: false,
        status: null,
        statusError: error?.message ?? String(error),
      };
    }
    cache.set(key, next);
    pruneCache();
    return !sameSummary(previous, next);
  }

  async function probe(
    drone: any,
    timing: DroneStatusProbeTiming,
  ): Promise<CachedDroneStatusSummary> {
    const runtime = deps.normalizeRuntime(drone?.runtime);
    const containerName = String(drone?.containerName ?? drone?.name ?? '').trim();
    let hostPort: number | null;
    if (typeof drone.hostPort === 'number' && Number.isFinite(drone.hostPort)) {
      hostPort = drone.hostPort;
    } else if (runtime === 'host') {
      hostPort = null;
    } else {
      const portLookupStartedAt = performance.now();
      try {
        hostPort = await deps.resolveHostPort(
          containerName || String(drone.name ?? ''),
          drone.containerPort,
        );
      } finally {
        timing.portLookupMs += performance.now() - portLookupStartedAt;
        timing.portLookupCount += 1;
      }
    }

    let statusOk = false;
    let status: any = null;
    let statusError: string | null = null;
    const token = typeof drone.token === 'string' ? drone.token : '';
    if (hostPort && token) {
      const statusReadStartedAt = performance.now();
      try {
        status = await deps.readStatus(deps.makeClient(hostPort, token));
        statusOk = true;
      } catch (error: any) {
        statusError = error?.message ?? String(error);
      } finally {
        timing.statusReadMs += performance.now() - statusReadStartedAt;
        timing.statusReadCount += 1;
      }
    } else if (!hostPort) {
      statusError =
        runtime === 'host'
          ? 'no host port mapped'
          : 'no host port mapped (container likely stopped)';
    } else {
      statusError = 'missing token (still starting?)';
    }

    return { hostPort: hostPort ?? null, statusOk, status, statusError };
  }

  function cacheKey(drone: any): string {
    const runtime = deps.normalizeRuntime(drone?.runtime);
    const droneId = deps.normalizeDroneId(drone?.id) || '';
    const containerName = String(drone?.containerName ?? drone?.name ?? '').trim();
    const hostPort =
      typeof drone?.hostPort === 'number' && Number.isFinite(drone.hostPort)
        ? String(drone.hostPort)
        : '';
    const containerPort = String(Number(drone?.containerPort ?? 7777) || 7777);
    const token = typeof drone?.token === 'string' ? drone.token : '';
    return [droneId, runtime, containerName, hostPort, containerPort, token].join('\0');
  }

  function checkingSummary(drone: any): CachedDroneStatusSummary {
    const hostPort =
      typeof drone?.hostPort === 'number' && Number.isFinite(drone.hostPort)
        ? drone.hostPort
        : null;
    return {
      hostPort,
      statusOk: false,
      status: null,
      statusError: 'checking status',
      statusChecking: true,
    };
  }

  function pruneCache(): void {
    if (cache.size <= STATUS_CACHE_MAX_ENTRIES) return;
    while (cache.size > STATUS_CACHE_MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) break;
      cache.delete(oldestKey);
    }
  }

  return { cachedForEntry, refreshNow: refresh, schedule, start, stop };
}

async function mapConcurrent<T, R>(
  items: T[],
  limitRaw: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(limitRaw || 1));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function sameSummary(
  left: CachedDroneStatusSummary | undefined,
  right: CachedDroneStatusSummary,
): boolean {
  if (!left) return false;
  return (
    left.hostPort === right.hostPort &&
    left.statusOk === right.statusOk &&
    JSON.stringify(left.status) === JSON.stringify(right.status) &&
    (left.statusError ?? '') === (right.statusError ?? '') &&
    Boolean(left.statusChecking) === Boolean(right.statusChecking)
  );
}
