import { fromByteArray } from 'base64-js';
import { MESH_BINARY_CHUNK_BYTES } from '@drone/device-protocol';

type MeshRequest = (payload: Record<string, unknown>) => Promise<any>;

const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;

function positiveChunkSize(value: unknown): number {
  const size = Number(value);
  return Number.isSafeInteger(size) && size > 0
    ? Math.min(size, MESH_BINARY_CHUNK_BYTES)
    : MESH_BINARY_CHUNK_BYTES;
}

export async function uploadMeshChatAttachment(input: {
  endpoint?: string | null;
  droneId: string;
  chatName: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
  request: MeshRequest;
  fetchImpl?: typeof fetch;
}): Promise<{ attachmentId: string; name: string; mime: string; size: number }> {
  if (input.bytes.length === 0 || input.bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error('The attachment must be between 1 byte and 6 MiB.');
  }
  const prepare = async () => {
    const result = await input.request({
      droneId: input.droneId,
      chatName: input.chatName,
      attachmentTransfer: {
        action: 'prepare',
        name: input.name,
        mime: input.mime,
        size: input.bytes.length,
      },
    });
    const uploadId = String(result?.uploadId ?? '').trim();
    if (!uploadId) throw new Error('The remote device returned an invalid attachment session.');
    return { ...result, uploadId };
  };
  let upload = await prepare();
  const abort = async () => {
    await input
      .request({
        droneId: input.droneId,
        chatName: input.chatName,
        attachmentTransfer: { action: 'abort', uploadId: upload.uploadId },
      })
      .catch(() => undefined);
  };
  let offset = 0;
  if (input.endpoint && String(upload.uploadToken ?? '').trim()) {
    try {
      const url = new URL(input.endpoint);
      url.pathname = `/api/device-mesh/attachments/${encodeURIComponent(String(upload.uploadId))}`;
      url.search = '';
      url.hash = '';
      const response = await (input.fetchImpl ?? fetch)(url.toString(), {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'x-upload-token': String(upload.uploadToken ?? ''),
          'x-upload-offset': '0',
        },
        body: new Blob([input.bytes as any]),
      });
      if (!response.ok) throw new Error(`HTTP upload failed (${response.status})`);
      const result = await response.json();
      const nextOffset = Number(result?.offset);
      if (
        !Number.isSafeInteger(nextOffset) ||
        nextOffset !== input.bytes.length ||
        result?.complete !== true
      ) {
        throw new Error('The direct attachment upload did not complete.');
      }
      offset = nextOffset;
    } catch {
      await abort();
      upload = await prepare();
      offset = 0;
    }
  }
  try {
    const maxChunkBytes = positiveChunkSize(upload?.maxChunkBytes);
    while (offset < input.bytes.length) {
      const chunk = input.bytes.slice(offset, offset + maxChunkBytes);
      const result = await input.request({
        droneId: input.droneId,
        chatName: input.chatName,
        attachmentTransfer: {
          action: 'write',
          uploadId: upload.uploadId,
          offset,
          dataBase64: fromByteArray(chunk),
        },
      });
      const nextOffset = Number(result?.offset);
      if (!Number.isSafeInteger(nextOffset) || nextOffset !== offset + chunk.length)
        throw new Error('The remote attachment offset did not advance correctly');
      offset = nextOffset;
    }
    const committed = await input.request({
      droneId: input.droneId,
      chatName: input.chatName,
      attachmentTransfer: { action: 'commit', uploadId: upload.uploadId },
    });
    const attachmentId = String(committed?.attachmentId ?? '').trim();
    const name = String(committed?.name ?? '').trim();
    const mime = String(committed?.mime ?? '').trim();
    const size = Number(committed?.size);
    if (!attachmentId || !name || !mime || size !== input.bytes.length) {
      throw new Error('The remote device returned an invalid committed attachment.');
    }
    return { attachmentId, name, mime, size };
  } catch (error) {
    await abort();
    throw error;
  }
}
