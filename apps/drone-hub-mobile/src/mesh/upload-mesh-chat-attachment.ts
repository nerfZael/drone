import { validateChatAttachments } from '@drone/assistant-chat';
import { uploadNativeFile } from './native-http-upload';

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
  const policy = validateChatAttachments([
    {
      name: input.name,
      mime: input.mime,
      size: input.bytes.length,
    },
  ]);
  if (!policy.ok) {
    if (policy.issue.code === 'invalid_mime') {
      throw new Error('The attachment has an invalid MIME type.');
    }
    throw new Error('The attachment must be between 1 byte and 6 MiB.');
  }
  const metadata = policy.attachments[0]!;
  const prepare = async () => {
    const result = await input.request({
      droneId: input.droneId,
      chatName: input.chatName,
      attachmentTransfer: {
        action: 'prepare',
        name: metadata.name,
        mime: metadata.mime,
        size: input.bytes.length,
      },
    });
    const uploadId = String(result?.uploadId ?? '').trim();
    if (!uploadId) throw new Error('The remote device returned an invalid attachment session.');
    return { ...result, uploadId };
  };
  const upload = await prepare();
  const abort = async () => {
    await input
      .request({
        droneId: input.droneId,
        chatName: input.chatName,
        attachmentTransfer: { action: 'abort', uploadId: upload.uploadId },
      })
      .catch(() => undefined);
  };
  try {
    if (!upload.uploadUrl || !upload.uploadToken)
      throw new Error('The destination did not authorize an HTTP upload');
    const headers = {
      'content-type': 'application/octet-stream',
      'x-upload-token': String(upload.uploadToken),
      'x-upload-offset': '0',
    };
    let uploaded: any;
    if (input.fetchImpl) {
      const response = await input.fetchImpl(String(upload.uploadUrl), {
        method: 'PUT',
        redirect: 'error',
        headers,
        body: new Blob([input.bytes as any]),
      });
      if (!response.ok) throw new Error('HTTP upload failed (' + response.status + ')');
      uploaded = await response.json();
    } else {
      const { File, Paths } = await import('expo-file-system');
      const file = new File(
        Paths.cache,
        `attachment-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      file.create();
      try {
        file.write(input.bytes);
        uploaded = await uploadNativeFile(String(upload.uploadUrl), file.uri, headers);
      } finally {
        if (file.exists) file.delete();
      }
    }
    if (uploaded.offset !== input.bytes.length || uploaded.complete !== true)
      throw new Error('HTTP upload was incomplete');
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
