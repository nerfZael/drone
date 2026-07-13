export type UpdatedAssistantThread = { id: string; updatedAt?: string };

function updatedAtMs(thread: UpdatedAssistantThread): number {
  const value = Date.parse(String(thread.updatedAt ?? ''));
  return Number.isFinite(value) ? value : 0;
}

export function assistantThreadsNewestFirst<T extends UpdatedAssistantThread>(threads: T[]): T[] {
  return [...threads].sort((left, right) => updatedAtMs(right) - updatedAtMs(left));
}

export function latestAssistantThread<T extends UpdatedAssistantThread>(threads: T[]): T | null {
  return assistantThreadsNewestFirst(threads)[0] ?? null;
}
