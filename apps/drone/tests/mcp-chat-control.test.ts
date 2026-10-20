import { describe, expect, test } from 'bun:test';

import { createInProcessDroneHubMcpClient } from '../src/hub/assistant/in-process-drone-hub-mcp';
import { nativeApprovalMessage } from '../src/hub/assistant-runtime';
import { normalizeMcpChatAccessScope } from '../src/hub/mcp-chat-access';
import { withTempDroneDataDir } from './test-helpers';

const lead = { kind: 'chat', chatId: 'chat-lead', droneId: 'drone-1', chatName: 'lead' };
const leadPrincipal = {
  kind: 'chat' as const,
  tokenId: 'chat:drone-1:lead',
  name: 'Drone one / lead',
  droneId: 'drone-1',
  chatName: 'lead',
  chatId: 'chat-lead',
  accessScope: normalizeMcpChatAccessScope({}, 'drone-1'),
  selectedDroneRefs: ['drone-1'],
};

type HubRequest = { method: string; path: string; search: string; body: any };
type HubHandler = (request: HubRequest) => Response | undefined;

async function withChatClient(
  handler: HubHandler,
  run: (
    call: (name: string, args: Record<string, unknown>) => Promise<any>,
    requests: HubRequest[],
  ) => Promise<void>,
) {
  await withTempDroneDataDir('drone-mcp-chat-control-', async () => {
    const previousFetch = globalThis.fetch;
    const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
    const previousToken = process.env.DRONE_TOKEN;
    const requests: HubRequest[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
      const request = {
        method: String(init?.method ?? 'GET').toUpperCase(),
        path: url.pathname,
        search: url.search,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      requests.push(request);
      if (request.path === '/api/drones/summary') {
        return Response.json({ ok: true, drones: [{ id: 'drone-1', name: 'Drone one', runtime: 'container' }] });
      }
      return (
        handler(request) ??
        Response.json({ ok: false, error: `unexpected ${request.method} ${request.path}` }, { status: 500 })
      );
    }) as typeof fetch;
    process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
    process.env.DRONE_TOKEN = 'chat-control-test-token';
    const client = await createInProcessDroneHubMcpClient({
      correlationId: 'chat-control',
      principal: leadPrincipal,
      allowedDroneRefs: [],
      allowedWriteDroneRefs: [],
      allowedDroneIds: [],
    });
    try {
      await run(async (name, args) => {
        const result = await client.callTool({ name, arguments: args });
        if (result.isError) throw new Error(JSON.stringify(result.content));
        return result.structuredContent;
      }, requests);
    } finally {
      await client.close();
      globalThis.fetch = previousFetch;
      if (previousBaseUrl == null) delete process.env.DRONE_HUB_BASE_URL;
      else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
      if (previousToken == null) delete process.env.DRONE_TOKEN;
      else process.env.DRONE_TOKEN = previousToken;
    }
  });
}

describe('chat-to-chat message control', () => {
  test('send_message records the sending chat and returns a messageId', async () => {
    await withChatClient(
      ({ method, path }) =>
        method === 'POST' && path === '/api/drones/drone-1/chats/worker/prompt'
          ? Response.json({ ok: true, id: 'drone-1', promptId: 'msg-1', pendingState: 'queued' })
          : undefined,
      async (call, requests) => {
        const sent = await call('send_message', { drone: 'drone-1', chat: 'worker', message: 'Phase 1' });
        expect(sent).toMatchObject({ messageId: 'msg-1', status: 'queued' });
        expect(sent.runId).toBeUndefined();
        expect(requests.at(-1)?.body).toMatchObject({ sentBy: lead, submissionSource: 'assistant-tool' });
      },
    );
  });

  test('send_message warns when the message could not be linked to the sending chat', async () => {
    await withChatClient(
      ({ method, path }) =>
        method === 'POST' && path === '/api/drones/drone-1/chats/worker/prompt'
          ? Response.json({ ok: true, promptId: 'msg-2', pendingState: 'queued', senderRecorded: false })
          : undefined,
      async (call) => {
        const sent = await call('send_message', { drone: 'drone-1', chat: 'worker', message: 'Early' });
        expect(sent).toMatchObject({ messageId: 'msg-2', senderRecorded: false });
        expect(sent.warning).toContain('not linked to your chat');
      },
    );
  });

  test('cancel_messages reports each outcome and only asks for messages this chat sent', async () => {
    await withChatClient(
      ({ method, path }) => {
        if (method !== 'DELETE') return undefined;
        const id = path.split('/').at(-1);
        if (id === 'waiting') return Response.json({ ok: true, cancelled: true, alreadySubmitted: false });
        if (id === 'started') {
          return Response.json({ ok: true, cancelled: false, alreadySubmitted: true, pendingState: 'sent' });
        }
        if (id === 'theirs') return Response.json({ ok: false, error: 'not yours' }, { status: 403 });
        if (id === 'bundled') return Response.json({ ok: true, cancelled: false, alreadySubmitted: false, pendingState: 'queued' });
        return Response.json({ ok: false, error: 'unknown' }, { status: 404 });
      },
      async (call, requests) => {
        const result = await call('cancel_messages', {
          drone: 'drone-1',
          chat: 'worker',
          messageIds: ['waiting', 'started', 'theirs', 'bundled', 'gone', 'waiting'],
        });
        expect(result.results).toEqual([
          { messageId: 'waiting', outcome: 'cancelled' },
          { messageId: 'started', outcome: 'too_late', phase: 'delivered_or_running' },
          { messageId: 'theirs', outcome: 'not_yours' },
          { messageId: 'bundled', outcome: 'unsupported' },
          { messageId: 'gone', outcome: 'not_found' },
        ]);
        expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(5);
        expect(requests.every((request) => request.method !== 'DELETE' || request.search === '?sentByChatId=chat-lead')).toBe(true);
      },
    );
  });

  test('edit_message maps the edit outcome, including a message that already started', async () => {
    let state: 'waiting' | 'started' | 'failed' = 'waiting';
    await withChatClient(
      ({ method, path, body }) => {
        if (method !== 'PATCH' || path !== '/api/drones/drone-1/chats/worker/pending/phase-2') return undefined;
        expect(body).toEqual({ text: 'Also cover the docs.', mode: 'append', requireSentByChatId: 'chat-lead' });
        return state === 'waiting'
          ? Response.json({ ok: true, status: 'edited', state: 'queued', prompt: 'Phase 2\n\nAlso cover the docs.' })
          : Response.json(
              { ok: false, status: 'too-late', state: state === 'failed' ? 'failed' : 'sending' },
              { status: 409 },
            );
      },
      async (call) => {
        const args = { drone: 'drone-1', chat: 'worker', messageId: 'phase-2', text: 'Also cover the docs.', mode: 'append' };
        expect(await call('edit_message', args)).toMatchObject({
          outcome: 'edited',
          text: 'Phase 2\n\nAlso cover the docs.',
        });
        state = 'started';
        expect(await call('edit_message', args)).toMatchObject({ outcome: 'too_late', phase: 'delivering' });
        state = 'failed';
        expect(await call('edit_message', args)).toMatchObject({ outcome: 'failed' });
      },
    );
  });

  test('stop_chat sends the creator check and refuses chats this chat did not create', async () => {
    await withChatClient(
      ({ method, path, body }) => {
        if (method !== 'POST' || !path.endsWith('/stop')) return undefined;
        expect(body).toEqual({ requireCreatedByChatId: 'chat-lead' });
        return path.includes('/chats/mine/')
          ? Response.json({ ok: true, stopped: true, stoppedPromptIds: ['run-1'], clearedPromptIds: ['next-1'] })
          : Response.json({ ok: false, error: 'not creator' }, { status: 403 });
      },
      async (call) => {
        expect(await call('stop_chat', { drone: 'drone-1', chat: 'mine' })).toMatchObject({
          stopped: true,
          stoppedMessageIds: ['run-1'],
          clearedMessageIds: ['next-1'],
        });
        await expect(call('stop_chat', { drone: 'drone-1', chat: 'users-chat' })).rejects.toThrow(
          'was not created by this chat',
        );
      },
    );
  });

  test('answer_questions submits a written reply attributed to this chat', async () => {
    const request = {
      id: 'questions_1',
      chatId: 'chat-worker',
      status: 'pending',
      questions: [
        { id: 'scope', question: 'Which scope?', choices: [] },
        { id: 'tests', question: 'Add tests?', choices: [] },
      ],
    };
    await withChatClient(
      ({ method, path, search, body }) => {
        if (method === 'GET' && path === '/api/chat-question-requests/questions_1') {
          expect(search).toBe('?droneId=drone-1&chatName=worker');
          return Response.json({ ok: true, request });
        }
        if (method === 'POST' && path === '/api/chat-question-requests/questions_1/submit') {
          return Response.json({ ok: true, result: { status: 'submitted', requestId: 'questions_1', ...body } });
        }
        return undefined;
      },
      async (call, requests) => {
        const answered = await call('answer_questions', {
          drone: 'drone-1',
          chat: 'worker',
          requestId: 'questions_1',
          response: 'Keep it small; the user wants a quick fix.',
          answers: [{ questionId: 'tests', answer: 'Yes, unit tests only.' }],
        });
        expect(answered.outcome).toBe('answered');
        expect(requests.at(-1)?.body).toEqual({
          responses: [
            { questionId: 'scope', outcome: 'skipped' },
            { questionId: 'tests', outcome: 'custom', text: 'Yes, unit tests only.' },
          ],
          notes: 'Keep it small; the user wants a quick fix.',
          respondedBy: lead,
        });
        await expect(
          call('answer_questions', { drone: 'drone-1', chat: 'worker', requestId: 'questions_1', answers: [{ questionId: 'nope', answer: 'x' }] }),
        ).rejects.toThrow('unknown question ids: nope');
      },
    );
  });

  test('answer_questions reports when the user answered first', async () => {
    const result = { status: 'submitted', requestId: 'questions_1', responses: [] };
    await withChatClient(
      ({ method, path }) =>
        method === 'GET' && path === '/api/chat-question-requests/questions_1'
          ? Response.json({ ok: true, request: { id: 'questions_1', chatId: 'chat-worker', status: 'submitted', result, questions: [] } })
          : undefined,
      async (call, requests) => {
        expect(
          await call('answer_questions', { drone: 'drone-1', chat: 'worker', requestId: 'questions_1', response: 'Go.' }),
        ).toMatchObject({ outcome: 'already_resolved', result });
        expect(requests.some((request) => request.path.endsWith('/submit'))).toBe(false);
      },
    );
  });

  test('read_chat marks the caller\'s own waiting messages and passes open questions through', async () => {
    const pendingQuestions = [{ requestId: 'questions_1', createdAt: '2026-10-14T10:00:00.000Z', questions: [] }];
    await withChatClient(
      ({ method, path }) =>
        method === 'GET' && path === '/api/drones/drone-1/chats/worker/messages'
          ? Response.json({
              ok: true,
              status: 'working',
              messages: [],
              pendingQuestions,
              pending: [
                { id: 'mine-waiting', phase: 'waiting', sentBy: lead },
                { id: 'mine-running', phase: 'running', sentBy: lead },
                { id: 'users', phase: 'waiting' },
              ],
            })
          : undefined,
      async (call, requests) => {
        const read = await call('read_chat', { drone: 'drone-1', chat: 'worker' });
        expect(read.pending.map(({ id, sentByYou, editable }: any) => ({ id, sentByYou, editable }))).toEqual([
          { id: 'mine-waiting', sentByYou: true, editable: true },
          { id: 'mine-running', sentByYou: true, editable: false },
          { id: 'users', sentByYou: false, editable: false },
        ]);
        expect(read.pendingQuestions).toEqual(pendingQuestions);
        expect(requests.map((request) => request.path)).toEqual(['/api/drones/drone-1/chats/worker/messages']);
      },
    );
  });
});

describe('native chat approval text', () => {
  test('shows the exact text an edit or answer would deliver', () => {
    expect(nativeApprovalMessage('edit_message', { messageId: 'm1', text: 'More detail', mode: 'append' })).toBe(
      'Append to queued message m1:\nMore detail',
    );
    expect(nativeApprovalMessage('edit_message', { messageId: 'm1', text: 'New text' })).toBe(
      'Replace queued message m1 with:\nNew text',
    );
    expect(
      nativeApprovalMessage('answer_questions', {
        requestId: 'q1',
        response: 'Go small.',
        answers: [{ questionId: 'tests', answer: 'Unit only' }],
      }),
    ).toBe('Answer questions q1:\nGo small.\ntests: Unit only');
  });
});
