import { describe, expect, test } from 'bun:test';
import { MESH_BINARY_CHUNK_BYTES } from '@drone/device-protocol';

import { readPipelinedMediaChunks } from '../src/drones/read-pipelined-media-chunks';

type Result = {
  offset: number;
  bytes: Uint8Array;
  snapshotToken?: string;
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
      firstResult: { offset: 0, bytes: new Uint8Array([1, 2]) } satisfies Result,
      totalBytes: 5,
      requestResult: async (offset) => {
        requests.push(offset);
        return { offset, bytes: new Uint8Array(offset === 2 ? [3, 4] : [5]) };
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
    };
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
      });

    await expect(
      run(async (offset) => ({
        offset: offset + 1,
        bytes: new Uint8Array(MESH_BINARY_CHUNK_BYTES),
        snapshotToken: 'snapshot-a',
      })),
    ).rejects.toThrow('invalid offset');
    await expect(
      run(async (offset) => ({
        offset,
        bytes: new Uint8Array(MESH_BINARY_CHUNK_BYTES),
        snapshotToken: 'snapshot-b',
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
        }),
        () => true,
      ),
    ).rejects.toThrow('cancelled');
  });
});
