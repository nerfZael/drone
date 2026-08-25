import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  listMcpServersFromRegistry,
  syncMcpServersToHostTargets,
  type McpServerRecord,
} from '../src/hub/mcp-servers';

function sampleServer(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'mcp-1',
    name: 'github',
    description: 'GitHub tools.',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      GITHUB_TOKEN: '{env:GITHUB_TOKEN}',
    },
    agents: ['codex', 'cursor', 'claude', 'opencode'],
    createdAt: '2026-07-07T00:00:00.000Z',
    updatedAt: '2026-07-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('MCP server registry normalization', () => {
  test('normalizes registry records and defaults to all supported agents', () => {
    const [server] = listMcpServersFromRegistry({
      mcpServers: {
        one: {
          name: 'filesystem',
          transport: 'stdio',
          command: 'npx',
        },
      },
    });

    expect(server?.id).toBe('one');
    expect(server?.name).toBe('filesystem');
    expect(server?.agents).toEqual(['codex', 'cursor', 'claude', 'opencode']);
  });
});

describe('MCP server projection', () => {
  test('writes global configs while preserving unmanaged entries', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-mcp-projection-'));
    try {
      const codexConfig = path.join(tempRoot, '.codex', 'config.toml');
      const cursorConfig = path.join(tempRoot, '.cursor', 'mcp.json');
      const claudeConfig = path.join(tempRoot, '.claude.json');
      const opencodeConfig = path.join(tempRoot, '.config', 'opencode', 'opencode.json');

      fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
      fs.writeFileSync(codexConfig, 'model = "gpt-5.5"\n', 'utf8');
      fs.mkdirSync(path.dirname(cursorConfig), { recursive: true });
      fs.writeFileSync(
        cursorConfig,
        JSON.stringify({ mcpServers: { unmanaged: { command: 'node' } } }, null, 2),
        'utf8',
      );
      fs.writeFileSync(
        path.join(path.dirname(cursorConfig), '.drone-managed-mcp.json'),
        JSON.stringify({ managedNames: ['old'] }),
        'utf8',
      );
      fs.writeFileSync(
        cursorConfig,
        JSON.stringify(
          { mcpServers: { unmanaged: { command: 'node' }, old: { command: 'old' } } },
          null,
          2,
        ),
        'utf8',
      );

      await syncMcpServersToHostTargets({
        targets: [
          { agent: 'codex', configPath: codexConfig },
          { agent: 'cursor', configPath: cursorConfig },
          { agent: 'claude', configPath: claudeConfig },
          { agent: 'opencode', configPath: opencodeConfig },
        ],
        servers: [
          sampleServer(),
          sampleServer({
            id: 'mcp-bridge',
            name: 'managed-bridge',
            command: 'node',
            args: ['/opt/managed-bridge.js'],
            env: undefined,
            envPassthrough: ['DRONE_HUB_MCP_URL', 'DRONE_HUB_MCP_TOKEN'],
            agents: ['codex'],
          }),
          sampleServer({
            id: 'mcp-2',
            name: 'remote',
            transport: 'http',
            url: 'https://example.com/mcp',
            headers: {
              Authorization: 'Bearer literal-token',
              'X-Remote-Token': '{env:REMOTE_TOKEN}',
            },
            env: undefined,
            agents: ['codex', 'cursor', 'claude', 'opencode'],
          }),
        ],
      });

      const codexText = fs.readFileSync(codexConfig, 'utf8');
      expect(codexText).toContain('model = "gpt-5.5"');
      expect(codexText).toContain('[mcp_servers.github]');
      expect(codexText).toContain('[mcp_servers.managed-bridge]');
      expect(codexText).toContain('env_vars = ["DRONE_HUB_MCP_URL", "DRONE_HUB_MCP_TOKEN"]');
      expect(codexText).toContain('[mcp_servers.remote]');
      expect(codexText).toContain('url = "https://example.com/mcp"');
      expect(codexText).toContain('http_headers = { "Authorization" = "Bearer literal-token" }');
      expect(codexText).toContain('env_http_headers = { "X-Remote-Token" = "REMOTE_TOKEN" }');
      expect(codexText).not.toContain('tool_timeout_sec = 86400');

      const cursor = JSON.parse(fs.readFileSync(cursorConfig, 'utf8'));
      expect(cursor.mcpServers.unmanaged.command).toBe('node');
      expect(cursor.mcpServers.old).toBeUndefined();
      expect(cursor.mcpServers.github.command).toBe('npx');
      expect(cursor.mcpServers.remote.url).toBe('https://example.com/mcp');
      expect(cursor.mcpServers.remote.headers.Authorization).toBe('Bearer literal-token');

      const claude = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
      expect(claude.mcpServers.github.type).toBe('stdio');
      expect(claude.mcpServers.github.command).toBe('npx');
      expect(claude.mcpServers.remote.type).toBe('http');
      expect(claude.mcpServers.remote.url).toBe('https://example.com/mcp');
      expect(claude.mcpServers.remote.headers.Authorization).toBe('Bearer literal-token');
      expect(claude.mcpServers.github.timeout).toBeUndefined();

      const opencode = JSON.parse(fs.readFileSync(opencodeConfig, 'utf8'));
      expect(opencode.$schema).toBe('https://opencode.ai/config.json');
      expect(opencode.mcp.github.type).toBe('local');
      expect(opencode.mcp.github.command).toEqual([
        'npx',
        '-y',
        '@modelcontextprotocol/server-github',
      ]);
      expect(opencode.mcp.github.environment.GITHUB_TOKEN).toBe('{env:GITHUB_TOKEN}');
      expect(opencode.mcp.remote.type).toBe('remote');
      expect(opencode.mcp.remote.headers.Authorization).toBe('Bearer literal-token');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('replaces manifest-owned Codex tables after an external config rewrite removes the markers', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-mcp-codex-rewrite-'));
    try {
      const codexConfig = path.join(tempRoot, '.codex', 'config.toml');
      fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
      fs.writeFileSync(
        codexConfig,
        [
          'model = "gpt-5.6-sol"',
          '',
          '[mcp_servers.drone-hub]',
          'url = "http://old.example/mcp"',
          '',
          '[mcp_servers.drone-hub.http_headers]',
          'Authorization = "Bearer old-token"',
          '',
          '[mcp_servers.openaiDeveloperDocs]',
          'url = "https://developers.openai.com/mcp"',
          '',
        ].join('\n'),
        'utf8',
      );
      fs.writeFileSync(
        path.join(path.dirname(codexConfig), '.drone-managed-mcp.json'),
        JSON.stringify({ managedNames: ['drone-hub'] }),
        'utf8',
      );

      await syncMcpServersToHostTargets({
        targets: [{ agent: 'codex', configPath: codexConfig }],
        servers: [
          sampleServer({
            name: 'drone-hub',
            transport: 'http',
            command: undefined,
            args: undefined,
            env: undefined,
            url: 'http://host.docker.internal:8788/mcp',
            headers: { Authorization: 'Bearer new-token' },
            agents: ['codex'],
          }),
        ],
      });

      const codexText = fs.readFileSync(codexConfig, 'utf8');
      expect(codexText.match(/^\[mcp_servers\.drone-hub\]$/gm)).toHaveLength(1);
      expect(codexText).not.toContain('[mcp_servers.drone-hub.http_headers]');
      expect(codexText).not.toContain('old.example');
      expect(codexText).not.toContain('old-token');
      expect(codexText).toContain('[mcp_servers.openaiDeveloperDocs]');
      expect(codexText).toContain('url = "https://developers.openai.com/mcp"');
      expect(codexText).toContain('# drone-hub-managed-mcp-start');
      expect(codexText).toContain('url = "http://host.docker.internal:8788/mcp"');
      expect(codexText).toContain('tool_timeout_sec = 86400');
      expect(codexText).toContain('http_headers = { "Authorization" = "Bearer new-token" }');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('gives the managed Drone Hub server an interactive timeout in Claude config', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-mcp-claude-timeout-'));
    try {
      const claudeConfig = path.join(tempRoot, '.claude.json');
      await syncMcpServersToHostTargets({
        targets: [{ agent: 'claude', configPath: claudeConfig }],
        servers: [
          sampleServer({
            name: 'drone-hub',
            command: 'node',
            args: ['/opt/drone/mcp-http-stdio-bridge.js'],
            env: undefined,
            agents: ['claude'],
          }),
        ],
      });

      const claude = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
      expect(claude.mcpServers['drone-hub'].timeout).toBe(86_400_000);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
