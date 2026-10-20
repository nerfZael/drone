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

  test('deleting or archiving a chat takes its side chats from the store, even when the drone carries no chats', async () => {
    const stored: Record<string, any> = {
      plan: { id: 'plan-id' },
      fork: { id: 'fork-id', visibility: 'side-chat', sideChatOrigin: { sourceChatName: 'plan', sourceChatId: 'plan-id' } },
      nested: { id: 'nested-id', visibility: 'side-chat', sideChatOrigin: { sourceChatName: 'fork', sourceChatId: 'fork-id' } },
      other: { id: 'other-id' },
    };
    const run = async (mode: 'permanent' | 'archive', method: 'DELETE' | 'POST', stuck = '') => {
      const calls: string[] = [];
      let response: any = null;
      const res = {
        headersSent: false,
        statusCode: 0,
        setHeader: () => {},
        end(data: string) {
          response = { status: this.statusCode, body: JSON.parse(data) };
          this.headersSent = true;
        },
      };
      const dependencies = new Proxy(
        {
          normalizeChatName: (value: unknown) => String(value),
          resolveDroneOrRespond: async () => ({ id: 'drone-a', drone: { id: 'drone-a', name: 'Alpha' } }),
          resolveEffectiveDeleteActionSettings: async () => ({ mode, archiveRetention: '1d' }),
          isDraftChatEntry: () => false,
          stopSingleDroneChatActivity: async ({ chatName }: any) => {
            if (chatName === stuck) throw new Error('daemon unreachable');
            calls.push(`stop:${chatName}`);
          },
          importDroneChatsFromRegistry: async () => {},
          listChatsFromStore: () => ({ available: true, chats: Object.keys(stored) }),
          readChatMetadataFromStore: ({ chatName }: any) => ({ available: true, chat: stored[chatName] ?? null }),
          buildNewChatEntry: () => ({}),
          deleteActiveChatFromStore: async ({ chatName }: any) => {
            calls.push(`delete:${chatName}`);
            return { deletedChat: stored[chatName], chats: ['other'] };
          },
          archiveChatById: async ({ chatName }: any) => {
            calls.push(`archive:${chatName}`);
            return { hadDrone: true, hadChat: true, archived: true, chats: ['other'] };
          },
          collectDockerSnapshotImageRefsFromChatEntry: () => [],
          inferChatAgent: () => ({ kind: 'builtin', id: 'claude' }),
          projectCanonicalChatsToRegistry: async () => {},
          removeDockerSnapshotImagesBestEffort: async () => {},
          nowIso: () => '2026-10-15T00:00:00.000Z',
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
      const parts = ['api', 'drones', 'drone-a', 'chats', 'plan', ...(method === 'POST' ? ['archive'] : [])];
      await handler({
        req: { headers: {} } as any,
        res: res as any,
        url: new URL(`http://hub.test/${parts.join('/')}`),
        method,
        parts,
      });
      return { calls, response };
    };

    const deleted = await run('permanent', 'DELETE');
    expect(deleted.calls).toEqual(['stop:fork', 'stop:nested', 'stop:plan', 'delete:plan', 'delete:fork', 'delete:nested']);
    expect(deleted.response.body).toMatchObject({ ok: true, deletedChat: 'plan', deletedSideChats: ['fork', 'nested'] });

    // The delete setting archives instead: the side chats are archived as well.
    const archivedByDelete = await run('archive', 'DELETE');
    expect(archivedByDelete.calls.filter((call) => !call.startsWith('stop:'))).toEqual([
      'archive:plan',
      'archive:fork',
      'archive:nested',
    ]);
    expect(archivedByDelete.response.body).toMatchObject({ archivedChat: 'plan', archivedSideChats: ['fork', 'nested'] });

    const archived = await run('permanent', 'POST');
    expect(archived.calls.filter((call) => !call.startsWith('stop:'))).toEqual(['archive:plan', 'archive:fork', 'archive:nested']);

    // A side chat that cannot stop keeps everything: nothing is left without its source.
    for (const [mode, method] of [['permanent', 'DELETE'], ['archive', 'DELETE'], ['permanent', 'POST']] as const) {
      const stuck = await run(mode, method, 'nested');
      expect(stuck.calls).toEqual(['stop:fork']);
      expect(stuck.response).toMatchObject({ status: 500, body: { ok: false, error: 'could not stop side chat nested: daemon unreachable' } });
    }
  });
});
