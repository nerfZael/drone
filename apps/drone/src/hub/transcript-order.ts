export function resolveTranscriptPromptAt(opts: {
  pendingAt?: unknown;
  jobStartedAt?: unknown;
  finishedAt: string;
}): string {
  const pendingAt = typeof opts.pendingAt === 'string' ? opts.pendingAt.trim() : '';
  if (pendingAt) return pendingAt;
  const jobStartedAt = typeof opts.jobStartedAt === 'string' ? opts.jobStartedAt.trim() : '';
  if (jobStartedAt) return jobStartedAt;
  return String(opts.finishedAt ?? '').trim();
}
