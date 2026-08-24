import { describe, expect, test } from 'bun:test';

import { listMcpServerToolsFromClient } from '../src/hub/mcp-server-tools';

describe('MCP server tool discovery', () => {
  test('lists every advertised page with names and descriptions', async () => {
    const cursors: Array<string | undefined> = [];
    const client = {
      async listTools(params?: { cursor?: string }) {
        cursors.push(params?.cursor);
        return params?.cursor
          ? {
              tools: [
                {
                  name: 'alpha_tool',
                  title: 'Alpha tool',
                  description: 'The second advertised tool.',
                  inputSchema: { type: 'object' as const },
                },
              ],
            }
          : {
              tools: [
                {
                  name: 'zeta_tool',
                  description: 'The first advertised tool.',
                  inputSchema: { type: 'object' as const },
                },
              ],
              nextCursor: 'page-2',
            };
      },
    };
    const tools = await listMcpServerToolsFromClient(client as any, 'tool-test');

    expect(cursors).toEqual([undefined, 'page-2']);
    expect(tools).toEqual([
      {
        name: 'alpha_tool',
        title: 'Alpha tool',
        description: 'The second advertised tool.',
      },
      {
        name: 'zeta_tool',
        description: 'The first advertised tool.',
      },
    ]);
  });
});
