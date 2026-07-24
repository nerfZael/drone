import { describe, expect, test } from 'bun:test';
import {
  confirmedMobilePendingPromptState,
  hasActiveMobileDronePendingPrompt,
  mergeOptimisticMobilePendingPrompts,
  mobileChatRespondingStatus,
  mobileDronePendingPrompts,
  optimisticMobilePendingPrompt,
} from '../src/drones/mobile-pending-prompts';

describe('mobile drone pending prompts', () => {
  test('tracks activity-backed pending runs until their completed turn arrives', () => {
    const pending = [{ id: 'pending-1', state: 'sent', activity: { messages: [] } }];
    expect(hasActiveMobileDronePendingPrompt(pending, [])).toBe(true);
    expect(hasActiveMobileDronePendingPrompt(pending, [{ id: 'pending-1' }])).toBe(false);
  });

  test('ignores stale server busy state for completed external transcripts', () => {
    expect(
      mobileChatRespondingStatus({
        localActivity: false,
        nativeRuntimeActive: false,
        nativeTranscriptLoaded: false,
        serverChatBusy: true,
      }),
    ).toBe(false);
    expect(
      mobileChatRespondingStatus({
        localActivity: false,
        nativeRuntimeActive: false,
        nativeTranscriptLoaded: true,
        serverChatBusy: true,
      }),
    ).toBe(true);
    expect(
      mobileChatRespondingStatus({
        localActivity: true,
        nativeRuntimeActive: false,
        nativeTranscriptLoaded: false,
        serverChatBusy: false,
      }),
    ).toBe(true);
  });

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

  test('does not duplicate an active prompt once its activity is in the transcript', () => {
    expect(
      mobileDronePendingPrompts(
        [
          {
            id: 'pending-activity',
            state: 'sent',
            prompt: 'Implement it',
            activity: {
              version: 1,
              source: 'codex',
              updatedAt: '2026-07-24T00:00:01.000Z',
              messages: [{ role: 'assistant', content: 'Working on it.' }],
            },
          },
        ],
        [],
      ),
    ).toEqual([]);
  });

  test('uses the confirmed queued state instead of displaying a follow-up as active', () => {
    const local = optimisticMobilePendingPrompt({
      id: 'prompt-1',
      prompt: 'Fix it',
      at: '2026-07-19T10:00:00.000Z',
      state: 'queued',
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
        state: 'queued',
      },
    ]);
  });

  test('does not relabel an initial sent message as queued during reconciliation', () => {
    const local = optimisticMobilePendingPrompt({
      id: 'initial-prompt',
      prompt: 'Start working',
      state: 'sending',
    });

    expect(
      mergeOptimisticMobilePendingPrompts({
        serverPrompts: [{ id: 'initial-prompt', prompt: 'Start working', state: 'queued' }],
        localPrompts: [local],
        turns: [],
      }),
    ).toEqual([{ ...local, state: 'sending' }]);
  });

  test('shows a follow-up as queued immediately while the active prompt is running', () => {
    const queued = optimisticMobilePendingPrompt({
      id: 'queued-local',
      prompt: 'Do this next',
      state: 'queued',
    });

    expect(mobileDronePendingPrompts([queued], [])).toEqual([
      {
        id: 'queued-local',
        prompt: 'Do this next',
        status: 'queued',
        error: null,
        imageCount: 0,
        cancelable: true,
        startedAt: queued.at,
      },
    ]);
    expect(
      confirmedMobilePendingPromptState({ pendingState: 'sending', queuedPromptId: 'queue-1' }),
    ).toBe('queued');
    expect(confirmedMobilePendingPromptState({ pendingState: 'queued' })).toBe('queued');
    expect(confirmedMobilePendingPromptState({ pendingState: 'sending' })).toBe('sending');
    expect(
      confirmedMobilePendingPromptState({
        pendingState: 'queued',
        queuedPromptId: 'transient-queue-id',
        optimisticState: 'sending',
      }),
    ).toBe('sending');
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

  test('classifies a stop as a run outcome and remembers when its message was delivered', () => {
    expect(
      mobileDronePendingPrompts(
        [
          {
            id: 'stopped',
            messageId: 'user-message',
            at: '2026-07-19T10:00:00.000Z',
            prompt: 'Make the change',
            state: 'failed',
            error: 'Stopped by user.',
          },
        ],
        [],
        [{ id: 'user-message', role: 'user', content: 'Make the change' }],
      ),
    ).toEqual([
      {
        id: 'stopped',
        prompt: 'Make the change',
        status: 'stopped',
        error: 'Stopped by user.',
        imageCount: 0,
        cancelable: false,
        startedAt: '2026-07-19T10:00:00.000Z',
        delivered: true,
      },
    ]);
  });
});
