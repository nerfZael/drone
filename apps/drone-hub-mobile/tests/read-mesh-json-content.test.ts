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
        { isCancelled: () => cancelled },
      ),
    ).rejects.toThrow('cancelled');
  });
});
