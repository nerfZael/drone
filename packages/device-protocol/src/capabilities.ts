import type { CapabilityDescriptor, CapabilityGrant } from './types';

export const DEVICE_CORE_CAPABILITY: CapabilityDescriptor = {
  id: 'device-core',
  version: 1,
  operations: [
    'device.describe',
    'device.ping',
    'diagnostics.chat-load.upload',
    'devices.list',
    'device.rename-self',
    'device.access.update-self',
  ],
};

export const DRONE_CONTROL_OPERATIONS = [
  'drones.list',
  'groups.list',
  'group.create',
  'group.rename',
  'group.delete',
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
  'chat.questions.resolve',
  'chat.message.delete',
  'files.list',
  'file.preview',
  'file.write',
  'file.action',
  'browser.targets',
  'browser.open',
  'browser.close',
  'repo.pull-requests.read',
  'repo.pull-requests.merge',
  'repo.pull-requests.close',
  'drone.create.container',
  'drone.create.host',
  'drone.rename',
  'sidebar.move',
  'sidebar.organize',
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
  operations: [
    'credentials.inspect',
    'openai.export',
    'codex.export',
    'openrouter.export',
    'groq.export',
  ],
};

export const COMPANION_RUN_OPERATIONS = [
  'run.start',
  'run.cancel',
  'tool.result',
  'proposal.result',
] as const;
export const COMPANION_LIVE_OPERATIONS = [
  'live.start',
  'live.event',
  'live.ping',
  'live.close',
  'live.settings.get',
  'live.settings.update',
  'live.prompt.get',
  'live.prompt.update',
] as const;
export const COMPANION_WORKSPACE_OPERATIONS = ['workspaces.list', 'workspaces.update'] as const;

export const COMPANION_CAPABILITY: CapabilityDescriptor = {
  id: 'companion',
  version: 1,
  operations: [...COMPANION_RUN_OPERATIONS, ...COMPANION_WORKSPACE_OPERATIONS, 'workspaces.current', ...COMPANION_LIVE_OPERATIONS, 'auto-approve.settings.get', 'auto-approve.settings.update'],
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
      (grant.operations.includes(operation) || grant.operations.includes('*') ||
        // These operations are part of an already authorized Companion run.
        // Keep existing pairings working when the run protocol gains them;
        // Live controls/writes still need their own grants.
        (capability === COMPANION_CAPABILITY.id && version === COMPANION_CAPABILITY.version &&
          (operation === 'live.settings.get' || operation === 'proposal.result') &&
          grant.operations.includes('run.start')) ||
        // Reading the current workspace reveals nothing beyond the workspace catalog.
        (capability === COMPANION_CAPABILITY.id && version === COMPANION_CAPABILITY.version &&
          operation === 'workspaces.current' && grant.operations.includes('workspaces.list'))),
  );
}
