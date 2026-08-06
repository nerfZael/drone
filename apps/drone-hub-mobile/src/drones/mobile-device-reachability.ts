import type { MeshDeviceConnectionState } from '../mesh/MeshConnectionManager';

export function mobileDeviceConnectionLabel(state: MeshDeviceConnectionState): string {
  if (state === 'connected') return 'Online';
  if (state === 'reconnecting') return 'Reconnecting';
  if (state === 'suspended') return 'Paused';
  return 'Offline';
}

export function mobileDeviceConnectionState({
  targetDeviceId,
  selfDeviceId,
  connectionStatesByDevice = {},
}: {
  targetDeviceId: string;
  selfDeviceId?: string;
  connectionStatesByDevice?: Readonly<Record<string, MeshDeviceConnectionState>>;
}): MeshDeviceConnectionState {
  if (!targetDeviceId) return 'offline';
  if (targetDeviceId === selfDeviceId) return 'connected';
  return connectionStatesByDevice[targetDeviceId] ?? 'offline';
}
