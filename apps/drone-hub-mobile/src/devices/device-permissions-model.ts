import type { MeshDevice } from '@drone/device-protocol';

export function currentDeviceFirst(
  devices: MeshDevice[],
  currentDeviceId: string | null | undefined,
): MeshDevice[] {
  const currentId = String(currentDeviceId ?? '').trim();
  return devices
    .map((device, index) => ({ device, index }))
    .sort((left, right) => {
      const leftCurrent = left.device.id === currentId;
      const rightCurrent = right.device.id === currentId;
      if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
      return left.index - right.index;
    })
    .map(({ device }) => device);
}

export function permissionChangeCount(
  saved: ReadonlySet<string>,
  selected: ReadonlySet<string>,
): number {
  let changes = 0;
  for (const operation of saved) if (!selected.has(operation)) changes += 1;
  for (const operation of selected) if (!saved.has(operation)) changes += 1;
  return changes;
}
