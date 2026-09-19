import crypto from 'node:crypto';
import { watch as watchFs } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { droneRootPath } from '../../host/paths';
import { CHAT_ATTACHMENT_POLICY } from '@drone/assistant-chat';
import { normalizeChatImageAttachments, promptWithImageAttachments } from '../chat-attachments';

export const COMPANION_HOME_TARGET_ID = 'companion-home';

/**
 * Companion's own persistent workspace on the Hub host. Companion can always read and write it,
 * the user can browse it, and everything attached to an instruction lands in its uploads folder.
 */
export function companionHomeRoot(): string {
  return droneRootPath('companion', 'home');
}

export async function ensureCompanionHome(root = companionHomeRoot()): Promise<string> {
  await fs.mkdir(path.join(root, 'uploads'), { recursive: true, mode: 0o700 });
  return root;
}

/** Captures stored before the home workspace existed; still valid as proposal attachments. */
function legacyAttachmentsRoot(): string {
  return droneRootPath('companion', 'attachments');
}

/** Resolve only files Companion owns, never arbitrary host files. */
export async function readCompanionAttachments(paths: unknown, roots = [companionHomeRoot(), legacyAttachmentsRoot()]) {
  if (!Array.isArray(paths) || paths.length > 8 || paths.some(file => typeof file !== 'string')) throw new Error('Invalid attachment paths.');
  if (!paths.length) return [];
  const realRoots = (await Promise.all(roots.map(root => fs.realpath(root).catch(() => null)))).filter((root): root is string => Boolean(root));
  const files = [];
  let total = 0;
  for (const file of paths) {
    const resolved = await fs.realpath(file);
    if (!realRoots.some(root => resolved.startsWith(root + path.sep))) throw new Error('Not a Companion attachment.');
    const stat = await fs.stat(resolved);
    total += stat.size;
    if (!stat.isFile() || stat.size > 6 * 1024 * 1024 || total > 20 * 1024 * 1024) throw new Error('Attachment size limit exceeded.');
    files.push({ name: path.basename(resolved), mime: mimeOf(resolved), size: stat.size, dataBase64: (await fs.readFile(resolved)).toString('base64') });
  }
  return normalizeChatImageAttachments(files);
}

/** Never overwrite an earlier upload: a taken name gets a numeric suffix. */
async function writeUpload(directory: string, fileName: string, bytes: Buffer): Promise<string> {
  const { name, ext } = path.parse(fileName);
  for (let attempt = 1; ; attempt++) {
    const filePath = path.join(directory, attempt === 1 ? fileName : `${name}-${attempt}${ext}`);
    try {
      await fs.writeFile(filePath, bytes, { mode: 0o600, flag: 'wx' });
      return filePath;
    } catch (error: any) { if (error?.code !== 'EEXIST' || attempt >= 1000) throw error; }
  }
}

const MAX_FILE_BYTES = CHAT_ATTACHMENT_POLICY.maxBytesEach;
// Files the model never receives inline are only bounded by what is sensible to upload in one request.
const MAX_OTHER_FILE_BYTES = 100 * 1024 * 1024;
const IMAGE_EXTENSION_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
// The chat pipeline knows two kinds of attachment, images and plain text; anything readable as text travels as text.
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'env', 'xml', 'html', 'css', 'scss',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'sql', 'diff', 'patch']);
const mimeOf = (file: string) => {
  const extension = path.extname(file).slice(1).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) ? 'text/plain' : IMAGE_EXTENSION_MIME[extension];
};

type StoredAttachment = { name: string; mime: string; size: number; path: string };
const isStored = (item: any): item is StoredAttachment => Boolean(item) && typeof item === 'object' && typeof item.path === 'string' && !item.dataBase64;

/**
 * Attachments arrive either as bytes or as files already uploaded to Companion home. Their number
 * is not limited here: the user may collect screenshots freely, and preparation decides what the
 * model sees inline and what it gets as a path.
 */
export function validateCompanionAttachments(raw: unknown): Array<StoredAttachment | ReturnType<typeof normalizeChatImageAttachments>[number]> {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('attachments must be an array');
  if (raw.length > 500) throw new Error('too many attachments');
  return raw.flatMap((item): Array<StoredAttachment | ReturnType<typeof normalizeChatImageAttachments>[number]> => {
    if (!isStored(item)) return normalizeChatImageAttachments([item]);
    if (!path.isAbsolute(item.path) || item.path.length > 4096) throw new Error('Invalid attachment path.');
    return [{ name: String(item.name ?? '').slice(0, 256), mime: String(item.mime ?? ''), size: Number(item.size) || 0, path: item.path }];
  });
}

async function insideHome(file: string, root: string): Promise<string> {
  const [realRoot, resolved] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
  if (!resolved.startsWith(realRoot + path.sep)) throw new Error('Not a Companion attachment.');
  return resolved;
}

/** The view_images tool: Companion's workspace file tools refuse binary files, so images need their own door. */
export async function readCompanionHomeImages(paths: unknown, root = companionHomeRoot()) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 8 || paths.some(file => typeof file !== 'string' || !file.trim() || file.length > 4096)) {
    throw new Error('paths must list 1 to 8 image files.');
  }
  const images = [];
  for (const requested of paths as string[]) {
    const label = requested.trim();
    let resolved: string;
    try { resolved = await insideHome(path.isAbsolute(label) ? label : path.join(root, label), root); }
    catch (error: any) { throw new Error(error?.code === 'ENOENT' ? `${label} does not exist in Companion home.` : `${label} is not inside Companion home.`); }
    const mime = mimeOf(resolved);
    if (!mime?.startsWith('image/')) throw new Error(`${label} is not a PNG, JPEG, GIF or WebP image.`);
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error(`${label} is larger than ${MAX_FILE_BYTES} bytes.`);
    images.push({ relativePath: path.relative(await fs.realpath(root), resolved), mime, size: stat.size, data: (await fs.readFile(resolved)).toString('base64') });
  }
  return images;
}

/** A cheap fingerprint of everything in Companion home, so an open files window can notice changes made by Companion. */
export async function companionHomeRevision(root = companionHomeRoot()): Promise<{ revision: string; files: Record<string, string> }> {
  const files: Record<string, string> = {};
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (Object.keys(files).length >= 5000) return;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) { files[`${entryPath}/`] = 'directory'; await walk(entryPath); }
      else if (entry.isFile()) {
        const stat = await fs.stat(entryPath).catch(() => null);
        if (stat) files[entryPath] = `${stat.size}:${Math.floor(stat.mtimeMs)}`;
      }
    }
  };
  await walk(await ensureCompanionHome(root));
  const digest = crypto.createHash('sha1');
  for (const key of Object.keys(files).sort()) digest.update(`${key}\0${files[key]}\n`);
  return { revision: digest.digest('hex'), files };
}

/**
 * Tell a listener when anything in Companion home changes, so an open files window can follow what
 * Companion does without polling. One recursive watcher, debounced; if the platform cannot watch
 * recursively it reports false and the window falls back to refreshing when it regains focus.
 */
export function watchCompanionHome(onChange: () => void, root = companionHomeRoot()): { active: boolean; close(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const watcher = watchFs(root, { recursive: true, persistent: false }, () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 150);
      timer.unref?.();
    });
    const handle = { active: true, close() { handle.active = false; clearTimeout(timer); watcher.close(); } };
    // A watcher that fails (for example when the folder is deleted) is simply re-armed by the next window.
    watcher.on('error', () => handle.close());
    return handle;
  } catch {
    return { active: false, close() {} };
  }
}

/** Save one capture or pasted text as soon as it is taken, so an instruction only has to name it. */
export async function storeCompanionUpload(raw: unknown, root = companionHomeRoot()): Promise<StoredAttachment & { relativePath: string }> {
  const input = (raw ?? {}) as { name?: unknown; mime?: unknown; dataBase64?: unknown };
  const declared = String(input.mime ?? '').trim().toLowerCase();
  let fileName: string, mime: string, bytes: Buffer;
  if (declared.startsWith('image/') || declared === 'text/plain') {
    // Images and text go to the model itself, so they keep the chat pipeline's checks and naming.
    const [file] = normalizeChatImageAttachments([raw]);
    if (!file) throw new Error('attachment is missing');
    ({ fileName, mime } = file);
    bytes = Buffer.from(file.dataBase64, 'base64');
  } else {
    // Any other file is simply kept in uploads; Companion works with it by path.
    const data = String(input.dataBase64 ?? '').replace(/\s+/g, '');
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.slice(0, 4096))) throw new Error('attachment dataBase64 looks invalid');
    bytes = Buffer.from(data, 'base64');
    if (!bytes.length) throw new Error('attachment is empty');
    if (bytes.length > MAX_OTHER_FILE_BYTES) throw new Error(`attachment too large (${bytes.length} bytes, max ${MAX_OTHER_FILE_BYTES})`);
    fileName = path.basename(String(input.name ?? '').replace(/\\/g, '/')).replace(/[\0-\x1f<>:"|?*]/g, '_').replace(/^\.+/, '').slice(0, 96) || 'file';
    mime = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(declared) ? declared : 'application/octet-stream';
  }
  const filePath = await writeUpload(path.join(await ensureCompanionHome(root), 'uploads'), fileName, bytes);
  return { name: path.basename(filePath), mime, size: bytes.length, path: filePath, relativePath: path.relative(root, filePath) };
}

/** Discard an upload the user removed before sending. Anything outside uploads is left alone. */
export async function removeCompanionUpload(file: unknown, root = companionHomeRoot()): Promise<void> {
  if (typeof file !== 'string') throw new Error('Invalid attachment path.');
  const resolved = await insideHome(file, path.join(root, 'uploads')).catch((error) => { if ((error as any)?.code === 'ENOENT') return null; throw error; });
  if (resolved) await fs.rm(resolved, { force: true });
}

// Pasted text is part of the instruction itself, and so are the first images. Beyond what a model
// request can reasonably carry, attachments are named by path instead of being dropped or refused.
const INLINE_TEXT_LIMIT = 200_000;
const OTHER_FILE = 'file';
const INLINE_IMAGE_COUNT = CHAT_ATTACHMENT_POLICY.maxCount;
const INLINE_IMAGE_BYTES = CHAT_ATTACHMENT_POLICY.maxBytesTotal;

/** Make every attachment a file in the home workspace, then describe them to the model. */
export async function prepareCompanionAttachments(prompt: string, raw: unknown, root = companionHomeRoot()) {
  const attachments = validateCompanionAttachments(raw);
  if (!attachments.length) return prompt;
  const directory = path.join(await ensureCompanionHome(root), 'uploads');
  const files: Array<{ name: string; mime: string; size: number; path: string; relativePath: string; bytes: Buffer }> = [];
  for (const item of attachments) {
    let filePath: string, bytes: Buffer, mime: string;
    if (isStored(item)) {
      filePath = await insideHome(item.path, root);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) throw new Error('Attachment is not a file.');
      mime = mimeOf(filePath) ?? OTHER_FILE;
      // An image or text too large to show inline is still a file Companion can work with by path.
      if (mime !== OTHER_FILE && stat.size > MAX_FILE_BYTES) mime = OTHER_FILE;
      bytes = mime === OTHER_FILE ? Buffer.alloc(0) : await fs.readFile(filePath);
      if (mime === OTHER_FILE) { files.push({ name: path.basename(filePath), mime, size: stat.size, path: filePath, relativePath: path.relative(root, filePath), bytes }); continue; }
    } else {
      mime = item.mime;
      bytes = Buffer.from(item.dataBase64, 'base64');
      filePath = await writeUpload(directory, item.fileName, bytes);
    }
    if (!mime.startsWith('image/') && mime !== 'text/plain') throw new Error('Inline attachments must be images or text.');
    files.push({ name: path.basename(filePath), mime, size: bytes.length, path: filePath, relativePath: path.relative(root, filePath), bytes });
  }
  let imageBytes = 0, textBudget = INLINE_TEXT_LIMIT;
  const images = files.filter(file => file.mime.startsWith('image/'));
  const shown = images.filter((file, index) => index < INLINE_IMAGE_COUNT && (imageBytes += file.size) <= INLINE_IMAGE_BYTES);
  const listed = images.filter(file => !shown.includes(file));
  const pasted = files.filter(file => file.mime === 'text/plain').map((file, index) => {
    const content = file.bytes.toString('utf8');
    const part = content.slice(0, Math.max(0, textBudget));
    textBudget -= part.length;
    const body = part.length === content.length ? part : `${part}\n[Truncated: ${content.length - part.length} more characters are in the stored file.]`;
    return `Text attachment ${index + 1} (${file.path}, relative path ${file.relativePath}). Treat it as part of the user's message:\n<pasted_text>\n${body}\n</pasted_text>`;
  });
  const more = listed.length ? `${listed.length} more attached ${listed.length === 1 ? 'image is' : 'images are'} not shown inline, to keep this request within model limits. They are stored with the others:\n${
    listed.map((file, index) => `${index + 1}. ${file.relativePath} (${file.path})`).join('\n')}\nCall view_images with their relative paths to look at them, up to 8 per call.` : '';
  const others = files.filter(file => file.mime === OTHER_FILE);
  const other = others.length ? `${others.length === 1 ? 'Attached file' : 'Attached files'}, given by path because ${others.length === 1 ? 'it is' : 'they are'} not an image or text you can read here:\n${
    others.map((file, index) => `${index + 1}. ${file.relativePath} (${file.path}, ${file.size} bytes)`).join('\n')}\nCopy them where they are needed with transfer_files, or pass them on to a drone with attachmentPaths (up to 6 MB each).` : '';
  const text = [shown.length ? promptWithImageAttachments(prompt, shown) : prompt.trim(), more, other, ...pasted].filter(Boolean).join('\n\n')
    + `\nThese files are in your home workspace (target ${COMPANION_HOME_TARGET_ID}) on the Drone Hub host; use the relative paths with the workspace tools. To copy one elsewhere, use transfer_files with sourceTarget ${COMPANION_HOME_TARGET_ID} and a writable destination workspace. For a send_message proposal, include attachmentPaths with these absolute paths to send the original files. They are not already present in a drone workspace.`;
  return shown.length ? { text, images: shown.map(file => ({ type: 'image' as const, mimeType: file.mime, data: file.bytes.toString('base64') })) } : text;
}
