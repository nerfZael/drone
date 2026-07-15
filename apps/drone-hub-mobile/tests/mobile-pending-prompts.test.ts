import { describe, expect, test } from 'bun:test';
import { mobileDronePendingPrompts } from '../src/drones/mobile-pending-prompts';

describe('mobile drone pending prompts', () => {
  test('keeps server order and only makes manual queued prompts cancelable', () => {
    expect(
      mobileDronePendingPrompts(
        [
          { id: 'active', prompt: 'Review', state: 'sent' },
          { id: 'queued', prompt: 'Make a PR', state: 'queued' },
          { id: 'automation', prompt: 'Loop', state: 'queued', automation: true },
        ],
        [],
      ),
    ).toEqual([
      {
        id: 'active',
        prompt: 'Review',
        status: 'pending',
        error: null,
        imageCount: 0,
        cancelable: false,
      },
      {
        id: 'queued',
        prompt: 'Make a PR',
        status: 'queued',
        error: null,
        imageCount: 0,
        cancelable: true,
      },
      {
        id: 'automation',
        prompt: 'Loop',
        status: 'queued',
        error: null,
        imageCount: 0,
        cancelable: false,
      },
    ]);
  });

  test('does not duplicate recently completed pending rows retained by the Hub', () => {
    expect(
      mobileDronePendingPrompts(
        [
          { id: 'completed', prompt: 'Review', state: 'sent' },
          { id: 'failed', prompt: 'Retry me', state: 'failed', error: 'send failed' },
        ],
        [{ id: 'completed', prompt: 'Review', output: 'Done' }],
      ),
    ).toEqual([
      {
        id: 'failed',
        prompt: 'Retry me',
        status: 'failed',
        error: 'send failed',
        imageCount: 0,
        cancelable: false,
      },
    ]);
  });
});
