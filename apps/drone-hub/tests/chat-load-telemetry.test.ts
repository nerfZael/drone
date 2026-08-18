import { afterEach, describe, expect, test } from 'bun:test';

import {
  beginChatLoadNavigation,
  chatLoadTelemetryTesting,
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
        version: 1,
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
          },
        ],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('ignores requests for another chat', () => {
    beginChatLoadNavigation({ target, source: 'drone' });
    expect(observeChatLoadRequest('/api/drones/drone-1/chats/other/state')).toBeNull();
  });
});
