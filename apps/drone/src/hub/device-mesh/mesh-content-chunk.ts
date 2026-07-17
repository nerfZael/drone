import { MESH_BINARY_CHUNK_BYTES } from '@drone/device-protocol';

export function meshJsonContentChunk(value: unknown, offsetRaw?: unknown) {
  const content = Buffer.from(JSON.stringify(value));
  const parsedOffset = Number(offsetRaw);
  const offset =
    Number.isSafeInteger(parsedOffset) && parsedOffset > 0
      ? Math.min(parsedOffset, content.length)
      : 0;
  const chunk = content.subarray(offset, offset + MESH_BINARY_CHUNK_BYTES);
  return {
    encoding: 'base64-json-utf8' as const,
    offset,
    bytes: chunk.length,
    totalBytes: content.length,
    done: offset + chunk.length >= content.length,
    dataBase64: chunk.toString('base64'),
  };
}
