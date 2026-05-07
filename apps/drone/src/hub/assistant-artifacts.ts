import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { droneRootPath } from '../host/paths';

export type AssistantArtifactFileSummary = {
  path: string;
  size: number;
  updatedAt: string;
  revision: string;
};

export type AssistantArtifactFile = AssistantArtifactFileSummary & {
  content: string;
};

export type AssistantArtifactPatch = {
  oldText: string;
  newText: string;
};

export type AssistantArtifactActionInput = {
  action: 'list' | 'read' | 'write' | 'append' | 'patch' | 'delete';
  path?: unknown;
  content?: unknown;
  baseRevision?: unknown;
  patches?: unknown;
};

const ARTIFACT_MAX_FILE_BYTES = 500_000;
const ARTIFACT_MAX_PATH_CHARS = 180;

function nowIso(): string {
  return new Date().toISOString();
}

function errorWithStatus(message: string, statusCode: number): Error & { statusCode?: number } {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = statusCode;
  return err;
}

function safeThreadSegment(threadIdRaw: unknown): string {
  const raw = String(threadIdRaw ?? '').trim();
  if (!raw) throw errorWithStatus('missing assistant thread id', 400);
  const cleaned = String(threadIdRaw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 88);
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return `${cleaned || 'thread'}-${hash}`;
}

export function normalizeAssistantArtifactPath(raw: unknown): string {
  const input = String(raw ?? '').trim().replace(/\\/g, '/');
  const withoutLeadingSlash = input.replace(/^\/+/, '');
  const collapsed = withoutLeadingSlash.replace(/\/+/g, '/');
  if (!collapsed) throw errorWithStatus('missing artifact path', 400);
  if (collapsed.length > ARTIFACT_MAX_PATH_CHARS) throw errorWithStatus('artifact path is too long', 400);
  if (collapsed.endsWith('/')) throw errorWithStatus('artifact path must be a file', 400);
  const segments = collapsed.split('/').filter(Boolean);
  if (segments.length === 0) throw errorWithStatus('missing artifact path', 400);
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.startsWith('.') || segment.includes('\0')) {
      throw errorWithStatus(`invalid artifact path: ${collapsed}`, 400);
    }
  }
  return segments.join('/');
}

function artifactsRoot(threadId: string): string {
  return droneRootPath('assistant-artifacts', safeThreadSegment(threadId));
}

function resolveArtifactPath(threadId: string, artifactPathRaw: unknown): { root: string; artifactPath: string; filePath: string } {
  const root = artifactsRoot(threadId);
  const artifactPath = normalizeAssistantArtifactPath(artifactPathRaw);
  const filePath = path.resolve(root, artifactPath);
  const rootResolved = path.resolve(root);
  if (filePath !== rootResolved && !filePath.startsWith(`${rootResolved}${path.sep}`)) {
    throw errorWithStatus(`invalid artifact path: ${artifactPath}`, 400);
  }
  return { root, artifactPath, filePath };
}

function revisionForContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

async function summaryForFile(root: string, artifactPath: string): Promise<AssistantArtifactFileSummary> {
  const filePath = path.resolve(root, artifactPath);
  const [stat, content] = await Promise.all([fs.stat(filePath), fs.readFile(filePath, 'utf8')]);
  return {
    path: artifactPath,
    size: Number.isFinite(stat.size) ? Math.max(0, Math.floor(stat.size)) : Buffer.byteLength(content, 'utf8'),
    updatedAt: Number.isFinite(stat.mtimeMs) ? new Date(stat.mtimeMs).toISOString() : nowIso(),
    revision: revisionForContent(content),
  };
}

async function walkFiles(root: string, dir: string, out: string[]): Promise<void> {
  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e: any) {
    if (e?.code === 'ENOENT') return;
    throw e;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(root, full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(path.relative(root, full).replace(/\\/g, '/'));
  }
}

export async function listAssistantArtifactFiles(threadId: string): Promise<AssistantArtifactFileSummary[]> {
  const root = artifactsRoot(threadId);
  const paths: string[] = [];
  await walkFiles(root, root, paths);
  const files = await Promise.all(paths.sort((a, b) => a.localeCompare(b)).map((item) => summaryForFile(root, item)));
  return files;
}

export async function deleteAssistantArtifactsForThread(threadId: string): Promise<void> {
  await fs.rm(artifactsRoot(threadId), { recursive: true, force: true });
}

export async function readAssistantArtifactFile(threadId: string, artifactPathRaw: unknown): Promise<AssistantArtifactFile> {
  const { root, artifactPath, filePath } = resolveArtifactPath(threadId, artifactPathRaw);
  let content: string;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw errorWithStatus(`artifact is not a file: ${artifactPath}`, 404);
    if (stat.size > ARTIFACT_MAX_FILE_BYTES) {
      throw errorWithStatus(`artifact is too large (${stat.size} bytes, max ${ARTIFACT_MAX_FILE_BYTES})`, 413);
    }
    content = await fs.readFile(filePath, 'utf8');
  } catch (e: any) {
    if (e?.statusCode) throw e;
    if (e?.code === 'ENOENT') throw errorWithStatus(`artifact not found: ${artifactPath}`, 404);
    throw e;
  }
  const summary = await summaryForFile(root, artifactPath);
  return { ...summary, content };
}

async function writeAssistantArtifactFile(
  threadId: string,
  artifactPathRaw: unknown,
  contentRaw: unknown,
  baseRevisionRaw?: unknown,
): Promise<AssistantArtifactFile> {
  const { artifactPath, filePath } = resolveArtifactPath(threadId, artifactPathRaw);
  const content = String(contentRaw ?? '');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > ARTIFACT_MAX_FILE_BYTES) {
    throw errorWithStatus(`artifact is too large (${bytes} bytes, max ${ARTIFACT_MAX_FILE_BYTES})`, 413);
  }
  const baseRevision = String(baseRevisionRaw ?? '').trim();
  if (baseRevision) {
    const existing = await readAssistantArtifactFile(threadId, artifactPath);
    if (existing.revision !== baseRevision) {
      throw errorWithStatus(`artifact revision changed: ${artifactPath}`, 409);
    }
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, filePath);
  return await readAssistantArtifactFile(threadId, artifactPath);
}

async function appendAssistantArtifactFile(
  threadId: string,
  artifactPathRaw: unknown,
  contentRaw: unknown,
  baseRevisionRaw?: unknown,
): Promise<AssistantArtifactFile> {
  let current = '';
  try {
    current = (await readAssistantArtifactFile(threadId, artifactPathRaw)).content;
  } catch (e: any) {
    if (e?.statusCode !== 404) throw e;
  }
  return await writeAssistantArtifactFile(threadId, artifactPathRaw, `${current}${String(contentRaw ?? '')}`, baseRevisionRaw);
}

function normalizePatches(raw: unknown): AssistantArtifactPatch[] {
  const list = Array.isArray(raw) ? raw : [];
  const patches = list
    .map((item) => ({
      oldText: String((item as any)?.oldText ?? ''),
      newText: String((item as any)?.newText ?? ''),
    }))
    .filter((item) => item.oldText);
  if (patches.length === 0) throw errorWithStatus('missing patches', 400);
  return patches;
}

async function patchAssistantArtifactFile(
  threadId: string,
  artifactPathRaw: unknown,
  patchesRaw: unknown,
  baseRevisionRaw?: unknown,
): Promise<AssistantArtifactFile> {
  const current = await readAssistantArtifactFile(threadId, artifactPathRaw);
  const baseRevision = String(baseRevisionRaw ?? '').trim();
  if (baseRevision && current.revision !== baseRevision) {
    throw errorWithStatus(`artifact revision changed: ${current.path}`, 409);
  }
  let nextContent = current.content;
  for (const patch of normalizePatches(patchesRaw)) {
    const first = nextContent.indexOf(patch.oldText);
    if (first < 0) throw errorWithStatus(`patch text not found in ${current.path}`, 409);
    const second = nextContent.indexOf(patch.oldText, first + patch.oldText.length);
    if (second >= 0) throw errorWithStatus(`patch text is ambiguous in ${current.path}`, 409);
    nextContent = `${nextContent.slice(0, first)}${patch.newText}${nextContent.slice(first + patch.oldText.length)}`;
  }
  return await writeAssistantArtifactFile(threadId, current.path, nextContent);
}

async function deleteAssistantArtifactFile(threadId: string, artifactPathRaw: unknown): Promise<{ path: string; deleted: boolean }> {
  const { artifactPath, filePath } = resolveArtifactPath(threadId, artifactPathRaw);
  try {
    await fs.rm(filePath, { force: false });
    return { path: artifactPath, deleted: true };
  } catch (e: any) {
    if (e?.code === 'ENOENT') return { path: artifactPath, deleted: false };
    throw e;
  }
}

export async function runAssistantArtifactAction(threadId: string, input: AssistantArtifactActionInput): Promise<any> {
  const action = String(input?.action ?? '').trim().toLowerCase();
  if (action === 'list') {
    return { ok: true, files: await listAssistantArtifactFiles(threadId) };
  }
  if (action === 'read') {
    return { ok: true, file: await readAssistantArtifactFile(threadId, input.path) };
  }
  if (action === 'write') {
    return { ok: true, file: await writeAssistantArtifactFile(threadId, input.path, input.content, input.baseRevision) };
  }
  if (action === 'append') {
    return { ok: true, file: await appendAssistantArtifactFile(threadId, input.path, input.content, input.baseRevision) };
  }
  if (action === 'patch') {
    return { ok: true, file: await patchAssistantArtifactFile(threadId, input.path, input.patches, input.baseRevision) };
  }
  if (action === 'delete') {
    return { ok: true, ...(await deleteAssistantArtifactFile(threadId, input.path)) };
  }
  throw errorWithStatus(`unknown artifact action: ${action || '(empty)'}`, 400);
}
