import type { McpServerRecord } from './mcp-servers';

const MANAGED_CHAT_MCP_ENV_VARS = ['DRONE_HUB_MCP_URL', 'DRONE_HUB_MCP_TOKEN'];

export function isDroneHubMcpServer(server: McpServerRecord): boolean {
  return server.name === 'drone-hub' && server.transport === 'http';
}

export function projectMcpServerForManagedChats(input: {
  server: McpServerRecord;
  runtime: 'host' | 'container';
  hostBridgePath: string;
}): McpServerRecord {
  if (!isDroneHubMcpServer(input.server) || input.server.enabled === false) {
    return input.server;
  }
  const { url: _url, headers: _headers, ...server } = input.server;
  return {
    ...server,
    transport: 'stdio',
    command: 'node',
    args: [
      input.runtime === 'container'
        ? '/dvm-data/drone/dist/mcp-http-stdio-bridge.js'
        : input.hostBridgePath,
    ],
    envPassthrough: MANAGED_CHAT_MCP_ENV_VARS,
  };
}
