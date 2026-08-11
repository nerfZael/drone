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
  readStatus: (client: any) => Promise<any>;
  resolveHostPort: (containerName: string, containerPort: number) => Promise<number | null>;
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
    try {
      const model = await deps.loadModel();
      const drones = Object.values(model?.drones ?? {}) as any[];
      const changed = await mapConcurrent(drones, STATUS_REFRESH_CONCURRENCY, async (drone) =>
        refreshEntry(drone),
      );
      if (changed.some(Boolean)) deps.onChanged(source);
    } catch (error: any) {
      deps.log('warn', 'drone status refresh failed', {
        source,
        error: error?.message ?? String(error),
      });
    }
  }

  async function refreshEntry(drone: any): Promise<boolean> {
    const key = cacheKey(drone);
    const previous = cache.get(key);
    let next: CachedDroneStatusSummary;
    try {
      next = await probe(drone);
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

  async function probe(drone: any): Promise<CachedDroneStatusSummary> {
    const runtime = deps.normalizeRuntime(drone?.runtime);
    const containerName = String(drone?.containerName ?? drone?.name ?? '').trim();
    const hostPort =
      typeof drone.hostPort === 'number' && Number.isFinite(drone.hostPort)
        ? drone.hostPort
        : runtime === 'host'
          ? null
          : await deps.resolveHostPort(
              containerName || String(drone.name ?? ''),
              drone.containerPort,
            );

    let statusOk = false;
    let status: any = null;
    let statusError: string | null = null;
    const token = typeof drone.token === 'string' ? drone.token : '';
    if (hostPort && token) {
      try {
        status = await deps.readStatus(deps.makeClient(hostPort, token));
        statusOk = true;
      } catch (error: any) {
        statusError = error?.message ?? String(error);
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

  return { cachedForEntry, schedule, start, stop };
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
    (left.statusError ?? '') === (right.statusError ?? '') &&
    Boolean(left.statusChecking) === Boolean(right.statusChecking)
  );
}
