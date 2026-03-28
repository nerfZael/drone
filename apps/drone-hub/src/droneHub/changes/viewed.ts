import type { RepoChangeEntry } from '../types';
import { CHANGES_VIEWED_FILES_STORAGE_KEY, readChangesStorage, writeChangesStorage } from './storage';

export type ViewedEntryState = 'unviewed' | 'viewed' | 'stale';

type ViewedFileRecord = {
  token: string;
  viewedAt: number;
};

type ViewedScopeRecord = {
  updatedAt: number;
  files: Record<string, ViewedFileRecord>;
};

export type ViewedChangesStore = {
  version: 1;
  scopes: Record<string, ViewedScopeRecord>;
};

const MAX_VIEWED_SCOPES = 160;

function emptyStore(): ViewedChangesStore {
  return { version: 1, scopes: {} };
}

function normalizeEntryIdentity(entry: Pick<RepoChangeEntry, 'path' | 'originalPath' | 'reviewKey' | 'reviewToken'>): {
  key: string;
  token: string;
} | null {
  const path = String(entry.path ?? '').trim();
  if (!path) return null;
  const fallbackKey = `${String(entry.originalPath ?? '').trim()}\u0000${path}`;
  const key = String(entry.reviewKey ?? '').trim() || fallbackKey;
  const token = String(entry.reviewToken ?? '').trim();
  if (!key || !token) return null;
  return { key, token };
}

function pruneViewedChangesStore(store: ViewedChangesStore): ViewedChangesStore {
  const scopes = Object.entries(store.scopes)
    .filter(([scopeId, scope]) => {
      return Boolean(scopeId && scope && typeof scope === 'object' && Object.keys(scope.files ?? {}).length > 0);
    })
    .sort((a, b) => {
      const aAt = Number(a[1]?.updatedAt ?? 0);
      const bAt = Number(b[1]?.updatedAt ?? 0);
      return bAt - aAt;
    })
    .slice(0, MAX_VIEWED_SCOPES);

  return {
    version: 1,
    scopes: Object.fromEntries(scopes),
  };
}

export function readViewedChangesStore(): ViewedChangesStore {
  const raw = readChangesStorage(CHANGES_VIEWED_FILES_STORAGE_KEY);
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyStore();
    const rawScopes = parsed.scopes;
    if (!rawScopes || typeof rawScopes !== 'object' || Array.isArray(rawScopes)) return emptyStore();
    const scopes: Record<string, ViewedScopeRecord> = {};
    for (const [scopeIdRaw, scopeRaw] of Object.entries(rawScopes as Record<string, unknown>)) {
      const scopeId = String(scopeIdRaw ?? '').trim();
      if (!scopeId || !scopeRaw || typeof scopeRaw !== 'object' || Array.isArray(scopeRaw)) continue;
      const filesRaw = (scopeRaw as any).files;
      if (!filesRaw || typeof filesRaw !== 'object' || Array.isArray(filesRaw)) continue;
      const files: Record<string, ViewedFileRecord> = {};
      for (const [fileKeyRaw, fileRaw] of Object.entries(filesRaw as Record<string, unknown>)) {
        const fileKey = String(fileKeyRaw ?? '').trim();
        const token = String((fileRaw as any)?.token ?? '').trim();
        const viewedAt = Number((fileRaw as any)?.viewedAt ?? 0);
        if (!fileKey || !token) continue;
        files[fileKey] = {
          token,
          viewedAt: Number.isFinite(viewedAt) && viewedAt > 0 ? Math.floor(viewedAt) : 0,
        };
      }
      if (Object.keys(files).length === 0) continue;
      const updatedAt = Number((scopeRaw as any).updatedAt ?? 0);
      scopes[scopeId] = {
        updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : 0,
        files,
      };
    }
    return pruneViewedChangesStore({ version: 1, scopes });
  } catch {
    return emptyStore();
  }
}

export function writeViewedChangesStore(store: ViewedChangesStore): void {
  writeChangesStorage(CHANGES_VIEWED_FILES_STORAGE_KEY, JSON.stringify(pruneViewedChangesStore(store)));
}

export function viewedStateForEntry(
  store: ViewedChangesStore,
  reviewScopeId: string | null | undefined,
  entry: Pick<RepoChangeEntry, 'path' | 'originalPath' | 'reviewKey' | 'reviewToken'>,
): ViewedEntryState {
  const scopeId = String(reviewScopeId ?? '').trim();
  if (!scopeId) return 'unviewed';
  const identity = normalizeEntryIdentity(entry);
  if (!identity) return 'unviewed';
  const scope = store.scopes[scopeId];
  if (!scope) return 'unviewed';
  const record = scope.files[identity.key];
  if (!record) return 'unviewed';
  return record.token === identity.token ? 'viewed' : 'stale';
}

export function setEntryViewed(
  store: ViewedChangesStore,
  reviewScopeId: string | null | undefined,
  entry: Pick<RepoChangeEntry, 'path' | 'originalPath' | 'reviewKey' | 'reviewToken'>,
  viewed: boolean,
): ViewedChangesStore {
  const scopeId = String(reviewScopeId ?? '').trim();
  const identity = normalizeEntryIdentity(entry);
  if (!scopeId || !identity) return store;

  const scope = store.scopes[scopeId];
  const nextFiles = { ...(scope?.files ?? {}) };
  const existing = nextFiles[identity.key];
  if (viewed) {
    if (existing && existing.token === identity.token) return store;
    nextFiles[identity.key] = { token: identity.token, viewedAt: Date.now() };
  } else {
    if (!(identity.key in nextFiles)) return store;
    delete nextFiles[identity.key];
  }

  const nextScopes = { ...store.scopes };
  if (Object.keys(nextFiles).length === 0) {
    delete nextScopes[scopeId];
  } else {
    nextScopes[scopeId] = {
      updatedAt: Date.now(),
      files: nextFiles,
    };
  }

  return pruneViewedChangesStore({
    version: 1,
    scopes: nextScopes,
  });
}
