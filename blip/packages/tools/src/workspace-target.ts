import { Type } from "@mariozechner/pi-ai";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { createProfileTools } from "./tools.js";
import type {
  BlipTool,
  BlipToolContext,
  FileOperationKind,
  PermissionMode,
  ToolProfile,
} from "./types.js";

export type WorkspaceCapability =
  | "files.list"
  | "files.read"
  | "files.search"
  | "files.write"
  | "files.delete"
  | "files.move"
  | "directories.create"
  | "directories.delete"
  | "patch.apply"
  | "shell.execute"
  | "git.status";

export interface WorkspaceTargetDescriptor {
  id: string;
  kind: "local" | "host" | "drone" | "artifacts" | "remote-device";
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
  list_files: "files.list",
  read_file: "files.read",
  search_files: "files.search",
  write_file: "files.write",
  delete_file: "files.delete",
  move_path: "files.move",
  create_directory: "directories.create",
  delete_directory: "directories.delete",
  apply_patch: "patch.apply",
  bash: "shell.execute",
  get_working_tree_status: "git.status",
};

export function capabilityForWorkspaceTool(tool: string): WorkspaceCapability | undefined {
  return TOOL_CAPABILITY[tool];
}

export function capabilitiesForProfile(profile: ToolProfile): WorkspaceCapability[] {
  return Array.from(
    new Set(
      createProfileTools({
        workspaceRoot: process.cwd(),
        permissionMode: profile === "read-only" ? "read-only" : "workspace-write",
        profile,
      })
        .map((tool) => capabilityForWorkspaceTool(tool.name))
        .filter((capability): capability is WorkspaceCapability => Boolean(capability)),
    ),
  );
}

export class LocalWorkspaceTarget implements WorkspaceTarget {
  readonly descriptor: WorkspaceTargetDescriptor;
  private readonly tools: Map<string, BlipTool>;

  constructor(input: {
    id?: string;
    label?: string;
    workspaceRoot: string;
    permissionMode: PermissionMode;
    profile: ToolProfile;
    onFileOperation?: (kind: FileOperationKind, path: string) => void;
  }) {
    this.descriptor = {
      id: input.id ?? "local",
      kind: "local",
      label: input.label ?? "Local workspace",
      rootLabel: input.workspaceRoot,
      capabilities: capabilitiesForProfile(input.profile),
    };
    this.tools = new Map(
      createProfileTools({
        workspaceRoot: input.workspaceRoot,
        permissionMode: input.permissionMode,
        profile: input.profile,
        onFileOperation: input.onFileOperation,
      }).map((tool) => [tool.name, tool]),
    );
  }

  async execute(call: WorkspaceTargetCall): Promise<AgentToolResult<unknown>> {
    const tool = this.tools.get(call.tool);
    if (!tool) throw new Error(`workspace target ${this.descriptor.id} does not support ${call.tool}`);
    return tool.execute(call.callId, call.args as never, call.signal, call.onUpdate);
  }
}

export class WorkspaceTargetCatalog {
  private activeTargetId: string;
  private readonly targets = new Map<string, WorkspaceTarget>();

  constructor(targets: WorkspaceTarget[], activeTargetId?: string) {
    for (const target of targets) {
      if (this.targets.has(target.descriptor.id)) {
        throw new Error(`duplicate workspace target: ${target.descriptor.id}`);
      }
      this.targets.set(target.descriptor.id, target);
    }
    const first = targets[0]?.descriptor.id;
    this.activeTargetId = activeTargetId ?? first ?? "";
    if (this.activeTargetId && !this.targets.has(this.activeTargetId)) {
      throw new Error(`unknown workspace target: ${this.activeTargetId}`);
    }
  }

  list(): WorkspaceTargetDescriptor[] {
    return Array.from(this.targets.values(), (target) => target.descriptor);
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

  resolve(targetId?: string): WorkspaceTarget {
    const resolvedId = String(targetId ?? "").trim() || this.activeTargetId;
    const target = this.targets.get(resolvedId);
    if (!target) throw new Error(resolvedId ? `unknown workspace target: ${resolvedId}` : "no workspace target selected");
    return target;
  }
}

function withTargetDetails(result: AgentToolResult<unknown>, target: WorkspaceTargetDescriptor): AgentToolResult<unknown> {
  const details = result.details;
  return {
    ...result,
    details:
      details && typeof details === "object" && !Array.isArray(details)
        ? { ...details, target }
        : { value: details, target },
  };
}

/** Creates the canonical coding tools and dispatches each call through one frozen target resolution. */
export function createWorkspaceTargetTools(input: {
  profile: ToolProfile;
  resolveTarget: (targetId?: string) => WorkspaceTarget | Promise<WorkspaceTarget>;
}): BlipTool[] {
  const definitions = createProfileTools({
    workspaceRoot: process.cwd(),
    permissionMode: input.profile === "read-only" ? "read-only" : "workspace-write",
    profile: input.profile,
  } as BlipToolContext);
  return definitions.map((definition) => ({
    ...definition,
    parameters: Type.Intersect([
      definition.parameters,
      Type.Object({
        target: Type.Optional(Type.String({ description: "Optional workspace target id." })),
      }),
    ]),
    async execute(callId, args: any, signal, onUpdate) {
      const target = await input.resolveTarget(args.target);
      const capability = capabilityForWorkspaceTool(definition.name);
      if (capability && !target.descriptor.capabilities.includes(capability)) {
        throw new Error(`workspace target ${target.descriptor.id} lacks capability ${capability}`);
      }
      const { target: _target, ...targetArgs } = args;
      const result = await target.execute({
        callId,
        tool: definition.name,
        args: targetArgs,
        signal,
        onUpdate: onUpdate as ((result: AgentToolResult<unknown>) => void) | undefined,
      });
      return withTargetDetails(result, target.descriptor);
    },
  })) as BlipTool[];
}
