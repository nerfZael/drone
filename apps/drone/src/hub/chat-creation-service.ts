import { hasBlockingPendingPrompt } from '@drone/assistant-chat';
import { cloneTranscriptTurnsForChatFork, createChatForkOrigin } from './chat-fork';
import type { BuiltinTranscriptAgentId } from './pendingPromptEnqueue';
import { completedChatCheckpoint } from './side-chat-checkpoint';

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
  sideChat?: boolean;
  checkpointId?: string;
};

export type CreateDroneChatResult = {
  chat: any;
  chats: string[];
  created: boolean;
};

export type DroneChatCreationDependencies = {
  captureNativeChatCheckpoint?: (threadId: string) => Promise<string>;
  buildNewChatEntry: (input: { droneEntry: any; createdAt: string; sourceChatEntry?: any }) => any;
  cloneNativeChatSession: (input: {
    sourceId: string;
    sourceChatName: string;
    sourceProvider?: string;
    sourceModel?: string;
    sourceThinkingLevel?: string;
    targetId: string;
    checkpointId?: string;
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
  deleteChatFromStore: (input: { droneId: string; chatName: string }) => Promise<boolean>;
  getChatEntry: (input: { droneId: string; chatName: string }) => Promise<{ chat: any }>;
  importDroneChatsFromRegistry: (input: { droneId: string; chats: any }) => Promise<unknown>;
  inferChatAgent: (chat: any, drone: any) => { kind: string; id?: string };
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
    if (input.checkpointId && !input.sideChat)
      throw new Error('A checkpoint requires side chat creation');
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

    const sourceBeforeCreate = sourceChatName
      ? deps.readChatFromStore({ droneId: input.droneId, chatName: sourceChatName }).chat
      : null;
    let checkpoint: ReturnType<typeof completedChatCheckpoint> | undefined;
    if (input.sideChat) {
      if (input.creationMode !== 'clone-history' || !sourceBeforeCreate) {
        throw new Error('Side chat creation requires an existing source chat');
      }
      const agent = deps.inferChatAgent(sourceBeforeCreate, input.droneEntry);
      if (agent.kind === 'native') {
        if (!deps.captureNativeChatCheckpoint)
          throw new Error('Native checkpoint cloning is not available');
        checkpoint = {
          turns: [],
          checkpointId:
            input.checkpointId ?? (await deps.captureNativeChatCheckpoint(sourceBeforeCreate.id)),
        };
      } else if (
        agent.kind === 'builtin' && ['codex', 'claude', 'opencode'].includes(agent.id ?? '')
      ) {
        checkpoint = completedChatCheckpoint(sourceBeforeCreate, input.checkpointId);
        if (agent.id === 'codex') {
          if (!createChatForkOrigin(sourceBeforeCreate, sourceChatName, 'codex')) {
            throw new Error('The source Codex session is not available for checkpoint cloning');
          }
        } else if (checkpoint.providerCheckpoint?.agentId !== agent.id) {
          throw new Error(
            'This answer has no provider checkpoint ID. Complete a new answer in the source chat after updating, then open a side chat.',
          );
        }
      } else {
        throw new Error(
          'Checkpoint side chats are currently supported for the built-in agent, Codex, Claude Code, and OpenCode',
        );
      }
    }
    if (input.creationMode === 'clone-history' && sourceBeforeCreate && !checkpoint) {
      const sourceBusy = (input.droneEntry?.busyChats ?? []).includes(sourceChatName);
      const sourceHasBlockingPrompts = hasBlockingPendingPrompt(
        sourceBeforeCreate.pendingPrompts,
        sourceBeforeCreate.turns,
      );
      if (sourceBusy || sourceHasBlockingPrompts) {
        throw new Error('Stop this chat before cloning it');
      }
    }

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
          if (checkpoint) source = sourceBeforeCreate;
          const entry: any = deps.buildNewChatEntry({
            droneEntry: input.droneEntry,
            createdAt,
            ...(source ? { sourceChatEntry: source } : {}),
          });
          if (input.creationMode === 'clone-history' && source) {
            const sourceAgent = deps.inferChatAgent(source, input.droneEntry);
            if (sourceAgent.kind === 'custom') {
              throw new Error('Chat cloning is not supported for custom agents');
            }
            entry.turns = cloneTranscriptTurnsForChatFork(
              checkpoint ? checkpoint.turns : source.turns,
            );
            if (sourceAgent.kind === 'builtin' && sourceAgent.id) {
              const providerCheckpoint = checkpoint?.providerCheckpoint;
              const forkOrigin = providerCheckpoint
                ? {
                    version: 1 as const,
                    state: 'pending' as const,
                    agentId: providerCheckpoint.agentId,
                    sourceChatName,
                    sourceSessionId: providerCheckpoint.sessionId,
                  }
                : createChatForkOrigin(
                    checkpoint ? sourceBeforeCreate : source,
                    sourceChatName,
                    sourceAgent.id as BuiltinTranscriptAgentId,
                  );
              if (forkOrigin)
                entry.chatForkOrigin = {
                  ...forkOrigin,
                  ...(checkpoint
                    ? {
                        lastMessageId: providerCheckpoint?.messageId ?? checkpoint.checkpointId,
                        ...(checkpoint.codexTurnId ? { lastTurnId: checkpoint.codexTurnId } : {}),
                      }
                    : {}),
                };
            }
          }
          if (input.draft) entry.draft = true;
          if (input.queuedOrigin) entry.queuedChatOrigin = input.queuedOrigin;
          if (checkpoint) {
            entry.visibility = 'side-chat';
            entry.sideChatOrigin = { sourceChatName, checkpointId: checkpoint.checkpointId };
          }
          return entry;
        },
      });
      wasCreated = true;
    }
    try {
      // Projection is also a repair step for a retry that observes the owned
      // canonical chat after a previous attempt was interrupted.
      await deps.projectCanonicalChatsToRegistry(input.droneId);
      if (sourceChatName) {
        const [{ chat: sourceChat }, { chat: targetChat }] = await Promise.all([
          checkpoint
            ? Promise.resolve({ chat: sourceBeforeCreate })
            : deps.getChatEntry({ droneId: input.droneId, chatName: sourceChatName }),
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
              ...(checkpoint ? { checkpointId: checkpoint.checkpointId } : {}),
              droneId: input.droneId,
              chatName: input.chatName,
            });
          }
        }
      }
    } catch (error) {
      if (wasCreated) {
        await deps
          .deleteChatFromStore({ droneId: input.droneId, chatName: input.chatName })
          .catch(() => false);
        await deps.projectCanonicalChatsToRegistry(input.droneId).catch(() => undefined);
      }
      throw error;
    }

    return { chat: created.chat, chats: created.chats, created: wasCreated };
  };
}
