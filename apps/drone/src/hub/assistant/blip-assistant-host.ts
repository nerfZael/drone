import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { BlipPromptInput, BlipRuntimeEvent, BlipSessionHandle, BlipToolPreflight, BlipToolProvider } from '@blip/core';

import { HubSessionRepository } from './hub-session-repository';
import { loadBlipRuntime } from './blip-runtime-loader';

export type BlipAssistantThreadConfiguration = {
  provider: string;
  model: string;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  systemPrompt: string;
  tools: AgentTool<any>[];
  toolProviders?: BlipToolProvider[];
  permissionPreflight?: BlipToolPreflight;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  dispose?: () => Promise<void> | void;
};

export class BlipAssistantHost {
  private readonly repository = new HubSessionRepository();
  private readonly handles = new Map<string, BlipSessionHandle>();
  private readonly eventSinks = new Map<string, Set<(event: BlipRuntimeEvent) => Promise<void> | void>>();
  private readonly streamingText = new Map<string, string>();
  private readonly errors = new Map<string, string>();
  private readonly invalidatedThreads = new Set<string>();
  private readonly loadedTools = new Map<string, AgentTool<any>[]>();
  private readonly loadedConfigurations = new Map<string, BlipAssistantThreadConfiguration>();

  constructor(private readonly configuration: (threadId: string) => Promise<BlipAssistantThreadConfiguration>) {}

  async promptThread(threadId: string, prompt: BlipPromptInput, onEvent?: (event: BlipRuntimeEvent) => Promise<void> | void): Promise<void> {
    if (onEvent) {
      const sinks = this.eventSinks.get(threadId) ?? new Set();
      sinks.add(onEvent);
      this.eventSinks.set(threadId, sinks);
    }
    try {
      const handle = await this.handle(threadId);
      if (handle.running) await handle.enqueue(prompt);
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

  async projectSnapshot(threadId: string, snapshot: any): Promise<any> {
    const sessionId = await this.repository.sessionIdForThread(threadId);
    if (!sessionId) return snapshot;
    const session = await this.repository.load(sessionId);
    const messages = await this.repository.readMessages(session);
    const handle = this.handles.get(threadId);
    const streamingText = this.streamingText.get(threadId) ?? '';
    const threads = Array.isArray(snapshot?.threads)
      ? snapshot.threads.map((thread: any) => thread?.id === threadId ? {
          ...thread,
          messages,
          messageCount: messages.length,
          status: handle?.running ? 'running' : this.errors.has(threadId) ? 'error' : 'idle',
          error: this.errors.get(threadId) ?? null,
        } : thread)
      : snapshot?.threads;
    return {
      ...snapshot,
      threads,
      ...(streamingText ? {
        streamingMessage: { role: 'assistant', content: [{ type: 'text', text: streamingText }], timestamp: Date.now() },
        streamingMessages: [{ role: 'assistant', content: [{ type: 'text', text: streamingText }], timestamp: Date.now() }],
      } : {}),
    };
  }

  async toolCatalog(threadId: string): Promise<Array<{ name: string; description: string; parameters: unknown }>> {
    await this.handle(threadId);
    return (this.loadedTools.get(threadId) ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  async executeTool(threadId: string, callId: string, toolName: string, args: any, signal?: AbortSignal): Promise<any> {
    await this.handle(threadId);
    const tool = (this.loadedTools.get(threadId) ?? []).find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`assistant tool unavailable: ${toolName}`);
    const handle = this.handles.get(threadId)!;
    const preflight = this.loadedConfigurations.get(threadId)?.permissionPreflight;
    const decision = await preflight?.({ session: handle.state, tool: toolName, callId, args, signal });
    if (decision?.status === 'deny') throw new Error(decision.reason);
    return tool.execute(callId, args, signal);
  }

  steerThread(threadId: string, prompt: string): void {
    const handle = this.handles.get(threadId);
    if (!handle) throw new Error(`Blip assistant thread is not running: ${threadId}`);
    handle.steer(prompt);
  }

  stopThread(threadId: string): void { this.handles.get(threadId)?.abort(); }

  invalidateThread(threadId: string): void {
    const handle = this.handles.get(threadId);
    if (handle?.running) {
      this.invalidatedThreads.add(threadId);
      return;
    }
    handle?.close();
    this.handles.delete(threadId);
    this.loadedTools.delete(threadId);
    void this.disposeConfiguration(threadId);
  }

  invalidateAll(): void {
    for (const threadId of this.handles.keys()) this.invalidateThread(threadId);
  }

  async deleteThread(threadId: string): Promise<void> {
    const handle = this.handles.get(threadId);
    if (handle) await handle.delete();
    else {
      const sessionId = await this.repository.sessionIdForThread(threadId);
      if (sessionId) await this.repository.delete(sessionId);
    }
    this.handles.delete(threadId);
    this.loadedTools.delete(threadId);
    await this.disposeConfiguration(threadId);
    this.streamingText.delete(threadId);
    this.errors.delete(threadId);
  }

  private async publishEvent(threadId: string, event: BlipRuntimeEvent): Promise<void> {
    if (event.type === 'turn_started') {
      this.streamingText.delete(threadId);
      this.errors.delete(threadId);
    } else if (event.type === 'assistant_delta') {
      this.streamingText.set(threadId, `${this.streamingText.get(threadId) ?? ''}${event.text}`);
    } else if (event.type === 'assistant_message' || event.type === 'session_finished') {
      this.streamingText.delete(threadId);
      if (event.type === 'session_finished' && event.status === 'error') this.errors.set(threadId, event.error ?? 'Assistant failed.');
    } else if (event.type === 'session_error') {
      this.errors.set(threadId, event.error);
    }
    for (const sink of this.eventSinks.get(threadId) ?? []) await sink(event);
  }

  private async handle(threadId: string): Promise<BlipSessionHandle> {
    const existing = this.handles.get(threadId);
    if (existing) return existing;
    const runtime = await loadBlipRuntime();
    const config = await this.configuration(threadId);
    const provider = config.provider === 'codex' ? 'openai-codex' : config.provider;
    const model = runtime.resolveBlipModel(provider, config.model);
    const sessionId = await this.repository.sessionIdForThread(threadId);
    const handle = await runtime.createBlipSession({
      workspaceRoot: 'drone-hub',
      model,
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
      sessionRepository: this.repository,
      ...(sessionId ? { sessionId } : {}),
      reasoning: config.thinkingLevel,
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
    const providerTools = (await Promise.all((config.toolProviders ?? []).map((toolProvider) => toolProvider.load(context)))).flat();
    this.loadedTools.set(threadId, [...config.tools, ...providerTools]);
    this.loadedConfigurations.set(threadId, config);
    this.handles.set(threadId, handle);
    return handle;
  }

  private async disposeConfiguration(threadId: string): Promise<void> {
    const config = this.loadedConfigurations.get(threadId);
    this.loadedConfigurations.delete(threadId);
    await config?.dispose?.();
  }
}
