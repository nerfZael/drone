export type CreatedAssistantThread = { id: string; createdAt?: string };

function createdAtMs(thread: CreatedAssistantThread): number {
  const value = Date.parse(String(thread.createdAt ?? ''));
  return Number.isFinite(value) ? value : 0;
}

export function assistantThreadsByCreatedAtNewestFirst<T extends CreatedAssistantThread>(
  threads: T[],
): T[] {
  return [...threads].sort((left, right) => {
    const createdDifference = createdAtMs(right) - createdAtMs(left);
    return createdDifference || left.id.localeCompare(right.id);
  });
}
