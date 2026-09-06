import type { AssistantDroneSummary } from './assistant-contracts';
import type { HostWorkspace } from './host-workspaces';

export type AssistantToolCallbacks = {
  listDrones: () => Promise<AssistantDroneSummary[]>;
  listHostWorkspaces?: () => Promise<HostWorkspace[]>;
  listDroneFiles?: (opts: {
    droneId: string;
    path?: string;
  }) => Promise<AssistantDroneFileListResult>;
  readDroneFile?: (opts: {
    droneId: string;
    path: string;
    startLine?: number;
    endLine?: number;
  }) => Promise<AssistantDroneFileReadResult>;
  writeDroneFile?: (opts: {
    droneId: string;
    path: string;
    content: string;
  }) => Promise<AssistantDroneFileWriteResult>;
  batchDroneFiles?: (opts: {
    droneId: string;
    operations: AssistantDroneFileBatchOperation[];
  }) => Promise<void>;
  deleteDroneFile?: (opts: {
    droneId: string;
    path: string;
  }) => Promise<AssistantDroneFileMutationResult>;
  moveDroneFile?: (opts: {
    droneId: string;
    fromPath: string;
    toPath: string;
  }) => Promise<AssistantDroneFileMutationResult>;
  moveDronePath?: (opts: {
    droneId: string;
    fromPath: string;
    toPath: string;
    overwrite?: boolean;
  }) => Promise<AssistantDroneFileMutationResult>;
  createDroneDirectory?: (opts: {
    droneId: string;
    path: string;
    recursive?: boolean;
  }) => Promise<AssistantDroneFileMutationResult>;
  deleteDroneDirectory?: (opts: {
    droneId: string;
    path: string;
    recursive?: boolean;
  }) => Promise<AssistantDroneFileMutationResult>;
  searchDroneFiles?: (opts: {
    droneId: string;
    path?: string;
    query: string;
    limit?: number;
    contextBefore?: number;
    contextAfter?: number;
  }) => Promise<AssistantDroneFileSearchResult>;
  statDronePath?: (opts: {
    droneId: string;
    path: string;
  }) => Promise<AssistantDronePathStatResult>;
  readDroneFileChunk?: (opts: {
    droneId: string;
    path: string;
    offset: number;
    length: number;
  }) => Promise<{ dataBase64: string; bytes: number }>;
  createDroneTransferDirectory?: (opts: { droneId: string; path: string }) => Promise<void>;
  prepareDroneTransferFile?: (opts: {
    droneId: string;
    path: string;
    transferId: string;
    size: number;
    overwrite: boolean;
  }) => Promise<{ offset: number }>;
  writeDroneTransferChunk?: (opts: {
    droneId: string;
    path: string;
    transferId: string;
    offset: number;
    dataBase64: string;
  }) => Promise<{ offset: number }>;
  commitDroneTransferFile?: (opts: {
    droneId: string;
    path: string;
    transferId: string;
    size: number;
    overwrite: boolean;
  }) => Promise<void>;
  abortDroneTransferFile?: (opts: {
    droneId: string;
    path: string;
    transferId: string;
  }) => Promise<void>;
  runDroneBash?: (opts: {
    droneId: string;
    command: string;
    cwd?: string;
    timeoutMs?: number;
  }) => Promise<AssistantDroneBashResult>;
  listDroneChangedFiles?: (opts: { droneId: string }) => Promise<any>;
};

export type AssistantDroneFileBatchOperation =
  | { type: 'write'; path: string; content: string }
  | { type: 'move'; fromPath: string; toPath: string }
  | { type: 'delete'; path: string };

export type AssistantDroneFileEntry = {
  name: string;
  path: string;
  relativePath?: string | null;
  kind: 'directory' | 'file' | 'other';
  size?: number | null;
  mtimeMs?: number | null;
};

export type AssistantDroneFileListResult = {
  droneId: string;
  path: string;
  relativePath?: string | null;
  entries: AssistantDroneFileEntry[];
};

export type AssistantDroneFileReadResult = {
  droneId: string;
  path: string;
  relativePath?: string | null;
  kind: 'text';
  content: string;
  size?: number | null;
  mtimeMs?: number | null;
  lineRange?: {
    startLine: number;
    endLine: number;
    totalLines: number;
    returnedLines: number;
  };
};

export function formatAssistantReadFileToolText(result: AssistantDroneFileReadResult): string {
  const lineRange = result.lineRange;
  if (!lineRange) return result.content;

  const displayPath = result.relativePath || result.path;
  const lineLabel =
    lineRange.returnedLines === 1
      ? `line ${lineRange.startLine}`
      : `lines ${lineRange.startLine}-${lineRange.endLine}`;
  const header = `# ${displayPath} ${lineLabel} of ${lineRange.totalLines} (${lineRange.returnedLines} returned)`;
  return result.content ? `${header}\n\n${result.content}` : header;
}

export type AssistantDroneFileWriteResult = {
  droneId: string;
  path: string;
  relativePath?: string | null;
  size?: number | null;
  mtimeMs?: number | null;
};

export type AssistantDroneFileMutationResult = {
  droneId: string;
  path: string;
  deleted?: boolean;
  movedTo?: string;
};

export type AssistantDronePathStatResult = {
  droneId: string;
  path: string;
  exists: boolean;
  kind?: 'directory' | 'file' | 'other';
  size?: number | null;
  mtimeMs?: number | null;
};

export type AssistantDroneFileSearchMatch = {
  path: string;
  relativePath?: string | null;
  line?: number | null;
  text: string;
  context?: AssistantDroneFileSearchContextLine[];
};

export type AssistantDroneFileSearchContextLine = {
  line: number;
  kind: 'before' | 'match' | 'after';
  text: string;
};

export type AssistantDroneFileSearchResult = {
  droneId: string;
  path: string;
  query: string;
  matches: AssistantDroneFileSearchMatch[];
  limit: number;
  contextBefore?: number;
  contextAfter?: number;
  caps?: {
    limit: number;
    maxContextBefore: number;
    maxContextAfter: number;
  };
  truncated?: boolean;
};

export type AssistantApplyPatchResult = {
  ok: true;
  droneId: string;
  operations: Array<{
    kind: 'add' | 'delete' | 'update';
    path: string;
    movedTo?: string;
    size?: number | null;
  }>;
};

export type AssistantDroneBashResult = {
  ok: true;
  droneId: string;
  cwd: string;
  command: string;
  code: number;
  stdout: string;
  stderr: string;
  timeoutMs: number;
  timedOut: boolean;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
};

export type AssistantPatchStagedFile = {
  path: string;
  existsBefore: boolean;
  content: string | null;
  deleted: boolean;
  moveFrom?: string;
};
