import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { PendingPrompt, TranscriptItem } from '../types';
import type { StartupSeedState } from './app-types';

type Updater<T> = T | ((prev: T) => T);

type DroneHubRuntimePersistedState = Pick<DroneHubRuntimeState, 'unreadAgentMessageByDroneId'>;

type DroneHubRuntimeState = {
  optimisticallyDeletedDrones: Record<string, boolean>;
  startupSeedByDrone: Record<string, StartupSeedState>;
  unreadAgentMessageByDroneId: Record<string, boolean>;
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
  setUnreadAgentMessageByDroneId: (next: Updater<Record<string, boolean>>) => void;
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

function normalizeUnreadAgentMessageByDroneId(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, unread] of Object.entries(value as Record<string, unknown>)) {
    const id = String(key ?? '').trim();
    if (!id || unread !== true) continue;
    out[id] = true;
  }
  return out;
}

export const useDroneHubRuntimeStore = create<DroneHubRuntimeState>()(
  persist(
    (set) => ({
      optimisticallyDeletedDrones: {},
      startupSeedByDrone: {},
      unreadAgentMessageByDroneId: {},
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
      setUnreadAgentMessageByDroneId: (next) =>
        set((s) => ({
          unreadAgentMessageByDroneId: resolveNext(s.unreadAgentMessageByDroneId, next),
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
      name: 'droneHub.runtime',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): DroneHubRuntimePersistedState => ({
        unreadAgentMessageByDroneId: state.unreadAgentMessageByDroneId,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<DroneHubRuntimePersistedState>) ?? {};
        return {
          ...currentState,
          ...persisted,
          unreadAgentMessageByDroneId: normalizeUnreadAgentMessageByDroneId(
            persisted.unreadAgentMessageByDroneId ?? currentState.unreadAgentMessageByDroneId,
          ),
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
      unreadAgentMessageByDroneId: s.unreadAgentMessageByDroneId,
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
      setUnreadAgentMessageByDroneId: s.setUnreadAgentMessageByDroneId,
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
