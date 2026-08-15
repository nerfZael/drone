import { describe, expect, test } from 'bun:test';
import { MobileMicrophoneCoordinator } from '../src/local-assistant/mobile-microphone-coordinator';

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('mobile microphone coordinator', () => {
  test('allows exactly one recording engine to own the microphone', async () => {
    const coordinator = new MobileMicrophoneCoordinator();
    const normal = coordinator.acquire('single-shot');

    expect(normal).not.toBeNull();
    expect(coordinator.getSnapshot()).toBe('single-shot');
    expect(coordinator.acquire('continuous')).toBeNull();
    expect(coordinator.acquire('companion')).toBeNull();

    await normal?.release();
    expect(coordinator.getSnapshot()).toBeNull();
    expect(coordinator.acquire('companion')?.owner).toBe('companion');
  });

  test('keeps ownership until asynchronous native cleanup finishes', async () => {
    const coordinator = new MobileMicrophoneCoordinator();
    const normal = coordinator.acquire('single-shot')!;
    const cleanup = deferred();
    const release = normal.release(() => cleanup.promise);

    expect(coordinator.getSnapshot()).toBe('single-shot');
    expect(coordinator.acquire('continuous')).toBeNull();

    cleanup.resolve();
    await release;
    expect(coordinator.getSnapshot()).toBeNull();
  });

  test('coalesces duplicate release calls and ignores stale lease tokens', async () => {
    const coordinator = new MobileMicrophoneCoordinator();
    const first = coordinator.acquire('single-shot')!;
    let cleanupCount = 0;
    const firstRelease = first.release(() => {
      cleanupCount += 1;
    });
    const duplicateRelease = first.release(() => {
      cleanupCount += 1;
    });

    await Promise.all([firstRelease, duplicateRelease]);
    const second = coordinator.acquire('continuous')!;
    await first.release();

    expect(cleanupCount).toBe(1);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    expect(coordinator.getSnapshot()).toBe('continuous');
  });

  test('notifies subscribers when ownership changes', async () => {
    const coordinator = new MobileMicrophoneCoordinator();
    const snapshots: Array<string | null> = [];
    const unsubscribe = coordinator.subscribe(() => snapshots.push(coordinator.getSnapshot()));
    const lease = coordinator.acquire('continuous')!;
    await lease.release();
    unsubscribe();

    expect(snapshots).toEqual(['continuous', null]);
  });

  test('releases ownership even when native cleanup fails', async () => {
    const coordinator = new MobileMicrophoneCoordinator();
    const lease = coordinator.acquire('single-shot')!;

    await expect(
      lease.release(() => {
        throw new Error('native cleanup failed');
      }),
    ).rejects.toThrow('native cleanup failed');

    expect(coordinator.getSnapshot()).toBeNull();
    expect(coordinator.acquire('continuous')).not.toBeNull();
  });
});
