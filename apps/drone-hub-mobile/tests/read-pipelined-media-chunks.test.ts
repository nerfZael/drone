import { describe, expect, test } from 'bun:test';
import { MESH_BINARY_CHUNK_BYTES } from '@drone/device-protocol';

import { readPipelinedMediaChunks } from '../src/drones/read-pipelined-media-chunks';

type Result = {
  offset: number;
  bytes: Uint8Array;
  snapshotToken?: string;
  done: boolean;
};

describe('pipelined mobile media chunks', () => {
  test('overlaps at most three requests and writes completed chunks in order', async () => {
    const totalBytes = MESH_BINARY_CHUNK_BYTES * 4 + 7;
    const written: number[] = [];
    let active = 0;
    let maxActive = 0;
    const resultFor = (offset: number): Result => ({
      offset,
      bytes: new Uint8Array(Math.min(MESH_BINARY_CHUNK_BYTES, totalBytes - offset)).fill(
        offset / MESH_BINARY_CHUNK_BYTES,
      ),
      snapshotToken: 'snapshot-a',
      done: offset + Math.min(MESH_BINARY_CHUNK_BYTES, totalBytes - offset) === totalBytes,
    });

    await readPipelinedMediaChunks({
      firstResult: resultFor(0),
      totalBytes,
      requestResult: async (offset, token) => {
        expect(token).toBe('snapshot-a');
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(offset === MESH_BINARY_CHUNK_BYTES ? 12 : 1);
        active -= 1;
        return resultFor(offset);
      },
      validateResult: (result, offset) => {
        expect(result.offset).toBe(offset);
        return result;
      },
      appendBytes: (bytes) => written.push(bytes[0] ?? -1),
    });

    expect(maxActive).toBe(3);
    expect(written).toEqual([0, 1, 2, 3, 4]);
  });

  test('keeps the sequential compatibility path without a snapshot token', async () => {
    const requests: number[] = [];
    const writes: number[] = [];
    await readPipelinedMediaChunks({
      firstResult: { offset: 0, bytes: new Uint8Array([1, 2]), done: false } satisfies Result,
      totalBytes: 5,
      requestResult: async (offset) => {
        requests.push(offset);
        return {
          offset,
          bytes: new Uint8Array(offset === 2 ? [3, 4] : [5]),
          done: offset === 4,
        };
      },
      validateResult: (result, offset) => {
        expect(result.offset).toBe(offset);
        return result;
      },
      appendBytes: (bytes) => writes.push(...bytes),
    });
    expect(requests).toEqual([2, 4]);
    expect(writes).toEqual([1, 2, 3, 4, 5]);
  });

  test('rejects invalid offsets, changed tokens, failures, and cancellation', async () => {
    const totalBytes = MESH_BINARY_CHUNK_BYTES * 2;
    const first: Result = {
      offset: 0,
      bytes: new Uint8Array(MESH_BINARY_CHUNK_BYTES),
      snapshotToken: 'snapshot-a',
      done: false,
    };
    const cancelledSnapshots: string[] = [];
    const run = (requestResult: (offset: number) => Promise<Result>, cancelled = () => false) =>
      readPipelinedMediaChunks({
        firstResult: first,
        totalBytes,
        requestResult,
        validateResult: (result, offset) => {
          if (result.offset !== offset) throw new Error('invalid offset');
          return result;
        },
        appendBytes: () => undefined,
        isCancelled: cancelled,
        cancelSnapshot: async (token) => {
          cancelledSnapshots.push(token);
        },
      });

    await expect(
      run(async (offset) => ({
        offset: offset + 1,
        bytes: new Uint8Array(MESH_BINARY_CHUNK_BYTES),
        snapshotToken: 'snapshot-a',
        done: true,
      })),
    ).rejects.toThrow('invalid offset');
    await expect(
      run(async (offset) => ({
        offset,
        bytes: new Uint8Array(MESH_BINARY_CHUNK_BYTES),
        snapshotToken: 'snapshot-b',
        done: true,
      })),
    ).rejects.toThrow('snapshot changed');
    await expect(run(async () => Promise.reject(new Error('network failed')))).rejects.toThrow(
      'network failed',
    );
    await expect(
      run(
        async (offset) => ({
          offset,
          bytes: new Uint8Array(MESH_BINARY_CHUNK_BYTES),
          snapshotToken: 'snapshot-a',
          done: true,
        }),
        () => true,
      ),
    ).rejects.toThrow('cancelled');
    expect(cancelledSnapshots).toEqual(['snapshot-a', 'snapshot-a', 'snapshot-a', 'snapshot-a']);
  });

  test('rejects chunks that do not exactly fit the declared transfer', async () => {
    const run = (firstResult: Result, requestResult = async () => firstResult) =>
      readPipelinedMediaChunks({
        firstResult,
        totalBytes: 5,
        requestResult,
        validateResult: (result) => result,
        appendBytes: () => undefined,
      });

    await expect(run({ offset: 0, bytes: new Uint8Array(6), done: true })).rejects.toThrow(
      'invalid media chunk',
    );
    await expect(
      run({ offset: 0, bytes: new Uint8Array(3), done: false }, async (offset) => ({
        offset,
        bytes: new Uint8Array(3),
        done: true,
      })),
    ).rejects.toThrow('invalid media chunk');
    await expect(
      run({ offset: 0, bytes: new Uint8Array(3), done: false }, async (offset) => ({
        offset,
        bytes: new Uint8Array(0),
        done: false,
      })),
    ).rejects.toThrow('invalid media chunk');
    await expect(run({ offset: 0, bytes: new Uint8Array(3), done: true })).rejects.toThrow(
      'invalid media chunk',
    );
  });

  test('aborts three slow requests and releases the snapshot without waiting for timeouts', async () => {
    const totalBytes = MESH_BINARY_CHUNK_BYTES * 4;
    const controller = new AbortController();
    let started = 0;
    let aborted = 0;
    const cancelled: string[] = [];
    const reading = readPipelinedMediaChunks({
      firstResult: {
        offset: 0,
        bytes: new Uint8Array(MESH_BINARY_CHUNK_BYTES),
        snapshotToken: 'snapshot-slow',
        done: false,
      } satisfies Result,
      totalBytes,
      requestResult: async (_offset, _token, signal) => {
        started += 1;
        return await new Promise<Result>((_, reject) => {
          const onAbort = () => {
            aborted += 1;
            reject(new Error('request aborted'));
          };
          if (signal?.aborted) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        });
      },
      validateResult: (result) => result,
      appendBytes: () => undefined,
      signal: controller.signal,
      cancelSnapshot: async (token) => {
        cancelled.push(token);
      },
    });
    for (let attempt = 0; attempt < 20 && started < 3; attempt += 1) await Bun.sleep(1);
    expect(started).toBe(3);

    controller.abort();
    await expect(
      Promise.race([
        reading,
        Bun.sleep(100).then(() => {
          throw new Error('cancellation timed out');
        }),
      ]),
    ).rejects.toThrow(/cancelled|aborted/);
    expect(aborted).toBe(3);
    expect(cancelled).toEqual(['snapshot-slow']);
  });
});
