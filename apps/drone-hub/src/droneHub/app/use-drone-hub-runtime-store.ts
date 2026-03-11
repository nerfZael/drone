import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { PendingPrompt, TranscriptItem } from '../types';
import { createCanvasChatNodeId } from './app-config';
import type { StartupSeedState } from './app-types';

type Updater<T> = T | ((prev: T) => T);

type DroneHubRuntimePersistedState = Pick<DroneHubRuntimeState, 'unreadAgentMessageByChatNodeId'>;

type DroneHubRuntimeState = {
  optimisticallyDeletedDrones: Record<string, boolean>;
  startupSeedByDrone: Record<string, StartupSeedState>;
  unreadAgentMessageByChatNodeId: Record<string, boolean>;
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

function normalizeUnreadAgentMessageByChatNodeId(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, unread] of Object.entries(value as Record<string, unknown>)) {
    const rawKey = String(key ?? '').trim();
    if (!rawKey || unread !== true) continue;
    const chatNodeId = rawKey.startsWith('chat:') ? rawKey : createCanvasChatNodeId(rawKey, 'default');
    if (!chatNodeId) continue;
    out[chatNodeId] = true;
  }
  return out;
}

export const useDroneHubRuntimeStore = create<DroneHubRuntimeState>()(
  persist(
    (set) => ({
      optimisticallyDeletedDrones: {},
      startupSeedByDrone: {},
      unreadAgentMessageByChatNodeId: {},
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
        unreadAgentMessageByChatNodeId: state.unreadAgentMessageByChatNodeId,
      }),
      merge: (persistedState, currentState) => {
        const persisted =
          (persistedState as Partial<DroneHubRuntimePersistedState> & {
            unreadAgentMessageByDroneId?: unknown;
          }) ?? {};
        return {
          ...currentState,
          ...persisted,
          unreadAgentMessageByChatNodeId: normalizeUnreadAgentMessageByChatNodeId(
            persisted.unreadAgentMessageByChatNodeId ??
              persisted.unreadAgentMessageByDroneId ??
              currentState.unreadAgentMessageByChatNodeId,
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
      unreadAgentMessageByChatNodeId: s.unreadAgentMessageByChatNodeId,
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
