import React from 'react';
import { AppState } from 'react-native';
import type { MeshDevice, PairingApproval, PairingPayload } from '@drone/device-protocol';
import { loadDeviceIdentity, type MobileDeviceIdentity } from '../security/device-identity';
import { MeshSocket } from './MeshSocket';
import { claimPairing, waitForPairingApproval } from './pair-device';
import {
  clearMeshProfile,
  loadMeshProfile,
  saveMeshProfile,
  type MeshProfile,
} from './mesh-storage';

type MeshContextValue = {
  identity: MobileDeviceIdentity | null;
  profile: MeshProfile | null;
  devices: MeshDevice[];
  connectedDeviceIds: string[];
  loading: boolean;
  error: string | null;
  pair(payload: PairingPayload, signal: AbortSignal): Promise<void>;
  request(
    targetDeviceId: string,
    capability: string,
    operation: string,
    payload?: unknown,
  ): Promise<any>;
  refreshDevices(): Promise<void>;
  makePrimary(deviceId: string): Promise<void>;
  forgetMesh(): Promise<void>;
};

const MeshContext = React.createContext<MeshContextValue | null>(null);

export function MeshProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = React.useState<MobileDeviceIdentity | null>(null);
  const [profile, setProfile] = React.useState<MeshProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [revision, setRevision] = React.useState(0);
  const sockets = React.useRef<MeshSocket[]>([]);
  const refreshRef = React.useRef<() => Promise<void>>(async () => undefined);
  const topologyRefreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = React.useCallback(
    async (nextProfile: MeshProfile, nextIdentity: MobileDeviceIdentity) => {
      sockets.current.forEach((socket) => socket.disconnect());
      sockets.current = [...nextProfile.connections]
        .sort((left, right) => Number(left.role === 'backup') - Number(right.role === 'backup'))
        .map(
          (connection) =>
            new MeshSocket(
              connection,
              nextProfile.networkId,
              nextIdentity,
              nextProfile.devices.find((device) => device.id === connection.deviceId)?.publicKey ??
                {},
              () => {
                setRevision((value) => value + 1);
              },
              () => {
                if (topologyRefreshTimer.current) clearTimeout(topologyRefreshTimer.current);
                topologyRefreshTimer.current = setTimeout(() => void refreshRef.current(), 300);
              },
            ),
        );
      const results = await Promise.allSettled(sockets.current.map((socket) => socket.connect()));
      if (!results.some((result) => result.status === 'fulfilled')) {
        const rejected = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        throw rejected?.reason ?? new Error('No paired device is reachable');
      }
    },
    [],
  );

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [nextIdentity, nextProfile] = await Promise.all([
          loadDeviceIdentity(),
          loadMeshProfile(),
        ]);
        if (!active) return;
        setIdentity(nextIdentity);
        setProfile(nextProfile);
        if (nextProfile) await connect(nextProfile, nextIdentity);
      } catch (nextError: any) {
        if (active) setError(nextError?.message ?? String(nextError));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      if (topologyRefreshTimer.current) clearTimeout(topologyRefreshTimer.current);
      sockets.current.forEach((socket) => socket.disconnect());
    };
  }, [connect]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') sockets.current.forEach((socket) => socket.disconnect());
      else if (profile && identity)
        void connect(profile, identity).catch((nextError) => setError(nextError.message));
    });
    return () => subscription.remove();
  }, [connect, identity, profile]);

  React.useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      for (const socket of sockets.current) {
        if (!socket.connected) void socket.connect().catch(() => undefined);
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, []);

  const request = React.useCallback(
    async (
      targetDeviceId: string,
      capability: string,
      operation: string,
      payload: unknown = {},
    ) => {
      const direct = sockets.current.find(
        (socket) => socket.connected && socket.connection.deviceId === targetDeviceId,
      );
      const relay = sockets.current.find((socket) => socket.connected);
      const socket = direct ?? relay;
      if (!socket) throw new Error('No paired device is connected');
      return await socket.request(targetDeviceId, capability, operation, payload);
    },
    [],
  );

  const refreshDevices = React.useCallback(async () => {
    const target = sockets.current.find((socket) => socket.connected)?.connection.deviceId;
    if (!target) return;
    const result: any = await request(target, 'device-core', 'devices.list');
    if (!Array.isArray(result?.devices)) return;
    const devices = result.devices as MeshDevice[];
    const capabilitiesByDevice = { ...(profile?.capabilitiesByDevice ?? {}) };
    await Promise.all(
      devices
        .filter((device) => device.id !== identity?.id && !device.revokedAt)
        .map(async (device) => {
          try {
            const description: any = await request(device.id, 'device-core', 'device.describe');
            if (Array.isArray(description?.capabilities))
              capabilitiesByDevice[device.id] = description.capabilities;
          } catch {
            // An offline device keeps its last known capability advertisement.
          }
        }),
    );
    const activeIds = new Set(
      devices.filter((device) => !device.revokedAt).map((device) => device.id),
    );
    const connectionMap = new Map(
      (profile?.connections ?? [])
        .filter((connection) => activeIds.has(connection.deviceId))
        .map((connection) => [connection.deviceId, connection]),
    );
    for (const device of devices) {
      if (device.id === identity?.id || device.revokedAt || device.endpoints.length === 0) continue;
      const current = connectionMap.get(device.id);
      connectionMap.set(device.id, {
        deviceId: device.id,
        endpoint: device.endpoints[0],
        role: current?.role ?? (connectionMap.size === 0 ? 'primary' : 'backup'),
      });
    }
    const next = profile
      ? { ...profile, devices, connections: [...connectionMap.values()], capabilitiesByDevice }
      : null;
    if (next) {
      setProfile(next);
      await saveMeshProfile(next);
      const routesChanged =
        JSON.stringify(next.connections) !== JSON.stringify(profile?.connections);
      if (identity && routesChanged) await connect(next, identity);
    }
  }, [connect, identity, profile, request]);
  refreshRef.current = refreshDevices;

  const pair = React.useCallback(
    async (payload: PairingPayload, signal: AbortSignal) => {
      if (!identity) throw new Error('Device identity is not ready');
      setError(null);
      const claim = await claimPairing(payload, identity);
      const approval: PairingApproval = await waitForPairingApproval(
        payload,
        claim.pendingId,
        claim.claimSecret,
        signal,
      );
      const current = await loadMeshProfile();
      if (current && current.networkId !== approval.networkId)
        throw new Error('Forget the current mesh before joining another one');
      const connections = [
        ...(current?.connections ?? []).filter(
          (connection) => connection.deviceId !== payload.inviterDeviceId,
        ),
        {
          deviceId: payload.inviterDeviceId,
          endpoint: approval.endpoint,
          role: current?.connections.length ? ('backup' as const) : ('primary' as const),
        },
      ];
      const next: MeshProfile = {
        networkId: approval.networkId,
        connections,
        devices: approval.devices,
        capabilitiesByDevice: {
          ...(current?.capabilitiesByDevice ?? {}),
          [payload.inviterDeviceId]: approval.capabilities,
        },
      };
      await saveMeshProfile(next);
      setProfile(next);
      await connect(next, identity);
    },
    [connect, identity],
  );

  const forgetMesh = React.useCallback(async () => {
    sockets.current.forEach((socket) => socket.disconnect());
    sockets.current = [];
    await clearMeshProfile();
    setProfile(null);
    setError(null);
  }, []);

  const makePrimary = React.useCallback(
    async (deviceId: string) => {
      if (!profile || !identity) return;
      const next: MeshProfile = {
        ...profile,
        connections: profile.connections.map((connection) => ({
          ...connection,
          role: connection.deviceId === deviceId ? 'primary' : 'backup',
        })),
      };
      setProfile(next);
      await saveMeshProfile(next);
      await connect(next, identity);
    },
    [connect, identity, profile],
  );

  const value: MeshContextValue = {
    identity,
    profile,
    devices: profile?.devices ?? [],
    connectedDeviceIds: sockets.current
      .filter((socket) => socket.connected)
      .map((socket) => socket.connection.deviceId),
    loading,
    error,
    pair,
    request,
    refreshDevices,
    makePrimary,
    forgetMesh,
  };
  void revision;
  return <MeshContext.Provider value={value}>{children}</MeshContext.Provider>;
}

export function useMesh(): MeshContextValue {
  const value = React.useContext(MeshContext);
  if (!value) throw new Error('useMesh must be used inside MeshProvider');
  return value;
}
