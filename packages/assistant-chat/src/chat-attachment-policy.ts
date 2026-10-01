export const CHAT_ATTACHMENT_POLICY = {
  maxCount: 8,
  // Images and text are shown to the model, and anything sent inline travels as base64 in the
  // prompt request, so these stay small.
  maxBytesEach: 6 * 1024 * 1024,
  maxBytesTotal: 20 * 1024 * 1024,
  // A plain file uploaded ahead of the prompt is only named to the agent by its path.
  maxUploadedFileBytesEach: 100 * 1024 * 1024,
  maxUploadedFileBytesTotal: 200 * 1024 * 1024,
} as const;

export type ChatAttachmentMetadata = {
  name: string;
  mime: string;
  size: number;
};

/** `uploaded`: the bytes go ahead of the prompt as their own upload, so a plain file gets the uploaded-file limits. */
export type ChatAttachmentPolicyInput = ChatAttachmentMetadata & { uploaded?: boolean };

export type ChatAttachmentKind = 'image' | 'text' | 'file';

export type ChatAttachmentValidationIssue = {
  code:
    | 'too_many_attachments'
    | 'invalid_mime'
    | 'invalid_size'
    | 'attachment_too_large'
    | 'attachments_too_large';
  attachmentIndex?: number;
  actual: number;
  limit?: number;
};

export type ChatAttachmentValidationResult =
  | {
      ok: true;
      attachments: ChatAttachmentMetadata[];
      totalBytes: number;
    }
  | {
      ok: false;
      issue: ChatAttachmentValidationIssue;
    };

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
};

const CHAT_ATTACHMENT_MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;

export function normalizeChatAttachmentMime(mimeRaw: unknown, nameRaw?: unknown): string {
  const supplied = String(mimeRaw ?? '')
    .trim()
    .toLowerCase();
  if (supplied && supplied !== 'application/octet-stream') {
    return supplied === 'image/jpg' ? 'image/jpeg' : supplied;
  }
  const name = String(nameRaw ?? '')
    .trim()
    .toLowerCase();
  const extension = /\.([a-z0-9]+)$/u.exec(name)?.[1] ?? '';
  return IMAGE_MIME_BY_EXTENSION[extension] ?? (supplied || 'application/octet-stream');
}

export function isValidChatAttachmentMime(mimeRaw: unknown): boolean {
  const mime = normalizeChatAttachmentMime(mimeRaw);
  return mime.length <= 120 && CHAT_ATTACHMENT_MIME_PATTERN.test(mime);
}

export function chatAttachmentKind(
  attachment: Pick<ChatAttachmentMetadata, 'mime'>,
): ChatAttachmentKind {
  const mime = normalizeChatAttachmentMime(attachment.mime);
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'text/plain') return 'text';
  return 'file';
}

export function chatAttachmentTypeLabel(
  attachment: Pick<ChatAttachmentMetadata, 'mime'>,
): 'Image' | 'Text' | 'File' {
  const kind = chatAttachmentKind(attachment);
  return kind === 'image' ? 'Image' : kind === 'text' ? 'Text' : 'File';
}

export function chatAttachmentPreviewLabel(
  attachmentsRaw: readonly Pick<ChatAttachmentMetadata, 'mime'>[],
): string {
  const attachments = Array.isArray(attachmentsRaw) ? attachmentsRaw : [];
  if (attachments.length === 0) return '';
  const kinds = attachments.map(chatAttachmentKind);
  if (kinds.every((kind) => kind === 'image')) {
    return attachments.length === 1
      ? '[image attachment]'
      : `[${attachments.length} image attachments]`;
  }
  if (kinds.every((kind) => kind === 'text')) {
    return attachments.length === 1
      ? '[text attachment]'
      : `[${attachments.length} text attachments]`;
  }
  return attachments.length === 1 ? '[attachment]' : `[${attachments.length} attachments]`;
}

/** Whether an attachment is held to the uploaded-file limits rather than the inline ones. */
export function isUploadedChatAttachmentFile(attachment: ChatAttachmentPolicyInput): boolean {
  return attachment.uploaded === true && chatAttachmentKind(attachment) === 'file';
}

export function validateChatAttachments(
  attachmentsRaw: readonly ChatAttachmentPolicyInput[],
): ChatAttachmentValidationResult {
  const attachments = Array.isArray(attachmentsRaw) ? attachmentsRaw : [];
  if (attachments.length > CHAT_ATTACHMENT_POLICY.maxCount) {
    return {
      ok: false,
      issue: {
        code: 'too_many_attachments',
        actual: attachments.length,
        limit: CHAT_ATTACHMENT_POLICY.maxCount,
      },
    };
  }

  const normalized: ChatAttachmentMetadata[] = [];
  let totalBytes = 0;
  let inlineBytes = 0;
  let uploadedFileBytes = 0;
  for (let attachmentIndex = 0; attachmentIndex < attachments.length; attachmentIndex += 1) {
    const attachment = attachments[attachmentIndex]!;
    const mime = normalizeChatAttachmentMime(attachment.mime, attachment.name);
    if (!isValidChatAttachmentMime(mime)) {
      return {
        ok: false,
        issue: {
          code: 'invalid_mime',
          attachmentIndex,
          actual: mime.length,
          limit: 120,
        },
      };
    }

    const size = Number(attachment.size);
    if (!Number.isSafeInteger(size) || size <= 0) {
      return {
        ok: false,
        issue: {
          code: 'invalid_size',
          attachmentIndex,
          actual: Number.isFinite(size) ? size : 0,
        },
      };
    }
    const uploadedFile = isUploadedChatAttachmentFile({ ...attachment, mime });
    const limitEach = uploadedFile
      ? CHAT_ATTACHMENT_POLICY.maxUploadedFileBytesEach
      : CHAT_ATTACHMENT_POLICY.maxBytesEach;
    if (size > limitEach) {
      return {
        ok: false,
        issue: {
          code: 'attachment_too_large',
          attachmentIndex,
          actual: size,
          limit: limitEach,
        },
      };
    }

    totalBytes += size;
    if (uploadedFile) uploadedFileBytes += size;
    else inlineBytes += size;
    const groupBytes = uploadedFile ? uploadedFileBytes : inlineBytes;
    const limitTotal = uploadedFile
      ? CHAT_ATTACHMENT_POLICY.maxUploadedFileBytesTotal
      : CHAT_ATTACHMENT_POLICY.maxBytesTotal;
    if (groupBytes > limitTotal) {
      return {
        ok: false,
        issue: {
          code: 'attachments_too_large',
          attachmentIndex,
          actual: groupBytes,
          limit: limitTotal,
        },
      };
    }
    normalized.push({
      name: String(attachment.name ?? '').trim(),
      mime,
      size,
    });
  }

  return { ok: true, attachments: normalized, totalBytes };
}
