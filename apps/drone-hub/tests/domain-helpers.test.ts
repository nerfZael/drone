import { describe, expect, test } from 'bun:test';
import {
  extractNumberedItemBlocks,
  isUngroupedGroupName,
  isValidDroneNameDashCase,
  normalizeChatInfoPayload,
  stripAnsi,
  timeAgo,
} from '../src/domain';

describe('drone hub domain helpers', () => {
  test('validates drone names using product dash-case rules', () => {
    expect(isValidDroneNameDashCase('auth-fix')).toBe(true);
    expect(isValidDroneNameDashCase('billing-2026')).toBe(true);
    expect(isValidDroneNameDashCase('')).toBe(false);
    expect(isValidDroneNameDashCase('Auth-Fix')).toBe(false);
    expect(isValidDroneNameDashCase('with_underscore')).toBe(false);
    expect(isValidDroneNameDashCase('x'.repeat(49))).toBe(false);
  });

  test('extracts numbered task blocks from an agent message', () => {
    const msg = [
      'Release plan',
      '',
      '1) Split API routes',
      '   - move auth endpoints first',
      '2. Add regression tests',
      '   - cover auth and billing',
      '3: Ship and monitor',
    ].join('\n');

    expect(extractNumberedItemBlocks(msg)).toEqual([
      {
        startLine: 3,
        endLine: 4,
        text: '1) Split API routes\n   - move auth endpoints first',
      },
      {
        startLine: 5,
        endLine: 6,
        text: '2. Add regression tests\n   - cover auth and billing',
      },
      {
        startLine: 7,
        endLine: 7,
        text: '3: Ship and monitor',
      },
    ]);
  });

  test('normalizes chat agent payloads for custom and builtin agents', () => {
    const custom = normalizeChatInfoPayload({
      name: 'auth-drone',
      chat: 'default',
      sessionName: 'drone-hub-chat-default',
      createdAt: '2026-02-10T00:00:00.000Z',
      model: 'gpt-5.2',
      agent: { kind: 'custom', id: 'reviewer', label: 'Reviewer', command: 'review --strict' },
    });
    expect(custom.agent).toEqual({ kind: 'custom', id: 'reviewer', label: 'Reviewer', command: 'review --strict' });
    expect(custom.model).toBe('gpt-5.2');

    const builtin = normalizeChatInfoPayload({
      name: 'auth-drone',
      chat: 'default',
      agent: { kind: 'builtin', id: 'CoDeX' },
    });
    expect(builtin.agent).toEqual({ kind: 'builtin', id: 'codex' });
    expect(builtin.model).toBeNull();

    const claude = normalizeChatInfoPayload({
      name: 'auth-drone',
      chat: 'default',
      agent: { kind: 'builtin', id: 'cloud' },
    });
    expect(claude.agent).toEqual({ kind: 'builtin', id: 'claude' });

    const opencode = normalizeChatInfoPayload({
      name: 'auth-drone',
      chat: 'default',
      agent: { kind: 'builtin', id: 'open-code' },
    });
    expect(opencode.agent).toEqual({ kind: 'builtin', id: 'opencode' });

    const inferred = normalizeChatInfoPayload({
      name: 'auth-drone',
      chat: 'default',
      codexThreadId: 'thread-123',
    });
    expect(inferred.agent).toEqual({ kind: 'builtin', id: 'codex' });

    const inferredClaude = normalizeChatInfoPayload({
      name: 'auth-drone',
      chat: 'default',
      claudeSessionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(inferredClaude.agent).toEqual({ kind: 'builtin', id: 'claude' });

    const inferredOpenCode = normalizeChatInfoPayload({
      name: 'auth-drone',
      chat: 'default',
      openCodeSessionId: 'sess-123',
    });
    expect(inferredOpenCode.agent).toEqual({ kind: 'builtin', id: 'opencode' });
  });

  test('formats relative time in readable UI buckets', () => {
    const now = new Date('2026-02-10T12:00:00.000Z').getTime();
    expect(timeAgo('2026-02-10T12:00:30.000Z', now)).toBe('just now');
    expect(timeAgo('2026-02-10T11:59:30.000Z', now)).toBe('30s ago');
    expect(timeAgo('2026-02-10T11:00:00.000Z', now)).toBe('1h ago');
    expect(timeAgo('2026-02-08T12:00:00.000Z', now)).toBe('2d ago');
  });

  test('strips ansi sequences from streamed output', () => {
    const raw = '\u001b[31mError\u001b[0m\r\nDone';
    expect(stripAnsi(raw)).toBe('Error\nDone');
  });

  test('treats ungrouped names case-insensitively', () => {
    expect(isUngroupedGroupName('Ungrouped')).toBe(true);
    expect(isUngroupedGroupName(' ungrouped ')).toBe(true);
    expect(isUngroupedGroupName('billing')).toBe(false);
  });
});
