import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { profileStorageKey } from '../../profile-storage';
import { requestJson } from '../http';
import { readChangesStorage, writeChangesStorage } from './storage';

export type RepoWorktree = { path: string; branch: string | null; head: string | null; main: boolean };
export type ChatWorktree = { path: string; branch: string | null; reportedAt: string; available: boolean; main: boolean };
type RepoWorktreesPayload = { ok: true; runtime: 'host' | 'container'; worktrees: RepoWorktree[]; chatWorktree: ChatWorktree | null };

/** Follow the chat's reported worktree, or always show the drone's main checkout. Applies to every drone. */
export type ChangesWorktreeMode = 'follow-chat' | 'main';

const MODE_STORAGE_KEY = profileStorageKey('droneHub.changesWorktreeMode');
const PINNED_STORAGE_KEY = profileStorageKey('droneHub.changesWorktreeByDrone');
const FOLLOW_POLL_INTERVAL_MS = 5_000;
const IDLE_POLL_INTERVAL_MS = 30_000;

const listeners = new Set<() => void>();
let mode: ChangesWorktreeMode = readChangesStorage(MODE_STORAGE_KEY) === 'main' ? 'main' : 'follow-chat';
let pinnedByDrone: Record<string, string> = readPinned();

function readPinned(): Record<string, string> {
  try {
    const raw = JSON.parse(readChangesStorage(PINNED_STORAGE_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === 'string' && value)) as Record<string, string>;
  } catch {
    return {};
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Follow the chat or stay on the main checkout; either one drops a worktree picked by hand for this drone. */
export function setChangesWorktreeMode(droneId: string, next: ChangesWorktreeMode): void {
  mode = next;
  writeChangesStorage(MODE_STORAGE_KEY, next);
  setPinnedChangesWorktree(droneId, null);
  notify();
}

/** A worktree picked by hand stays shown for this drone until the user goes back to following or to main. */
export function setPinnedChangesWorktree(droneId: string, worktreePath: string | null): void {
  if ((pinnedByDrone[droneId] ?? null) === worktreePath) return;
  const next = { ...pinnedByDrone };
  if (worktreePath) next[droneId] = worktreePath;
  else delete next[droneId];
  pinnedByDrone = next;
  writeChangesStorage(PINNED_STORAGE_KEY, JSON.stringify(next));
  notify();
}

export type ChangesWorktreeSource = 'main' | 'chat' | 'pinned';

/** Which checkout the Changes explorer shows: null path is the main checkout. */
export function resolveChangesWorktree(input: {
  mode: ChangesWorktreeMode;
  pinned: string | null;
  worktrees: RepoWorktree[];
  chatWorktree: ChatWorktree | null;
}): { path: string | null; source: ChangesWorktreeSource } {
  const listed = (worktreePath: string | null | undefined) =>
    worktreePath ? input.worktrees.find((worktree) => worktree.path === worktreePath) ?? null : null;
  const pinned = listed(input.pinned);
  if (pinned) return pinned.main ? { path: null, source: 'pinned' } : { path: pinned.path, source: 'pinned' };
  if (input.mode === 'follow-chat' && input.chatWorktree?.available && !input.chatWorktree.main) {
    const chat = listed(input.chatWorktree.path);
    if (chat && !chat.main) return { path: chat.path, source: 'chat' };
  }
  return { path: null, source: 'main' };
}

export function useChangesWorktree(input: { droneId: string; chatName: string | null; enabled: boolean }) {
  const { droneId, chatName, enabled } = input;
  const currentMode = React.useSyncExternalStore(subscribe, () => mode, () => mode);
  const pinned = React.useSyncExternalStore(subscribe, () => pinnedByDrone[droneId] ?? null, () => null);
  const query = useQuery<RepoWorktreesPayload, Error>({
    queryKey: ['drone-changes', droneId, 'worktrees', chatName ?? ''],
    queryFn: ({ signal }) =>
      requestJson<RepoWorktreesPayload>(
        `/api/drones/${encodeURIComponent(droneId)}/repo/worktrees${chatName ? `?chat=${encodeURIComponent(chatName)}` : ''}`,
        { signal },
      ),
    enabled,
    // An agent reports its worktree at any moment; while following, pick it up about as fast as its changes.
    refetchInterval: currentMode === 'follow-chat' && !pinned ? FOLLOW_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    staleTime: 2_000,
  });
  const worktrees = enabled ? query.data?.worktrees ?? [] : [];
  const chatWorktree = enabled ? query.data?.chatWorktree ?? null : null;
  const resolved = React.useMemo(
    () => resolveChangesWorktree({ mode: currentMode, pinned, worktrees, chatWorktree }),
    [chatWorktree, currentMode, pinned, worktrees],
  );
  return { mode: currentMode, pinned, worktrees, chatWorktree, runtime: query.data?.runtime ?? null, ...resolved };
}
