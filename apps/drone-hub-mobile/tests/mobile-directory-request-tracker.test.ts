import { describe, expect, test } from 'bun:test';

import { MobileDirectoryRequestTracker } from '../src/drones/mobile-directory-request-tracker';

describe('mobile directory request tracker', () => {
  test('coalesces a forced mutation refresh behind an in-flight listing', () => {
    const tracker = new MobileDirectoryRequestTracker();
    const initial = tracker.begin('/work', false);
    expect(initial).not.toBeNull();
    expect(tracker.begin('/work', true)).toBeNull();
    expect(tracker.begin('/work', true)).toBeNull();
    expect(tracker.finish('/work', initial!)).toBe(true);

    const trailing = tracker.begin('/work', true);
    expect(trailing).not.toBeNull();
    expect(tracker.finish('/work', trailing!)).toBe(false);
  });

  test('starts exactly one fresh listing after an older response resolves', async () => {
    const tracker = new MobileDirectoryRequestTracker();
    const releases: Array<() => void> = [];
    const snapshots: string[] = [];
    const load = async (force: boolean): Promise<void> => {
      const token = tracker.begin('/work', force);
      if (!token) return;
      const snapshot = `snapshot-${snapshots.length + 1}`;
      snapshots.push(snapshot);
      await new Promise<void>((resolve) => releases.push(resolve));
      if (tracker.finish('/work', token)) void load(true);
    };

    const initial = load(false);
    await load(true);
    await load(true);
    expect(snapshots).toEqual(['snapshot-1']);
    releases.shift()?.();
    await initial;
    await Promise.resolve();
    expect(snapshots).toEqual(['snapshot-1', 'snapshot-2']);
    releases.shift()?.();
    await Promise.resolve();
    expect(snapshots).toHaveLength(2);
  });

  test('does not let a cancelled context finish a replacement request', () => {
    const tracker = new MobileDirectoryRequestTracker();
    const stale = tracker.begin('/work', false)!;
    tracker.reset();
    const replacement = tracker.begin('/work', true)!;

    expect(tracker.finish('/work', stale)).toBe(false);
    expect(tracker.begin('/work', true)).toBeNull();
    expect(tracker.finish('/work', replacement)).toBe(true);
  });
});
