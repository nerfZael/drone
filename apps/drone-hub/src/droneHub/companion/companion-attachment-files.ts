import type { CompanionImageAttachment } from '@drone/assistant-chat';

/**
 * Companion takes any file: each one is saved in Companion home and named to the model by path.
 * Images and text are also shown to the model directly, which is why those stay small.
 */
export const COMPANION_INLINE_MAX_BYTES = 6 * 1024 * 1024;
export const COMPANION_FILE_MAX_BYTES = 100 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'env', 'xml', 'html', 'css', 'scss',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'sql', 'diff', 'patch']);
const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-sh|x-yaml|yaml|toml|sql)\b)/i;

export function companionAttachmentMime(file: Pick<File, 'name' | 'type'>): string {
  if (file.type.startsWith('image/') && !file.type.includes('svg')) return file.type;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  // Text-like files travel as plain text under their own name, so notes.md stays notes.md.
  return TEXT_TYPES.test(file.type) || TEXT_EXTENSIONS.has(extension) ? 'text/plain' : file.type || 'application/octet-stream';
}

/** Whether the tray can preview it; other files are shown by name and open in Companion home. */
export function isCompanionPreviewable(attachment: { mime: string }): boolean {
  return attachment.mime.startsWith('image/') || attachment.mime === 'text/plain';
}

/** A pasted or dropped file as an attachment. Clipboard images are all called image.png, so those get a name that says what and when. */
export async function companionAttachmentFromFile(file: File, source: 'paste' | 'drop'): Promise<CompanionImageAttachment> {
  const mime = companionAttachmentMime(file);
  const readable = mime.startsWith('image/') || mime === 'text/plain';
  // An image or text too large to show the model is still welcome as a plain file.
  const inline = readable && file.size <= COMPANION_INLINE_MAX_BYTES;
  if (!file.size) throw new Error(`${file.name || 'That item'} is empty or a folder, so it cannot be attached.`);
  if (file.size > COMPANION_FILE_MAX_BYTES) throw new Error(`${file.name || 'That file'} is larger than 100 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  const generic = source === 'paste' && (!file.name || /^image\.[a-z]+$/i.test(file.name));
  const extension = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  return { name: generic ? `pasted-image-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}` : file.name, mime: inline ? mime : readable ? 'application/octet-stream' : mime, size: bytes.length, dataBase64: btoa(binary) };
}
