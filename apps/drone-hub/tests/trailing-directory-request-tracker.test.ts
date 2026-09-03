import { describe, expect, test } from 'bun:test';

import { TrailingDirectoryRequestTracker } from '../src/droneHub/files/trailing-directory-request-tracker';

describe('TrailingDirectoryRequestTracker', () => {
  test('coalesces repeated force requests into one trailing directory load', () => {
    const tracker = new TrailingDirectoryRequestTracker();
    tracker.begin('/work/src', 1);
    tracker.requestTrailing('/work/src', 1);
    tracker.requestTrailing('/work/src', 1);

    expect(tracker.finish('/work/src', 1)).toBe(true);
    expect(tracker.finish('/work/src', 1)).toBe(false);
  });

  test('does not let a stale workspace request finish a replacement request', () => {
    const tracker = new TrailingDirectoryRequestTracker();
    tracker.begin('/work/src', 1);
    tracker.reset();
    tracker.begin('/work/src', 2);

    expect(tracker.finish('/work/src', 1)).toBe(false);
    expect(tracker.activeSequence('/work/src')).toBe(2);
    expect(tracker.finish('/work/src', 2)).toBe(false);
    expect(tracker.activeSequence('/work/src')).toBeNull();
  });

  test('drops a queued reload when its directory subtree is invalidated', () => {
    const tracker = new TrailingDirectoryRequestTracker();
    tracker.begin('/work/old', 4);
    tracker.requestTrailing('/work/old', 4);
    tracker.cancelReplacement('/work/old');

    expect(tracker.finish('/work/old', 4)).toBe(false);
  });

  test('queues data requested after a collapsed in-flight read was invalidated', () => {
    const tracker = new TrailingDirectoryRequestTracker();
    tracker.begin('/work/src', 7);
    tracker.invalidate('/work/src', 7, false);

    expect(tracker.isInvalidated('/work/src', 7)).toBe(true);
    tracker.requestTrailing('/work/src', 7);
    expect(tracker.finish('/work/src', 7)).toBe(true);
  });
});
