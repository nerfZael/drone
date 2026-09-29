export function codexPromptOwnsResponse(job: any, promptId: string): boolean {
  const responseMessageId = String(job?.codexAppServer?.run?.responseMessageId ?? '').trim();
  if (responseMessageId) return responseMessageId === promptId;
  return job?.codexAppServer?.outputOwner !== false;
}

/** Only a daemon run record establishes that messages share execution. */
export function codexPromptRunMetadata(job: any): { runId?: string; runStartedAt?: string } {
  const run = job?.codexAppServer?.run;
  const runId = typeof run?.id === 'string' ? run.id.trim() : '';
  if (!runId) return {};
  return {
    runId,
    ...(typeof run.startedAt === 'string' && Number.isFinite(Date.parse(run.startedAt))
      ? { runStartedAt: run.startedAt } : {}),
  };
}
