import type { MeshDevice } from './use-device-mesh';

export function deviceEditorSourceKey(device: MeshDevice): string {
  return JSON.stringify({
    name: device.name,
    endpoint: device.endpoints[0] ?? '',
    administrator: device.administrator,
    grants: device.grants,
  });
}
