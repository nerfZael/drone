import { describe, expect, test } from 'bun:test';

import {
  captureHubProcessMemory,
  hubMemoryDiagnosticsEnabled,
} from '../src/hub/hub-memory-diagnostics';

describe('Hub memory diagnostics', () => {
  test('stays opt-in and accepts conventional enabled values', () => {
    expect(hubMemoryDiagnosticsEnabled(undefined)).toBe(false);
    expect(hubMemoryDiagnosticsEnabled('0')).toBe(false);
    expect(hubMemoryDiagnosticsEnabled('true')).toBe(true);
    expect(hubMemoryDiagnosticsEnabled('ON')).toBe(true);
  });

  test('captures the process memory fields used by request diagnostics', () => {
    const memory = captureHubProcessMemory();
    expect(memory.rssBytes).toBeGreaterThan(0);
    expect(memory.heapUsedBytes).toBeGreaterThan(0);
    expect(memory.heapTotalBytes).toBeGreaterThan(0);
    expect(memory.externalBytes).toBeGreaterThanOrEqual(0);
    expect(memory.arrayBuffersBytes).toBeGreaterThanOrEqual(0);
  });
});
