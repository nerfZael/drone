import { expect, test } from 'bun:test';
import { createDroneControlCapability } from '../src/hub/device-mesh/drone-control-capability';

test('workspace reads and saves are bound to the owning native chat', async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: URL; body: any }> = [];
  const capability = createDroneControlCapability({
    baseUrl: () => 'http://localhost:7777',
    apiToken: 'test',
  });
  globalThis.fetch = (async (input: any, init: any) => {
    const url = new URL(String(input));
    requests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.pathname.endsWith('/native')) return Response.json({ nativeChatId: 'owned-thread' });
    return Response.json({ revision: 'revision', access: { targets: [], defaultTargetId: null } });
  }) as typeof fetch;
  try {
    const context = {
      sourceDevice: {
        id: 'phone',
        grants: [{ capability: 'drone-control', version: 1, operations: ['*'] }],
      },
      signal: new AbortController().signal,
    } as any;
    await capability.invoke(
      'chat.read',
      {
        droneId: 'owner',
        nativeChatId: 'owned-thread',
        workspaceAccess: true,
        workspaceDeviceId: 'server',
      },
      context,
    );
    expect(requests.at(-1)?.url.pathname).toBe('/api/assistant/threads/owned-thread/workspaces');
    expect(requests.at(-1)?.url.searchParams.get('deviceId')).toBe('server');
    const beforeDenied = requests.length;
    await expect(
      capability.invoke('chat.read', { droneId: 'owner', workspaceAccess: true }, {
        ...context,
        sourceDevice: { id: 'restricted-phone', grants: [] },
      } as any),
    ).rejects.toThrow('Drone listing permission');
    expect(requests.length).toBe(beforeDenied);
    const access = { targets: [], defaultTargetId: null };
    await capability.invoke(
      'chat.update',
      {
        droneId: 'owner',
        nativeChatId: 'owned-thread',
        workspaceAccess: access,
        workspaceRevision: 'revision',
      },
      context,
    );
    expect(requests.at(-1)?.body).toEqual({ access, revision: 'revision' });
    const count = requests.length;
    await expect(
      capability.invoke(
        'chat.update',
        { droneId: 'owner', nativeChatId: 'someone-else', workspaceAccess: access },
        context,
      ),
    ).rejects.toThrow('does not belong');
    expect(requests.length).toBe(count + 1);
    expect(requests.at(-1)?.url.pathname).toBe('/api/drones/owner/chats/default/native');
  } finally {
    globalThis.fetch = previousFetch;
    capability.close?.();
  }
});
