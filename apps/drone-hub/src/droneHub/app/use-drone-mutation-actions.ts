import React from 'react';
import type { StartupSeedState } from './app-types';
import type { DroneSummary } from '../types';
import { isDroneStartingOrSeeding } from './helpers';
import { parseCanvasChatNodeId } from './app-config';
import type { DroneDeleteMode } from './settings-types';
import { useDroneCanvasStore } from '../canvas/use-drone-canvas-store';
import { droneRenameErrorMessage, type DroneRenameTarget } from './drone-rename';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type UseDroneMutationActionsArgs = {
  drones: DroneSummary[];
  autoDelete: boolean;
  deleteMode: DroneDeleteMode;
  requestJson: RequestJsonFn;
  optimisticallyDeletedDrones: Record<string, boolean>;
  setOptimisticallyDeletedDrones: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  setStartupSeedByDrone: React.Dispatch<
    React.SetStateAction<Record<string, StartupSeedState>>
  >;
  setOptimisticallyRenamedDrones: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  onNameSuggestionFailure: (error: unknown) => void;
};

export function useDroneMutationActions({
  drones,
  autoDelete,
  deleteMode,
  requestJson,
  optimisticallyDeletedDrones,
  setOptimisticallyDeletedDrones,
  setStartupSeedByDrone,
  setOptimisticallyRenamedDrones,
  onNameSuggestionFailure,
}: UseDroneMutationActionsArgs) {
  const [deletingDrones, setDeletingDrones] = React.useState<Record<string, boolean>>(
    {},
  );
  const [renamingDrones, setRenamingDrones] = React.useState<Record<string, boolean>>(
    {},
  );
  const [renameDroneTarget, setRenameDroneTarget] = React.useState<DroneRenameTarget | null>(
    null,
  );
  const renameDroneLaunchRef = React.useRef(false);
  const [settingBaseImages, setSettingBaseImages] = React.useState<Record<string, boolean>>(
    {},
  );
  const dronesRef = React.useRef(drones);
  React.useEffect(() => {
    dronesRef.current = drones;
  }, [drones]);

  const shouldConfirmDelete = React.useCallback((): boolean => !autoDelete, [autoDelete]);

  const renameDroneTo = React.useCallback(
    async (
      droneIdRaw: string,
      newNameRaw: string,
      opts?: {
        showAlert?: boolean;
        migrateVolumeName?: boolean;
        expectedName?: string;
        source?: string;
        attempt?: number;
        suggestedBase?: string;
      },
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const droneId = String(droneIdRaw ?? '').trim();
      const newName = String(newNameRaw ?? '').trim();
      const currentDrones = dronesRef.current;
      const current = currentDrones.find((d) => d.id === droneId) ?? null;
      const currentName = String(current?.name ?? '').trim() || droneId;
      if (!droneId || !newName || newName === currentName) {
        return { ok: false, error: 'no-op rename' };
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
      if (currentDrones.some((d) => d.name === newName && d.id !== droneId)) {
        if (opts?.showAlert) window.alert(`A drone named "${newName}" already exists.`);
        return { ok: false, error: 'name already exists' };
      }

      setRenamingDrones((prev) => ({ ...prev, [droneId]: true }));
      try {
        const renamed = await requestJson<{ ok: true; id: string; oldName: string; newName: string }>(
          `/api/drones/${encodeURIComponent(droneId)}/rename`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              newName,
              ...(opts?.migrateVolumeName ? { migrateVolumeName: true } : {}),
              ...(typeof opts?.expectedName === 'string' && opts.expectedName.trim()
                ? { expectedName: opts.expectedName.trim() }
                : {}),
              ...(typeof opts?.source === 'string' && opts.source.trim()
                ? { source: opts.source.trim().slice(0, 64) }
                : {}),
              ...(typeof opts?.attempt === 'number' && Number.isFinite(opts.attempt) && opts.attempt > 0
                ? { attempt: Math.floor(opts.attempt) }
                : {}),
              ...(typeof opts?.suggestedBase === 'string' && opts.suggestedBase.trim()
                ? { suggestedBase: opts.suggestedBase.trim().slice(0, 80) }
                : {}),
            }),
          },
        );
        const confirmedName = String(renamed?.newName ?? newName).trim() || newName;
        setOptimisticallyRenamedDrones((prev) => ({
          ...prev,
          [droneId]: confirmedName,
        }));
        setStartupSeedByDrone((prev) => {
          const existing = prev[droneId];
          if (!existing) return prev;
          if (existing.droneName === newName) return prev;
          return { ...prev, [droneId]: { ...existing, droneName: newName } };
        });
        return { ok: true };
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (!/still starting|rename precondition failed/i.test(msg)) {
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
    [
      deletingDrones,
      renamingDrones,
      requestJson,
      setOptimisticallyRenamedDrones,
      setStartupSeedByDrone,
      settingBaseImages,
    ],
  );

  const deleteDrone = React.useCallback(
    async (droneIdRaw: string, opts?: { confirmed?: boolean; showAlert?: boolean }): Promise<boolean> => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return false;
      const droneName = String(drones.find((d) => d.id === droneId)?.name ?? '').trim() || droneId;
      const guardState = {
        deleting: Boolean(deletingDrones[droneId]),
        renaming: Boolean(renamingDrones[droneId]),
        settingBaseImage: Boolean(settingBaseImages[droneId]),
        optimisticallyDeleted: Boolean(optimisticallyDeletedDrones[droneId]),
      };
      if (
        guardState.deleting ||
        guardState.renaming ||
        guardState.settingBaseImage ||
        guardState.optimisticallyDeleted
      ) {
        console.warn('[DroneHub] delete drone request ignored because the drone is busy', {
          id: droneId,
          name: droneName,
          ...guardState,
        });
        return false;
      }
      if (shouldConfirmDelete() && opts?.confirmed !== true) {
        const ok = window.confirm(deleteMode === 'archive'
          ? `Archive drone "${droneName}"?\n\nThis removes it from the active list now. You can restore it from Settings > Archive before it auto-deletes.`
          : `Are you sure you want to delete drone "${droneName}"?\n\nThis will remove the container and remove it from your registry.`);
        if (!ok) return false;
      }
      setDeletingDrones((prev) => ({ ...prev, [droneId]: true }));
      try {
        if (deleteMode === 'archive') {
          await requestJson(`/api/drones/${encodeURIComponent(droneId)}/archive`, { method: 'POST' });
        } else {
          await requestJson(`/api/drones/${encodeURIComponent(droneId)}`, { method: 'DELETE' });
        }
        setOptimisticallyDeletedDrones((prev) => ({ ...prev, [droneId]: true }));
        // Keep canvas consistent with sidebar deletion/archive actions.
        const canvasState = useDroneCanvasStore.getState();
        const canvasNodeIds = Object.keys(canvasState.nodesByDroneId ?? {});
        const nodeIdsToRemove = canvasNodeIds.filter((nodeId) => {
          if (nodeId === droneId) return true;
          const ref = parseCanvasChatNodeId(nodeId);
          return Boolean(ref && ref.droneId === droneId);
        });
        if (nodeIdsToRemove.length > 0) {
          canvasState.removeNodes(nodeIdsToRemove);
        }
        return true;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.error('[DroneHub] delete drone failed', { id: droneId, error: e });
        setOptimisticallyDeletedDrones((prev) => {
          if (!prev[droneId]) return prev;
          const next = { ...prev };
          delete next[droneId];
          return next;
        });
        if (opts?.showAlert !== false) {
          window.alert(`${deleteMode === 'archive' ? 'Archive' : 'Delete'} failed: ${msg}`);
        }
        return false;
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
      deleteMode,
    ],
  );

  const renameDrone = React.useCallback(
    (droneIdRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      if (renameDroneLaunchRef.current) return;
      if (deletingDrones[droneId] || renamingDrones[droneId] || settingBaseImages[droneId]) return;
      const currentName = String(drones.find((d) => d.id === droneId)?.name ?? '').trim() || droneId;
      renameDroneLaunchRef.current = false;
      setRenameDroneTarget({ id: droneId, currentName, error: null });
    },
    [deletingDrones, drones, renamingDrones, settingBaseImages],
  );

  const closeRenameDrone = React.useCallback(() => {
    if (renameDroneLaunchRef.current) return;
    setRenameDroneTarget((current) => {
      if (current && renamingDrones[current.id]) return current;
      return null;
    });
  }, [renamingDrones]);

  const clearRenameDroneError = React.useCallback(() => {
    setRenameDroneTarget((current) =>
      current?.error ? { ...current, error: null } : current,
    );
  }, []);

  const confirmRenameDrone = React.useCallback(
    async (newNameRaw: string): Promise<boolean> => {
      const target = renameDroneTarget;
      if (!target || renameDroneLaunchRef.current) return false;
      renameDroneLaunchRef.current = true;
      setRenameDroneTarget((current) =>
        current?.id === target.id ? { ...current, error: null } : current,
      );
      try {
        const renamed = await renameDroneTo(target.id, newNameRaw, { showAlert: false });
        if (renamed.ok) {
          setRenameDroneTarget((current) => (current?.id === target.id ? null : current));
          return true;
        }
        setRenameDroneTarget((current) =>
          current?.id === target.id
            ? { ...current, error: droneRenameErrorMessage(renamed.error) }
            : current,
        );
        return false;
      } finally {
        renameDroneLaunchRef.current = false;
      }
    },
    [renameDroneTarget, renameDroneTo],
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

  const reparentDronesToParent = React.useCallback(
    async (
      parentDroneIdRaw: string | null,
      droneIdsRaw: string[],
    ): Promise<{ ok: boolean; error?: string | null; reparentedIds?: string[] }> => {
      const parentDroneId = String(parentDroneIdRaw ?? '').trim() || null;
      const dedupedDroneIds = Array.from(
        new Set(droneIdsRaw.map((item) => String(item ?? '').trim()).filter(Boolean)),
      ).filter((droneId) => !parentDroneId || droneId !== parentDroneId);
      if (dedupedDroneIds.length === 0) {
        return { ok: false, error: 'No drones selected to reparent.', reparentedIds: [] };
      }

      const currentDrones = dronesRef.current;
      const parentDrone = parentDroneId
        ? currentDrones.find((drone) => drone.id === parentDroneId) ?? null
        : null;
      if (parentDroneId && !parentDrone) {
        return { ok: false, error: `unknown drone: ${parentDroneId}`, reparentedIds: [] };
      }
      // Polling can still expose the pre-move parent while a queued follow-up
      // drag is starting. Submit every known drone so a quick move back to its
      // apparent original parent is not incorrectly treated as a no-op.
      const requestedDroneIds = dedupedDroneIds.filter((droneId) =>
        currentDrones.some((drone) => drone.id === droneId),
      );
      if (requestedDroneIds.length === 0) {
        return { ok: true, error: null, reparentedIds: [] };
      }

      const reparentedIds: string[] = [];
      const errors: string[] = [];
      for (const droneId of requestedDroneIds) {
        if (deletingDrones[droneId] || renamingDrones[droneId] || settingBaseImages[droneId]) {
          errors.push(`Drone "${droneId}" is busy.`);
          continue;
        }
        try {
          await requestJson<{ ok: true; id: string; parentId: string | null }>(
            `/api/fleet/actors/${encodeURIComponent(droneId)}/parent`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ parent: parentDroneId }),
            },
          );
          reparentedIds.push(droneId);
        } catch (error: any) {
          const message = String(error?.message ?? error ?? '').trim() || `Failed to reparent ${droneId}.`;
          errors.push(message);
        }
      }

      const targetGroupRaw = String(parentDrone?.group ?? '').trim();
      const targetGroup = targetGroupRaw || null;
      // The same stale-snapshot rule applies to inherited group membership.
      // Reassert the target parent's group after every successful reparent.
      const droneIdsNeedingGroupMove = parentDrone ? reparentedIds : [];
      if (droneIdsNeedingGroupMove.length > 0) {
        try {
          const response = await requestJson<{
            ok: true;
            moved: Array<{ id: string; name: string; previousGroup: string | null; group: string | null }>;
            rejected: Array<{ id: string; name: string; error: string }>;
          }>(`/api/drones/group-set`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ droneIds: droneIdsNeedingGroupMove, group: targetGroup }),
          });
          const rejected = Array.isArray(response?.rejected) ? response.rejected : [];
          if (rejected.length > 0) {
            errors.push(
              rejected
                .slice(0, 3)
                .map((item) => {
                  const label = String(item?.name ?? item?.id ?? 'unknown').trim() || 'unknown';
                  const message = String(item?.error ?? 'move failed').trim() || 'move failed';
                  return `${label}: ${message}`;
                })
                .join(', '),
            );
          }
        } catch (error: any) {
          const message = String(error?.message ?? error ?? '').trim() || 'Failed to move reparented drones into the target group.';
          errors.push(message);
        }
      }

      return {
        ok: errors.length === 0,
        error: errors.length > 0 ? errors.join(' ') : null,
        reparentedIds,
      };
    },
    [deletingDrones, renamingDrones, requestJson, settingBaseImages],
  );

  const suggestAndRenameDraftDrone = React.useCallback(
    async (
      droneIdRaw: string,
      promptRaw: string,
      expectedNameRaw?: string,
    ): Promise<void> => {
      const droneId = String(droneIdRaw ?? '').trim();
      const prompt = String(promptRaw ?? '').trim();
      const expectedName =
        String(expectedNameRaw ?? '').trim() ||
        String(dronesRef.current.find((d) => d.id === droneId)?.name ?? '').trim();
      if (!droneId || !prompt) return;
      try {
        const data = await requestJson<{ ok: true; name: string }>(
          '/api/drones/name-from-message',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              message: prompt,
              source: 'draft-auto-rename',
              droneId,
            }),
          },
        );
        const base = String((data as any)?.name ?? '').trim();
        if (!base) {
          onNameSuggestionFailure(new Error('Name suggestion returned an empty draft name.'));
          return;
        }

        const currentName = String(dronesRef.current.find((d) => d.id === droneId)?.name ?? '').trim();
        if (expectedName && currentName && currentName !== expectedName) return;
        if (currentName && base === currentName) return;

        const makeCandidate = (n: number) => {
          const suffix = n <= 1 ? '' : ` (${n})`;
          const raw = `${base}${suffix}`.trim();
          if (!raw) return '';
          if (raw.length > 80) return raw.slice(0, 80).trim();
          return raw;
        };

        const startedAtMs = Date.now();
        const maxRetryMs = 5 * 60 * 1000;
        let conflictSuffix = 1;
        let lastError = '';
        for (let attempt = 1; attempt <= 240; attempt += 1) {
          const candidate = makeCandidate(conflictSuffix);
          if (!candidate) {
            onNameSuggestionFailure(new Error('Name suggestion produced an empty drone name candidate.'));
            return;
          }
          if (candidate.length > 80 || /[\r\n]/.test(candidate)) {
            onNameSuggestionFailure(new Error(`Name suggestion produced an invalid drone name: "${candidate}"`));
            return;
          }
          const renamed = await renameDroneTo(droneId, candidate, {
            ...(expectedName ? { expectedName } : {}),
            source: 'draft-auto-rename',
            attempt,
            suggestedBase: base,
          });
          if (renamed.ok) return;
          const errorMessage = String(('error' in renamed ? renamed.error : '') ?? '').trim();
          if (/rename precondition failed/i.test(errorMessage)) return;
          lastError = errorMessage || 'rename failed';
          const msg = errorMessage.toLowerCase();
          const nameConflict =
            msg.includes('already exists') ||
            msg.includes('pending') ||
            msg.includes('cannot rename');
          if (nameConflict) {
            conflictSuffix += 1;
            continue;
          }
          const retriable =
            msg.includes('rename busy') ||
            msg.includes('still starting') ||
            msg.includes('unknown drone');
          if (!retriable) {
            onNameSuggestionFailure(new Error(`Draft auto-rename failed: ${errorMessage || 'unknown error'}`));
            return;
          }
          const delayMs = Math.min(3000, 250 + attempt * 250);
          if (Date.now() - startedAtMs + delayMs > maxRetryMs) break;
          await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
        }
        const waitedMs = Date.now() - startedAtMs;
        const timeoutMessage = lastError
          ? `Draft auto-rename timed out after ${Math.round(waitedMs / 1000)}s (last error: ${lastError}).`
          : `Draft auto-rename timed out after ${Math.round(waitedMs / 1000)}s.`;
        console.warn('[DroneHub] draft auto-rename exhausted retries', {
          id: droneId,
          waitedMs,
          lastError: lastError || null,
        });
        onNameSuggestionFailure(new Error(timeoutMessage));
      } catch (e: any) {
        console.error('[DroneHub] draft auto-rename skipped', {
          id: droneId,
          error: e?.message ?? String(e),
        });
        onNameSuggestionFailure(e);
      }
    },
    [onNameSuggestionFailure, renameDroneTo, requestJson],
  );

  return {
    deletingDrones,
    renamingDrones,
    renameDroneTarget,
    settingBaseImages,
    deleteDrone,
    renameDrone,
    closeRenameDrone,
    clearRenameDroneError,
    confirmRenameDrone,
    setDroneBaseImage,
    reparentDronesToParent,
    renameDroneTo,
    suggestAndRenameDraftDrone,
  };
}
