export type AssistantActivityThreadStatus =
  | 'idle'
  | 'running'
  | 'waiting_for_approval'
  | 'waiting_for_chats_idle'
  | 'error';

export type AssistantActivityThread = {
  id?: string;
  status?: AssistantActivityThreadStatus | string;
  voiceEnabled?: boolean;
};

export type AssistantActivitySnapshot = {
  threads?: AssistantActivityThread[];
  runningModels?: Record<string, unknown>;
  chatIdleSubscriptions?: Array<{
    threadId?: string;
    status?: string;
  }>;
};

export type AssistantActivityCounts = {
  normal: number;
  voice: number;
  total: number;
};

const ACTIVE_THREAD_STATUSES = new Set(['running', 'waiting_for_approval', 'waiting_for_chats_idle']);

function normalizeId(value: unknown): string {
  return String(value ?? '').trim();
}

export function summarizeAssistantActivity(snapshot: AssistantActivitySnapshot | null | undefined): AssistantActivityCounts {
  const threadById = new Map<string, AssistantActivityThread>();
  const activeThreadIds = new Set<string>();

  for (const thread of snapshot?.threads ?? []) {
    const threadId = normalizeId(thread?.id);
    if (!threadId) continue;
    threadById.set(threadId, thread);
    if (ACTIVE_THREAD_STATUSES.has(String(thread?.status ?? '').trim())) {
      activeThreadIds.add(threadId);
    }
  }

  for (const threadId of Object.keys(snapshot?.runningModels ?? {})) {
    const normalizedThreadId = normalizeId(threadId);
    if (normalizedThreadId) activeThreadIds.add(normalizedThreadId);
  }

  for (const subscription of snapshot?.chatIdleSubscriptions ?? []) {
    if (String(subscription?.status ?? '').trim() !== 'active') continue;
    const threadId = normalizeId(subscription?.threadId);
    if (threadId) activeThreadIds.add(threadId);
  }

  let normal = 0;
  let voice = 0;
  for (const threadId of activeThreadIds) {
    if (threadById.get(threadId)?.voiceEnabled) voice += 1;
    else normal += 1;
  }

  return {
    normal,
    voice,
    total: normal + voice,
  };
}
