export type QueuedChatOrigin = {
  sourceChatName: string;
  sourceChatId?: string;
  actionId: string;
};

export type DroneChatCreationMode = 'empty' | 'clone-history' | 'copy-config';

export type CreateDroneChatInput = {
  droneId: string;
  droneEntry: any;
  chatName: string;
  creationMode: DroneChatCreationMode;
  sourceChatName?: string;
  draft?: boolean;
  queuedOrigin?: QueuedChatOrigin;
};

export type CreateDroneChatResult = {
  chat: any;
  chats: string[];
  created: boolean;
};

export type DroneChatCreationDependencies = {
  buildNewChatEntry: (input: { droneEntry: any; createdAt: string; sourceChatEntry?: any }) => any;
  cloneNativeChatSession: (input: {
    sourceId: string;
    sourceChatName: string;
    sourceProvider?: string;
    sourceModel?: string;
    sourceThinkingLevel?: string;
    targetId: string;
    droneId: string;
    chatName: string;
  }) => Promise<void>;
  copyNativeChatConfiguration: (input: {
    sourceId: string;
    sourceChatName: string;
    sourceProvider?: string;
    sourceModel?: string;
    sourceThinkingLevel?: string;
    targetId: string;
    droneId: string;
    chatName: string;
  }) => Promise<void>;
  createChatInStore: (input: {
    droneId: string;
    chatName: string;
    copyFromChatName?: string;
    implicitDefaultEntry?: unknown;
    createEntry: (source: any | null) => unknown;
  }) => Promise<{ chat: any; chats: string[] }>;
  getChatEntry: (input: { droneId: string; chatName: string }) => Promise<{ chat: any }>;
  importDroneChatsFromRegistry: (input: { droneId: string; chats: any }) => Promise<unknown>;
  inferChatAgent: (chat: any, drone: any) => { kind: string };
  listChatsFromStore: (input: { droneId: string }) => { chats: string[] };
  nowIso: () => string;
  projectCanonicalChatsToRegistry: (droneId: string) => Promise<unknown>;
  readChatFromStore: (input: { droneId: string; chatName: string }) => {
    available: boolean;
    chat: any | null;
  };
};

function queuedOriginMatches(chat: any, origin: QueuedChatOrigin | undefined): boolean {
  if (!origin) return false;
  const actionId = String(origin.actionId ?? '').trim();
  if (!actionId || String(chat?.queuedChatOrigin?.actionId ?? '') !== actionId) return false;
  const sourceChatId = String(origin.sourceChatId ?? '').trim();
  const storedSourceChatId = String(chat?.queuedChatOrigin?.sourceChatId ?? '').trim();
  if (sourceChatId || storedSourceChatId) {
    return Boolean(sourceChatId) && storedSourceChatId === sourceChatId;
  }
  return (
    String(chat?.queuedChatOrigin?.sourceChatName ?? '') === String(origin.sourceChatName ?? '')
  );
}

export function createDroneChatCreator(deps: DroneChatCreationDependencies) {
  return async function createDroneChat(
    input: CreateDroneChatInput,
  ): Promise<CreateDroneChatResult> {
    if (
      input.creationMode !== 'empty' &&
      input.creationMode !== 'clone-history' &&
      input.creationMode !== 'copy-config'
    ) {
      throw new Error(`unsupported chat creation mode: ${String(input.creationMode ?? '')}`);
    }
    const sourceChatName = String(input.sourceChatName ?? '').trim();
    if (input.creationMode === 'empty' && sourceChatName) {
      throw new Error('empty chat creation cannot specify a source chat');
    }
    if (input.creationMode !== 'empty' && !sourceChatName) {
      throw new Error(`${input.creationMode} chat creation requires a source chat`);
    }
    await deps.importDroneChatsFromRegistry({
      droneId: input.droneId,
      chats: input.droneEntry?.chats,
    });

    const existing = deps.readChatFromStore({ droneId: input.droneId, chatName: input.chatName });
    let created: { chat: any; chats: string[] };
    let wasCreated = false;
    if (existing.chat) {
      if (!queuedOriginMatches(existing.chat, input.queuedOrigin)) {
        throw new Error(`chat already exists: ${input.chatName}`);
      }
      created = {
        chat: existing.chat,
        chats: deps.listChatsFromStore({ droneId: input.droneId }).chats,
      };
    } else {
      const createdAt = deps.nowIso();
      const defaultEntry = deps.buildNewChatEntry({ droneEntry: input.droneEntry, createdAt });
      created = await deps.createChatInStore({
        droneId: input.droneId,
        chatName: input.chatName,
        ...(sourceChatName
          ? { copyFromChatName: sourceChatName, implicitDefaultEntry: defaultEntry }
          : {}),
        createEntry: (source: any) => {
          const entry: any = deps.buildNewChatEntry({
            droneEntry: input.droneEntry,
            createdAt,
            ...(source ? { sourceChatEntry: source } : {}),
          });
          if (input.draft) entry.draft = true;
          if (input.queuedOrigin) entry.queuedChatOrigin = input.queuedOrigin;
          return entry;
        },
      });
      wasCreated = true;
    }
    // Projection is also a repair step for a retry that observes the owned
    // canonical chat after a previous attempt was interrupted.
    await deps.projectCanonicalChatsToRegistry(input.droneId);

    if (sourceChatName) {
      const [{ chat: sourceChat }, { chat: targetChat }] = await Promise.all([
        deps.getChatEntry({ droneId: input.droneId, chatName: sourceChatName }),
        deps.getChatEntry({ droneId: input.droneId, chatName: input.chatName }),
      ]);
      if (deps.inferChatAgent(sourceChat, input.droneEntry).kind === 'native') {
        const sourceId = String(sourceChat?.id ?? '').trim();
        const targetId = String(targetChat?.id ?? '').trim();
        if (sourceId && targetId) {
          const createNativeSession =
            input.creationMode === 'copy-config'
              ? deps.copyNativeChatConfiguration
              : deps.cloneNativeChatSession;
          await createNativeSession({
            sourceId,
            sourceChatName,
            sourceProvider: String(sourceChat?.nativeProvider ?? '').trim(),
            sourceModel: String(sourceChat?.model ?? '').trim(),
            sourceThinkingLevel: String(sourceChat?.reasoning ?? '').trim(),
            targetId,
            droneId: input.droneId,
            chatName: input.chatName,
          });
        }
      }
    }

    return { chat: created.chat, chats: created.chats, created: wasCreated };
  };
}
