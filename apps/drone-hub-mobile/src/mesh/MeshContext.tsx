import React from 'react';
import { AppState } from 'react-native';
import type {
  CapabilityDescriptor,
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
import {
  MeshConnectionManager,
  type MeshAppState,
  type MeshDeviceConnectionState,
} from './MeshConnectionManager';
import {
  MobileCapabilityRouter,
  type MobileCapabilityHandler,
  type RegisteredMobileCapability,
} from './mobile-capability-router';
import { uploadMeshChatAttachment } from './upload-mesh-chat-attachment';
import { claimPairing, validatePairingApproval, waitForPairingApproval } from './pair-device';
import { assertKnownRecoveryTarget } from './pairing-recovery';
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
  connectionStatesByDevice: Record<string, MeshDeviceConnectionState>;
  connectionErrorsByDevice: Record<string, string>;
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
  uploadChatAttachment(input: {
    targetDeviceId: string;
    droneId: string;
    chatName: string;
    name: string;
    mime: string;
    bytes: Uint8Array;
  }): Promise<{ attachmentId: string; name: string; mime: string; size: number }>;
  retryDeviceConnection(deviceId: string): Promise<void>;
  setBackgroundActivityRequired(required: boolean): void;
  refreshDevices(): Promise<void>;
  subscribe(
    capability: string,
    event: string,
    listener: (message: CapabilityEvent) => void,
  ): () => void;
  registerCapabilityHandler(
    descriptor: CapabilityDescriptor,
    handler: MobileCapabilityHandler,
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
  const [connectionErrorsByDevice, setConnectionErrorsByDevice] = React.useState<
    Record<string, string>
  >({});
  const [revision, setRevision] = React.useState(0);
  const profileRef = React.useRef<MeshProfile | null>(null);
  const capabilityHandlers = React.useRef(new Map<string, RegisteredMobileCapability>());
  const capabilityRouter = React.useRef<MobileCapabilityRouter | null>(null);
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
  const connectionManagerRef = React.useRef<MeshConnectionManager<MeshSocket> | null>(null);
  if (!connectionManagerRef.current) {
    connectionManagerRef.current = new MeshConnectionManager<MeshSocket>({
      onChange: () => setRevision((value) => value + 1),
      onConnectionError: (deviceId, nextError) => {
        if (!nextError && connectionManagerRef.current?.connectedDeviceIds.length) setError(null);
        setConnectionErrorsByDevice((current) => {
          if (!nextError) {
            if (!(deviceId in current)) return current;
            const next = { ...current };
            delete next[deviceId];
            return next;
          }
          const message = nextError.message;
          if (current[deviceId] === message) return current;
          return { ...current, [deviceId]: message };
        });
      },
    });
  }
  const connectionManager = connectionManagerRef.current;

  profileRef.current = profile;

  const registerCapabilityHandler = React.useCallback(
    (descriptor: CapabilityDescriptor, handler: MobileCapabilityHandler) => {
      const registered = { descriptor, invoke: handler };
      capabilityHandlers.current.set(descriptor.id, registered);
      return () => {
        if (capabilityHandlers.current.get(descriptor.id) === registered) {
          capabilityHandlers.current.delete(descriptor.id);
        }
      };
    },
    [],
  );

  const connect = React.useCallback(
    async (nextProfile: MeshProfile, nextIdentity: MobileDeviceIdentity) => {
      const nextSockets = [...nextProfile.connections]
        .sort((left, right) => Number(left.role === 'backup') - Number(right.role === 'backup'))
        .map((connection) => {
          let socket!: MeshSocket;
          socket = new MeshSocket(
            connection,
            nextProfile.networkId,
            nextIdentity,
            nextProfile.devices.find((device) => device.id === connection.deviceId)?.publicKey ??
              {},
            (deviceId) =>
              profileRef.current?.devices.find((device) => device.id === deviceId)?.publicKey,
            () => connectionManager.handleSocketState(socket),
            () => {
              if (topologyRefreshTimer.current) clearTimeout(topologyRefreshTimer.current);
              topologyRefreshTimer.current = setTimeout(() => void refreshRef.current(), 300);
            },
            emitCapabilityEvent,
            capabilityRouter.current!,
          );
          return socket;
        });
      connectionManager.replaceSockets(nextSockets);
      const connectionIds = new Set(nextSockets.map((socket) => socket.connection.deviceId));
      setConnectionErrorsByDevice((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([deviceId]) => connectionIds.has(deviceId)),
        ),
      );
      if (AppState.currentState !== 'active') return;
      const results = await connectionManager.connectAll();
      if (!connectionManager.isCurrentSet(nextSockets)) return;
      if (!results.some((result) => result.status === 'fulfilled')) {
        const rejected = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        throw rejected?.reason ?? new Error('No paired device is reachable');
      }
    },
    [connectionManager, emitCapabilityEvent],
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
        profileRef.current = nextProfile;
        capabilityRouter.current = new MobileCapabilityRouter(
          nextIdentity,
          () => profileRef.current?.devices ?? [],
          (id) => capabilityHandlers.current.get(id),
        );
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
      connectionManager.clear(false);
    };
  }, [connect, connectionManager]);

  React.useEffect(() => {
    connectionManager.handleAppState((AppState.currentState ?? 'unknown') as MeshAppState);
    const subscription = AppState.addEventListener('change', (state) => {
      connectionManager.handleAppState(state as MeshAppState);
    });
    return () => subscription.remove();
  }, [connectionManager]);

  React.useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      void connectionManager.ensureConnected();
    }, 10_000);
    return () => clearInterval(timer);
  }, [connectionManager]);

  const request = React.useCallback(
    async (
      targetDeviceId: string,
      capability: string,
      operation: string,
      payload: unknown = {},
      signal?: AbortSignal,
    ) => {
      const socket = connectionManager.routeFor(targetDeviceId);
      if (!socket) throw new Error('No paired device is connected');
      return await socket.request(targetDeviceId, capability, operation, payload, signal);
    },
    [connectionManager],
  );

  const uploadChatAttachment = React.useCallback(
    async (input: {
      targetDeviceId: string;
      droneId: string;
      chatName: string;
      name: string;
      mime: string;
      bytes: Uint8Array;
    }) => {
      const direct = connectionManager.sockets.find(
        (socket) => socket.connected && socket.connection.deviceId === input.targetDeviceId,
      );
      const knownEndpoint = profile?.devices.find(
        (device) => device.id === input.targetDeviceId,
      )?.endpoints[0];
      return await uploadMeshChatAttachment({
        endpoint: direct?.connection.endpoint ?? knownEndpoint ?? null,
        droneId: input.droneId,
        chatName: input.chatName,
        name: input.name,
        mime: input.mime,
        bytes: input.bytes,
        request: (payload) =>
          request(input.targetDeviceId, 'drone-control', 'chat.prompt', payload),
      });
    },
    [connectionManager, profile?.devices, request],
  );

  const refreshDevices = React.useCallback(async () => {
    if (connectionManager.connectedDeviceIds.length === 0) {
      await connectionManager.ensureAnyConnected(true);
    }
    const target = connectionManager.connectedDeviceIds[0];
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
      profileRef.current = next;
      setProfile(next);
      await saveMeshProfile(next);
      const routesChanged =
        JSON.stringify(next.connections) !== JSON.stringify(profile?.connections);
      if (identity && routesChanged) await connect(next, identity);
    }
  }, [connect, connectionManager, identity, profile, request]);
  refreshRef.current = refreshDevices;

  const retryDeviceConnection = React.useCallback(
    async (deviceId: string) => {
      const connected = await connectionManager.ensureDeviceConnected(deviceId, true);
      if (!connected && connectionManager.connectedDeviceIds.length === 0) return;
      await refreshDevices();
    },
    [connectionManager, refreshDevices],
  );

  const setBackgroundActivityRequired = React.useCallback(
    (required: boolean) => connectionManager.setBackgroundActivityRequired(required),
    [connectionManager],
  );

  const renameSelf = React.useCallback(
    async (rawName: string) => {
      if (!identity || !profile) throw new Error('Device identity is not ready');
      const name = rawName.trim().slice(0, 80);
      if (!name) throw new Error('Device name is required');
      const targets = connectionManager.sockets
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
      profileRef.current = next;
      setProfile(next);
    },
    [connectionManager, identity, profile, request],
  );

  const pair = React.useCallback(
    async (payload: PairingPayload, signal: AbortSignal) => {
      if (!identity) throw new Error('Device identity is not ready');
      setError(null);
      const current = await loadMeshProfile();
      assertKnownRecoveryTarget(payload, current);
      const claim = await claimPairing(payload, identity);
      const approval: PairingApproval = await validatePairingApproval(
        payload,
        await waitForPairingApproval(payload, claim.pendingId, claim.claimSecret, signal),
        identity,
      );
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
      profileRef.current = next;
      setProfile(next);
      await connect(next, identity);
    },
    [connect, identity],
  );

  const forgetMesh = React.useCallback(async () => {
    connectionManager.clear();
    await clearMeshProfile();
    profileRef.current = null;
    setProfile(null);
    setError(null);
    setConnectionErrorsByDevice({});
  }, [connectionManager]);

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
      profileRef.current = next;
      await saveMeshProfile(next);
      await connect(next, identity);
    },
    [connect, identity, profile],
  );

  const value: MeshContextValue = {
    identity,
    profile,
    devices: profile?.devices ?? [],
    connectionStatesByDevice: connectionManager.connectionStatesByDevice,
    connectionErrorsByDevice,
    loading,
    error,
    pair,
    request,
    uploadChatAttachment,
    retryDeviceConnection,
    setBackgroundActivityRequired,
    refreshDevices,
    subscribe,
    registerCapabilityHandler,
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
