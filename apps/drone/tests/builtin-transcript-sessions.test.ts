import { describe, expect, test } from 'bun:test';
import {
  formatTranscriptJobFailure,
  parseBuiltinPromptJobTranscript,
  parseBlipJobTranscript,
  parseBlipJsonl,
  parseCodexJobTranscript,
  parseCodexJsonl,
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
    expect(parseCodexJsonl('{"type":"turn.completed","last_agent_message":"Completed turn answer."}')).toEqual({
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
    });
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
      stdoutBytes: 1024,
      stdoutTruncated: false,
      parsedAt: '2026-06-17T00:00:03.000Z',
    });
    expect(parseBlipJobTranscript({ transcript, stdout: '' })).toEqual({
      sessionId: 'sess_blip',
      message: 'Final Blip report.',
      terminalEvent: 'session_finished',
    });
  });

  test('tracks active Blip clone tasks while create_clones is running', () => {
    expect(
      parseBlipJsonl(
        [
          '{"version":1,"type":"session_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:00.000Z"}',
          '{"version":1,"type":"tool_call_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:01.000Z","callId":"call_clones","tool":"create_clones","args":{"tasks":["inspect api","check ui"]}}',
        ].join('\n'),
      ),
    ).toEqual({
      sessionId: 'sess_blip',
      message: null,
      cloneActivity: {
        status: 'running',
        count: 2,
        tasks: ['inspect api', 'check ui'],
      },
    });
  });

  test('clears Blip clone tasks after create_clones completes', () => {
    expect(
      parseBlipJsonl(
        [
          '{"version":1,"type":"session_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:00.000Z"}',
          '{"version":1,"type":"tool_call_started","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:01.000Z","callId":"call_clones","tool":"create_clones","args":{"tasks":["inspect api","check ui"]}}',
          '{"version":1,"type":"tool_call_completed","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:02.000Z","callId":"call_clones","tool":"create_clones","result":{"maxClones":8,"clones":[]}}',
          '{"version":1,"type":"assistant_message","sessionId":"sess_blip","timestamp":"2026-06-17T00:00:03.000Z","text":"Final Blip report."}',
        ].join('\n'),
      ),
    ).toEqual({
      sessionId: 'sess_blip',
      message: 'Final Blip report.',
    });
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
