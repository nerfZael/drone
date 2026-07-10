import type {
  WorkspaceCapability,
  WorkspaceTarget,
  WorkspaceTargetCall,
  WorkspaceTargetDescriptor,
} from '@blip/tools';

export type DroneHubWorkspaceExecutor = (
  call: WorkspaceTargetCall,
) => Promise<{ content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>; details: unknown }>;

abstract class DroneHubWorkspaceTarget implements WorkspaceTarget {
  readonly descriptor: WorkspaceTargetDescriptor;

  protected constructor(
    descriptor: Omit<WorkspaceTargetDescriptor, 'capabilities'> & { capabilities: WorkspaceCapability[] },
    private readonly executor: DroneHubWorkspaceExecutor,
  ) {
    this.descriptor = descriptor;
  }

  execute(call: WorkspaceTargetCall) {
    return this.executor(call);
  }
}

export class HostWorkspaceTarget extends DroneHubWorkspaceTarget {
  constructor(input: { id: string; label: string; rootLabel: string; capabilities: WorkspaceCapability[]; execute: DroneHubWorkspaceExecutor }) {
    super({ id: input.id, kind: 'host', label: input.label, rootLabel: input.rootLabel, capabilities: input.capabilities }, input.execute);
  }
}

export class DroneWorkspaceTarget extends DroneHubWorkspaceTarget {
  readonly droneId: string;

  constructor(input: { id: string; droneId: string; label: string; rootLabel: string; capabilities: WorkspaceCapability[]; execute: DroneHubWorkspaceExecutor }) {
    super({ id: input.id, kind: 'drone', label: input.label, rootLabel: input.rootLabel, capabilities: input.capabilities }, input.execute);
    this.droneId = input.droneId;
  }
}
