import crypto from 'node:crypto';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { BlipPromptLifecycleContext, BlipSessionContext, BlipToolProvider } from '@blip/core';
import { LIVE_COMPANION_PROMPT_PREFIX } from '@drone/assistant-chat';

/** Supply the captured message workspace before the model has to ask for it. */
export class CompanionAppContext implements BlipToolProvider {
  readonly id = 'companion-app-context';
  private context?: BlipSessionContext;
  private readonly messageIds = new WeakMap<AgentMessage, string>();
  private readonly steering = new WeakSet<AgentMessage>();
  private readonly reads = new WeakMap<AgentMessage, Promise<AgentMessage[]>>();

  constructor(private readonly options: {
    enabled(): boolean;
    assertAvailable(): void;
    read(signal?: AbortSignal, messageId?: string): Promise<unknown>;
  }) {}

  load(context: BlipSessionContext) { this.context = context; return []; }

  steeringPrompt(content: string, messageId?: string): AgentMessage {
    const message: AgentMessage = { role: 'user', content, timestamp: Date.now() };
    this.steering.add(message);
    if (messageId) this.messageIds.set(message, messageId);
    return message;
  }

  async promptContext(context: BlipPromptLifecycleContext): Promise<AgentMessage[]> {
    if (context.kind !== 'prompt') return [];
    return this.read(context.prompt);
  }

  /** ASAP messages bypass promptContext; persist their read before their first model call. */
  async transformContext(messages: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]> {
    const prompt = [...messages].reverse().find(message => message.role === 'user');
    if (!prompt || !this.steering.has(prompt)) return messages;
    const supplied = await this.read(prompt, signal, true);
    if (!supplied.length) return messages;
    const result = supplied[1];
    if (result.role !== 'toolResult' || messages.some(message => message.role === 'toolResult' && message.toolCallId === result.toolCallId)) return messages;
    const index = messages.indexOf(prompt) + 1;
    return [...messages.slice(0, index), ...supplied, ...messages.slice(index)];
  }

  private read(prompt: AgentMessage, signal?: AbortSignal, persist = false): Promise<AgentMessage[]> {
    if (prompt.role !== 'user' || !this.options.enabled()) return Promise.resolve([]);
    const text = typeof prompt.content === 'string' ? prompt.content
      : prompt.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    // Live voice already uses its delegated conversation context and keeps its existing tool flow.
    if (text.startsWith(LIVE_COMPANION_PROMPT_PREFIX)) return Promise.resolve([]);
    let reading = this.reads.get(prompt);
    if (!reading) {
      reading = this.messages(signal, this.messageIds.get(prompt)).then(async messages => {
        if (persist) {
          for (const message of messages) await this.context!.repository.appendMessage(this.context!.session, message);
        }
        return messages;
      });
      this.reads.set(prompt, reading);
    }
    return reading;
  }

  private async messages(signal?: AbortSignal, messageId?: string): Promise<AgentMessage[]> {
    if (!this.context) throw new Error('Companion app context has not been loaded.');
    signal?.throwIfAborted();
    this.options.assertAvailable();
    let details: unknown;
    let isError = false;
    try {
      details = await this.options.read(signal, messageId);
    } catch (error) {
      signal?.throwIfAborted();
      this.options.assertAvailable();
      isError = true;
      details = { error: error instanceof Error ? error.message : String(error) };
    }
    signal?.throwIfAborted();
    this.options.assertAvailable();
    const callId = `companion_context_${crypto.randomUUID().replace(/-/g, '')}`;
    const { model } = this.context;
    const timestamp = Date.now();
    return [
      {
        role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: [{ type: 'toolCall', id: callId, name: 'get_app_context', arguments: {}, synthetic: true }],
        stopReason: 'toolUse', timestamp,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      },
      { role: 'toolResult', toolCallId: callId, toolName: 'get_app_context',
        content: [{ type: 'text', text: JSON.stringify(details, null, 2) ?? 'null' }], details, isError, timestamp },
    ];
  }
}
