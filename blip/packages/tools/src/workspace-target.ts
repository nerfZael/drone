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
    this.activeTargetId = activeTargetId ?? first ?? "";
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
    // Yield once so concurrently dispatched filesystem calls can freeze their
    // target before a selection mutation is considered.
    await Promise.resolve();
    if (this.activeCalls > 0) {
      throw new Error("cannot change workspace target while filesystem calls are running; call set_target separately");
    }
    return this.setActive(targetId);
  }

  resolve(targetId?: string): WorkspaceTarget {
    const resolvedId = String(targetId ?? "").trim() || this.activeTargetId;
    const target = this.targets.get(resolvedId);
    if (!target) throw new Error(resolvedId ? `unknown workspace target: ${resolvedId}` : "no workspace target selected");
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
  includeShell?: boolean;
  catalog?: WorkspaceTargetCatalog;
  resolveTarget?: (targetId?: string) => WorkspaceTarget | Promise<WorkspaceTarget>;
  exposeTargetParameter?: boolean;
}): BlipTool[] {
  if (!input.catalog && !input.resolveTarget) throw new Error("workspace target tools require a catalog or target resolver");
  const context = {
    workspaceRoot: process.cwd(),
    permissionMode: input.profile === "read-only" ? "read-only" : "workspace-write",
    profile: input.profile,
  } as BlipToolContext;
  const definitions = createProfileTools(context);
  if (input.includeShell && !definitions.some((tool) => tool.name === "bash")) {
    const bash = createProfileTools({ ...context, profile: "local-trusted-write" }).find((tool) => tool.name === "bash");
    if (bash) definitions.push(bash);
  }
  const exposeTargetParameter = input.exposeTargetParameter ?? (input.catalog?.size() ?? 0) > 1;
  return definitions.map((definition) => {
    const properties = (definition.parameters as { properties?: Record<string, any> }).properties;
    if (!properties) throw new Error(`workspace tool ${definition.name} must use an object parameter schema`);
    const parameters = Type.Object({
      ...properties,
      ...(exposeTargetParameter
        ? { target: Type.Optional(Type.String({ description: "Optional workspace target id; omitted calls use the active target." })) }
        : {}),
    }, { additionalProperties: false });
    return {
      ...definition,
      parameters,
      async execute(callId, args: any, signal, onUpdate) {
        const invocation = input.catalog?.beginCall(exposeTargetParameter ? args.target : undefined);
        try {
          const target = invocation?.target ?? await input.resolveTarget!(exposeTargetParameter ? args.target : undefined);
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
        } finally {
          invocation?.release();
        }
      },
    };
  }) as BlipTool[];
}

/** Creates explicit discovery and selection tools for hosts with multiple workspace targets. */
export function createWorkspaceTargetSelectionTools(catalog: WorkspaceTargetCatalog): BlipTool[] {
  if (catalog.size() <= 1) return [];
  return [{
    name: "list_targets",
    label: "List workspace targets",
    description: "List available workspace targets and identify the active default target.",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute() {
      const active = catalog.active();
      const targets = catalog.list();
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ activeTargetId: active?.id ?? null, targets }, null, 2) }],
        details: { activeTargetId: active?.id ?? null, targets },
      };
    },
  }, {
    name: "set_target",
    label: "Set workspace target",
    description: "Set the active default workspace target for later file, patch, Git, and shell calls.",
    parameters: Type.Object({ target: Type.String({ description: "Workspace target id returned by list_targets." }) }, { additionalProperties: false }),
    async execute(_callId, args: any) {
      const target = await catalog.setActiveForTool(String(args.target ?? "").trim());
      return {
        content: [{ type: "text" as const, text: `Active workspace target set to ${target.label} (${target.id}).` }],
        details: { target },
      };
    },
  }] as BlipTool[];
}
