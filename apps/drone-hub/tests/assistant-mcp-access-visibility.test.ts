import { describe, expect, test } from 'bun:test';
import { assistantHasEnabledMcpGroup } from '../src/droneHub/assistant/assistant-message-model';

const tools = [
  { name: 'read_file' },
  { name: 'list_drones', group: { kind: 'mcp', id: 'drone-hub' } },
  { name: 'list_chats', group: { kind: 'mcp', id: 'drone-hub' } },
  { name: 'remote_tool', group: { kind: 'mcp', id: 'other-server' } },
];

describe('existing-drone access visibility', () => {
  test('stays hidden when no Drone Hub MCP tool is enabled', () => {
    expect(assistantHasEnabledMcpGroup(tools, ['read_file'], 'drone-hub')).toBe(false);
    expect(assistantHasEnabledMcpGroup(tools, ['remote_tool'], 'drone-hub')).toBe(false);
  });

  test('appears when any Drone Hub MCP tool is enabled', () => {
    expect(assistantHasEnabledMcpGroup(tools, ['list_chats'], 'drone-hub')).toBe(true);
  });
});
