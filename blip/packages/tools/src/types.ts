import type { AgentTool } from "@mariozechner/pi-agent-core";

export type PermissionMode = "read-only" | "workspace-write" | "full-access";

export type ToolProfile = "local-trusted-write" | "read-only" | "no-shell-workspace-write";

export type FileOperationKind = "read" | "modified";

export interface BlipToolContext {
  workspaceRoot: string;
  permissionMode: PermissionMode;
  profile: ToolProfile;
  onFileOperation?: (kind: FileOperationKind, path: string) => void;
}

export type BlipTool = AgentTool<any, any>;

export interface ToolTextResult<TDetails = unknown> {
  text: string;
  details: TDetails;
}
