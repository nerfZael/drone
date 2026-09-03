import { describe, expect, test } from 'bun:test';

import {
  createHistoryRefreshCoordinator,
  type HistoryRefreshOptions,
} from '../src/droneHub/assistant/history-refresh-coordinator';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('history refresh coordinator', () => {
  test('coalesces overlap and preserves one trailing refresh', async () => {
    const runs: Array<{ options: HistoryRefreshOptions; request: ReturnType<typeof deferred> }> = [];
    const coordinator = createHistoryRefreshCoordinator(async (options) => {
      const request = deferred();
      runs.push({ options, request });
      await request.promise;
    });

    const initial = coordinator.refresh({ quiet: true, preserveContextUsage: true });
    await Promise.resolve();
    expect(runs).toHaveLength(1);

    const overlappingQuiet = coordinator.refresh({ quiet: true, preserveContextUsage: true });
    const overlappingVisible = coordinator.refresh({ quiet: false });
    expect(runs).toHaveLength(1);

    runs[0]!.request.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toHaveLength(2);
    expect(runs[1]!.options).toEqual({ quiet: false, preserveContextUsage: false });

    let settled = false;
    void initial.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    runs[1]!.request.resolve();
    await Promise.all([initial, overlappingQuiet, overlappingVisible]);
    expect(settled).toBe(true);
  });
});
