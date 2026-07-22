import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { MobileChatAttachment } from './pick-chat-images';

const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;

function safeMime(value: unknown): string {
  const mime = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!mime) return 'application/octet-stream';
  if (
    mime.length > 120 ||
    !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mime)
  ) {
    throw new Error('The selected file has an invalid type.');
  }
  return mime;
}

export async function pickChatFiles(
  existing: readonly MobileChatAttachment[],
): Promise<MobileChatAttachment[]> {
  if (existing.length >= MAX_ATTACHMENTS) {
    throw new Error(`A prompt can include up to ${MAX_ATTACHMENTS} attachments.`);
  }
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];

  const selected: MobileChatAttachment[] = [];
  let totalBytes = existing.reduce((total, attachment) => total + attachment.size, 0);
  for (const asset of result.assets.slice(0, MAX_ATTACHMENTS - existing.length)) {
    const file = new File(asset.uri);
    const name = String(asset.name ?? file.name ?? '').trim() || `attachment-${selected.length + 1}`;
    const size = Number(asset.size ?? file.size ?? 0);
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`${name} is empty or unreadable.`);
    if (size > MAX_FILE_BYTES) throw new Error('Each prompt attachment must be 6 MiB or smaller.');
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('Prompt attachments must be 20 MiB or smaller in total.');
    }
    selected.push({
      id: `${asset.uri}:${size}:${existing.length + selected.length}`,
      uri: asset.uri,
      name,
      mime: safeMime(asset.mimeType ?? file.type),
      size,
      bytes: await file.bytes(),
    });
  }
  return selected;
}
