import { describe, expect, test } from 'bun:test';

import { projectMcpServerForManagedChats } from '../src/hub/mcp-managed-chat-projection';

const droneHubServer = {
  id: 'drone-hub',
  name: 'drone-hub',
  description: '',
  enabled: true,
  transport: 'http' as const,
  url: 'http://127.0.0.1:7777/mcp',
  headers: { Authorization: 'Bearer must-not-be-projected' },
  agents: ['codex' as const],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('managed chat MCP projection', () => {
  test('projects a credential-free bridge into container agent configs', () => {
    const projected = projectMcpServerForManagedChats({
      server: droneHubServer,
      runtime: 'container',
      hostBridgePath: '/opt/drone/mcp-http-stdio-bridge.js',
    });
    expect(projected).toMatchObject({
      transport: 'stdio',
      command: 'node',
      args: ['/dvm-data/drone/dist/mcp-http-stdio-bridge.js'],
    });
    expect(projected.url).toBeUndefined();
    expect(projected.headers).toBeUndefined();
  });

  test('projects the same credential-free bridge model into host agent configs', () => {
    const projected = projectMcpServerForManagedChats({
      server: droneHubServer,
      runtime: 'host',
      hostBridgePath: '/opt/drone/mcp-http-stdio-bridge.js',
    });
    expect(projected).toMatchObject({
      transport: 'stdio',
      command: 'node',
      args: ['/opt/drone/mcp-http-stdio-bridge.js'],
    });
    expect(projected.url).toBeUndefined();
    expect(projected.headers).toBeUndefined();
  });
});
