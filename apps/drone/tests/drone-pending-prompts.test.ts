import { describe, expect, test } from 'bun:test';

import { updateRegistry } from '../src/host/registry';
import { createDronePendingPromptStore } from '../src/hub/drone-pending-prompts';
import { createPendingDroneStateHelpers } from '../src/hub/drone-pending-state';
import { resetTranscriptStoreForTests } from '../src/hub/transcript-store';
import { withTempDroneDataDir } from './test-helpers';

const pendingStateHelpers = createPendingDroneStateHelpers({
  normalizeChatName: (raw: any) => String(raw ?? 'default').trim() || 'default',
  nowIso: () => '2026-03-26T10:00:00.000Z',
});

const pendingPromptStore = createDronePendingPromptStore({
  normalizeChatImageAttachmentRefs: () => [],
  normalizeChatName: (raw: any) => String(raw ?? 'default').trim() || 'default',
  normalizePendingPromptState: pendingStateHelpers.normalizePendingPromptState,
  normalizePendingPromptText: pendingStateHelpers.normalizePendingPromptText,
  normalizePendingStartupPrompts: pendingStateHelpers.normalizePendingStartupPrompts,
  normalizePromptAutomationMeta: () => undefined,
  nowIso: () => '2026-03-26T10:00:00.000Z',
  startupPromptToPendingPrompt: pendingStateHelpers.startupPromptToPendingPrompt,
});

describe('drone pending prompt store', () => {
  test('pushes pending prompts idempotently and can claim them for sending', async () => {
    await withTempDroneDataDir('drone-pending-prompts-', async () => {
      await updateRegistry((reg: any) => {
        reg.drones = {
          'drone-1': { id: 'drone-1', name: 'drone-1', chats: { default: { createdAt: '2026-03-26T09:00:00.000Z' } } },
        };
      });

      await pendingPromptStore.pushPendingPrompt({
        droneId: 'drone-1',
        chatName: 'default',
        pending: {
          id: 'prompt-1',
          at: '2026-03-26T09:01:00.000Z',
          prompt: 'first',
          state: 'queued',
        },
      });
      await pendingPromptStore.pushPendingPrompt({
        droneId: 'drone-1',
        chatName: 'default',
        pending: {
          id: 'prompt-1',
          at: '2026-03-26T09:01:00.000Z',
          prompt: 'first revised',
          state: 'queued',
          updatedAt: '2026-03-26T09:02:00.000Z',
        },
      });

      const beforeClaim = await pendingPromptStore.readPendingPrompts({ droneId: 'drone-1', chatName: 'default' });
      expect(beforeClaim).toHaveLength(1);
      expect(beforeClaim[0]).toMatchObject({ id: 'prompt-1', prompt: 'first revised', state: 'queued' });

      const claimed = await pendingPromptStore.claimQueuedPendingPromptForSending({
        droneId: 'drone-1',
        chatName: 'default',
        id: 'prompt-1',
      });

      expect(claimed).toBe(true);
      const afterClaim = await pendingPromptStore.readPendingPrompts({ droneId: 'drone-1', chatName: 'default' });
      expect(afterClaim[0]).toMatchObject({ id: 'prompt-1', state: 'sending' });
    });
  });

  test('claims legacy registry-only queued prompts and backfills the store', async () => {
    await withTempDroneDataDir('drone-pending-prompts-', async () => {
      await updateRegistry((reg: any) => {
        reg.drones = {
          'drone-legacy': {
            id: 'drone-legacy',
            name: 'drone-legacy',
            chats: {
              default: {
                createdAt: '2026-03-26T09:00:00.000Z',
                pendingPrompts: [
                  {
                    id: 'legacy-queued',
                    at: '2026-03-26T09:01:00.000Z',
                    prompt: 'legacy queued',
                    state: 'queued',
                  },
                ],
              },
            },
          },
        };
      });
      resetTranscriptStoreForTests();

      const claimed = await pendingPromptStore.claimQueuedPendingPromptForSending({
        droneId: 'drone-legacy',
        chatName: 'default',
        id: 'legacy-queued',
      });

      expect(claimed).toBe(true);
      const afterClaim = await pendingPromptStore.readPendingPrompts({ droneId: 'drone-legacy', chatName: 'default' });
      expect(afterClaim[0]).toMatchObject({ id: 'legacy-queued', state: 'sending' });
    });
  });

  test('preserves status-unavailable observability metadata separately from failure state', async () => {
    await withTempDroneDataDir('drone-pending-prompts-', async () => {
      await updateRegistry((reg: any) => {
        reg.drones = {
          'drone-observed': {
            id: 'drone-observed',
            name: 'drone-observed',
            chats: {
              default: {
                createdAt: '2026-03-26T09:00:00.000Z',
                pendingPrompts: [
                  {
                    id: 'status-stale',
                    at: '2026-03-26T09:01:00.000Z',
                    prompt: 'long running',
                    state: 'sent',
                  },
                ],
              },
            },
          },
        };
      });

      await pendingPromptStore.updatePendingPrompt({
        droneId: 'drone-observed',
        chatName: 'default',
        id: 'status-stale',
        patch: {
          state: 'sent',
          observability: {
            state: 'status-unavailable',
            message: 'Prompt status is temporarily unavailable. The agent may still be running.',
            lastCheckedAt: '2026-03-26T09:12:00.000Z',
            lastError: 'request timeout after 5000ms: GET /v1/prompts/status-stale',
          },
          updatedAt: '2026-03-26T09:12:00.000Z',
        },
      });

      const pending = await pendingPromptStore.readPendingPrompts({ droneId: 'drone-observed', chatName: 'default' });
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        id: 'status-stale',
        state: 'sent',
        observability: {
          state: 'status-unavailable',
          message: 'Prompt status is temporarily unavailable. The agent may still be running.',
          lastCheckedAt: '2026-03-26T09:12:00.000Z',
        },
      });
      expect(pending[0]?.state).not.toBe('failed');
    });
  });

  test('cancels queued prompts and falls back to transcript turns for already-submitted prompts', async () => {
    await withTempDroneDataDir('drone-pending-prompts-', async () => {
      await updateRegistry((reg: any) => {
        reg.drones = {
          'drone-2': {
            id: 'drone-2',
            name: 'drone-2',
            chats: {
              default: {
                createdAt: '2026-03-26T09:00:00.000Z',
                pendingPrompts: [{ id: 'queued-1', at: '2026-03-26T09:01:00.000Z', prompt: 'queued', state: 'queued' }],
                turns: [{ id: 'sent-1', at: '2026-03-26T09:03:00.000Z', output: 'done', ok: true }],
              },
            },
          },
        };
      });

      const cancelled = await pendingPromptStore.cancelQueuedPendingPrompt({
        droneId: 'drone-2',
        chatName: 'default',
        promptId: 'queued-1',
      });
      expect(cancelled).toEqual({ status: 'cancelled', pendingState: 'queued' });

      const alreadySubmitted = await pendingPromptStore.cancelQueuedPendingPrompt({
        droneId: 'drone-2',
        chatName: 'default',
        promptId: 'sent-1',
      });
      expect(alreadySubmitted).toEqual({ status: 'already-submitted', pendingState: 'sent' });
    });
  });

  test('queues startup prompts on pending drones and reads them back as pending prompts', async () => {
    await withTempDroneDataDir('drone-pending-prompts-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-3': { id: 'drone-3', name: 'drone-3', startupQueuedPrompts: [] },
        };
      });

      const queued = await pendingPromptStore.pushPendingStartupPrompt({
        droneId: 'drone-3',
        chatName: 'ops',
        pending: {
          id: 'startup-1',
          at: '2026-03-26T09:05:00.000Z',
          prompt: 'boot',
          state: 'queued',
        },
      });
      expect(queued).toBe('queued');

      const startupPrompts = await pendingPromptStore.readPendingStartupPrompts({ droneId: 'drone-3', chatName: 'ops' });
      expect(startupPrompts).toEqual([
        {
          id: 'startup-1',
          at: '2026-03-26T09:05:00.000Z',
          prompt: 'boot',
          state: 'queued',
          updatedAt: '2026-03-26T10:00:00.000Z',
        },
      ]);
    });
  });

  test('prunes transcript-completed pending prompts unless kept in the recent grace window', () => {
    const entry = {
      pendingPrompts: [
        { id: 'done-1', at: '2026-03-26T09:00:00.000Z', prompt: 'done', state: 'sent', updatedAt: '2026-03-26T09:01:00.000Z' },
        { id: 'live-1', at: '2026-03-26T09:02:00.000Z', prompt: 'live', state: 'sending' },
      ],
      turns: [{ id: 'done-1', at: '2026-03-26T09:01:30.000Z', completedAt: '2026-03-26T09:01:30.000Z' }],
    };

    const pruned = pendingPromptStore.pendingPromptsFromChatEntry(entry);
    expect(pruned.map((item) => item.id)).toEqual(['live-1']);

    const keptRecent = pendingPromptStore.pruneCompletedPendingPrompts(
      pendingPromptStore.pendingPromptsFromChatEntry({
        pendingPrompts: [{ id: 'done-1', at: '2026-03-26T09:00:00.000Z', prompt: 'done', state: 'sent', updatedAt: '2026-03-26T09:01:00.000Z' }],
      }),
      [{ id: 'done-1', completedAt: '2026-03-26T09:01:30.000Z' }],
      { keepRecentlyCompleted: true, nowMs: Date.parse('2026-03-26T09:02:00.000Z') },
    );
    expect(keptRecent.map((item) => item.id)).toEqual(['done-1']);
  });
});
