import React from 'react';
import { subscribeDeviceMeshChanges } from './device-mesh-events';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

export type MeshGrant = { capability: string; version: number; operations: string[] };
export type MeshDevice = {
  id: string;
  name: string;
  platform: string;
  administrator: boolean;
  grants: MeshGrant[];
  endpoints: string[];
  revokedAt: string | null;
};
export type MeshCapability = { id: string; version: number; operations: string[] };
export type MeshStatus = {
  networkId: string;
  selfDeviceId: string;
  devices: MeshDevice[];
  pending: Array<{ id: string; device: MeshDevice; requestedAt: string }>;
  connectedDeviceIds: string[];
  capabilities: MeshCapability[];
};
export type MeshInvitation = {
  invitationId: string;
  qrSvg: string;
  expiresAt: string;
  payload: {
    version: 1;
    endpoint: string;
    token: string;
    inviterDeviceId: string;
    expiresAt: string;
  };
};
export type MeshInvitationStatus = {
  invitationId: string;
  endpoint: string;
  expiresAt: string;
  claimed: boolean;
};

function sameMeshStatus(left: MeshStatus | null, right: MeshStatus): boolean {
  return Boolean(left) && JSON.stringify(left) === JSON.stringify(right);
}

export function useDeviceMesh(requestJson: RequestJson) {
  const [status, setStatus] = React.useState<MeshStatus | null>(null);
  const [invitation, setInvitation] = React.useState<MeshInvitation | null>(null);
  const [invitationBusy, setInvitationBusy] = React.useState(false);
  const [invitationError, setInvitationError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const invitationRequest = React.useRef<Promise<void> | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await requestJson<{ ok: true } & MeshStatus>('/api/device-mesh');
      setStatus((current) => sameMeshStatus(current, next) ? current : next);
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => void load(), [load]);

  const refreshStatus = React.useCallback(async () => {
    try {
      const next = await requestJson<{ ok: true } & MeshStatus>('/api/device-mesh');
      setStatus((current) => sameMeshStatus(current, next) ? current : next);
    } catch {
      // The stream reconnects automatically; keep the last usable status meanwhile.
    }
  }, [requestJson]);

  React.useEffect(() => {
    const unsubscribe = subscribeDeviceMeshChanges(() => void refreshStatus());
    const refreshAfterResume = () => {
      if (document.visibilityState === 'visible') void refreshStatus();
    };
    document.addEventListener('visibilitychange', refreshAfterResume);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', refreshAfterResume);
    };
  }, [refreshStatus]);

  const action = React.useCallback(
    async (id: string, run: () => Promise<void>) => {
      setBusyId(id);
      setError(null);
      try {
        await run();
        await load();
      } catch (nextError: any) {
        setError(nextError?.message ?? String(nextError));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const createInvitation = React.useCallback(async () => {
    if (invitationRequest.current) return await invitationRequest.current;
    const request = (async () => {
      setInvitationBusy(true);
      try {
        setInvitation(
          await requestJson<MeshInvitation>('/api/device-mesh/invitations', {
            method: 'POST',
          }),
        );
        setInvitationError(null);
      } catch (nextError: any) {
        setInvitationError(nextError?.message ?? String(nextError));
      } finally {
        setInvitationBusy(false);
      }
    })();
    invitationRequest.current = request;
    try {
      await request;
    } finally {
      if (invitationRequest.current === request) invitationRequest.current = null;
    }
  }, [requestJson]);

  const readInvitationStatus = React.useCallback(
    (invitationId: string) =>
      requestJson<{ ok: true } & MeshInvitationStatus>(
        `/api/device-mesh/invitations/${encodeURIComponent(invitationId)}`,
      ),
    [requestJson],
  );

  return {
    status,
    invitation,
    invitationBusy,
    invitationError,
    loading,
    busyId,
    error,
    load,
    createInvitation,
    readInvitationStatus,
    join: (payload: string) =>
      action('join', async () => {
        const started = await requestJson<{ joinId: string }>('/api/device-mesh/joins', {
          method: 'POST',
          body: JSON.stringify({ payload }),
        });
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          const status = await requestJson<{
            status: 'pending' | 'approved' | 'failed';
            error?: string;
          }>(`/api/device-mesh/joins/${encodeURIComponent(started.joinId)}`);
          if (status.status === 'approved') return;
          if (status.status === 'failed') throw new Error(status.error ?? 'Pairing failed');
        }
      }),
    approve: (pendingId: string, grants: MeshGrant[], administrator: boolean) =>
      action(pendingId, () =>
        requestJson(`/api/device-mesh/pending/${encodeURIComponent(pendingId)}/approve`, {
          method: 'POST',
          body: JSON.stringify({ grants, administrator }),
        }).then(() => undefined),
      ),
    reject: (pendingId: string) =>
      action(pendingId, () =>
        requestJson(`/api/device-mesh/pending/${encodeURIComponent(pendingId)}`, {
          method: 'DELETE',
        }).then(() => undefined),
      ),
    saveDevice: (deviceId: string, update: Partial<MeshDevice>) =>
      action(deviceId, () =>
        requestJson(`/api/device-mesh/devices/${encodeURIComponent(deviceId)}`, {
          method: 'PUT',
          body: JSON.stringify(update),
        }).then(() => undefined),
      ),
    revoke: (deviceId: string) =>
      action(deviceId, () =>
        requestJson(`/api/device-mesh/devices/${encodeURIComponent(deviceId)}`, {
          method: 'DELETE',
        }).then(() => undefined),
      ),
  };
}
