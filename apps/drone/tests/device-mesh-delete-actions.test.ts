import { afterEach, describe, expect, test } from 'bun:test';
import { createDroneControlCapability } from '../src/hub/device-mesh/drone-control-capability';
import { createAssistantThreadsCapability } from '../src/hub/device-mesh/features/cross-device-assistant/assistant-threads-capability';
import { CrossDeviceAssistantPolicyStore } from '../src/hub/device-mesh/features/cross-device-assistant/policy-store';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('device mesh delete actions', () => {
  test('forwards assistant approval decisions to the local Hub', async () => {
    let request: { url: string; method: string } | null = null;
    globalThis.fetch = (async (input, init) => {
      request = { url: String(input), method: String(init?.method ?? 'GET') };
      return new Response(
        JSON.stringify({
          activeThreadId: 'thread one',
          threads: [
            {
              id: 'thread one',
              title: 'Thread',
              status: 'running',
              autoApprove: false,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const capability = createAssistantThreadsCapability(
      { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
      new CrossDeviceAssistantPolicyStore('/tmp/drone-unused-assistant-policy.json'),
    );

    await expect(
      capability.invoke('approval.resolve', {
        threadId: 'thread one',
        approvalId: 'approval/one',
        approved: true,
      }),
    ).resolves.toMatchObject({ resolved: true, approved: true });
    expect(request).toEqual({
      url: 'http://127.0.0.1:7777/api/assistant/threads/thread%20one/approvals/approval%2Fone/approve',
      method: 'POST',
    });
  });

  test('forwards assistant thread deletion to the local Hub', async () => {
    let request: { url: string; method: string } | null = null;
    globalThis.fetch = (async (input, init) => {
      request = { url: String(input), method: String(init?.method ?? 'GET') };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const access = { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' };
    const capability = createAssistantThreadsCapability(
      access,
      new CrossDeviceAssistantPolicyStore('/tmp/drone-unused-assistant-policy.json'),
    );

    await expect(capability.invoke('thread.delete', { threadId: 'thread one' })).resolves.toEqual({
      deleted: true,
      threadId: 'thread one',
    });
    expect(request).toEqual({
      url: 'http://127.0.0.1:7777/api/assistant/threads/thread%20one',
      method: 'DELETE',
    });
  });

  test('forwards assistant message deletion modes to the local Hub', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({ url: String(input), method: String(init?.method ?? 'GET') });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const capability = createAssistantThreadsCapability(
      { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
      new CrossDeviceAssistantPolicyStore('/tmp/drone-unused-assistant-policy.json'),
    );

    await expect(
      capability.invoke('thread.message.delete', {
        threadId: 'thread one',
        messageId: 'message/one',
        deleteFollowing: true,
      }),
    ).resolves.toEqual({
      deleted: true,
      threadId: 'thread one',
      messageId: 'message/one',
      deleteFollowing: true,
    });
    expect(requests).toContainEqual({
      url: 'http://127.0.0.1:7777/api/assistant/threads/thread%20one/messages/message%2Fone?following=true',
      method: 'DELETE',
    });
  });

  test('returns assistant queue state and forwards queued prompt cancellation', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push({ url, method: String(init?.method ?? 'GET') });
      const snapshot = {
        threads: [
          {
            id: 'thread one',
            title: 'Review',
            status: 'running',
            promptDeliveryMode: 'queue',
            queuedPrompts: [
              {
                id: 'queued-2',
                prompt: 'Make a PR',
                createdAt: '2026-07-15T12:00:00.000Z',
                status: 'queued',
              },
            ],
          },
        ],
      };
      const body = url.endsWith('/history?limit=100') ? { entries: [] } : snapshot;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const access = { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' };
    const capability = createAssistantThreadsCapability(
      access,
      new CrossDeviceAssistantPolicyStore('/tmp/drone-unused-assistant-policy.json'),
    );

    await expect(
      capability.invoke('thread.get', { threadId: 'thread one' }),
    ).resolves.toMatchObject({
      thread: {
        promptDeliveryMode: 'queue',
        queuedPrompts: [{ id: 'queued-2', prompt: 'Make a PR', status: 'queued' }],
      },
    });
    await expect(
      capability.invoke('thread.stop', {
        threadId: 'thread one',
        promptId: 'queued-2',
      }),
    ).resolves.toMatchObject({ cancelled: true });
    expect(requests).toContainEqual({
      url: 'http://127.0.0.1:7777/api/assistant/threads/thread%20one/queued/queued-2',
      method: 'DELETE',
    });
  });

  test('waits for the Hub prompt acknowledgement and returns the cancellable queue id', async () => {
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/prompt') && init?.method === 'POST') {
        return new Response(
          `${JSON.stringify({
            type: 'queued',
            threadId: 'thread one',
            prompt: {
              id: 'queued-real-id',
              prompt: 'Make a PR',
              createdAt: '2026-07-15T12:00:00.000Z',
              status: 'queued',
            },
          })}\n${JSON.stringify({ type: 'done' })}\n`,
          { status: 200, headers: { 'content-type': 'application/x-ndjson' } },
        );
      }
      return new Response(
        JSON.stringify({ threads: [{ id: 'thread one', title: 'Review', status: 'running' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const capability = createAssistantThreadsCapability(
      { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
      new CrossDeviceAssistantPolicyStore('/tmp/drone-unused-assistant-policy.json'),
    );

    await expect(
      capability.invoke('thread.prompt', { threadId: 'thread one', prompt: 'Make a PR' }),
    ).resolves.toMatchObject({
      accepted: true,
      queuedPrompt: { id: 'queued-real-id', prompt: 'Make a PR', status: 'queued' },
    });
  });

  test('surfaces an Assistant prompt rejection instead of reporting false acceptance', async () => {
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/prompt') && init?.method === 'POST') {
        return new Response(`${JSON.stringify({ type: 'error', error: 'queue is full' })}\n`, {
          status: 200,
          headers: { 'content-type': 'application/x-ndjson' },
        });
      }
      return new Response(
        JSON.stringify({ threads: [{ id: 'thread one', title: 'Review', status: 'running' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const capability = createAssistantThreadsCapability(
      { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
      new CrossDeviceAssistantPolicyStore('/tmp/drone-unused-assistant-policy.json'),
    );

    await expect(
      capability.invoke('thread.prompt', { threadId: 'thread one', prompt: 'Make a PR' }),
    ).rejects.toThrow('queue is full');
  });

  test('bounds queue, streaming, and history together under the mesh result limit', async () => {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      const body = url.endsWith('/history?limit=100')
        ? {
            threadId: 'thread one',
            entries: Array.from({ length: 60 }, (_, index) => ({
              id: `message-${index}`,
              message: { role: 'assistant', content: 'history'.repeat(4_000) },
            })),
          }
        : {
            threads: [
              {
                id: 'thread one',
                title: 'Review',
                status: 'running',
                queuedPrompts: Array.from({ length: 32 }, (_, index) => ({
                  id: `queued-${index}`,
                  prompt: '🚁'.repeat(10_000),
                  createdAt: '2026-07-15T12:00:00.000Z',
                  status: 'queued',
                  error: '🔥'.repeat(10_000),
                })),
              },
            ],
            streamingMessages: Array.from({ length: 2 }, () => ({
              role: 'assistant',
              content: Array.from({ length: 12 }, () => ({
                type: 'text',
                text: '🌊'.repeat(10_000),
                arguments: { payload: 'argument'.repeat(10_000) },
              })),
            })),
          };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const capability = createAssistantThreadsCapability(
      { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
      new CrossDeviceAssistantPolicyStore('/tmp/drone-unused-assistant-policy.json'),
    );

    const result = await capability.invoke('thread.get', { threadId: 'thread one' });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(220 * 1024);
    expect(result.thread.queuedPrompts).toHaveLength(32);
  });

  test('forwards drone deletion to the local Hub', async () => {
    let request: { url: string; method: string } | null = null;
    globalThis.fetch = (async (input, init) => {
      request = { url: String(input), method: String(init?.method ?? 'GET') };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const capability = createDroneControlCapability({
      baseUrl: () => 'http://127.0.0.1:7777',
      apiToken: 'test',
    });

    await expect(capability.invoke('drone.delete', { droneId: 'drone one' })).resolves.toEqual({
      deleted: true,
      droneId: 'drone one',
    });
    expect(request).toEqual({
      url: 'http://127.0.0.1:7777/api/drones/drone%20one',
      method: 'DELETE',
    });
  });

  test('creates a cloned drone chat through the local Hub', async () => {
    let request: { url: string; method: string; body: string } | null = null;
    globalThis.fetch = (async (input, init) => {
      request = {
        url: String(input),
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      };
      return new Response(JSON.stringify({ chat: 'chat-2', chats: ['default', 'chat-2'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const capability = createDroneControlCapability({
      baseUrl: () => 'http://127.0.0.1:7777',
      apiToken: 'test',
    });

    await expect(
      capability.invoke('chat.create', {
        droneId: 'drone one',
        name: 'chat-2',
        copyFrom: 'default',
      }),
    ).resolves.toEqual({
      droneId: 'drone one',
      chatName: 'chat-2',
      chats: ['default', 'chat-2'],
    });
    expect(request).toEqual({
      url: 'http://127.0.0.1:7777/api/drones/drone%20one/chats',
      method: 'POST',
      body: JSON.stringify({ name: 'chat-2', copyFrom: 'default' }),
    });
  });
});
