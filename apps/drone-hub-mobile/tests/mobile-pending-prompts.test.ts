import { describe, expect, test } from 'bun:test';
import {
  mergeOptimisticMobilePendingPrompts,
  mobileDronePendingPrompts,
  optimisticMobilePendingPrompt,
} from '../src/drones/mobile-pending-prompts';

describe('mobile drone pending prompts', () => {
  test('preserves the active run timestamp and plan', () => {
    expect(
      mobileDronePendingPrompts(
        [
          {
            id: 'pending-1',
            at: '2026-07-20T10:00:00.000Z',
            state: 'sent',
            prompt: 'Implement it',
            agentPlan: {
              items: [{ text: 'Edit mobile UI', status: 'in_progress' }],
              source: 'codex',
            },
          },
        ],
        [],
      )[0],
    ).toMatchObject({
      startedAt: '2026-07-20T10:00:00.000Z',
      agentPlan: { items: [{ text: 'Edit mobile UI', status: 'in_progress' }] },
    });
  });

  test('keeps a locally sent prompt optimistic and does not regress it to queued', () => {
    const local = optimisticMobilePendingPrompt({
      id: 'prompt-1',
      prompt: 'Fix it',
      at: '2026-07-19T10:00:00.000Z',
    });
    expect(
      mergeOptimisticMobilePendingPrompts({
        serverPrompts: [{ id: 'prompt-1', prompt: 'Fix it', state: 'queued' }],
        localPrompts: [local],
        turns: [],
        nowMs: Date.parse('2026-07-19T10:00:01.000Z'),
      }),
    ).toEqual([
      {
        ...local,
        state: 'sending',
      },
    ]);
  });

  test('keeps a locally failed prompt visible after the send grace period', () => {
    const failed = {
      ...optimisticMobilePendingPrompt({
        id: 'failed-local',
        prompt: 'Upload this',
        at: '2026-07-19T10:00:00.000Z',
      }),
      state: 'failed' as const,
      error: 'upload failed',
    };

    expect(
      mergeOptimisticMobilePendingPrompts({
        serverPrompts: [],
        localPrompts: [failed],
        turns: [],
        nowMs: Date.parse('2026-07-19T10:05:00.000Z'),
      }),
    ).toEqual([failed]);
  });

  test('keeps server order and makes queued prompts cancelable', () => {
    expect(
      mobileDronePendingPrompts(
        [
          { id: 'active', prompt: 'Review', state: 'sent' },
          { id: 'queued', prompt: 'Make a PR', state: 'queued' },
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
