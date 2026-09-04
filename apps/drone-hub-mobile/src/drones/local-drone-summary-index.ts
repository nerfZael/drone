type SummaryThread = {
  id: string;
  status: string;
  updatedAt: string;
};

type SummaryApproval = {
  threadId: string;
};

type LocalDroneChatSummary = {
  busyChats: string[];
  approvalChats: string[];
  approvalRequired: boolean;
  lastActivityAt: string | undefined;
};

export type LocalDroneSummaryIndex = {
  summarizeChats: (
    chats: Record<string, string>,
    runningThreadId: string | null,
  ) => LocalDroneChatSummary;
};

export function createLocalDroneSummaryIndex(
  threads: readonly SummaryThread[],
  approvals: readonly SummaryApproval[],
): LocalDroneSummaryIndex {
  const threadById = new Map<string, SummaryThread>();
  for (const thread of threads) threadById.set(thread.id, thread);
  const approvalThreadIds = new Set<string>();
  for (const approval of approvals) approvalThreadIds.add(approval.threadId);

  return {
    summarizeChats(chats, runningThreadId) {
      const entries = Object.entries(chats);
      const busyChats: string[] = [];
      const approvalChats: string[] = [];
      let lastActivityAt: string | undefined = entries.length > 0 ? '' : undefined;

      for (const [chatName, threadId] of entries) {
        const thread = threadById.get(threadId);
        if (runningThreadId === threadId || thread?.status === 'running') {
          busyChats.push(chatName);
        }
        if (approvalThreadIds.has(threadId)) approvalChats.push(chatName);
        const updatedAt = thread?.updatedAt ?? '';
        if (lastActivityAt == null || updatedAt > lastActivityAt) lastActivityAt = updatedAt;
      }

      return {
        busyChats,
        approvalChats,
        approvalRequired: approvalChats.length > 0,
        lastActivityAt,
      };
    },
  };
}
