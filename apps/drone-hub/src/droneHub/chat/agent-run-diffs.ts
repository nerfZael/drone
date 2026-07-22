import type { AgentRunFileChangeCounts, AgentRunFileChangeEntry } from '@blip/protocol';

import { requestJsonWithTimeout } from '../http';

export type LoadedAgentRunDiff = {
  patch: string;
  truncated: boolean;
};

export type AgentRunDiffState =
  | { status: 'loading' }
  | { status: 'loaded'; value: LoadedAgentRunDiff }
  | { status: 'error'; message: string; retryable: boolean };

export type LoadedAgentRunDiffFiles = {
  entries: AgentRunFileChangeEntry[];
  counts: AgentRunFileChangeCounts;
  total: number;
  offset: number;
  nextOffset: number | null;
  metadataTruncated: boolean;
};

export function agentRunDiffKey(artifactId: string, filePath: string): string {
  return `${artifactId}\u0000${filePath}`;
}

export async function loadAgentRunDiff(
  artifactId: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<LoadedAgentRunDiff> {
  const result = await requestJsonWithTimeout<{
    ok: true;
    diff: { patch: string; truncated?: boolean };
  }>(
    `/api/agent-run-diffs/${encodeURIComponent(artifactId)}/file?path=${encodeURIComponent(filePath)}`,
    { signal },
    15_000,
  );
  return {
    patch: String(result.diff?.patch ?? ''),
    truncated: result.diff?.truncated === true,
  };
}

export async function loadAgentRunDiffFiles(
  artifactId: string,
  options?: { offset?: number; limit?: number; signal?: AbortSignal },
): Promise<LoadedAgentRunDiffFiles> {
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const limit = Math.max(1, Math.floor(options?.limit ?? 20));
  const result = await requestJsonWithTimeout<{
    ok: true;
    files: LoadedAgentRunDiffFiles;
  }>(
    `/api/agent-run-diffs/${encodeURIComponent(artifactId)}/files?offset=${offset}&limit=${limit}`,
    { signal: options?.signal },
    15_000,
  );
  return result.files;
}

export function agentRunDiffError(error: any): Extract<AgentRunDiffState, { status: 'error' }> {
  const status = Number(error?.status ?? 0);
  return {
    status: 'error',
    message: String(error?.message ?? error ?? 'Unable to load historical diff.'),
    retryable: status < 400 || status >= 500,
  };
}
