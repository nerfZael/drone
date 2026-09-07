import { expect, test } from 'bun:test';
import { containerMediaPhases } from '../src/hub/filesystem-media-range';

test('container phase diagnostics only retain bounded allowlisted numbers', () => {
  expect(containerMediaPhases([
    '__PERF__\tmedia_mime\t1200', '__PERF__\tmedia_encode\t3400',
    '__PERF__\tprivate_path\t1', '__PERF__\tmedia_hash\t-1',
    '__PERF__\tmedia_hash\t60000001', 'unrelated private error text',
  ].join('\n'))).toEqual([['media_mime', 1.2], ['media_encode', 3.4]]);
});
