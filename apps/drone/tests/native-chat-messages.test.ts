import { expect, test } from 'bun:test';
import { HubSessionRepository } from '../src/hub/assistant/hub-session-repository';
import { createInProcessDroneHubMcpClient } from '../src/hub/assistant/in-process-drone-hub-mcp';
import { readNativeChatMessages } from '../src/hub/native-chat-messages';
import { readChatIdleStatus } from '../src/hub/chat-idle-status';
import { registerOperationalRoutes } from '../src/hub/routes/operational-routes';
import { HubRouter } from '../src/hub/hub-router';
import { registerNativeChatRoutes } from '../src/hub/routes/native-chat-routes';
import { upsertChatInStore } from '../src/hub/transcript-store';
import { withTempDroneDataDir } from './test-helpers';

async function seed(droneId = 'native-drone', chatName = 'default') {
  const threadId = `${droneId}-${chatName}`;
  await upsertChatInStore({
    droneId,
    chatName,
    chatEntry: { id: threadId, agent: { kind: 'native' } },
  });
  const repo = new HubSessionRepository();
  try {
    const entries: any[] = [
      {
        type: 'message',
        id: 'question',
        timestamp: '2026-09-14T07:24:59Z',
        message: { role: 'user', content: 'Explain cobalt proposals' },
      },
      {
        type: 'message',
        id: 'tool',
        message: { role: 'toolResult', content: 'secret-tool cobalt' + 'x'.repeat(100_000) },
      },
      {
        type: 'message',
        id: 'thinking',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'secret-reasoning cobalt' }],
        },
      },
      {
        type: 'message',
        id: 'answer',
        timestamp: '2026-09-14T07:25:19Z',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: [
            { type: 'thinking', thinking: 'secret-reasoning cobalt' },
            { type: 'text', text: 'The cobalt proposal reply was saved.' },
            { type: 'image', data: 'secret-image' },
          ],
        },
      },
      {
        type: 'compaction',
        id: 'summary',
        summary: 'secret-summary cobalt',
        firstKeptEntryId: undefined,
      },
    ];
    const session = await repo.create({
      provider: 'openai',
      model: 'test',
      permissionMode: 'read-only',
      toolProfile: 'test',
      transcriptSeed: entries,
    } as any);
    await repo.bindThread(threadId, session.id);
  } finally {
    repo.close();
  }
  return threadId;
}

test('general idle API and subscriptions share native completion and activity status', async () => {
  await withTempDroneDataDir('native-idle-api-', async () => {
    const threadId = await seed();
    const chat: any = {
      id: threadId,
      agent: { kind: 'native' },
      turns: [],
      pendingPrompts: [
        {
          id: 'question',
          prompt: 'Explain cobalt proposals',
          state: 'sent',
          at: '2026-09-14T07:24:59Z',
        },
      ],
    };
    const registry = {
      drones: {
        'native-drone': { id: 'native-drone', chats: { default: chat } },
        cli: {
          id: 'cli',
          chats: {
            default: {
              turns: [],
              pendingPrompts: [
                { id: 'cli-question', prompt: 'work', state: 'sent', at: '2026-09-14T07:24:59Z' },
              ],
            },
          },
        },
      },
    };
    let running = false;
    const readStatus = (target: { droneId: string; chatName: string }) =>
      readChatIdleStatus(registry, target, async (id) => {
        expect(id).toBe(threadId);
        return running;
      });
    const target = { droneId: 'native-drone', chatName: 'default' };
    const completed = await readStatus(target);
    expect(completed).toMatchObject({
      ...target,
      idle: true,
      reason: 'latest_agent_message',
      activeUserMessages: 0,
      queuedUserMessages: 0,
      latest: { id: 'answer', role: 'agent', text: 'The cobalt proposal reply was saved.' },
    });
    let body: any;
    let response: any;
    const router = new HubRouter(
      (_res, status, result) => {
        response = { status, body: result };
      },
      async () => body,
    );
    registerOperationalRoutes(router, {
      resolveDroneOrPendingForReadRef: async (id) =>
        id === 'native' ? { id: 'native-drone' } : id === 'cli' ? { id } : null,
      readChatIdleStatus: readStatus,
      resolveGroqApiKeySettings: async () => ({}),
      resolveSpeechSettings: async () => ({}),
      emitAssistantUiAction: () => {},
      hubLog: () => {},
    });
    for (const mode of ['all', 'any']) {
      body = { mode, targets: [{ drone: 'native' }, { drone: 'native' }, { drone: 'cli' }] };
      await router.handle(
        { method: 'POST', headers: {} } as any,
        {} as any,
        new URL('http://hub.test/api/chats/idle/status'),
      );
      expect(response.status).toBe(200);
      expect(response.body.matched).toBe(mode === 'any');
      expect(response.body.targets).toHaveLength(2);
      expect(response.body.targets[0]).toEqual(completed);
      expect(response.body.targets[1]).toMatchObject({ droneId: 'cli', idle: false });
    }
    running = true;
    expect(await readStatus(target)).toMatchObject({ idle: false, activeUserMessages: 1 });
    running = false;
    for (const state of ['queued', 'sending']) {
      chat.pendingPrompts.push({ id: 'next', prompt: 'more', state, at: '2026-09-14T07:26:00Z' });
      expect(await readStatus(target)).toMatchObject({
        idle: false,
        activeUserMessages: 1,
        queuedUserMessages: state === 'queued' ? 1 : 0,
      });
      chat.pendingPrompts.pop();
    }
    await expect(readStatus({ ...target, chatName: 'missing' })).rejects.toThrow();
  });
});

test('native reads recover saved replies after compaction and bound visible text', async () => {
  await withTempDroneDataDir('native-message-read-', async () => {
    const threadId = await seed();
    const page = readNativeChatMessages(threadId, 2, 8000);
    expect(page.messages.map((message) => message.id)).toEqual(['question', 'answer']);
    expect(page.messages[1]?.text).toBe('The cobalt proposal reply was saved.');
    expect(JSON.stringify(page)).not.toContain('secret-');
    const tail = readNativeChatMessages(threadId, 1, 10);
    expect(tail.hasOlder).toBe(true);
    expect(tail.messages[0]).toMatchObject({
      text: 'The cobalt',
      textTruncated: true,
      textOriginalLength: 36,
    });
    expect(readNativeChatMessages('missing', 10, 4000).messages).toEqual([]);
  });
});

test('Companion read_chat retrieves native history through a read-only route', async () => {
  await withTempDroneDataDir('native-message-mcp-', async () => {
    const threadId = await seed();
    const previousFetch = globalThis.fetch;
    const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
    const previousToken = process.env.DRONE_TOKEN;
    const paths: string[] = [];
    let response: Response;
    const router = new HubRouter(
      (_res, status, body) => {
        response = Response.json(body, { status });
      },
      async () => null,
    );
    registerNativeChatRoutes(router, {
      resolveDroneOrPendingForReadRef: async (ref) =>
        ref === 'native-drone' ? { id: ref, kind: 'real', drone: {} } : null,
      getChatEntry: async () => ({ chat: { id: threadId } }),
      inferChatAgent: () => ({ kind: 'native' }),
      nativeChatLifecycle: {
        ensure: () => {
          throw new Error('Must not bootstrap a session');
        },
      },
      nativeChatHistoryPage: async () => {
        throw new Error('Must not load unbounded activity');
      },
    });
    globalThis.fetch = (async (input: any, init: any) => {
      const url = new URL(String(input));
      expect(init?.method ?? 'GET').toBe('GET');
      paths.push(url.pathname);
      if (url.pathname.endsWith('/state'))
        return Response.json({
          agent: { kind: 'native' },
          transcripts: [],
          pending: [
            { id: 'completed', state: 'sent', prompt: 'Already answered' },
            { id: 'next', state: 'queued', prompt: 'Next question' },
          ],
        });
      expect(await router.handle({ method: 'GET', headers: {} } as any, {} as any, url)).toBe(true);
      return response!;
    }) as typeof fetch;
    process.env.DRONE_HUB_BASE_URL = 'http://hub.test';
    process.env.DRONE_TOKEN = 'test';
    let client: Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>> | undefined;
    try {
      client = await createInProcessDroneHubMcpClient({ correlationId: 'native-read' });
      const result = await client.callTool({
        name: 'read_chat',
        arguments: { drone: 'native-drone', limit: 1 },
      });
      expect(result.isError).not.toBe(true);
      const data = result.structuredContent as any;
      expect(data.historyKind).toBe('messages');
      expect(data.messages[1].text).toBe('The cobalt proposal reply was saved.');
      expect(data.pending.map((prompt: any) => prompt.id)).toEqual(['next']);
      expect(paths).toEqual([
        '/api/drones/native-drone/chats/default/state',
        '/api/drones/native-drone/chats/default/native/messages',
      ]);
      expect(
        await router.handle(
          { method: 'GET', headers: {} } as any,
          {} as any,
          new URL('http://hub.test/api/drones/missing/chats/default/native/messages'),
        ),
      ).toBe(true);
      expect(response!.status).toBe(404);
    } finally {
      await client?.close();
      globalThis.fetch = previousFetch;
      if (previousBaseUrl === undefined) delete process.env.DRONE_HUB_BASE_URL;
      else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
      if (previousToken === undefined) delete process.env.DRONE_TOKEN;
      else process.env.DRONE_TOKEN = previousToken;
    }
  });
});
