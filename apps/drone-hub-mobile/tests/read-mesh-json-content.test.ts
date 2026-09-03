import { describe, expect, test } from 'bun:test';
import { fromByteArray } from 'base64-js';
import { MESH_BINARY_CHUNK_BYTES } from '@drone/device-protocol';
import { readMeshJsonContent } from '../src/mesh/read-mesh-json-content';

describe('mesh JSON content reader', () => {
  test('rejects an excessive declared content size before allocating it', async () => {
    await expect(
      readMeshJsonContent(async () => ({
        encoding: 'base64-json-utf8',
        offset: 0,
        bytes: 2,
        totalBytes: 33 * 1024 * 1024,
        done: false,
        dataBase64: 'e30=',
      })),
    ).rejects.toThrow('content length was invalid');
  });

  test('reassembles UTF-8 JSON across independently encoded chunks', async () => {
    const content = new TextEncoder().encode(JSON.stringify({ text: 'Hello 🌍'.repeat(100) }));
    expect(
      await readMeshJsonContent(async (offset) => {
        const bytes = content.slice(offset, offset + 37);
        return {
          encoding: 'base64-json-utf8',
          offset,
          bytes: bytes.length,
          totalBytes: content.length,
          done: offset + bytes.length >= content.length,
          dataBase64: fromByteArray(bytes),
        };
      }),
    ).toEqual({ text: 'Hello 🌍'.repeat(100) });
  });

  test('pipelines immutable snapshot chunks while retaining byte order', async () => {
    const expected = { text: 'Hello 🌍'.repeat(MESH_BINARY_CHUNK_BYTES) };
    const content = new TextEncoder().encode(JSON.stringify(expected));
    let active = 0;
    let maxActive = 0;
    const offsets: number[] = [];
    const result = await readMeshJsonContent(async (offset, snapshotToken) => {
      offsets.push(offset);
      if (offset > 0) {
        expect(snapshotToken).toBe('snapshot-a');
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(offset === MESH_BINARY_CHUNK_BYTES ? 10 : 1);
        active -= 1;
      }
      const bytes = content.slice(offset, offset + MESH_BINARY_CHUNK_BYTES);
      return {
        encoding: 'base64-json-utf8',
        offset,
        bytes: bytes.length,
        totalBytes: content.length,
        done: offset + bytes.length >= content.length,
        dataBase64: fromByteArray(bytes),
        snapshotToken: 'snapshot-a',
      };
    });

    expect(result).toEqual(expected);
    expect(maxActive).toBe(3);
    expect(offsets.slice(1, 4)).toEqual([
      MESH_BINARY_CHUNK_BYTES,
      MESH_BINARY_CHUNK_BYTES * 2,
      MESH_BINARY_CHUNK_BYTES * 3,
    ]);
  });

  test('rejects changed snapshot tokens and cancellation', async () => {
    const content = new TextEncoder().encode(
      JSON.stringify({ text: 'x'.repeat(MESH_BINARY_CHUNK_BYTES * 2) }),
    );
    await expect(
      readMeshJsonContent(async (offset) => {
        const bytes = content.slice(offset, offset + MESH_BINARY_CHUNK_BYTES);
        return {
          encoding: 'base64-json-utf8',
          offset,
          bytes: bytes.length,
          totalBytes: content.length,
          done: offset + bytes.length >= content.length,
          dataBase64: fromByteArray(bytes),
          snapshotToken: offset === 0 ? 'snapshot-a' : 'snapshot-b',
        };
      }),
    ).rejects.toThrow('snapshot changed');

    let cancelled = false;
    const cancelledTokens: string[] = [];
    await expect(
      readMeshJsonContent(
        async (offset) => {
          const bytes = content.slice(offset, offset + MESH_BINARY_CHUNK_BYTES);
          if (offset === 0) cancelled = true;
          return {
            encoding: 'base64-json-utf8',
            offset,
            bytes: bytes.length,
            totalBytes: content.length,
            done: false,
            dataBase64: fromByteArray(bytes),
            snapshotToken: 'snapshot-a',
          };
        },
        {
          isCancelled: () => cancelled,
          cancelSnapshot: async (token) => {
            cancelledTokens.push(token);
          },
        },
      ),
    ).rejects.toThrow('cancelled');
    expect(cancelledTokens).toEqual(['snapshot-a']);
  });

  test('restarts one expired transfer promptly from byte zero without mixing snapshots', async () => {
    const expected = { text: 'r'.repeat(MESH_BINARY_CHUNK_BYTES * 2) };
    const content = new TextEncoder().encode(JSON.stringify(expected));
    let generation = 0;
    let expired = false;
    let oldRequestsActive = 0;
    let restartedWhileOldActive = false;
    const zeroOffsets: string[] = [];
    const result = await readMeshJsonContent(async (offset, token) => {
      if (offset === 0) {
        generation += 1;
        zeroOffsets.push(`snapshot-${generation}`);
        if (generation === 2 && oldRequestsActive > 0) restartedWhileOldActive = true;
      } else if (generation === 1) {
        oldRequestsActive += 1;
        await Bun.sleep(offset === MESH_BINARY_CHUNK_BYTES ? 1 : 8);
        oldRequestsActive -= 1;
        if (!expired) {
          expired = true;
          throw Object.assign(new Error('evicted'), { code: 'TRANSFER_EXPIRED' });
        }
      }
      const bytes = content.slice(offset, offset + MESH_BINARY_CHUNK_BYTES);
      const snapshotToken = token ?? `snapshot-${generation}`;
      return {
        encoding: 'base64-json-utf8',
        offset,
        bytes: bytes.length,
        totalBytes: content.length,
        done: offset + bytes.length === content.length,
        dataBase64: fromByteArray(bytes),
        snapshotToken,
      };
    });

    expect(result).toEqual(expected);
    expect(zeroOffsets).toEqual(['snapshot-1', 'snapshot-2']);
    expect(restartedWhileOldActive).toBe(true);
  });

  test('aborts three slow continuation requests and cancels the snapshot immediately', async () => {
    const content = new Uint8Array(MESH_BINARY_CHUNK_BYTES * 4);
    const controller = new AbortController();
    const cancelled: string[] = [];
    let started = 0;
    let aborted = 0;
    const reading = readMeshJsonContent(
      async (offset, _token, signal) => {
        if (offset === 0) {
          return {
            encoding: 'base64-json-utf8',
            offset: 0,
            bytes: MESH_BINARY_CHUNK_BYTES,
            totalBytes: content.length,
            done: false,
            dataBase64: fromByteArray(content.subarray(0, MESH_BINARY_CHUNK_BYTES)),
            snapshotToken: 'snapshot-slow',
          };
        }
        started += 1;
        return await new Promise((_, reject) => {
          const onAbort = () => {
            aborted += 1;
            reject(new Error('request aborted'));
          };
          if (signal?.aborted) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        });
      },
      {
        signal: controller.signal,
        cancelSnapshot: async (token) => {
          cancelled.push(token);
        },
      },
    );
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

  test('does not loop after a restarted transfer expires or after cancellation', async () => {
    let starts = 0;
    await expect(
      readMeshJsonContent(async (offset) => {
        if (offset === 0) starts += 1;
        if (offset > 0) throw Object.assign(new Error('expired'), { code: 'TRANSFER_EXPIRED' });
        const bytes = new Uint8Array(MESH_BINARY_CHUNK_BYTES);
        return {
          encoding: 'base64-json-utf8',
          offset,
          bytes: bytes.length,
          totalBytes: MESH_BINARY_CHUNK_BYTES + 1,
          done: false,
          dataBase64: fromByteArray(bytes),
          snapshotToken: `snapshot-${starts}`,
        };
      }),
    ).rejects.toThrow('expired');
    expect(starts).toBe(2);

    let cancelledStarts = 0;
    await expect(
      readMeshJsonContent(
        async () => {
          cancelledStarts += 1;
          throw Object.assign(new Error('expired'), { code: 'TRANSFER_EXPIRED' });
        },
        { isCancelled: () => true },
      ),
    ).rejects.toThrow('cancelled');
    expect(cancelledStarts).toBe(1);
  });
});
