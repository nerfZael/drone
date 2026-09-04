import { describe, expect, test } from 'bun:test';

import { mapInBatches } from '../src/hub/map-in-batches';

describe('mapInBatches', () => {
  test('preserves order while bounding concurrent metadata work', async () => {
    let active = 0;
    let peak = 0;
    const values = Array.from({ length: 11 }, (_, index) => index);

    const results = await mapInBatches(values, 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value % 2));
      active -= 1;
      return value * 2;
    });

    expect(results).toEqual(values.map((value) => value * 2));
    expect(peak).toBe(3);
  });

  test('stops later batches after a mapper failure', async () => {
    const visited: number[] = [];
    await expect(
      mapInBatches([0, 1, 2, 3], 2, async (value) => {
        visited.push(value);
        if (value === 1) throw new Error('lstat failed');
        return value;
      }),
    ).rejects.toThrow('lstat failed');
    expect(visited).toEqual([0, 1]);
  });
});
