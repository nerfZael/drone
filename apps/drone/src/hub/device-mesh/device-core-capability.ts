import { DEVICE_CORE_CAPABILITY, WORKSPACE_CAPABILITY } from '@drone/device-protocol';
import type { DeviceMeshStore } from './device-mesh-store';
import type { CapabilityHandler } from './device-mesh-types';
import { mobileChatLoadStore } from '../mobile-chat-load-store';

function payloadObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizedGrants(value: unknown, capabilities: CapabilityHandler['descriptor'][]) {
  if (!Array.isArray(value)) return [];
  const descriptors = new Map(capabilities.map((descriptor) => [descriptor.id, descriptor]));
  return value.flatMap((raw: any) => {
    const capability = String(raw?.capability ?? '').trim();
    const descriptor = descriptors.get(capability);
    if (
      !descriptor ||
      descriptor.id === DEVICE_CORE_CAPABILITY.id ||
      descriptor.id === WORKSPACE_CAPABILITY.id
    )
      return [];
    if (Number(raw?.version) !== descriptor.version || !Array.isArray(raw?.operations)) return [];
    const operations = [
      ...new Set<string>(
        raw.operations
          .map(String)
          .filter((operation: string) => descriptor.operations.includes(operation)),
      ),
    ];
    return operations.length > 0 ? [{ capability, version: descriptor.version, operations }] : [];
  });
}

export function createDeviceCoreCapability(
  store: DeviceMeshStore,
  listCapabilities: () => CapabilityHandler['descriptor'][],
  onMembershipChange: () => void | Promise<void> = () => undefined,
  onAccessChange: (deviceId: string) => void | Promise<void> = () => undefined,
  signDirectory?: (value: unknown) => string,
): CapabilityHandler {
  return {
    descriptor: DEVICE_CORE_CAPABILITY,
    async invoke(operation, payload, context) {
      if (operation === 'diagnostics.chat-load.upload') {
        return mobileChatLoadStore().upload(context.sourceDevice.id, payloadObject(payload).records);
      }
      if (operation === 'device.describe') {
        const state = await store.read();
        return { device: state.devices[state.selfDeviceId], capabilities: listCapabilities() };
      }
      if (operation === 'device.ping') {
        return { receivedAt: new Date().toISOString(), echo: payloadObject(payload).echo ?? null };
      }
      if (operation === 'devices.list') {
        const state = await store.read();
        const directory = {
          type: 'device.directory',
          version: 2,
          networkId: state.networkId,
          issuerDeviceId: state.selfDeviceId,
          nonce: String(payloadObject(payload).directoryNonce ?? ''),
          issuedAt: new Date().toISOString(),
          devices: Object.values(state.devices).map((device) => ({ ...device, grants: [] })),
          routes: Object.values(state.routes),
        };
        return {
          ...(signDirectory
            ? { directory: { ...directory, signature: signDirectory(directory) } }
            : {}),
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
          if (
            Object.values(state.devices).some(
              (device) =>
                device.id !== source.id &&
                !device.revokedAt &&
                device.name.trim().toLowerCase() === name.toLowerCase(),
            )
          )
            throw Object.assign(new Error('device names must be unique in this network'), {
              code: 'DUPLICATE_DEVICE_NAME',
            });
          source.name = name;
          source.updatedAt = new Date().toISOString();
        });
        try {
          await onMembershipChange();
        } catch {
          // The rename is already durable; a later membership sync can propagate it.
        }
        return { name };
      }
      if (operation === 'device.access.update-self') {
        const capabilities = listCapabilities();
        const grants = normalizedGrants(payloadObject(payload).grants, capabilities);
        await store.update((state) => {
          const source = state.devices[context.sourceDevice.id];
          if (!source || source.revokedAt)
            throw Object.assign(new Error('device is not active'), { code: 'DEVICE_REVOKED' });
          if (!source.administrator)
            throw Object.assign(new Error('administrator access is required'), {
              code: 'PERMISSION_DENIED',
            });
          source.grants = grants;
          source.updatedAt = new Date().toISOString();
        });
        try {
          await onAccessChange(context.sourceDevice.id);
        } catch {
          // Access is already durable; expiry still bounds any cleanup that could not run.
        }
        return { grants };
      }
      throw Object.assign(new Error(`unsupported device-core operation: ${operation}`), {
        code: 'UNSUPPORTED_OPERATION',
      });
    },
  };
}
