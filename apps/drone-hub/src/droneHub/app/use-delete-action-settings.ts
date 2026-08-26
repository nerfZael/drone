import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ArchiveRuntimePolicy,
  ArchiveRetentionId,
  ArchivedChatsResponse,
  ArchivedDronesResponse,
  DeleteActionSettingsResponse,
  DroneDeleteMode,
} from './settings-types';
import { settingsErrorMessage, settingsQueryError, settingsQueryKey, useSettingsPostMutation, useSettingsQuery } from './settings-query';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseDeleteActionSettingsResult = ReturnType<typeof useDeleteActionSettings>;

export function useDeleteActionSettings(
  requestJson: RequestJsonFn,
  options: { archiveEnabled?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const deleteSettingsKey = settingsQueryKey('delete-action');
  const archivedDronesKey = settingsQueryKey('archive', 'drones');
  const archivedChatsKey = settingsQueryKey('archive', 'chats');
  const deleteSettingsQuery = useSettingsQuery<DeleteActionSettingsResponse>(
    requestJson,
    deleteSettingsKey,
    '/api/settings/delete-action',
  );
  const archivedDronesQuery = useSettingsQuery<ArchivedDronesResponse>(requestJson, archivedDronesKey, '/api/archive/drones', options.archiveEnabled ?? true);
  const archivedChatsQuery = useSettingsQuery<ArchivedChatsResponse>(requestJson, archivedChatsKey, '/api/archive/chats', options.archiveEnabled ?? true);
  const [deleteSettingsError, setDeleteSettingsError] = React.useState<string | null>(null);
  const [deleteSettingsNotice, setDeleteSettingsNotice] = React.useState<string | null>(null);
  const [deleteModeDraft, setDeleteModeDraft] = React.useState<DroneDeleteMode>('permanent');
  const [archiveRetentionDraft, setArchiveRetentionDraft] = React.useState<ArchiveRetentionId>('1d');
  const [archiveRuntimePolicyDraft, setArchiveRuntimePolicyDraft] = React.useState<ArchiveRuntimePolicy>('keep-running');

  const [archivedDronesError, setArchivedDronesError] = React.useState<string | null>(null);
  const [archivedChatsError, setArchivedChatsError] = React.useState<string | null>(null);
  const [archiveNotice, setArchiveNotice] = React.useState<string | null>(null);
  const [restoringArchivedById, setRestoringArchivedById] = React.useState<Record<string, boolean>>({});
  const [deletingArchivedById, setDeletingArchivedById] = React.useState<Record<string, boolean>>({});
  const [restoringArchivedChatByKey, setRestoringArchivedChatByKey] = React.useState<Record<string, boolean>>({});
  const [deletingArchivedChatByKey, setDeletingArchivedChatByKey] = React.useState<Record<string, boolean>>({});

  const applyDeleteSettings = React.useCallback((data: DeleteActionSettingsResponse) => {
    setDeleteModeDraft(data.deleteAction.mode);
    setArchiveRetentionDraft(data.deleteAction.archiveRetention);
    setArchiveRuntimePolicyDraft(data.deleteAction.archiveRuntimePolicy ?? 'keep-running');
  }, []);

  React.useEffect(() => {
    if (deleteSettingsQuery.data) applyDeleteSettings(deleteSettingsQuery.data);
  }, [applyDeleteSettings, deleteSettingsQuery.data]);

  const loadDeleteSettings = React.useCallback(async () => {
    setDeleteSettingsError(null);
    const { data } = await deleteSettingsQuery.refetch();
    if (data) applyDeleteSettings(data);
  }, [applyDeleteSettings, deleteSettingsQuery.refetch]);

  const loadArchivedDrones = React.useCallback(async () => {
    setArchivedDronesError(null);
    await archivedDronesQuery.refetch();
  }, [archivedDronesQuery.refetch]);

  const loadArchivedChats = React.useCallback(async () => {
    setArchivedChatsError(null);
    await archivedChatsQuery.refetch();
  }, [archivedChatsQuery.refetch]);

  const saveMutation = useSettingsPostMutation<
    DeleteActionSettingsResponse,
    { mode: DroneDeleteMode; archiveRetention: ArchiveRetentionId; archiveRuntimePolicy: ArchiveRuntimePolicy }
  >(requestJson, '/api/settings/delete-action');

  const saveDeleteSettings = React.useCallback(async () => {
    setDeleteSettingsError(null);
    setDeleteSettingsNotice(null);
    try {
      const data = await saveMutation.mutateAsync({
        mode: deleteModeDraft,
        archiveRetention: archiveRetentionDraft,
        archiveRuntimePolicy: archiveRuntimePolicyDraft,
      });
      queryClient.setQueryData(deleteSettingsKey, data);
      applyDeleteSettings(data);
      setDeleteSettingsNotice(
        data.deleteAction.mode === 'archive'
          ? `Trash now archives drones and chats (${data.deleteAction.archiveRuntimePolicy === 'stop' ? 'stop drones on archive' : 'keep archived drones running'}). Auto-delete after ${data.deleteAction.archiveRetention}.`
          : 'Trash now permanently deletes drones and chats.',
      );
    } catch (error) {
      setDeleteSettingsError(settingsErrorMessage(error));
    }
  }, [applyDeleteSettings, archiveRetentionDraft, archiveRuntimePolicyDraft, deleteModeDraft, deleteSettingsKey, queryClient, saveMutation]);

  const restoreArchivedDrone = React.useCallback(
    async (droneIdRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      if (restoringArchivedById[droneId] || deletingArchivedById[droneId]) return;
      setRestoringArchivedById((prev) => ({ ...prev, [droneId]: true }));
      setArchiveNotice(null);
      setArchivedDronesError(null);
      try {
        await requestJson(`/api/archive/drones/${encodeURIComponent(droneId)}/restore`, {
          method: 'POST',
        });
        setArchiveNotice('Drone restored from archive.');
        await loadArchivedDrones();
        await loadArchivedChats();
      } catch (e: any) {
        setArchivedDronesError(e?.message ?? String(e));
      } finally {
        setRestoringArchivedById((prev) => {
          if (!prev[droneId]) return prev;
          const next = { ...prev };
          delete next[droneId];
          return next;
        });
      }
    },
    [deletingArchivedById, loadArchivedChats, loadArchivedDrones, requestJson, restoringArchivedById],
  );

  const permanentlyDeleteArchivedDrone = React.useCallback(
    async (droneIdRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      if (deletingArchivedById[droneId] || restoringArchivedById[droneId]) return;
      const ok = window.confirm(
        'Permanently delete this archived drone now?\n\nThis removes the container and cannot be undone.',
      );
      if (!ok) return;
      setDeletingArchivedById((prev) => ({ ...prev, [droneId]: true }));
      setArchiveNotice(null);
      setArchivedDronesError(null);
      try {
        await requestJson(`/api/archive/drones/${encodeURIComponent(droneId)}`, {
          method: 'DELETE',
        });
        setArchiveNotice('Archived drone permanently deleted.');
        await loadArchivedDrones();
        await loadArchivedChats();
      } catch (e: any) {
        setArchivedDronesError(e?.message ?? String(e));
      } finally {
        setDeletingArchivedById((prev) => {
          if (!prev[droneId]) return prev;
          const next = { ...prev };
          delete next[droneId];
          return next;
        });
      }
    },
    [deletingArchivedById, loadArchivedChats, loadArchivedDrones, requestJson, restoringArchivedById],
  );

  const archivedChatKey = React.useCallback((droneIdRaw: string, chatNameRaw: string): string => {
    const droneId = String(droneIdRaw ?? '').trim();
    const chatName = String(chatNameRaw ?? '').trim();
    return droneId && chatName ? `${droneId}\u0000${chatName}` : '';
  }, []);

  const restoreArchivedChat = React.useCallback(
    async (droneIdRaw: string, chatNameRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      const chatName = String(chatNameRaw ?? '').trim();
      const key = archivedChatKey(droneId, chatName);
      if (!key) return;
      if (restoringArchivedChatByKey[key] || deletingArchivedChatByKey[key]) return;
      setRestoringArchivedChatByKey((prev) => ({ ...prev, [key]: true }));
      setArchiveNotice(null);
      setArchivedChatsError(null);
      try {
        const data = await requestJson<{ chat?: string; renamed?: boolean }>(
          `/api/archive/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/restore`,
          { method: 'POST' },
        );
        const restoredChat = String(data?.chat ?? chatName).trim() || chatName;
        setArchiveNotice(
          data?.renamed
            ? `Chat restored as "${restoredChat}" on ${droneId}.`
            : `Chat "${restoredChat}" restored on ${droneId}.`,
        );
        await loadArchivedChats();
      } catch (e: any) {
        setArchivedChatsError(e?.message ?? String(e));
      } finally {
        setRestoringArchivedChatByKey((prev) => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [archivedChatKey, deletingArchivedChatByKey, loadArchivedChats, requestJson, restoringArchivedChatByKey],
  );

  const permanentlyDeleteArchivedChat = React.useCallback(
    async (droneIdRaw: string, chatNameRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      const chatName = String(chatNameRaw ?? '').trim();
      const key = archivedChatKey(droneId, chatName);
      if (!key) return;
      if (deletingArchivedChatByKey[key] || restoringArchivedChatByKey[key]) return;
      const ok = window.confirm(
        `Permanently delete archived chat "${chatName}" from "${droneId}" now?\n\nThis cannot be undone.`,
      );
      if (!ok) return;
      setDeletingArchivedChatByKey((prev) => ({ ...prev, [key]: true }));
      setArchiveNotice(null);
      setArchivedChatsError(null);
      try {
        await requestJson(`/api/archive/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}`, {
          method: 'DELETE',
        });
        setArchiveNotice(`Archived chat "${chatName}" permanently deleted.`);
        await loadArchivedChats();
      } catch (e: any) {
        setArchivedChatsError(e?.message ?? String(e));
      } finally {
        setDeletingArchivedChatByKey((prev) => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [archivedChatKey, deletingArchivedChatByKey, loadArchivedChats, requestJson, restoringArchivedChatByKey],
  );

  return {
    deleteSettings: deleteSettingsQuery.data ?? null,
    deleteSettingsLoading: deleteSettingsQuery.isFetching,
    deleteSettingsError: settingsQueryError(deleteSettingsError, false, deleteSettingsQuery),
    deleteSettingsNotice,
    deleteModeDraft,
    archiveRetentionDraft,
    archiveRuntimePolicyDraft,
    savingDeleteSettings: saveMutation.isPending,
    archivedDrones: archivedDronesQuery.data ?? null,
    archivedDronesLoading: archivedDronesQuery.isFetching,
    archivedDronesError: settingsQueryError(archivedDronesError, false, archivedDronesQuery),
    archivedChats: archivedChatsQuery.data ?? null,
    archivedChatsLoading: archivedChatsQuery.isFetching,
    archivedChatsError: settingsQueryError(archivedChatsError, false, archivedChatsQuery),
    archiveNotice,
    restoringArchivedById,
    deletingArchivedById,
    restoringArchivedChatByKey,
    deletingArchivedChatByKey,
    setDeleteModeDraft,
    setArchiveRetentionDraft,
    setArchiveRuntimePolicyDraft,
    loadDeleteSettings,
    loadArchivedDrones,
    loadArchivedChats,
    saveDeleteSettings,
    restoreArchivedDrone,
    permanentlyDeleteArchivedDrone,
    restoreArchivedChat,
    permanentlyDeleteArchivedChat,
  };
}
