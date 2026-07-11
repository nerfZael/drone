import { randomUUID } from "node:crypto";
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type BeforeToolCallContext,
} from "@mariozechner/pi-agent-core";
import {
  createCompaction,
  DEFAULT_COMPACTION_SETTINGS,
  estimateModelContextTokens,
  shouldAutoCompact,
  type CompactionSettings,
} from "./compaction.js";
import type { SessionRepository } from "./session-repository.js";
import { RuntimeTimingTracker } from "./runtime-timing.js";
import type {
  BlipPromptInput,
  BlipSessionContext,
  BlipSessionHandle,
  CreateBlipSessionOptions,
} from "./blip-session-types.js";
import type {
  BlipContextUsage,
  BlipRuntimeEvent,
  BlipSessionState,
} from "./types.js";

type ToolFailure = {
  callId: string;
  tool: string;
  error: string;
};

type ActivePrompt = {
  message: AgentMessage;
  promptText: string;
  turnId: string;
  startedAt: number;
  timing: RuntimeTimingTracker;
  currentTurnStarted: boolean;
  failed: boolean;
  cancelled: boolean;
  cancelRequested: boolean;
  failureMessage: string;
  emittedFailureMessage: string;
  toolFailures: ToolFailure[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function eventBase(
  sessionId: string,
  turnId?: string,
): Pick<BlipRuntimeEvent, "version" | "eventId" | "sessionId" | "timestamp"> & { turnId?: string } {
  return {
    version: 1,
    eventId: randomUUID(),
    sessionId,
    timestamp: nowIso(),
    ...(turnId ? { turnId } : {}),
  };
}

function messageText(message: AgentMessage): string {
  if (message.role === "user") {
    return typeof message.content === "string"
      ? message.content
      : message.content
          .map((item) => (item.type === "text" ? item.text : `[${item.type}]`))
          .join("\n");
  }
  if (message.role === "assistant") {
    return message.content
      .map((item) => (item.type === "text" ? item.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (message.role === "toolResult") {
    return message.content
      .map((item) => (item.type === "text" ? item.text : `[${item.type}]`))
      .join("\n");
  }
  return "";
}

function normalizePrompt(input: BlipPromptInput): AgentMessage {
  if (typeof input === "string") {
    return { role: "user", content: input, timestamp: Date.now() };
  }
  if ("role" in input) return input;
  return {
    role: "user",
    content: [
      { type: "text", text: input.text },
      ...(input.images ?? []),
    ],
    timestamp: Date.now(),
  };
}

function assistantFailure(message: AgentMessage): {
  message: string;
  cancelled: boolean;
} | undefined {
  if (message.role !== "assistant") return undefined;
  if (message.stopReason !== "error" && message.stopReason !== "aborted") return undefined;
  const error = String(message.errorMessage ?? "").trim();
  return {
    message:
      error ||
      (message.stopReason === "aborted"
        ? "Assistant run was aborted"
        : "Assistant run failed without an error message"),
    cancelled: message.stopReason === "aborted",
  };
}

function bashFailureMessage(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const result = details as { exitCode?: unknown; timedOut?: unknown };
  if (result.exitCode === 0 && result.timedOut !== true) return undefined;
  const exitCode =
    result.exitCode === null || typeof result.exitCode === "number"
      ? result.exitCode
      : undefined;
  if (exitCode === undefined && result.timedOut !== true) return undefined;
  if (result.timedOut === true) {
    return `bash timed out${
      exitCode === undefined || exitCode === null ? "" : ` with exit code ${exitCode}`
    }`;
  }
  if (exitCode === null) return "bash exited without an exit code";
  return `bash exited with code ${exitCode}`;
}

function toolResultFailureMessage(
  toolName: string,
  details: unknown,
  fallbackMessage: string,
): string | undefined {
  if (toolName !== "bash") return undefined;
  const failure = bashFailureMessage(details);
  return failure ? `${failure}${fallbackMessage ? `\n\n${fallbackMessage}` : ""}` : undefined;
}

async function resolveSession(
  repository: SessionRepository,
  options: CreateBlipSessionOptions,
): Promise<{ session: BlipSessionState; resumed: boolean }> {
  const nextSettings = {
    provider: options.model.provider,
    model: options.model.id,
    permissionMode: options.permissionMode,
    toolProfile: options.toolProfile,
  };
  if (options.sessionId) {
    const session = await repository.load(options.sessionId);
    Object.assign(session, {
      modelProvider: nextSettings.provider,
      modelId: nextSettings.model,
      permissionMode: nextSettings.permissionMode,
      toolProfile: nextSettings.toolProfile,
    });
    await repository.save(session);
    return { session, resumed: true };
  }
  if (options.forkSessionId) {
    const source = await repository.load(options.forkSessionId);
    return { session: await repository.fork(source, nextSettings), resumed: false };
  }
  if (options.continueLatest || options.resumeLatest) {
    const session = await repository.latest();
    if (session) {
      Object.assign(session, {
        modelProvider: nextSettings.provider,
        modelId: nextSettings.model,
        permissionMode: nextSettings.permissionMode,
        toolProfile: nextSettings.toolProfile,
      });
      await repository.save(session);
      return { session, resumed: true };
    }
  }
  return { session: await repository.create(nextSettings), resumed: false };
}

class BlipSession implements BlipSessionHandle {
  private readonly agent: Agent;
  private readonly unsubscribe: () => void;
  private active?: ActivePrompt;
  private activePromise?: Promise<BlipSessionState>;
  private closed = false;

  private constructor(
    private readonly options: CreateBlipSessionOptions,
    readonly state: BlipSessionState,
    tools: AgentTool<any>[],
    initialMessages: AgentMessage[],
  ) {
    this.agent = new Agent({
      initialState: {
        systemPrompt: "",
        model: options.model,
        thinkingLevel: options.reasoning ?? "medium",
        tools,
        messages: initialMessages,
      },
      sessionId: state.id,
      toolExecution: "parallel",
      getApiKey: options.getApiKey,
      transformContext: options.transformContext,
      convertToLlm: options.convertToLlm,
      beforeToolCall: (context, signal) => this.preflight(context, signal),
    });
    this.unsubscribe = this.agent.subscribe((event) => this.onAgentEvent(event));
  }

  static async create(options: CreateBlipSessionOptions): Promise<BlipSession> {
    const { session, resumed } = await resolveSession(options.sessionRepository, options);
    const context = BlipSession.context(options, session);
    const tools = [...(options.tools ?? [])];
    for (const provider of options.toolProviders ?? []) {
      tools.push(...(await provider.load(context)));
    }
    const seenTools = new Set<string>();
    for (const tool of tools) {
      if (seenTools.has(tool.name)) throw new Error(`duplicate Blip tool: ${tool.name}`);
      seenTools.add(tool.name);
    }
    const instance = new BlipSession(
      options,
      session,
      tools,
      await options.sessionRepository.readModelMessages(session),
    );
    await instance.maybeAutoCompact();
    await instance.refreshSystemPrompt();
    await instance.emit({
      ...eventBase(session.id),
      type: "session_started",
      workspaceRoot: options.workspaceRoot,
      model: `${options.model.provider}/${options.model.id}`,
      permissionMode: options.permissionMode,
      toolProfile: options.toolProfile,
      resumed,
    });
    return instance;
  }

  get running(): boolean {
    return this.activePromise !== undefined;
  }

  prompt(input: BlipPromptInput): Promise<BlipSessionState> {
    if (this.closed) return Promise.reject(new Error("Blip session is closed"));
    if (this.activePromise) {
      return Promise.reject(
        new Error("Blip session is already processing. Use steer() or enqueue()."),
      );
    }
    const message = normalizePrompt(input);
    const promise = this.runPrompt(message);
    this.activePromise = promise;
    return promise;
  }

  steer(input: BlipPromptInput): void {
    if (this.closed) throw new Error("Blip session is closed");
    if (!this.activePromise) throw new Error("Cannot steer an idle Blip session");
    this.agent.steer(normalizePrompt(input));
  }

  enqueue(input: BlipPromptInput): Promise<BlipSessionState> {
    if (this.closed) return Promise.reject(new Error("Blip session is closed"));
    if (!this.activePromise) return this.prompt(input);
    this.agent.followUp(normalizePrompt(input));
    return this.activePromise;
  }

  async compact(settings?: CompactionSettings): Promise<BlipSessionState> {
    if (this.closed) throw new Error("Blip session is closed");
    if (this.activePromise) throw new Error("Cannot compact a running Blip session");
    await this.compactNow("manual", settings ?? this.options.compactionSettings);
    return this.state;
  }

  async delete(): Promise<void> {
    if (this.activePromise) throw new Error("Cannot delete a running Blip session");
    this.close();
    await this.options.sessionRepository.delete(this.state.id);
  }

  clearQueue(): void {
    this.agent.clearAllQueues();
  }

  abort(): void {
    if (this.active) this.active.cancelRequested = true;
    this.agent.abort();
  }

  async waitForIdle(): Promise<void> {
    await this.activePromise;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort();
    this.clearQueue();
    this.unsubscribe();
  }

  private static context(
    options: CreateBlipSessionOptions,
    session: BlipSessionState,
  ): BlipSessionContext {
    return {
      session,
      repository: options.sessionRepository,
      model: options.model,
      workspaceRoot: options.workspaceRoot,
      permissionMode: options.permissionMode,
      toolProfile: options.toolProfile,
    };
  }

  private context(): BlipSessionContext {
    return BlipSession.context(this.options, this.state);
  }

  private async refreshSystemPrompt(): Promise<void> {
    const context = this.context();
    const sections: string[] = [];
    const base = await this.options.promptProvider?.(context);
    if (base?.trim()) sections.push(base.trim());
    for (const provider of this.options.toolProviders ?? []) {
      for (const section of (await provider.promptSections?.(context)) ?? []) {
        if (section.trim()) sections.push(section.trim());
      }
    }
    this.agent.state.systemPrompt = sections.join("\n\n");
  }

  private async preflight(
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<{ block?: boolean; reason?: string } | undefined> {
    if (!this.options.permissionPreflight) return undefined;
    const decision = await this.options.permissionPreflight({
      session: this.state,
      tool: context.toolCall.name,
      callId: context.toolCall.id,
      args: context.args,
      signal,
    });
    return decision.status === "deny"
      ? { block: true, reason: decision.reason }
      : undefined;
  }

  private async emit(event: BlipRuntimeEvent): Promise<void> {
    await this.options.sessionRepository.appendRuntimeEvent(this.state, event);
    await this.options.eventSink?.(event);
  }

  private async recordFailure(message: string, recoverable = false): Promise<void> {
    const active = this.active;
    if (!active) return;
    const normalized = String(message ?? "").trim() || "Blip failed without an error message";
    active.failed = true;
    active.failureMessage = normalized;
    if (normalized === active.emittedFailureMessage) return;
    active.emittedFailureMessage = normalized;
    await this.emit({
      ...eventBase(this.state.id, active.turnId),
      type: "session_error",
      error: normalized,
      recoverable,
    });
  }

  private async onAgentEvent(event: AgentEvent): Promise<void> {
    const active = this.active;
    if (!active) return;
    if (event.type === "turn_start") {
      active.timing.recordTurnStart();
      await this.emit({
        ...eventBase(this.state.id, active.turnId),
        type: "turn_started",
        ...(active.currentTurnStarted ? {} : { prompt: active.promptText }),
      });
      active.currentTurnStarted = true;
      return;
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      await this.emit({
        ...eventBase(this.state.id, active.turnId),
        type: "assistant_delta",
        text: event.assistantMessageEvent.delta,
      });
      return;
    }
    if (event.type === "message_end") {
      await this.options.sessionRepository.appendMessage(this.state, event.message);
      await this.emit({
        ...eventBase(this.state.id, active.turnId),
        type: "transcript_changed",
        role: event.message.role,
      });
      if (event.message.role === "assistant") {
        const text = messageText(event.message);
        if (text.trim()) {
          await this.emit({
            ...eventBase(this.state.id, active.turnId),
            type: "assistant_message",
            messageId: randomUUID(),
            text,
          });
        }
        const failure = assistantFailure(event.message);
        if (failure?.cancelled) {
          active.cancelled = true;
          active.failureMessage = failure.message;
        } else if (failure) {
          await this.recordFailure(failure.message);
        }
      }
      return;
    }
    if (event.type === "tool_execution_start") {
      active.timing.recordToolStart(event.toolCallId, event.toolName);
      await this.emit({
        ...eventBase(this.state.id, active.turnId),
        type: "tool_call_started",
        callId: event.toolCallId,
        tool: event.toolName,
        args: event.args,
      });
      return;
    }
    if (event.type === "tool_execution_update") {
      const progress = messageText({
        role: "toolResult",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: event.partialResult?.content ?? [],
        details: event.partialResult?.details,
        isError: false,
        timestamp: Date.now(),
      }).trim();
      await this.emit({
        ...eventBase(this.state.id, active.turnId),
        type: "tool_call_progress",
        callId: event.toolCallId,
        tool: event.toolName,
        message: progress || "tool progress",
        details: event.partialResult?.details ?? event.partialResult,
      });
      return;
    }
    if (event.type === "tool_execution_end") {
      const resultText = messageText({
        role: "toolResult",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: event.result.content,
        details: event.result.details,
        isError: event.isError,
        timestamp: Date.now(),
      });
      const failure = event.isError
        ? resultText
        : toolResultFailureMessage(event.toolName, event.result.details, resultText);
      active.timing.recordToolEnd(event.toolCallId, event.toolName, Boolean(failure));
      if (failure) {
        active.toolFailures.push({
          callId: event.toolCallId,
          tool: event.toolName,
          error: failure,
        });
        await this.emit({
          ...eventBase(this.state.id, active.turnId),
          type: "tool_call_failed",
          callId: event.toolCallId,
          tool: event.toolName,
          error: failure,
        });
      } else {
        await this.emit({
          ...eventBase(this.state.id, active.turnId),
          type: "tool_call_completed",
          callId: event.toolCallId,
          tool: event.toolName,
          result: event.result.details,
        });
      }
      return;
    }
    if (event.type === "agent_end") {
      for (const message of event.messages) {
        const failure = assistantFailure(message);
        if (failure?.cancelled) {
          active.cancelled = true;
          active.failureMessage = failure.message;
        } else if (failure) {
          await this.recordFailure(failure.message);
        }
      }
    }
  }

  private async maybeAutoCompact(): Promise<void> {
    const entries = await this.options.sessionRepository.readTranscript(this.state);
    const settings = this.options.compactionSettings ?? DEFAULT_COMPACTION_SETTINGS;
    if (!shouldAutoCompact({ entries, contextWindow: this.options.model.contextWindow, settings })) {
      return;
    }
    await this.compactNow("auto", settings, entries);
  }

  private async compactNow(
    trigger: "manual" | "auto",
    settings = DEFAULT_COMPACTION_SETTINGS,
    existingEntries?: Awaited<ReturnType<SessionRepository["readTranscript"]>>,
  ): Promise<void> {
    const entries =
      existingEntries ?? await this.options.sessionRepository.readTranscript(this.state);
    const turnId = `t_${randomUUID().slice(0, 8)}`;
    await this.emit({
      ...eventBase(this.state.id, turnId),
      type: "compaction_started",
      reason: trigger,
    });
    const compaction = await createCompaction({
      session: this.state,
      entries,
      trigger,
      settings,
      model: this.options.model,
      reasoning: this.options.reasoning,
      apiKey: await this.options.getApiKey?.(this.options.model.provider),
    });
    if (!compaction) {
      await this.emit({
        ...eventBase(this.state.id, turnId),
        type: "compaction_skipped",
        reason: "nothing to compact yet",
      });
      return;
    }
    await this.options.sessionRepository.appendEntry(this.state, compaction);
    this.state.compactedSummary = compaction.summary;
    await this.options.sessionRepository.save(this.state);
    this.agent.state.messages = await this.options.sessionRepository.readModelMessages(this.state);
    await this.emit({
      ...eventBase(this.state.id, turnId),
      type: "compaction_completed",
      summaryId: compaction.id,
      tokensBefore: compaction.tokensBefore,
      tokensAfter: compaction.tokensAfterEstimate ?? 0,
    });
  }

  private async contextUsage(): Promise<BlipContextUsage | undefined> {
    const contextWindow = this.options.model.contextWindow;
    if (!contextWindow || contextWindow <= 0) return undefined;
    const tokens = Math.max(
      0,
      estimateModelContextTokens(
        await this.options.sessionRepository.readTranscript(this.state),
      ),
    );
    return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
  }

  private async runPrompt(message: AgentMessage): Promise<BlipSessionState> {
    const startedAt = Date.now();
    const active: ActivePrompt = {
      message,
      promptText: messageText(message),
      turnId: `t_${randomUUID().slice(0, 8)}`,
      startedAt,
      timing: new RuntimeTimingTracker(startedAt),
      currentTurnStarted: false,
      failed: false,
      cancelled: false,
      cancelRequested: false,
      failureMessage: "",
      emittedFailureMessage: "",
      toolFailures: [],
    };
    this.active = active;
    try {
      await this.maybeAutoCompact();
      await this.refreshSystemPrompt();
      await this.options.beforePrompt?.({ ...this.context(), prompt: message });
      if (active.cancelRequested) active.cancelled = true;
      else await this.agent.prompt(message);
    } catch (error) {
      await this.recordFailure(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      try {
        await this.options.afterPrompt?.({ ...this.context(), prompt: message });
        await this.options.sessionRepository.save(this.state);
        const finishedAt = Date.now();
        const status = active.cancelled
          ? "cancelled"
          : active.failed
            ? "error"
            : "completed";
        const contextUsage = await this.contextUsage();
        await this.emit({
          ...eventBase(this.state.id, active.turnId),
          type: "session_finished",
          status,
          changedFiles: this.state.changedFiles,
          durationMs: finishedAt - active.startedAt,
          timing: active.timing.finish(finishedAt),
          ...(contextUsage ? { contextUsage } : {}),
          ...(active.failureMessage ? { error: active.failureMessage } : {}),
          ...(active.toolFailures.length > 0
            ? { toolFailures: active.toolFailures }
            : {}),
        });
        this.scheduleDiagnostics(active.turnId);
      } finally {
        this.active = undefined;
        this.activePromise = undefined;
      }
    }
    return this.state;
  }

  private scheduleDiagnostics(turnId: string): void {
    const delay = this.options.processExitDiagnosticsDelayMs;
    if (!delay || delay <= 0) return;
    const timer = setTimeout(() => {
      const processWithDiagnostics = process as typeof process & {
        _getActiveHandles?: () => unknown[];
        _getActiveRequests?: () => unknown[];
      };
      const summarize = (items: unknown[]) => {
        const counts = new Map<string, number>();
        for (const item of items) {
          const name =
            item && typeof item === "object"
              ? String((item as { constructor?: { name?: string } }).constructor?.name ?? "object")
              : typeof item;
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        return Array.from(counts, ([type, count]) => ({ type, count })).sort(
          (left, right) => right.count - left.count || left.type.localeCompare(right.type),
        );
      };
      void this.emit({
        ...eventBase(this.state.id, turnId),
        type: "process_diagnostics",
        reason: `process still alive ${delay}ms after session_finished`,
        activeHandles: summarize(processWithDiagnostics._getActiveHandles?.() ?? []),
        activeRequests: summarize(processWithDiagnostics._getActiveRequests?.() ?? []),
      }).catch(() => {});
    }, delay);
    timer.unref?.();
  }
}

export async function createBlipSession(
  options: CreateBlipSessionOptions,
): Promise<BlipSessionHandle> {
  return BlipSession.create(options);
}
