import { describe, expect, test } from 'bun:test';

import { extractChangeRequestNumbers } from '../src/droneHub/chat/change-request-references';

describe('change request references', () => {
  test('extracts common native change request references and removes duplicates', () => {
    expect(
      extractChangeRequestNumbers(
        'Created CR #42. You can also review CR#7 or change request #42 and change-request #19.',
      ),
    ).toEqual([42, 7, 19]);
  });

  test('does not turn unrelated issue and pull request numbers into change requests', () => {
    expect(extractChangeRequestNumbers('Fixed issue #42 and opened PR #7.')).toEqual([]);
    expect(extractChangeRequestNumbers('CR #0 and change request #-1 are invalid.')).toEqual([]);
  });
});
