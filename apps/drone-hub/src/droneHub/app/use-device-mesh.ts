import React from 'react';

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

export function useDeviceMesh(requestJson: RequestJson) {
  const [status, setStatus] = React.useState<MeshStatus | null>(null);
  const [invitation, setInvitation] = React.useState<MeshInvitation | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await requestJson<{ ok: true } & MeshStatus>('/api/device-mesh'));
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => void load(), [load]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void requestJson<{ ok: true } & MeshStatus>('/api/device-mesh')
        .then(setStatus)
        .catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [requestJson]);

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

  return {
    status,
    invitation,
    loading,
    busyId,
    error,
    load,
    createInvitation: (publicEndpoint: string) =>
      action('invite', async () => {
        setInvitation(
          await requestJson<MeshInvitation>('/api/device-mesh/invitations', {
            method: 'POST',
            body: JSON.stringify({ publicEndpoint }),
          }),
        );
      }),
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
