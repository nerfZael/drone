import React from 'react';
import type { StartupSeedState } from './app-types';
import type { DroneSummary } from '../types';
import { isDroneStartingOrSeeding } from './helpers';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type UseDroneMutationActionsArgs = {
  drones: DroneSummary[];
  autoDelete: boolean;
  requestJson: RequestJsonFn;
  optimisticallyDeletedDrones: Record<string, boolean>;
  setOptimisticallyDeletedDrones: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  setStartupSeedByDrone: React.Dispatch<
    React.SetStateAction<Record<string, StartupSeedState>>
  >;
  onNameSuggestionFailure: (error: unknown) => void;
};

export function useDroneMutationActions({
  drones,
  autoDelete,
  requestJson,
  optimisticallyDeletedDrones,
  setOptimisticallyDeletedDrones,
  setStartupSeedByDrone,
  onNameSuggestionFailure,
}: UseDroneMutationActionsArgs) {
  const [deletingDrones, setDeletingDrones] = React.useState<Record<string, boolean>>(
    {},
  );
  const [renamingDrones, setRenamingDrones] = React.useState<Record<string, boolean>>(
    {},
  );
  const [settingBaseImages, setSettingBaseImages] = React.useState<Record<string, boolean>>(
    {},
  );

  const shouldConfirmDelete = React.useCallback((): boolean => !autoDelete, [autoDelete]);

  const renameDroneTo = React.useCallback(
    async (
      droneIdRaw: string,
      newNameRaw: string,
      opts?: { showAlert?: boolean; migrateVolumeName?: boolean },
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const droneId = String(droneIdRaw ?? '').trim();
      const newName = String(newNameRaw ?? '').trim();
      const current = drones.find((d) => d.id === droneId) ?? null;
      const currentName = String(current?.name ?? '').trim() || droneId;
      if (!droneId || !newName || newName === currentName) {
        return { ok: false, error: 'no-op rename' };
      }
      if (!current || isDroneStartingOrSeeding(current.hubPhase)) {
        return { ok: false, error: `drone "${droneId}" is still starting` };
      }
      if (deletingDrones[droneId] || renamingDrones[droneId] || settingBaseImages[droneId]) {
        return { ok: false, error: 'rename busy' };
      }
      if (newName.length > 80 || /[\r\n]/.test(newName)) {
        if (opts?.showAlert) {
          window.alert('Invalid drone name. Must be 1-80 chars and cannot contain newlines.');
        }
        return { ok: false, error: 'invalid new name' };
      }
      if (drones.some((d) => d.name === newName && d.id !== droneId)) {
        if (opts?.showAlert) window.alert(`A drone named "${newName}" already exists.`);
        return { ok: false, error: 'name already exists' };
      }

      setRenamingDrones((prev) => ({ ...prev, [droneId]: true }));
      try {
        await requestJson<{ ok: true; id: string; oldName: string; newName: string }>(
          `/api/drones/${encodeURIComponent(droneId)}/rename`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              newName,
              ...(opts?.migrateVolumeName ? { migrateVolumeName: true } : {}),
            }),
          },
        );
        setStartupSeedByDrone((prev) => {
          const existing = prev[droneId];
          if (!existing) return prev;
          if (existing.droneName === newName) return prev;
          return { ...prev, [droneId]: { ...existing, droneName: newName } };
        });
        return { ok: true };
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (!/still starting/i.test(msg)) {
          console.error('[DroneHub] rename drone failed', { id: droneId, newName, error: e });
        }
        if (opts?.showAlert) {
          window.alert(`Rename failed: ${msg}`);
        }
        return { ok: false, error: msg };
      } finally {
        setRenamingDrones((prev) => {
          if (!prev[droneId]) return prev;
          const next = { ...prev };
          delete next[droneId];
          return next;
        });
      }
    },
    [deletingDrones, drones, renamingDrones, requestJson, setStartupSeedByDrone, settingBaseImages],
  );

  const deleteDrone = React.useCallback(
    async (droneIdRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      const droneName = String(drones.find((d) => d.id === droneId)?.name ?? '').trim() || droneId;
      if (
        deletingDrones[droneId] ||
        renamingDrones[droneId] ||
        settingBaseImages[droneId] ||
        optimisticallyDeletedDrones[droneId]
      ) {
        return;
      }
      if (shouldConfirmDelete()) {
        const ok = window.confirm(
          `Are you sure you want to delete drone "${droneName}"?\n\nThis will remove the container and remove it from your registry.`,
        );
        if (!ok) return;
      }
      setOptimisticallyDeletedDrones((prev) => ({ ...prev, [droneId]: true }));
      setDeletingDrones((prev) => ({ ...prev, [droneId]: true }));
      try {
        await requestJson(`/api/drones/${encodeURIComponent(droneId)}`, { method: 'DELETE' });
      } catch (e: any) {
        console.error('[DroneHub] delete drone failed', { id: droneId, error: e });
        setOptimisticallyDeletedDrones((prev) => {
          if (!prev[droneId]) return prev;
          const next = { ...prev };
          delete next[droneId];
          return next;
        });
      } finally {
        setDeletingDrones((prev) => {
          if (!prev[droneId]) return prev;
          const next = { ...prev };
          delete next[droneId];
          return next;
        });
      }
    },
    [
      deletingDrones,
      drones,
      optimisticallyDeletedDrones,
      renamingDrones,
      settingBaseImages,
      requestJson,
      setOptimisticallyDeletedDrones,
      shouldConfirmDelete,
    ],
  );

  const renameDrone = React.useCallback(
    async (droneIdRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      if (deletingDrones[droneId] || renamingDrones[droneId] || settingBaseImages[droneId]) return;
      const currentName = String(drones.find((d) => d.id === droneId)?.name ?? '').trim() || droneId;
      const suggested = String(window.prompt(`Rename drone "${currentName}" to:`, currentName) ?? '').trim();
      if (!suggested || suggested === currentName) return;
      const renamed = await renameDroneTo(droneId, suggested, { showAlert: true });
      if (!renamed.ok) return;
    },
    [deletingDrones, drones, renamingDrones, renameDroneTo, settingBaseImages],
  );

  const setDroneBaseImage = React.useCallback(
    async (droneIdRaw: string): Promise<void> => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      const current = drones.find((d) => d.id === droneId) ?? null;
      const droneName = String(current?.name ?? '').trim() || droneId;
      if (!current || isDroneStartingOrSeeding(current.hubPhase)) {
        window.alert(`Drone "${droneName}" is still starting.`);
        return;
      }
      if (
        deletingDrones[droneId] ||
        renamingDrones[droneId] ||
        settingBaseImages[droneId] ||
        optimisticallyDeletedDrones[droneId]
      ) {
        return;
      }
      const ok = window.confirm(
        `Set "${droneName}" as the base image for new containers?\n\nThis will commit the current drone container into a new Docker image and update your DVM base config (same as: dvm base set).\n\nContinue?`,
      );
      if (!ok) return;

      setSettingBaseImages((prev) => ({ ...prev, [droneId]: true }));
      try {
        const r = await requestJson<{ ok: true; id: string; name: string; containerName: string; baseImage?: string | null }>(
          `/api/drones/${encodeURIComponent(droneId)}/base-image`,
          { method: 'POST' },
        );
        const img = String((r as any)?.baseImage ?? '').trim();
        window.alert(img ? `Base image set: ${img}` : 'Base image set.');
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.error('[DroneHub] set base image failed', { id: droneId, error: e });
        window.alert(`Set base image failed: ${msg}`);
      } finally {
        setSettingBaseImages((prev) => {
          if (!prev[droneId]) return prev;
          const next = { ...prev };
          delete next[droneId];
          return next;
        });
      }
    },
    [deletingDrones, drones, optimisticallyDeletedDrones, renamingDrones, requestJson, settingBaseImages],
  );

  const suggestAndRenameDraftDrone = React.useCallback(
    async (droneIdRaw: string, promptRaw: string): Promise<void> => {
      const droneId = String(droneIdRaw ?? '').trim();
      const prompt = String(promptRaw ?? '').trim();
      if (!droneId || !prompt) return;
      try {
        const data = await requestJson<{ ok: true; name: string }>(
          '/api/drones/name-from-message',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message: prompt }),
          },
        );
        const base = String((data as any)?.name ?? '').trim();
        if (!base) return;

        const currentName = String(drones.find((d) => d.id === droneId)?.name ?? '').trim();
        if (currentName && base === currentName) return;

        const makeCandidate = (n: number) => {
          const suffix = n <= 1 ? '' : ` (${n})`;
          const raw = `${base}${suffix}`.trim();
          if (!raw) return '';
          if (raw.length > 80) return raw.slice(0, 80).trim();
          return raw;
        };

        for (let attempt = 1; attempt <= 6; attempt += 1) {
          const candidate = makeCandidate(attempt);
          if (!candidate) return;
          if (candidate.length > 80 || /[\r\n]/.test(candidate)) return;
          const renamed = await renameDroneTo(droneId, candidate);
          if (renamed.ok) return;
          const msg = String(renamed.error ?? '').toLowerCase();
          const nameConflict =
            msg.includes('already exists') ||
            msg.includes('pending') ||
            msg.includes('cannot rename');
          if (nameConflict) continue;
          const retriable =
            msg.includes('rename busy');
          if (!retriable) return;
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, Math.min(1800, 240 + attempt * 140)),
          );
        }
      } catch (e: any) {
        console.error('[DroneHub] draft auto-rename skipped', {
          id: droneId,
          error: e?.message ?? String(e),
        });
        onNameSuggestionFailure(e);
      }
    },
    [drones, onNameSuggestionFailure, renameDroneTo, requestJson],
  );

  return {
    deletingDrones,
    renamingDrones,
    settingBaseImages,
    deleteDrone,
    renameDrone,
    setDroneBaseImage,
    renameDroneTo,
    suggestAndRenameDraftDrone,
  };
}

