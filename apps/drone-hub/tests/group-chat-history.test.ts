import { describe, expect, test } from 'bun:test';

import {
  createGroupChatOlderLoadCoordinator,
  groupChatScrollTopAfterPrepend,
  groupChatTailHasOlder,
} from '../src/droneHub/app/group-chat-history';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe('group chat history', () => {
  test('uses transcript totals to decide whether the initial tail has older messages', () => {
    expect(groupChatTailHasOlder(125, 50, 50)).toBe(true);
    expect(groupChatTailHasOlder(50, 50, 50)).toBe(false);
    expect(groupChatTailHasOlder(null, 50, 50)).toBe(true);
    expect(groupChatTailHasOlder(null, 49, 50)).toBe(false);
  });

  test('preserves the visible position when older content is prepended', () => {
    expect(
      groupChatScrollTopAfterPrepend({ scrollHeight: 1_000, scrollTop: 30 }, 1_700),
    ).toBe(730);
  });

  test.each(['success', 'error'] as const)(
    'resumes polling once when an older load is queued behind a busy poll: %s',
    async (outcome) => {
      const olderLoad = deferred();
      const loadingStates: boolean[] = [];
      const errors: unknown[] = [];
      let loadCount = 0;
      let resumeCount = 0;
      const coordinator = createGroupChatOlderLoadCoordinator({
        load: async () => {
          loadCount += 1;
          await olderLoad.promise;
        },
        onError: (error) => errors.push(error),
        onLoadingChange: (loading) => loadingStates.push(loading),
        resumePolling: () => {
          resumeCount += 1;
        },
      });

      expect(coordinator.request(true)).toBe('queued');
      expect(coordinator.request(true)).toBe('queued');
      expect(loadCount).toBe(0);
      expect(coordinator.startQueuedAfterRegularLoad(true)).toBe(true);
      expect(loadCount).toBe(1);
      expect(coordinator.startQueuedAfterRegularLoad(true)).toBe(false);

      const expectedError = new Error('older history failed');
      if (outcome === 'success') olderLoad.resolve();
      else olderLoad.reject(expectedError);
      await coordinator.waitForIdle();

      expect(loadingStates).toEqual([true, false]);
      expect(errors).toEqual(outcome === 'error' ? [expectedError] : []);
      expect(resumeCount).toBe(1);
    },
  );
});
