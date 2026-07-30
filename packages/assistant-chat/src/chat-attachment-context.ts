import { chatAttachmentKind, type ChatAttachmentMetadata } from './chat-attachment-policy';

export type ChatAttachmentContextDescriptor = ChatAttachmentMetadata & {
  path: string;
  relativePath?: string;
};

export function chatAttachmentContextBlock(
  attachmentsRaw: readonly ChatAttachmentContextDescriptor[],
): string {
  const attachments = Array.isArray(attachmentsRaw) ? attachmentsRaw : [];
  if (attachments.length === 0) return '';
  const textAttachments = attachments.filter(
    (attachment) => chatAttachmentKind(attachment) === 'text',
  );
  const imageAttachments = attachments.filter(
    (attachment) => chatAttachmentKind(attachment) === 'image',
  );
  const fileAttachments = attachments.filter(
    (attachment) => chatAttachmentKind(attachment) === 'file',
  );
  const blocks: string[] = [];

  if (textAttachments.length > 0) {
    blocks.push(
      `${textAttachments.length === 1 ? 'Text attachment:' : 'Text attachments:'}\n${textAttachments.map(formatContextDescriptor).join('\n')}\nRead the text attachment file${textAttachments.length === 1 ? '' : 's'} and treat the content as part of the user's message/context.`,
    );
  }
  if (imageAttachments.length > 0) {
    blocks.push(
      `${imageAttachments.length === 1 ? 'Image attachment:' : 'Image attachments:'}\n${imageAttachments.map(formatContextDescriptor).join('\n')}`,
    );
  }
  if (fileAttachments.length > 0) {
    blocks.push(
      `${fileAttachments.length === 1 ? 'Attachment:' : 'Attachments:'}\n${fileAttachments.map(formatContextDescriptor).join('\n')}`,
    );
  }

  return blocks.join('\n\n');
}

export function promptWithChatAttachmentContext(
  promptRaw: string,
  attachments: readonly ChatAttachmentContextDescriptor[],
): string {
  const prompt = String(promptRaw ?? '').trim();
  const context = chatAttachmentContextBlock(attachments);
  if (!context) return prompt;
  return prompt ? `${prompt}\n\n${context}` : context;
}

function formatContextDescriptor(
  attachment: ChatAttachmentContextDescriptor,
  index: number,
): string {
  const absolutePath = String(attachment.path ?? '').trim();
  const relativePath = String(attachment.relativePath ?? '').trim();
  const shownPath =
    relativePath && relativePath !== absolutePath
      ? `${relativePath} (absolute: ${absolutePath})`
      : relativePath || absolutePath;
  return `${index + 1}. ${attachment.name} (${attachment.mime}, ${attachment.size} bytes): ${shownPath}`;
}
