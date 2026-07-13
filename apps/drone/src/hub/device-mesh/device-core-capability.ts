import { DEVICE_CORE_CAPABILITY } from '@drone/device-protocol';
import type { DeviceMeshStore } from './device-mesh-store';
import type { CapabilityHandler } from './device-mesh-types';

function payloadObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function createDeviceCoreCapability(
  store: DeviceMeshStore,
  listCapabilities: () => CapabilityHandler['descriptor'][],
): CapabilityHandler {
  return {
    descriptor: DEVICE_CORE_CAPABILITY,
    async invoke(operation, payload, context) {
      if (operation === 'device.describe') {
        const state = await store.read();
        return { device: state.devices[state.selfDeviceId], capabilities: listCapabilities() };
      }
      if (operation === 'device.ping') {
        return { receivedAt: new Date().toISOString(), echo: payloadObject(payload).echo ?? null };
      }
      if (operation === 'devices.list') {
        const state = await store.read();
        return {
          selfDeviceId: state.selfDeviceId,
          devices: Object.values(state.devices)
            .filter((device) => !device.revokedAt)
            .map((device) =>
              device.id === context.sourceDevice.id ? device : { ...device, grants: [] },
            ),
        };
      }
      if (operation === 'device.rename-self') {
        const name = String(payloadObject(payload).name ?? '')
          .trim()
          .slice(0, 80);
        if (!name)
          throw Object.assign(new Error('device name is required'), { code: 'INVALID_REQUEST' });
        await store.update((state) => {
          const source = state.devices[context.sourceDevice.id];
          if (!source || source.revokedAt)
            throw Object.assign(new Error('device is not active'), { code: 'DEVICE_REVOKED' });
          source.name = name;
          source.updatedAt = new Date().toISOString();
        });
        return { name };
      }
      throw Object.assign(new Error(`unsupported device-core operation: ${operation}`), {
        code: 'UNSUPPORTED_OPERATION',
      });
    },
  };
}
