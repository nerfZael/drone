export type CommandJobChunk = {
  cursor: number;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
};

export type CommandJobSnapshot = {
  jobId: string;
  workspaceId: string;
  status: 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
  timeoutAt: string;
  exitCode: number | null;
  signal: string | null;
  outputTruncated: boolean;
};

export type WorkspaceCommandRequest = (
  operation: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<any>;

function abortError(): Error {
  const error = new Error('Command cancelled');
  error.name = 'AbortError';
  return error;
}

export async function runWorkspaceCommandJob(input: {
  workspaceId: string;
  command: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  request: WorkspaceCommandRequest;
  onOutput?: (update: {
    text: string;
    chunks: CommandJobChunk[];
    job: CommandJobSnapshot;
  }) => void | Promise<void>;
}): Promise<{ text: string; details: CommandJobSnapshot }> {
  if (input.signal?.aborted) throw abortError();
  let started: CommandJobSnapshot;
  try {
    started = await input.request(
      'commands.start',
      {
        workspaceId: input.workspaceId,
        command: input.command,
        ...(input.timeoutMs == null ? {} : { timeoutMs: input.timeoutMs }),
      },
      input.signal,
    );
  } catch (error: any) {
    if (error?.code !== 'UNSUPPORTED_OPERATION') throw error;
    const legacy = await input.request(
      'commands.run',
      {
        workspaceId: input.workspaceId,
        command: input.command,
        ...(input.timeoutMs == null ? {} : { timeoutMs: input.timeoutMs }),
      },
      input.signal,
    );
    return { text: String(legacy?.text ?? ''), details: legacy?.details ?? {} };
  }

  let cursor = 0;
  let text = '';
  let current = started;
  const cancel = () => {
    void input
      .request('commands.cancel', { workspaceId: input.workspaceId, jobId: started.jobId })
      .catch(() => undefined);
  };
  input.signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (current.status === 'running') {
      if (input.signal?.aborted) throw abortError();
      const output = await input.request(
        'commands.output',
        {
          workspaceId: input.workspaceId,
          jobId: started.jobId,
          cursor,
          waitMs: 15_000,
        },
        input.signal,
      );
      const chunks: CommandJobChunk[] = Array.isArray(output?.chunks) ? output.chunks : [];
      cursor = Number(output?.cursor ?? cursor);
      current = output as CommandJobSnapshot;
      const next = chunks.map((chunk) => String(chunk.text ?? '')).join('');
      text = `${text}${next}`.slice(-96_000);
      if (chunks.length > 0) await input.onOutput?.({ text, chunks, job: current });
    }
  } catch (error) {
    if (input.signal?.aborted) {
      cancel();
      throw abortError();
    }
    throw error;
  } finally {
    input.signal?.removeEventListener('abort', cancel);
  }
  const summary = [
    `status: ${current.status}`,
    current.exitCode == null ? '' : `exitCode: ${current.exitCode}`,
    current.signal ? `signal: ${current.signal}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { text: `${summary}\n\n${text || '(no output)'}`, details: current };
}
