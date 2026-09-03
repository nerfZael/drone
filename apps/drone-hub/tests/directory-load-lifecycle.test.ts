import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { deferDirectoryLoadWhileActive } from '../src/droneHub/files/defer-directory-load';
import { TrailingDirectoryRequestTracker } from '../src/droneHub/files/trailing-directory-request-tracker';

describe('directory load lifecycle', () => {
  test('expanding after a collapsed mutation invalidation schedules one replacement load', () => {
    const tracker = new TrailingDirectoryRequestTracker();
    let sequence = 1;
    let requestCount = 1;
    tracker.begin('/work/src', sequence);

    // The mutation happens while the directory is collapsed, so it invalidates
    // the active response without eagerly loading the directory.
    tracker.invalidate('/work/src', sequence, false);
    sequence += 1;

    // Expanding before the stale response settles must queue a replacement.
    expect(deferDirectoryLoadWhileActive(tracker, '/work/src', false)).toBe(true);
    const runTrailing = tracker.finish('/work/src', 1);
    if (runTrailing) {
      requestCount += 1;
      tracker.begin('/work/src', sequence);
    }

    expect(runTrailing).toBe(true);
    expect(requestCount).toBe(2);
    expect(deferDirectoryLoadWhileActive(tracker, '/work/src', false)).toBe(true);
    expect(tracker.finish('/work/src', sequence)).toBe(false);
  });

  test('DroneFilesDock uses the invalidation-aware lifecycle gate', () => {
    const source = readFileSync(
      new URL('../src/droneHub/files/DroneFilesDock.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('deferDirectoryLoadWhileActive(');
    expect(source).toContain('childRequestTrackerRef.current.invalidate(');
  });
});
