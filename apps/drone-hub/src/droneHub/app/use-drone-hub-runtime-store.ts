import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { PendingPrompt, TranscriptItem } from '../types';
import type { StartupSeedState } from './app-types';

type Updater<T> = T | ((prev: T) => T);

type DroneHubRuntimeState = {
  optimisticallyDeletedDrones: Record<string, boolean>;
  startupSeedByDrone: Record<string, StartupSeedState>;
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

export const useDroneHubRuntimeStore = create<DroneHubRuntimeState>((set) => ({
  optimisticallyDeletedDrones: {},
  startupSeedByDrone: {},
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
}));

export function useDroneHubRuntimeState() {
  return useDroneHubRuntimeStore(
    useShallow((s) => ({
      optimisticallyDeletedDrones: s.optimisticallyDeletedDrones,
      startupSeedByDrone: s.startupSeedByDrone,
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
