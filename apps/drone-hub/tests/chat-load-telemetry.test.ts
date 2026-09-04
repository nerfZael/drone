import { afterEach, describe, expect, test } from 'bun:test';

import { fetchDroneChatStateCached } from '../src/droneHub/app/chat-api';
import {
  beginChatLoadNavigation,
  chatLoadTelemetryTesting,
  markChatLoadCacheHit,
  markChatLoadConfigResolved,
  markChatLoadContentCommitted,
  markChatLoadPrimaryResolved,
  markChatLoadSelectionCommitted,
  observeChatLoadRequest,
} from '../src/droneHub/app/chat-load-telemetry';

const target = { droneId: 'drone-1', chatName: 'default' };

afterEach(() => {
  chatLoadTelemetryTesting.reset();
});

describe('chat load telemetry', () => {
  test('parses bounded Server-Timing phases', () => {
    expect(
      chatLoadTelemetryTesting.parseServerTiming(
        'lifecycle;dur=1.25, rows;desc="read";dur=8.4, invalid;dur=-1',
      ),
    ).toEqual({ lifecycle: 1.3, rows: 8.4 });
    const phases = chatLoadTelemetryTesting.parseServerTiming(
      [
        '__proto__;dur=1',
        'constructor;dur=1',
        ...Array.from({ length: 30 }, (_, index) => `phase_${index};dur=${index}`),
      ].join(','),
    );
    expect(Object.keys(phases ?? {})).toHaveLength(24);
    expect(Object.prototype.hasOwnProperty.call(phases, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(phases, 'constructor')).toBe(false);
  });

  test('extracts supported Resource Timing fields without retaining the resource URL', () => {
    const entry = {
      name: 'https://hub.example/api/drones/secret/chats/private/state?token=secret',
      entryType: 'resource',
      startTime: 100,
      duration: 80,
      initiatorType: 'fetch',
      nextHopProtocol: 'h2',
      deliveryType: 'cache',
      workerStart: 105,
      fetchStart: 110,
      domainLookupStart: 112,
      domainLookupEnd: 114,
      connectStart: 114,
      secureConnectionStart: 116,
      connectEnd: 120,
      requestStart: 125,
      responseStart: 170,
      responseEnd: 180,
      transferSize: 0,
      encodedBodySize: 512,
      decodedBodySize: 1024,
    } as PerformanceResourceTiming;

    const timing = chatLoadTelemetryTesting.resourceTimingFromEntry(entry, 90);
    expect(timing).toEqual({
      startMs: 10,
      durationMs: 80,
      initiatorType: 'fetch',
      nextHopProtocol: 'h2',
      deliveryType: 'cache',
      workerStartMs: 5,
      fetchStartMs: 10,
      domainLookupStartMs: 12,
      domainLookupEndMs: 14,
      connectStartMs: 14,
      secureConnectionStartMs: 16,
      connectEndMs: 20,
      requestStartMs: 25,
      responseStartMs: 70,
      responseEndMs: 80,
      transferSize: 0,
      encodedBodySize: 512,
      decodedBodySize: 1024,
    });
    expect(JSON.stringify(timing)).not.toContain('secret');
    expect(timing).not.toHaveProperty('name');
  });

  test('measures browser request queue time from Resource Timing', () => {
    expect(
      chatLoadTelemetryTesting.resourceQueueMs({
        requestStartMs: 25,
        fetchStartMs: 10,
      }),
    ).toBe(15);
    expect(chatLoadTelemetryTesting.resourceQueueMs({ requestStartMs: 7 })).toBe(7);
    expect(
      chatLoadTelemetryTesting.resourceQueueMs({
        requestStartMs: 5,
        fetchStartMs: 10,
      }),
    ).toBe(0);
    expect(chatLoadTelemetryTesting.resourceQueueMs(undefined)).toBeUndefined();
  });

  test('correlates the closest unused Resource Timing entry within the request window', () => {
    const makeEntry = (startTime: number) =>
      ({
        name: 'http://localhost/api/drones/drone-1/chats/default/state',
        entryType: 'resource',
        startTime,
        duration: 10,
      }) as PerformanceResourceTiming;
    const earlier = makeEntry(100);
    const closest = makeEntry(199);
    const entries = [earlier, closest, makeEntry(700)];
    const used = new Set<string>();

    expect(
      chatLoadTelemetryTesting.correlateResourceEntry(
        entries,
        ['http://localhost/api/drones/drone-1/chats/default/state'],
        200,
        used,
      ),
    ).toBe(closest);
    expect(
      chatLoadTelemetryTesting.correlateResourceEntry(
        entries,
        ['http://localhost/api/drones/drone-1/chats/other/state'],
        200,
        used,
      ),
    ).toBeUndefined();
  });

  test('rejects buffered Resource Timing entries that started before navigation', () => {
    expect(
      chatLoadTelemetryTesting.resourceStartedDuringNavigation({ startTime: 99 }, 100),
    ).toBe(false);
    expect(
      chatLoadTelemetryTesting.resourceStartedDuringNavigation({ startTime: 100 }, 100),
    ).toBe(true);
  });

  test('clips a long task to its overlap with the navigation', () => {
    expect(
      chatLoadTelemetryTesting.longTaskFromEntry({ startTime: 90, duration: 30 }, 100, 120),
    ).toEqual({ startMs: 0, durationMs: 30, overlapMs: 20 });
    expect(
      chatLoadTelemetryTesting.longTaskFromEntry({ startTime: 50, duration: 10 }, 100, 120),
    ).toBeUndefined();
  });

  test('correlates target requests and reports after primary content is painted', async () => {
    const originalFetch = globalThis.fetch;
    const reports: any[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      reports.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    }) as typeof fetch;
    try {
      beginChatLoadNavigation({ target, source: 'chat' });
      markChatLoadSelectionCommitted(target);
      const request = observeChatLoadRequest('/api/drones/drone-1/chats/default/state');
      expect(request).not.toBeNull();
      request?.response(
        new Response('{}', {
          status: 200,
          headers: { 'server-timing': 'lifecycle;dur=2.5, rows;dur=4' },
        }),
      );
      request?.finish({ responseBytes: 2, parseMs: 0.2 });
      markChatLoadConfigResolved(target, {
        surface: 'transcript',
        agentKind: 'builtin:codex',
        runtime: 'container',
      });
      markChatLoadPrimaryResolved(target, {
        surface: 'transcript',
        cacheStatus: 'miss',
        itemCount: 12,
      });
      markChatLoadContentCommitted(target, 'transcript');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        version: 2,
        source: 'chat',
        target,
        status: 'completed',
        surface: 'transcript',
        agentKind: 'builtin:codex',
        runtime: 'container',
        cacheStatus: 'miss',
        itemCount: 12,
        milestones: {
          click: 0,
          selection_committed: expect.any(Number),
          config_loaded: expect.any(Number),
          primary_content_loaded: expect.any(Number),
          content_committed: expect.any(Number),
          content_painted: expect.any(Number),
        },
        requests: [
          {
            name: 'chat_state',
            status: 200,
            responseBytes: 2,
            parseMs: 0.2,
            outcome: 'completed',
            serverTiming: { lifecycle: 2.5, rows: 4 },
            resourceTimingStatus: expect.any(String),
          },
        ],
        capabilities: {
          resourceTiming: expect.any(String),
          longTasks: expect.any(String),
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('records conditional chat state 200 and 304 responses during navigation', async () => {
    const originalFetch = globalThis.fetch;
    const reports: any[] = [];
    let stateRequests = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/telemetry/chat-load') {
        reports.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(JSON.stringify({ ok: true }), { status: 202 });
      }
      stateRequests += 1;
      if (stateRequests === 1) {
        return new Response(JSON.stringify({ ok: true, transcripts: [], pending: [] }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            etag: '"state-1"',
            'server-timing': 'transcript;dur=3',
          },
        });
      }
      expect(new Headers(init?.headers).get('if-none-match')).toBe('"state-1"');
      return new Response(null, {
        status: 304,
        headers: { etag: '"state-1"', 'server-timing': 'transcript;dur=1' },
      });
    }) as typeof fetch;

    try {
      beginChatLoadNavigation({ target, source: 'chat' });
      const first = await fetchDroneChatStateCached({
        droneId: target.droneId,
        chatName: target.chatName,
      });
      expect(first.notModified).toBe(false);
      const second = await fetchDroneChatStateCached({
        droneId: target.droneId,
        chatName: target.chatName,
        etag: first.etag,
      });
      expect(second).toEqual({ etag: '"state-1"', notModified: true });

      markChatLoadConfigResolved(target, { surface: 'transcript' });
      markChatLoadPrimaryResolved(target, {
        surface: 'transcript',
        cacheStatus: 'hit',
        itemCount: 0,
      });
      markChatLoadContentCommitted(target, 'transcript');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(reports).toHaveLength(1);
      expect(reports[0].requests).toMatchObject([
        {
          name: 'chat_state',
          status: 200,
          outcome: 'completed',
          responseBytes: expect.any(Number),
          serverTiming: { transcript: 3 },
        },
        {
          name: 'chat_state',
          status: 304,
          outcome: 'completed',
          responseBytes: 0,
          serverTiming: { transcript: 1 },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('reports cached display separately from fresh resolution and paint', async () => {
    const originalFetch = globalThis.fetch;
    const reports: any[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      reports.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response('{}', { status: 202 });
    }) as typeof fetch;
    try {
      beginChatLoadNavigation({ target, source: 'chat' });
      markChatLoadCacheHit(target, 'transcript', 8);
      markChatLoadContentCommitted(target, 'transcript');
      await new Promise((resolve) => setTimeout(resolve, 0));
      markChatLoadConfigResolved(target, { surface: 'transcript' });
      markChatLoadPrimaryResolved(target, {
        surface: 'transcript',
        cacheStatus: 'hit',
        itemCount: 9,
      });
      markChatLoadContentCommitted(target, 'transcript');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        version: 2,
        content: {
          cached: {
            availabilityMs: expect.any(Number),
            displayMs: expect.any(Number),
            paintMs: expect.any(Number),
            itemCount: 8,
          },
          fresh: {
            status: 'completed',
            resolutionMs: expect.any(Number),
            commitMs: expect.any(Number),
            paintMs: expect.any(Number),
            itemCount: 9,
          },
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('bounds observed long tasks and tolerates unavailable browser APIs', async () => {
    const originalFetch = globalThis.fetch;
    const originalObserver = globalThis.PerformanceObserver;
    const reports: any[] = [];
    const observers: Array<{ type: string; emit: (entries: PerformanceEntry[]) => void }> = [];
    class MockPerformanceObserver {
      static supportedEntryTypes = ['resource', 'longtask'];
      private callback: PerformanceObserverCallback;
      private records: PerformanceEntry[] = [];
      constructor(callback: PerformanceObserverCallback) {
        this.callback = callback;
      }
      observe(options: PerformanceObserverInit) {
        const observer = {
          type: String(options.type ?? ''),
          emit: (entries: PerformanceEntry[]) => {
            this.callback(
              { getEntries: () => entries } as PerformanceObserverEntryList,
              this as any,
            );
          },
        };
        observers.push(observer);
      }
      takeRecords() {
        return this.records.splice(0);
      }
      disconnect() {}
    }
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      reports.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response('{}', { status: 202 });
    }) as typeof fetch;
    globalThis.PerformanceObserver = MockPerformanceObserver as any;
    try {
      beginChatLoadNavigation({ target, source: 'programmatic' });
      const taskStart = performance.now() - 1;
      const longTaskObserver = observers.find((observer) => observer.type === 'longtask');
      longTaskObserver?.emit(
        Array.from(
          { length: chatLoadTelemetryTesting.maxLongTasks + 5 },
          (_, index) => ({ startTime: taskStart, duration: 50 + index }) as PerformanceEntry,
        ),
      );
      markChatLoadConfigResolved(target, { surface: 'transcript' });
      markChatLoadPrimaryResolved(target, { surface: 'transcript' });
      markChatLoadContentCommitted(target, 'transcript');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(reports[0].longTasks).toHaveLength(chatLoadTelemetryTesting.maxLongTasks);
      expect(reports[0].longTaskCount).toBe(chatLoadTelemetryTesting.maxLongTasks + 5);
      expect(reports[0].longTasksDropped).toBe(5);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.PerformanceObserver = originalObserver;
    }

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      reports.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response('{}', { status: 202 });
    }) as typeof fetch;
    globalThis.PerformanceObserver = undefined as any;
    const getEntriesByNameDescriptor = Object.getOwnPropertyDescriptor(
      performance,
      'getEntriesByName',
    );
    Object.defineProperty(performance, 'getEntriesByName', {
      configurable: true,
      value: undefined,
    });
    try {
      beginChatLoadNavigation({ target, source: 'programmatic' });
      markChatLoadConfigResolved(target, { surface: 'transcript' });
      markChatLoadPrimaryResolved(target, { surface: 'transcript' });
      markChatLoadContentCommitted(target, 'transcript');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(reports.at(-1).capabilities.longTasks).toBe('unavailable');
      expect(reports.at(-1).capabilities.resourceTiming).toBe('unavailable');
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.PerformanceObserver = originalObserver;
      if (getEntriesByNameDescriptor) {
        Object.defineProperty(performance, 'getEntriesByName', getEntriesByNameDescriptor);
      } else {
        delete (performance as any).getEntriesByName;
      }
    }
  });

  test('ignores requests for another chat', () => {
    beginChatLoadNavigation({ target, source: 'drone' });
    expect(observeChatLoadRequest('/api/drones/drone-1/chats/other/state')).toBeNull();
  });

  test('records cached display before fresh config and content reconcile', async () => {
    const originalFetch = globalThis.fetch;
    const reports: any[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      reports.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    }) as typeof fetch;
    try {
      beginChatLoadNavigation({ target, source: 'chat' });
      markChatLoadSelectionCommitted(target);
      markChatLoadConfigResolved(target, {
        surface: 'transcript',
        agentKind: 'builtin:codex',
        runtime: 'container',
        source: 'cache',
      });
      markChatLoadCacheHit(target, 'transcript', 8);
      markChatLoadContentCommitted(target, 'transcript');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(reports).toHaveLength(0);

      markChatLoadConfigResolved(target, {
        surface: 'transcript',
        agentKind: 'builtin:codex',
        runtime: 'container',
      });
      markChatLoadPrimaryResolved(target, {
        surface: 'transcript',
        cacheStatus: 'hit',
        itemCount: 9,
      });
      markChatLoadContentCommitted(target, 'transcript');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(reports).toHaveLength(1);
      const cachedPainted = reports[0].milestones.cached_content_painted;
      const freshReconciled = reports[0].milestones.fresh_content_reconciled;
      expect(typeof cachedPainted).toBe('number');
      expect(typeof freshReconciled).toBe('number');
      expect(cachedPainted).toBeLessThanOrEqual(freshReconciled);
      expect(reports[0]).toMatchObject({
        status: 'completed',
        surface: 'transcript',
        cacheStatus: 'hit',
        itemCount: 9,
        milestones: {
          cached_config_available: expect.any(Number),
          cached_content_available: expect.any(Number),
          cached_content_committed: expect.any(Number),
          cached_content_painted: expect.any(Number),
          config_reconciled: expect.any(Number),
          fresh_content_reconciled: expect.any(Number),
          content_committed: expect.any(Number),
          content_painted: expect.any(Number),
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('waits for cached config to reconcile when fresh content was not cached', async () => {
    const originalFetch = globalThis.fetch;
    const reports: any[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      reports.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    }) as typeof fetch;
    try {
      beginChatLoadNavigation({ target, source: 'chat' });
      markChatLoadConfigResolved(target, {
        surface: 'transcript',
        agentKind: 'builtin:codex',
        runtime: 'container',
        source: 'cache',
      });
      markChatLoadPrimaryResolved(target, {
        surface: 'transcript',
        cacheStatus: 'miss',
        itemCount: 4,
      });
      markChatLoadContentCommitted(target, 'transcript');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(reports).toHaveLength(0);

      markChatLoadConfigResolved(target, {
        surface: 'transcript',
        agentKind: 'builtin:codex',
        runtime: 'container',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        status: 'completed',
        cacheStatus: 'miss',
        milestones: {
          cached_config_available: expect.any(Number),
          config_reconciled: expect.any(Number),
          primary_content_loaded: expect.any(Number),
          content_painted: expect.any(Number),
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
