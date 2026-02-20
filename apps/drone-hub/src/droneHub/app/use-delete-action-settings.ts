import React from 'react';
import type {
  ArchiveRuntimePolicy,
  ArchiveRetentionId,
  ArchivedDronesResponse,
  DeleteActionSettingsResponse,
  DroneDeleteMode,
} from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseDeleteActionSettingsResult = {
  deleteSettings: DeleteActionSettingsResponse | null;
  deleteSettingsLoading: boolean;
  deleteSettingsError: string | null;
  deleteSettingsNotice: string | null;
  deleteModeDraft: DroneDeleteMode;
  archiveRetentionDraft: ArchiveRetentionId;
  archiveRuntimePolicyDraft: ArchiveRuntimePolicy;
  savingDeleteSettings: boolean;
  archivedDrones: ArchivedDronesResponse | null;
  archivedDronesLoading: boolean;
  archivedDronesError: string | null;
  archiveNotice: string | null;
  restoringArchivedById: Record<string, boolean>;
  deletingArchivedById: Record<string, boolean>;
  setDeleteModeDraft: React.Dispatch<React.SetStateAction<DroneDeleteMode>>;
  setArchiveRetentionDraft: React.Dispatch<React.SetStateAction<ArchiveRetentionId>>;
  setArchiveRuntimePolicyDraft: React.Dispatch<React.SetStateAction<ArchiveRuntimePolicy>>;
  loadDeleteSettings: () => Promise<void>;
  loadArchivedDrones: () => Promise<void>;
  saveDeleteSettings: () => Promise<void>;
  restoreArchivedDrone: (droneId: string) => Promise<void>;
  permanentlyDeleteArchivedDrone: (droneId: string) => Promise<void>;
};

export function useDeleteActionSettings(requestJson: RequestJsonFn): UseDeleteActionSettingsResult {
  const [deleteSettings, setDeleteSettings] = React.useState<DeleteActionSettingsResponse | null>(null);
  const [deleteSettingsLoading, setDeleteSettingsLoading] = React.useState(false);
  const [deleteSettingsError, setDeleteSettingsError] = React.useState<string | null>(null);
  const [deleteSettingsNotice, setDeleteSettingsNotice] = React.useState<string | null>(null);
  const [deleteModeDraft, setDeleteModeDraft] = React.useState<DroneDeleteMode>('permanent');
  const [archiveRetentionDraft, setArchiveRetentionDraft] = React.useState<ArchiveRetentionId>('1d');
  const [archiveRuntimePolicyDraft, setArchiveRuntimePolicyDraft] = React.useState<ArchiveRuntimePolicy>('keep-running');
  const [savingDeleteSettings, setSavingDeleteSettings] = React.useState(false);

  const [archivedDrones, setArchivedDrones] = React.useState<ArchivedDronesResponse | null>(null);
  const [archivedDronesLoading, setArchivedDronesLoading] = React.useState(false);
  const [archivedDronesError, setArchivedDronesError] = React.useState<string | null>(null);
  const [archiveNotice, setArchiveNotice] = React.useState<string | null>(null);
  const [restoringArchivedById, setRestoringArchivedById] = React.useState<Record<string, boolean>>({});
  const [deletingArchivedById, setDeletingArchivedById] = React.useState<Record<string, boolean>>({});

  const loadDeleteSettings = React.useCallback(async () => {
    setDeleteSettingsLoading(true);
    setDeleteSettingsError(null);
    try {
      const data = await requestJson<DeleteActionSettingsResponse>('/api/settings/delete-action');
      setDeleteSettings(data);
      setDeleteModeDraft(data.deleteAction.mode);
      setArchiveRetentionDraft(data.deleteAction.archiveRetention);
      setArchiveRuntimePolicyDraft(data.deleteAction.archiveRuntimePolicy ?? 'keep-running');
    } catch (e: any) {
      setDeleteSettingsError(e?.message ?? String(e));
    } finally {
      setDeleteSettingsLoading(false);
    }
  }, [requestJson]);

  const loadArchivedDrones = React.useCallback(async () => {
    setArchivedDronesLoading(true);
    setArchivedDronesError(null);
    try {
      const data = await requestJson<ArchivedDronesResponse>('/api/archive/drones');
      setArchivedDrones(data);
    } catch (e: any) {
      setArchivedDronesError(e?.message ?? String(e));
    } finally {
      setArchivedDronesLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void loadDeleteSettings();
    void loadArchivedDrones();
  }, [loadDeleteSettings, loadArchivedDrones]);

  const saveDeleteSettings = React.useCallback(async () => {
    setSavingDeleteSettings(true);
    setDeleteSettingsError(null);
    setDeleteSettingsNotice(null);
    try {
      const data = await requestJson<DeleteActionSettingsResponse>('/api/settings/delete-action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: deleteModeDraft,
          archiveRetention: archiveRetentionDraft,
          archiveRuntimePolicy: archiveRuntimePolicyDraft,
        }),
      });
      setDeleteSettings(data);
      setDeleteModeDraft(data.deleteAction.mode);
      setArchiveRetentionDraft(data.deleteAction.archiveRetention);
      setArchiveRuntimePolicyDraft(data.deleteAction.archiveRuntimePolicy ?? 'keep-running');
      setDeleteSettingsNotice(
        data.deleteAction.mode === 'archive'
          ? `Trash now archives drones (${data.deleteAction.archiveRuntimePolicy === 'stop' ? 'stop on archive' : 'keep running'}). Auto-delete after ${data.deleteAction.archiveRetention}.`
          : 'Trash now permanently deletes drones.',
      );
    } catch (e: any) {
      setDeleteSettingsError(e?.message ?? String(e));
    } finally {
      setSavingDeleteSettings(false);
    }
  }, [archiveRetentionDraft, archiveRuntimePolicyDraft, deleteModeDraft, requestJson]);

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
    [deletingArchivedById, loadArchivedDrones, requestJson, restoringArchivedById],
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
    [deletingArchivedById, loadArchivedDrones, requestJson, restoringArchivedById],
  );

  return {
    deleteSettings,
    deleteSettingsLoading,
    deleteSettingsError,
    deleteSettingsNotice,
    deleteModeDraft,
    archiveRetentionDraft,
    archiveRuntimePolicyDraft,
    savingDeleteSettings,
    archivedDrones,
    archivedDronesLoading,
    archivedDronesError,
    archiveNotice,
    restoringArchivedById,
    deletingArchivedById,
    setDeleteModeDraft,
    setArchiveRetentionDraft,
    setArchiveRuntimePolicyDraft,
    loadDeleteSettings,
    loadArchivedDrones,
    saveDeleteSettings,
    restoreArchivedDrone,
    permanentlyDeleteArchivedDrone,
  };
}
