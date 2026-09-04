import { describe, expect, test } from 'bun:test';
import {
  createChatManagementRouteHandler,
  resolveReadStateChatEntry,
} from '../src/hub/routes/chat-management-routes';
import {
  createChatPromptRouteHandler,
  projectTranscriptActivity,
} from '../src/hub/routes/chat-prompt-routes';

describe('chat management route helpers', () => {
  test('projects heavyweight run activity to a stable compact summary', () => {
    const activity = {
      version: 1,
      source: 'codex',
      updatedAt: '2026-09-04T10:00:00.000Z',
      truncated: true,
      messages: [
        {
          id: 'message-1',
          role: 'assistant',
          content: [
            { type: 'text', text: 'working' },
            { type: 'toolCall', id: 'tool-1', name: 'shell', arguments: {} },
          ],
        },
        { id: 'message-2', role: 'toolResult', toolCallId: 'tool-1', content: 'x'.repeat(10_000) },
      ],
    };

    expect(projectTranscriptActivity([{ id: 'turn-1', activity }], 'summary')).toEqual([
      {
        id: 'turn-1',
        activitySummary: {
          available: true,
          version: 1,
          source: 'codex',
          updatedAt: '2026-09-04T10:00:00.000Z',
          messageCount: 2,
          toolCallCount: 1,
          truncated: true,
        },
      },
    ]);
    expect(projectTranscriptActivity([{ id: 'turn-1', activity }], 'none')).toEqual([
      { id: 'turn-1' },
    ]);
  });

  test('loads full run activity for one stable turn id without reading a chat snapshot', async () => {
    const activity = {
      version: 1,
      source: 'codex',
      updatedAt: '2026-09-04T10:00:00.000Z',
      messages: [],
    };
    let response: any = null;
    const handler = createChatPromptRouteHandler({
      normalizeChatName: (value: unknown) => String(value),
      normalizeDroneIdentity: (value: unknown) => String(value),
      resolveCanonicalDroneOrPendingForReadRef: async () => ({
        kind: 'real',
        id: 'drone-a',
        drone: {},
      }),
      readTranscriptTurnsByIdsFromStore: ({ turnIds }: any) =>
        turnIds[0] === 'turn-7' ? [{ id: 'turn-7', activity }] : [],
      createRequestTimer: () => ({ mark: () => {}, setHeader: () => {} }),
      jsonWithEtag: (_req: any, _res: any, status: number, body: any) => {
        response = { status, body };
      },
    } as any);

    expect(
      await handler({
        req: { headers: {} } as any,
        res: {} as any,
        url: new URL('http://hub.test/api/drones/drone-a/chats/default/turns/turn-7/activity'),
        method: 'GET',
        parts: ['api', 'drones', 'drone-a', 'chats', 'default', 'turns', 'turn-7', 'activity'],
      }),
    ).toBe(true);
    expect(response).toEqual({
      status: 200,
      body: { ok: true, droneId: 'drone-a', chatName: 'default', turnId: 'turn-7', activity },
    });
  });

  test('uses the canonical chat store when the lifecycle projection has no chats', () => {
    const canonicalChat = { id: 'chat-id', agent: { kind: 'builtin', id: 'codex' } };

    expect(
      resolveReadStateChatEntry({
        droneId: 'drone-id',
        chatName: 'default',
        droneEntry: { id: 'drone-id' },
        readChatFromStore: () => ({ available: true, chat: canonicalChat }),
      }),
    ).toEqual({ chatEntry: canonicalChat, fromStore: true });
  });

  test('falls back to the compatibility projection when the chat store is unavailable', () => {
    const projectedChat = { id: 'legacy-chat-id' };

    expect(
      resolveReadStateChatEntry({
        droneId: 'drone-id',
        chatName: 'default',
        droneEntry: { chats: { default: projectedChat } },
        readChatFromStore: () => ({ available: false, chat: null }),
      }),
    ).toEqual({ chatEntry: projectedChat, fromStore: false });
  });

  test('reads MCP access directly from canonical metadata without ensuring or importing a chat', async () => {
    const calls: string[] = [];
    const phases: string[] = [];
    const headers = new Map<string, string>();
    let response: { status: number; body: any } | null = null;
    const res = {
      headersSent: false,
      statusCode: 0,
      setHeader: (name: string, value: string) => headers.set(name, value),
      end(data: string) {
        response = { status: this.statusCode, body: JSON.parse(data) };
        this.headersSent = true;
      },
    };
    const dependencies = new Proxy(
      {
        createRequestTimer: () => ({
          mark: (name: string) => phases.push(name),
          setHeader: () => headers.set('server-timing', phases.join(',')),
        }),
        ensureChatEntry: async () => calls.push('ensure'),
        getChatEntry: async () => calls.push('get'),
        importDroneChatsFromRegistry: async () => calls.push('import'),
        isManagedChatMcpAvailableForRead: async () => {
          calls.push('availability');
          return true;
        },
        logSlowHubRequest: () => {},
        readChatMetadataFromStore: () => {
          calls.push('read');
          return {
            available: true,
            chat: {
              droneHubMcpAccessScope: {
                readMode: 'selected',
                writeMode: 'all',
                executeMode: 'selected',
                droneIds: ['drone-a'],
                updatedAt: '2026-08-21T00:00:00.000Z',
              },
            },
          };
        },
        resolveCanonicalDroneOrPendingForReadRef: async () => {
          calls.push('resolve');
          return { kind: 'real', id: 'drone-a', drone: { id: 'drone-a' } };
        },
      },
      {
        get(target, property) {
          return property in target
            ? target[property as keyof typeof target]
            : () => {
                throw new Error(`unexpected dependency call: ${String(property)}`);
              };
        },
      },
    );
    const handler = createChatManagementRouteHandler(dependencies as any);

    expect(
      await handler({
        req: { headers: {} } as any,
        res: res as any,
        url: new URL('http://hub.test/api/drones/drone-a/chats/default/mcp-access'),
        method: 'GET',
        parts: ['api', 'drones', 'drone-a', 'chats', 'default', 'mcp-access'],
      }),
    ).toBe(true);
    expect(calls).toEqual(['resolve', 'read', 'availability']);
    expect(phases).toEqual(['resolve', 'read', 'availability']);
    expect(headers.get('server-timing')).toBe('resolve,read,availability');
    expect(response).toMatchObject({
      status: 200,
      body: {
        ok: true,
        available: true,
        accessScope: { readMode: 'selected', writeMode: 'all', executeMode: 'selected' },
      },
    });
  });
});
