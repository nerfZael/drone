import { describe, expect, test } from 'bun:test';
import {
  fetchDroneChatState,
  fetchDroneChatStateCached,
  fetchDroneChatTranscript,
  sameTranscriptItem,
  sendDroneChatPrompt,
} from '../src/droneHub/app/chat-api';
import type { TranscriptItem } from '../src/droneHub/types';

function transcriptItem(overrides: Partial<TranscriptItem> = {}): TranscriptItem {
  return {
    turn: 1,
    at: '2026-06-16T18:34:44.000Z',
    id: 'turn-1',
    prompt: 'run task',
    session: 'default',
    logPath: '',
    ok: true,
    output: 'done',
    ...overrides,
  };
}

describe('chat api transcript equality', () => {
  test('detects docker snapshot status changes', () => {
    const creating = transcriptItem({
      dockerSnapshot: {
        id: 'snapshot-1',
        status: 'creating',
        createdAt: '2026-06-16T18:34:44.000Z',
      },
    });
    const ready = transcriptItem({
      dockerSnapshot: {
        id: 'snapshot-1',
        status: 'ready',
        createdAt: '2026-06-16T18:34:44.000Z',
        readyAt: '2026-06-16T18:34:53.000Z',
        sizeBytes: 7392574357,
      },
    });

    expect(sameTranscriptItem(creating, ready)).toBe(false);
  });

  test('detects agent plan progress changes', () => {
    const pending = transcriptItem({
      agentPlan: {
        source: 'codex',
        updatedAt: '2026-06-16T18:34:45.000Z',
        items: [{ text: 'Run tests', status: 'pending' }],
      },
    });
    const completed = transcriptItem({
      agentPlan: {
        source: 'codex',
        updatedAt: '2026-06-16T18:34:46.000Z',
        items: [{ text: 'Run tests', status: 'completed' }],
      },
    });

    expect(sameTranscriptItem(pending, completed)).toBe(false);
  });

  test('does not treat an agent plan timestamp refresh as a transcript change', () => {
    const before = transcriptItem({
      agentPlan: {
        source: 'codex',
        updatedAt: '2026-06-16T18:34:45.000Z',
        items: [{ text: 'Run tests', status: 'in_progress' }],
      },
    });
    const after = transcriptItem({
      agentPlan: {
        ...before.agentPlan!,
        updatedAt: '2026-06-16T18:34:46.000Z',
      },
    });

    expect(sameTranscriptItem(before, after)).toBe(true);
  });

  test('detects a finalized changed-files summary', () => {
    const before = transcriptItem();
    const after = transcriptItem({
      fileChanges: {
        version: 1,
        capturedAt: '2026-07-21T00:00:00.000Z',
        counts: { changed: 1, additions: 1, deletions: 0 },
        workspaces: [],
      },
    });

    expect(sameTranscriptItem(before, after)).toBe(false);
  });

  test('detects an execution start correction', () => {
    const before = transcriptItem({ promptAt: '2026-06-16T18:30:00.000Z' });
    const after = transcriptItem({
      promptAt: '2026-06-16T18:30:00.000Z',
      startedAt: '2026-06-16T18:34:00.000Z',
    });

    expect(sameTranscriptItem(before, after)).toBe(false);
  });

  test('detects steering presentation metadata', () => {
    const before = transcriptItem({ userOnly: true });
    const after = transcriptItem({ userOnly: true, deliveryMode: 'asap' });

    expect(sameTranscriptItem(before, after)).toBe(false);
  });
});

describe('chat api request scopes', () => {
  test('marks prompt submissions whose auto-rename will be handled by the client', async () => {
    let body: any = null;
    await sendDroneChatPrompt(
      async <T>(_url: string, init?: RequestInit): Promise<T> => {
        body = JSON.parse(String(init?.body ?? '{}'));
        return { ok: true, accepted: true, promptId: 'prompt-1' } as T;
      },
      {
        droneId: 'drone-1',
        chatName: 'chat-2',
        prompt: 'Fix login',
        promptId: 'optimistic-prompt-1',
        submittedAt: '2026-07-24T12:34:56.000Z',
        deliveryMode: 'asap',
        autoRenameHandledByClient: true,
      },
    );

    expect(body.promptId).toBe('optimistic-prompt-1');
    expect(body.submittedAt).toBe('2026-07-24T12:34:56.000Z');
    expect(body.userTimeZone).toBe(
      new Intl.DateTimeFormat('en-US').resolvedOptions().timeZone,
    );
    expect(body.autoRenameHandledByClient).toBe(true);
    expect(body.deliveryMode).toBe('asap');
  });

  test('loads the initial transcript tail and pending prompts in one request', async () => {
    const urls: string[] = [];
    const result = await fetchDroneChatState(
      async <T>(url: string): Promise<T> => {
        urls.push(url);
        return {
          ok: true,
          chatId: 'chat-1',
          transcripts: [transcriptItem()],
          pending: [{ id: 'pending-1' }],
          subscriptions: [
            {
              id: 'subscription-1',
              provider: 'github',
              resourceType: 'repository',
              resourceId: 'acme/widgets',
              events: ['pull_request.opened'],
              status: 'active',
            },
          ],
        } as T;
      },
      { droneId: 'drone one', chatName: 'default', turn: 'all', tail: 50 },
    );

    expect(urls).toEqual([
      '/api/drones/drone%20one/chats/default/state?turn=all&tail=50&transcript=tail&subscriptions=true&transcriptMeta=0',
    ]);
    expect(result.transcripts).toHaveLength(1);
    expect(result.pending).toHaveLength(1);
    expect(result.chatId).toBe('chat-1');
    expect(result.subscriptions).toHaveLength(1);
    expect(result.transcriptTotal).toBeNull();
  });

  test('requests transcript totals when a group column needs an initial tail boundary', async () => {
    const urls: string[] = [];
    const result = await fetchDroneChatState(
      async <T>(url: string): Promise<T> => {
        urls.push(url);
        return {
          ok: true,
          transcripts: [transcriptItem()],
          pending: [],
          transcript: { total: 81 },
        } as T;
      },
      {
        droneId: 'drone-1',
        chatName: 'default',
        tail: 50,
        includeTranscriptMeta: true,
      },
    );

    expect(urls[0]).toContain('transcriptMeta=1');
    expect(result.transcriptTotal).toBe(81);
  });

  test('requests full transcript without pending prompts for explicit export', async () => {
    const urls: string[] = [];
    await fetchDroneChatTranscript(
      async <T>(url: string): Promise<T> => {
        urls.push(url);
        return { ok: true, transcripts: [] } as T;
      },
      { droneId: 'drone-1', chatName: 'chat one', turn: 'all' },
    );

    expect(urls).toEqual([
      '/api/drones/drone-1/chats/chat%20one/state?turn=all&transcript=selected&pending=none&transcriptMeta=0',
    ]);
  });

  test('conditionally refreshes transcript state without volatile subscription data', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; etag: string | null }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({ url: String(input), etag: headers.get('if-none-match') });
      if (requests.length === 1) {
        return new Response(
          JSON.stringify({ ok: true, transcripts: [transcriptItem()], pending: [] }),
          { status: 200, headers: { 'content-type': 'application/json', etag: '"state-1"' } },
        );
      }
      return new Response(null, { status: 304 });
    }) as typeof fetch;

    try {
      const first = await fetchDroneChatStateCached({
        droneId: 'drone one',
        chatName: 'default',
        tail: 50,
      });
      expect(first.notModified).toBe(false);
      expect(first.etag).toBe('"state-1"');

      const second = await fetchDroneChatStateCached({
        droneId: 'drone one',
        chatName: 'default',
        tail: 50,
        etag: first.etag,
      });
      expect(second).toEqual({ etag: '"state-1"', notModified: true });
      expect(requests).toEqual([
        {
          url: '/api/drones/drone%20one/chats/default/state?turn=all&tail=50&transcript=tail&subscriptions=false&readState=false&transcriptMeta=0',
          etag: null,
        },
        {
          url: '/api/drones/drone%20one/chats/default/state?turn=all&tail=50&transcript=tail&subscriptions=false&readState=false&transcriptMeta=0',
          etag: '"state-1"',
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('reuses configuration included in the initial cached state response', async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          ok: true,
          id: 'drone-1',
          name: 'Drone one',
          chat: 'default',
          chatId: 'chat-1',
          transcripts: [],
          pending: [],
          subscriptions: [],
          agent: { kind: 'builtin', id: 'codex' },
          agentLocked: true,
          model: 'gpt-5',
          reasoning: 'high',
          agentPermissionMode: 'write',
          approvalPolicy: 'ask',
          dockerSnapshotAfterAgentMessageEnabled: true,
          sessionName: 'drone-hub-chat-default',
          createdAt: '2026-09-03T10:00:00.000Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json', etag: '"state-1"' } },
      );
    }) as typeof fetch;

    try {
      const result = await fetchDroneChatStateCached({
        droneId: 'drone-1',
        chatName: 'default',
        includeConfig: true,
      });

      expect(requestedUrl).toContain('subscriptions=true');
      expect(requestedUrl).toContain('config=true');
      expect(requestedUrl).not.toContain('turns=0');
      expect(result.notModified).toBe(false);
      if (!result.notModified) {
        expect(result.chatInfo).toMatchObject({
          name: 'Drone one',
          chat: 'default',
          chatId: 'chat-1',
          agent: { kind: 'builtin', id: 'codex' },
          agentLocked: true,
          model: 'gpt-5',
          reasoning: 'high',
          dockerSnapshotAfterAgentMessageEnabled: true,
        });
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
