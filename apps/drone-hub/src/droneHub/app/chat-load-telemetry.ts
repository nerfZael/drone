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
  startMs: number;
  durationMs: number;
  fetchMs?: number;
  bodyMs?: number;
  parseMs?: number;
  status?: number;
  responseBytes?: number;
  serverTiming?: Record<string, number>;
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
  paintScheduled: boolean;
  timeout: ReturnType<typeof setTimeout> | null;
};

const CHAT_LOAD_TIMEOUT_MS = 30_000;
const MAX_REQUEST_RECORDS = 24;
let activeSpan: ChatLoadSpan | null = null;

function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function roundedMs(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
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
  for (const entry of String(raw ?? '').split(',')) {
    const [nameRaw, ...params] = entry.trim().split(';');
    const name = String(nameRaw ?? '').trim();
    if (!/^[a-zA-Z0-9_.-]{1,48}$/.test(name)) continue;
    const durationParam = params.find((param) => /^\s*dur=/i.test(param));
    const duration = Number(String(durationParam ?? '').replace(/^\s*dur=/i, ''));
    if (!Number.isFinite(duration) || duration < 0) continue;
    timing[name] = roundedMs(duration);
  }
  return Object.keys(timing).length > 0 ? timing : undefined;
}

function report(span: ChatLoadSpan, status: ChatLoadStatus): void {
  if (activeSpan === span) activeSpan = null;
  if (span.timeout) clearTimeout(span.timeout);
  span.timeout = null;
  const finishedAt = monotonicNow();
  const primary = span.surface ? span.primaryBySurface[span.surface] : undefined;
  const payload = {
    version: 1,
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
  const afterPaint = () => {
    if (activeSpan === span && !span.freshPrimarySurfaces.has(surface)) {
      mark(span, 'cached_content_painted');
    }
  };
  if (typeof requestAnimationFrame !== 'function') queueMicrotask(afterPaint);
  else requestAnimationFrame(() => requestAnimationFrame(afterPaint));
}

function maybeComplete(span: ChatLoadSpan): void {
  if (activeSpan !== span || !span.surface || span.paintScheduled) return;
  const primary = span.primaryBySurface[span.surface];
  if (!primary || !span.committedSurfaces.has(span.surface)) return;
  if (
    span.cachedSurfaces.has(span.surface) &&
    (!span.freshPrimarySurfaces.has(span.surface) || !span.freshConfigResolved)
  ) {
    return;
  }
  mark(span, 'content_committed');
  span.paintScheduled = true;
  const afterPaint = () => {
    if (activeSpan !== span) return;
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
  const span: ChatLoadSpan = {
    id: makeId(),
    source: input.source,
    target,
    startedAt: new Date().toISOString(),
    startedMonoMs: monotonicNow(),
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
    paintScheduled: false,
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
  span.primaryBySurface[surface] = {
    status: 'completed',
    cacheStatus: 'hit',
    ...(Number.isFinite(itemCount) ? { itemCount } : {}),
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
    span.freshPrimarySurfaces.add('unavailable');
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

export type ChatLoadRequestObservation = {
  response: (response: Response) => void;
  finish: (input?: { responseBytes?: number; parseMs?: number }) => void;
  fail: (error?: unknown) => void;
};

export function observeChatLoadRequest(urlRaw: string): ChatLoadRequestObservation | null {
  const span = activeSpan;
  if (!span || typeof URL === 'undefined') return null;
  let url: URL;
  try {
    url = new URL(urlRaw, typeof location !== 'undefined' ? location.href : 'http://localhost');
  } catch {
    return null;
  }
  if (!requestMatchesTarget(url, span.target)) return null;
  const startedAt = monotonicNow();
  let responseAt: number | null = null;
  let responseStatus: number | undefined;
  let timing: Record<string, number> | undefined;
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
    span.requests.push({
      name: requestName(url),
      startMs: roundedMs(startedAt - span.startedMonoMs),
      durationMs: roundedMs(finishedAt - startedAt),
      ...(fetchMs !== undefined ? { fetchMs } : {}),
      ...(bodyMs !== undefined ? { bodyMs } : {}),
      ...(parseMs !== undefined ? { parseMs } : {}),
      ...(responseStatus !== undefined ? { status: responseStatus } : {}),
      ...(Number.isFinite(input?.responseBytes)
        ? { responseBytes: Math.max(0, Math.floor(Number(input?.responseBytes))) }
        : {}),
      ...(timing ? { serverTiming: timing } : {}),
      outcome,
    });
  };
  return {
    response(response) {
      responseAt = monotonicNow();
      responseStatus = response.status;
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
  reset() {
    if (activeSpan?.timeout) clearTimeout(activeSpan.timeout);
    activeSpan = null;
  },
};
