export function codexPromptOwnsResponse(job: any, promptId: string): boolean {
  const responseMessageId = String(job?.codexAppServer?.run?.responseMessageId ?? '').trim();
  if (responseMessageId) return responseMessageId === promptId;
  return job?.codexAppServer?.outputOwner !== false;
}
