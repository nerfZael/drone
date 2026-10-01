import { codexSessionIdentity } from './codex-session-identity';

export type SchedulablePromptJob = {
  id: string;
  state: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  deliveryMode?: 'queue' | 'asap';
  chatKey?: string;
  claudeStream?: { sessionKey: string };
  codexAppServer?: { sessionKey: string };
};

function promptJobChatKeys(job: Omit<SchedulablePromptJob, 'id' | 'state'>): string[] {
  return [
    job.chatKey?.trim(),
    job.claudeStream?.sessionKey?.trim(),
    job.codexAppServer?.sessionKey?.trim() ? codexSessionIdentity(job.codexAppServer.sessionKey.trim()) : '',
  ].filter((key): key is string => Boolean(key));
}

// Job IDs are unique per daemon, not per chat. A resubmission from another
// chat must not be treated as a retry of this job.
export function promptJobBelongsToOtherChat(
  existing: Omit<SchedulablePromptJob, 'id' | 'state'>,
  incoming: Omit<SchedulablePromptJob, 'id' | 'state'>,
): boolean {
  const existingKeys = promptJobChatKeys(existing);
  const incomingKeys = promptJobChatKeys(incoming);
  return existingKeys.length > 0 && incomingKeys.length > 0 &&
    !incomingKeys.some((key) => existingKeys.includes(key));
}

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
