import { describe, expect, test } from 'bun:test';

import {
  shouldLoadChatMcpAccess,
  withChatMcpScopeMode,
  withChatMcpSelectedDrones,
} from '../src/droneHub/app/use-chat-mcp-access';

describe('chat MCP access scope', () => {
  test('loads access only after the permissions UI opens for an eligible chat', () => {
    expect(shouldLoadChatMcpAccess(false, true)).toBe(false);
    expect(shouldLoadChatMcpAccess(true, false)).toBe(false);
    expect(shouldLoadChatMcpAccess(true, true)).toBe(true);
  });

  test('updates one access mode without changing the selected drones', () => {
    expect(
      withChatMcpScopeMode(
        {
          readMode: 'all',
          writeMode: 'selected',
          executeMode: 'selected',
          droneIds: ['drone-a'],
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        'write',
        'all',
      ),
    ).toEqual({
      readMode: 'all',
      writeMode: 'all',
      executeMode: 'selected',
      droneIds: ['drone-a'],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  test('matches native behavior by selecting every mode when drones are dropped', () => {
    expect(
      withChatMcpSelectedDrones(
        {
          readMode: 'all',
          writeMode: 'all',
          executeMode: 'all',
          droneIds: [],
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        ['drone-a', 'drone-a', ' drone-b '],
      ),
    ).toEqual({
      readMode: 'selected',
      writeMode: 'selected',
      executeMode: 'selected',
      droneIds: ['drone-a', 'drone-b'],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
