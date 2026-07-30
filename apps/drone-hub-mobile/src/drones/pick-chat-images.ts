import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import {
  CHAT_ATTACHMENT_POLICY,
  normalizeChatAttachmentMime,
  validateChatAttachments,
} from '@drone/assistant-chat';

export type MobileChatAttachment = {
  id: string;
  uri: string;
  name: string;
  mime: string;
  size: number;
  bytes: Uint8Array;
};

export type MobileChatImage = MobileChatAttachment;

function imageMime(value: unknown, name: string): string {
  return normalizeChatAttachmentMime(value, name);
}

function validateImageSelection(
  existing: readonly MobileChatImage[],
  selected: readonly MobileChatImage[],
  candidate: { name: string; mime: string; size: number },
): void {
  const policy = validateChatAttachments([
    ...existing.map(({ name, mime, size }) => ({ name, mime, size })),
    ...selected.map(({ name, mime, size }) => ({ name, mime, size })),
    candidate,
  ]);
  if (policy.ok) return;
  if (policy.issue.code === 'too_many_attachments') {
    throw new Error(
      `A prompt can include up to ${CHAT_ATTACHMENT_POLICY.maxCount} images.`,
    );
  }
  if (policy.issue.code === 'attachments_too_large') {
    throw new Error('Prompt images must be 20 MiB or smaller in total.');
  }
  if (policy.issue.code === 'invalid_size') {
    throw new Error('The selected image is empty.');
  }
  throw new Error('Each prompt image must be 6 MiB or smaller.');
}

export async function pickChatImages(
  existing: readonly MobileChatImage[],
): Promise<MobileChatImage[]> {
  if (existing.length >= CHAT_ATTACHMENT_POLICY.maxCount)
    throw new Error(
      `A prompt can include up to ${CHAT_ATTACHMENT_POLICY.maxCount} images.`,
    );
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Photo access is required to attach an image.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: CHAT_ATTACHMENT_POLICY.maxCount - existing.length,
    quality: 0.9,
  });
  if (result.canceled) return [];
  if (result.assets.length > CHAT_ATTACHMENT_POLICY.maxCount - existing.length)
    throw new Error(
      `A prompt can include up to ${CHAT_ATTACHMENT_POLICY.maxCount} images.`,
    );
  const selected: MobileChatImage[] = [];
  for (const asset of result.assets) {
    const file = new File(asset.uri);
    const name = String(
      asset.fileName ?? file.name ?? `image-${existing.length + selected.length + 1}`,
    );
    const mime = imageMime(asset.mimeType ?? file.type, name);
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime))
      throw new Error(`Unsupported image type: ${mime || 'unknown'}. Use PNG, JPEG, GIF, or WebP.`);
    const reportedSize = Number(asset.fileSize ?? file.size ?? 0);
    validateImageSelection(existing, selected, { name, mime, size: reportedSize });
    const bytes = await file.bytes();
    const size = bytes.length;
    validateImageSelection(existing, selected, { name, mime, size });
    selected.push({
      id: `${asset.assetId ?? asset.uri}:${size}:${existing.length + selected.length}`,
      uri: asset.uri,
      name,
      mime,
      size,
      bytes,
    });
  }
  return selected;
}
