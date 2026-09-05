export type DiscoveredPhone = {
  deviceId: string;
  name: string;
  machineName: string;
  expiresAt: string;
};

export function mergeDiscoveredPhones(
  manual: DiscoveredPhone[],
  nearby: DiscoveredPhone[],
  now: number,
): DiscoveredPhone[] {
  const devices = new Map<string, DiscoveredPhone>();
  for (const phone of [...manual, ...nearby]) {
    if (Date.parse(phone.expiresAt) <= now || !Number.isFinite(Date.parse(phone.expiresAt)))
      continue;
    const existing = devices.get(phone.deviceId);
    if (!existing || Date.parse(phone.expiresAt) >= Date.parse(existing.expiresAt))
      devices.set(phone.deviceId, phone);
  }
  return [...devices.values()];
}
