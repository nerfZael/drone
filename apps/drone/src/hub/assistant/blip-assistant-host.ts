import crypto from 'node:crypto';
import type { AgentMessage, AgentTool } from '@mariozechner/pi-agent-core';
import type {
  BlipPromptInput,
  BlipRuntimeEvent,
  BlipSessionHandle,
  BlipToolPreflight,
  BlipToolProvider,
  CreateBlipSessionOptions,
} from '@blip/core';
import type { BlipHistoryPage } from '@blip/protocol';

import { toBlipModelProvider } from '../hub-settings';
import { HubSessionRepository } from './hub-session-repository';
import { loadBlipNodeRuntime, loadBlipRuntime } from './blip-runtime-loader';

export type BlipAssistantThreadConfiguration = {
  provider: string;
  model: string;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  systemPrompt: string;
  promptDeliveryMode?: 'queue' | 'asap';
  tools: AgentTool<any>[];
  onResponse?: CreateBlipSessionOptions['onResponse'];
  beforePrompt?: CreateBlipSessionOptions['beforePrompt'];
  afterPrompt?: CreateBlipSessionOptions['afterPrompt'];
  toolProviders?: BlipToolProvider[];
  permissionPreflight?: BlipToolPreflight;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  dispose?: () => Promise<void> | void;
};

export class BlipAssistantHost {
  private readonly handles = new Map<string, BlipSessionHandle>();
  private readonly handlePromises = new Map<string, Promise<BlipSessionHandle>>();
  private readonly eventSinks = new Map<
    string,
    Set<(event: BlipRuntimeEvent) => Promise<void> | void>
  >();
  private readonly invalidatedThreads = new Set<string>();
  private readonly abortRequestedThreads = new Set<string>();
  private readonly loadedTools = new Map<string, AgentTool<any>[]>();
  private readonly loadedConfigurations = new Map<string, BlipAssistantThreadConfiguration>();

  constructor(
    private readonly configuration: (threadId: string) => Promise<BlipAssistantThreadConfiguration>,
    private readonly eventObserver?: (
      threadId: string,
      event: BlipRuntimeEvent,
    ) => Promise<void> | void,
    private readonly repository: HubSessionRepository = new HubSessionRepository(),
    private readonly rawEventObserver?: (
      threadId: string,
      event: BlipRuntimeEvent,
    ) => Promise<void> | void,
  ) {}

  subscribeEvents(
    threadId: string,
    sink: (event: BlipRuntimeEvent) => Promise<void> | void,
  ): () => void {
    const sinks = this.eventSinks.get(threadId) ?? new Set();
    sinks.add(sink);
    this.eventSinks.set(threadId, sinks);
    return () => {
      const current = this.eventSinks.get(threadId);
      current?.delete(sink);
      if (current?.size === 0) this.eventSinks.delete(threadId);
    };
  }

  async promptThread(
    threadId: string,
    prompt: BlipPromptInput,
    onEvent?: (event: BlipRuntimeEvent) => Promise<void> | void,
    deliveryMode?: 'queue' | 'asap',
  ): Promise<void> {
    if (onEvent) {
      this.subscribeEvents(threadId, onEvent);
    }
    try {
      const handle = await this.handle(threadId);
      if (this.abortRequestedThreads.delete(threadId)) {
        throw new Error('Assistant run cancelled');
      }
      const effectiveDeliveryMode =
        deliveryMode ?? this.loadedConfigurations.get(threadId)?.promptDeliveryMode;
      if (handle.running && effectiveDeliveryMode === 'asap') {
        handle.steer(prompt);
        await handle.waitForIdle();
      } else if (handle.running) await handle.enqueue(prompt);
      else await handle.prompt(prompt);
    } finally {
      if (onEvent) {
        const sinks = this.eventSinks.get(threadId);
        sinks?.delete(onEvent);
        if (sinks?.size === 0) this.eventSinks.delete(threadId);
      }
      if (this.invalidatedThreads.delete(threadId)) {
        this.handles.get(threadId)?.close();
        this.handles.delete(threadId);
        this.loadedTools.delete(threadId);
        void this.disposeConfiguration(threadId);
      }
    }
  }

  async appendExternalMessage(threadId: string, message: AgentMessage): Promise<void> {
    const handle = await this.handle(threadId);
    await this.repository.appendMessage(handle.state, message);
    await this.publishEvent(threadId, {
      version: 1,
      eventId: crypto.randomUUID(),
      type: 'transcript_changed',
      sessionId: handle.state.id,
      timestamp: new Date().toISOString(),
      role: message.role,
    });
  }

  async interruptThreadWithPrompt(threadId: string, prompt: BlipPromptInput): Promise<void> {
    const handle = await this.handle(threadId);
    if (handle.running) {
      handle.abort();
      await handle.waitForIdle().catch(() => {});
    }
    await this.promptThread(threadId, prompt);
  }

  abortThread(threadId: string): void {
    const handle = this.handles.get(threadId);
    if (handle) {
      handle.abort();
      return;
    }
    if (this.handlePromises.has(threadId)) this.abortRequestedThreads.add(threadId);
  }

  historyPage(
    threadId: string,
    input?: { before?: number; limit?: number },
  ): Promise<BlipHistoryPage> {
    return this.repository.readThreadHistoryPage(threadId, input);
  }

  latestMessageTimestamps(threadIds: string[]): Promise<Map<string, string>> {
    return this.repository.latestThreadMessageTimestamps(threadIds);
  }

  message(threadId: string, entryId: string): Promise<Record<string, unknown>> {
    return this.repository.readThreadMessage(threadId, entryId);
  }

  async latestAssistantText(threadId: string): Promise<string> {
    const history = await this.historyPage(threadId, { limit: 50 });
    const message = [...history.entries]
      .reverse()
      .map((entry) => entry.message)
      .find((candidate) => candidate.role === 'assistant');
    if (!message) return '';
    if (typeof message.content === 'string') return message.content;
    if (!Array.isArray(message.content)) return '';
    return message.content
      .map((part: any) =>
        part?.type === 'text' || part?.type === 'thinking'
          ? String(part?.text ?? part?.thinking ?? '')
          : '',
      )
      .filter(Boolean)
      .join('\n');
  }

  async latestAssistantVisibleText(threadId: string): Promise<string> {
    const history = await this.historyPage(threadId, { limit: 50 });
    const message = [...history.entries]
      .reverse()
      .map((entry) => entry.message)
      .find((candidate) => candidate.role === 'assistant');
    if (!message) return '';
    if (typeof message.content === 'string') return message.content;
    if (!Array.isArray(message.content)) return '';
    return message.content
      .map((part: any) => (part?.type === 'text' ? String(part?.text ?? '') : ''))
      .filter(Boolean)
      .join('\n');
  }

  isThreadRunning(threadId: string): boolean {
    return this.handles.get(threadId)?.running === true;
  }

  hasThreadHandle(threadId: string): boolean {
    return this.handles.has(threadId);
  }

  async prepareThread(threadId: string): Promise<void> {
    await this.handle(threadId);
  }

  async waitForThreadIdle(threadId: string): Promise<void> {
    const pending = this.handlePromises.get(threadId);
    const handle = this.handles.get(threadId) ?? (pending ? await pending : null);
    if (handle?.running) await handle.waitForIdle();
  }

  async resolveToolSuspension(
    threadId: string,
    suspensionId: string,
    approved: boolean,
  ): Promise<void> {
    const handle = await this.handle(threadId);
    await handle.resolveToolSuspension(suspensionId, approved ? 'approve' : 'deny');
  }

  async beginToolSuspensionResolution(
    threadId: string,
    suspensionId: string,
    approved: boolean,
  ): Promise<void> {
    const handle = await this.handle(threadId);
    const suspension = (await handle.pendingToolSuspensions()).find(
      (candidate) => candidate.id === suspensionId,
    );
    if (!suspension) throw new Error(`unknown tool suspension: ${suspensionId}`);
    let settleAccepted: () => void = () => {};
    let rejectAccepted: (error: unknown) => void = () => {};
    const accepted = new Promise<void>((resolve, reject) => {
      settleAccepted = resolve;
      rejectAccepted = reject;
    });
    const unsubscribe = this.subscribeEvents(threadId, (event) => {
      if (
        (event.type === 'tool_call_started' &&
          approved &&
          event.callId === suspension.toolCallId) ||
        (event.type === 'tool_call_resolved' && event.suspensionId === suspensionId)
      ) {
        settleAccepted();
      }
    });
    const running = handle.resolveToolSuspension(suspensionId, approved ? 'approve' : 'deny');
    void running.catch(rejectAccepted);
    try {
      await accepted;
    } finally {
      unsubscribe();
      void running.catch(() => undefined);
    }
  }

  async restorePendingApprovals(): Promise<void> {
    const recovered = await this.repository.recoverToolSuspensionsByThread();
    for (const { threadId, suspension } of recovered) {
      await this.publishEvent(threadId, {
        version: 1,
        eventId: crypto.randomUUID(),
        type: 'tool_call_suspended',
        sessionId: (
          await this.repository.load((await this.repository.sessionIdForThread(threadId))!)
        ).id,
        timestamp: new Date().toISOString(),
        suspensionId: suspension.id,
        callId: suspension.toolCallId,
        tool: suspension.toolName,
        reason: suspension.error ?? suspension.reason,
        details: suspension.details,
        recoveryRequired: suspension.status === 'interrupted',
      });
    }
    const continuations = await this.repository.threadIdsRequiringToolContinuation();
    const results = await Promise.allSettled(
      continuations.map((threadId) => this.handle(threadId)),
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new Error(
        `failed resuming ${failures.length} of ${continuations.length} durable tool continuation(s)`,
      );
    }
  }

  async toolCatalog(
    threadId: string,
  ): Promise<Array<{ name: string; description: string; parameters: unknown }>> {
    await this.handle(threadId);
    return (this.loadedTools.get(threadId) ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  async executeTool(
    threadId: string,
    callId: string,
    toolName: string,
    args: any,
    signal?: AbortSignal,
  ): Promise<any> {
    await this.handle(threadId);
    const tool = (this.loadedTools.get(threadId) ?? []).find(
      (candidate) => candidate.name === toolName,
    );
    if (!tool) throw new Error(`assistant tool unavailable: ${toolName}`);
    const handle = this.handles.get(threadId)!;
    const preflight = this.loadedConfigurations.get(threadId)?.permissionPreflight;
    const decision = await preflight?.({
      session: handle.state,
      tool: toolName,
      callId,
      args,
      signal,
      phase: 'initial',
    });
    if (decision?.status === 'deny') throw new Error(decision.reason);
    if (decision?.status === 'suspend') throw new Error(decision.reason);
    return tool.execute(callId, args, signal);
  }

  steerThread(threadId: string, prompt: string): void {
    const handle = this.handles.get(threadId);
    if (!handle) throw new Error(`Blip assistant thread is not running: ${threadId}`);
    handle.steer(prompt);
  }

  stopThread(threadId: string): void {
    this.handles.get(threadId)?.abort();
  }

  invalidateThread(threadId: string): void {
    const handle = this.handles.get(threadId);
    if (handle?.running || this.handlePromises.has(threadId)) {
      this.invalidatedThreads.add(threadId);
      return;
    }
    handle?.close();
    this.handles.delete(threadId);
    this.loadedTools.delete(threadId);
    void this.disposeConfiguration(threadId);
  }

  invalidateAll(): void {
    for (const threadId of new Set([...this.handles.keys(), ...this.handlePromises.keys()]))
      this.invalidateThread(threadId);
  }

  async close(): Promise<void> {
    const threadIds = new Set([...this.handles.keys(), ...this.handlePromises.keys()]);
    await Promise.allSettled([...threadIds].map((threadId) => this.deleteThread(threadId)));
    this.repository.close();
  }

  async deleteThread(threadId: string): Promise<void> {
    let handle = this.handles.get(threadId);
    if (!handle) handle = await this.handlePromises.get(threadId);
    if (handle) {
      if (handle.running) {
        handle.abort();
        await handle.waitForIdle();
      }
      await handle.delete();
    } else {
      const sessionId = await this.repository.sessionIdForThread(threadId);
      if (sessionId) await this.repository.delete(sessionId);
    }
    this.handles.delete(threadId);
    this.abortRequestedThreads.delete(threadId);
    this.invalidatedThreads.delete(threadId);
    this.loadedTools.delete(threadId);
    await this.disposeConfiguration(threadId);
  }

  async deleteMessage(threadId: string, entryId: string, deleteFollowing: boolean): Promise<void> {
    const pending = this.handlePromises.get(threadId);
    const handle = this.handles.get(threadId) ?? (pending ? await pending : null);
    if (handle?.running) throw new Error('Stop the assistant before deleting messages');
    const sessionId = handle?.state.id ?? (await this.repository.sessionIdForThread(threadId));
    if (sessionId) {
      const session = handle?.state ?? (await this.repository.load(sessionId));
      const unresolved = (
        handle
          ? await handle.pendingToolSuspensions()
          : await this.repository.readToolSuspensions(session)
      ).filter(
        (suspension) =>
          suspension.status !== 'completed' &&
          suspension.status !== 'denied' &&
          suspension.status !== 'failed',
      );
      if (unresolved.length > 0) {
        throw new Error('Resolve pending tool approvals before deleting messages');
      }
    }
    this.invalidateThread(threadId);
    await this.repository.deleteThreadMessage(threadId, entryId, deleteFollowing);
  }

  async cloneThread(sourceThreadId: string, targetThreadId: string): Promise<void> {
    if (this.isThreadRunning(sourceThreadId))
      throw new Error('Stop this assistant thread before cloning it');
    const sourceSessionId = await this.repository.sessionIdForThread(sourceThreadId);
    if (!sourceSessionId) return;
    const source = await this.repository.load(sourceSessionId);
    const cloned = await this.repository.fork(source, {
      provider: source.modelProvider,
      model: source.modelId,
      permissionMode: source.permissionMode,
      toolProfile: source.toolProfile,
    });
    try {
      await this.repository.bindThread(targetThreadId, cloned.id);
    } catch (error) {
      await this.repository.delete(cloned.id).catch(() => undefined);
      throw error;
    }
  }

  private async publishEvent(threadId: string, event: BlipRuntimeEvent): Promise<void> {
    try {
      await this.rawEventObserver?.(threadId, event);
    } catch {
      // Raw observability must not fail or interrupt the agent run.
    }
    // The Hub transcript intentionally renders canonical messages only. Do not fan out per-token
    // deltas to snapshots or SSE clients; the final transcript_changed event refreshes history.
    if (event.type === 'assistant_delta') return;
    try {
      await this.eventObserver?.(threadId, event);
    } catch {
      // Observability and UI refreshes must not fail or interrupt the agent run.
    }
    for (const sink of this.eventSinks.get(threadId) ?? []) {
      try {
        await sink(event);
      } catch {
        // A stale stream consumer must not fail or interrupt the agent run.
      }
    }
  }

  private async handle(threadId: string): Promise<BlipSessionHandle> {
    const existing = this.handles.get(threadId);
    if (existing) return existing;
    const pending = this.handlePromises.get(threadId);
    if (pending) return pending;
    const created = this.createHandle(threadId);
    this.handlePromises.set(threadId, created);
    try {
      return await created;
    } finally {
      if (this.handlePromises.get(threadId) === created) this.handlePromises.delete(threadId);
    }
  }

  private async createHandle(threadId: string): Promise<BlipSessionHandle> {
    const [runtime, nodeRuntime] = await Promise.all([loadBlipRuntime(), loadBlipNodeRuntime()]);
    const config = await this.configuration(threadId);
    let handle: BlipSessionHandle | undefined;
    try {
      const provider = toBlipModelProvider(config.provider);
      const model = nodeRuntime.resolveBlipModel(provider, config.model);
      const sessionId = await this.repository.sessionIdForThread(threadId);
      handle = await runtime.createBlipSession({
        workspaceRoot: 'drone-hub',
        model,
        permissionMode: 'workspace-write',
        toolProfile: 'no-shell-workspace-write',
        sessionRepository: this.repository,
        ...(sessionId ? { sessionId } : {}),
        reasoning: config.thinkingLevel,
        onResponse: config.onResponse,
        beforePrompt: config.beforePrompt,
        afterPrompt: config.afterPrompt,
        tools: config.tools,
        toolProviders: config.toolProviders,
        permissionPreflight: config.permissionPreflight,
        promptProvider: () => config.systemPrompt,
        getApiKey: config.getApiKey,
        eventSink: (event) => this.publishEvent(threadId, event),
      });
      if (!sessionId) await this.repository.bindThread(threadId, handle.state.id);
      const context = {
        session: handle.state,
        repository: this.repository,
        model,
        workspaceRoot: 'drone-hub',
        permissionMode: 'workspace-write' as const,
        toolProfile: 'no-shell-workspace-write' as const,
      };
      const providerTools = (
        await Promise.all(
          (config.toolProviders ?? []).map((toolProvider) => toolProvider.load(context)),
        )
      ).flat();
      this.loadedTools.set(threadId, [...config.tools, ...providerTools]);
      this.loadedConfigurations.set(threadId, config);
      this.handles.set(threadId, handle);
      return handle;
    } catch (error) {
      handle?.close();
      await config.dispose?.();
      throw error;
    }
  }

  private async disposeConfiguration(threadId: string): Promise<void> {
    const config = this.loadedConfigurations.get(threadId);
    this.loadedConfigurations.delete(threadId);
    await config?.dispose?.();
  }
}
