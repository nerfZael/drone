import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { BlipPromptInput, BlipRuntimeEvent, BlipSessionHandle, BlipToolPreflight, BlipToolProvider } from '@blip/core';
import type { BlipHistoryPage } from '@blip/protocol';

import { HubSessionRepository } from './hub-session-repository';
import { loadBlipRuntime } from './blip-runtime-loader';

export type BlipAssistantThreadConfiguration = {
  provider: string;
  model: string;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  systemPrompt: string;
  promptDeliveryMode?: 'queue' | 'asap';
  tools: AgentTool<any>[];
  toolProviders?: BlipToolProvider[];
  permissionPreflight?: BlipToolPreflight;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  dispose?: () => Promise<void> | void;
};

export class BlipAssistantHost {
  private readonly repository = new HubSessionRepository();
  private readonly handles = new Map<string, BlipSessionHandle>();
  private readonly handlePromises = new Map<string, Promise<BlipSessionHandle>>();
  private readonly eventSinks = new Map<string, Set<(event: BlipRuntimeEvent) => Promise<void> | void>>();
  private readonly invalidatedThreads = new Set<string>();
  private readonly loadedTools = new Map<string, AgentTool<any>[]>();
  private readonly loadedConfigurations = new Map<string, BlipAssistantThreadConfiguration>();

  constructor(private readonly configuration: (threadId: string) => Promise<BlipAssistantThreadConfiguration>) {}

  subscribeEvents(threadId: string, sink: (event: BlipRuntimeEvent) => Promise<void> | void): () => void {
    const sinks = this.eventSinks.get(threadId) ?? new Set();
    sinks.add(sink);
    this.eventSinks.set(threadId, sinks);
    return () => {
      const current = this.eventSinks.get(threadId);
      current?.delete(sink);
      if (current?.size === 0) this.eventSinks.delete(threadId);
    };
  }

  async promptThread(threadId: string, prompt: BlipPromptInput, onEvent?: (event: BlipRuntimeEvent) => Promise<void> | void): Promise<void> {
    if (onEvent) {
      this.subscribeEvents(threadId, onEvent);
    }
    try {
      const handle = await this.handle(threadId);
      if (handle.running && this.loadedConfigurations.get(threadId)?.promptDeliveryMode === 'asap') {
        handle.steer(prompt);
        await handle.waitForIdle();
      }
      else if (handle.running) await handle.enqueue(prompt);
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

  historyPage(threadId: string, input?: { before?: number; limit?: number }): Promise<BlipHistoryPage> {
    return this.repository.readThreadHistoryPage(threadId, input);
  }

  isThreadRunning(threadId: string): boolean {
    return this.handles.get(threadId)?.running === true;
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
    for (const threadId of new Set([...this.handles.keys(), ...this.handlePromises.keys()])) this.invalidateThread(threadId);
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
    }
    else {
      const sessionId = await this.repository.sessionIdForThread(threadId);
      if (sessionId) await this.repository.delete(sessionId);
    }
    this.handles.delete(threadId);
    this.invalidatedThreads.delete(threadId);
    this.loadedTools.delete(threadId);
    await this.disposeConfiguration(threadId);
  }

  private async publishEvent(threadId: string, event: BlipRuntimeEvent): Promise<void> {
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
    const runtime = await loadBlipRuntime();
    const config = await this.configuration(threadId);
    let handle: BlipSessionHandle | undefined;
    try {
      const provider = config.provider === 'codex' ? 'openai-codex' : config.provider;
      const model = runtime.resolveBlipModel(provider, config.model);
      const sessionId = await this.repository.sessionIdForThread(threadId);
      handle = await runtime.createBlipSession({
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
