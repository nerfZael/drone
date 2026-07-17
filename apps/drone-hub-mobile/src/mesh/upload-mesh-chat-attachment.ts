import { fromByteArray } from 'base64-js';
import { MESH_BINARY_CHUNK_BYTES } from '@drone/device-protocol';

type MeshRequest = (payload: Record<string, unknown>) => Promise<any>;

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
  const prepare = () =>
    input.request({
      droneId: input.droneId,
      chatName: input.chatName,
      attachmentTransfer: {
        action: 'prepare',
        name: input.name,
        mime: input.mime,
        size: input.bytes.length,
      },
    });
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
  if (input.endpoint) {
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
      offset = Number(result?.offset ?? 0);
    } catch {
      await abort();
      upload = await prepare();
      offset = 0;
    }
  }
  try {
    const maxChunkBytes = Math.max(
      1,
      Math.min(MESH_BINARY_CHUNK_BYTES, Number(upload?.maxChunkBytes) || MESH_BINARY_CHUNK_BYTES),
    );
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
    return await input.request({
      droneId: input.droneId,
      chatName: input.chatName,
      attachmentTransfer: { action: 'commit', uploadId: upload.uploadId },
    });
  } catch (error) {
    await abort();
    throw error;
  }
}
