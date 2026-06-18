import { randomUUID } from "node:crypto";
import { Agent, type AgentEvent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel, getModels, type Model } from "@mariozechner/pi-ai";
import { createProfileTools, type FileOperationKind, type PermissionMode, type ToolProfile } from "@blip/tools";
import { createCompaction, DEFAULT_COMPACTION_SETTINGS, shouldAutoCompact, type CompactionSettings } from "./compaction.js";
import { assembleSystemPrompt } from "./prompts.js";
import { SessionStore } from "./session-store.js";
import type { BlipRuntimeEvent, BlipSessionState, RunBlipOptions } from "./types.js";

type RuntimeSink = (event: BlipRuntimeEvent) => Promise<void> | void;

function nowIso(): string {
  return new Date().toISOString();
}

function eventBase(sessionId: string, turnId?: string): Pick<BlipRuntimeEvent, "version" | "sessionId" | "timestamp"> & { turnId?: string } {
  return {
    version: 1,
    sessionId,
    timestamp: nowIso(),
    ...(turnId ? { turnId } : {}),
  };
}

function messageText(message: AgentMessage): string {
  if (message.role === "user") {
    return typeof message.content === "string"
      ? message.content
      : message.content.map((item) => (item.type === "text" ? item.text : `[${item.type}]`)).join("\n");
  }
  if (message.role === "assistant") {
    return message.content.map((item) => (item.type === "text" ? item.text : item.type === "toolCall" ? `[tool:${item.name}]` : "")).join("\n");
  }
  if (message.role === "toolResult") {
    return message.content.map((item) => (item.type === "text" ? item.text : `[${item.type}]`)).join("\n");
  }
  return "";
}

function assistantFailureMessage(message: AgentMessage): string | undefined {
  if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "assistant") return undefined;
  const stopReason = String((message as { stopReason?: unknown }).stopReason ?? "").trim();
  if (stopReason !== "error" && stopReason !== "aborted") return undefined;
  const errorMessage = String((message as { errorMessage?: unknown }).errorMessage ?? "").trim();
  if (errorMessage) return errorMessage;
  return stopReason === "aborted" ? "Assistant run was aborted" : "Assistant run failed without an error message";
}

function resolveModel(provider: string, modelId: string): Model<any> {
  const model = getModel(provider as any, modelId as any);
  if (model) return model as Model<any>;
  if (provider === "faux") {
    return {
      id: modelId,
      name: modelId,
      provider: "faux",
      api: "faux",
      baseUrl: "http://localhost:0",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
    } satisfies Model<any>;
  }
  const available = getModels(provider as any).map((item) => item.id).slice(0, 10);
  throw new Error(`unknown model ${provider}/${modelId}${available.length ? `; examples: ${available.join(", ")}` : ""}`);
}

export function defaultToolProfile(permissionMode: PermissionMode, shellAvailable = true): ToolProfile {
  if (permissionMode === "read-only") return "read-only";
  return shellAvailable ? "local-trusted-write" : "no-shell-workspace-write";
}

async function resolveSession(store: SessionStore, options: RunBlipOptions): Promise<{ session: BlipSessionState; resumed: boolean }> {
  if (options.sessionId) {
    const session = await store.load(options.sessionId);
    session.modelProvider = options.provider;
    session.modelId = options.model;
    session.permissionMode = options.permissionMode;
    session.toolProfile = options.toolProfile;
    await store.save(session);
    return { session, resumed: true };
  }

  if (options.forkSessionId) {
    const source = await store.load(options.forkSessionId);
    const session = await store.fork(source, {
      provider: options.provider,
      model: options.model,
      permissionMode: options.permissionMode,
      toolProfile: options.toolProfile,
    });
    return { session, resumed: false };
  }

  if (options.continueLatest || options.resumeLatest) {
    const latest = await store.latest();
    if (latest) {
      latest.modelProvider = options.provider;
      latest.modelId = options.model;
      latest.permissionMode = options.permissionMode;
      latest.toolProfile = options.toolProfile;
      await store.save(latest);
      return { session: latest, resumed: true };
    }
  }

  return {
    session: await store.create({
      provider: options.provider,
      model: options.model,
      permissionMode: options.permissionMode,
      toolProfile: options.toolProfile,
    }),
    resumed: false,
  };
}

export async function compactSession(input: {
  workspaceRoot: string;
  sessionId?: string;
  trigger?: "manual" | "auto";
  settings?: CompactionSettings;
  model?: Model<any>;
  reasoning?: RunBlipOptions["reasoning"];
  getApiKey?: RunBlipOptions["getApiKey"];
  onEvent?: RuntimeSink;
}): Promise<BlipSessionState> {
  const store = new SessionStore(input.workspaceRoot);
  const session = input.sessionId ? await store.load(input.sessionId) : (await store.latest());
  if (!session) throw new Error("no session found to compact");
  const turnId = `t_${randomUUID().slice(0, 8)}`;
  const started: BlipRuntimeEvent = { ...eventBase(session.id, turnId), type: "compaction_started", reason: input.trigger ?? "manual" };
  await store.appendRuntimeEvent(session, started);
  await input.onEvent?.(started);
  const entries = await store.readTranscript(session);
  const model = input.model ?? resolveModel(session.modelProvider, session.modelId);
  const apiKey = await input.getApiKey?.(model.provider);
  const compaction = await createCompaction({
    session,
    entries,
    trigger: input.trigger ?? "manual",
    settings: input.settings,
    model,
    reasoning: input.reasoning,
    apiKey,
  });
  if (!compaction) {
    const skipped: BlipRuntimeEvent = { ...eventBase(session.id, turnId), type: "compaction_skipped", reason: "nothing to compact yet" };
    await store.appendRuntimeEvent(session, skipped);
    await input.onEvent?.(skipped);
    return session;
  }
  await store.appendEntry(session, compaction);
  session.compactedSummary = compaction.summary;
  await store.save(session);
  const completed: BlipRuntimeEvent = {
    ...eventBase(session.id, turnId),
    type: "compaction_completed",
    summaryId: compaction.id,
    tokensBefore: compaction.tokensBefore,
    tokensAfter: compaction.tokensAfterEstimate ?? 0,
  };
  await store.appendRuntimeEvent(session, completed);
  await input.onEvent?.(completed);
  return session;
}

export async function runBlipTask(options: RunBlipOptions, onEvent?: RuntimeSink): Promise<BlipSessionState> {
  const startedAt = Date.now();
  const store = new SessionStore(options.workspaceRoot);
  const { session, resumed } = await resolveSession(store, options);
  const model = resolveModel(options.provider, options.model);
  const turnId = `t_${randomUUID().slice(0, 8)}`;

  const transcript = await store.readTranscript(session);
  if (shouldAutoCompact({ entries: transcript, contextWindow: model.contextWindow, settings: DEFAULT_COMPACTION_SETTINGS })) {
    const compacted = await compactSession({
      workspaceRoot: options.workspaceRoot,
      sessionId: session.id,
      trigger: "auto",
      settings: DEFAULT_COMPACTION_SETTINGS,
      model,
      reasoning: options.reasoning,
      getApiKey: options.getApiKey,
      onEvent,
    });
    Object.assign(session, compacted);
  }

  const readFiles = new Set(session.readFiles);
  const changedFiles = new Set(session.changedFiles);
  const tools = createProfileTools({
    workspaceRoot: options.workspaceRoot,
    permissionMode: options.permissionMode,
    profile: options.toolProfile,
    onFileOperation(kind: FileOperationKind, filePath: string) {
      if (kind === "read") readFiles.add(filePath);
      else changedFiles.add(filePath);
    },
  });

  const messages = await store.readModelMessages(session);
  const systemPrompt = await assembleSystemPrompt({
    workspaceRoot: options.workspaceRoot,
    toolProfile: options.toolProfile,
  });

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: options.reasoning ?? "medium",
      tools,
      messages,
    },
    sessionId: session.id,
    toolExecution: "sequential",
    getApiKey: options.getApiKey,
  });

  async function emit(event: BlipRuntimeEvent): Promise<void> {
    await store.appendRuntimeEvent(session, event);
    await onEvent?.(event);
  }

  await emit({
    ...eventBase(session.id, turnId),
    type: "session_started",
    workspaceRoot: options.workspaceRoot,
    model: `${options.provider}/${options.model}`,
    permissionMode: options.permissionMode,
    toolProfile: options.toolProfile,
    resumed,
  });

  let currentTurnStarted = false;
  let failed = false;
  let failureMessage = "";
  let emittedFailureMessage = "";
  async function recordFailure(error: string, recoverable = false): Promise<void> {
    const message = String(error ?? "").trim() || "Blip failed without an error message";
    failed = true;
    failureMessage = message;
    if (message === emittedFailureMessage) return;
    emittedFailureMessage = message;
    await emit({
      ...eventBase(session.id, turnId),
      type: "session_error",
      error: message,
      recoverable,
    });
  }

  agent.subscribe(async (event: AgentEvent) => {
    if (event.type === "turn_start") {
      await emit({ ...eventBase(session.id, turnId), type: "turn_started", ...(currentTurnStarted ? {} : { prompt: options.prompt }) });
      currentTurnStarted = true;
    } else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      await emit({ ...eventBase(session.id, turnId), type: "assistant_delta", text: event.assistantMessageEvent.delta });
    } else if (event.type === "message_end") {
      await store.appendMessage(session, event.message);
      if (event.message.role === "assistant") {
        await emit({
          ...eventBase(session.id, turnId),
          type: "assistant_message",
          messageId: randomUUID(),
          text: messageText(event.message),
        });
        const assistantError = assistantFailureMessage(event.message);
        if (assistantError) await recordFailure(assistantError);
      }
    } else if (event.type === "tool_execution_start") {
      await emit({
        ...eventBase(session.id, turnId),
        type: "tool_call_started",
        callId: event.toolCallId,
        tool: event.toolName,
        args: event.args,
      });
    } else if (event.type === "tool_execution_update") {
      await emit({
        ...eventBase(session.id, turnId),
        type: "tool_call_progress",
        callId: event.toolCallId,
        tool: event.toolName,
        message: "tool progress",
        details: event.partialResult,
      });
    } else if (event.type === "tool_execution_end") {
      if (event.isError) {
        const toolError = messageText({
          role: "toolResult",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          content: event.result.content,
          details: event.result.details,
          isError: true,
          timestamp: Date.now(),
        });
        failed = true;
        await emit({
          ...eventBase(session.id, turnId),
          type: "tool_call_failed",
          callId: event.toolCallId,
          tool: event.toolName,
          error: toolError,
        });
        failureMessage ||= toolError;
      } else {
        await emit({
          ...eventBase(session.id, turnId),
          type: "tool_call_completed",
          callId: event.toolCallId,
          tool: event.toolName,
          result: event.result.details,
        });
      }
    } else if (event.type === "agent_end") {
      for (const message of event.messages) {
        const assistantError = assistantFailureMessage(message);
        if (assistantError) await recordFailure(assistantError);
      }
    }
  });

  try {
    await agent.prompt(options.prompt);
  } catch (error) {
    await recordFailure(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    session.readFiles = Array.from(readFiles).sort();
    session.changedFiles = Array.from(changedFiles).sort();
    await store.save(session);
    await emit({
      ...eventBase(session.id, turnId),
      type: "session_finished",
      status: failed ? "error" : "completed",
      changedFiles: session.changedFiles,
      durationMs: Date.now() - startedAt,
      ...(failureMessage ? { error: failureMessage } : {}),
    });
  }

  return session;
}
