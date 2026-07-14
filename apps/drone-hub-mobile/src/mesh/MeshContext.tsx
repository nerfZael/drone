import React from 'react';
import { AppState } from 'react-native';
import type {
  CapabilityEvent,
  MeshDevice,
  PairingApproval,
  PairingPayload,
} from '@drone/device-protocol';
import {
  loadDeviceIdentity,
  saveDeviceName,
  type MobileDeviceIdentity,
} from '../security/device-identity';
import { MeshSocket } from './MeshSocket';
import { claimPairing, validatePairingApproval, waitForPairingApproval } from './pair-device';
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
    signal?: AbortSignal,
  ): Promise<any>;
  refreshDevices(): Promise<void>;
  subscribe(
    capability: string,
    event: string,
    listener: (message: CapabilityEvent) => void,
  ): () => void;
  renameSelf(name: string): Promise<void>;
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
  const eventListeners = React.useRef(
    new Set<{
      capability: string;
      event: string;
      listener: (message: CapabilityEvent) => void;
    }>(),
  );
  const emitCapabilityEvent = React.useCallback((event: CapabilityEvent) => {
    for (const subscription of eventListeners.current) {
      if (subscription.capability === event.capability && subscription.event === event.event)
        subscription.listener(event);
    }
  }, []);

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
              emitCapabilityEvent,
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
    [emitCapabilityEvent],
  );

  const subscribe = React.useCallback(
    (capability: string, event: string, listener: (message: CapabilityEvent) => void) => {
      const subscription = { capability, event, listener };
      eventListeners.current.add(subscription);
      return () => eventListeners.current.delete(subscription);
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
      signal?: AbortSignal,
    ) => {
      const direct = sockets.current.find(
        (socket) => socket.connected && socket.connection.deviceId === targetDeviceId,
      );
      const relay = sockets.current.find((socket) => socket.connected);
      const socket = direct ?? relay;
      if (!socket) throw new Error('No paired device is connected');
      return await socket.request(targetDeviceId, capability, operation, payload, signal);
    },
    [],
  );

  const refreshDevices = React.useCallback(async () => {
    const target = sockets.current.find((socket) => socket.connected)?.connection.deviceId;
    if (!target) return;
    const result: any = await request(target, 'device-core', 'devices.list');
    if (!Array.isArray(result?.devices)) return;
    const devices = result.devices as MeshDevice[];
    const selfDevice = devices.find((device) => device.id === identity?.id);
    if (identity && selfDevice?.name && selfDevice.name !== identity.name) {
      const name = await saveDeviceName(selfDevice.name);
      setIdentity({ ...identity, name });
    }
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

  const renameSelf = React.useCallback(
    async (rawName: string) => {
      if (!identity || !profile) throw new Error('Device identity is not ready');
      const name = rawName.trim().slice(0, 80);
      if (!name) throw new Error('Device name is required');
      const targets = sockets.current
        .filter((socket) => socket.connected)
        .map((socket) => socket.connection.deviceId);
      if (targets.length === 0) throw new Error('No paired device is connected');
      const results = await Promise.allSettled(
        targets.map((target) => request(target, 'device-core', 'device.rename-self', { name })),
      );
      if (results.some((result) => result.status === 'rejected')) {
        const failure = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        await Promise.allSettled(
          targets
            .filter((_, index) => results[index]?.status === 'fulfilled')
            .map((target) =>
              request(target, 'device-core', 'device.rename-self', { name: identity.name }),
            ),
        );
        throw failure?.reason ?? new Error('Could not rename this phone');
      }
      await saveDeviceName(name);
      setIdentity({ ...identity, name });
      const next: MeshProfile = {
        ...profile,
        devices: profile.devices.map((device) =>
          device.id === identity.id ? { ...device, name } : device,
        ),
      };
      await saveMeshProfile(next);
      setProfile(next);
    },
    [identity, profile, request],
  );

  const pair = React.useCallback(
    async (payload: PairingPayload, signal: AbortSignal) => {
      if (!identity) throw new Error('Device identity is not ready');
      setError(null);
      const claim = await claimPairing(payload, identity);
      const approval: PairingApproval = await validatePairingApproval(
        payload,
        await waitForPairingApproval(payload, claim.pendingId, claim.claimSecret, signal),
        identity,
      );
      const current = await loadMeshProfile();
      if (current && current.networkId !== approval.networkId)
        throw new Error('Forget the current mesh before joining another one');
      const existingConnections = (current?.connections ?? []).filter(
        (connection) => connection.deviceId !== payload.inviterDeviceId,
      );
      const connections = [
        ...existingConnections,
        {
          deviceId: payload.inviterDeviceId,
          endpoint: approval.endpoint,
          role: existingConnections.some((connection) => connection.role === 'primary')
            ? ('backup' as const)
            : ('primary' as const),
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
    subscribe,
    renameSelf,
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
