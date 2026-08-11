import { describe, expect, test } from 'bun:test';
import { renderItemsFromMessages } from '@drone/assistant-chat';
import { mobileDroneTurnsToAssistantMessages } from '../src/drones/drone-sidebar-model';
import {
  confirmOptimisticMobilePendingPrompt,
  confirmedMobilePendingPromptState,
  hasActiveMobileDronePendingPrompt,
  latestActiveMobileAgentPrompt,
  mergeOptimisticMobilePendingPrompts,
  mobileChatRespondingStatus,
  mobileDronePendingPrompts,
  optimisticMobilePendingPrompt,
} from '../src/drones/mobile-pending-prompts';
import { groupMobileTranscriptRuns } from '../src/local-assistant/mobile-transcript-runs';

describe('mobile drone pending prompts', () => {
  test('tracks activity-backed pending runs until their completed turn arrives', () => {
    const pending = [{ id: 'pending-1', state: 'sent', activity: { messages: [] } }];
    expect(hasActiveMobileDronePendingPrompt(pending, [])).toBe(true);
    expect(hasActiveMobileDronePendingPrompt(pending, [{ id: 'pending-1' }])).toBe(false);
    expect(hasActiveMobileDronePendingPrompt([{ state: 'sent' }], [])).toBe(false);
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
            startedAt: '2026-07-20T10:05:00.000Z',
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
      startedAt: '2026-07-20T10:05:00.000Z',
      agentPlan: { items: [{ text: 'Edit mobile UI', status: 'in_progress' }] },
    });
  });

  test('preserves queued new-chat actions for the mobile Create now UI', () => {
    expect(
      mobileDronePendingPrompts(
        [
          {
            id: 'review-action',
            at: '2026-07-20T10:00:00.000Z',
            state: 'queued',
            prompt: 'Review the finished implementation',
            action: { type: 'send-in-new-chat', sourceChatName: 'default' },
          },
        ],
        [],
      )[0],
    ).toMatchObject({
      id: 'review-action',
      status: 'queued',
      cancelable: true,
      action: { type: 'send-in-new-chat', sourceChatName: 'default' },
    });
  });

  test('does not treat an executing new-chat action as an agent run', () => {
    const action = {
      id: 'review-action',
      prompt: 'Review it',
      status: 'pending' as const,
      error: null,
      imageCount: 0,
      cancelable: false,
      action: { type: 'send-in-new-chat' as const, sourceChatName: 'default' },
    };
    expect(
      hasActiveMobileDronePendingPrompt(
        [
          {
            id: action.id,
            state: 'sending',
            action: action.action,
          },
        ],
        [],
      ),
    ).toBe(false);
    expect(latestActiveMobileAgentPrompt([action])).toBeUndefined();
    expect(
      latestActiveMobileAgentPrompt([
        action,
        {
          id: 'agent-prompt',
          prompt: 'Implement it',
          status: 'pending',
          error: null,
          imageCount: 0,
          cancelable: false,
        },
      ])?.id,
    ).toBe('agent-prompt');
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

  test('leaves empty live activity to the transcript working row without duplicating the prompt', () => {
    const pending = [
      {
        id: 'pending-empty-activity',
        state: 'sent',
        prompt: 'Implement it',
        at: '2026-07-24T00:00:00.000Z',
        activity: {
          version: 1,
          source: 'codex',
          updatedAt: '2026-07-24T00:00:01.000Z',
          messages: [],
        },
      },
    ];
    expect(mobileDronePendingPrompts(pending, [])).toEqual([]);
    const messages = mobileDroneTurnsToAssistantMessages([], pending);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'Implement it' });
    const groups = groupMobileTranscriptRuns(renderItemsFromMessages(messages), { running: true });
    expect(groups).toMatchObject([{ type: 'run', active: true }]);
    expect(groups[0]?.type === 'run' ? groups[0].startedAt : null).toBeUndefined();
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

  test('normalizes the legacy running server state to active sending', () => {
    const local = optimisticMobilePendingPrompt({
      id: 'legacy-running',
      prompt: 'Keep working',
      state: 'queued',
    });

    expect(
      mergeOptimisticMobilePendingPrompts({
        serverPrompts: [{ id: 'legacy-running', prompt: 'Keep working', state: 'running' }],
        localPrompts: [local],
        turns: [],
      }),
    ).toEqual([{ ...local, state: 'sending' }]);
  });

  test('replaces the optimistic id while retaining mobile attachment counts', () => {
    const local = optimisticMobilePendingPrompt({
      id: 'optimistic-1',
      prompt: 'Review both files',
      attachmentCount: 2,
      imageCount: 1,
    });

    expect(
      confirmOptimisticMobilePendingPrompt([local], {
        optimisticId: 'optimistic-1',
        confirmedId: 'server-1',
        state: 'sent',
      }),
    ).toEqual([{ ...local, id: 'server-1', state: 'sent' }]);
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

  test('retains stopped and failed outcomes after their completed turn arrives', () => {
    const stopped = {
      ...optimisticMobilePendingPrompt({
        id: 'stopped-local',
        prompt: 'Stop this',
      }),
      state: 'failed' as const,
      error: 'Stopped by user.',
    };
    const failed = {
      ...optimisticMobilePendingPrompt({
        id: 'failed-local',
        prompt: 'Run this',
      }),
      state: 'failed' as const,
      error: 'Agent crashed',
    };

    expect(
      mergeOptimisticMobilePendingPrompts({
        serverPrompts: [],
        localPrompts: [stopped, failed],
        turns: [{ id: 'stopped-local' }, { id: 'failed-local' }],
      }),
    ).toEqual([stopped, failed]);
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

  test('leaves failed activity in the transcript while retaining only a delivered stop notice', () => {
    const activity = {
      version: 1,
      source: 'codex',
      updatedAt: '2026-07-19T10:00:01.000Z',
      messages: [],
    };

    expect(
      mobileDronePendingPrompts(
        [
          {
            id: 'failed-with-activity',
            prompt: 'Make the change',
            state: 'failed',
            error: 'Agent crashed',
            activity,
          },
        ],
        [],
      ),
    ).toEqual([]);

    expect(
      mobileDronePendingPrompts(
        [
          {
            id: 'stopped-with-activity',
            prompt: 'Make the change',
            state: 'failed',
            error: 'Stopped by user.',
            activity,
          },
        ],
        [],
      ),
    ).toEqual([
      {
        id: 'stopped-with-activity',
        prompt: 'Make the change',
        status: 'stopped',
        error: 'Stopped by user.',
        imageCount: 0,
        cancelable: false,
        delivered: true,
      },
    ]);
  });

  test('retains an interrupted activity row so the queue can be explicitly resumed', () => {
    const queueInterruption = {
      state: 'blocked' as const,
      at: '2026-08-11T09:00:00.000Z',
    };
    expect(
      mobileDronePendingPrompts(
        [
          {
            id: 'interrupted-with-activity',
            prompt: 'Finish the implementation',
            state: 'failed',
            error: 'stream disconnected before completion',
            queueInterruption,
            activity: {
              version: 1,
              source: 'codex',
              updatedAt: '2026-08-11T09:00:01.000Z',
              messages: [],
            },
          },
        ],
        [],
      ),
    ).toEqual([
      {
        id: 'interrupted-with-activity',
        prompt: 'Finish the implementation',
        status: 'failed',
        error: 'stream disconnected before completion',
        imageCount: 0,
        cancelable: false,
        delivered: true,
        queueInterruption,
      },
    ]);
  });
});
