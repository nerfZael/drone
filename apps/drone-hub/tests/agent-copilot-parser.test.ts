import { describe, expect, test } from 'bun:test';
import { extractAgentCopilotFromAgentMessage } from '../src/droneHub/chat/agent-copilot-parser';

describe('agent copilot parser', () => {
  test('extracts a single copilot object and removes it from the message', () => {
    const message = [
      'Need a second opinion.',
      '',
      '```json',
      '{',
      '  "type": "agent-copilot",',
      '  "name": "docs-review",',
      '  "message": "Review the new API copy for gaps."',
      '}',
      '```',
      '',
      'Continue after it responds.',
    ].join('\n');

    expect(extractAgentCopilotFromAgentMessage(message)).toEqual({
      cleanedText: ['Need a second opinion.', '', 'Continue after it responds.'].join('\n'),
      copilot: {
        type: 'agent-copilot',
        name: 'docs-review',
        message: 'Review the new API copy for gaps.',
      },
      error: null,
    });
  });

  test('supports an array with a single copilot object', () => {
    const message = '[{"type":"agent-copilot","name":"qa","message":"Check the edge cases."}]';
    expect(extractAgentCopilotFromAgentMessage(message)).toEqual({
      cleanedText: '',
      copilot: {
        type: 'agent-copilot',
        name: 'qa',
        message: 'Check the edge cases.',
      },
      error: null,
    });
  });

  test('returns an error when multiple copilot objects are present', () => {
    const message = [
      '{"type":"agent-copilot","name":"one","message":"First"}',
      '{"type":"agent-copilot","name":"two","message":"Second"}',
    ].join('\n');

    expect(extractAgentCopilotFromAgentMessage(message)).toEqual({
      cleanedText: '',
      copilot: null,
      error: 'Multiple agent copilot objects were found in one message. Only one is supported.',
    });
  });

  test('ignores placeholder examples from the skill text', () => {
    const message = [
      '```json',
      '{',
      '  "type": "agent-copilot",',
      '  "name": "agent-copilot-name",',
      '  "message": "<message-to-send-to-the-agent-copilot>"',
      '}',
      '```',
    ].join('\n');

    expect(extractAgentCopilotFromAgentMessage(message)).toEqual({
      cleanedText: message,
      copilot: null,
      error: null,
    });
  });
});
