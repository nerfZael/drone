import {
  collectChatLoadResourceTiming,
  correlateResourceEntry,
  longTaskFromEntry,
  MAX_CHAT_LOAD_LONG_TASKS,
  resourceStartedDuringNavigation,
  resourceTimingFromEntry,
  startChatLoadPerformance,
  stopChatLoadPerformance,
  type ChatLoadPerformanceState,
  type ResourceTimingRecord,
} from './chat-load-performance';

export type ChatLoadSurface = 'transcript' | 'cli' | 'native' | 'unavailable';

export type ChatLoadTarget = {
  droneId: string;
  chatName: string;
};

type ChatLoadStatus = 'completed' | 'error' | 'superseded' | 'timeout';

type PrimaryResult = {
  status: 'completed' | 'error';
  cacheStatus?: 'hit' | 'miss' | 'none';
  itemCount?: number;
};

type ChatLoadRequestRecord = {
  name: string;
  requestId?: string;
  startMs: number;
  durationMs: number;
  queueMs?: number;
  fetchMs?: number;
  bodyMs?: number;
  parseMs?: number;
  status?: number;
  responseBytes?: number;
  serverTiming?: Record<string, number>;
  resourceTimingStatus: 'collected' | 'not_found' | 'unavailable';
  resourceTiming?: ResourceTimingRecord;
  transport?: 'direct_api' | 'ui_origin';
  outcome: 'completed' | 'error' | 'aborted';
};

type ChatLoadSpan = {
  id: string;
  source: 'drone' | 'chat' | 'programmatic';
  target: ChatLoadTarget;
  startedAt: string;
  startedMonoMs: number;
  milestones: Record<string, number>;
  requests: ChatLoadRequestRecord[];
  surface: ChatLoadSurface | null;
  agentKind: string | null;
  runtime: 'host' | 'container' | null;
  primaryBySurface: Partial<Record<ChatLoadSurface, PrimaryResult>>;
  committedSurfaces: Set<ChatLoadSurface>;
  cachedSurfaces: Set<ChatLoadSurface>;
  freshPrimarySurfaces: Set<ChatLoadSurface>;
  cachedPaintScheduledSurfaces: Set<ChatLoadSurface>;
  cachedConfigUsed: boolean;
  freshConfigResolved: boolean;
  freshConfigFailed: boolean;
  cacheBySurface: Partial<Record<ChatLoadSurface, { itemCount?: number }>>;
  freshPaintScheduled: boolean;
  performance: ChatLoadPerformanceState;
  timeout: ReturnType<typeof setTimeout> | null;
};

const CHAT_LOAD_TIMEOUT_MS = 30_000;
const MAX_REQUEST_RECORDS = 24;
const MAX_SERVER_TIMING_PHASES = 24;
let activeSpan: ChatLoadSpan | null = null;

function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function roundedMs(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) return undefined;
  return text;
}

function cleanTarget(target: ChatLoadTarget): ChatLoadTarget {
  return {
    droneId: String(target.droneId ?? '').trim(),
    chatName: String(target.chatName ?? '').trim() || 'default',
  };
}

function targetKey(target: ChatLoadTarget): string {
  const clean = cleanTarget(target);
  return `${clean.droneId}\u0000${clean.chatName}`;
}

function activeFor(target: ChatLoadTarget): ChatLoadSpan | null {
  const span = activeSpan;
  return span && targetKey(span.target) === targetKey(target) ? span : null;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chat-load-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function mark(span: ChatLoadSpan, name: string, at = monotonicNow()): void {
  if (Object.prototype.hasOwnProperty.call(span.milestones, name)) return;
  span.milestones[name] = roundedMs(at - span.startedMonoMs);
}

function serverTimingFromHeader(raw: string | null): Record<string, number> | undefined {
  const timing: Record<string, number> = {};
  let phaseCount = 0;
  for (const entry of String(raw ?? '').split(',')) {
    const [nameRaw, ...params] = entry.trim().split(';');
    const name = String(nameRaw ?? '').trim();
    if (
      !/^[a-zA-Z0-9_.-]{1,48}$/.test(name) ||
      ['__proto__', 'constructor', 'prototype'].includes(name)
    ) {
      continue;
    }
    const durationParam = params.find((param) => /^\s*dur=/i.test(param));
    const duration = Number(String(durationParam ?? '').replace(/^\s*dur=/i, ''));
    if (!Number.isFinite(duration) || duration < 0) continue;
    if (!Object.prototype.hasOwnProperty.call(timing, name)) {
      if (phaseCount >= MAX_SERVER_TIMING_PHASES) continue;
      phaseCount += 1;
    }
    timing[name] = roundedMs(duration);
  }
  return Object.keys(timing).length > 0 ? timing : undefined;
}

function contentTelemetry(span: ChatLoadSpan): Record<string, unknown> {
  const cache = span.surface ? span.cacheBySurface[span.surface] : undefined;
  const fresh =
    span.surface && span.freshPrimarySurfaces.has(span.surface)
      ? span.primaryBySurface[span.surface]
      : undefined;
  return {
    ...(cache
      ? {
          cached: {
            availabilityMs: span.milestones.cached_content_available,
            ...(span.milestones.cached_content_displayed !== undefined
              ? { displayMs: span.milestones.cached_content_displayed }
              : {}),
            ...(span.milestones.cached_content_painted !== undefined
              ? { paintMs: span.milestones.cached_content_painted }
              : {}),
            ...(cache.itemCount !== undefined ? { itemCount: cache.itemCount } : {}),
          },
        }
      : {}),
    ...(fresh
      ? {
          fresh: {
            status: fresh.status,
            resolutionMs: span.milestones.fresh_content_resolved,
            ...(span.milestones.fresh_content_committed !== undefined
              ? { commitMs: span.milestones.fresh_content_committed }
              : {}),
            ...(span.milestones.fresh_content_painted !== undefined
              ? { paintMs: span.milestones.fresh_content_painted }
              : {}),
            ...(fresh.itemCount !== undefined ? { itemCount: fresh.itemCount } : {}),
          },
        }
      : {}),
  };
}

function report(span: ChatLoadSpan, status: ChatLoadStatus): void {
  if (activeSpan === span) activeSpan = null;
  if (span.timeout) clearTimeout(span.timeout);
  span.timeout = null;
  const finishedAt = monotonicNow();
  stopChatLoadPerformance(span.performance, span.startedMonoMs, finishedAt, (rawUrl) => {
    const url = requestUrl(rawUrl);
    return Boolean(url && requestMatchesTarget(url, span.target));
  });
  const primary = span.surface ? span.primaryBySurface[span.surface] : undefined;
  const payload = {
    version: 2,
    navigationId: span.id,
    source: span.source,
    target: span.target,
    startedAt: span.startedAt,
    durationMs: roundedMs(finishedAt - span.startedMonoMs),
    status,
    surface: span.surface,
    agentKind: span.agentKind,
    runtime: span.runtime,
    cacheStatus: primary?.cacheStatus ?? 'none',
    itemCount: primary?.itemCount,
    milestones: span.milestones,
    requests: span.requests,
    content: contentTelemetry(span),
    capabilities: {
      resourceTiming: span.performance.resourceTimingSupported ? 'supported' : 'unavailable',
      longTasks: span.performance.longTaskStatus,
    },
    longTasks: span.performance.longTasks,
    longTaskCount: span.performance.longTaskCount,
    ...(span.performance.longTaskCount > span.performance.longTasks.length
      ? {
          longTasksDropped: span.performance.longTaskCount - span.performance.longTasks.length,
        }
      : {}),
    ...(span.performance.resourceEntriesDropped > 0
      ? { resourceEntriesDropped: span.performance.resourceEntriesDropped }
      : {}),
  };
  if (typeof fetch !== 'function') return;
  void fetch('/api/telemetry/chat-load', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}

function maybeMarkCachedContentDisplayed(span: ChatLoadSpan, surface: ChatLoadSurface): void {
  if (
    activeSpan !== span ||
    !span.cachedSurfaces.has(surface) ||
    !span.committedSurfaces.has(surface) ||
    span.freshPrimarySurfaces.has(surface) ||
    span.cachedPaintScheduledSurfaces.has(surface)
  ) {
    return;
  }
  span.cachedPaintScheduledSurfaces.add(surface);
  mark(span, 'cached_content_committed');
  mark(span, 'cached_content_displayed');
  const afterPaint = () => {
    if (activeSpan === span && !span.freshPrimarySurfaces.has(surface)) {
      mark(span, 'cached_content_painted');
    }
  };
  if (typeof requestAnimationFrame !== 'function') queueMicrotask(afterPaint);
  else requestAnimationFrame(() => requestAnimationFrame(afterPaint));
}

function maybeComplete(span: ChatLoadSpan): void {
  if (activeSpan !== span || !span.surface || span.freshPaintScheduled) return;
  const primary = span.primaryBySurface[span.surface];
  if (!primary || !span.committedSurfaces.has(span.surface)) return;
  if (span.cachedConfigUsed && !span.freshConfigResolved) return;
  if (span.cachedSurfaces.has(span.surface) && !span.freshPrimarySurfaces.has(span.surface)) {
    return;
  }
  mark(span, 'content_committed');
  span.freshPaintScheduled = true;
  const afterPaint = () => {
    if (activeSpan !== span) return;
    mark(span, 'fresh_content_painted');
    mark(span, 'content_painted');
    report(span, primary.status === 'completed' && !span.freshConfigFailed ? 'completed' : 'error');
  };
  if (typeof requestAnimationFrame !== 'function') {
    queueMicrotask(afterPaint);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(afterPaint));
}

export function beginChatLoadNavigation(input: {
  target: ChatLoadTarget;
  source: ChatLoadSpan['source'];
}): string | null {
  const target = cleanTarget(input.target);
  if (!target.droneId) return null;
  if (activeSpan) report(activeSpan, 'superseded');
  const startedMonoMs = monotonicNow();
  const span: ChatLoadSpan = {
    id: makeId(),
    source: input.source,
    target,
    startedAt: new Date().toISOString(),
    startedMonoMs,
    milestones: { click: 0 },
    requests: [],
    surface: null,
    agentKind: null,
    runtime: null,
    primaryBySurface: {},
    committedSurfaces: new Set(),
    cachedSurfaces: new Set(),
    freshPrimarySurfaces: new Set(),
    cachedPaintScheduledSurfaces: new Set(),
    cachedConfigUsed: false,
    freshConfigResolved: false,
    freshConfigFailed: false,
    cacheBySurface: {},
    freshPaintScheduled: false,
    performance: startChatLoadPerformance({
      navigationStartedMonoMs: startedMonoMs,
      isNavigationResource: (rawUrl) => {
        const url = requestUrl(rawUrl);
        return Boolean(url && requestMatchesTarget(url, target));
      },
    }),
    timeout: null,
  };
  activeSpan = span;
  span.timeout = setTimeout(() => {
    if (activeSpan !== span) return;
    mark(span, 'timed_out');
    report(span, 'timeout');
  }, CHAT_LOAD_TIMEOUT_MS);
  return span.id;
}

export function markChatLoadSelectionCommitted(target: ChatLoadTarget): void {
  const span = activeFor(target);
  if (span) mark(span, 'selection_committed');
}

export function markChatLoadCacheHit(
  target: ChatLoadTarget,
  surface: ChatLoadSurface,
  itemCount?: number,
): void {
  const span = activeFor(target);
  if (!span) return;
  span.cachedSurfaces.add(surface);
  const cachedItemCount = Number.isFinite(itemCount)
    ? Math.max(0, Math.floor(Number(itemCount)))
    : undefined;
  span.primaryBySurface[surface] = {
    status: 'completed',
    cacheStatus: 'hit',
    ...(cachedItemCount !== undefined ? { itemCount: cachedItemCount } : {}),
  };
  span.cacheBySurface[surface] = {
    ...(cachedItemCount !== undefined ? { itemCount: cachedItemCount } : {}),
  };
  mark(span, 'cached_content_available');
  maybeMarkCachedContentDisplayed(span, surface);
}

export function markChatLoadConfigResolved(
  target: ChatLoadTarget,
  input: {
    surface: ChatLoadSurface;
    agentKind?: string | null;
    runtime?: 'host' | 'container' | null;
    status?: 'completed' | 'error';
    source?: 'cache' | 'fresh';
  },
): void {
  const span = activeFor(target);
  if (!span) return;
  span.surface = input.surface;
  span.agentKind = String(input.agentKind ?? '').trim() || null;
  span.runtime = input.runtime ?? null;
  if (input.source === 'cache') {
    span.cachedConfigUsed = true;
    mark(span, 'cached_config_available');
  } else {
    span.freshConfigResolved = true;
    span.freshConfigFailed = input.status === 'error';
    mark(
      span,
      span.cachedConfigUsed
        ? input.status === 'error'
          ? 'config_reconcile_failed'
          : 'config_reconciled'
        : input.status === 'error'
          ? 'config_failed'
          : 'config_loaded',
    );
  }
  maybeMarkCachedContentDisplayed(span, input.surface);
  if (input.surface === 'unavailable') {
    span.primaryBySurface.unavailable = { status: 'error', cacheStatus: 'none' };
    if (input.source !== 'cache') {
      span.freshPrimarySurfaces.add('unavailable');
      mark(span, 'fresh_content_resolved');
    }
    mark(span, 'primary_content_failed');
  } else if (
    input.source !== 'cache' &&
    span.primaryBySurface[input.surface] &&
    span.freshPrimarySurfaces.has(input.surface)
  ) {
    mark(span, 'primary_content_loaded');
  }
  maybeComplete(span);
}

export function markChatLoadPrimaryResolved(
  target: ChatLoadTarget,
  input: {
    surface: ChatLoadSurface;
    status?: 'completed' | 'error';
    cacheStatus?: 'hit' | 'miss' | 'none';
    itemCount?: number;
  },
): void {
  const span = activeFor(target);
  if (!span) return;
  span.primaryBySurface[input.surface] = {
    status: input.status ?? 'completed',
    cacheStatus: input.cacheStatus ?? 'miss',
    ...(Number.isFinite(input.itemCount) ? { itemCount: input.itemCount } : {}),
  };
  span.freshPrimarySurfaces.add(input.surface);
  if (span.cachedSurfaces.has(input.surface)) mark(span, 'fresh_content_reconciled');
  mark(span, 'fresh_content_resolved');
  if (span.surface === input.surface) {
    mark(span, input.status === 'error' ? 'primary_content_failed' : 'primary_content_loaded');
  }
  maybeComplete(span);
}

export function markChatLoadContentCommitted(
  target: ChatLoadTarget,
  surface: ChatLoadSurface,
): void {
  const span = activeFor(target);
  if (!span) return;
  span.committedSurfaces.add(surface);
  maybeMarkCachedContentDisplayed(span, surface);
  if (span.freshPrimarySurfaces.has(surface)) {
    mark(span, 'fresh_content_committed');
  }
  maybeComplete(span);
}

function requestName(url: URL): string {
  if (/\/native$/.test(url.pathname)) return 'native_bootstrap';
  if (/\/state$/.test(url.pathname)) return 'chat_state';
  if (/\/output$/.test(url.pathname)) return 'chat_output';
  if (/\/mcp-access$/.test(url.pathname)) return 'mcp_access';
  if (/\/read$/.test(url.pathname)) return 'read_ack';
  if (/\/chats\/[^/]+$/.test(url.pathname)) return 'chat_metadata';
  return 'chat_request';
}

function requestMatchesTarget(url: URL, target: ChatLoadTarget): boolean {
  const expected = `/api/drones/${encodeURIComponent(target.droneId)}/chats/${encodeURIComponent(
    target.chatName,
  )}`;
  return url.pathname === expected || url.pathname.startsWith(`${expected}/`);
}

function requestUrl(raw: string): URL | null {
  if (typeof URL === 'undefined') return null;
  try {
    return new URL(raw, typeof location !== 'undefined' ? location.href : 'http://localhost');
  } catch {
    return null;
  }
}

function requestTransport(responseUrlRaw: string | undefined): ChatLoadRequestRecord['transport'] {
  if (!responseUrlRaw || typeof location === 'undefined') return undefined;
  try {
    return new URL(responseUrlRaw, location.href).origin === location.origin
      ? 'ui_origin'
      : 'direct_api';
  } catch {
    return undefined;
  }
}

function resourceQueueMs(timing: ResourceTimingRecord | undefined): number | undefined {
  if (typeof timing?.requestStartMs !== 'number') return undefined;
  return roundedMs(Math.max(0, timing.requestStartMs - (timing.fetchStartMs ?? 0)));
}

export type ChatLoadRequestObservation = {
  response: (response: Response) => void;
  finish: (input?: { responseBytes?: number; parseMs?: number }) => void;
  fail: (error?: unknown) => void;
};

export function observeChatLoadRequest(urlRaw: string): ChatLoadRequestObservation | null {
  const span = activeSpan;
  if (!span) return null;
  const url = requestUrl(urlRaw);
  if (!url) return null;
  if (!requestMatchesTarget(url, span.target)) return null;
  const startedAt = monotonicNow();
  let responseAt: number | null = null;
  let responseStatus: number | undefined;
  let timing: Record<string, number> | undefined;
  let responseUrl: string | undefined;
  let requestId: string | undefined;
  let finished = false;
  const complete = (
    outcome: ChatLoadRequestRecord['outcome'],
    input?: { responseBytes?: number; parseMs?: number },
  ) => {
    if (finished) return;
    finished = true;
    if (span.requests.length >= MAX_REQUEST_RECORDS) return;
    const finishedAt = monotonicNow();
    const fetchMs = responseAt == null ? undefined : roundedMs(responseAt - startedAt);
    const parseMs = Number.isFinite(input?.parseMs) ? roundedMs(Number(input?.parseMs)) : undefined;
    const bodyMs =
      responseAt == null ? undefined : roundedMs(finishedAt - responseAt - (parseMs ?? 0));
    const resource = collectChatLoadResourceTiming({
      state: span.performance,
      requestUrls: [url.href, responseUrl].filter(Boolean) as string[],
      requestStartedAt: startedAt,
      navigationStartedMonoMs: span.startedMonoMs,
      isNavigationResource: (rawUrl) => {
        const candidateUrl = requestUrl(rawUrl);
        return Boolean(candidateUrl && requestMatchesTarget(candidateUrl, span.target));
      },
    });
    const resourceTiming = resource.timing;
    const queueMs = resourceQueueMs(resourceTiming);
    const transport = requestTransport(responseUrl);
    span.requests.push({
      name: requestName(url),
      ...(requestId ? { requestId } : {}),
      startMs: roundedMs(startedAt - span.startedMonoMs),
      durationMs: roundedMs(finishedAt - startedAt),
      ...(queueMs !== undefined ? { queueMs } : {}),
      ...(fetchMs !== undefined ? { fetchMs } : {}),
      ...(bodyMs !== undefined ? { bodyMs } : {}),
      ...(parseMs !== undefined ? { parseMs } : {}),
      ...(responseStatus !== undefined ? { status: responseStatus } : {}),
      ...(Number.isFinite(input?.responseBytes)
        ? { responseBytes: Math.max(0, Math.floor(Number(input?.responseBytes))) }
        : {}),
      ...(timing ? { serverTiming: timing } : {}),
      resourceTimingStatus: resource.status,
      ...(resourceTiming ? { resourceTiming } : {}),
      ...(transport ? { transport } : {}),
      outcome,
    });
  };
  return {
    response(response) {
      responseAt = monotonicNow();
      responseStatus = response.status;
      responseUrl = boundedText(response.url, 2_048);
      requestId = boundedText(response.headers.get('x-drone-request-id'), 128);
      timing = serverTimingFromHeader(response.headers.get('server-timing'));
    },
    finish(input) {
      complete(
        responseStatus !== undefined && responseStatus >= 400 ? 'error' : 'completed',
        input,
      );
    },
    fail(error) {
      complete((error as any)?.name === 'AbortError' ? 'aborted' : 'error');
    },
  };
}

export function responseTextBytes(text: string): number {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).byteLength;
  return text.length;
}

export const chatLoadTelemetryTesting = {
  parseServerTiming: serverTimingFromHeader,
  resourceTimingFromEntry,
  correlateResourceEntry,
  longTaskFromEntry,
  resourceStartedDuringNavigation,
  resourceQueueMs,
  maxLongTasks: MAX_CHAT_LOAD_LONG_TASKS,
  reset() {
    if (activeSpan) {
      if (activeSpan.timeout) clearTimeout(activeSpan.timeout);
      stopChatLoadPerformance(
        activeSpan.performance,
        activeSpan.startedMonoMs,
        monotonicNow(),
        () => false,
      );
    }
    activeSpan = null;
  },
};
