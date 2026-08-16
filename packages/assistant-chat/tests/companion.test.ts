import { describe, expect, test } from 'bun:test';

import {
  COMPANION_BROWSER_TOOL_NAMES,
  COMPANION_MAX_PROMPT_CHARS,
  groupCompanionToolActivity,
  reduceCompanionToolActivity,
  resolveCompanionChatName,
  validateCompanionRunInput,
} from '../src';

describe('Companion contracts', () => {
  test('allows the browser client to open an existing drone chat', () => {
    expect(COMPANION_BROWSER_TOOL_NAMES).toContain('open_drone_chat');
  });

  test('resolves Companion navigation only to an existing chat', () => {
    expect(resolveCompanionChatName(['planning', 'default'], undefined)).toBe('default');
    expect(resolveCompanionChatName(['planning', 'review'], '  review  ')).toBe('review');
    expect(resolveCompanionChatName(['planning', 'review'], undefined)).toBe('planning');
    expect(resolveCompanionChatName(['planning'], 'default')).toBeNull();
    expect(resolveCompanionChatName([], undefined)).toBeNull();
  });

  test('normalizes valid run input and rejects invalid input consistently', () => {
    expect(validateCompanionRunInput({ runId: ' run-1 ', prompt: ' hello ' })).toEqual({
      ok: true,
      runId: 'run-1',
      prompt: 'hello',
    });
    expect(validateCompanionRunInput({ runId: 'bad\nrun', prompt: 'hello' })).toMatchObject({
      ok: false,
      error: 'A valid runId is required.',
    });
    expect(validateCompanionRunInput({ runId: 'run-1', prompt: ' ' })).toEqual({
      ok: false,
      runId: 'run-1',
      error: 'A non-empty prompt is required.',
    });
    expect(
      validateCompanionRunInput({
        runId: 'run-1',
        prompt: 'x'.repeat(COMPANION_MAX_PROMPT_CHARS + 1),
      }),
    ).toMatchObject({ ok: false, runId: 'run-1' });
  });

  test('accepts only bounded privacy-safe Companion telemetry', () => {
    expect(
      validateCompanionRunInput({
        runId: 'run-1',
        messageId: 'message-1',
        prompt: 'hello',
        telemetry: {
          version: 1,
          transcriptionMs: 123.456,
          audioDurationMs: 9_000,
          connectionMs: 100_000,
          connectionReused: false,
          prompt: 'must not pass through',
        },
      }),
    ).toEqual({
      ok: true,
      runId: 'run-1',
      messageId: 'message-1',
      prompt: 'hello',
      telemetry: {
        version: 1,
        transcriptionMs: 123.5,
        audioDurationMs: 9_000,
        connectionMs: 60_000,
        connectionReused: false,
      },
    });
    expect(
      validateCompanionRunInput({
        runId: 'run-1',
        messageId: 'bad\nmessage',
        prompt: 'hello',
      }),
    ).toMatchObject({ ok: false, error: 'A valid messageId is required.' });
  });

  test('reduces tool activity from start through completion', () => {
    const started = reduceCompanionToolActivity([], {
      type: 'tool_call_started',
      callId: 'call-1',
      tool: 'list_drones',
      args: { limit: 5 },
    });
    expect(started).toEqual([
      {
        callId: 'call-1',
        tool: 'list_drones',
        args: { limit: 5 },
        status: 'running',
      },
    ]);
    expect(
      reduceCompanionToolActivity(started, {
        type: 'tool_call_completed',
        callId: 'call-1',
        result: { count: 2 },
      }),
    ).toEqual([
      {
        callId: 'call-1',
        tool: 'list_drones',
        args: { limit: 5 },
        result: { count: 2 },
        status: 'completed',
      },
    ]);
  });

  test('groups only overlapping calls from the same turn as parallel', () => {
    const first = reduceCompanionToolActivity([], {
      type: 'tool_call_started',
      turnId: 'turn-1',
      callId: 'call-1',
      tool: 'read_chat',
    });
    const overlapping = reduceCompanionToolActivity(first, {
      type: 'tool_call_started',
      turnId: 'turn-1',
      callId: 'call-2',
      tool: 'list_drones',
    });
    const firstCompleted = reduceCompanionToolActivity(overlapping, {
      type: 'tool_call_completed',
      turnId: 'turn-1',
      callId: 'call-1',
      tool: 'read_chat',
    });
    const secondCompleted = reduceCompanionToolActivity(firstCompleted, {
      type: 'tool_call_completed',
      turnId: 'turn-1',
      callId: 'call-2',
      tool: 'list_drones',
    });
    const sequential = reduceCompanionToolActivity(secondCompleted, {
      type: 'tool_call_started',
      turnId: 'turn-1',
      callId: 'call-3',
      tool: 'read_chat',
    });

    expect(groupCompanionToolActivity(sequential)).toEqual([
      {
        key: 'parallel:turn-1:call-1',
        parallel: true,
        items: sequential.slice(0, 2),
      },
      {
        key: 'call-3',
        parallel: false,
        items: [sequential[2]],
      },
    ]);
  });
});
