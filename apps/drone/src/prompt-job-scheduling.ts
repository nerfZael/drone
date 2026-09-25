export type SchedulablePromptJob = {
  id: string;
  state: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  deliveryMode?: 'queue' | 'asap';
  chatKey?: string;
  claudeStream?: { sessionKey: string };
};

export function selectNextPromptJobId(jobs: readonly SchedulablePromptJob[]): string | null {
  const keys = (job: SchedulablePromptJob) =>
    [job.chatKey?.trim(), job.claudeStream?.sessionKey?.trim()].filter(Boolean);
  const running = jobs.filter((job) => job.state === 'running');
  // Old persisted jobs and callers without a chat identity retain the original
  // exclusive behavior: we cannot prove that they belong to a different chat.
  const eligible = jobs.filter((job) => job.state === 'queued' &&
    running.every((active) => {
      const candidateKeys = keys(job);
      const activeKeys = keys(active);
      return candidateKeys.length > 0 && activeKeys.length > 0 &&
        !candidateKeys.some((key) => activeKeys.includes(key));
    }));
  return (
    eligible.find((job) => job.deliveryMode === 'asap')?.id ??
    eligible.find((job) => job.deliveryMode !== 'asap')?.id ??
    null
  );
}
