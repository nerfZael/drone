import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { PermissionMode, ToolProfile } from "@blip/tools";

export type BlipSessionStatus = "completed" | "cancelled" | "error";

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

export interface BlipRuntimeEventBase {
  version: 1;
  type: string;
  sessionId: string;
  turnId?: string;
  timestamp: string;
}

export type BlipSessionTiming = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  turnCount: number;
  toolTurnCount: number;
  singleToolTurnCount: number;
  parallelToolTurnCount: number;
  maxToolsInTurn: number;
  toolCallCount: number;
  toolCallCompletedCount: number;
  toolCallFailedCount: number;
  toolCallSumMs: number;
  toolCallWallMs: number;
  nonToolWallMs: number;
  longestToolCall?: {
    callId: string;
    tool: string;
    durationMs: number;
  };
  toolCallsByName: Record<
    string,
    {
      count: number;
      completed: number;
      failed: number;
      sumMs: number;
    }
  >;
};

export type BlipContextUsage = {
  tokens: number;
  contextWindow: number;
  percent: number;
};

export type BlipRuntimeEvent =
  | (BlipRuntimeEventBase & {
      type: "session_started";
      workspaceRoot: string;
      model: string;
      permissionMode: PermissionMode;
      toolProfile: ToolProfile;
      resumed: boolean;
    })
  | (BlipRuntimeEventBase & { type: "turn_started"; prompt?: string })
  | (BlipRuntimeEventBase & { type: "assistant_delta"; text: string })
  | (BlipRuntimeEventBase & { type: "assistant_message"; messageId: string; text: string })
  | (BlipRuntimeEventBase & {
      type: "tool_call_started";
      callId: string;
      tool: string;
      args: unknown;
    })
  | (BlipRuntimeEventBase & {
      type: "tool_call_progress";
      callId: string;
      tool: string;
      message: string;
      details?: unknown;
    })
  | (BlipRuntimeEventBase & {
      type: "tool_call_completed";
      callId: string;
      tool: string;
      result: unknown;
    })
  | (BlipRuntimeEventBase & {
      type: "tool_call_failed";
      callId: string;
      tool: string;
      error: string;
    })
  | (BlipRuntimeEventBase & {
      type: "agent_results_delivered";
      runId: string;
      status: "completed" | "error" | "cancelled";
      agentCount: number;
      message: string;
      details?: unknown;
    })
  | (BlipRuntimeEventBase & {
      type: "process_diagnostics";
      reason: string;
      activeHandles: Array<{ type: string; count: number }>;
      activeRequests: Array<{ type: string; count: number }>;
    })
  | (BlipRuntimeEventBase & { type: "compaction_started"; reason: string })
  | (BlipRuntimeEventBase & { type: "compaction_skipped"; reason: string })
  | (BlipRuntimeEventBase & {
      type: "compaction_completed";
      summaryId: string;
      tokensBefore: number;
      tokensAfter: number;
    })
  | (BlipRuntimeEventBase & { type: "session_error"; error: string; recoverable: boolean })
  | (BlipRuntimeEventBase & {
      type: "session_finished";
      status: BlipSessionStatus;
      changedFiles: string[];
      durationMs: number;
      timing?: BlipSessionTiming;
      contextUsage?: BlipContextUsage;
      error?: string;
      toolFailures?: Array<{ callId: string; tool: string; error: string }>;
    });

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
  agentsEnabled?: boolean;
  processExitDiagnosticsDelayMs?: number;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
}
