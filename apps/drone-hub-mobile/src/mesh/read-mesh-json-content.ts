import { toByteArray } from 'base64-js';

const MAX_MESH_JSON_CONTENT_BYTES = 32 * 1024 * 1024;

type MeshContentChunk = {
  encoding?: unknown;
  offset?: unknown;
  bytes?: unknown;
  totalBytes?: unknown;
  done?: unknown;
  dataBase64?: unknown;
};

export async function readMeshJsonContent(
  requestChunk: (offset: number) => Promise<MeshContentChunk>,
): Promise<any> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let totalBytes: number | null = null;
  for (let index = 0; index < 1_024; index += 1) {
    const chunk = await requestChunk(offset);
    if (chunk?.encoding !== 'base64-json-utf8' || Number(chunk?.offset) !== offset)
      throw new Error('The remote device returned an invalid content chunk');
    const bytes = toByteArray(String(chunk?.dataBase64 ?? ''));
    if (bytes.length === 0 && chunk?.done !== true)
      throw new Error('The remote device returned an empty content chunk');
    if (Number(chunk?.bytes) !== bytes.length)
      throw new Error('The remote content chunk size did not match');
    const declaredTotal = Number(chunk?.totalBytes);
    if (
      !Number.isSafeInteger(declaredTotal) ||
      declaredTotal < offset + bytes.length ||
      declaredTotal > MAX_MESH_JSON_CONTENT_BYTES
    )
      throw new Error('The remote content length was invalid');
    if (totalBytes !== null && totalBytes !== declaredTotal)
      throw new Error('The remote content changed while it was loading');
    totalBytes = declaredTotal;
    chunks.push(bytes);
    offset += bytes.length;
    if (chunk?.done === true) {
      if (offset !== totalBytes) throw new Error('The remote content ended early');
      const combined = new Uint8Array(totalBytes);
      let position = 0;
      for (const part of chunks) {
        combined.set(part, position);
        position += part.length;
      }
      return JSON.parse(new TextDecoder().decode(combined));
    }
  }
  throw new Error('The remote content used too many chunks');
}
