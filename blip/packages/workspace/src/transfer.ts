import {
  AgentToolResultError,
  type AgentToolResult,
} from '@mariozechner/pi-agent-core/portable';
import type {
  WorkspaceTarget,
  WorkspaceTargetCatalog,
  WorkspaceTransferDestination,
} from './index.js';

// Base64 and request metadata must remain below the mesh's 240 KiB envelope.
const CHUNK_BYTES = 128 * 1024;
const MAX_CHUNK_BASE64_CHARS = Math.ceil(CHUNK_BYTES / 3) * 4 + 4;
const MAX_FILES = 500;
const MAX_DIRECTORIES = 1_000;
const MAX_RETRIES = 5;

export type WorkspaceTransferFileProgress = {
  sourcePath: string;
  destinationPath: string;
  size: number;
  mtimeMs?: number | null;
  transferredBytes: number;
  retries: number;
  status: 'pending' | 'transferring' | 'retrying' | 'completed' | 'failed';
  error?: string;
};

export type WorkspaceTransferProgress = {
  type: 'workspace_transfer';
  phase: 'planning' | 'transferring' | 'completed' | 'failed';
  source: { targetId: string; targetLabel: string; path: string };
  destination: { targetId: string; targetLabel: string; path: string };
  fileCount: number;
  completedFiles: number;
  totalBytes: number;
  transferredBytes: number;
  retries: number;
  resumedFiles?: number;
  resumeToken?: string;
  failure?: {
    sourcePath?: string;
    destinationPath?: string;
    error: string;
    resumable: boolean;
    cleanupError?: string;
  };
  filesPartial?: boolean;
  files: WorkspaceTransferFileProgress[];
};

type WorkspaceTransferPlan = Awaited<ReturnType<typeof makePlan>>;

function fingerprint(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

function transferPlanFingerprint(input: {
  sourceTarget: string;
  sourcePath: string;
  destinationTarget: string;
  destinationPath: string;
  plan: WorkspaceTransferPlan;
}): string {
  return fingerprint(
    JSON.stringify({
      sourceTarget: input.sourceTarget,
      sourcePath: input.sourcePath,
      destinationTarget: input.destinationTarget,
      destinationPath: input.destinationPath,
      directories: input.plan.directories,
      files: input.plan.files.map((file) => [
        file.sourcePath,
        file.destinationPath,
        file.size,
        file.mtimeMs ?? null,
      ]),
    }),
  );
}

function resumeChecksum(planFingerprint: string, completedFiles: number): string {
  return fingerprint(`${planFingerprint}:${completedFiles}`);
}

function createResumeToken(planFingerprint: string, completedFiles: number): string {
  return `tr1_${completedFiles}_${resumeChecksum(planFingerprint, completedFiles)}`;
}

function parseResumeToken(raw: unknown): { completedFiles: number; fingerprint: string } | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const match = /^tr1_(\d{1,3})_([0-9a-f]{16})$/.exec(value);
  if (!match) throw new Error('resumeToken is invalid');
  return { completedFiles: Number(match[1]), fingerprint: match[2] };
}

export function normalizeWorkspaceTransferPath(value: unknown): string {
  const raw = String(value ?? '')
    .trim()
    .replace(/\\/g, '/');
  if (raw === '.') return '.';
  const parts = raw.split('/').filter((part) => part && part !== '.');
  if (!raw || raw.startsWith('/') || parts.includes('..'))
    throw new Error('transfer paths must be workspace-relative and cannot contain ..');
  return parts.join('/');
}

export function isWorkspaceTransferTemporaryName(value: unknown): boolean {
  return /^\.(?:.+\.)?blip-transfer-[a-zA-Z0-9_-]{1,240}\.part$/.test(String(value ?? ''));
}

function joinPath(parent: string, name: string): string {
  const child = normalizeWorkspaceTransferPath(name);
  if (child.includes('/')) throw new Error(`invalid transfer entry name: ${name}`);
  return parent === '.' ? child : `${parent.replace(/\/$/, '')}/${child}`;
}

function aborted(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('transfer cancelled');
  error.name = 'AbortError';
  return error;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(aborted(signal));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(aborted(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isRetryable(error: unknown): boolean {
  const code = String((error as any)?.code ?? '').toUpperCase();
  if (
    [
      'ABORT_ERR',
      'WORKSPACE_POLICY_DENIED',
      'PATH_OUTSIDE_ROOT',
      'FILE_EXISTS',
      'INVALID_REQUEST',
      'ENOENT',
      'ENOTDIR',
      'EISDIR',
      'TRANSFER_INCOMPLETE',
      'TRANSFER_OFFSET_MISMATCH',
      'SOURCE_CHANGED',
    ].includes(code)
  )
    return false;
  if (String((error as any)?.name ?? '').toLowerCase() === 'aborterror') return false;
  return !/(permission denied|access denied|not permitted|path .*outside|already exists|invalid path)/i.test(
    String((error as any)?.message ?? error ?? ''),
  );
}

async function retry<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
  onRetry: (error: unknown) => void,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw aborted(signal);
    try {
      return await operation();
    } catch (error) {
      if (signal?.aborted) throw aborted(signal);
      if (attempt >= MAX_RETRIES || !isRetryable(error)) throw error;
      onRetry(error);
      await wait(Math.min(4_000, 250 * 2 ** attempt), signal);
    }
  }
}

function progressResult(
  progress: WorkspaceTransferProgress,
  partialFiles: boolean,
): AgentToolResult<unknown> {
  const active = progress.files.find((file) =>
    ['transferring', 'retrying', 'failed'].includes(file.status),
  );
  const text =
    progress.phase === 'planning'
      ? 'Scanning files to transfer…'
      : active
        ? active.status === 'failed'
          ? `Failed ${active.sourcePath}: ${active.error ?? 'transfer failed'}`
          : `${active.status === 'retrying' ? 'Retrying' : 'Transferring'} ${active.sourcePath}: ${active.transferredBytes}/${active.size} bytes`
        : `Transferred ${progress.completedFiles}/${progress.fileCount} files`;
  const details = JSON.parse(JSON.stringify(progress)) as WorkspaceTransferProgress;
  if (partialFiles) {
    const changedFile =
      active ?? [...progress.files].reverse().find((file) => file.status === 'completed');
    details.files = changedFile ? [JSON.parse(JSON.stringify(changedFile))] : [];
    details.filesPartial = true;
  }
  return {
    content: [{ type: 'text', text }],
    // Progress events may be delivered asynchronously. Freeze each frame so a later
    // chunk cannot mutate an earlier retry/file state before the host renders it.
    details,
  };
}

function throwTransferFailure(input: {
  error: unknown;
  progress: WorkspaceTransferProgress;
  fingerprint?: string;
  file?: WorkspaceTransferFileProgress;
  cleanupError?: string;
  update: () => void;
}): never {
  const message = String((input.error as any)?.message ?? input.error ?? 'transfer failed');
  const resumable = Boolean(
    input.fingerprint && (input.progress.completedFiles > 0 || isRetryable(input.error)),
  );
  input.progress.phase = 'failed';
  input.progress.failure = {
    ...(input.file
      ? {
          sourcePath: input.file.sourcePath,
          destinationPath: input.file.destinationPath,
        }
      : {}),
    error: message,
    resumable,
    ...(input.cleanupError ? { cleanupError: input.cleanupError } : {}),
  };
  if (resumable) {
    input.progress.resumeToken = createResumeToken(
      input.fingerprint!,
      input.progress.completedFiles,
    );
  } else {
    delete input.progress.resumeToken;
  }
  input.update();
  const countText = `${input.progress.completedFiles}/${input.progress.fileCount} files (${input.progress.transferredBytes}/${input.progress.totalBytes} bytes)`;
  const failedAt = input.file
    ? ` Failed at ${input.file.sourcePath} → ${input.file.destinationPath}: ${message}.`
    : ` ${message}.`;
  const resumeText = input.progress.resumeToken
    ? ` Resume by calling transfer_files with the same source and destination plus resumeToken "${input.progress.resumeToken}".`
    : '';
  const cleanupText = input.cleanupError ? ` Temporary-file cleanup also failed: ${input.cleanupError}.` : '';
  const heading =
    input.progress.fileCount === 0 && !input.file
      ? 'Transfer failed before copying files'
      : input.progress.completedFiles > 0 || input.progress.transferredBytes > 0
        ? `Transfer partially completed: ${countText}`
        : `Transfer failed: ${countText}`;
  const text = `${heading}.${failedAt}${cleanupText}${resumeText}`;
  const details = JSON.parse(JSON.stringify(input.progress)) as WorkspaceTransferProgress;
  throw new AgentToolResultError(text, {
    content: [{ type: 'text', text }],
    details,
  });
}

async function makePlan(
  source: WorkspaceTarget,
  sourcePath: string,
  destinationPath: string,
  signal?: AbortSignal,
) {
  const adapter = source.transfer?.source;
  if (!adapter) throw new Error(`${source.descriptor.label} cannot be used as a transfer source`);
  const root = await adapter.stat(sourcePath, signal);
  if (!root || (root.type !== 'file' && root.type !== 'directory'))
    throw Object.assign(new Error('transfer source returned invalid metadata'), {
      code: 'INVALID_REQUEST',
    });
  if (root.type === 'file')
    return {
      directories: [] as string[],
      files: [
        {
          sourcePath,
          destinationPath,
          size: transferSize(root.size, sourcePath),
          mtimeMs: transferMtime(root.mtimeMs, sourcePath),
        },
      ],
    };
  const directories = [destinationPath];
  const files: Array<{
    sourcePath: string;
    destinationPath: string;
    size: number;
    mtimeMs?: number | null;
  }> = [];
  const queue = [{ sourcePath, destinationPath }];
  while (queue.length) {
    if (signal?.aborted) throw aborted(signal);
    const current = queue.shift()!;
    const listed = await adapter.list(current.sourcePath, signal);
    if (!Array.isArray(listed))
      throw Object.assign(new Error(`transfer source returned an invalid directory listing`), {
        code: 'INVALID_REQUEST',
      });
    const entries = [...listed].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    const entryNames = new Set<string>();
    for (const entry of entries) {
      if (!entry || (entry.type !== 'file' && entry.type !== 'directory'))
        throw Object.assign(new Error('transfer source returned an invalid directory entry'), {
          code: 'INVALID_REQUEST',
        });
      if (entryNames.has(entry.name))
        throw Object.assign(new Error(`transfer source returned duplicate entry: ${entry.name}`), {
          code: 'INVALID_REQUEST',
        });
      entryNames.add(entry.name);
      const next = {
        sourcePath: joinPath(current.sourcePath, entry.name),
        destinationPath: joinPath(current.destinationPath, entry.name),
      };
      if (entry.type === 'directory') {
        directories.push(next.destinationPath);
        if (directories.length > MAX_DIRECTORIES)
          throw Object.assign(
            new Error(`transfer contains more than ${MAX_DIRECTORIES} directories`),
            { code: 'INVALID_REQUEST' },
          );
        queue.push(next);
      } else {
        files.push({
          ...next,
          size: transferSize(entry.size, next.sourcePath),
          mtimeMs: transferMtime(entry.mtimeMs, next.sourcePath),
        });
        if (files.length > MAX_FILES)
          throw Object.assign(new Error(`transfer contains more than ${MAX_FILES} files`), {
            code: 'INVALID_REQUEST',
          });
      }
    }
  }
  return { directories, files };
}

function transferSize(value: unknown, sourcePath: string): number {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0)
    throw Object.assign(new Error(`transfer source returned an invalid size for ${sourcePath}`), {
      code: 'INVALID_REQUEST',
    });
  return size;
}

function transferMtime(value: unknown, sourcePath: string): number | null {
  if (value === undefined || value === null) return null;
  const mtimeMs = Number(value);
  if (!Number.isFinite(mtimeMs))
    throw Object.assign(
      new Error(`transfer source returned an invalid modification time for ${sourcePath}`),
      { code: 'INVALID_REQUEST' },
    );
  return mtimeMs;
}

function transferId(callId: string, fileIndex: number): string {
  const cleanCallId = String(callId ?? '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 200);
  return `${cleanCallId || 'transfer'}-${fileIndex}`;
}

async function cleanupPartialFile(
  abortFile: NonNullable<WorkspaceTransferDestination['abortFile']>,
  input: { path: string; transferId: string },
): Promise<void> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      abortFile(input, controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('temporary-file cleanup timed out'));
        }, 5_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runWorkspaceTransfer(input: {
  catalog: WorkspaceTargetCatalog;
  callId: string;
  sourceTarget: string;
  sourcePath: string;
  destinationTarget: string;
  destinationPath: string;
  overwrite?: boolean;
  resumeToken?: string;
  signal?: AbortSignal;
  onUpdate?: (result: AgentToolResult<unknown>) => void;
}): Promise<AgentToolResult<unknown>> {
  const sourcePath = normalizeWorkspaceTransferPath(input.sourcePath);
  const destinationPath = normalizeWorkspaceTransferPath(input.destinationPath);
  const source = input.catalog.resolve(input.sourceTarget);
  const destination = input.catalog.resolve(input.destinationTarget);
  if (source.descriptor.id === destination.descriptor.id)
    throw new Error('source and destination workspaces must be different');
  if (!source.descriptor.capabilities.includes('files.read') || !source.transfer?.source)
    throw new Error(`${source.descriptor.label} does not allow transfer reads`);
  if (
    !destination.descriptor.capabilities.includes('files.write') ||
    !destination.transfer?.destination
  )
    throw new Error(`${destination.descriptor.label} does not allow transfer writes`);
  const progress: WorkspaceTransferProgress = {
    type: 'workspace_transfer',
    phase: 'planning',
    source: {
      targetId: source.descriptor.id,
      targetLabel: source.descriptor.label,
      path: sourcePath,
    },
    destination: {
      targetId: destination.descriptor.id,
      targetLabel: destination.descriptor.label,
      path: destinationPath,
    },
    fileCount: 0,
    completedFiles: 0,
    totalBytes: 0,
    transferredBytes: 0,
    retries: 0,
    files: [],
  };
  let lastUpdateAt = 0;
  let sentFileManifest = false;
  const update = (force = false) => {
    const now = Date.now();
    if (!force && now - lastUpdateAt < 100) return;
    lastUpdateAt = now;
    try {
      const hasManifest = progress.files.length > 0;
      const partialFiles = hasManifest && sentFileManifest;
      input.onUpdate?.(progressResult(progress, partialFiles));
      if (hasManifest) sentFileManifest = true;
    } catch {
      // Progress delivery is best-effort and must not change the file operation outcome.
    }
  };
  const noteRetry = (file?: WorkspaceTransferFileProgress) => (error: unknown) => {
    progress.retries += 1;
    if (file) {
      file.retries += 1;
      file.status = 'retrying';
      file.error = String((error as any)?.message ?? error);
    }
    update(true);
  };
  update(true);
  let plan: WorkspaceTransferPlan;
  try {
    plan = await retry(
      () => makePlan(source, sourcePath, destinationPath, input.signal),
      input.signal,
      noteRetry(),
    );
  } catch (error) {
    throwTransferFailure({ error, progress, update: () => update(true) });
  }
  const fingerprint = transferPlanFingerprint({
    sourceTarget: source.descriptor.id,
    sourcePath,
    destinationTarget: destination.descriptor.id,
    destinationPath,
    plan,
  });
  progress.phase = 'transferring';
  progress.fileCount = plan.files.length;
  progress.totalBytes = plan.files.reduce((sum, file) => sum + file.size, 0);
  if (!Number.isSafeInteger(progress.totalBytes))
    throwTransferFailure({
      error: Object.assign(new Error('transfer total size exceeds the supported range'), {
        code: 'INVALID_REQUEST',
      }),
      progress,
      fingerprint,
      update: () => update(true),
    });
  let resume: ReturnType<typeof parseResumeToken> = null;
  try {
    resume = parseResumeToken(input.resumeToken);
    if (resume && resume.fingerprint !== resumeChecksum(fingerprint, resume.completedFiles))
      throw Object.assign(
        new Error('resumeToken does not match the current source, destination, or file plan'),
        { code: 'INVALID_REQUEST' },
      );
    if (resume && resume.completedFiles > plan.files.length)
      throw Object.assign(new Error('resumeToken completed-file count is invalid'), {
        code: 'INVALID_REQUEST',
      });
  } catch (error) {
    throwTransferFailure({ error, progress, fingerprint, update: () => update(true) });
  }
  const resumedFiles = resume?.completedFiles ?? 0;
  progress.completedFiles = resumedFiles;
  progress.transferredBytes = plan.files
    .slice(0, resumedFiles)
    .reduce((sum, file) => sum + file.size, 0);
  if (resumedFiles > 0) progress.resumedFiles = resumedFiles;
  progress.files = plan.files.map((file, index) => ({
    ...file,
    transferredBytes: index < resumedFiles ? file.size : 0,
    retries: 0,
    status: index < resumedFiles ? 'completed' : 'pending',
  }));
  update(true);
  const target = destination.transfer.destination;
  try {
    for (const directory of plan.directories)
      await retry(() => target.createDirectory(directory, input.signal), input.signal, noteRetry());
  } catch (error) {
    throwTransferFailure({
      error,
      progress,
      fingerprint,
      update: () => update(true),
    });
  }
  for (let fileIndex = resumedFiles; fileIndex < progress.files.length; fileIndex += 1) {
    const file = progress.files[fileIndex];
    const currentTransferId = transferId(input.callId, fileIndex);
    file.status = 'transferring';
    update(true);
    try {
      const prepared = await retry(
        () =>
          target.prepareFile(
            {
              path: file.destinationPath,
              transferId: currentTransferId,
              size: file.size,
              overwrite: input.overwrite === true,
            },
            input.signal,
          ),
        input.signal,
        noteRetry(file),
      );
      if (!Number.isSafeInteger(prepared?.offset) || prepared.offset < 0 || prepared.offset > file.size)
        throw Object.assign(
          new Error(`destination returned invalid transfer offset ${String(prepared?.offset)}`),
          { code: 'INVALID_REQUEST' },
        );
      let offset = prepared.offset;
      file.transferredBytes = offset;
      progress.transferredBytes += offset;
      while (offset < file.size) {
        file.status = 'transferring';
        delete file.error;
        const chunk = await retry(
          () =>
            source.transfer!.source!.readChunk(file.sourcePath, offset, CHUNK_BYTES, input.signal),
          input.signal,
          noteRetry(file),
        );
        if (
          !chunk ||
          !Number.isSafeInteger(chunk.bytes) ||
          chunk.bytes <= 0 ||
          chunk.bytes > CHUNK_BYTES ||
          chunk.bytes > file.size - offset ||
          typeof chunk.dataBase64 !== 'string' ||
          chunk.dataBase64.length > MAX_CHUNK_BASE64_CHARS
        )
          throw Object.assign(new Error(`source returned an invalid chunk at ${offset} bytes`), {
            code: 'INVALID_REQUEST',
          });
        const written = await retry(
          () =>
            target.writeChunk(
              {
                path: file.destinationPath,
                transferId: currentTransferId,
                offset,
                dataBase64: chunk.dataBase64,
              },
              input.signal,
            ),
          input.signal,
          noteRetry(file),
        );
        if (
          !Number.isSafeInteger(written?.offset) ||
          written.offset !== offset + chunk.bytes ||
          written.offset > file.size
        )
          throw Object.assign(
            new Error(`destination returned invalid transfer offset ${String(written?.offset)}`),
            { code: 'INVALID_REQUEST' },
          );
        progress.transferredBytes += written.offset - offset;
        offset = written.offset;
        file.transferredBytes = offset;
        update();
      }
      const after = await retry(
        () => source.transfer!.source!.stat(file.sourcePath, input.signal),
        input.signal,
        noteRetry(file),
      );
      if (
        after.type !== 'file' ||
        transferSize(after.size, file.sourcePath) !== file.size ||
        transferMtime(after.mtimeMs, file.sourcePath) !== (file.mtimeMs ?? null)
      )
        throw Object.assign(new Error(`source changed while transferring: ${file.sourcePath}`), {
          code: 'SOURCE_CHANGED',
        });
      await retry(
        () =>
          target.commitFile(
            {
              path: file.destinationPath,
              transferId: currentTransferId,
              size: file.size,
              overwrite: input.overwrite === true,
            },
            input.signal,
          ),
        input.signal,
        noteRetry(file),
      );
      file.status = 'completed';
      progress.completedFiles += 1;
      update(true);
    } catch (error) {
      file.status = 'failed';
      file.error = String((error as any)?.message ?? error);
      progress.phase = 'failed';
      update(true);
      let cleanupError = '';
      try {
        if (target.abortFile)
          await cleanupPartialFile(target.abortFile.bind(target), {
            path: file.destinationPath,
            transferId: currentTransferId,
          });
      } catch (cleanupFailure) {
        cleanupError = String(
          (cleanupFailure as any)?.message ?? cleanupFailure ?? 'temporary-file cleanup failed',
        );
      }
      throwTransferFailure({
        error,
        progress,
        fingerprint,
        file,
        cleanupError,
        update: () => update(true),
      });
    }
  }
  progress.phase = 'completed';
  update(true);
  return {
    content: [
      {
        type: 'text',
        text: `Transferred ${progress.fileCount} file${progress.fileCount === 1 ? '' : 's'} (${progress.totalBytes} bytes) from ${source.descriptor.label} to ${destination.descriptor.label}.${resumedFiles > 0 ? ` Resumed after ${resumedFiles} previously committed file${resumedFiles === 1 ? '' : 's'}.` : ''}`,
      },
    ],
    details: progress,
  };
}
