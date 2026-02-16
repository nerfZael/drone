import React from 'react';
import type { DroneSummary } from '../types';
import type { DroneErrorModalState } from './app-types';
import { parseRepoPullConflict, type RepoOpErrorMeta } from './helpers';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type UseDroneErrorModalActionsArgs = {
  currentDroneId: string | null;
  requestJson: RequestJsonFn;
  clearRepoOperationError: () => void;
  setRepoOperationError: (message: string) => void;
  setDroneErrorModal: React.Dispatch<
    React.SetStateAction<DroneErrorModalState | null>
  >;
  setClearingDroneError: React.Dispatch<React.SetStateAction<boolean>>;
};

export function useDroneErrorModalActions({
  currentDroneId,
  requestJson,
  clearRepoOperationError,
  setRepoOperationError,
  setDroneErrorModal,
  setClearingDroneError,
}: UseDroneErrorModalActionsArgs) {
  const closeDroneErrorModal = React.useCallback(() => {
    setDroneErrorModal(null);
  }, [setDroneErrorModal]);

  const openDroneErrorModal = React.useCallback(
    (
      drone: Pick<DroneSummary, 'id' | 'name'>,
      message: string,
      meta?: Partial<RepoOpErrorMeta> | null,
    ) => {
      const droneId = String((drone as any)?.id ?? '').trim();
      const droneName = String(drone?.name ?? '').trim();
      const text = String(message ?? '').trim();
      if (!droneId || !droneName || !text) return;
      setDroneErrorModal({
        droneId,
        droneName,
        message: text,
        conflict: parseRepoPullConflict(text, meta),
      });
    },
    [setDroneErrorModal],
  );

  const clearDroneHubError = React.useCallback(
    async (droneIdRaw: string, opts?: { closeModal?: boolean }) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      setClearingDroneError(true);
      try {
        await requestJson<{ ok: true; id: string; name: string; cleared: boolean }>(
          `/api/drones/${encodeURIComponent(droneId)}/hub/error/clear`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          },
        );
        if (currentDroneId === droneId) {
          clearRepoOperationError();
        }
        if (opts?.closeModal !== false) closeDroneErrorModal();
      } catch (e: any) {
        setRepoOperationError(e?.message ?? String(e));
      } finally {
        setClearingDroneError(false);
      }
    },
    [
      clearRepoOperationError,
      closeDroneErrorModal,
      currentDroneId,
      requestJson,
      setClearingDroneError,
      setRepoOperationError,
    ],
  );

  return {
    closeDroneErrorModal,
    openDroneErrorModal,
    clearDroneHubError,
  };
}

