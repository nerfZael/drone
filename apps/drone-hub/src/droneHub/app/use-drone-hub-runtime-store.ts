import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { PendingPrompt, TranscriptItem } from '../types';
import type { StartupSeedState } from './app-types';
import { profileStorageKey } from '../../profile-storage';

type Updater<T> = T | ((prev: T) => T);

type DroneHubRuntimePersistedState = Pick<DroneHubRuntimeState, 'lastAgentSnippetByChatNodeId'>;

type DroneHubRuntimeState = {
  optimisticallyDeletedDrones: Record<string, boolean>;
  startupSeedByDrone: Record<string, StartupSeedState>;
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
  setOptimisticallyDeletedDrones: (next: Updater<Record<string, boolean>>) => void;
  setStartupSeedByDrone: (next: Updater<Record<string, StartupSeedState>>) => void;
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
      setOptimisticallyDeletedDrones: (next) =>
        set((s) => ({
          optimisticallyDeletedDrones: resolveNext(s.optimisticallyDeletedDrones, next),
        })),
      setStartupSeedByDrone: (next) =>
        set((s) => ({
          startupSeedByDrone: resolveNext(s.startupSeedByDrone, next),
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
          unreadAgentMessageByChatNodeId: {},
          lastAgentSnippetByChatNodeId,
        };
      },
    },
  ),
);

export function useDroneHubRuntimeState() {
  return useDroneHubRuntimeStore(
    useShallow((s) => ({
      optimisticallyDeletedDrones: s.optimisticallyDeletedDrones,
      startupSeedByDrone: s.startupSeedByDrone,
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
