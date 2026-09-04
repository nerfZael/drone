export type HubProcessMemorySnapshot = {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
};

type HubMemoryLog = (
  level: 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, unknown>,
) => void;

export function captureHubProcessMemory(): HubProcessMemorySnapshot {
  const memory = process.memoryUsage();
  return {
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
  };
}

export function hubMemoryDiagnosticsEnabled(raw = process.env.DRONE_HUB_MEMORY_DIAGNOSTICS): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(raw ?? '').trim().toLowerCase());
}

export function startHubMemoryDiagnostics(opts: {
  log: HubMemoryLog;
  intervalMs?: number;
}): (() => void) | null {
  if (!hubMemoryDiagnosticsEnabled()) return null;
  const intervalMs = Math.max(10_000, Math.floor(opts.intervalMs ?? 60_000));
  const logSnapshot = (source: 'startup' | 'interval') => {
    opts.log('info', 'hub process memory', {
      source,
      uptimeSeconds: Math.round(process.uptime() * 10) / 10,
      memory: captureHubProcessMemory(),
    });
  };
  logSnapshot('startup');
  const interval = setInterval(() => logSnapshot('interval'), intervalMs);
  interval.unref?.();
  return () => clearInterval(interval);
}
