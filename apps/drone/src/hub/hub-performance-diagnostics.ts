import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { performance, PerformanceObserver } from 'node:perf_hooks';

type Log = (level: 'info' | 'warn', message: string, meta: Record<string, unknown>) => void;
const ms = (value: number) => Math.round(Math.max(0, value) * 10) / 10;
const requests = new WeakMap<IncomingMessage, { started: number; routeMs?: number }>();
const retainedResponses = new WeakSet<ServerResponse>();
export function retainHubRequestTiming(response: ServerResponse): void {
  retainedResponses.add(response);
}

export function markHubChatRouteEntry(req: IncomingMessage): void {
  const timing = requests.get(req);
  if (timing && timing.routeMs === undefined)
    timing.routeMs = ms(performance.now() - timing.started);
}

// Entry means the first JS request callback, not arrival at the kernel socket.
// A blocked event loop can delay even this callback; the independent stall monitor
// and browser Resource Timing are needed to account for that interval.
export function observeHubHttpRequest(req: IncomingMessage, res: ServerResponse, log: Log): void {
  const pathname = (req.url ?? '/').split('?')[0];
  if (!pathname.startsWith('/api/')) return;
  const started = performance.now();
  const timing = { started } as { started: number; routeMs?: number };
  requests.set(req, timing);
  const startedAt = new Date().toISOString();
  const requestId = randomUUID();
  const chatRead =
    req.method === 'GET' && /^\/api\/drones\/[^/]+\/chats\/[^/]+(?:\/[^/]+)?$/.test(pathname);
  let headersMs: number | undefined;
  let streaming = false;
  let reported = false;
  res.setHeader('x-drone-request-id', requestId);
  const writeHead = res.writeHead;
  res.writeHead = function (this: ServerResponse, ...args: any[]) {
    if (headersMs === undefined) {
      headersMs = ms(performance.now() - started);
      // Explicit writeHead headers override setHeader, so append there when present.
      const index = typeof args[1] === 'string' ? 2 : 1;
      const headers = args[index];
      const contentType = Array.isArray(headers)
        ? headers[
            headers.findIndex((v, i) => i % 2 === 0 && String(v).toLowerCase() === 'content-type') +
              1
          ]
        : headers && typeof headers === 'object'
          ? headers[Object.keys(headers).find((key) => key.toLowerCase() === 'content-type') ?? '']
          : undefined;
      streaming = String(contentType ?? res.getHeader('content-type') ?? '').includes(
        'text/event-stream',
      );
      const extra = [
        `hub_entry_to_headers;dur=${headersMs}`,
        ...(timing.routeMs === undefined ? [] : [`hub_entry_to_route;dur=${timing.routeMs}`]),
      ].join(', ');
      if (Array.isArray(headers)) {
        args[index] = [...headers];
        const found = headers.findIndex(
          (v, i) => i % 2 === 0 && String(v).toLowerCase() === 'server-timing',
        );
        if (found >= 0) args[index][found + 1] = `${headers[found + 1]}, ${extra}`;
        else
          args[index].push(
            'server-timing',
            [res.getHeader('server-timing'), extra].filter(Boolean).join(', '),
          );
      } else if (headers && typeof headers === 'object') {
        args[index] = { ...headers };
        const key = Object.keys(headers).find((key) => key.toLowerCase() === 'server-timing');
        args[index][key ?? 'server-timing'] = [
          key ? headers[key] : res.getHeader('server-timing'),
          extra,
        ]
          .filter(Boolean)
          .join(', ');
      } else {
        res.setHeader(
          'server-timing',
          [res.getHeader('server-timing'), extra].filter(Boolean).join(', '),
        );
      }
    }
    return Reflect.apply(writeHead, this, args);
  } as ServerResponse['writeHead'];
  const report = (outcome: 'finished' | 'closed') => {
    if (reported) return;
    reported = true;
    const durationMs = ms(performance.now() - started);
    // Stream lifetime isn't request latency. Always retain chat reads, including
    // fast handlers whose browser may have waited before request entry.
    if (streaming || (!chatRead && !retainedResponses.has(res) && durationMs < 250)) return;
    log(durationMs >= 250 ? 'warn' : 'info', 'hub HTTP request timing', {
      requestId,
      startedAt,
      method: req.method,
      pathname: pathname.slice(0, 512),
      status: res.statusCode,
      outcome,
      durationMs,
      ...(timing.routeMs === undefined ? {} : { entryToRouteMs: timing.routeMs }),
      ...(headersMs === undefined
        ? {}
        : { entryToHeadersMs: headersMs, headersToFinishMs: ms(durationMs - headersMs) }),
    });
  };
  res.once('finish', () => report('finished'));
  res.once('close', () => report('closed'));
}

export function startHubStallMonitor(log: Log): () => void {
  const intervalMs = 250;
  let previous = performance.now();
  let cpu = process.cpuUsage();
  let utilization = performance.eventLoopUtilization();
  let gc: Array<{ start: number; duration: number }> = [];
  let stopped = false;
  const supportedTypes = (
    PerformanceObserver as typeof PerformanceObserver & {
      supportedEntryTypes?: readonly string[];
    }
  ).supportedEntryTypes;
  let gcSupported = supportedTypes ? supportedTypes.includes('gc') : true;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      gc.push({ start: entry.startTime, duration: entry.duration });
    gc = gc
      .filter((entry) => entry.start + entry.duration >= performance.now() - 60_000)
      .slice(-128);
  });
  try {
    if (gcSupported) observer.observe({ entryTypes: ['gc'] });
  } catch {
    gcSupported = false;
  }
  const timer = setInterval(() => {
    const now = performance.now();
    const windowMs = now - previous;
    const delayMs = windowMs - intervalMs;
    const nextCpu = process.cpuUsage();
    const nextUtilization = performance.eventLoopUtilization();
    if (delayMs >= 250) {
      const start = previous;
      const cpuUserMs = (nextCpu.user - cpu.user) / 1000;
      const cpuSystemMs = (nextCpu.system - cpu.system) / 1000;
      const loop = performance.eventLoopUtilization(nextUtilization, utilization);
      // Allow the GC observer to deliver events from the stalled window first.
      const report = setImmediate(() => {
        if (stopped) return;
        const memory = process.memoryUsage();
        log('warn', 'hub event loop stall', {
          windowStartedAt: new Date(performance.timeOrigin + start).toISOString(),
          windowEndedAt: new Date(performance.timeOrigin + now).toISOString(),
          windowMs: ms(windowMs),
          delayMs: ms(delayMs),
          cpuUserMs: ms(cpuUserMs),
          cpuSystemMs: ms(cpuSystemMs),
          eventLoopUtilization: loop.utilization,
          gcSupported,
          gcOverlapMs: ms(
            gc.reduce(
              (sum, entry) =>
                sum +
                Math.max(
                  0,
                  Math.min(now, entry.start + entry.duration) - Math.max(start, entry.start),
                ),
              0,
            ),
          ),
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
        });
      });
      report.unref();
    }
    previous = now;
    cpu = nextCpu;
    utilization = nextUtilization;
  }, intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
    observer.disconnect();
    gc = [];
  };
}
