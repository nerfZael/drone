import { describe, expect, test } from 'bun:test';
import {
  mergeSeenModelIds,
  normalizeSeenModelIds,
  SEEN_SPAWN_MODEL_LIMIT,
} from '../src/droneHub/app/spawn-model-history';

describe('spawn model history', () => {
  test('normalizes and de-duplicates seen model ids', () => {
    expect(normalizeSeenModelIds([' gpt-5.4 ', '', 'gpt-5.4', null, 'o3'])).toEqual([
      'gpt-5.4',
      'o3',
    ]);
  });

  test('prepends newly seen models ahead of older history', () => {
    expect(mergeSeenModelIds(['gpt-4.1', 'o3'], ['gpt-5.4', 'o3'])).toEqual([
      'gpt-5.4',
      'o3',
      'gpt-4.1',
    ]);
  });

  test('caps history length', () => {
    const ids = Array.from({ length: SEEN_SPAWN_MODEL_LIMIT + 5 }, (_, index) => `model-${index}`);
    expect(normalizeSeenModelIds(ids)).toHaveLength(SEEN_SPAWN_MODEL_LIMIT);
    expect(mergeSeenModelIds([], ids)).toHaveLength(SEEN_SPAWN_MODEL_LIMIT);
  });
});
