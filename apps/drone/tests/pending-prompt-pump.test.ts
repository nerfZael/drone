import { describe, expect, test } from 'bun:test';

import {
  nativeAssistantOwnsPromptDelivery,
  PendingPromptPump,
  pendingPromptKeepsChatBusy,
} from '../src/hub/pending-prompt-pump';

describe('pending prompt ownership', () => {
  test('leaves native prompt claims to the native assistant queue', () => {
    expect(nativeAssistantOwnsPromptDelivery('native')).toBe(true);
    expect(nativeAssistantOwnsPromptDelivery('builtin')).toBe(false);
    expect(nativeAssistantOwnsPromptDelivery('custom')).toBe(false);
  });

  test('does not keep native chats busy after native delivery completes', () => {
    expect(pendingPromptKeepsChatBusy({ state: 'queued', hasTurn: false, native: true })).toBe(
      false,
    );
    expect(pendingPromptKeepsChatBusy({ state: 'queued', hasTurn: false, native: false })).toBe(
      false,
    );
    expect(pendingPromptKeepsChatBusy({ state: 'sending', hasTurn: false, native: true })).toBe(
      true,
    );
    expect(
      pendingPromptKeepsChatBusy({
        state: 'sending',
        hasTurn: false,
        native: true,
        countsAsAgentRun: false,
      }),
    ).toBe(false);
    expect(pendingPromptKeepsChatBusy({ state: 'sent', hasTurn: false, native: true })).toBe(false);
    expect(pendingPromptKeepsChatBusy({ state: 'sent', hasTurn: false, native: false })).toBe(true);
    expect(pendingPromptKeepsChatBusy({ state: 'sent', hasTurn: true, native: false })).toBe(false);
  });
});

describe('pending prompt retry scheduling', () => {
  test('deleting one chat aborts its active delivery and trailing work without aborting another chat', async () => {
    const signals = new Map<string, AbortSignal>();
    const bothStarted = Promise.withResolvers<void>();
    const runs: string[] = [];
    const pump = new PendingPromptPump({
      normalizeDroneId: (value) => value,
      normalizeChatName: (value) => value,
      concurrencyLimit: () => 2,
      defaultRetryDelayMs: () => 1_000,
      run: async ({ chatName }, signal) => {
        runs.push(chatName);
        signals.set(chatName, signal);
        if (signals.size === 2) bothStarted.resolve();
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      },
    });
    try {
      pump.enqueue('drone', 'a');
      pump.enqueue('drone', 'b');
      await bothStarted.promise;
      pump.enqueue('drone', 'a');
      pump.delete('drone', 'a');
      expect(signals.get('a')?.aborted).toBe(true);
      expect(signals.get('b')?.aborted).toBe(false);
      // Reset must abort active work before waiting for it to finish.
      await pump.reset();
      expect(signals.get('b')?.aborted).toBe(true);
      expect(runs).toEqual(['a', 'b']);
    } finally {
      await pump.stop();
    }
  });

  test('preserves a delayed retry when the same chat is also enqueued immediately', async () => {
    let runCount = 0;
    const pump = new PendingPromptPump({
      normalizeDroneId: (value) => value,
      normalizeChatName: (value) => value || 'default',
      concurrencyLimit: () => 1,
      defaultRetryDelayMs: () => 1_000,
      run: async () => {
        runCount += 1;
      },
    });

    try {
      pump.scheduleRetry('drone-1', 'default', 1_000);
      pump.enqueue('drone-1', 'default');

      await Bun.sleep(50);
      expect(runCount).toBe(1);

      await Bun.sleep(1_100);
      expect(runCount).toBe(2);
    } finally {
      await pump.reset();
    }
  });

  test('preserves distinct retry wakeups for the same chat', async () => {
    let runCount = 0;
    const pump = new PendingPromptPump({
      normalizeDroneId: (value) => value,
      normalizeChatName: (value) => value || 'default',
      concurrencyLimit: () => 1,
      defaultRetryDelayMs: () => 1_000,
      run: async () => {
        runCount += 1;
      },
    });

    try {
      pump.scheduleRetry('drone-1', 'default', 1_000);
      pump.scheduleRetry('drone-1', 'default', 1_500);

      await Bun.sleep(1_150);
      expect(runCount).toBe(1);

      await Bun.sleep(500);
      expect(runCount).toBe(2);
    } finally {
      await pump.reset();
    }
  });

  test('allows a deferred run to schedule its own wake-up', async () => {
    let runCount = 0;
    let pump: PendingPromptPump;
    pump = new PendingPromptPump({
      normalizeDroneId: (value) => value,
      normalizeChatName: (value) => value || 'default',
      concurrencyLimit: () => 1,
      defaultRetryDelayMs: () => 1_000,
      run: async () => {
        runCount += 1;
        if (runCount === 1) pump.scheduleRetry('drone-1', 'default');
      },
    });

    try {
      pump.enqueue('drone-1', 'default');

      await Bun.sleep(50);
      expect(runCount).toBe(1);

      await Bun.sleep(1_100);
      expect(runCount).toBe(2);
    } finally {
      await pump.reset();
    }
  });
});

describe('pending prompt shutdown', () => {
  test('aborts active delivery and uses a fresh signal after restart', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let runCount = 0;
    let firstRunAborted = false;
    const pump = new PendingPromptPump({
      normalizeDroneId: (value) => value,
      normalizeChatName: (value) => value || 'default',
      concurrencyLimit: () => 1,
      defaultRetryDelayMs: () => 1_000,
      run: async (_target, signal) => {
        runCount += 1;
        if (runCount > 1) {
          expect(signal.aborted).toBe(false);
          return;
        }
        markStarted();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              firstRunAborted = true;
              reject(signal.reason);
            },
            { once: true },
          );
        });
      },
    });

    pump.enqueue('drone-1', 'default');
    await started;
    await pump.stop();
    expect(firstRunAborted).toBe(true);

    pump.start();
    pump.enqueue('drone-1', 'default');
    await Bun.sleep(20);
    expect(runCount).toBe(2);
    await pump.stop();
  });
});
