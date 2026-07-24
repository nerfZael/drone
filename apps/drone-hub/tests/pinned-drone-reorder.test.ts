import { describe, expect, test } from 'bun:test';
import { reorderVisiblePinnedDroneIds } from '../src/droneHub/app/pinned-drone-order';

describe('pinned drone reorder', () => {
  test('moves a pinned drone before another pinned drone', () => {
    expect(
      reorderVisiblePinnedDroneIds(
        ['alpha', 'bravo', 'charlie'],
        ['alpha', 'bravo', 'charlie'],
        'charlie',
        'alpha',
        'before',
      ),
    ).toEqual(['charlie', 'alpha', 'bravo']);
  });

  test('moves a pinned drone after another pinned drone', () => {
    expect(
      reorderVisiblePinnedDroneIds(
        ['alpha', 'bravo', 'charlie'],
        ['alpha', 'bravo', 'charlie'],
        'alpha',
        'bravo',
        'after',
      ),
    ).toEqual(['bravo', 'alpha', 'charlie']);
  });

  test('preserves hidden repository positions while reordering visible drones', () => {
    expect(
      reorderVisiblePinnedDroneIds(
        ['alpha', 'hidden-one', 'bravo', 'hidden-two', 'charlie'],
        ['alpha', 'bravo', 'charlie'],
        'charlie',
        'alpha',
        'before',
      ),
    ).toEqual(['charlie', 'hidden-one', 'alpha', 'hidden-two', 'bravo']);
  });

  test('ignores invalid and same-item drops', () => {
    expect(
      reorderVisiblePinnedDroneIds(
        ['alpha', 'bravo'],
        ['alpha', 'bravo'],
        'alpha',
        'alpha',
        'after',
      ),
    ).toEqual(['alpha', 'bravo']);
    expect(
      reorderVisiblePinnedDroneIds(
        ['alpha', 'bravo'],
        ['alpha'],
        'alpha',
        'bravo',
        'before',
      ),
    ).toEqual(['alpha', 'bravo']);
  });
});
