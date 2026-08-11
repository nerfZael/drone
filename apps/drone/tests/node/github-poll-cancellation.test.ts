import assert from 'node:assert/strict';
import test from 'node:test';

import { pollGithubRepository } from '../../src/hub/subscriptions/github-subscription-poller';

test('GitHub repository polling forwards cancellation to active fetches', async () => {
  const originalFetch = globalThis.fetch;
  let markFetchStarted!: () => void;
  const fetchStarted = new Promise<void>((resolve) => {
    markFetchStarted = resolve;
  });
  globalThis.fetch = (async (_input, init) => {
    markFetchStarted();
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }) as typeof fetch;

  try {
    const controller = new AbortController();
    const polling = pollGithubRepository('example/repository', null, new Date(), {
      token: null,
      signal: controller.signal,
    });
    await fetchStarted;
    controller.abort(new Error('test shutdown'));
    await assert.rejects(polling, /test shutdown/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
