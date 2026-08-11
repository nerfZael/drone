import type { CapabilityDescriptor, CapabilityGrant } from './types';

export const DEVICE_CORE_CAPABILITY: CapabilityDescriptor = {
  id: 'device-core',
  version: 1,
  operations: [
    'device.describe',
    'device.ping',
    'devices.list',
    'device.rename-self',
    'device.access.update-self',
  ],
};

export const DRONE_CONTROL_OPERATIONS = [
  'drones.list',
  'chats.list',
  'chat.create',
  'chat.rename',
  'chat.delete',
  'chat.read',
  'chat.models',
  'chat.update',
  'chat.prompt',
  'chat.stop',
  'chat.interruption.resolve',
  'chat.approval.resolve',
  'chat.message.delete',
  'files.list',
  'file.preview',
  'file.write',
  'file.action',
  'repo.pull-requests.read',
  'repo.pull-requests.merge',
  'repo.pull-requests.close',
  'drone.create.container',
  'drone.create.host',
  'drone.rename',
  'sidebar.move',
  'drone.delete',
] as const;

export type DroneControlOperation = (typeof DRONE_CONTROL_OPERATIONS)[number];
export type DroneControlRequest = <Result = unknown>(
  operation: DroneControlOperation,
  payload?: Record<string, unknown>,
) => Promise<Result>;

export const DRONE_CONTROL_CAPABILITY: CapabilityDescriptor = {
  id: 'drone-control',
  version: 1,
  operations: DRONE_CONTROL_OPERATIONS,
};

export const WORKSPACE_CAPABILITY: CapabilityDescriptor = {
  id: 'workspace',
  version: 1,
  operations: [
    'workspaces.list',
    'files.list',
    'files.read',
    'files.search',
    'files.write',
    'files.transfer.stat',
    'files.transfer.list',
    'files.transfer.read',
    'files.transfer.mkdir',
    'files.transfer.prepare',
    'files.transfer.write',
    'files.transfer.commit',
    'files.transfer.abort',
    'commands.run',
    'commands.start',
    'commands.status',
    'commands.output',
    'commands.cancel',
  ],
};

export const PROVIDER_CREDENTIALS_CAPABILITY: CapabilityDescriptor = {
  id: 'provider-credentials',
  version: 1,
  operations: ['credentials.inspect', 'openai.export', 'codex.export', 'groq.export'],
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
