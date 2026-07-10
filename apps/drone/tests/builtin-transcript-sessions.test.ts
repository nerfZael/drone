import { describe, expect, test } from 'bun:test';
import {
  formatTranscriptJobFailure,
  parseBuiltinPromptJobTranscript,
  parseBlipJobTranscript,
  parseBlipJsonl,
  parseCodexJobTranscript,
  parseCodexJsonl,
  parseCodexRolloutModel,
  parsePiJsonl,
} from '../src/hub/builtin-transcript-sessions';

describe('parseCodexJsonl', () => {
  test('parses legacy Codex agent_message items', () => {
    expect(
      parseCodexJsonl(
        [
          '{"type":"thread.started","thread_id":"019e1922-047b-74b1-bab8-0eaceadf4062"}',
          '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hello from Codex."}}',
        ].join('\n'),
      ),
    ).toEqual({
      threadId: '019e1922-047b-74b1-bab8-0eaceadf4062',
      message: 'Hello from Codex.',
    });
  });

  test('parses assistant message items with content arrays', () => {
    expect(
      parseCodexJsonl(
        [
          '{"type":"thread.started","thread_id":"019e1922-047b-74b1-bab8-0eaceadf4062"}',
          '{"type":"item.completed","item":{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"First line."},{"type":"output_text","text":"Second line."}]}}',
        ].join('\n'),
      ),
    ).toEqual({
      threadId: '019e1922-047b-74b1-bab8-0eaceadf4062',
      message: 'First line.\nSecond line.',
    });
  });

  test('parses Responses-style completed output arrays', () => {
    expect(
      parseCodexJsonl(
        JSON.stringify({
          type: 'response.completed',
          response: {
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Final answer.' }],
              },
            ],
          },
        }),
      ),
    ).toEqual({
      threadId: null,
      message: 'Final answer.',
      terminalEvent: 'response.completed',
    });
  });

  test('records the model attached to the completed assistant response', () => {
    expect(
      parseCodexJsonl(
        '{"type":"response.completed","response":{"model":"gpt-5.2-codex","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Done."}]}]}}',
      ),
    ).toMatchObject({ message: 'Done.', model: 'gpt-5.2-codex' });
  });

  test('parses root-level Codex agent message events', () => {
    expect(parseCodexJsonl('{"type":"agent_message","text":"Root event answer."}')).toEqual({
      threadId: null,
      message: 'Root event answer.',
    });
  });

  test('parses Codex agent message events that use message instead of text', () => {
    expect(parseCodexJsonl('{"type":"agent_message","message":"Root message answer."}')).toEqual({
      threadId: null,
      message: 'Root message answer.',
    });
  });

  test('parses final assistant text from completed turn metadata', () => {
    expect(
      parseCodexJsonl('{"type":"turn.completed","last_agent_message":"Completed turn answer."}'),
    ).toEqual({
      threadId: null,
      message: 'Completed turn answer.',
      terminalEvent: 'turn.completed',
    });
  });

  test('parses message items with output text even when role is omitted', () => {
    expect(
      parseCodexJsonl(
        [
          '{"type":"item.completed","item":{"id":"msg_2","type":"message","content":[{"type":"output_text","text":"Output without role."}]}}',
          '{"type":"item.completed","item":{"id":"user_1","type":"message","content":[{"type":"input_text","text":"Do not treat input as output."}]}}',
        ].join('\n'),
      ),
    ).toEqual({
      threadId: null,
      message: 'Output without role.',
    });
  });
});

describe('parseCodexRolloutModel', () => {
  test('uses the latest turn context model from a persisted Codex rollout', () => {
    expect(
      parseCodexRolloutModel(
        [
          '{"type":"turn_context","payload":{"model":"gpt-5.1-codex"}}',
          '{"type":"event_msg","payload":{"type":"agent_message","message":"Done."}}',
          '{"type":"turn_context","payload":{"model":"gpt-5.2-codex"}}',
        ].join('\n'),
      ),
    ).toBe('gpt-5.2-codex');
  });
});

describe('parseBlipJsonl', () => {
  test('parses Blip session and assistant message events', () => {
    expect(
      parseBlipJsonl(
        [
          '{"version":1,"type":"session_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:00.000Z"}',
          '{"version":1,"type":"assistant_message","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:01.000Z","messageId":"msg_1","text":"Hello from Blip."}',
          '{"version":1,"type":"session_finished","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:02.000Z","status":"completed","changedFiles":[],"durationMs":1000}',
        ].join('\n'),
      ),
    ).toEqual({
      sessionId: 'sess_blip',
      message: 'Hello from Blip.',
      terminalEvent: 'session_finished',
      firstEventAt: '2026-06-17T00:00:00.000Z',
      lastEventAt: '2026-06-17T00:00:02.000Z',
      terminalEventAt: '2026-06-17T00:00:02.000Z',
      terminalStatus: 'completed',
      durationMs: 1000,
      eventCounts: {
        session_started: 1,
        assistant_message: 1,
        session_finished: 1,
      },
    });
  });

  test('falls back to streamed Blip deltas', () => {
    expect(
      parseBlipJsonl(
        [
          '{"version":1,"type":"session_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:00.000Z"}',
          '{"version":1,"type":"assistant_delta","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:01.000Z","text":"Hel"}',
          '{"version":1,"type":"assistant_delta","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:01.000Z","text":"lo"}',
        ].join('\n'),
      ),
    ).toEqual({
      sessionId: 'sess_blip',
      message: 'Hello',
      firstEventAt: '2026-06-17T00:00:00.000Z',
      lastEventAt: '2026-06-17T00:00:01.000Z',
      eventCounts: {
        session_started: 1,
        assistant_delta: 2,
      },
    });
  });

  test('records the model attached to the assistant message', () => {
    expect(
      parseBlipJsonl('{"type":"assistant_message","sessionId":"sess_blip","model":"claude-sonnet-4-5","text":"Done."}'),
    ).toMatchObject({ message: 'Done.', model: 'claude-sonnet-4-5' });
  });
});

describe('parsePiJsonl', () => {
  test('records the model attached to the assistant message', () => {
    expect(
      parsePiJsonl('{"message":{"role":"assistant","model":"anthropic/claude-sonnet-4-5","content":"Done."}}'),
    ).toMatchObject({ message: 'Done.', model: 'anthropic/claude-sonnet-4-5' });
  });
});

describe('prompt job transcript metadata', () => {
  test('preserves the final Codex message even when persisted stdout is truncated earlier', () => {
    const fullStdout = [
      '{"type":"thread.started","thread_id":"019e1922-047b-74b1-bab8-0eaceadf4062"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Interim status."}}',
      '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Final report."}}',
      '{"type":"turn.completed"}',
    ].join('\n');
    const transcript = parseBuiltinPromptJobTranscript('codex', fullStdout, {
      stdoutBytes: 3_000_000,
      stdoutTruncated: true,
      parsedAt: '2026-05-25T21:50:23.410Z',
    });

    expect(transcript).toEqual({
      kind: 'codex',
      message: 'Final report.',
      threadId: '019e1922-047b-74b1-bab8-0eaceadf4062',
      terminalEvent: 'turn.completed',
      stdoutBytes: 3_000_000,
      stdoutTruncated: true,
      parsedAt: '2026-05-25T21:50:23.410Z',
    });

    expect(
      parseCodexJobTranscript({
        stdout:
          '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Interim status."}}\n\n…(truncated)…',
        transcript,
      }),
    ).toEqual({
      threadId: '019e1922-047b-74b1-bab8-0eaceadf4062',
      message: 'Final report.',
      terminalEvent: 'turn.completed',
    });
  });

  test('preserves the final Blip message when stored as parsed transcript metadata', () => {
    const transcript = parseBuiltinPromptJobTranscript(
      'blip',
      [
        '{"version":1,"type":"session_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:00.000Z"}',
        '{"version":1,"type":"assistant_message","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:01.000Z","text":"Final Blip report."}',
        '{"version":1,"type":"session_finished","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:02.000Z","status":"completed","changedFiles":[],"durationMs":1000}',
      ].join('\n'),
      { stdoutBytes: 1024, stdoutTruncated: false, parsedAt: '2026-06-17T00:00:03.000Z' },
    );

    expect(transcript).toEqual({
      kind: 'blip',
      message: 'Final Blip report.',
      sessionId: 'sess_blip',
      terminalEvent: 'session_finished',
      firstEventAt: '2026-06-17T00:00:00.000Z',
      lastEventAt: '2026-06-17T00:00:02.000Z',
      terminalEventAt: '2026-06-17T00:00:02.000Z',
      terminalStatus: 'completed',
      durationMs: 1000,
      eventCounts: {
        session_started: 1,
        assistant_message: 1,
        session_finished: 1,
      },
      stdoutBytes: 1024,
      stdoutTruncated: false,
      parsedAt: '2026-06-17T00:00:03.000Z',
    });
    expect(parseBlipJobTranscript({ transcript, stdout: '' })).toEqual({
      sessionId: 'sess_blip',
      message: 'Final Blip report.',
      terminalEvent: 'session_finished',
      firstEventAt: '2026-06-17T00:00:00.000Z',
      lastEventAt: '2026-06-17T00:00:02.000Z',
      terminalEventAt: '2026-06-17T00:00:02.000Z',
      terminalStatus: 'completed',
      durationMs: 1000,
      eventCounts: {
        session_started: 1,
        assistant_message: 1,
        session_finished: 1,
      },
    });
  });

  test('tracks active Blip agent tasks while agent is running', () => {
    expect(
      parseBlipJsonl(
        [
          '{"version":1,"type":"session_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:00.000Z"}',
          '{"version":1,"type":"tool_call_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:01.000Z","callId":"call_agents","tool":"agent","args":{"action":"run","agents":[{"task":"inspect api"},{"task":"check ui"}]}}',
        ].join('\n'),
      ),
    ).toEqual({
      sessionId: 'sess_blip',
      message: null,
      firstEventAt: '2026-06-17T00:00:00.000Z',
      lastEventAt: '2026-06-17T00:00:01.000Z',
      eventCounts: {
        session_started: 1,
        tool_call_started: 1,
      },
      toolCallCount: 1,
      cloneActivity: {
        status: 'running',
        count: 2,
        tasks: ['inspect api', 'check ui'],
      },
    });
  });

  test('clears Blip agent tasks after agent completes', () => {
    expect(
      parseBlipJsonl(
        [
          '{"version":1,"type":"session_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:00.000Z"}',
          '{"version":1,"type":"tool_call_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:01.000Z","callId":"call_agents","tool":"agent","args":{"action":"run","agents":[{"task":"inspect api"},{"task":"check ui"}]}}',
          '{"version":1,"type":"tool_call_completed","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:02.000Z","callId":"call_agents","tool":"agent","result":{"runId":"ar_test","status":"completed","agents":[]}}',
          '{"version":1,"type":"assistant_message","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:03.000Z","text":"Final Blip report."}',
        ].join('\n'),
      ),
    ).toEqual({
      sessionId: 'sess_blip',
      message: 'Final Blip report.',
      firstEventAt: '2026-06-17T00:00:00.000Z',
      lastEventAt: '2026-06-17T00:00:03.000Z',
      eventCounts: {
        session_started: 1,
        tool_call_started: 1,
        tool_call_completed: 1,
        assistant_message: 1,
      },
      toolCallCount: 1,
      toolCallCompletedCount: 1,
      longestToolCall: {
        callId: 'call_agents',
        tool: 'agent',
        status: 'completed',
        startedAt: '2026-06-17T00:00:01.000Z',
        completedAt: '2026-06-17T00:00:02.000Z',
        durationMs: 1000,
      },
    });
  });

  test('keeps Blip agent tasks active after non-blocking agent start returns running', () => {
    expect(
      parseBlipJsonl(
        [
          '{"version":1,"type":"session_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:00.000Z"}',
          '{"version":1,"type":"tool_call_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:01.000Z","callId":"call_agents_start","tool":"agent","args":{"action":"run","wait":false,"agents":[{"task":"inspect api"},{"task":"check ui"}]}}',
          '{"version":1,"type":"tool_call_completed","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:02.000Z","callId":"call_agents_start","tool":"agent","result":{"runId":"ar_test","status":"running","agents":[{"task":"inspect api","status":"running"},{"task":"check ui","status":"running"}]}}',
        ].join('\n'),
      ),
    ).toMatchObject({
      cloneActivity: {
        status: 'running',
        count: 2,
        tasks: ['inspect api', 'check ui'],
      },
    });
  });

  test('clears Blip agent tasks when non-blocking agent run is collected', () => {
    expect(
      parseBlipJsonl(
        [
          '{"version":1,"type":"session_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:00.000Z"}',
          '{"version":1,"type":"tool_call_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:01.000Z","callId":"call_agents_start","tool":"agent","args":{"action":"run","wait":false,"agents":[{"task":"inspect api"},{"task":"check ui"}]}}',
          '{"version":1,"type":"tool_call_completed","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:02.000Z","callId":"call_agents_start","tool":"agent","result":{"runId":"ar_test","status":"running","agents":[{"task":"inspect api","status":"running"},{"task":"check ui","status":"running"}]}}',
          '{"version":1,"type":"tool_call_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:03.000Z","callId":"call_agents_collect","tool":"agent","args":{"action":"collect","runId":"ar_test","wait":true}}',
          '{"version":1,"type":"tool_call_completed","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:04.000Z","callId":"call_agents_collect","tool":"agent","result":{"runId":"ar_test","status":"completed","agents":[{"task":"inspect api","status":"completed"},{"task":"check ui","status":"completed"}]}}',
        ].join('\n'),
      ),
    ).not.toHaveProperty('cloneActivity');
  });

  test('does not mark an intermediary Codex status message as terminal', () => {
    const parsed = parseCodexJobTranscript({
      state: 'failed',
      stdout: [
        '{"type":"thread.started","thread_id":"019e1922-047b-74b1-bab8-0eaceadf4062"}',
        '{"type":"turn.started"}',
        '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"I checked part A and now I am checking part B."}}',
      ].join('\n'),
    });

    expect(parsed).toEqual({
      threadId: '019e1922-047b-74b1-bab8-0eaceadf4062',
      message: 'I checked part A and now I am checking part B.',
    });
    expect(parsed).not.toHaveProperty('terminalEvent');
  });
});

describe('formatTranscriptJobFailure', () => {
  test('surfaces when the prompt command failed without any captured output', () => {
    expect(
      formatTranscriptJobFailure({
        agentId: 'cursor',
        stdoutRaw: '',
        stderrRaw: '',
        fallbackRaw: '',
        exitCode: 17,
      }),
    ).toBe('prompt command failed without any captured stdout/stderr output (exit 17)');
  });

  test('surfaces missing output even when no exit code was captured', () => {
    expect(
      formatTranscriptJobFailure({
        agentId: 'cursor',
        stdoutRaw: '',
        stderrRaw: '',
        fallbackRaw: '',
      }),
    ).toBe('prompt command failed before any stdout/stderr output or exit code was captured');
  });

  test('preserves codex lifecycle-specific failures and appends the exit code', () => {
    expect(
      formatTranscriptJobFailure({
        agentId: 'codex',
        stdoutRaw: [
          '{"type":"thread.started","thread_id":"thread_123"}',
          '{"type":"turn.started"}',
        ].join('\n'),
        stderrRaw: '',
        fallbackRaw: '',
        exitCode: 1,
      }),
    ).toBe('Codex turn started but exited before producing a response. (exit 1)');
  });

  test('preserves existing error details for non-codex agents', () => {
    expect(
      formatTranscriptJobFailure({
        agentId: 'pi',
        stdoutRaw: '',
        stderrRaw: 'authentication failed',
        fallbackRaw: 'authentication failed',
        exitCode: 4,
      }),
    ).toBe('authentication failed (exit 4)');
  });
});
