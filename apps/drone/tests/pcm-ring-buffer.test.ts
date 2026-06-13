import { describe, expect, test } from 'bun:test';

import { PcmRingBuffer } from '../src/hub/pcm-ring-buffer';

describe('PcmRingBuffer', () => {
  test('drops oldest audio when the buffer exceeds its byte limit', () => {
    const buffer = new PcmRingBuffer(6);
    buffer.push(Buffer.from([1, 2, 3]));
    buffer.push(Buffer.from([4, 5, 6]));
    buffer.push(Buffer.from([7, 8]));

    expect(buffer.byteLength).toBe(5);
    expect(Buffer.concat(buffer.drain()).equals(Buffer.from([4, 5, 6, 7, 8]))).toBe(true);
  });

  test('drains buffered chunks and clears the buffer', () => {
    const buffer = new PcmRingBuffer(100);
    buffer.push(Buffer.from('abc'));
    buffer.push(Buffer.from('def'));

    expect(buffer.drain().map((chunk) => chunk.toString('utf8'))).toEqual(['abc', 'def']);
    expect(buffer.byteLength).toBe(0);
  });
});
