import type { AgentToolResult } from '@mariozechner/pi-agent-core';

export type WorkspaceCapability =
  | 'files.list'
  | 'files.read'
  | 'files.search'
  | 'files.write'
  | 'files.delete'
  | 'files.move'
  | 'directories.create'
  | 'directories.delete'
  | 'patch.apply'
  | 'shell.execute'
  | 'git.status';

export interface WorkspaceTargetDescriptor {
  id: string;
  kind: 'local' | 'host' | 'drone' | 'artifacts' | 'remote-device';
  label: string;
  rootLabel: string;
  capabilities: WorkspaceCapability[];
}

export interface WorkspaceTargetCall {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  onUpdate?: (result: AgentToolResult<unknown>) => void;
}

export interface WorkspaceTarget {
  readonly descriptor: WorkspaceTargetDescriptor;
  execute(call: WorkspaceTargetCall): Promise<AgentToolResult<unknown>>;
}

const TOOL_CAPABILITY: Record<string, WorkspaceCapability> = {
  list_files: 'files.list',
  read_file: 'files.read',
  search_files: 'files.search',
  write_file: 'files.write',
  delete_file: 'files.delete',
  move_path: 'files.move',
  create_directory: 'directories.create',
  delete_directory: 'directories.delete',
  apply_patch: 'patch.apply',
  bash: 'shell.execute',
  get_working_tree_status: 'git.status',
};

export function capabilityForWorkspaceTool(tool: string): WorkspaceCapability | undefined {
  return TOOL_CAPABILITY[tool];
}

export class WorkspaceTargetCatalog {
  private activeTargetId: string;
  private activeCalls = 0;
  private readonly targets = new Map<string, WorkspaceTarget>();

  constructor(targets: WorkspaceTarget[], activeTargetId?: string) {
    for (const target of targets) {
      if (this.targets.has(target.descriptor.id)) {
        throw new Error(`duplicate workspace target: ${target.descriptor.id}`);
      }
      this.targets.set(target.descriptor.id, target);
    }
    const first = targets[0]?.descriptor.id;
    this.activeTargetId = activeTargetId ?? first ?? '';
    if (this.activeTargetId && !this.targets.has(this.activeTargetId)) {
      throw new Error(`unknown workspace target: ${this.activeTargetId}`);
    }
  }

  list(): WorkspaceTargetDescriptor[] {
    return Array.from(this.targets.values(), (target) => target.descriptor);
  }

  size(): number {
    return this.targets.size;
  }

  active(): WorkspaceTargetDescriptor | undefined {
    return this.targets.get(this.activeTargetId)?.descriptor;
  }

  setActive(targetId: string): WorkspaceTargetDescriptor {
    const target = this.targets.get(targetId);
    if (!target) throw new Error(`unknown workspace target: ${targetId}`);
    this.activeTargetId = targetId;
    return target.descriptor;
  }

  async setActiveForTool(targetId: string): Promise<WorkspaceTargetDescriptor> {
    await Promise.resolve();
    if (this.activeCalls > 0) {
      throw new Error(
        'cannot change workspace target while filesystem calls are running; call set_target separately',
      );
    }
    return this.setActive(targetId);
  }

  resolve(targetId?: string): WorkspaceTarget {
    const resolvedId = String(targetId ?? '').trim() || this.activeTargetId;
    const target = this.targets.get(resolvedId);
    if (!target) {
      throw new Error(
        resolvedId ? `unknown workspace target: ${resolvedId}` : 'no workspace target selected',
      );
    }
    return target;
  }

  beginCall(targetId?: string): { target: WorkspaceTarget; release: () => void } {
    const target = this.resolve(targetId);
    this.activeCalls += 1;
    let released = false;
    return {
      target,
      release: () => {
        if (released) return;
        released = true;
        this.activeCalls = Math.max(0, this.activeCalls - 1);
      },
    };
  }
}
