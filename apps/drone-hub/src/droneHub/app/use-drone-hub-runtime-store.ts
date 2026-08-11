import React from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { PendingPrompt, TranscriptItem } from '../types';
import type { StartupSeedState } from './app-types';
import { profileStorageKey } from '../../profile-storage';

type Updater<T> = T | ((prev: T) => T);

export const LOCAL_CHAT_BUSY_HANDOFF_MS = 2_000;

type DroneHubRuntimePersistedState = Pick<DroneHubRuntimeState, 'lastAgentSnippetByChatNodeId'>;

export type RepoApplyProgress = {
  token: string;
  droneId: string;
  droneLabel: string;
  startedAt: number;
};

type DroneHubRuntimeState = {
  optimisticallyDeletedDrones: Record<string, boolean>;
  startupSeedByDrone: Record<string, StartupSeedState>;
  approvalRequiredByChatNodeId: Record<string, boolean>;
  localBusyChatCountByNodeId: Record<string, number>;
  unreadAgentMessageByChatNodeId: Record<string, boolean>;
  lastAgentSnippetByChatNodeId: Record<string, string>;
  transcripts: TranscriptItem[] | null;
  transcriptError: string | null;
  loadingTranscript: boolean;
  optimisticPendingPrompts: PendingPrompt[];
  sessionText: string;
  sessionError: string | null;
  loadingSession: boolean;
  pinnedToBottom: boolean;
  repoApplyProgressByToken: Record<string, RepoApplyProgress>;
  setOptimisticallyDeletedDrones: (next: Updater<Record<string, boolean>>) => void;
  setStartupSeedByDrone: (next: Updater<Record<string, StartupSeedState>>) => void;
  setApprovalRequiredByChatNodeId: (next: Updater<Record<string, boolean>>) => void;
  setLocalBusyChatCountByNodeId: (next: Updater<Record<string, number>>) => void;
  setUnreadAgentMessageByChatNodeId: (next: Updater<Record<string, boolean>>) => void;
  setLastAgentSnippetByChatNodeId: (next: Updater<Record<string, string>>) => void;
  setTranscripts: (next: Updater<TranscriptItem[] | null>) => void;
  setTranscriptError: (next: Updater<string | null>) => void;
  setLoadingTranscript: (next: Updater<boolean>) => void;
  setOptimisticPendingPrompts: (next: Updater<PendingPrompt[]>) => void;
  setSessionText: (next: Updater<string>) => void;
  setSessionError: (next: Updater<string | null>) => void;
  setLoadingSession: (next: Updater<boolean>) => void;
  setPinnedToBottom: (next: Updater<boolean>) => void;
};

function resolveNext<T>(prev: T, next: Updater<T>): T {
  return typeof next === 'function' ? (next as (current: T) => T)(prev) : next;
}

export const useDroneHubRuntimeStore = create<DroneHubRuntimeState>()(
  persist(
    (set) => ({
      optimisticallyDeletedDrones: {},
      startupSeedByDrone: {},
      approvalRequiredByChatNodeId: {},
      localBusyChatCountByNodeId: {},
      unreadAgentMessageByChatNodeId: {},
      lastAgentSnippetByChatNodeId: {},
      transcripts: null,
      transcriptError: null,
      loadingTranscript: false,
      optimisticPendingPrompts: [],
      sessionText: '',
      sessionError: null,
      loadingSession: false,
      pinnedToBottom: true,
      repoApplyProgressByToken: {},
      setOptimisticallyDeletedDrones: (next) =>
        set((s) => ({
          optimisticallyDeletedDrones: resolveNext(s.optimisticallyDeletedDrones, next),
        })),
      setStartupSeedByDrone: (next) =>
        set((s) => ({
          startupSeedByDrone: resolveNext(s.startupSeedByDrone, next),
        })),
      setApprovalRequiredByChatNodeId: (next) =>
        set((s) => ({
          approvalRequiredByChatNodeId: resolveNext(s.approvalRequiredByChatNodeId, next),
        })),
      setLocalBusyChatCountByNodeId: (next) =>
        set((s) => ({
          localBusyChatCountByNodeId: resolveNext(s.localBusyChatCountByNodeId, next),
        })),
      setUnreadAgentMessageByChatNodeId: (next) =>
        set((s) => ({
          unreadAgentMessageByChatNodeId: resolveNext(s.unreadAgentMessageByChatNodeId, next),
        })),
      setLastAgentSnippetByChatNodeId: (next) =>
        set((s) => ({
          lastAgentSnippetByChatNodeId: resolveNext(s.lastAgentSnippetByChatNodeId, next),
        })),
      setTranscripts: (next) => set((s) => ({ transcripts: resolveNext(s.transcripts, next) })),
      setTranscriptError: (next) =>
        set((s) => ({ transcriptError: resolveNext(s.transcriptError, next) })),
      setLoadingTranscript: (next) =>
        set((s) => ({ loadingTranscript: resolveNext(s.loadingTranscript, next) })),
      setOptimisticPendingPrompts: (next) =>
        set((s) => ({
          optimisticPendingPrompts: resolveNext(s.optimisticPendingPrompts, next),
        })),
      setSessionText: (next) => set((s) => ({ sessionText: resolveNext(s.sessionText, next) })),
      setSessionError: (next) => set((s) => ({ sessionError: resolveNext(s.sessionError, next) })),
      setLoadingSession: (next) =>
        set((s) => ({ loadingSession: resolveNext(s.loadingSession, next) })),
      setPinnedToBottom: (next) =>
        set((s) => ({ pinnedToBottom: resolveNext(s.pinnedToBottom, next) })),
    }),
    {
      name: profileStorageKey('droneHub.runtime'),
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState) => {
        const persisted =
          persistedState && typeof persistedState === 'object' && !Array.isArray(persistedState)
            ? (persistedState as Record<string, unknown>)
            : {};
        return {
          lastAgentSnippetByChatNodeId: persisted.lastAgentSnippetByChatNodeId ?? {},
        } as DroneHubRuntimePersistedState;
      },
      partialize: (state): DroneHubRuntimePersistedState => ({
        lastAgentSnippetByChatNodeId: state.lastAgentSnippetByChatNodeId,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<DroneHubRuntimePersistedState>) ?? {};
        const rawSnippets = (persisted as any).lastAgentSnippetByChatNodeId;
        const lastAgentSnippetByChatNodeId: Record<string, string> =
          rawSnippets && typeof rawSnippets === 'object' && !Array.isArray(rawSnippets)
            ? Object.fromEntries(
                Object.entries(rawSnippets as Record<string, unknown>)
                  .map(([k, v]) => [String(k).trim(), String(v ?? '').trim()])
                  .filter(([k, v]) => k && v),
              )
            : {};
        return {
          ...currentState,
          ...persisted,
          approvalRequiredByChatNodeId: {},
          localBusyChatCountByNodeId: {},
          unreadAgentMessageByChatNodeId: {},
          repoApplyProgressByToken: {},
          lastAgentSnippetByChatNodeId,
        };
      },
    },
  ),
);

export function beginRepoApplyProgress(input: {
  droneId: string;
  droneLabel: string;
}): () => void {
  const token = `repo-apply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const progress: RepoApplyProgress = {
    token,
    droneId: String(input.droneId ?? '').trim(),
    droneLabel: String(input.droneLabel ?? '').trim() || 'drone',
    startedAt: Date.now(),
  };
  useDroneHubRuntimeStore.setState((state) => ({
    repoApplyProgressByToken: {
      ...state.repoApplyProgressByToken,
      [token]: progress,
    },
  }));
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    useDroneHubRuntimeStore.setState((state) => {
      if (!state.repoApplyProgressByToken[token]) return {};
      const next = { ...state.repoApplyProgressByToken };
      delete next[token];
      return { repoApplyProgressByToken: next };
    });
  };
}

export function useChatApprovalRequired(chatNodeId: string): boolean {
  return useDroneHubRuntimeStore(
    (state) => Boolean(chatNodeId && state.approvalRequiredByChatNodeId[chatNodeId]),
  );
}

export function beginLocalChatBusy(
  chatNodeIdRaw: string,
  options?: { releaseDelayMs?: number },
): () => void {
  const chatNodeId = chatNodeIdRaw.trim();
  if (!chatNodeId) return () => {};
  const releaseDelayMs = Math.max(0, Math.floor(options?.releaseDelayMs ?? 0));
  const setLocalBusyChatCountByNodeId =
    useDroneHubRuntimeStore.getState().setLocalBusyChatCountByNodeId;
  setLocalBusyChatCountByNodeId((current) => ({
    ...current,
    [chatNodeId]: (current[chatNodeId] ?? 0) + 1,
  }));
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const release = () => {
      setLocalBusyChatCountByNodeId((current) => {
        const currentCount = current[chatNodeId] ?? 0;
        if (currentCount <= 0) return current;
        const next = { ...current };
        if (currentCount === 1) delete next[chatNodeId];
        else next[chatNodeId] = currentCount - 1;
        return next;
      });
    };
    if (releaseDelayMs > 0) {
      const timeoutId = globalThis.setTimeout(release, releaseDelayMs);
      (timeoutId as any)?.unref?.();
      return;
    }
    release();
  };
}

export function useLocalChatBusy(chatNodeIdRaw: string, busy: boolean): void {
  const chatNodeId = chatNodeIdRaw.trim();
  React.useEffect(() => {
    if (!chatNodeId || !busy) return;
    // The selected chat surface is a faster source of run state than the
    // registry summary. Keep its report alive briefly when the surface
    // unmounts so switching chats does not expose an unread marker before the
    // authoritative busyChats projection arrives.
    return beginLocalChatBusy(chatNodeId, {
      releaseDelayMs: LOCAL_CHAT_BUSY_HANDOFF_MS,
    });
  }, [busy, chatNodeId]);
}

export function useDroneHubRuntimeState() {
  return useDroneHubRuntimeStore(
    useShallow((s) => ({
      optimisticallyDeletedDrones: s.optimisticallyDeletedDrones,
      startupSeedByDrone: s.startupSeedByDrone,
      approvalRequiredByChatNodeId: s.approvalRequiredByChatNodeId,
      localBusyChatCountByNodeId: s.localBusyChatCountByNodeId,
      unreadAgentMessageByChatNodeId: s.unreadAgentMessageByChatNodeId,
      lastAgentSnippetByChatNodeId: s.lastAgentSnippetByChatNodeId,
      transcripts: s.transcripts,
      transcriptError: s.transcriptError,
      loadingTranscript: s.loadingTranscript,
      optimisticPendingPrompts: s.optimisticPendingPrompts,
      sessionText: s.sessionText,
      sessionError: s.sessionError,
      loadingSession: s.loadingSession,
      pinnedToBottom: s.pinnedToBottom,
      setOptimisticallyDeletedDrones: s.setOptimisticallyDeletedDrones,
      setStartupSeedByDrone: s.setStartupSeedByDrone,
      setApprovalRequiredByChatNodeId: s.setApprovalRequiredByChatNodeId,
      setLocalBusyChatCountByNodeId: s.setLocalBusyChatCountByNodeId,
      setUnreadAgentMessageByChatNodeId: s.setUnreadAgentMessageByChatNodeId,
      setLastAgentSnippetByChatNodeId: s.setLastAgentSnippetByChatNodeId,
      setTranscripts: s.setTranscripts,
      setTranscriptError: s.setTranscriptError,
      setLoadingTranscript: s.setLoadingTranscript,
      setOptimisticPendingPrompts: s.setOptimisticPendingPrompts,
      setSessionText: s.setSessionText,
      setSessionError: s.setSessionError,
      setLoadingSession: s.setLoadingSession,
      setPinnedToBottom: s.setPinnedToBottom,
    })),
  );
}
