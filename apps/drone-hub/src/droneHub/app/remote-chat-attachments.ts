import type { ChatAttachmentPayload } from '../chat/ChatInput';

const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

// Desktop uploads travel through the local JSON bridge before entering the mesh. Keep the
// encoded chunk comfortably below that bridge's 128 KiB request limit.
const DESKTOP_ATTACHMENT_CHUNK_BYTES = 64 * 1024;

type RemotePromptRequest = (payload: Record<string, unknown>) => Promise<any>;

function normalizedBase64(value: string): string {
  const encoded = String(value ?? '').replace(/\s+/g, '');
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) {
    throw new Error('An attachment could not be read as base64 data.');
  }
  return encoded;
}

function decodedBase64Bytes(encoded: string): number {
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.floor((encoded.length * 3) / 4) - padding;
}

function validateAttachments(
  attachments: readonly ChatAttachmentPayload[],
): Array<ChatAttachmentPayload & { dataBase64: string }> {
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new Error(`A prompt can include up to ${MAX_ATTACHMENTS} attachments.`);
  }
  let total = 0;
  return attachments.map((attachment) => {
    const mime = String(attachment.mime ?? '')
      .trim()
      .toLowerCase();
    if (
      mime.length > 120 ||
      !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mime)
    ) {
      throw new Error('An attachment has an invalid MIME type.');
    }
    const dataBase64 = normalizedBase64(attachment.dataBase64);
    const size = decodedBase64Bytes(dataBase64);
    if (size <= 0 || size > MAX_ATTACHMENT_BYTES) {
      throw new Error('Each remote prompt attachment must be between 1 byte and 6 MiB.');
    }
    if (Number(attachment.size) !== size) {
      throw new Error(`The attachment size changed while reading ${attachment.name}.`);
    }
    total += size;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error('Remote prompt attachments must be 20 MiB or smaller in total.');
    }
    return { ...attachment, mime: mime === 'image/jpg' ? 'image/jpeg' : mime, size, dataBase64 };
  });
}

async function abortUploads(
  request: RemotePromptRequest,
  droneId: string,
  chatName: string,
  uploadIds: readonly string[],
): Promise<void> {
  await Promise.all(
    uploadIds.map((uploadId) =>
      request({
        droneId,
        chatName,
        attachmentTransfer: { action: 'abort', uploadId },
      }).catch(() => undefined),
    ),
  );
}

async function uploadAttachment(
  request: RemotePromptRequest,
  droneId: string,
  chatName: string,
  attachment: ChatAttachmentPayload & { dataBase64: string },
): Promise<string> {
  const prepared = await request({
    droneId,
    chatName,
    attachmentTransfer: {
      action: 'prepare',
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
    },
  });
  const uploadId = String(prepared?.uploadId ?? '').trim();
  if (!uploadId) throw new Error('The remote device did not create an attachment upload.');

  try {
    const reportedMaxChunkBytes = Number(prepared?.maxChunkBytes);
    if (Number.isSafeInteger(reportedMaxChunkBytes) && reportedMaxChunkBytes < 3) {
      throw new Error('The remote device returned an invalid attachment chunk limit.');
    }
    const maxChunkBytes = Math.max(
      3,
      Math.min(
        DESKTOP_ATTACHMENT_CHUNK_BYTES,
        Number.isSafeInteger(reportedMaxChunkBytes)
          ? reportedMaxChunkBytes
          : DESKTOP_ATTACHMENT_CHUNK_BYTES,
      ),
    );
    const maxChunkBase64Characters = Math.max(4, Math.floor(maxChunkBytes / 3) * 4);
    let offset = 0;
    for (
      let characterOffset = 0;
      characterOffset < attachment.dataBase64.length;
      characterOffset += maxChunkBase64Characters
    ) {
      const dataBase64 = attachment.dataBase64.slice(
        characterOffset,
        characterOffset + maxChunkBase64Characters,
      );
      const chunkBytes = decodedBase64Bytes(dataBase64);
      const result = await request({
        droneId,
        chatName,
        attachmentTransfer: { action: 'write', uploadId, offset, dataBase64 },
      });
      const nextOffset = Number(result?.offset);
      if (!Number.isSafeInteger(nextOffset) || nextOffset !== offset + chunkBytes) {
        throw new Error('The remote attachment offset did not advance correctly.');
      }
      offset = nextOffset;
    }
    const committed = await request({
      droneId,
      chatName,
      attachmentTransfer: { action: 'commit', uploadId },
    });
    const attachmentId = String(committed?.attachmentId ?? '').trim();
    if (!attachmentId) throw new Error('The remote device did not commit the attachment upload.');
    return attachmentId;
  } catch (error) {
    await abortUploads(request, droneId, chatName, [uploadId]);
    throw error;
  }
}

export async function sendRemoteChatPrompt(input: {
  droneId: string;
  chatName: string;
  prompt: string;
  attachments: readonly ChatAttachmentPayload[];
  request: RemotePromptRequest;
}): Promise<any> {
  const attachments = validateAttachments(input.attachments);
  if (!input.prompt.trim() && attachments.length === 0) {
    throw new Error('Prompt text or an attachment is required.');
  }

  const attachmentIds: string[] = [];
  try {
    for (const attachment of attachments) {
      attachmentIds.push(
        await uploadAttachment(input.request, input.droneId, input.chatName, attachment),
      );
    }
    return await input.request({
      droneId: input.droneId,
      chatName: input.chatName,
      prompt: input.prompt,
      ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
    });
  } catch (error) {
    await abortUploads(input.request, input.droneId, input.chatName, attachmentIds);
    throw error;
  }
}
