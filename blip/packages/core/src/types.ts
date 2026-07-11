import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { PermissionMode, ToolProfile } from "@blip/tools";
import type { BlipRuntimeEvent } from "@blip/protocol";

export type {
  BlipContextUsage,
  BlipRuntimeEvent,
  BlipRuntimeEventBase,
  BlipSessionStatus,
  BlipSessionTiming,
} from "@blip/protocol";

export interface BlipSessionState {
  id: string;
  workspaceRoot: string;
  modelProvider: string;
  modelId: string;
  permissionMode: PermissionMode;
  toolProfile: ToolProfile;
  loadedSkills: string[];
  transcriptPath: string;
  compactedSummary?: string;
  changedFiles: string[];
  readFiles: string[];
  parentSessionId?: string;
  forkedFromEntryId?: string;
  providerSessionId?: string;
  providerThreadId?: string;
  createdAt: string;
  updatedAt: string;
}

export type TranscriptEntry =
  | { type: "message"; id: string; timestamp: string; message: AgentMessage }
  | { type: "runtime_event"; id: string; timestamp: string; event: BlipRuntimeEvent }
  | {
      type: "compaction";
      id: string;
      createdAt: string;
      trigger: "manual" | "auto";
      tokensBefore: number;
      tokensAfterEstimate?: number;
      firstKeptEntryId: string;
      summary: string;
      details: { readFiles: string[]; modifiedFiles: string[] };
    };

export interface RunBlipOptions {
  prompt: string;
  workspaceRoot: string;
  provider: string;
  model: string;
  permissionMode: PermissionMode;
  toolProfile: ToolProfile;
  sessionId?: string;
  continueLatest?: boolean;
  resumeLatest?: boolean;
  forkSessionId?: string;
  jsonl?: boolean;
  reasoning?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  processExitDiagnosticsDelayMs?: number;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
}
