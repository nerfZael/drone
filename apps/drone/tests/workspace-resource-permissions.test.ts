import { expect, test } from 'bun:test';
import { createInProcessDroneHubMcpClient } from '../src/hub/assistant/in-process-drone-hub-mcp';
import { withTempDroneDataDir } from './test-helpers';

test('resource subscriptions cannot read a workspace granted only write access', async () => {
  await withTempDroneDataDir('workspace-subscriptions-', async () => {
    const previousFetch = globalThis.fetch;
    const previousUrl = process.env.DRONE_HUB_BASE_URL;
    const previousToken = process.env.DRONE_TOKEN;
    let writes = 0;
    globalThis.fetch = (async (input) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input : input.url,
      );
      if (url.pathname === '/api/resource-subscriptions/chat-resource/target-chat')
        return Response.json({ resource: { droneId: 'write-only' } });
      if (url.pathname === '/api/change-requests/123')
        return Response.json({ request: { droneId: 'write-only' } });
      writes++;
      return Response.json({ ok: true, created: true });
    }) as typeof fetch;
    process.env.DRONE_HUB_BASE_URL = 'http://hub.test';
    process.env.DRONE_TOKEN = 'test';
    let client: Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>> | undefined;
    try {
      client = await createInProcessDroneHubMcpClient({
        correlationId: 'workspace-permissions',
        allowedDroneRefs: [],
        allowedWriteDroneRefs: ['write-only'],
        allowedDroneIds: [],
        workspaceDroneRefs: { read: [], write: ['write-only'], execute: [] },
        principal: {
          kind: 'chat',
          tokenId: 'token',
          name: 'Chat',
          droneId: 'owner',
          chatName: 'default',
          chatId: 'subscriber',
          accessScope: {
            readMode: 'selected',
            writeMode: 'selected',
            executeMode: 'selected',
            droneIds: ['write-only'],
            updatedAt: '2026-01-01',
          },
          selectedDroneRefs: ['write-only'],
        },
      });
      for (const resource of [
        { resourceType: 'chat', resourceId: 'target-chat', events: ['chat.idle'] },
        { resourceType: 'change_request', resourceId: '123', events: ['change_request.updated'] },
      ]) {
        const result = await client.callTool({
          name: 'subscribe_to_resource_events',
          arguments: { provider: 'drone-hub', ...resource },
        });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain('not authorized');
      }
      expect(writes).toBe(0);
    } finally {
      await client?.close();
      globalThis.fetch = previousFetch;
      if (previousUrl === undefined) delete process.env.DRONE_HUB_BASE_URL;
      else process.env.DRONE_HUB_BASE_URL = previousUrl;
      if (previousToken === undefined) delete process.env.DRONE_TOKEN;
      else process.env.DRONE_TOKEN = previousToken;
    }
  });
});
