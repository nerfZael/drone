import { expect, test } from 'bun:test';
import { retainJevDebugEntries, type JevDebugEntry } from '../src/droneHub/companion/jev-debug';

test('high volume wait decisions do not evict send decisions; history stays bounded', () => {
  const entry = (index: number, decision: 'send' | 'wait'): JevDebugEntry => ({
    id: String(index), startedAt: index, durationMs: 1, decision, delegated: decision === 'send',
    input: { transcript: 'Words', context: '', silenceMs: 40 },
  });
  const records = Array.from({ length: 200 }, (_, index) => entry(200 - index, 'wait'));
  const result = retainJevDebugEntries([...records, entry(0, 'send')]);
  expect(result).toHaveLength(51);
  expect(result.find(record => record.id === '0')?.decision).toBe('send');
  const large = records.map(record => ({ ...record, input: { ...record.input, transcript: 'x'.repeat(120000) } }));
  expect(JSON.stringify(retainJevDebugEntries(large)).length).toBeLessThan(2000000);
});
