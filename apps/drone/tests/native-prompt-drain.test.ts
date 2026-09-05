import { expect, test } from 'bun:test';
import { drainNativePrompts } from '../src/hub/native-prompt-drain';

test('Stop during a durable claim prevents the claimed prompt from starting', async () => {
  const controller = new AbortController();
  const claimed = Promise.withResolvers<void>();
  const releaseClaim = Promise.withResolvers<{ id: string }>();
  const actions: string[] = [];
  const drain = drainNativePrompts({
    signal: controller.signal,
    waitForIdle: async () => {},
    claimNext: () => {
      claimed.resolve();
      return releaseClaim.promise;
    },
    notify: async () => {},
    run: async () => {
      actions.push('run');
    },
    complete: async () => {
      actions.push('complete');
    },
    fail: async () => {
      actions.push('fail');
    },
  });
  await claimed.promise;
  controller.abort();
  releaseClaim.resolve({ id: 'stopped' });
  await drain;
  expect(actions).toEqual([]);
});

test('a stopped run cannot complete or drain the next queued message', async () => {
  const controller = new AbortController();
  const running = Promise.withResolvers<void>();
  const finishRun = Promise.withResolvers<void>();
  let claims = 0;
  const actions: string[] = [];
  const drain = drainNativePrompts({
    signal: controller.signal,
    waitForIdle: async () => {},
    claimNext: async () => ({ id: String(++claims) }),
    notify: async () => {},
    run: async () => {
      running.resolve();
      await finishRun.promise;
    },
    complete: async () => {
      actions.push('complete');
    },
    fail: async () => {
      actions.push('fail');
    },
  });
  await running.promise;
  controller.abort();
  finishRun.resolve();
  await drain;
  expect(claims).toBe(1);
  expect(actions).toEqual([]);
});
