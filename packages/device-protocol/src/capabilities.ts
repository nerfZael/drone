import type { CapabilityDescriptor, CapabilityGrant } from './types';

export const DEVICE_CORE_CAPABILITY: CapabilityDescriptor = {
  id: 'device-core',
  version: 1,
  operations: ['device.describe', 'device.ping', 'devices.list', 'device.rename-self'],
};

export const DRONE_CONTROL_CAPABILITY: CapabilityDescriptor = {
  id: 'drone-control',
  version: 1,
  operations: [
    'drones.list',
    'chats.list',
    'chat.read',
    'chat.prompt',
    'chat.stop',
    'drone.create.container',
    'drone.create.host',
  ],
};

export const ASSISTANT_THREADS_CAPABILITY: CapabilityDescriptor = {
  id: 'assistant-threads',
  version: 1,
  operations: ['threads.list', 'thread.get', 'thread.create', 'thread.prompt', 'thread.stop'],
};

export const WORKSPACE_CAPABILITY: CapabilityDescriptor = {
  id: 'workspace',
  version: 1,
  operations: ['files.list', 'files.read', 'files.search', 'files.write'],
};

export const PROVIDER_CREDENTIALS_CAPABILITY: CapabilityDescriptor = {
  id: 'provider-credentials',
  version: 1,
  operations: ['credentials.inspect', 'openai.export', 'codex.export'],
};

export function isGranted(
  grants: CapabilityGrant[],
  capability: string,
  version: number,
  operation: string,
): boolean {
  if (capability === DEVICE_CORE_CAPABILITY.id) return true;
  return grants.some(
    (grant) =>
      grant.capability === capability &&
      grant.version === version &&
      (grant.operations.includes(operation) || grant.operations.includes('*')),
  );
}
