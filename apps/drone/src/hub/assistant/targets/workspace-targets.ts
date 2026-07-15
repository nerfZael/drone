import type {
  WorkspaceCapability,
  WorkspaceTarget,
  WorkspaceTargetCall,
  WorkspaceTargetDescriptor,
} from '@blip/tools';

export type DroneHubWorkspaceExecutor = (call: WorkspaceTargetCall) => Promise<any>;

abstract class DroneHubWorkspaceTarget implements WorkspaceTarget {
  readonly descriptor: WorkspaceTargetDescriptor;

  protected constructor(
    descriptor: Omit<WorkspaceTargetDescriptor, 'capabilities'> & {
      capabilities: WorkspaceCapability[];
    },
    protected readonly executor: DroneHubWorkspaceExecutor,
  ) {
    this.descriptor = descriptor;
  }

  execute(call: WorkspaceTargetCall) {
    return this.executor(call);
  }
}

export class HostWorkspaceTarget extends DroneHubWorkspaceTarget {
  constructor(input: {
    id: string;
    label: string;
    rootLabel: string;
    capabilities: WorkspaceCapability[];
    execute: DroneHubWorkspaceExecutor;
  }) {
    super(
      {
        id: input.id,
        kind: 'host',
        label: input.label,
        rootLabel: input.rootLabel,
        capabilities: input.capabilities,
      },
      input.execute,
    );
  }
}

export class DroneWorkspaceTarget extends DroneHubWorkspaceTarget {
  readonly droneId: string;
  readonly transfer;

  constructor(input: {
    id: string;
    droneId: string;
    label: string;
    rootLabel: string;
    capabilities: WorkspaceCapability[];
    execute: DroneHubWorkspaceExecutor;
  }) {
    super(
      {
        id: input.id,
        kind: 'drone',
        label: input.label,
        rootLabel: input.rootLabel,
        capabilities: input.capabilities,
      },
      input.execute,
    );
    this.droneId = input.droneId;
    const invoke = (tool: string, args: Record<string, unknown>, signal?: AbortSignal) =>
      this.executor({ callId: `transfer_${Date.now()}`, tool, args, signal });
    this.transfer = {
      ...(input.capabilities.includes('files.read')
        ? {
            source: {
              stat: (path: string, signal?: AbortSignal) =>
                invoke('transfer_stat', { path }, signal),
              list: async (path: string, signal?: AbortSignal) =>
                (await invoke('transfer_list', { path }, signal)).entries,
              readChunk: (path: string, offset: number, length: number, signal?: AbortSignal) =>
                invoke('transfer_read', { path, offset, length }, signal),
            },
          }
        : {}),
      ...(input.capabilities.includes('files.write')
        ? {
            destination: {
              createDirectory: async (path: string, signal?: AbortSignal) => {
                await invoke('transfer_mkdir', { path }, signal);
              },
              prepareFile: (args: Record<string, unknown>, signal?: AbortSignal) =>
                invoke('transfer_prepare', args, signal),
              writeChunk: (args: Record<string, unknown>, signal?: AbortSignal) =>
                invoke('transfer_write', args, signal),
              commitFile: async (args: Record<string, unknown>, signal?: AbortSignal) => {
                await invoke('transfer_commit', args, signal);
              },
              abortFile: async (args: Record<string, unknown>, signal?: AbortSignal) => {
                await invoke('transfer_abort', args, signal);
              },
            },
          }
        : {}),
    };
  }
}
