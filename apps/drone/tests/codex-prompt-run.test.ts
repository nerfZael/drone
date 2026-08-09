import { describe, expect, test } from 'bun:test';
import { codexPromptOwnsResponse } from '../src/hub/codex-prompt-run';

describe('codex prompt runs', () => {
  test('assigns a shared run response to its latest steering message', () => {
    const job = {
      codexAppServer: {
        run: {
          id: 'run-1',
          messageIds: ['prompt-1', 'prompt-2'],
          responseMessageId: 'prompt-2',
        },
      },
    };
    expect(codexPromptOwnsResponse(job, 'prompt-1')).toBe(false);
    expect(codexPromptOwnsResponse(job, 'prompt-2')).toBe(true);
  });

  test('keeps compatibility with jobs persisted before run records', () => {
    expect(codexPromptOwnsResponse({ codexAppServer: { outputOwner: false } }, 'prompt-1')).toBe(
      false,
    );
    expect(codexPromptOwnsResponse({ codexAppServer: { outputOwner: true } }, 'prompt-1')).toBe(
      true,
    );
  });
});
