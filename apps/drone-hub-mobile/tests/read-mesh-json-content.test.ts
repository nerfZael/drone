import { describe, expect, test } from 'bun:test';
import { fromByteArray } from 'base64-js';
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
});
