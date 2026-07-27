export type BlipPermissionMode = "read-only" | "workspace-write" | "full-access";
export type BlipToolProfile = "local-trusted-write" | "read-only" | "no-shell-workspace-write";
export type BlipSessionStatus = "completed" | "cancelled" | "error" | "suspended";

export interface BlipRuntimeEventBase {
  version: 1;
  eventId: string;
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
  longestToolCall?: { callId: string; tool: string; durationMs: number };
  toolCallsByName: Record<
    string,
    { count: number; completed: number; failed: number; sumMs: number }
  >;
};

export type BlipContextUsage = {
  tokens: number;
  contextWindow: number;
  percent: number;
  confidence?: "heuristic";
  breakdown?: {
    systemPrompt: number;
    messages: number;
    toolDefinitions: number;
    images: number;
    providerOverhead: number;
  };
};

export type AgentRunFileChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unmerged"
  | "unknown";

export type AgentRunFileChangeEntry = {
  path: string;
  originalPath?: string | null;
  status: AgentRunFileChangeStatus;
  /** Raw inserted-line count reported by Git; includes lines paired as modifications. */
  additions: number;
  /** Raw deleted-line count reported by Git; includes lines paired as modifications. */
  deletions: number;
  /** Replacement lines inferred by pairing inserted and deleted lines within this file. */
  modified?: number;
  binary?: boolean;
};

export type AgentRunFileChangeCounts = {
  changed: number;
  /** Raw inserted-line count reported by Git; includes lines paired as modifications. */
  additions: number;
  /** Raw deleted-line count reported by Git; includes lines paired as modifications. */
  deletions: number;
  /** Replacement lines inferred per file and summed across the workspace or run. */
  modified?: number;
};

export type AgentRunFileChangeWorkspaceV1 = {
  targetId: string;
  droneId?: string;
  label: string;
  repoRoot: string;
  diffArtifactId?: string;
  counts: AgentRunFileChangeCounts;
  entries: AgentRunFileChangeEntry[];
  truncated?: boolean;
};

export type AgentRunFileChangeWorkspaceV2 = {
  targetId: string;
  droneId?: string;
  label: string;
  diffArtifactId?: string;
  counts: AgentRunFileChangeCounts;
  previewEntries: AgentRunFileChangeEntry[];
  metadataTruncated?: boolean;
};

export type AgentRunFileChangeWorkspace =
  | AgentRunFileChangeWorkspaceV1
  | AgentRunFileChangeWorkspaceV2;

export type AgentRunFileChangesV1 = {
  version: 1;
  capturedAt: string;
  counts: AgentRunFileChangeCounts;
  workspaces: AgentRunFileChangeWorkspaceV1[];
  truncated?: boolean;
};

export type AgentRunFileChangesV2 = {
  version: 2;
  capturedAt: string;
  counts: AgentRunFileChangeCounts;
  workspaces: AgentRunFileChangeWorkspaceV2[];
  metadataTruncated?: boolean;
};

export type AgentRunFileChanges = AgentRunFileChangesV1 | AgentRunFileChangesV2;

export type BlipRuntimeEvent =
  | (BlipRuntimeEventBase & {
      type: "session_started";
      workspaceRoot: string;
      model: string;
      permissionMode: BlipPermissionMode;
      toolProfile: BlipToolProfile;
      resumed: boolean;
    })
  | (BlipRuntimeEventBase & { type: "turn_started"; prompt?: string })
  | (BlipRuntimeEventBase & { type: "assistant_delta"; text: string })
  | (BlipRuntimeEventBase & { type: "assistant_message"; messageId: string; text: string })
  | (BlipRuntimeEventBase & { type: "reasoning_delta"; text: string })
  | (BlipRuntimeEventBase & { type: "reasoning_message"; messageId: string; text: string })
  | (BlipRuntimeEventBase & { type: "transcript_changed"; role: string })
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
      type: "tool_call_suspended";
      suspensionId: string;
      callId: string;
      tool: string;
      reason: string;
      details?: unknown;
      recoveryRequired: boolean;
    })
  | (BlipRuntimeEventBase & {
      type: "tool_call_resolved";
      suspensionId: string;
      callId: string;
      tool: string;
      decision: "approved" | "denied";
      status: "completed" | "denied" | "failed";
    })
  | (BlipRuntimeEventBase & { type: "model_retry"; reason: "context_overflow"; attempt: number })
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
      fallbackUsed?: boolean;
      fallbackReason?: string;
    })
  | (BlipRuntimeEventBase & { type: "session_error"; error: string; recoverable: boolean })
  | (BlipRuntimeEventBase & {
      type: "session_finished";
      status: BlipSessionStatus;
      changedFiles: string[];
      fileChanges?: AgentRunFileChanges;
      durationMs: number;
      timing?: BlipSessionTiming;
      contextUsage?: BlipContextUsage;
      error?: string;
      toolFailures?: Array<{ callId: string; tool: string; error: string }>;
    });

export type BlipHistoryMessage = {
  role: string;
  content: unknown;
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  timestamp?: number;
  isError?: boolean;
  errorMessage?: string;
};

export type BlipHistoryEntry = {
  sequence: number;
  id: string;
  timestamp: string;
  message: BlipHistoryMessage;
};

export type BlipHistoryPage = {
  version: 1;
  threadId: string;
  sessionId: string | null;
  entries: BlipHistoryEntry[];
  page: {
    limit: number;
    beforeCursor: number | null;
    hasOlder: boolean;
  };
};

export type BlipRuntimeEventEnvelope = {
  type: "blip_event";
  version: 1;
  threadId: string;
  event: BlipRuntimeEvent;
};

export type BlipPromptStreamEvent =
  | BlipRuntimeEventEnvelope
  | { type: "heartbeat"; at: string }
  | { type: "done" }
  | { type: "error"; error: string };

export type BlipThreadStreamEvent =
  | BlipRuntimeEventEnvelope
  | { type: "connected"; version: 1; threadId: string; running: boolean; at: string };
