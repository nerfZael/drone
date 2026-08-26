import React from 'react';
import { requestJson } from '../http';
import type { MeshDevice, MeshStatus } from './use-device-mesh';
import { subscribeDeviceMeshChanges } from './device-mesh-events';

const SELECTED_DEVICE_STORAGE_KEY = 'drone-hub:selected-device-id';

type DesktopDeviceContextValue = {
  status: MeshStatus | null;
  devices: MeshDevice[];
  selectedDevice: MeshDevice | null;
  selectedDeviceId: string;
  selfDeviceId: string;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  remoteRouteAvailable: boolean;
  selectDevice(deviceId: string): void;
  refresh(): Promise<void>;
};

const DesktopDeviceContext = React.createContext<DesktopDeviceContextValue | null>(null);

function sameMeshStatus(left: MeshStatus | null, right: MeshStatus): boolean {
  return Boolean(left) && JSON.stringify(left) === JSON.stringify(right);
}

export function desktopDeviceRouteAvailable(
  status: Pick<MeshStatus, 'selfDeviceId' | 'connectedDeviceIds'> | null,
  device: Pick<MeshDevice, 'id'> | null,
): boolean {
  if (!device) return false;
  return device.id === status?.selfDeviceId || Boolean(status?.connectedDeviceIds.includes(device.id));
}

function storedDeviceId(): string {
  try {
    return window.localStorage.getItem(SELECTED_DEVICE_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

function activeDevices(status: MeshStatus | null): MeshDevice[] {
  return (status?.devices ?? [])
    .filter((device) => !device.revokedAt)
    .sort((left, right) => {
      if (left.id === status?.selfDeviceId) return -1;
      if (right.id === status?.selfDeviceId) return 1;
      return left.name.localeCompare(right.name);
    });
}

export function DesktopDeviceProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<MeshStatus | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = React.useState(storedDeviceId);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const next = await requestJson<{ ok: true } & MeshStatus>('/api/device-mesh');
      setStatus((current) => sameMeshStatus(current, next) ? current : next);
      setError(null);
      setSelectedDeviceId((current) => {
        const selectedIsActive = next.devices.some(
          (device) => device.id === current && !device.revokedAt,
        );
        return selectedIsActive ? current : next.selfDeviceId;
      });
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => void load(), [load]);
  React.useEffect(() => {
    const unsubscribe = subscribeDeviceMeshChanges(() => void load());
    const refreshAfterResume = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', refreshAfterResume);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', refreshAfterResume);
    };
  }, [load]);
  const refresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);
  React.useEffect(() => {
    if (!selectedDeviceId) return;
    try {
      window.localStorage.setItem(SELECTED_DEVICE_STORAGE_KEY, selectedDeviceId);
    } catch {
      // Selection persistence is optional when browser storage is unavailable.
    }
  }, [selectedDeviceId]);

  const devices = React.useMemo(() => activeDevices(status), [status]);
  const selectedDevice =
    devices.find((device) => device.id === selectedDeviceId) ??
    devices.find((device) => device.id === status?.selfDeviceId) ??
    null;
  const selfDeviceId = status?.selfDeviceId ?? '';
  const value = React.useMemo<DesktopDeviceContextValue>(
    () => ({
      status,
      devices,
      selectedDevice,
      selectedDeviceId: selectedDevice?.id ?? selectedDeviceId,
      selfDeviceId,
      loading,
      refreshing,
      error,
      remoteRouteAvailable: desktopDeviceRouteAvailable(status, selectedDevice),
      selectDevice: setSelectedDeviceId,
      refresh,
    }),
    [devices, error, loading, refresh, refreshing, selectedDevice, selectedDeviceId, selfDeviceId, status],
  );

  return <DesktopDeviceContext.Provider value={value}>{children}</DesktopDeviceContext.Provider>;
}

export function useDesktopDevice(): DesktopDeviceContextValue {
  const context = React.useContext(DesktopDeviceContext);
  if (!context) throw new Error('useDesktopDevice must be used inside DesktopDeviceProvider');
  return context;
}
