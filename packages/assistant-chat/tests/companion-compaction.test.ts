import { expect, test } from 'bun:test';
import { companionCompactionLabel, reduceCompanionCompaction } from '../src/companion-compaction';

test('compaction presentation distinguishes estimates, fallback, and terminal outcomes', () => {
  const completed = reduceCompanionCompaction(null, {
    type: 'compaction_completed', tokensBefore: 100, tokensAfter: 20, fallbackUsed: true,
  })!;
  expect(companionCompactionLabel(completed)).toBe('Context compacted · ~100 → ~20 tokens · fallback summary');
  expect(companionCompactionLabel({ status: 'running' })).toBe('Compacting context…');
  expect(companionCompactionLabel({ status: 'skipped' })).toBe('Context compaction skipped');
  expect(companionCompactionLabel({ status: 'cancelled' })).toBe('Context compaction stopped');
  expect(companionCompactionLabel({ status: 'failed' })).toBe('Context compaction failed');
  expect(companionCompactionLabel({ status: 'interrupted' })).toBe('Context compaction ended without a result');
  expect(reduceCompanionCompaction(completed, { type: 'assistant_delta' })).toBe(completed);
  expect(companionCompactionLabel(reduceCompanionCompaction(null, {
    type: 'compaction_completed', tokensBefore: NaN, tokensAfter: -1,
  })!)).toBe('Context compacted');
});
