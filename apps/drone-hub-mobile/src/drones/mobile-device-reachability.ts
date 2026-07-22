export function mobileDeviceReachable({
  targetDeviceId,
  selfDeviceId,
  connectedDeviceIds,
}: {
  targetDeviceId: string;
  selfDeviceId?: string;
  connectedDeviceIds: readonly string[];
}): boolean {
  if (!targetDeviceId) return false;
  return targetDeviceId === selfDeviceId || connectedDeviceIds.includes(targetDeviceId);
}
