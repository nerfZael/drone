import { describe, expect, test } from 'bun:test';
import { sanitizeDroneSummary } from '../src/hub/remote-server';

describe('remote Hub server', () => {
  test('preserves repo metadata for remote sidebar grouping', () => {
    const summary = sanitizeDroneSummary({
      id: 'drone-a',
      name: 'Drone A',
      runtime: 'container',
      repoAttached: true,
      repoPath: '/work/repos/example',
      repoBranch: 'feature/remote',
      statusOk: true,
    });

    expect(summary.repoAttached).toBe(true);
    expect(summary.repoPath).toBe('/work/repos/example');
    expect(summary.repoBranch).toBe('feature/remote');
  });
});
