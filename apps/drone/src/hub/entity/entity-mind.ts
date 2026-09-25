import fs from 'node:fs';
import path from 'node:path';
import type { Mind, MindRunInput, MindRunResult } from '@entity/core';
import type { AssistantMessage, Context, Message, Model } from '@mariozechner/pi-ai';
import { resolveBlipProviderApiKey } from '../hub-settings';
import { trackHubGeneration } from '../usage/trackHubGeneration';

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
type PiAi = typeof import('@mariozechner/pi-ai');
let piAi: Promise<PiAi> | null = null;
const loadPiAi = () => (piAi ??= importEsm('@mariozechner/pi-ai') as Promise<PiAi>);

export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high';

/** Where worker conversations are kept beyond memory, so a restored session can continue them. Append-only per key. */
export interface ConversationStore {
  load(key: string): Message[] | undefined;
  append(key: string, messages: Message[]): void;
  remove(key: string): void;
}

/** One JSON Lines file per worker conversation (`<key>.jsonl`), next to a session's recording. */
export function fileConversationStore(dir: string): ConversationStore {
  const file = (key: string) => path.join(dir, `${key.replace(/[^\w.-]/g, '_')}.jsonl`);
  return {
    load(key) {
      try { return fs.readFileSync(file(key), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Message); }
      catch { return undefined; }
    },
    append(key, messages) {
      if (!messages.length) return;
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(file(key), messages.map(m => `${JSON.stringify(m)}\n`).join(''));
    },
    remove(key) { fs.rmSync(file(key), { force: true }); },
  };
}

/**
 * Runs entity LLM limbs with pi-ai directly: one fresh context per reactive wake, and a
 * conversation per task limb until the runtime calls forget(). Conversations live in memory
 * and, with a store, on disk too. Tool calls commit as soon as they stream in, not at the end of the turn.
 */
export class PiAiMind implements Mind {
  private readonly sessions = new Map<string, Message[]>();

  constructor(private readonly reasoning: ReasoningLevel = 'medium', private readonly store?: ConversationStore) {}

  forget(sessionKey: string): void {
    this.sessions.delete(sessionKey);
    this.store?.remove(sessionKey);
  }

  fork(fromKey: string, toKey: string): boolean {
    const history = this.history(fromKey);
    if (!history) return false;
    this.sessions.set(toKey, [...history]);
    this.store?.append(toKey, history);
    return true;
  }

  /** A kept conversation: from memory, or from the store after a restart. */
  private history(key: string): Message[] | undefined {
    const known = this.sessions.get(key);
    if (known) return known;
    const loaded = this.store?.load(key);
    if (loaded) this.sessions.set(key, loaded);
    return loaded;
  }

  async run(input: MindRunInput): Promise<MindRunResult> {
    const { getModel, streamSimple } = await loadPiAi();
    const [providerId, ...rest] = input.model.split('/');
    const modelId = rest.join('/');
    const model = getModel(providerId as never, modelId as never) as Model<any> | undefined;
    if (!model) throw new Error(`Unknown model ${input.model}`);
    const apiKey = await resolveBlipProviderApiKey(providerId);
    if (!apiKey) throw new Error(`No credentials for ${providerId}. Sign in or add a key in Settings.`);

    const history = input.sessionKey ? (this.history(input.sessionKey) ?? []) : [];
    const prompt: Message = { role: 'user', content: input.prompt, timestamp: Date.now() };
    const messages: Message[] = [...history, prompt];
    const context: Context = {
      systemPrompt: input.system,
      messages,
      tools: input.tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters as never })),
    };
    // Kept from the start and appended step by step, so a run that is aborted (Pause) or crashes keeps the
    // steps it completed: their effects already happened. A step is appended whole (the model's tool calls
    // with their results), so the history never holds a call without its result.
    const key = input.sessionKey;
    if (key) { this.sessions.set(key, context.messages); this.store?.append(key, [prompt]); }
    const usage = { input: 0, output: 0, cacheRead: 0, cost: 0 };
    let text = '';

    // Stays true if the loop ends by using every turn while the model is still calling tools.
    let ranOut = true;
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
      usage.cost += message.usage?.cost?.total ?? 0;
      context.messages.push(message, ...results);
      if (key && this.sessions.get(key) === context.messages) this.store?.append(key, [message, ...results]);
      const said = message.content.filter(block => block.type === 'text').map(block => (block as { text: string }).text).join('').trim();
      if (said) text = said;
      if (!results.length) { ranOut = false; break; }
    }
    return { text, usage, stopReason: ranOut ? 'max_steps' : 'done' };
  }
}
