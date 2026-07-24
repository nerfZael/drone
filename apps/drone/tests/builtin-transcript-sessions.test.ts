import { describe, expect, test } from 'bun:test';
import {
  formatTranscriptJobFailure,
  parseBuiltinPromptJobTranscript,
  parseBlipJobTranscript,
  parseBlipJsonl,
  parseCodexJobTranscript,
  parseCodexJsonl,
  parseClaudeJsonl,
  parseCursorJsonl,
  parseOpenCodeJsonl,
  parseCodexRolloutModel,
  parseCodexRolloutRuntime,
  parsePiJsonl,
} from '../src/hub/builtin-transcript-sessions';
import {
  boundedActivityValue,
  BuiltinAgentActivityCollector,
} from '../src/hub/builtin-agent-activity';

describe('parseCodexJsonl', () => {
  test('keeps the latest Codex todo-list snapshot', () => {
    const parsed = parseCodexJsonl([
      '{"type":"item.started","item":{"id":"plan","type":"todo_list","items":[{"text":"Inspect code","completed":false},{"text":"Add tests","completed":false}]}}',
      '{"type":"item.updated","item":{"id":"plan","type":"todo_list","items":[{"text":"Inspect code","completed":true},{"text":"Add tests","completed":false}]}}',
    ].join('\n'));

    expect(parsed.agentPlan).toMatchObject({
      source: 'codex',
      items: [
        { text: 'Inspect code', status: 'completed' },
        { text: 'Add tests', status: 'pending' },
      ],
    });
  });

  test('parses legacy Codex agent_message items', () => {
    expect(
      parseCodexJsonl(
        [
          '{"type":"thread.started","thread_id":"019e1922-047b-74b1-bab8-0eaceadf4062"}',
          '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hello from Codex."}}',
        ].join('\n'),
      ),
    ).toMatchObject({
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
    ).toMatchObject({
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
    ).toMatchObject({
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
    expect(parseCodexJsonl('{"type":"agent_message","text":"Root event answer."}')).toMatchObject({
      threadId: null,
      message: 'Root event answer.',
    });
  });

  test('parses Codex agent message events that use message instead of text', () => {
    expect(parseCodexJsonl('{"type":"agent_message","message":"Root message answer."}')).toMatchObject({
      threadId: null,
      message: 'Root message answer.',
    });
  });

  test('parses final assistant text from completed turn metadata', () => {
    expect(
      parseCodexJsonl('{"type":"turn.completed","last_agent_message":"Completed turn answer."}'),
    ).toMatchObject({
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
    ).toMatchObject({
      threadId: null,
      message: 'Output without role.',
    });
  });
});

describe('structured agent plan parsers', () => {
  test('parses Claude TodoWrite tool calls and the final result', () => {
    const parsed = parseClaudeJsonl([
      JSON.stringify({
        type: 'assistant',
        session_id: 'claude-session',
        message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [
          { content: 'Read the code', status: 'completed' },
          { content: 'Implement the change', status: 'in_progress' },
        ] } }] },
      }),
      JSON.stringify({ type: 'result', session_id: 'claude-session', result: 'Claude finished.' }),
    ].join('\n'));

    expect(parsed).toMatchObject({
      sessionId: 'claude-session',
      message: 'Claude finished.',
      agentPlan: {
        source: 'claude',
        items: [
          { text: 'Read the code', status: 'completed' },
          { text: 'Implement the change', status: 'in_progress' },
        ],
      },
    });
  });

  test('parses OpenCode todowrite metadata and completed text', () => {
    const parsed = parseOpenCodeJsonl([
      JSON.stringify({
        type: 'tool_use',
        sessionID: 'oc-session',
        part: { type: 'tool', tool: 'todowrite', state: { status: 'completed', metadata: { todos: [
          { id: '1', content: 'Update API', status: 'completed' },
          { id: '2', content: 'Verify UI', status: 'pending' },
        ] } } },
      }),
      JSON.stringify({ type: 'text', sessionID: 'oc-session', part: { text: 'OpenCode finished.' } }),
    ].join('\n'));

    expect(parsed).toMatchObject({
      sessionId: 'oc-session',
      message: 'OpenCode finished.',
      agentPlan: { source: 'opencode', items: [
        { id: '1', text: 'Update API', status: 'completed' },
        { id: '2', text: 'Verify UI', status: 'pending' },
      ] },
    });
  });

  test('parses Cursor todo tool payloads while preserving its final result', () => {
    const parsed = parseCursorJsonl([
      JSON.stringify({
        type: 'tool_call',
        session_id: 'cursor-session',
        tool_call: { todoWriteToolCall: { args: { todos: [
          { id: 'a', text: 'Inspect', status: 'completed' },
          { id: 'b', text: 'Patch', status: 'in-progress' },
        ] } } },
      }),
      JSON.stringify({ type: 'result', session_id: 'cursor-session', result: 'Cursor finished.' }),
    ].join('\n'));

    expect(parsed).toMatchObject({
      sessionId: 'cursor-session',
      message: 'Cursor finished.',
      agentPlan: { source: 'cursor', items: [
        { id: 'a', text: 'Inspect', status: 'completed' },
        { id: 'b', text: 'Patch', status: 'in_progress' },
      ] },
    });
  });

  test('extracts readable structured-agent failures', () => {
    expect(parseClaudeJsonl(JSON.stringify({
      type: 'result',
      subtype: 'error',
      is_error: true,
      result: 'Claude ran out of context.',
    }))).toMatchObject({
      terminalStatus: 'failed',
      error: 'Claude ran out of context.',
    });

    expect(parseOpenCodeJsonl(JSON.stringify({
      type: 'error',
      error: { data: { message: 'OpenCode provider unavailable.' } },
    }))).toMatchObject({
      terminalStatus: 'failed',
      error: 'OpenCode provider unavailable.',
    });
  });
});

describe('built-in external agent activity', () => {
  test('preserves ordered Codex reasoning, tool calls, results, and intermediary messages', () => {
    const parsed = parseCodexJsonl([
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'reasoning-1', type: 'reasoning', text: 'Checking the repository.' },
      }),
      JSON.stringify({
        type: 'item.started',
        item: { id: 'command-1', type: 'command_execution', command: 'git status' },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'command-1',
          type: 'command_execution',
          command: 'git status',
          status: 'completed',
          aggregated_output: 'clean',
        },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'message-1', type: 'agent_message', text: 'The tree is clean.' },
      }),
    ].join('\n'));

    expect(parsed.activity?.messages).toMatchObject([
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'Checking the repository.' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'command-1',
            name: 'command_execution',
            arguments: { command: 'git status' },
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'command-1',
        toolName: 'command_execution',
        content: 'clean',
      },
      { role: 'assistant', content: [{ type: 'text', text: 'The tree is clean.' }] },
    ]);
  });

  test('reads Codex reasoning summaries expressed as content blocks', () => {
    const parsed = parseCodexJsonl(
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'reasoning-1',
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'I compared the two implementations.' }],
        },
      }),
    );

    expect(parsed.activity?.messages[0]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'I compared the two implementations.' }],
    });
  });

  test('normalizes Claude, OpenCode, Cursor, Pi, and Blip activity', () => {
    const claude = parseClaudeJsonl([
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'claude-message',
          content: [
            { type: 'thinking', thinking: 'Inspecting.' },
            { type: 'tool_use', id: 'claude-tool', name: 'Read', input: { path: 'README.md' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'claude-tool', content: 'contents' }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { id: 'claude-final', content: [{ type: 'text', text: 'Finished.' }] },
      }),
    ].join('\n'));
    const opencode = parseOpenCodeJsonl([
      JSON.stringify({ type: 'reasoning', part: { id: 'oc-r', type: 'reasoning', text: 'Inspecting.' } }),
      JSON.stringify({
        type: 'tool_use',
        part: {
          callID: 'oc-tool',
          type: 'tool',
          tool: 'read',
          state: { status: 'completed', input: { path: 'README.md' }, output: 'contents' },
        },
      }),
      JSON.stringify({ type: 'text', part: { id: 'oc-final', text: 'Finished.' } }),
    ].join('\n'));
    const cursor = parseCursorJsonl([
      JSON.stringify({ type: 'reasoning', id: 'cursor-r', text: 'Inspecting.' }),
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'cursor-tool',
        tool_call: {
          readToolCall: { args: { path: 'README.md' }, result: 'contents' },
        },
      }),
      JSON.stringify({ type: 'result', result: 'Finished.' }),
    ].join('\n'));
    const pi = parsePiJsonl([
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          timestamp: 1,
          content: [
            { type: 'thinking', thinking: 'Inspecting.' },
            { type: 'toolCall', id: 'pi-tool', name: 'read', arguments: { path: 'README.md' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        toolCallId: 'pi-tool',
        toolName: 'read',
        result: { content: [{ type: 'text', text: 'contents' }] },
        isError: false,
      }),
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          timestamp: 2,
          content: [{ type: 'text', text: 'Finished.' }],
        },
      }),
    ].join('\n'));
    const blip = parseBlipJsonl([
      JSON.stringify({ type: 'reasoning_message', text: 'Inspecting.' }),
      JSON.stringify({
        type: 'tool_call_started',
        callId: 'blip-tool',
        tool: 'read',
        args: { path: 'README.md' },
      }),
      JSON.stringify({
        type: 'tool_call_completed',
        callId: 'blip-tool',
        tool: 'read',
        result: 'contents',
      }),
      JSON.stringify({ type: 'assistant_message', messageId: 'blip-final', text: 'Finished.' }),
    ].join('\n'));

    for (const parsed of [claude, opencode, cursor, pi, blip]) {
      const messages = parsed.activity?.messages ?? [];
      expect(
        messages.some(
          (message) =>
            Array.isArray(message.content) &&
            message.content.some((part) => part.type === 'thinking'),
        ),
      ).toBe(true);
      expect(
        messages.some(
          (message) =>
            Array.isArray(message.content) &&
            message.content.some((part) => part.type === 'toolCall'),
        ),
      ).toBe(true);
      expect(messages.some((message) => message.role === 'toolResult')).toBe(true);
      expect(
        messages.some(
          (message) =>
            Array.isArray(message.content) &&
            message.content.some((part) => part.type === 'text' && part.text === 'Finished.'),
        ),
      ).toBe(true);
    }
  });

  test('redacts sensitive fields and trims oversized tool payloads', () => {
    const bounded = boundedActivityValue({
      apiKey: 'secret-value',
      authToken: 'auth-token-value',
      clientSecret: 'camel-secret-value',
      nested: { access_token: 'secret-token' },
      headers: { authorization: 'Bearer private' },
      output: 'x'.repeat(100_000),
    });

    expect(bounded.truncated).toBe(true);
    expect(JSON.stringify(bounded.value)).not.toContain('secret-value');
    expect(JSON.stringify(bounded.value)).not.toContain('auth-token-value');
    expect(JSON.stringify(bounded.value)).not.toContain('camel-secret-value');
    expect(JSON.stringify(bounded.value)).not.toContain('secret-token');
    expect(JSON.stringify(bounded.value)).not.toContain('Bearer private');
    expect(JSON.stringify(bounded.value)).toContain('[redacted]');
    expect(Buffer.byteLength(JSON.stringify(bounded.value))).toBeLessThanOrEqual(64 * 1024);
  });

  test('bounds provider-controlled tool identifiers and names', () => {
    const collector = new BuiltinAgentActivityCollector('codex');
    collector.upsertToolCall({
      id: `tool-${'x'.repeat(10_000)}`,
      name: `tool-${'y'.repeat(10_000)}`,
      arguments: {},
    });
    collector.upsertToolResult({
      id: `tool-${'x'.repeat(10_000)}`,
      name: `tool-${'y'.repeat(10_000)}`,
      result: 'ok',
    });

    const activity = collector.result();
    expect(activity?.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(activity))).toBeLessThan(10_000);
    expect(activity?.messages.some((message) => message.role === 'toolResult')).toBe(true);
  });

  test('keeps collector memory bounded to the newest activity messages', () => {
    const collector = new BuiltinAgentActivityCollector('claude');
    for (let index = 0; index < 500; index += 1) {
      collector.upsertAssistant({ id: `message-${index}`, text: `Message ${index}` });
    }

    const activity = collector.result();
    expect(activity?.messages).toHaveLength(200);
    expect(activity?.messages[0]).toMatchObject({
      content: [{ type: 'text', text: 'Message 300' }],
    });
    expect(activity?.messages.at(-1)).toMatchObject({
      content: [{ type: 'text', text: 'Message 499' }],
    });
    expect(activity?.truncated).toBe(true);
  });

  test('keeps Pi tool arguments when later progress events omit them', () => {
    const parsed = parsePiJsonl([
      JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 'tool-1',
        toolName: 'bash',
        args: { command: 'git status' },
      }),
      JSON.stringify({
        type: 'tool_execution_update',
        toolCallId: 'tool-1',
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        toolName: 'bash',
        result: 'clean',
      }),
    ].join('\n'));

    const toolCall = parsed.activity?.messages
      .flatMap((message) => Array.isArray(message.content) ? message.content : [])
      .find((part) => part.type === 'toolCall');
    expect(toolCall).toMatchObject({
      id: 'tool-1',
      name: 'bash',
      arguments: { command: 'git status' },
    });
  });
});

describe('parseCodexRolloutModel', () => {
  test('uses the latest turn context runtime from a persisted Codex rollout', () => {
    const raw = [
      '{"type":"turn_context","payload":{"model":"gpt-5.1-codex","reasoning_effort":"low"}}',
      '{"type":"event_msg","payload":{"type":"agent_message","message":"Done."}}',
      '{"type":"turn_context","payload":{"model":"gpt-5.2-codex","reasoning_effort":"xhigh"}}',
    ].join('\n');
    expect(
      parseCodexRolloutRuntime(raw),
    ).toEqual({ model: 'gpt-5.2-codex', reasoning: 'xhigh' });
    expect(
      parseCodexRolloutModel(raw),
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
    ).toMatchObject({
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
    ).toMatchObject({
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
      parseBlipJsonl('{"type":"assistant_message","sessionId":"sess_blip","model":"claude-sonnet-4-5","reasoning_effort":"high","text":"Done."}'),
    ).toMatchObject({ message: 'Done.', model: 'claude-sonnet-4-5', reasoning: 'high' });
  });
});

describe('parsePiJsonl', () => {
  test('records the model attached to the assistant message', () => {
    expect(
      parsePiJsonl('{"message":{"role":"assistant","model":"anthropic/claude-sonnet-4-5","thinkingLevel":"high","content":"Done."}}'),
    ).toMatchObject({ message: 'Done.', model: 'anthropic/claude-sonnet-4-5', reasoning: 'high' });
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

    expect(transcript).toMatchObject({
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
    ).toMatchObject({
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

    expect(transcript).toMatchObject({
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
    expect(parseBlipJobTranscript({ transcript, stdout: '' })).toMatchObject({
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

  test('does not mark an intermediary Codex status message as terminal', () => {
    const parsed = parseCodexJobTranscript({
      state: 'failed',
      stdout: [
        '{"type":"thread.started","thread_id":"019e1922-047b-74b1-bab8-0eaceadf4062"}',
        '{"type":"turn.started"}',
        '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"I checked part A and now I am checking part B."}}',
      ].join('\n'),
    });

    expect(parsed).toMatchObject({
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
