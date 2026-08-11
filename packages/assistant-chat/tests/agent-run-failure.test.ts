import { describe, expect, test } from 'bun:test';
import {
  agentRunFailurePresentation,
  isAgentTransportInterruption,
  nativeAgentFailurePresentation,
} from '../src';

describe('agent run failure presentation', () => {
  test('recognizes exhausted Codex reconnect output as a recoverable interruption', () => {
    const failure = agentRunFailurePresentation(
      [
        'Reconnecting... 2/5',
        'Reconnecting... 5/5',
        'stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses) (exit 1)',
      ].join('\n'),
    );

    expect(failure).toMatchObject({
      recoverable: true,
      kind: 'connection',
      title: 'Connection interrupted',
      attempts: 5,
      summary: 'The run stopped after 5 automatic reconnect attempts.',
    });
  });

  test('keeps ordinary agent errors non-recoverable', () => {
    expect(agentRunFailurePresentation('Model gpt-missing was not found')).toMatchObject({
      recoverable: false,
      kind: 'error',
      title: 'Agent couldn’t finish the response',
    });
  });

  test('uses a conservative transport check for queue-ordering policy', () => {
    expect(isAgentTransportInterruption('stream disconnected before completion')).toBe(true);
    expect(isAgentTransportInterruption('UND_ERR_CONNECT_TIMEOUT')).toBe(true);
    expect(isAgentTransportInterruption('Prompt delivery was interrupted; retrying later.')).toBe(
      true,
    );
    expect(isAgentTransportInterruption('tool execution timeout after 30 seconds')).toBe(false);
    expect(isAgentTransportInterruption('model request exceeded its token budget')).toBe(false);
  });

  test('uses structured provider diagnostics without retrying partial tool calls', () => {
    const message = {
      role: 'assistant' as const,
      content: [{ type: 'toolCall', id: 'partial', name: 'read_file' }],
      stopReason: 'error',
      errorMessage: 'fetch failed',
      diagnostics: [
        {
          type: 'provider_transport_failure',
          timestamp: Date.now(),
          details: { attempts: 4 },
          error: { message: 'socket hang up', code: 'ECONNRESET' },
        },
      ],
    };

    expect(nativeAgentFailurePresentation(message)).toMatchObject({
      recoverable: false,
      code: 'ECONNRESET',
      attempts: 4,
    });
  });
});
