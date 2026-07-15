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
  LocalAssistantQueuedPrompt,
  LocalAssistantThinkingLevel,
  LocalAssistantThread,
  LocalWorkspaceTarget,
} from './local-assistant-types';
import { readLocalAssistantCodexAuth } from './local-assistant-codex-auth';
import { nextAssistantThreadTitle } from './next-assistant-thread-title';
import { createWorkspaceToolRuntime } from './workspace-tools';
import { runMobileBlip } from './run-mobile-blip';
import {
  deleteLocalBlipSessionSnapshot,
  loadLocalBlipSessionSnapshot,
  saveLocalBlipSessionSnapshot,
} from './local-blip-storage';

type LocalAssistantContextValue = {
  threads: LocalAssistantThread[];
  activeThreadId: string;
  loading: boolean;
  runningThreadId: string | null;
  error: string | null;
  refreshThreads(): Promise<LocalAssistantThread[]>;
  selectThread(threadId: string): void;
  createThread(title?: string): Promise<LocalAssistantThread>;
  deleteThread(threadId: string): Promise<void>;
  updateThread(
    threadId: string,
    patch: {
      title?: string;
      model?: string;
      thinkingLevel?: LocalAssistantThinkingLevel;
      workspaceTargets?: LocalWorkspaceTarget[];
    },
  ): Promise<void>;
  sendPrompt(threadId: string, prompt: string): Promise<void>;
  cancelQueuedPrompt(threadId: string, promptId: string): Promise<void>;
  stop(threadId: string): void;
};

const LocalAssistantContext = React.createContext<LocalAssistantContextValue | null>(null);

function userMessage(prompt: string): LocalAssistantMessage {
  return {
    id: Crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    role: 'user',
    content: prompt,
  };
}

export function LocalAssistantProvider({ children }: { children: React.ReactNode }) {
  const mesh = useMesh();
  const [threads, setThreads] = React.useState<LocalAssistantThread[]>([]);
  const [activeThreadId, setActiveThreadId] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [runningThreadId, setRunningThreadId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const threadsRef = React.useRef<LocalAssistantThread[]>([]);
  const abortRef = React.useRef<{ threadId: string; controller: AbortController } | null>(null);
  const sendPromptRef = React.useRef<(threadId: string, prompt: string) => Promise<void>>(
    async () => {},
  );
  const drainQueuedPromptsRef = React.useRef<() => void>(() => {});
  const drainingQueuedPromptRef = React.useRef(false);
  const persistenceRef = React.useRef(Promise.resolve());

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
        setActiveThreadId(stored[0]?.id ?? '');
      })
      .catch((nextError) => active && setError(nextError?.message ?? String(nextError)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      abortRef.current?.controller.abort();
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
    setActiveThreadId((current) =>
      stored.some((thread) => thread.id === current) ? current : (stored[0]?.id ?? ''),
    );
    return stored;
  }, []);

  const createThread = React.useCallback(
    async (title = '') => {
      const settings = await loadLocalAssistantSettings();
      const now = new Date().toISOString();
      const thread: LocalAssistantThread = {
        id: `mobile_thread_${Crypto.randomUUID()}`,
        title: title.trim().slice(0, 160) || nextAssistantThreadTitle(threadsRef.current),
        createdAt: now,
        updatedAt: now,
        model: settings.model,
        thinkingLevel: settings.thinkingLevel,
        status: 'idle',
        error: null,
        workspaceTargets: [],
        messages: [],
        queuedPrompts: [],
      };
      await replaceThreads([thread, ...threadsRef.current]);
      setActiveThreadId(thread.id);
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
      setActiveThreadId((current) => (current === threadId ? (next[0]?.id ?? '') : current));
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
        updatedAt: new Date().toISOString(),
      });
    },
    [replaceThread],
  );

  const sendPrompt = React.useCallback(
    async (threadId: string, rawPrompt: string) => {
      const prompt = rawPrompt.trim();
      if (!prompt) return;
      const current = threadsRef.current.find((thread) => thread.id === threadId);
      if (!current) throw new Error('Local assistant thread was not found');
      if (abortRef.current) {
        const queued: LocalAssistantQueuedPrompt = {
          id: `mobile_queued_${Crypto.randomUUID()}`,
          prompt,
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
        if (!latest) throw new Error('Local assistant thread was not found');
        running = {
          ...latest,
          model: latest.model || settings.model,
          status: 'running',
          error: null,
          updatedAt: new Date().toISOString(),
          messages: [...latest.messages, userMessage(prompt)],
        };
        await replaceThread(running);
        const workspaceRuntime = createWorkspaceToolRuntime(running, mesh.request);
        const messages = await runMobileBlip({
          provider: settings.provider,
          apiKey,
          codexAuth: settings.provider === 'codex' ? await readLocalAssistantCodexAuth() : null,
          prompt,
          thread: running,
          history: latest.messages,
          workspaceRuntime,
          signal: controller.signal,
          onMessages: async (messages: LocalAssistantMessage[]) => {
            const queuedPrompts =
              threadsRef.current.find((thread) => thread.id === threadId)?.queuedPrompts ??
              running!.queuedPrompts;
            running = {
              ...running!,
              messages: boundLocalAssistantMessages(messages),
              queuedPrompts,
              updatedAt: new Date().toISOString(),
            };
            await replaceThread(running);
          },
          onStreamingMessages: async (messages: LocalAssistantMessage[]) => {
            const queuedPrompts =
              threadsRef.current.find((thread) => thread.id === threadId)?.queuedPrompts ??
              running!.queuedPrompts;
            const preview = {
              ...running!,
              messages: boundLocalAssistantMessages(messages),
              queuedPrompts,
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
        running = {
          ...running!,
          messages: boundLocalAssistantMessages(messages),
          queuedPrompts:
            threadsRef.current.find((thread) => thread.id === threadId)?.queuedPrompts ??
            running!.queuedPrompts,
          status: 'idle',
          error: null,
          updatedAt: new Date().toISOString(),
        };
        await replaceThread(running);
      } catch (nextError: any) {
        const stopped = controller.signal.aborted;
        if (running) {
          running = {
            ...running,
            queuedPrompts:
              threadsRef.current.find((thread) => thread.id === threadId)?.queuedPrompts ??
              running.queuedPrompts,
            status: stopped ? 'idle' : 'error',
            error: stopped ? null : (nextError?.message ?? String(nextError)),
            updatedAt: new Date().toISOString(),
          };
          await replaceThread(running);
        }
        if (!stopped) throw nextError;
      } finally {
        if (abortRef.current?.controller === controller) abortRef.current = null;
        setRunningThreadId((value) => (value === threadId ? null : value));
        queueMicrotask(() => drainQueuedPromptsRef.current());
      }
    },
    [mesh.identity, mesh.request, mutateThread, replaceThread],
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
        await sendPromptRef.current(thread.id, queued.prompt);
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
      if (!result) throw new Error('Local assistant thread was not found');
    },
    [mutateThread],
  );

  const stop = React.useCallback((threadId: string) => {
    if (abortRef.current?.threadId === threadId) abortRef.current.controller.abort();
  }, []);

  const value: LocalAssistantContextValue = {
    threads,
    activeThreadId,
    loading,
    runningThreadId,
    error,
    refreshThreads,
    selectThread: setActiveThreadId,
    createThread,
    deleteThread,
    updateThread,
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
