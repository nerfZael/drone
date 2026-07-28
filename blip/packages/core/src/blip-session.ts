import {
  Agent,
  agentToolErrorResult,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type BeforeToolCallContext,
  executeAgentTool,
} from '@mariozechner/pi-agent-core/portable';
import { validateToolArguments } from '@mariozechner/pi-ai/agent-core';
import type { CompactionSettings } from './compaction.js';
import { BlipContextManager } from './context-manager.js';
import type { SessionRepository } from './session-repository.js';
import { RuntimeTimingTracker } from './runtime-timing.js';
import type {
  BlipPromptInput,
  BlipSessionContext,
  BlipSessionHandle,
  CreateBlipSessionOptions,
} from './blip-session-types.js';
import type { BlipRuntimeEvent, BlipSessionState, BlipToolSuspension } from './types.js';
import { createPortableId } from './platform.js';
import { ToolSuspensionWorkflow } from './tool-suspension-workflow.js';

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
  suspended: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function eventBase(
  sessionId: string,
  turnId?: string,
): Pick<BlipRuntimeEvent, 'version' | 'eventId' | 'sessionId' | 'timestamp'> & { turnId?: string } {
  return {
    version: 1,
    eventId: createPortableId(),
    sessionId,
    timestamp: nowIso(),
    ...(turnId ? { turnId } : {}),
  };
}

function messageText(message: AgentMessage): string {
  if (message.role === 'user') {
    return typeof message.content === 'string'
      ? message.content
      : message.content
          .map((item) => (item.type === 'text' ? item.text : `[${item.type}]`))
          .join('\n');
  }
  if (message.role === 'assistant') {
    return message.content
      .map((item) => (item.type === 'text' ? item.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (message.role === 'toolResult') {
    return message.content
      .map((item) => (item.type === 'text' ? item.text : `[${item.type}]`))
      .join('\n');
  }
  return '';
}

function messageReasoning(message: AgentMessage): string {
  if (message.role !== 'assistant') return '';
  return message.content
    .map((item) => (item.type === 'thinking' ? item.thinking : ''))
    .filter(Boolean)
    .join('\n');
}

function normalizePrompt(input: BlipPromptInput): AgentMessage {
  if (typeof input === 'string') {
    return { role: 'user', content: input, timestamp: Date.now() };
  }
  if ('role' in input) return input;
  return {
    role: 'user',
    content: [{ type: 'text', text: input.text }, ...(input.images ?? [])],
    timestamp: Date.now(),
  };
}

function assistantFailure(message: AgentMessage):
  | {
      message: string;
      cancelled: boolean;
      recoverable: boolean;
    }
  | undefined {
  if (message.role !== 'assistant') return undefined;
  if (message.stopReason !== 'error' && message.stopReason !== 'aborted') return undefined;
  const error = String(message.errorMessage ?? '').trim();
  const diagnosticText = (message.diagnostics ?? [])
    .flatMap((diagnostic) => {
      const values: string[] = [diagnostic.type];
      let current = diagnostic.error;
      let depth = 0;
      while (current && depth < 4) {
        values.push(String(current.code ?? ''), current.message);
        current = current.cause;
        depth += 1;
      }
      return values;
    })
    .join(' ');
  const failureText = `${error} ${diagnosticText}`;
  const recoverable =
    message.stopReason === 'error' &&
    (/provider_transport_failure/i.test(diagnosticText) ||
      /\b(fetch failed|econnreset|etimedout|enotfound|eai_again|und_err_(?:connect_timeout|headers_timeout|body_timeout|socket))\b/i.test(
        failureText,
      ) ||
      /\b(connection reset|socket hang up|timed? out|temporary network|network connection)\b/i.test(
        failureText,
      ));
  return {
    message:
      error ||
      (message.stopReason === 'aborted'
        ? 'Assistant run was aborted'
        : 'Assistant run failed without an error message'),
    cancelled: message.stopReason === 'aborted',
    recoverable,
  };
}

function retryableAssistantFailure(message: AgentMessage): boolean {
  const failure = assistantFailure(message);
  if (!failure?.recoverable || message.role !== 'assistant') return false;
  return !message.content.some((part) => part.type === 'toolCall');
}

function bashFailureMessage(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const result = details as { exitCode?: unknown; timedOut?: unknown };
  if (result.exitCode === 0 && result.timedOut !== true) return undefined;
  const exitCode =
    result.exitCode === null || typeof result.exitCode === 'number' ? result.exitCode : undefined;
  if (exitCode === undefined && result.timedOut !== true) return undefined;
  if (result.timedOut === true) {
    return `bash timed out${
      exitCode === undefined || exitCode === null ? '' : ` with exit code ${exitCode}`
    }`;
  }
  if (exitCode === null) return 'bash exited without an exit code';
  return `bash exited with code ${exitCode}`;
}

function toolResultFailureMessage(
  toolName: string,
  details: unknown,
  fallbackMessage: string,
): string | undefined {
  if (toolName !== 'bash') return undefined;
  const failure = bashFailureMessage(details);
  return failure ? `${failure}${fallbackMessage ? `\n\n${fallbackMessage}` : ''}` : undefined;
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
  private readonly contextManager: BlipContextManager;
  private readonly toolSuspensions: ToolSuspensionWorkflow;
  private readonly unsubscribe: () => void;
  private active?: ActivePrompt;
  private activePromise?: Promise<BlipSessionState>;
  private resolutionAbortController?: AbortController;
  private closed = false;

  private constructor(
    private readonly options: CreateBlipSessionOptions,
    readonly state: BlipSessionState,
    tools: AgentTool<any>[],
    initialMessages: AgentMessage[],
  ) {
    this.agent = new Agent({
      initialState: {
        systemPrompt: '',
        model: options.model,
        thinkingLevel: options.reasoning ?? 'medium',
        tools,
        messages: initialMessages,
      },
      sessionId: state.id,
      toolExecution: 'parallel',
      getApiKey: options.getApiKey,
      onResponse: options.onResponse,
      streamFn: options.streamFn,
      transformContext: options.transformContext,
      convertToLlm: options.convertToLlm,
      beforeModelCall: (context, signal) => this.contextManager.beforeModelCall(context, signal),
      beforeToolCall: (context, signal) => this.preflight(context, signal),
    });
    this.contextManager = new BlipContextManager({
      state,
      repository: options.sessionRepository,
      model: options.model,
      reasoning: options.reasoning,
      settings: options.compactionSettings,
      streamFn: options.streamFn,
      getApiKey: options.getApiKey,
      emit: (event) => this.emit(event),
      activeTurnId: () => this.active?.turnId,
      systemPrompt: () => this.agent.state.systemPrompt,
      tools: () => this.agent.state.tools,
      replaceAgentMessages: (messages) => {
        this.agent.state.messages = messages;
      },
    });
    this.toolSuspensions = new ToolSuspensionWorkflow({
      state,
      repository: options.sessionRepository,
      emit: (event) => this.emit(event),
      activeTurnId: () => this.active?.turnId,
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
    await instance.refreshSystemPrompt();
    await instance.emit({
      ...eventBase(session.id),
      type: 'session_started',
      workspaceRoot: options.workspaceRoot,
      model: `${options.model.provider}/${options.model.id}`,
      permissionMode: options.permissionMode,
      toolProfile: options.toolProfile,
      resumed,
    });
    const recovery = await instance.toolSuspensions.recover();
    instance.agent.state.messages = recovery.messages;
    if (recovery.continuationRequired) {
      const continuation = instance.runRecoveredContinuation();
      instance.activePromise = continuation;
      await continuation;
    }
    return instance;
  }

  get running(): boolean {
    return this.activePromise !== undefined;
  }

  prompt(input: BlipPromptInput): Promise<BlipSessionState> {
    if (this.closed) return Promise.reject(new Error('Blip session is closed'));
    if (this.activePromise) {
      return Promise.reject(
        new Error('Blip session is already processing. Use steer() or enqueue().'),
      );
    }
    const message = normalizePrompt(input);
    const promise = this.runPrompt(message);
    this.activePromise = promise;
    return promise;
  }

  retry(): Promise<BlipSessionState> {
    if (this.closed) return Promise.reject(new Error('Blip session is closed'));
    if (this.activePromise) {
      return Promise.reject(new Error('Blip session is already processing'));
    }
    const promise = this.runRetry();
    this.activePromise = promise;
    void promise
      .finally(() => {
        if (this.activePromise === promise) this.activePromise = undefined;
      })
      .catch(() => undefined);
    return promise;
  }

  steer(input: BlipPromptInput): void {
    if (this.closed) throw new Error('Blip session is closed');
    if (!this.activePromise) throw new Error('Cannot steer an idle Blip session');
    this.agent.steer(normalizePrompt(input));
  }

  enqueue(input: BlipPromptInput): Promise<BlipSessionState> {
    if (this.closed) return Promise.reject(new Error('Blip session is closed'));
    if (!this.activePromise) return this.prompt(input);
    this.agent.followUp(normalizePrompt(input));
    return this.activePromise;
  }

  async compact(settings?: CompactionSettings): Promise<BlipSessionState> {
    if (this.closed) throw new Error('Blip session is closed');
    if (this.activePromise) throw new Error('Cannot compact a running Blip session');
    await this.contextManager.compact(settings);
    return this.state;
  }

  async pendingToolSuspensions(): Promise<BlipToolSuspension[]> {
    return this.toolSuspensions.pending();
  }

  resolveToolSuspension(
    suspensionId: string,
    decision: 'approve' | 'deny',
  ): Promise<BlipSessionState> {
    if (this.closed) return Promise.reject(new Error('Blip session is closed'));
    if (this.activePromise) {
      return Promise.reject(new Error('Blip session is already processing'));
    }
    const promise = this.runToolSuspensionResolution(suspensionId, decision);
    this.activePromise = promise;
    return promise;
  }

  async delete(): Promise<void> {
    if (this.activePromise) throw new Error('Cannot delete a running Blip session');
    this.close();
    await this.options.sessionRepository.delete(this.state.id);
  }

  clearQueue(): void {
    this.agent.clearAllQueues();
  }

  abort(): void {
    if (this.active) this.active.cancelRequested = true;
    this.contextManager.abort();
    this.resolutionAbortController?.abort();
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
    this.agent.state.systemPrompt = sections.join('\n\n');
  }

  private async preflight(
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<
    | {
        block?: boolean;
        reason?: string;
        suspend?: {
          suspended: true;
          id: string;
          reason: string;
          details?: unknown;
        };
      }
    | undefined
  > {
    if (!this.options.permissionPreflight) return undefined;
    const decision = await this.options.permissionPreflight({
      session: this.state,
      tool: context.toolCall.name,
      callId: context.toolCall.id,
      args: context.args,
      signal,
      phase: 'initial',
    });
    if (decision.status === 'deny') return { block: true, reason: decision.reason };
    if (decision.status === 'suspend') {
      return {
        suspend: {
          suspended: true,
          id: decision.id ?? `sus_${createPortableId()}`,
          reason: decision.reason,
          details: decision.details,
        },
      };
    }
    return undefined;
  }

  private async emit(event: BlipRuntimeEvent): Promise<void> {
    await this.options.sessionRepository.appendRuntimeEvent(this.state, event);
    await this.options.eventSink?.(event);
  }

  private async recordFailure(message: string, recoverable = false): Promise<void> {
    const active = this.active;
    if (!active) return;
    const normalized = String(message ?? '').trim() || 'Blip failed without an error message';
    active.failed = true;
    active.failureMessage = normalized;
    if (normalized === active.emittedFailureMessage) return;
    active.emittedFailureMessage = normalized;
    await this.emit({
      ...eventBase(this.state.id, active.turnId),
      type: 'session_error',
      error: normalized,
      recoverable,
    });
  }

  private async onAgentEvent(event: AgentEvent): Promise<void> {
    const active = this.active;
    if (!active) return;
    if (event.type === 'message_retry') {
      await this.emit({
        ...eventBase(this.state.id, active.turnId),
        type: 'model_retry',
        reason: event.reason,
        attempt: event.attempt,
      });
      return;
    }
    if (event.type === 'tool_execution_suspended') {
      const at = nowIso();
      const suspension: BlipToolSuspension = {
        ...event.suspension,
        status: 'pending',
        createdAt: at,
        updatedAt: at,
        attempt: 0,
      };
      await this.options.sessionRepository.appendToolSuspension(this.state, suspension);
      active.suspended = true;
      await this.emit({
        ...eventBase(this.state.id, active.turnId),
        type: 'tool_call_suspended',
        suspensionId: suspension.id,
        callId: suspension.toolCallId,
        tool: suspension.toolName,
        reason: suspension.reason,
        details: suspension.details,
        recoveryRequired: false,
      });
      return;
    }
    if (event.type === 'turn_start') {
      active.timing.recordTurnStart();
      await this.emit({
        ...eventBase(this.state.id, active.turnId),
        type: 'turn_started',
        ...(active.currentTurnStarted ? {} : { prompt: active.promptText }),
      });
      active.currentTurnStarted = true;
      return;
    }
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      await this.emit({
        ...eventBase(this.state.id, active.turnId),
        type: 'assistant_delta',
        text: event.assistantMessageEvent.delta,
      });
      return;
    }
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_delta') {
      await this.emit({
        ...eventBase(this.state.id, active.turnId),
        type: 'reasoning_delta',
        text: event.assistantMessageEvent.delta,
      });
      return;
    }
    if (event.type === 'message_end') {
      await this.options.sessionRepository.appendMessage(this.state, event.message);
      await this.emit({
        ...eventBase(this.state.id, active.turnId),
        type: 'transcript_changed',
        role: event.message.role,
      });
      if (event.message.role === 'assistant') {
        const reasoning = messageReasoning(event.message);
        if (reasoning.trim()) {
          await this.emit({
            ...eventBase(this.state.id, active.turnId),
            type: 'reasoning_message',
            messageId: createPortableId(),
            text: reasoning,
          });
        }
        const text = messageText(event.message);
        if (text.trim()) {
          await this.emit({
            ...eventBase(this.state.id, active.turnId),
            type: 'assistant_message',
            messageId: createPortableId(),
            text,
          });
        }
        const failure = assistantFailure(event.message);
        if (failure?.cancelled) {
          active.cancelled = true;
          active.failureMessage = failure.message;
        } else if (failure) {
          await this.recordFailure(failure.message, failure.recoverable);
        }
      }
      return;
    }
    if (event.type === 'tool_execution_start') {
      active.timing.recordToolStart(event.toolCallId, event.toolName);
      await this.emit({
        ...eventBase(this.state.id, active.turnId),
        type: 'tool_call_started',
        callId: event.toolCallId,
        tool: event.toolName,
        args: event.args,
      });
      return;
    }
    if (event.type === 'tool_execution_update') {
      const progress = messageText({
        role: 'toolResult',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: event.partialResult?.content ?? [],
        details: event.partialResult?.details,
        isError: false,
        timestamp: Date.now(),
      }).trim();
      await this.emit({
        ...eventBase(this.state.id, active.turnId),
        type: 'tool_call_progress',
        callId: event.toolCallId,
        tool: event.toolName,
        message: progress || 'tool progress',
        details: event.partialResult?.details ?? event.partialResult,
      });
      return;
    }
    if (event.type === 'tool_execution_end') {
      const resultText = messageText({
        role: 'toolResult',
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
          type: 'tool_call_failed',
          callId: event.toolCallId,
          tool: event.toolName,
          error: failure,
        });
      } else {
        await this.emit({
          ...eventBase(this.state.id, active.turnId),
          type: 'tool_call_completed',
          callId: event.toolCallId,
          tool: event.toolName,
          result: event.result.details,
        });
      }
      return;
    }
    if (event.type === 'agent_end') {
      for (const message of event.messages) {
        const failure = assistantFailure(message);
        if (failure?.cancelled) {
          active.cancelled = true;
          active.failureMessage = failure.message;
        } else if (failure) {
          await this.recordFailure(failure.message, failure.recoverable);
        }
      }
    }
  }

  private createActive(message: AgentMessage): ActivePrompt {
    const startedAt = Date.now();
    return {
      message,
      promptText: messageText(message),
      turnId: `t_${createPortableId().slice(0, 8)}`,
      startedAt,
      timing: new RuntimeTimingTracker(startedAt),
      currentTurnStarted: false,
      failed: false,
      cancelled: false,
      cancelRequested: false,
      failureMessage: '',
      emittedFailureMessage: '',
      toolFailures: [],
      suspended: false,
    };
  }

  private async finishActive(active: ActivePrompt): Promise<void> {
    try {
      const lifecycleResult = await this.options.afterPrompt?.({
        ...this.context(),
        prompt: active.message,
        turnId: active.turnId,
      });
      await this.options.sessionRepository.save(this.state);
      const finishedAt = Date.now();
      const status = active.cancelled
        ? 'cancelled'
        : active.failed
          ? 'error'
          : active.suspended
            ? 'suspended'
            : 'completed';
      const contextUsage = await this.contextManager.contextUsage();
      await this.emit({
        ...eventBase(this.state.id, active.turnId),
        type: 'session_finished',
        status,
        changedFiles: this.state.changedFiles,
        ...(lifecycleResult?.fileChanges ? { fileChanges: lifecycleResult.fileChanges } : {}),
        durationMs: finishedAt - active.startedAt,
        timing: active.timing.finish(finishedAt),
        ...(contextUsage ? { contextUsage } : {}),
        ...(active.failureMessage ? { error: active.failureMessage } : {}),
        ...(active.toolFailures.length > 0 ? { toolFailures: active.toolFailures } : {}),
      });
      this.scheduleDiagnostics(active.turnId);
    } finally {
      this.active = undefined;
      this.activePromise = undefined;
    }
  }

  private async runRecoveredContinuation(): Promise<BlipSessionState> {
    const message: AgentMessage = {
      role: 'user',
      content: 'Resume after a durably recovered tool result.',
      timestamp: Date.now(),
    };
    const active = this.createActive(message);
    // This is a continuation, not a new visible prompt.
    active.currentTurnStarted = true;
    this.active = active;
    try {
      await this.options.beforePrompt?.({
        ...this.context(),
        prompt: message,
        turnId: active.turnId,
      });
      await this.agent.continue();
    } catch (error) {
      await this.recordFailure(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      await this.finishActive(active);
    }
    return this.state;
  }

  private async runRetry(): Promise<BlipSessionState> {
    const messages = await this.options.sessionRepository.readModelMessages(this.state);
    let removedFailures = 0;
    while (messages.length > 0 && retryableAssistantFailure(messages[messages.length - 1]!)) {
      messages.pop();
      removedFailures += 1;
    }
    if (removedFailures === 0) {
      throw new Error('The latest native agent failure is not retryable');
    }
    const resumeFrom = messages[messages.length - 1];
    if (!resumeFrom || (resumeFrom.role !== 'user' && resumeFrom.role !== 'toolResult')) {
      throw new Error('The native agent has no safe response checkpoint to continue from');
    }

    const lifecycleMessage: AgentMessage = {
      role: 'user',
      content: 'Continue a recoverable native agent response.',
      timestamp: Date.now(),
    };
    const active = this.createActive(lifecycleMessage);
    active.currentTurnStarted = true;
    this.active = active;
    this.agent.state.messages = messages;
    try {
      await this.refreshSystemPrompt();
      await this.options.beforePrompt?.({
        ...this.context(),
        prompt: lifecycleMessage,
        turnId: active.turnId,
      });
      await this.agent.continue();
    } catch (error) {
      await this.recordFailure(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      await this.finishActive(active);
    }
    return this.state;
  }

  private async runToolSuspensionResolution(
    suspensionId: string,
    decision: 'approve' | 'deny',
  ): Promise<BlipSessionState> {
    const suspension = await this.toolSuspensions.requireResolvable(suspensionId);

    const lifecycleMessage: AgentMessage = {
      role: 'user',
      content: `${decision === 'approve' ? 'Approved' : 'Denied'} tool call ${suspension.toolName}.`,
      timestamp: Date.now(),
    };
    const active = this.createActive(lifecycleMessage);
    this.active = active;
    const abortController = new AbortController();
    this.resolutionAbortController = abortController;
    try {
      await this.refreshSystemPrompt();
      await this.options.beforePrompt?.({
        ...this.context(),
        prompt: lifecycleMessage,
        turnId: active.turnId,
      });
      if (decision === 'deny') {
        const result = {
          role: 'toolResult' as const,
          toolCallId: suspension.toolCallId,
          toolName: suspension.toolName,
          content: [{ type: 'text' as const, text: `Tool call denied: ${suspension.reason}` }],
          details: { suspensionId, decision: 'denied' },
          isError: true,
          timestamp: Date.now(),
        };
        await this.toolSuspensions.resolve(suspension, result, 'denied');
      } else {
        const approved = await this.toolSuspensions.approve(suspension);

        const hostDecision = await this.options.permissionPreflight?.({
          session: this.state,
          tool: suspension.toolName,
          callId: suspension.toolCallId,
          args: suspension.args,
          signal: abortController.signal,
          phase: 'resume',
          suspension: approved,
        });
        if (hostDecision && hostDecision.status !== 'allow') {
          throw new Error(
            hostDecision.status === 'deny'
              ? hostDecision.reason
              : 'Approval preflight attempted to suspend an already-approved call',
          );
        }

        const tool = this.agent.state.tools.find(
          (candidate) => candidate.name === suspension.toolName,
        );
        if (!tool) throw new Error(`approved tool is no longer available: ${suspension.toolName}`);
        const args = validateToolArguments(tool, {
          type: 'toolCall',
          id: suspension.toolCallId,
          name: suspension.toolName,
          arguments: suspension.args as Record<string, unknown>,
        });
        const executing = await this.toolSuspensions.beginExecution(approved);

        active.timing.recordToolStart(suspension.toolCallId, suspension.toolName);
        await this.emit({
          ...eventBase(this.state.id, active.turnId),
          type: 'tool_call_started',
          callId: suspension.toolCallId,
          tool: suspension.toolName,
          args,
        });
        let result;
        let isError = false;
        try {
          result = await executeAgentTool({
            tool,
            toolCallId: suspension.toolCallId,
            args,
            signal: abortController.signal,
            onUpdate: (partial) =>
              this.emit({
                ...eventBase(this.state.id, active.turnId),
                type: 'tool_call_progress',
                callId: suspension.toolCallId,
                tool: suspension.toolName,
                message: messageText({
                  role: 'toolResult',
                  toolCallId: suspension.toolCallId,
                  toolName: suspension.toolName,
                  content: partial.content,
                  details: partial.details,
                  isError: false,
                  timestamp: Date.now(),
                }),
                details: partial.details,
              }),
          });
        } catch (error) {
          if (
            abortController.signal.aborted ||
            (error instanceof Error && error.name === 'AbortError')
          ) {
            throw error;
          }
          isError = true;
          result = agentToolErrorResult(error);
        }
        const toolResult = {
          role: 'toolResult' as const,
          toolCallId: suspension.toolCallId,
          toolName: suspension.toolName,
          content: result.content ?? [],
          details: result.details,
          isError,
          timestamp: Date.now(),
        };
        active.timing.recordToolEnd(suspension.toolCallId, suspension.toolName, isError);
        await this.emit(
          isError
            ? {
                ...eventBase(this.state.id, active.turnId),
                type: 'tool_call_failed',
                callId: suspension.toolCallId,
                tool: suspension.toolName,
                error: messageText(toolResult),
              }
            : {
                ...eventBase(this.state.id, active.turnId),
                type: 'tool_call_completed',
                callId: suspension.toolCallId,
                tool: suspension.toolName,
                result: result.details,
              },
        );
        await this.toolSuspensions.resolve(executing, toolResult, isError ? 'failed' : 'completed');
      }

      this.agent.state.messages = await this.options.sessionRepository.readModelMessages(
        this.state,
      );
      if (active.cancelRequested || abortController.signal.aborted) {
        active.cancelled = true;
        active.failureMessage = 'Assistant run was aborted';
      } else {
        await this.agent.continue();
      }
    } catch (error) {
      await this.toolSuspensions.interrupt(suspensionId);
      if (abortController.signal.aborted) {
        active.cancelled = true;
        active.failureMessage = 'Assistant run was aborted';
      } else {
        await this.recordFailure(error instanceof Error ? error.message : String(error));
        throw error;
      }
    } finally {
      if (this.resolutionAbortController === abortController) {
        this.resolutionAbortController = undefined;
      }
      await this.finishActive(active);
    }
    return this.state;
  }

  private async runPrompt(message: AgentMessage): Promise<BlipSessionState> {
    const active = this.createActive(message);
    this.active = active;
    try {
      await this.refreshSystemPrompt();
      await this.options.beforePrompt?.({
        ...this.context(),
        prompt: message,
        turnId: active.turnId,
      });
      if (active.cancelRequested) active.cancelled = true;
      else await this.agent.prompt(message);
    } catch (error) {
      if (active.cancelRequested || (error instanceof Error && error.name === 'AbortError')) {
        active.cancelled = true;
        active.failureMessage = 'Assistant run was aborted';
      } else {
        await this.recordFailure(error instanceof Error ? error.message : String(error));
        throw error;
      }
    } finally {
      await this.finishActive(active);
    }
    return this.state;
  }

  private scheduleDiagnostics(turnId: string): void {
    const delay = this.options.processExitDiagnosticsDelayMs;
    if (!delay || delay <= 0 || !this.options.runtimeDiagnostics) return;
    const timer = setTimeout(() => {
      const diagnostics = this.options.runtimeDiagnostics?.();
      if (!diagnostics) return;
      void this.emit({
        ...eventBase(this.state.id, turnId),
        type: 'process_diagnostics',
        reason: `process still alive ${delay}ms after session_finished`,
        ...diagnostics,
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
