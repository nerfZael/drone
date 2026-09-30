import { describe, expect, test } from 'bun:test';
import { codexPromptOwnsResponse, codexPromptRunMetadata } from '../src/hub/codex-prompt-run';

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


test('shared run timing comes from the run, not the time the steering message joined', () => {
  expect(codexPromptRunMetadata({ startedAt: '2026-09-28T18:47:37Z', codexAppServer: {
    run: { id: 'original', startedAt: '2026-09-28T18:45:12Z' },
  } })).toEqual({ runId: 'original', runStartedAt: '2026-09-28T18:45:12Z' });
  expect(codexPromptRunMetadata({ id: 'queued', startedAt: '2026-09-28T18:47:37Z' })).toEqual({});
});
