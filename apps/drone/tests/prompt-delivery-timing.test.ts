import { describe, expect, test } from 'bun:test';

import { createPromptDeliveryTiming } from '../src/hub/prompt-delivery-timing';

describe('prompt delivery timing', () => {
  test('separates queue wait from measured delivery phases', async () => {
    let epochMs = Date.parse('2026-08-11T22:54:02.000Z');
    let monotonicMs = 100;
    const timing = createPromptDeliveryTiming(
      {
        promptId: 'prompt-1',
        droneId: 'drone-1',
        chatName: 'default',
        submittedAt: '2026-08-11T22:53:07.000Z',
      },
      {
        epochMs: () => epochMs,
        monotonicMs: () => monotonicMs,
      },
    );

    await timing.measure('syncSkills', async () => {
      monotonicMs += 12.34;
    });
    await timing.measure('syncSkills', async () => {
      monotonicMs += 0.06;
    });
    monotonicMs += 7.6;
    epochMs += 20;

    expect(timing.snapshot()).toEqual({
      promptId: 'prompt-1',
      droneId: 'drone-1',
      chatName: 'default',
      submittedAt: '2026-08-11T22:53:07.000Z',
      attemptStartedAt: '2026-08-11T22:54:02.000Z',
      queueWaitMs: 55_000,
      attemptDurationMs: 20,
      phases: { syncSkills: 12.4 },
    });
  });

  test('can include dispatch selection that happened before the prompt was identified', () => {
    const timing = createPromptDeliveryTiming(
      {
        promptId: 'prompt-2',
        droneId: 'drone-1',
        chatName: 'default',
        submittedAt: '2026-08-11T22:53:07.000Z',
        attemptStartedEpochMs: Date.parse('2026-08-11T22:54:00.000Z'),
        attemptStartedMonotonicMs: 75,
      },
      {
        epochMs: () => Date.parse('2026-08-11T22:54:02.000Z'),
        monotonicMs: () => 100,
      },
    );

    expect(timing.snapshot()).toMatchObject({
      attemptStartedAt: '2026-08-11T22:54:00.000Z',
      queueWaitMs: 53_000,
      attemptDurationMs: 25,
    });
  });
});
