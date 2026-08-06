import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { SyncSetApplyResponse, SyncSetsResponse, SyncSetSourceType } from './settings-types';
import { settingsErrorMessage, settingsQueryError, settingsQueryKey, useSettingsQuery } from './settings-query';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;
type SyncSetMutation =
  | { action: 'create'; draft: ReturnType<typeof normalizeDraft> }
  | { action: 'update'; id: string; draft: ReturnType<typeof normalizeDraft> }
  | { action: 'delete'; id: string };

export type SyncSetDraftInput = {
  label: string;
  sourceType: SyncSetSourceType;
  sourcePath: string;
  targetPath: string;
  applyToHost: boolean;
};

export type UseSyncSetsResult = ReturnType<typeof useSyncSets>;

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

export function useSyncSets(requestJson: RequestJsonFn) {
  const queryClient = useQueryClient();
  const queryKey = settingsQueryKey('sync-sets');
  const query = useSettingsQuery<SyncSetsResponse>(requestJson, queryKey, '/api/settings/sync-sets');
  const [syncSetsError, setSyncSetsError] = React.useState<string | null>(null);
  const [syncSetsNotice, setSyncSetsNotice] = React.useState<string | null>(null);

  const loadSyncSets = React.useCallback(async () => {
    setSyncSetsError(null);
    await query.refetch();
  }, [query.refetch]);

  const mutation = useMutation({
    mutationFn: (input: SyncSetMutation) => {
      if (input.action === 'create') {
        return requestJson<SyncSetsResponse>('/api/settings/sync-sets', jsonRequest('POST', input.draft));
      }
      const url = `/api/settings/sync-sets/${encodeURIComponent(input.id)}`;
      return requestJson<SyncSetsResponse>(
        url,
        input.action === 'update' ? jsonRequest('PATCH', input.draft) : { method: 'DELETE' },
      );
    },
  });
  const applyMutation = useMutation({
    mutationFn: (id: string) =>
      requestJson<SyncSetApplyResponse>(`/api/settings/sync-sets/${encodeURIComponent(id)}/apply`, {
        method: 'POST',
      }),
  });

  const applyResponse = React.useCallback((data: SyncSetsResponse) => {
    queryClient.setQueryData(queryKey, {
      ...data,
      syncSets: Array.isArray(data.syncSets) ? data.syncSets : [],
    });
  }, [queryClient, queryKey]);

  const createSyncSet = React.useCallback(
    async (draft: SyncSetDraftInput) => {
      const next = normalizeDraft(draft);
      setSyncSetsError(null);
      setSyncSetsNotice(null);
      try {
        const data = await mutation.mutateAsync({ action: 'create', draft: next });
        applyResponse(data);
        setSyncSetsNotice(`Created sync set ${next.label}.`);
        return true;
      } catch (error) {
        setSyncSetsError(settingsErrorMessage(error));
        return false;
      }
    },
    [applyResponse, mutation],
  );

  const updateSyncSet = React.useCallback(
    async (syncSetIdRaw: string, draft: SyncSetDraftInput) => {
      const syncSetId = String(syncSetIdRaw ?? '').trim();
      if (!syncSetId) return false;
      const next = normalizeDraft(draft);
      setSyncSetsError(null);
      setSyncSetsNotice(null);
      try {
        const data = await mutation.mutateAsync({ action: 'update', id: syncSetId, draft: next });
        applyResponse(data);
        setSyncSetsNotice(`Saved sync set ${next.label}.`);
        return true;
      } catch (error) {
        setSyncSetsError(settingsErrorMessage(error));
        return false;
      }
    },
    [applyResponse, mutation],
  );

  const deleteSyncSet = React.useCallback(
    async (syncSetIdRaw: string, label?: string | null) => {
      const syncSetId = String(syncSetIdRaw ?? '').trim();
      if (!syncSetId) return false;
      setSyncSetsError(null);
      setSyncSetsNotice(null);
      try {
        const data = await mutation.mutateAsync({ action: 'delete', id: syncSetId });
        applyResponse(data);
        setSyncSetsNotice(`Deleted sync set ${String(label ?? syncSetId).trim() || syncSetId}.`);
        return true;
      } catch (error) {
        setSyncSetsError(settingsErrorMessage(error));
        return false;
      }
    },
    [applyResponse, mutation],
  );

  const applySyncSetToExistingDrones = React.useCallback(
    async (syncSetIdRaw: string, label?: string | null) => {
      const syncSetId = String(syncSetIdRaw ?? '').trim();
      if (!syncSetId) return false;
      setSyncSetsError(null);
      setSyncSetsNotice(null);
      try {
        const data = await applyMutation.mutateAsync(syncSetId);
        if (data.syncSet) {
          queryClient.setQueryData<SyncSetsResponse>(queryKey, (current) => ({
            ok: true,
            updatedAt: current?.updatedAt ?? null,
            syncSets: (current?.syncSets ?? []).map((item) => (item.id === syncSetId ? data.syncSet! : item)),
          }));
        } else {
          await loadSyncSets();
        }
        setSyncSetsNotice(formatApplyNotice(String(label ?? data.syncSet?.label ?? syncSetId).trim(), data));
        return true;
      } catch (error) {
        setSyncSetsError(settingsErrorMessage(error));
        return false;
      }
    },
    [applyMutation, loadSyncSets, queryClient, queryKey],
  );

  const pending = mutation.isPending ? mutation.variables : null;
  const syncSets = Array.isArray(query.data?.syncSets) ? query.data.syncSets : [];

  return {
    syncSets,
    syncSetsLoading: query.isFetching,
    syncSetsError: settingsQueryError(syncSetsError, false, query),
    syncSetsNotice,
    creatingSyncSet: pending?.action === 'create',
    savingSyncSetId: pending?.action === 'update' ? pending.id : null,
    deletingSyncSetId: pending?.action === 'delete' ? pending.id : null,
    applyingSyncSetId: applyMutation.isPending ? applyMutation.variables : null,
    loadSyncSets,
    createSyncSet,
    updateSyncSet,
    deleteSyncSet,
    applySyncSetToExistingDrones,
  };
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
