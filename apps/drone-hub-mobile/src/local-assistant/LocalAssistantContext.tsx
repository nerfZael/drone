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
  LocalAssistantThinkingLevel,
  LocalAssistantThread,
  LocalWorkspaceTarget,
} from './local-assistant-types';
import { runOpenAiChat } from './openai-chat-client';
import { runCodexChat } from './codex-chat-client';
import { readLocalAssistantCodexAuth } from './local-assistant-codex-auth';
import { nextAssistantThreadTitle } from './next-assistant-thread-title';
import { createWorkspaceToolRuntime } from './workspace-tools';

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

  const replaceThreads = React.useCallback(async (next: LocalAssistantThread[]) => {
    threadsRef.current = next;
    setThreads(next);
    await saveLocalAssistantThreads(next);
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

  const refreshThreads = React.useCallback(async () => {
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
      if (abortRef.current) throw new Error('Another phone assistant run is already active');
      const current = threadsRef.current.find((thread) => thread.id === threadId);
      if (!current) throw new Error('Local assistant thread was not found');
      const [apiKey, settings] = await Promise.all([
        readLocalAssistantApiKey(),
        loadLocalAssistantSettings(),
      ]);
      if (settings.provider === 'openai' && !apiKey)
        throw new Error('Add an OpenAI API key in Settings before sending a prompt');
      if (!mesh.identity) throw new Error('Phone device identity is not ready');

      setError(null);
      const controller = new AbortController();
      abortRef.current = { threadId, controller };
      setRunningThreadId(threadId);
      let running: LocalAssistantThread = {
        ...current,
        model: current.model || settings.model,
        status: 'running',
        error: null,
        updatedAt: new Date().toISOString(),
        messages: [...current.messages, userMessage(prompt)],
      };
      await replaceThread(running);
      try {
        const workspaceRuntime = createWorkspaceToolRuntime(running, mesh.request);
        const runInput = {
          model: running.model,
          thinkingLevel: running.thinkingLevel,
          thread: running,
          tools: workspaceRuntime.tools,
          signal: controller.signal,
          executeTool: async (
            name: string,
            args: Record<string, unknown>,
            onUpdate?: (result: { text: string; details: unknown }) => void | Promise<void>,
          ) =>
            await workspaceRuntime.execute({
              name,
              args,
              signal: controller.signal,
              onOutput: onUpdate,
            }),
          onMessages: async (messages: LocalAssistantMessage[]) => {
            running = {
              ...running,
              messages: boundLocalAssistantMessages(messages),
              updatedAt: new Date().toISOString(),
            };
            await replaceThread(running);
          },
          onStreamingMessages: async (messages: LocalAssistantMessage[]) => {
            const preview = {
              ...running,
              messages: boundLocalAssistantMessages(messages),
              updatedAt: new Date().toISOString(),
            };
            const next = threadsRef.current.map((thread) =>
              thread.id === preview.id ? preview : thread,
            );
            threadsRef.current = next;
            setThreads(next);
          },
        };
        const messages =
          settings.provider === 'codex'
            ? await runCodexChat({
                ...runInput,
                auth: await readLocalAssistantCodexAuth(),
              })
            : await runOpenAiChat({ ...runInput, apiKey });
        running = {
          ...running,
          messages: boundLocalAssistantMessages(messages),
          status: 'idle',
          error: null,
          updatedAt: new Date().toISOString(),
        };
        await replaceThread(running);
      } catch (nextError: any) {
        const stopped = controller.signal.aborted;
        running = {
          ...running,
          status: stopped ? 'idle' : 'error',
          error: stopped ? null : (nextError?.message ?? String(nextError)),
          updatedAt: new Date().toISOString(),
        };
        await replaceThread(running);
        if (!stopped) throw nextError;
      } finally {
        if (abortRef.current?.controller === controller) abortRef.current = null;
        setRunningThreadId((value) => (value === threadId ? null : value));
      }
    },
    [mesh.identity, mesh.request, replaceThread],
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
    stop,
  };
  return <LocalAssistantContext.Provider value={value}>{children}</LocalAssistantContext.Provider>;
}

export function useLocalAssistant(): LocalAssistantContextValue {
  const value = React.useContext(LocalAssistantContext);
  if (!value) throw new Error('useLocalAssistant must be used inside LocalAssistantProvider');
  return value;
}
