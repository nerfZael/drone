/** A stopped drain must never start a prompt that was still being claimed or prepared. */
export async function drainNativePrompts<T extends { id: string }>(input: {
  signal: AbortSignal;
  waitForIdle(): Promise<void>;
  claimNext(): Promise<T | null>;
  notify(): Promise<void>;
  run(prompt: T): Promise<void>;
  complete(id: string): Promise<void>;
  fail(id: string, error: unknown): Promise<void>;
}): Promise<void> {
  await input.waitForIdle();
  while (!input.signal.aborted) {
    const queued = await input.claimNext();
    if (!queued) return;
    await input.notify();
    try {
      await input.waitForIdle();
      if (input.signal.aborted) return;
      await input.run(queued);
      if (input.signal.aborted) return;
      await input.complete(queued.id);
    } catch (error) {
      // The Stop command owns cancellation of the durable rows. A late failure
      // from this worker must not turn cancellation into an agent error.
      if (!input.signal.aborted) await input.fail(queued.id, error);
    } finally {
      await input.notify();
    }
  }
}
