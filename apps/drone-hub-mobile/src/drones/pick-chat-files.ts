import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import {
  CHAT_ATTACHMENT_POLICY,
  normalizeChatAttachmentMime,
  validateChatAttachments,
} from '@drone/assistant-chat';
import type { MobileChatAttachment } from './pick-chat-images';

function validateFileSelection(
  existing: readonly MobileChatAttachment[],
  selected: readonly MobileChatAttachment[],
  candidate: { name: string; mime: string; size: number },
): string {
  const policy = validateChatAttachments([
    ...existing.map(({ name, mime, size }) => ({ name, mime, size })),
    ...selected.map(({ name, mime, size }) => ({ name, mime, size })),
    candidate,
  ]);
  if (policy.ok) return policy.attachments[policy.attachments.length - 1]!.mime;
  if (policy.issue.code === 'too_many_attachments') {
    throw new Error(
      `A prompt can include up to ${CHAT_ATTACHMENT_POLICY.maxCount} attachments.`,
    );
  }
  if (policy.issue.code === 'invalid_mime') {
    throw new Error('The selected file has an invalid type.');
  }
  if (policy.issue.code === 'attachments_too_large') {
    throw new Error('Prompt attachments must be 20 MiB or smaller in total.');
  }
  if (policy.issue.code === 'invalid_size') {
    throw new Error(`${candidate.name} is empty or unreadable.`);
  }
  throw new Error('Each prompt attachment must be 6 MiB or smaller.');
}

export async function pickChatFiles(
  existing: readonly MobileChatAttachment[],
): Promise<MobileChatAttachment[]> {
  if (existing.length >= CHAT_ATTACHMENT_POLICY.maxCount) {
    throw new Error(
      `A prompt can include up to ${CHAT_ATTACHMENT_POLICY.maxCount} attachments.`,
    );
  }
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  const remaining = CHAT_ATTACHMENT_POLICY.maxCount - existing.length;
  if (result.assets.length > remaining) {
    throw new Error(
      `A prompt can include up to ${CHAT_ATTACHMENT_POLICY.maxCount} attachments.`,
    );
  }

  const selected: MobileChatAttachment[] = [];
  for (const asset of result.assets) {
    const file = new File(asset.uri);
    const name = String(asset.name ?? file.name ?? '').trim() || `attachment-${selected.length + 1}`;
    const mime = normalizeChatAttachmentMime(asset.mimeType ?? file.type, name);
    const reportedSize = Number(asset.size ?? file.size ?? 0);
    validateFileSelection(existing, selected, { name, mime, size: reportedSize });
    const bytes = await file.bytes();
    const size = bytes.length;
    const normalizedMime = validateFileSelection(existing, selected, { name, mime, size });
    selected.push({
      id: `${asset.uri}:${size}:${existing.length + selected.length}`,
      uri: asset.uri,
      name,
      mime: normalizedMime,
      size,
      bytes,
    });
  }
  return selected;
}
