import { describe, expect, test } from 'bun:test';
import { MESH_CHAT_PAYLOAD_BYTES } from '@drone/device-protocol';
import { boundedDroneChatPage } from '../src/hub/device-mesh/drone-chat-page';

describe('device mesh drone chat pages', () => {
  test('keeps the newest turns within budget and exposes an older cursor', () => {
    const turns = Array.from({ length: 100 }, (_, index) => ({
      id: `turn-${index + 1}`,
      turn: index + 1,
      prompt: `prompt ${index + 1}`,
      output: 'x'.repeat(40_000),
    }));
    const page = boundedDroneChatPage(turns);

    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(MESH_CHAT_PAYLOAD_BYTES);
    expect(page.turns.at(-1)?.id).toBe('turn-100');
    expect(page.turns.every((turn) => turn.meshTruncated === true)).toBe(true);
    expect(page.page.hasOlder).toBe(true);
    expect(page.page.beforeCursor).toBeGreaterThan(0);

    const older = boundedDroneChatPage(turns, page.page.beforeCursor);
    expect(Number(older.turns.at(-1)?.turn)).toBeLessThan(Number(page.turns[0]?.turn));
  });

  test('returns an empty page when metadata leaves no room for a turn', () => {
    const page = boundedDroneChatPage(
      [{ id: 'turn-1', turn: 1, prompt: 'Prompt', output: 'Response' }],
      undefined,
      0,
    );

    expect(page.turns).toEqual([]);
    expect(page.page).toMatchObject({ beforeCursor: 1, hasOlder: true, responseTruncated: true });
  });

  test('preserves the global cursor when the server already supplied a bounded page', () => {
    const turns = Array.from({ length: 100 }, (_, index) => ({
      id: `turn-${index + 401}`,
      turn: index + 401,
      prompt: `prompt ${index + 401}`,
      output: 'done',
    }));

    const page = boundedDroneChatPage(turns);

    expect(page.turns).toHaveLength(100);
    expect(page.page.beforeCursor).toBe(400);
    expect(page.page.hasOlder).toBe(true);
  });

  test('marks the exact side of a turn whose content was truncated', () => {
    const [turn] = boundedDroneChatPage([
      {
        id: 'turn-1',
        prompt: 'Short prompt',
        output: 'x'.repeat(40_000),
      },
    ]).turns;

    expect(turn?.promptTruncated).toBeUndefined();
    expect(turn?.responseTruncated).toBe(true);
    expect(turn?.meshTruncated).toBe(true);
  });

  test('preserves plans, changed files, and bounded external-agent activity', () => {
    const [turn] = boundedDroneChatPage([
      {
        id: 'turn-activity',
        promptAt: '2026-07-24T00:00:00.000Z',
        startedAt: '2026-07-24T00:05:00.000Z',
        completedAt: '2026-07-24T00:06:00.000Z',
        prompt: 'Inspect it',
        output: 'Done',
        agentPlan: {
          source: 'codex',
          items: [{ text: 'Inspect', status: 'completed' }],
        },
        fileChanges: {
          version: 1,
          capturedAt: '2026-07-24T00:00:00.000Z',
          counts: { changed: 1, additions: 2, deletions: 0, modified: 1 },
          workspaces: [],
        },
        activity: {
          version: 1,
          source: 'codex',
          updatedAt: '2026-07-24T00:00:01.000Z',
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'toolCall',
                  id: 'tool-1',
                  name: 'command_execution',
                  arguments: { command: 'x'.repeat(20_000) },
                },
              ],
            },
            {
              role: 'toolResult',
              toolCallId: 'tool-1',
              toolName: 'command_execution',
              content: 'x'.repeat(40_000),
            },
            {
              role: 'assistant',
              content: [{ type: 'thinking', thinking: 'Reasoning summary' }],
            },
          ],
        },
      },
    ]).turns;

    expect(turn?.agentPlan).toMatchObject({ items: [{ text: 'Inspect' }] });
    expect(turn?.startedAt).toBe('2026-07-24T00:05:00.000Z');
    expect(turn?.fileChanges).toMatchObject({ counts: { changed: 1 } });
    expect(turn?.activity).toMatchObject({
      version: 1,
      source: 'codex',
      messages: [{ role: 'assistant' }, { role: 'toolResult' }, { role: 'assistant' }],
    });
    expect(Buffer.byteLength(JSON.stringify(turn?.activity))).toBeLessThanOrEqual(24 * 1024);
    expect(turn?.activityMeshTruncated).toBe(true);
  });

  test('bounds one activity message containing many large content parts', () => {
    const [turn] = boundedDroneChatPage([
      {
        id: 'turn-large-message',
        prompt: 'Inspect it',
        output: 'Done',
        activity: {
          version: 1,
          source: 'claude',
          updatedAt: '2026-07-24T00:00:01.000Z',
          messages: [
            {
              role: 'assistant',
              content: Array.from({ length: 16 }, (_, index) => ({
                type: 'toolCall',
                id: `tool-${index}`,
                name: 'large_tool',
                arguments: { value: 'x'.repeat(10_000) },
              })),
            },
          ],
        },
      },
    ]).turns;

    expect(Buffer.byteLength(JSON.stringify(turn?.activity))).toBeLessThanOrEqual(24 * 1024);
    expect(turn?.activityMeshTruncated).toBe(true);
  });

  test('bounds large plans and changed-file metadata', () => {
    const page = boundedDroneChatPage([
      {
        id: 'turn-large-metadata',
        prompt: 'Inspect it',
        output: 'Done',
        agentPlan: {
          source: 'codex',
          items: Array.from({ length: 500 }, (_, index) => ({
            id: `step-${index}`,
            text: `Inspect ${'x'.repeat(2_000)}`,
            status: 'pending',
          })),
        },
        fileChanges: {
          version: 1,
          capturedAt: '2026-07-24T00:00:00.000Z',
          counts: { changed: 500, additions: 500, deletions: 0 },
          workspaces: [
            {
              targetId: 'target-1',
              label: 'Workspace',
              repoRoot: '/repo',
              counts: { changed: 500, additions: 500, deletions: 0 },
              entries: Array.from({ length: 500 }, (_, index) => ({
                path: `${'nested/'.repeat(100)}file-${index}.ts`,
                status: 'modified',
                additions: 1,
                deletions: 0,
              })),
            },
          ],
        },
      },
    ]);
    const [turn] = page.turns;

    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(MESH_CHAT_PAYLOAD_BYTES);
    expect(turn?.agentPlan).toMatchObject({ truncated: true });
    expect(turn?.fileChanges).toMatchObject({ truncated: true });
  });
});
