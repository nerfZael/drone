export type DeviceSelectionItem = {
  id: string;
  connected: boolean;
};

export function resolveAvailableDeviceSelection(
  devices: readonly DeviceSelectionItem[],
  preferredDeviceId: string,
): string {
  const preferred = String(preferredDeviceId ?? '').trim();
  if (preferred && devices.some((device) => device.id === preferred)) {
    return preferred;
  }
  return devices.find((device) => device.connected)?.id ?? devices[0]?.id ?? '';
}
