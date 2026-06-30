const { afterEach, describe, expect, test } = require('bun:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadMcpServer, mcpRequestMeta } = require('./mcp-client-manager.cjs');

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsn-mcp-test-'));
  tempDirs.push(dir);
  return dir;
}

function writeFakeMcpServer(dir) {
  const serverPath = path.join(dir, 'fake-mcp-server.cjs');
  const mcpServerModule = require.resolve('@modelcontextprotocol/sdk/server/mcp.js');
  const stdioServerModule = require.resolve('@modelcontextprotocol/sdk/server/stdio.js');
  const zodModule = require.resolve('zod');
  fs.writeFileSync(serverPath, `
const { McpServer } = require(${JSON.stringify(mcpServerModule)});
const { StdioServerTransport } = require(${JSON.stringify(stdioServerModule)});
const { z } = require(${JSON.stringify(zodModule)});

const server = new McpServer({ name: 'Fake MCP', version: '1.0.0' }, { capabilities: { logging: {} } });

server.registerTool('echo-value', {
  title: 'Echo value',
  description: 'Echo a value and selected request metadata.',
  inputSchema: {
    value: z.string(),
  },
}, async (args, extra) => {
  await server.sendLoggingMessage({
    level: 'info',
    logger: 'fake',
    data: {
      kind: 'fake.notification',
      value: args.value,
      clientMeta: extra?._meta || {},
    },
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        value: args.value,
        threadId: extra?._meta?.['voice-stream-next/threadId'] || null,
      }),
    }],
  };
});

server.connect(new StdioServerTransport()).catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
`, 'utf8');
  return serverPath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('desktop MCP client manager', () => {
  test('loads stdio MCP tools and forwards tool calls with VoiceStream metadata', async () => {
    const dir = makeTempDir();
    const serverPath = writeFakeMcpServer(dir);
    const notifications = [];
    const loaded = await loadMcpServer({
      id: 'fake',
      extensionId: 'mcp-fake',
      name: 'Fake MCP',
      enabled: true,
      transport: 'stdio',
      command: process.execPath,
      args: [serverPath],
      cwd: dir,
      env: {},
      approval: 'always',
      toolApprovals: {},
      supportedTargets: ['device'],
      defaultTarget: 'device',
      targetSlot: '',
    }, {
      safeName(value) {
        return String(value || '').replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
      },
      log() {},
      onNotification(_serverConfig, notification) {
        notifications.push(notification);
      },
    });

    try {
      expect(loaded.manifest.id).toBe('mcp-fake');
      expect(loaded.manifest.tools.map((tool) => tool.name)).toEqual(['echo-value']);
      expect(loaded.manifest.tools[0].label).toBe('Echo value');
      expect(loaded.manifest.tools[0].approval).toBe('always');
      expect(loaded.manifest.tools[0].inputSchema.properties.value.type).toBe('string');

      const result = await loaded.toolExecutors[0].execute({ value: 'hello' }, { threadId: 'thread-123' });
      expect(result.content[0].type).toBe('text');
      expect(JSON.parse(result.content[0].text)).toEqual({ value: 'hello', threadId: 'thread-123' });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].params.data).toEqual({
        kind: 'fake.notification',
        value: 'hello',
        clientMeta: {
          'voice-stream-next/threadId': 'thread-123',
        },
      });
    } finally {
      await loaded.deactivate();
    }
  });

  test('builds MCP request metadata without empty values', () => {
    expect(mcpRequestMeta({ threadId: 'thread-1', runId: '', toolCallId: null })).toEqual({
      'voice-stream-next/threadId': 'thread-1',
    });
  });
});
