import React from 'react';
import { requestJson } from '../http';
import type { RepoPullRequestsPayload } from '../types';

const LINKED_PR_CACHE_TTL_MS = 12_000;

type LinkedPullRequestSnapshot = {
  data: Extract<RepoPullRequestsPayload, { ok: true }> | null;
  loading: boolean;
  error: string | null;
};

type LinkedPullRequestOptions = {
  droneId: string;
  repoPath: string;
  repoAttached: boolean;
  disabled: boolean;
};

type LinkedPullRequestResource = {
  droneId: string;
  repoKey: string;
  snapshot: LinkedPullRequestSnapshot;
  subscribers: Set<() => void>;
  generation: number;
  loadingPromise: Promise<void> | null;
  queuedRefresh: boolean;
  subscribe: (callback: () => void, droneId: string) => () => void;
  load: (silent: boolean, force?: boolean) => Promise<void>;
  refresh: () => void;
  stop: () => void;
};

const EMPTY_SNAPSHOT: LinkedPullRequestSnapshot = { data: null, loading: false, error: null };
const cache = new Map<string, { atMs: number; data: Extract<RepoPullRequestsPayload, { ok: true }> }>();
const resources = new Map<string, LinkedPullRequestResource>();

function normalizeRepoKey(repoPath: string): string {
  return String(repoPath ?? '').trim();
}

function freshCache(repoKey: string): Extract<RepoPullRequestsPayload, { ok: true }> | null {
  const cached = cache.get(repoKey);
  if (!cached || Date.now() - cached.atMs >= LINKED_PR_CACHE_TTL_MS) return null;
  return cached.data;
}

function emit(resource: LinkedPullRequestResource): void {
  for (const callback of resource.subscribers) callback();
}

function createResource(repoKey: string, droneId: string): LinkedPullRequestResource {
  const resource: LinkedPullRequestResource = {
    droneId,
    repoKey,
    snapshot: { ...EMPTY_SNAPSHOT },
    subscribers: new Set(),
    generation: 0,
    loadingPromise: null,
    queuedRefresh: false,
    subscribe(callback, nextDroneId) {
      resource.droneId = nextDroneId;
      resource.subscribers.add(callback);
      if (resource.subscribers.size === 1) {
        resource.generation += 1;
        void resource.load(false);
      } else {
        callback();
      }
      return () => {
        resource.subscribers.delete(callback);
        if (resource.subscribers.size === 0) resource.stop();
      };
    },
    async load(silent, force = false) {
      if (resource.subscribers.size === 0) return;
      if (resource.loadingPromise) {
        if (force) resource.queuedRefresh = true;
        await resource.loadingPromise;
        return;
      }
      const cached = force ? null : freshCache(resource.repoKey);
      if (cached) {
        resource.snapshot = { data: cached, loading: false, error: null };
        emit(resource);
        return;
      }
      if (!silent) {
        resource.snapshot = { ...resource.snapshot, loading: true };
        emit(resource);
      }

      const requestGeneration = resource.generation;
      const requestDroneId = resource.droneId;
      resource.loadingPromise = requestJson<Extract<RepoPullRequestsPayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(requestDroneId)}/repo/pull-requests?state=all`,
      )
        .then((data) => {
          if (
            resource.subscribers.size === 0 ||
            resource.generation !== requestGeneration ||
            resources.get(resource.repoKey) !== resource
          ) {
            return;
          }
          cache.set(resource.repoKey, { atMs: Date.now(), data });
          resource.snapshot = { data, loading: false, error: null };
          emit(resource);
        })
        .catch((error: any) => {
          if (
            resource.subscribers.size === 0 ||
            resource.generation !== requestGeneration ||
            resources.get(resource.repoKey) !== resource
          ) {
            return;
          }
          resource.snapshot = {
            ...resource.snapshot,
            loading: false,
            error: error?.message ?? String(error),
          };
          emit(resource);
        })
        .finally(() => {
          resource.loadingPromise = null;
          if (resource.queuedRefresh && resource.subscribers.size > 0) {
            resource.queuedRefresh = false;
            void resource.load(false, true);
          }
        });
      await resource.loadingPromise;
    },
    refresh() {
      if (resource.subscribers.size > 0) void resource.load(false, true);
    },
    stop() {
      resource.generation += 1;
      resource.loadingPromise = null;
      resource.queuedRefresh = false;
      resources.delete(resource.repoKey);
    },
  };
  return resource;
}

function getResource(repoKey: string, droneId: string): LinkedPullRequestResource {
  const existing = resources.get(repoKey);
  if (existing) {
    existing.droneId = droneId;
    return existing;
  }
  const resource = createResource(repoKey, droneId);
  resources.set(repoKey, resource);
  return resource;
}

export function invalidateLinkedPullRequestCache(repoPath: string): void {
  const repoKey = normalizeRepoKey(repoPath);
  if (!repoKey) return;
  cache.delete(repoKey);
  resources.get(repoKey)?.refresh();
}

export function subscribeLinkedPullRequests(
  { droneId, repoPath, repoAttached, disabled }: LinkedPullRequestOptions,
  callback: (snapshot: LinkedPullRequestSnapshot) => void,
): () => void {
  const repoKey = normalizeRepoKey(repoPath);
  if (!repoAttached || disabled || !repoKey) {
    callback(EMPTY_SNAPSHOT);
    return () => {};
  }
  const resource = getResource(repoKey, droneId);
  return resource.subscribe(() => callback(resource.snapshot), droneId);
}

export function useLinkedPullRequests(options: LinkedPullRequestOptions): LinkedPullRequestSnapshot {
  const repoKey = React.useMemo(() => normalizeRepoKey(options.repoPath), [options.repoPath]);
  const [state, setState] = React.useState<{ repoKey: string; snapshot: LinkedPullRequestSnapshot }>({
    repoKey: '',
    snapshot: EMPTY_SNAPSHOT,
  });

  React.useEffect(
    () =>
      subscribeLinkedPullRequests(
        { ...options, repoPath: repoKey },
        (snapshot) => setState({ repoKey, snapshot }),
      ),
    [options.disabled, options.droneId, options.repoAttached, repoKey],
  );

  const snapshot = state.repoKey === repoKey ? state.snapshot : EMPTY_SNAPSHOT;
  return snapshot;
}

export function resetLinkedPullRequestResourcesForTests(): void {
  for (const resource of [...resources.values()]) resource.stop();
  resources.clear();
  cache.clear();
}

export function linkedPullRequestResourceCountForTests(): number {
  return resources.size;
}
