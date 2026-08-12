export type PromptDeliveryTimingSnapshot = {
  promptId: string;
  droneId: string;
  chatName: string;
  submittedAt: string | null;
  attemptStartedAt: string;
  queueWaitMs: number | null;
  attemptDurationMs: number;
  phases: Record<string, number>;
};

type PromptDeliveryClock = {
  epochMs(): number;
  monotonicMs(): number;
};

const systemClock: PromptDeliveryClock = {
  epochMs: () => Date.now(),
  monotonicMs: () => performance.now(),
};

function roundedMs(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

export function createPromptDeliveryTiming(
  input: {
    promptId: string;
    droneId: string;
    chatName: string;
    submittedAt?: string | null;
    attemptStartedEpochMs?: number;
    attemptStartedMonotonicMs?: number;
  },
  clock: PromptDeliveryClock = systemClock,
) {
  const attemptStartedEpochMs = Number.isFinite(input.attemptStartedEpochMs)
    ? Number(input.attemptStartedEpochMs)
    : clock.epochMs();
  const attemptStartedMonotonicMs = Number.isFinite(input.attemptStartedMonotonicMs)
    ? Number(input.attemptStartedMonotonicMs)
    : clock.monotonicMs();
  const submittedAt = String(input.submittedAt ?? '').trim() || null;
  const submittedAtMs = submittedAt ? Date.parse(submittedAt) : NaN;
  const phases = new Map<string, number>();

  function record(name: string, durationMs: number): void {
    if (!Number.isFinite(durationMs)) return;
    phases.set(name, roundedMs((phases.get(name) ?? 0) + durationMs));
  }

  async function measure<T>(name: string, run: () => Promise<T>): Promise<T> {
    const startedAt = clock.monotonicMs();
    try {
      return await run();
    } finally {
      record(name, clock.monotonicMs() - startedAt);
    }
  }

  function snapshot(): PromptDeliveryTimingSnapshot {
    return {
      promptId: input.promptId,
      droneId: input.droneId,
      chatName: input.chatName,
      submittedAt,
      attemptStartedAt: new Date(attemptStartedEpochMs).toISOString(),
      queueWaitMs: Number.isFinite(submittedAtMs)
        ? roundedMs(Math.max(0, attemptStartedEpochMs - submittedAtMs))
        : null,
      attemptDurationMs: roundedMs(clock.monotonicMs() - attemptStartedMonotonicMs),
      phases: Object.fromEntries(phases),
    };
  }

  return { measure, record, snapshot };
}

export type PromptDeliveryTiming = ReturnType<typeof createPromptDeliveryTiming>;
