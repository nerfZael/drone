export type BlipPermissionMode = "read-only" | "workspace-write" | "full-access";
export type BlipToolProfile = "local-trusted-write" | "read-only" | "no-shell-workspace-write";
export type BlipSessionStatus = "completed" | "cancelled" | "error";

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
  toolCallsByName: Record<string, { count: number; completed: number; failed: number; sumMs: number }>;
};

export type BlipContextUsage = { tokens: number; contextWindow: number; percent: number };

export type BlipRuntimeEvent =
  | (BlipRuntimeEventBase & { type: "session_started"; workspaceRoot: string; model: string; permissionMode: BlipPermissionMode; toolProfile: BlipToolProfile; resumed: boolean })
  | (BlipRuntimeEventBase & { type: "turn_started"; prompt?: string })
  | (BlipRuntimeEventBase & { type: "assistant_delta"; text: string })
  | (BlipRuntimeEventBase & { type: "assistant_message"; messageId: string; text: string })
  | (BlipRuntimeEventBase & { type: "transcript_changed"; role: string })
  | (BlipRuntimeEventBase & { type: "tool_call_started"; callId: string; tool: string; args: unknown })
  | (BlipRuntimeEventBase & { type: "tool_call_progress"; callId: string; tool: string; message: string; details?: unknown })
  | (BlipRuntimeEventBase & { type: "tool_call_completed"; callId: string; tool: string; result: unknown })
  | (BlipRuntimeEventBase & { type: "tool_call_failed"; callId: string; tool: string; error: string })
  | (BlipRuntimeEventBase & { type: "process_diagnostics"; reason: string; activeHandles: Array<{ type: string; count: number }>; activeRequests: Array<{ type: string; count: number }> })
  | (BlipRuntimeEventBase & { type: "compaction_started"; reason: string })
  | (BlipRuntimeEventBase & { type: "compaction_skipped"; reason: string })
  | (BlipRuntimeEventBase & { type: "compaction_completed"; summaryId: string; tokensBefore: number; tokensAfter: number })
  | (BlipRuntimeEventBase & { type: "session_error"; error: string; recoverable: boolean })
  | (BlipRuntimeEventBase & { type: "session_finished"; status: BlipSessionStatus; changedFiles: string[]; durationMs: number; timing?: BlipSessionTiming; contextUsage?: BlipContextUsage; error?: string; toolFailures?: Array<{ callId: string; tool: string; error: string }> });

export type BlipHistoryMessage = {
  role: string;
  content: unknown;
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
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

export type BlipRuntimeEventEnvelope = { type: "blip_event"; version: 1; threadId: string; event: BlipRuntimeEvent };

export type BlipPromptStreamEvent =
  | BlipRuntimeEventEnvelope
  | { type: "heartbeat"; at: string }
  | { type: "done" }
  | { type: "error"; error: string };

export type BlipThreadStreamEvent =
  | BlipRuntimeEventEnvelope
  | { type: "connected"; version: 1; threadId: string; running: boolean; at: string };
