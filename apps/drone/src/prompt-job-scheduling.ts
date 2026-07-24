export type SchedulablePromptJob = {
  id: string;
  state: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  deliveryMode?: 'queue' | 'asap';
};

export function selectNextPromptJobId(jobs: readonly SchedulablePromptJob[]): string | null {
  return (
    jobs.find((job) => job.state === 'queued' && job.deliveryMode === 'asap')?.id ??
    jobs.find((job) => job.state === 'queued' && job.deliveryMode !== 'asap')?.id ??
    null
  );
}
