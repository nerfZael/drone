import React from 'react';
import * as Crypto from 'expo-crypto';
import { useMesh } from '../mesh/MeshContext';
import { readLocalAssistantApiKey, loadLocalAssistantSettings } from './local-assistant-settings';
import {
  boundLocalAssistantMessages,
  cleanLocalWorkspaceTargets,
  loadLocalAssistantThreads,
  saveLocalAssistantThreads,
} from './local-assistant-storage';
import type {
  LocalAssistantMessage,
  LocalAssistantApproval,
  LocalAssistantPromptImage,
  LocalAssistantQueuedPrompt,
  LocalAssistantThinkingLevel,
  LocalAssistantThread,
  LocalWorkspaceTarget,
} from './local-assistant-types';
import { readLocalAssistantCodexAuth } from './local-assistant-codex-auth';
import { nextChatTitle } from './next-chat-title';
import { clonedChatTitle } from './cloned-chat-title';
import { createWorkspaceToolRuntime } from './workspace-tools';
import { runMobileBlip } from './run-mobile-blip';
import {
  deleteLocalBlipSessionSnapshot,
  cloneLocalBlipSessionSnapshot,
  loadLocalBlipSessionSnapshot,
  saveLocalBlipSessionSnapshot,
} from './local-blip-storage';
import { messagesAfterDeletion } from './assistant-message-deletion';

export type LocalAssistantContextValue = {
  threads: LocalAssistantThread[];
  loading: boolean;
  runningThreadId: string | null;
  error: string | null;
  pendingApprovals: LocalAssistantApproval[];
  refreshThreads(): Promise<LocalAssistantThread[]>;
  createThread(title?: string): Promise<LocalAssistantThread>;
  cloneThread(threadId: string): Promise<LocalAssistantThread>;
  deleteThread(threadId: string): Promise<void>;
  deleteMessage(threadId: string, messageId: string, deleteFollowing: boolean): Promise<void>;
  updateThread(
    threadId: string,
    patch: {
      title?: string;
      model?: string;
      thinkingLevel?: LocalAssistantThinkingLevel;
      workspaceTargets?: LocalWorkspaceTarget[];
      autoApprove?: boolean;
      agentPermissionMode?: 'read-only' | 'workspace-write' | 'full-access';
      approvalPolicy?: 'ask' | 'never';
      artifactWorkspace?: boolean;
    },
  ): Promise<void>;
  resolveApproval(threadId: string, approvalId: string, approved: boolean): void;
  sendPrompt(
    threadId: string,
    prompt: string,
    promptImages?: LocalAssistantPromptImage[],
  ): Promise<void>;
  cancelQueuedPrompt(threadId: string, promptId: string): Promise<void>;
  stop(threadId: string): void;
};

const LocalAssistantContext = React.createContext<LocalAssistantContextValue | null>(null);

function userMessage(
  prompt: string,
  promptImages: LocalAssistantPromptImage[],
): LocalAssistantMessage {
  return {
    id: Crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    role: 'user',
    content:
      promptImages.length > 0
        ? [
            ...(prompt ? [{ type: 'text' as const, text: prompt }] : []),
            ...promptImages,
          ]
        : prompt,
  };
}

export function LocalAssistantProvider({ children }: { children: React.ReactNode }) {
  const mesh = useMesh();
  const [threads, setThreads] = React.useState<LocalAssistantThread[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [runningThreadId, setRunningThreadId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = React.useState<LocalAssistantApproval[]>([]);
  const threadsRef = React.useRef<LocalAssistantThread[]>([]);
  const abortRef = React.useRef<{ threadId: string; controller: AbortController } | null>(null);
  const sendPromptRef = React.useRef<
    (
      threadId: string,
      prompt: string,
      promptImages?: LocalAssistantPromptImage[],
    ) => Promise<void>
  >(async () => {});
  const drainQueuedPromptsRef = React.useRef<() => void>(() => {});
  const drainingQueuedPromptRef = React.useRef(false);
  const persistenceRef = React.useRef(Promise.resolve());
  const approvalResolversRef = React.useRef(
    new Map<string, { threadId: string; resolve(approved: boolean): void }>(),
  );

  const resolveApproval = React.useCallback(
    (threadId: string, approvalId: string, approved: boolean) => {
      const pending = approvalResolversRef.current.get(approvalId);
      if (!pending || pending.threadId !== threadId) return;
      approvalResolversRef.current.delete(approvalId);
      setPendingApprovals((current) => current.filter((item) => item.id !== approvalId));
      pending.resolve(approved);
    },
    [],
  );

  const replaceThreads = React.useCallback(async (next: LocalAssistantThread[]) => {
    threadsRef.current = next;
    setThreads(next);
    const write = persistenceRef.current.then(() => saveLocalAssistantThreads(next));
    persistenceRef.current = write.catch(() => undefined);
    await write;
  }, []);

  const replaceThread = React.useCallback(
    async (nextThread: LocalAssistantThread) => {
      const next = threadsRef.current.map((thread) =>
        thread.id === nextThread.id ? nextThread : thread,
      );
      await replaceThreads(next);
    },
    [replaceThreads],
  );

  const mutateThread = React.useCallback(
    async (
      threadId: string,
      update: (current: LocalAssistantThread) => LocalAssistantThread,
    ): Promise<LocalAssistantThread | null> => {
      const current = threadsRef.current.find((thread) => thread.id === threadId);
      if (!current) return null;
      const nextThread = update(current);
      const next = threadsRef.current.map((thread) =>
        thread.id === threadId ? nextThread : thread,
      );
      await replaceThreads(next);
      return nextThread;
    },
    [replaceThreads],
  );

  React.useEffect(() => {
    let active = true;
    void loadLocalAssistantThreads()
      .then((stored) => {
        if (!active) return;
        threadsRef.current = stored;
        setThreads(stored);
      })
      .catch((nextError) => active && setError(nextError?.message ?? String(nextError)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      abortRef.current?.controller.abort();
      for (const pending of approvalResolversRef.current.values()) pending.resolve(false);
      approvalResolversRef.current.clear();
    };
  }, []);

  React.useEffect(() => {
    if (!loading && mesh.identity) queueMicrotask(() => drainQueuedPromptsRef.current());
  }, [loading, mesh.identity]);

  const refreshThreads = React.useCallback(async () => {
    await persistenceRef.current;
    const stored = await loadLocalAssistantThreads();
    threadsRef.current = stored;
    setThreads(stored);
    return stored;
  }, []);

  const createThread = React.useCallback(
    async (title = '') => {
      const settings = await loadLocalAssistantSettings();
      const now = new Date().toISOString();
      const thread: LocalAssistantThread = {
        id: `mobile_thread_${Crypto.randomUUID()}`,
        title: title.trim().slice(0, 160) || nextChatTitle(threadsRef.current),
        createdAt: now,
        updatedAt: now,
        model: settings.model,
        thinkingLevel: settings.thinkingLevel,
        status: 'idle',
        error: null,
        workspaceTargets: [],
        autoApprove: false,
        agentPermissionMode: 'full-access',
        approvalPolicy: 'ask',
        messages: [],
        queuedPrompts: [],
      };
      await replaceThreads([thread, ...threadsRef.current]);
      return thread;
    },
    [replaceThreads],
  );

  const deleteThread = React.useCallback(
    async (threadId: string) => {
      if (abortRef.current?.threadId === threadId) abortRef.current.controller.abort();
      const next = threadsRef.current.filter((thread) => thread.id !== threadId);
      await replaceThreads(next);
      await deleteLocalBlipSessionSnapshot(threadId);
    },
    [replaceThreads],
  );

  const deleteMessage = React.useCallback(
    async (threadId: string, messageId: string, deleteFollowing: boolean) => {
      if (abortRef.current?.threadId === threadId) {
        throw new Error('Stop the assistant before deleting messages');
      }
      const current = threadsRef.current.find((thread) => thread.id === threadId);
      if (!current) throw new Error('Built-in chat was not found');
      const messages = messagesAfterDeletion(current.messages, messageId, deleteFollowing);
      if (!messages) throw new Error('Assistant message was not found');

      // Rebuild the canonical model transcript from the edited visible history on the next prompt.
      await deleteLocalBlipSessionSnapshot(threadId);
      await replaceThread({
        ...current,
        messages,
        status: 'idle',
        error: null,
        updatedAt: new Date().toISOString(),
      });
    },
    [replaceThread],
  );

  const cloneThread = React.useCallback(
    async (threadId: string) => {
      if (abortRef.current?.threadId === threadId)
        throw new Error('Stop this chat before cloning it');
      const source = threadsRef.current.find((thread) => thread.id === threadId);
      if (!source) throw new Error('Built-in chat was not found');
      const now = new Date().toISOString();
      const thread: LocalAssistantThread = {
        ...source,
        id: `mobile_thread_${Crypto.randomUUID()}`,
        title: clonedChatTitle(source.title, threadsRef.current),
        createdAt: now,
        updatedAt: now,
        status: 'idle',
        error: null,
        workspaceTargets: source.workspaceTargets.map((target) => ({ ...target })),
        messages: source.messages.map((message) => ({ ...message })),
        queuedPrompts: [],
      };
      await cloneLocalBlipSessionSnapshot(source, thread);
      try {
        await replaceThreads([thread, ...threadsRef.current]);
      } catch (error) {
        await deleteLocalBlipSessionSnapshot(thread.id).catch(() => undefined);
        throw error;
      }
      return thread;
    },
    [replaceThreads],
  );

  const updateThread = React.useCallback(
    async (
      threadId: string,
      patch: {
        title?: string;
        model?: string;
        thinkingLevel?: LocalAssistantThinkingLevel;
        workspaceTargets?: LocalWorkspaceTarget[];
        autoApprove?: boolean;
        agentPermissionMode?: 'read-only' | 'workspace-write' | 'full-access';
        approvalPolicy?: 'ask' | 'never';
        artifactWorkspace?: boolean;
      },
    ) => {
      const current = threadsRef.current.find((thread) => thread.id === threadId);
      if (!current) return;
      await replaceThread({
        ...current,
        ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 160) } : {}),
        ...(patch.model !== undefined ? { model: patch.model.trim().slice(0, 100) } : {}),
        ...(patch.thinkingLevel !== undefined ? { thinkingLevel: patch.thinkingLevel } : {}),
        ...(patch.workspaceTargets !== undefined
          ? { workspaceTargets: cleanLocalWorkspaceTargets(patch.workspaceTargets) }
          : {}),
        ...(patch.autoApprove !== undefined
          ? {
              autoApprove: patch.autoApprove === true,
              approvalPolicy: patch.autoApprove === true ? 'never' : 'ask',
            }
          : {}),
        ...(patch.agentPermissionMode !== undefined
          ? { agentPermissionMode: patch.agentPermissionMode }
          : {}),
        ...(patch.approvalPolicy !== undefined
          ? {
              approvalPolicy: patch.approvalPolicy,
              autoApprove: patch.approvalPolicy === 'never',
            }
          : {}),
        ...(patch.artifactWorkspace !== undefined
          ? { artifactWorkspace: patch.artifactWorkspace === true }
          : {}),
        updatedAt: new Date().toISOString(),
      });
      if (patch.autoApprove === true || patch.approvalPolicy === 'never') {
        // Resolve from the authoritative map rather than the rendered approval list. Header
        // actions can retain an older callback while an approval is being added, and using the
        // state snapshot here would leave that already-pending tool call blocked indefinitely.
        for (const [approvalId, pending] of [...approvalResolversRef.current]) {
          if (pending.threadId === threadId) resolveApproval(threadId, approvalId, true);
        }
      }
    },
    [replaceThread, resolveApproval],
  );

  const sendPrompt = React.useCallback(
    async (
      threadId: string,
      rawPrompt: string,
      rawPromptImages: LocalAssistantPromptImage[] = [],
    ) => {
      const prompt = rawPrompt.trim();
      const promptImages = rawPromptImages.filter(
        (image) =>
          image?.type === 'image' &&
          Boolean(String(image.data ?? '').trim()) &&
          Boolean(String(image.mimeType ?? '').trim()),
      );
      if (!prompt && promptImages.length === 0) return;
      const current = threadsRef.current.find((thread) => thread.id === threadId);
      if (!current) throw new Error('Built-in chat was not found');
      if (abortRef.current) {
        if (promptImages.length > 0) {
          throw new Error('Wait for the current response before sending images.');
        }
        const queued: LocalAssistantQueuedPrompt = {
          id: `mobile_queued_${Crypto.randomUUID()}`,
          prompt,
          promptImages: [],
          createdAt: new Date().toISOString(),
          status: 'queued',
          error: null,
        };
        await mutateThread(threadId, (latest) => {
          if (latest.queuedPrompts.length >= 20)
            throw new Error('Phone assistant prompt queue is full (max 20)');
          return {
            ...latest,
            updatedAt: queued.createdAt,
            queuedPrompts: [...latest.queuedPrompts, queued],
          };
        });
        return;
      }
      setError(null);
      const controller = new AbortController();
      abortRef.current = { threadId, controller };
      setRunningThreadId(threadId);
      let running: LocalAssistantThread | null = null;
      const persistRunning = async (patch: Partial<LocalAssistantThread>) => {
        const next = await mutateThread(threadId, (latest) => ({
          ...latest,
          ...patch,
          updatedAt: new Date().toISOString(),
        }));
        if (next) running = next;
        return next;
      };
      try {
        const [apiKey, settings, sessionSnapshot] = await Promise.all([
          readLocalAssistantApiKey(),
          loadLocalAssistantSettings(),
          loadLocalBlipSessionSnapshot(current),
        ]);
        if (settings.provider === 'openai' && !apiKey)
          throw new Error('Add an OpenAI API key in Settings before sending a prompt');
        if (!mesh.identity) throw new Error('Phone device identity is not ready');
        const latest = threadsRef.current.find((thread) => thread.id === threadId);
        if (!latest) throw new Error('Built-in chat was not found');
        running = await persistRunning({
          model: latest.model || settings.model,
          status: 'running',
          error: null,
          messages: [...latest.messages, userMessage(prompt, promptImages)],
        });
        if (!running) throw new Error('Built-in chat was not found');
        const workspaceRuntime = createWorkspaceToolRuntime(running, mesh.request);
        const messages = await runMobileBlip({
          provider: settings.provider,
          apiKey,
          codexAuth: settings.provider === 'codex' ? await readLocalAssistantCodexAuth() : null,
          prompt,
          promptImages,
          thread: running,
          history: latest.messages,
          workspaceRuntime,
          signal: controller.signal,
          requestExecuteApproval: async ({ toolName, args, signal }) => {
            if (
              threadsRef.current.find((candidate) => candidate.id === threadId)?.autoApprove ===
              true
            )
              return true;
            const approval: LocalAssistantApproval = {
              id: `mobile_approval_${Crypto.randomUUID()}`,
              threadId,
              toolName,
              label: 'Execute Bash command',
              args,
              createdAt: new Date().toISOString(),
            };
            return await new Promise<boolean>((resolve) => {
              let settled = false;
              const finish = (approved: boolean) => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener('abort', deny);
                resolve(approved);
              };
              const deny = () => {
                approvalResolversRef.current.delete(approval.id);
                setPendingApprovals((current) => current.filter((item) => item.id !== approval.id));
                finish(false);
              };
              approvalResolversRef.current.set(approval.id, { threadId, resolve: finish });
              setPendingApprovals((current) => [...current, approval]);
              signal?.addEventListener('abort', deny, { once: true });
              if (signal?.aborted) deny();
            });
          },
          onMessages: async (messages: LocalAssistantMessage[]) => {
            await persistRunning({
              messages: boundLocalAssistantMessages(messages),
            });
          },
          onStreamingMessages: async (messages: LocalAssistantMessage[]) => {
            const preview = {
              ...(threadsRef.current.find((thread) => thread.id === threadId) ?? running!),
              messages: boundLocalAssistantMessages(messages),
              updatedAt: new Date().toISOString(),
            };
            const next = threadsRef.current.map((thread) =>
              thread.id === preview.id ? preview : thread,
            );
            threadsRef.current = next;
            setThreads(next);
          },
          sessionSnapshot,
          onSessionSnapshot: (snapshot, startIndex, appendedEntries) =>
            saveLocalBlipSessionSnapshot(threadId, snapshot, startIndex, appendedEntries),
          onDeleteSession: () => deleteLocalBlipSessionSnapshot(threadId),
        });
        await persistRunning({
          messages: boundLocalAssistantMessages(messages),
          status: 'idle',
          error: null,
        });
      } catch (nextError: any) {
        const stopped = controller.signal.aborted;
        await persistRunning({
          status: stopped ? 'idle' : 'error',
          error: stopped ? null : (nextError?.message ?? String(nextError)),
        });
        if (!stopped) throw nextError;
      } finally {
        if (abortRef.current?.controller === controller) abortRef.current = null;
        setRunningThreadId((value) => (value === threadId ? null : value));
        queueMicrotask(() => drainQueuedPromptsRef.current());
      }
    },
    [mesh.identity, mesh.request, mutateThread],
  );

  sendPromptRef.current = sendPrompt;
  drainQueuedPromptsRef.current = () => {
    if (abortRef.current || drainingQueuedPromptRef.current) return;
    const candidates = threadsRef.current.flatMap((thread, threadIndex) =>
      thread.queuedPrompts.flatMap((prompt, promptIndex) =>
        prompt.status === 'queued' ? [{ thread, prompt, threadIndex, promptIndex }] : [],
      ),
    );
    candidates.sort((left, right) => {
      const leftMs = Date.parse(left.prompt.createdAt);
      const rightMs = Date.parse(right.prompt.createdAt);
      const timeOrder =
        (Number.isFinite(leftMs) ? leftMs : Number.MAX_SAFE_INTEGER) -
        (Number.isFinite(rightMs) ? rightMs : Number.MAX_SAFE_INTEGER);
      return (
        timeOrder || left.threadIndex - right.threadIndex || left.promptIndex - right.promptIndex
      );
    });
    const candidate = candidates[0];
    if (!candidate) return;
    const { thread, prompt: queued } = candidate;
    drainingQueuedPromptRef.current = true;
    void (async () => {
      try {
        if (abortRef.current) return;
        let claimed = false;
        await mutateThread(thread.id, (latest) => {
          if (!latest.queuedPrompts.some((prompt) => prompt.id === queued.id)) return latest;
          claimed = true;
          return {
            ...latest,
            updatedAt: new Date().toISOString(),
            queuedPrompts: latest.queuedPrompts.filter((prompt) => prompt.id !== queued.id),
          };
        });
        if (!claimed) return;
        await sendPromptRef.current(thread.id, queued.prompt, queued.promptImages);
      } catch (nextError: any) {
        await mutateThread(thread.id, (latest) => ({
          ...latest,
          queuedPrompts: [
            ...latest.queuedPrompts.filter((prompt) => prompt.id !== queued.id),
            {
              ...queued,
              status: 'failed' as const,
              error: nextError?.message ?? String(nextError),
            },
          ].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)),
        }));
      } finally {
        drainingQueuedPromptRef.current = false;
        if (!abortRef.current) queueMicrotask(() => drainQueuedPromptsRef.current());
      }
    })();
  };

  const cancelQueuedPrompt = React.useCallback(
    async (threadId: string, promptId: string) => {
      const result = await mutateThread(threadId, (current) => {
        const queued = current.queuedPrompts.find((prompt) => prompt.id === promptId);
        if (!queued) throw new Error('Queued phone assistant prompt was not found');
        return {
          ...current,
          updatedAt: new Date().toISOString(),
          queuedPrompts: current.queuedPrompts.filter((prompt) => prompt.id !== promptId),
        };
      });
      if (!result) throw new Error('Built-in chat was not found');
    },
    [mutateThread],
  );

  const stop = React.useCallback((threadId: string) => {
    if (abortRef.current?.threadId === threadId) abortRef.current.controller.abort();
  }, []);

  const value: LocalAssistantContextValue = {
    threads,
    loading,
    runningThreadId,
    error,
    pendingApprovals,
    refreshThreads,
    createThread,
    cloneThread,
    deleteThread,
    deleteMessage,
    updateThread,
    resolveApproval,
    sendPrompt,
    cancelQueuedPrompt,
    stop,
  };
  return <LocalAssistantContext.Provider value={value}>{children}</LocalAssistantContext.Provider>;
}

export function useLocalAssistant(): LocalAssistantContextValue {
  const value = React.useContext(LocalAssistantContext);
  if (!value) throw new Error('useLocalAssistant must be used inside LocalAssistantProvider');
  return value;
}
