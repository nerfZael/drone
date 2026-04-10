import React from 'react';

import type { SyncSet, SyncSetApplyResponse, SyncSetsResponse, SyncSetSourceType } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type SyncSetDraftInput = {
  label: string;
  sourceType: SyncSetSourceType;
  sourcePath: string;
  targetPath: string;
  applyToHost: boolean;
};

export type UseSyncSetsResult = {
  syncSets: SyncSet[];
  syncSetsLoading: boolean;
  syncSetsError: string | null;
  syncSetsNotice: string | null;
  creatingSyncSet: boolean;
  savingSyncSetId: string | null;
  deletingSyncSetId: string | null;
  applyingSyncSetId: string | null;
  loadSyncSets: () => Promise<void>;
  createSyncSet: (draft: SyncSetDraftInput) => Promise<boolean>;
  updateSyncSet: (syncSetId: string, draft: SyncSetDraftInput) => Promise<boolean>;
  deleteSyncSet: (syncSetId: string, label?: string | null) => Promise<boolean>;
  applySyncSetToExistingDrones: (syncSetId: string, label?: string | null) => Promise<boolean>;
};

function applySyncSetsResponse(
  data: SyncSetsResponse,
  setSyncSets: React.Dispatch<React.SetStateAction<SyncSet[]>>,
): void {
  setSyncSets(Array.isArray(data.syncSets) ? data.syncSets : []);
}

function normalizeDraft(draft: SyncSetDraftInput) {
  return {
    label: String(draft.label ?? '').trim(),
    sourceType: draft.sourceType === 'host-path' ? 'host-path' : 'hub-managed',
    sourcePath: String(draft.sourcePath ?? '').trim(),
    targetPath: String(draft.targetPath ?? '').trim(),
    applyToHost: draft.applyToHost === true,
  } as const;
}

function formatApplyNotice(label: string, data: SyncSetApplyResponse): string {
  const parts = [`Applied ${label || 'sync set'}`];
  parts.push(`to ${data.appliedDrones}/${data.totalDrones} existing drones`);
  if (data.syncSet?.applyToHost) {
    parts.push(data.appliedHost ? 'and host' : 'and host failed');
  }
  if (data.failures.length > 0) {
    parts.push(`with ${data.failures.length} failure${data.failures.length === 1 ? '' : 's'}`);
  }
  return `${parts.join(' ')}.`;
}

export function useSyncSets(requestJson: RequestJsonFn): UseSyncSetsResult {
  const [syncSets, setSyncSets] = React.useState<SyncSet[]>([]);
  const [syncSetsLoading, setSyncSetsLoading] = React.useState(false);
  const [syncSetsError, setSyncSetsError] = React.useState<string | null>(null);
  const [syncSetsNotice, setSyncSetsNotice] = React.useState<string | null>(null);
  const [creatingSyncSet, setCreatingSyncSet] = React.useState(false);
  const [savingSyncSetId, setSavingSyncSetId] = React.useState<string | null>(null);
  const [deletingSyncSetId, setDeletingSyncSetId] = React.useState<string | null>(null);
  const [applyingSyncSetId, setApplyingSyncSetId] = React.useState<string | null>(null);

  const loadSyncSets = React.useCallback(async () => {
    setSyncSetsLoading(true);
    setSyncSetsError(null);
    try {
      const data = await requestJson<SyncSetsResponse>('/api/settings/sync-sets');
      applySyncSetsResponse(data, setSyncSets);
    } catch (e: any) {
      setSyncSetsError(e?.message ?? String(e));
    } finally {
      setSyncSetsLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void loadSyncSets();
  }, [loadSyncSets]);

  const createSyncSet = React.useCallback(
    async (draft: SyncSetDraftInput) => {
      const next = normalizeDraft(draft);
      setCreatingSyncSet(true);
      setSyncSetsError(null);
      setSyncSetsNotice(null);
      try {
        const data = await requestJson<SyncSetsResponse>('/api/settings/sync-sets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next),
        });
        applySyncSetsResponse(data, setSyncSets);
        setSyncSetsNotice(`Created sync set ${next.label}.`);
        return true;
      } catch (e: any) {
        setSyncSetsError(e?.message ?? String(e));
        return false;
      } finally {
        setCreatingSyncSet(false);
      }
    },
    [requestJson],
  );

  const updateSyncSet = React.useCallback(
    async (syncSetIdRaw: string, draft: SyncSetDraftInput) => {
      const syncSetId = String(syncSetIdRaw ?? '').trim();
      if (!syncSetId) return false;
      const next = normalizeDraft(draft);
      setSavingSyncSetId(syncSetId);
      setSyncSetsError(null);
      setSyncSetsNotice(null);
      try {
        const data = await requestJson<SyncSetsResponse>(`/api/settings/sync-sets/${encodeURIComponent(syncSetId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next),
        });
        applySyncSetsResponse(data, setSyncSets);
        setSyncSetsNotice(`Saved sync set ${next.label}.`);
        return true;
      } catch (e: any) {
        setSyncSetsError(e?.message ?? String(e));
        return false;
      } finally {
        setSavingSyncSetId((current) => (current === syncSetId ? null : current));
      }
    },
    [requestJson],
  );

  const deleteSyncSet = React.useCallback(
    async (syncSetIdRaw: string, label?: string | null) => {
      const syncSetId = String(syncSetIdRaw ?? '').trim();
      if (!syncSetId) return false;
      setDeletingSyncSetId(syncSetId);
      setSyncSetsError(null);
      setSyncSetsNotice(null);
      try {
        const data = await requestJson<SyncSetsResponse>(`/api/settings/sync-sets/${encodeURIComponent(syncSetId)}`, {
          method: 'DELETE',
        });
        applySyncSetsResponse(data, setSyncSets);
        setSyncSetsNotice(`Deleted sync set ${String(label ?? syncSetId).trim() || syncSetId}.`);
        return true;
      } catch (e: any) {
        setSyncSetsError(e?.message ?? String(e));
        return false;
      } finally {
        setDeletingSyncSetId((current) => (current === syncSetId ? null : current));
      }
    },
    [requestJson],
  );

  const applySyncSetToExistingDrones = React.useCallback(
    async (syncSetIdRaw: string, label?: string | null) => {
      const syncSetId = String(syncSetIdRaw ?? '').trim();
      if (!syncSetId) return false;
      setApplyingSyncSetId(syncSetId);
      setSyncSetsError(null);
      setSyncSetsNotice(null);
      try {
        const data = await requestJson<SyncSetApplyResponse>(`/api/settings/sync-sets/${encodeURIComponent(syncSetId)}/apply`, {
          method: 'POST',
        });
        if (data.syncSet) {
          setSyncSets((current) => current.map((item) => (item.id === syncSetId ? data.syncSet! : item)));
        } else {
          await loadSyncSets();
        }
        setSyncSetsNotice(formatApplyNotice(String(label ?? data.syncSet?.label ?? syncSetId).trim(), data));
        return true;
      } catch (e: any) {
        setSyncSetsError(e?.message ?? String(e));
        return false;
      } finally {
        setApplyingSyncSetId((current) => (current === syncSetId ? null : current));
      }
    },
    [loadSyncSets, requestJson],
  );

  return {
    syncSets,
    syncSetsLoading,
    syncSetsError,
    syncSetsNotice,
    creatingSyncSet,
    savingSyncSetId,
    deletingSyncSetId,
    applyingSyncSetId,
    loadSyncSets,
    createSyncSet,
    updateSyncSet,
    deleteSyncSet,
    applySyncSetToExistingDrones,
  };
}
