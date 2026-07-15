import { afterEach, describe, expect, test } from 'bun:test';
import { createDroneControlCapability } from '../src/hub/device-mesh/drone-control-capability';
import { createAssistantThreadsCapability } from '../src/hub/device-mesh/features/cross-device-assistant/assistant-threads-capability';
import { CrossDeviceAssistantPolicyStore } from '../src/hub/device-mesh/features/cross-device-assistant/policy-store';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('device mesh delete actions', () => {
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

    await expect(
      capability.invoke('thread.delete', { threadId: 'thread one' }),
    ).resolves.toEqual({ deleted: true, threadId: 'thread one' });
    expect(request).toEqual({
      url: 'http://127.0.0.1:7777/api/assistant/threads/thread%20one',
      method: 'DELETE',
    });
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
