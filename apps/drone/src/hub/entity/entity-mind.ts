import type { Mind, MindRunInput, MindRunResult } from '@entity/core';
import type { AssistantMessage, Context, Message, Model } from '@mariozechner/pi-ai';
import { resolveBlipProviderApiKey } from '../hub-settings';
import { trackHubGeneration } from '../usage/trackHubGeneration';

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
type PiAi = typeof import('@mariozechner/pi-ai');
let piAi: Promise<PiAi> | null = null;
const loadPiAi = () => (piAi ??= importEsm('@mariozechner/pi-ai') as Promise<PiAi>);

export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high';

/**
 * Runs entity LLM limbs with pi-ai directly: one fresh context per reactive wake, and an
 * in-memory conversation per task limb until the runtime calls forget(). Tool calls commit
 * as soon as they stream in, not at the end of the turn.
 */
export class PiAiMind implements Mind {
  private readonly sessions = new Map<string, Message[]>();

  constructor(private readonly reasoning: ReasoningLevel = 'medium') {}

  forget(sessionKey: string): void { this.sessions.delete(sessionKey); }

  fork(fromKey: string, toKey: string): boolean {
    const history = this.sessions.get(fromKey);
    if (!history) return false;
    this.sessions.set(toKey, [...history]);
    return true;
  }

  async run(input: MindRunInput): Promise<MindRunResult> {
    const { getModel, streamSimple } = await loadPiAi();
    const [providerId, ...rest] = input.model.split('/');
    const modelId = rest.join('/');
    const model = getModel(providerId as never, modelId as never) as Model<any> | undefined;
    if (!model) throw new Error(`Unknown model ${input.model}`);
    const apiKey = await resolveBlipProviderApiKey(providerId);
    if (!apiKey) throw new Error(`No credentials for ${providerId}. Sign in or add a key in Settings.`);

    const history = input.sessionKey ? (this.sessions.get(input.sessionKey) ?? []) : [];
    const messages: Message[] = [...history, { role: 'user', content: input.prompt, timestamp: Date.now() }];
    const context: Context = {
      systemPrompt: input.system,
      messages,
      tools: input.tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters as never })),
    };
    const usage = { input: 0, output: 0, cacheRead: 0 };
    let text = '';

    for (let step = 0; step < input.maxSteps; step++) {
      if (input.signal.aborted) throw new Error('aborted');
      const results: Message[] = [];
      const pendingCalls: Promise<void>[] = [];
      const message: AssistantMessage = await trackHubGeneration(providerId, modelId, async () => {
        const stream = streamSimple(model, context, {
          apiKey, signal: input.signal, maxTokens: 8192,
          sessionId: input.sessionKey ?? `entity:${input.limbId}`,
          ...(model.reasoning ? { reasoning: this.reasoning } : {}),
        });
        for await (const event of stream) {
          if (event.type === 'toolcall_end') {
            const call = event.toolCall;
            const index = results.length;
            results.push(undefined as never);
            pendingCalls.push(input.callTool(call.name, (call.arguments ?? {}) as Record<string, unknown>).then(output => {
              results[index] = { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text: output }], isError: output.startsWith('error'), timestamp: Date.now() };
            }));
          }
          if (event.type === 'error') throw new Error(event.error.errorMessage ?? 'model stream failed');
        }
        await Promise.all(pendingCalls);
        return stream.result();
      }, true);
      usage.input += message.usage?.input ?? 0;
      usage.output += message.usage?.output ?? 0;
      usage.cacheRead += message.usage?.cacheRead ?? 0;
      context.messages.push(message);
      const said = message.content.filter(block => block.type === 'text').map(block => (block as { text: string }).text).join('').trim();
      if (said) text = said;
      if (!results.length) break;
      context.messages.push(...results);
    }
    if (input.sessionKey) this.sessions.set(input.sessionKey, context.messages);
    return { text, usage };
  }
}
