import { requestJsonWithTimeout } from '../http';

export type LoadedAgentRunDiff = {
  patch: string;
  truncated: boolean;
};

export type AgentRunDiffState =
  | { status: 'loading' }
  | { status: 'loaded'; value: LoadedAgentRunDiff }
  | { status: 'error'; message: string; retryable: boolean };

export function agentRunDiffKey(artifactId: string, filePath: string): string {
  return `${artifactId}\u0000${filePath}`;
}

export async function loadAgentRunDiff(
  artifactId: string,
  filePath: string,
): Promise<LoadedAgentRunDiff> {
  const result = await requestJsonWithTimeout<{
    ok: true;
    diff: { patch: string; truncated?: boolean };
  }>(
    `/api/agent-run-diffs/${encodeURIComponent(artifactId)}/file?path=${encodeURIComponent(filePath)}`,
    undefined,
    15_000,
  );
  return {
    patch: String(result.diff?.patch ?? ''),
    truncated: result.diff?.truncated === true,
  };
}

export function agentRunDiffError(error: any): Extract<AgentRunDiffState, { status: 'error' }> {
  const status = Number(error?.status ?? 0);
  return {
    status: 'error',
    message: String(error?.message ?? error ?? 'Unable to load historical diff.'),
    retryable: status < 400 || status >= 500,
  };
}
