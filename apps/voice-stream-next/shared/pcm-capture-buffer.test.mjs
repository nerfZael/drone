import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(scriptDir, 'pcm-capture-buffer.js'), 'utf8');
const module = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', source)(module, module.exports);
const { PcmCaptureBuffer, pcmBytesForMs } = module.exports;

describe('PcmCaptureBuffer', () => {
  test('trims oldest chunks when max bytes is exceeded', () => {
    const buffer = new PcmCaptureBuffer(10);
    buffer.push(new Uint8Array([1, 2, 3, 4]).buffer);
    buffer.push(new Uint8Array([5, 6, 7, 8]).buffer);
    buffer.push(new Uint8Array([9, 10]).buffer);
    buffer.push(new Uint8Array([11]).buffer);
    expect(buffer.byteLength).toBe(7);
    const drained = buffer.drain();
    expect(drained).toHaveLength(3);
    expect(Array.from(new Uint8Array(drained[0]))).toEqual([5, 6, 7, 8]);
    expect(Array.from(new Uint8Array(drained[1]))).toEqual([9, 10]);
    expect(Array.from(new Uint8Array(drained[2]))).toEqual([11]);
  });

  test('drains and clears buffered chunks', () => {
    const buffer = new PcmCaptureBuffer(32);
    buffer.push(new Uint8Array([1, 2]).buffer);
    buffer.push(new Uint8Array([3, 4]).buffer);
    const drained = buffer.drain();
    expect(drained).toHaveLength(2);
    expect(buffer.byteLength).toBe(0);
    buffer.clear();
    expect(buffer.drain()).toEqual([]);
  });

  test('snapshots without clearing buffered chunks', () => {
    const buffer = new PcmCaptureBuffer(32);
    buffer.push(new Uint8Array([1, 2]).buffer);
    buffer.push(new Uint8Array([3, 4]).buffer);
    const snapshot = buffer.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(buffer.byteLength).toBe(4);
    expect(buffer.drain()).toHaveLength(2);
  });

  test('computes pcm byte counts from duration', () => {
    expect(pcmBytesForMs(1500)).toBe(48000);
    expect(pcmBytesForMs(5000)).toBe(160000);
  });
});
