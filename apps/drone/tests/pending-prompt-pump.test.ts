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
    expect(
      pendingPromptKeepsChatBusy({ state: 'queued', hasTurn: false, native: true }),
    ).toBe(false);
    expect(
      pendingPromptKeepsChatBusy({ state: 'queued', hasTurn: false, native: false }),
    ).toBe(false);
    expect(
      pendingPromptKeepsChatBusy({ state: 'sending', hasTurn: false, native: true }),
    ).toBe(true);
    expect(
      pendingPromptKeepsChatBusy({ state: 'sent', hasTurn: false, native: true }),
    ).toBe(false);
    expect(
      pendingPromptKeepsChatBusy({ state: 'sent', hasTurn: false, native: false }),
    ).toBe(true);
    expect(
      pendingPromptKeepsChatBusy({ state: 'sent', hasTurn: true, native: false }),
    ).toBe(false);
  });
});

describe('pending prompt retry scheduling', () => {
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
});
