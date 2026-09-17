import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { droneRootPath } from '../../host/paths';
import { normalizeChatImageAttachments, promptWithImageAttachments } from '../chat-attachments';

export function companionAttachmentsRoot(runId?: string): string {
  const base = droneRootPath('companion', 'attachments');
  return runId ? path.join(base, crypto.createHash('sha256').update(runId).digest('hex')) : base;
}

/** Resolve only stored Companion captures, never arbitrary host files. */
export async function readCompanionAttachments(paths: unknown, root = companionAttachmentsRoot()) {
  if (!Array.isArray(paths) || paths.length > 8 || paths.some(file => typeof file !== 'string')) throw new Error('Invalid attachment paths.');
  if (!paths.length) return [];
  const realRoot = await fs.realpath(root);
  const files = [];
  let total = 0;
  for (const file of paths) {
    const resolved = await fs.realpath(file);
    if (!resolved.startsWith(realRoot + path.sep)) throw new Error('Not a Companion attachment.');
    const stat = await fs.stat(resolved);
    total += stat.size;
    if (!stat.isFile() || stat.size > 6 * 1024 * 1024 || total > 20 * 1024 * 1024) throw new Error('Attachment size limit exceeded.');
    files.push({ name: path.basename(resolved), size: stat.size, dataBase64: (await fs.readFile(resolved)).toString('base64') });
  }
  return normalizeChatImageAttachments(files);
}

/** Store on the Hub host so the model can reference or transfer the original file later. */
export async function prepareCompanionAttachments(prompt: string, raw: unknown, root = companionAttachmentsRoot()) {
  const attachments = normalizeChatImageAttachments(raw);
  if (!attachments.length) return prompt;
  if (attachments.some(file => !file.mime.startsWith('image/'))) throw new Error('Companion attachments must be images.');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(path.join(root, 'capture-'));
  const files = [];
  for (const file of attachments) {
    const filePath = path.join(directory, file.fileName);
    await fs.writeFile(filePath, Buffer.from(file.dataBase64, 'base64'), { mode: 0o600 });
    files.push({ ...file, path: filePath, relativePath: path.relative(root, filePath) });
  }
  return {
    text: promptWithImageAttachments(prompt, files) + '\nThese attachment paths are on the Drone Hub host. For transfer_files, use sourceTarget companion-attachments and the relative attachment path, with a writable destination workspace. For a send_message proposal, include attachmentPaths with these absolute paths to send the original images. They are not already present in a drone workspace.',
    images: attachments.map(file => ({ type: 'image' as const, mimeType: file.mime, data: file.dataBase64 })),
  };
}
