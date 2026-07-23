import { afterEach, describe, expect, test } from 'bun:test';

import { startMcpHttpStdioBridge } from '../src/mcp-http-stdio-bridge';

const originalUrl = process.env.DRONE_HUB_MCP_URL;
const originalToken = process.env.DRONE_HUB_MCP_TOKEN;

afterEach(() => {
  if (originalUrl == null) delete process.env.DRONE_HUB_MCP_URL;
  else process.env.DRONE_HUB_MCP_URL = originalUrl;
  if (originalToken == null) delete process.env.DRONE_HUB_MCP_TOKEN;
  else process.env.DRONE_HUB_MCP_TOKEN = originalToken;
});

describe('managed chat MCP bridge', () => {
  test('cannot start in a manually launched terminal without managed credentials', async () => {
    delete process.env.DRONE_HUB_MCP_URL;
    delete process.env.DRONE_HUB_MCP_TOKEN;

    await expect(startMcpHttpStdioBridge()).rejects.toThrow(
      'DRONE_HUB_MCP_URL is available only in Drone Hub managed chats',
    );
  });
});
