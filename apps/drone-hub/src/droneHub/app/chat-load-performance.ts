export type ResourceTimingRecord = {
  startMs: number;
  durationMs: number;
  initiatorType?: string;
  nextHopProtocol?: string;
  deliveryType?: string;
  workerStartMs?: number;
  redirectStartMs?: number;
  redirectEndMs?: number;
  fetchStartMs?: number;
  domainLookupStartMs?: number;
  domainLookupEndMs?: number;
  connectStartMs?: number;
  secureConnectionStartMs?: number;
  connectEndMs?: number;
  requestStartMs?: number;
  firstInterimResponseStartMs?: number;
  responseStartMs?: number;
  responseEndMs?: number;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
};

export type LongTaskRecord = {
  startMs: number;
  durationMs: number;
  overlapMs: number;
};

export type ChatLoadPerformanceState = {
  resourceObserver: PerformanceObserver | null;
  resourceEntries: ResourceTimingLike[];
  resourceEntryKeys: Set<string>;
  usedResourceEntryKeys: Set<string>;
  resourceEntriesDropped: number;
  resourceTimingSupported: boolean;
  longTaskObserver: PerformanceObserver | null;
  longTasks: LongTaskRecord[];
  longTaskKeys: Set<string>;
  longTaskCount: number;
  longTaskStatus: 'supported' | 'unavailable' | 'observer_error';
};

type ResourceTimingLike = PerformanceEntry &
  Partial<PerformanceResourceTiming> & {
    deliveryType?: string;
    firstInterimResponseStart?: number;
  };

const MAX_RESOURCE_ENTRIES = 48;
export const MAX_CHAT_LOAD_LONG_TASKS = 50;
const RESOURCE_START_MATCH_TOLERANCE_MS = 250;

export function startChatLoadPerformance(input: {
  navigationStartedMonoMs: number;
  isNavigationResource: (rawUrl: string) => boolean;
}): ChatLoadPerformanceState {
  const state: ChatLoadPerformanceState = {
    resourceObserver: null,
    resourceEntries: [],
    resourceEntryKeys: new Set(),
    usedResourceEntryKeys: new Set(),
    resourceEntriesDropped: 0,
    resourceTimingSupported: false,
    longTaskObserver: null,
    longTasks: [],
    longTaskKeys: new Set(),
    longTaskCount: 0,
    longTaskStatus: 'unavailable',
  };
  const addResources = (entries: PerformanceEntry[]) =>
    addResourceEntries(state, entries, input.navigationStartedMonoMs, input.isNavigationResource);
  const Observer = typeof PerformanceObserver === 'function' ? PerformanceObserver : null;
  const timingPerformance = typeof performance !== 'undefined' ? performance : null;
  state.resourceTimingSupported = Boolean(
    timingPerformance && typeof timingPerformance.getEntriesByName === 'function',
  );
  if (Observer) {
    try {
      const observer = new Observer((list) => addResources(list.getEntries()));
      try {
        observer.observe({ type: 'resource', buffered: true });
      } catch {
        observer.observe({ entryTypes: ['resource'] });
      }
      state.resourceObserver = observer;
      state.resourceTimingSupported = true;
    } catch {
      state.resourceObserver = null;
    }
  }

  const supportedTypes = Observer?.supportedEntryTypes;
  if (!Observer || (Array.isArray(supportedTypes) && !supportedTypes.includes('longtask'))) {
    return state;
  }
  try {
    const observer = new Observer((list) =>
      addLongTasks(state, list.getEntries(), input.navigationStartedMonoMs, performanceNow()),
    );
    try {
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      observer.observe({ entryTypes: ['longtask'] });
    }
    state.longTaskObserver = observer;
    state.longTaskStatus = 'supported';
  } catch {
    state.longTaskObserver = null;
    state.longTaskStatus = 'observer_error';
  }
  return state;
}

export function stopChatLoadPerformance(
  state: ChatLoadPerformanceState,
  navigationStartedMonoMs: number,
  navigationFinishedMonoMs: number,
  isNavigationResource: (rawUrl: string) => boolean,
): void {
  try {
    if (state.resourceObserver) {
      addResourceEntries(
        state,
        state.resourceObserver.takeRecords(),
        navigationStartedMonoMs,
        isNavigationResource,
      );
    }
  } catch {
    // Best-effort diagnostics must never affect navigation.
  }
  try {
    state.resourceObserver?.disconnect();
  } catch {
    // Best-effort diagnostics must never affect navigation.
  }
  try {
    if (state.longTaskObserver) {
      addLongTasks(
        state,
        state.longTaskObserver.takeRecords(),
        navigationStartedMonoMs,
        navigationFinishedMonoMs,
      );
    }
  } catch {
    // Best-effort diagnostics must never affect navigation.
  }
  try {
    state.longTaskObserver?.disconnect();
  } catch {
    // Best-effort diagnostics must never affect navigation.
  }
  state.resourceObserver = null;
  state.longTaskObserver = null;
}

export function collectChatLoadResourceTiming(input: {
  state: ChatLoadPerformanceState;
  requestUrls: string[];
  requestStartedAt: number;
  navigationStartedMonoMs: number;
  isNavigationResource: (rawUrl: string) => boolean;
}): {
  status: 'collected' | 'not_found' | 'unavailable';
  timing?: ResourceTimingRecord;
} {
  const { state } = input;
  if (state.resourceObserver) {
    try {
      addResourceEntries(
        state,
        state.resourceObserver.takeRecords(),
        input.navigationStartedMonoMs,
        input.isNavigationResource,
      );
    } catch {
      // Fall through to the Performance timeline lookup.
    }
  }
  if (typeof performance !== 'undefined' && typeof performance.getEntriesByName === 'function') {
    for (const candidateUrl of new Set(input.requestUrls)) {
      try {
        addResourceEntries(
          state,
          performance.getEntriesByName(candidateUrl, 'resource'),
          input.navigationStartedMonoMs,
          input.isNavigationResource,
        );
      } catch {
        // A missing or full browser timing buffer is represented as not_found.
      }
    }
  }
  const matchedEntry = correlateResourceEntry(
    state.resourceEntries,
    input.requestUrls,
    input.requestStartedAt,
    state.usedResourceEntryKeys,
  );
  const timing = matchedEntry
    ? resourceTimingFromEntry(matchedEntry, input.navigationStartedMonoMs)
    : undefined;
  if (matchedEntry && timing) state.usedResourceEntryKeys.add(resourceEntryKey(matchedEntry));
  return {
    status: timing ? 'collected' : state.resourceTimingSupported ? 'not_found' : 'unavailable',
    ...(timing ? { timing } : {}),
  };
}

export function resourceTimingFromEntry(
  entry: ResourceTimingLike,
  navigationStartedMonoMs: number,
): ResourceTimingRecord | undefined {
  const startTime = Number(entry.startTime);
  const duration = Number(entry.duration);
  if (!Number.isFinite(startTime) || !Number.isFinite(duration) || duration < 0) return undefined;
  const timing: ResourceTimingRecord = {
    startMs: roundedMs(startTime - navigationStartedMonoMs),
    durationMs: roundedMs(duration),
  };
  const textFields: Array<[keyof ResourceTimingRecord, unknown, number]> = [
    ['initiatorType', entry.initiatorType, 24],
    ['nextHopProtocol', entry.nextHopProtocol, 32],
    ['deliveryType', entry.deliveryType, 24],
  ];
  for (const [name, value, maxLength] of textFields) {
    const text = boundedText(value, maxLength);
    if (text) (timing as Record<string, unknown>)[name] = text;
  }
  const timestampFields: Array<[keyof ResourceTimingRecord, unknown]> = [
    ['workerStartMs', entry.workerStart],
    ['redirectStartMs', entry.redirectStart],
    ['redirectEndMs', entry.redirectEnd],
    ['fetchStartMs', entry.fetchStart],
    ['domainLookupStartMs', entry.domainLookupStart],
    ['domainLookupEndMs', entry.domainLookupEnd],
    ['connectStartMs', entry.connectStart],
    ['secureConnectionStartMs', entry.secureConnectionStart],
    ['connectEndMs', entry.connectEnd],
    ['requestStartMs', entry.requestStart],
    ['firstInterimResponseStartMs', entry.firstInterimResponseStart],
    ['responseStartMs', entry.responseStart],
    ['responseEndMs', entry.responseEnd],
  ];
  for (const [name, value] of timestampFields) {
    const timestamp = Number(value);
    if (Number.isFinite(timestamp) && timestamp > 0 && timestamp >= startTime) {
      (timing as Record<string, unknown>)[name] = roundedMs(timestamp - startTime);
    }
  }
  const sizeFields: Array<[keyof ResourceTimingRecord, unknown]> = [
    ['transferSize', entry.transferSize],
    ['encodedBodySize', entry.encodedBodySize],
    ['decodedBodySize', entry.decodedBodySize],
  ];
  for (const [name, value] of sizeFields) {
    const size = Number(value);
    if (Number.isSafeInteger(size) && size >= 0 && size <= 100_000_000) {
      (timing as Record<string, unknown>)[name] = size;
    }
  }
  return timing;
}

export function correlateResourceEntry(
  entries: ResourceTimingLike[],
  requestUrls: string[],
  requestStartedAt: number,
  usedEntryKeys: Set<string>,
): ResourceTimingLike | undefined {
  const expectedUrls = new Set(requestUrls);
  return entries
    .filter((entry) => {
      if (usedEntryKeys.has(resourceEntryKey(entry))) return false;
      const entryUrl = absoluteUrl(entry.name);
      return Boolean(entryUrl && expectedUrls.has(entryUrl.href));
    })
    .map((entry) => ({ entry, distance: Math.abs(entry.startTime - requestStartedAt) }))
    .filter(({ distance }) => distance <= RESOURCE_START_MATCH_TOLERANCE_MS)
    .sort((a, b) => a.distance - b.distance)[0]?.entry;
}

export function longTaskFromEntry(
  entry: Pick<PerformanceEntry, 'startTime' | 'duration'>,
  navigationStartedMonoMs: number,
  navigationFinishedMonoMs: number,
): LongTaskRecord | undefined {
  const taskStart = Number(entry.startTime);
  const duration = Number(entry.duration);
  const taskEnd = taskStart + duration;
  if (
    !Number.isFinite(taskStart) ||
    !Number.isFinite(duration) ||
    duration < 0 ||
    taskStart >= navigationFinishedMonoMs ||
    taskEnd <= navigationStartedMonoMs
  ) {
    return undefined;
  }
  return {
    startMs: roundedMs(Math.max(taskStart, navigationStartedMonoMs) - navigationStartedMonoMs),
    durationMs: roundedMs(duration),
    overlapMs: roundedMs(
      Math.min(taskEnd, navigationFinishedMonoMs) - Math.max(taskStart, navigationStartedMonoMs),
    ),
  };
}

export function resourceStartedDuringNavigation(
  entry: Pick<PerformanceEntry, 'startTime'>,
  navigationStartedMonoMs: number,
): boolean {
  return Number.isFinite(entry.startTime) && entry.startTime >= navigationStartedMonoMs;
}

function addResourceEntries(
  state: ChatLoadPerformanceState,
  entries: PerformanceEntry[],
  navigationStartedMonoMs: number,
  isNavigationResource: (rawUrl: string) => boolean,
): void {
  for (const entry of entries as ResourceTimingLike[]) {
    if (
      !isNavigationResource(entry.name) ||
      !resourceStartedDuringNavigation(entry, navigationStartedMonoMs)
    ) {
      continue;
    }
    const key = resourceEntryKey(entry);
    if (state.resourceEntryKeys.has(key)) continue;
    state.resourceEntryKeys.add(key);
    if (state.resourceEntries.length >= MAX_RESOURCE_ENTRIES) {
      state.resourceEntriesDropped += 1;
      continue;
    }
    state.resourceEntries.push(entry);
  }
}

function addLongTasks(
  state: ChatLoadPerformanceState,
  entries: PerformanceEntry[],
  navigationStartedMonoMs: number,
  navigationFinishedMonoMs: number,
): void {
  for (const entry of entries) {
    const key = `${entry.startTime}\u0000${entry.duration}`;
    if (state.longTaskKeys.has(key)) continue;
    const record = longTaskFromEntry(entry, navigationStartedMonoMs, navigationFinishedMonoMs);
    if (!record) continue;
    state.longTaskKeys.add(key);
    state.longTaskCount += 1;
    if (state.longTasks.length < MAX_CHAT_LOAD_LONG_TASKS) state.longTasks.push(record);
  }
}

function resourceEntryKey(entry: ResourceTimingLike): string {
  return `${entry.name}\u0000${entry.startTime}\u0000${entry.duration}`;
}

function absoluteUrl(raw: string): URL | null {
  if (typeof URL === 'undefined') return null;
  try {
    return new URL(raw, typeof location !== 'undefined' ? location.href : 'http://localhost');
  } catch {
    return null;
  }
}

function performanceNow(): number {
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
