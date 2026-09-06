export type CapabilityEventPolicy = {
  requiredOperation: string;
  maxPayloadBytes: number;
  maxEventsPerMinute: number;
};

const POLICIES: Readonly<Record<string, CapabilityEventPolicy>> = {
  'drone-control\0drones.changed': {
    requiredOperation: 'drones.list',
    maxPayloadBytes: 8 * 1024,
    maxEventsPerMinute: 120,
  },
  'drone-control\0chat.changed': {
    requiredOperation: 'chat.read',
    maxPayloadBytes: 8 * 1024,
    maxEventsPerMinute: 600,
  },
  'drone-control\0file.changed': {
    requiredOperation: 'file.preview',
    maxPayloadBytes: 8 * 1024,
    maxEventsPerMinute: 120,
  },
  'workspace\0workspaces.changed': {
    requiredOperation: 'workspaces.list',
    maxPayloadBytes: 4 * 1024,
    maxEventsPerMinute: 60,
  },
  'companion\0run.event': {
    requiredOperation: 'run.start',
    maxPayloadBytes: 64 * 1024,
    maxEventsPerMinute: 600,
  },
};

export function capabilityEventPolicy(
  capability: string,
  event: string,
): CapabilityEventPolicy | null {
  return POLICIES[`${capability}\0${event}`] ?? null;
}
