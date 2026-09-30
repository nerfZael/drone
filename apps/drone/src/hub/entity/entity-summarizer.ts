import type { ModelUsage, Summarizer, WorkSummary } from '@entity/core';
import type { Model } from '@mariozechner/pi-ai';
import { resolveBlipProviderApiKey } from '../hub-settings';
import { trackHubGeneration, type HubGenerationAttribution } from '../usage/trackHubGeneration';
import { modelCallUsage } from './entity-evaluator';

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

/** The default instructions for work summaries; the user may replace them (see entity-prompts.ts). */
export const SUMMARY_PROMPT = `You summarize one worker's progress for a live dashboard. The worker is an AI agent handling one user request.
Reply with only a JSON object: {"done": [...], "doing": [...], "next": [...], "blocker": "..."}.
- done: finished steps, most important first. doing: the one or two things in progress. next: what remains, if clear.
- Each item is a short phrase (under 10 words) naming concrete things (files, features, decisions), not tool names.
- blocker: only if the worker is stuck or waiting on something; otherwise omit it.
- At most 4 items per list. Use the worker's own facts only.`;

/** Work view summaries with a cheap model: gpt-6-luna on low reasoning by default (on the Codex subscription). */
export function createWorkSummarizer(modelRef = 'openai-codex/gpt-6-luna', prompt: () => string = () => SUMMARY_PROMPT): Summarizer {
  return { summarize: (input, signal) => summarizeWork({ modelRef, prompt: prompt(), input, signal }) };
}

/**
 * One summary: done / doing / next / blocker from a task and what was done for it. Chats' step tracking uses it with
 * the user's model and reasoning, and bills it to the chat (`attribution`).
 */
export async function summarizeWork(opts: {
  modelRef: string;
  reasoning?: string;
  prompt: string;
  input: { task: string; activity: string };
  signal: AbortSignal;
  attribution?: HubGenerationAttribution;
}): Promise<WorkSummary & { usage?: ModelUsage }> {
  const [providerId, ...rest] = opts.modelRef.split('/');
  const modelId = rest.join('/');
  const { getModel, completeSimple } = await (importEsm('@mariozechner/pi-ai') as Promise<typeof import('@mariozechner/pi-ai')>);
  const model = getModel(providerId as never, modelId as never) as Model<any> | undefined;
  if (!model) throw new Error(`Unknown model ${opts.modelRef}`);
  const apiKey = await resolveBlipProviderApiKey(providerId);
  if (!apiKey) throw new Error(`No credentials for ${providerId}`);
  const reasoning = (opts.reasoning ?? 'low') as 'minimal' | 'low' | 'medium' | 'high';
  const message = await trackHubGeneration(providerId, modelId, () => completeSimple(model, {
    systemPrompt: opts.prompt,
    messages: [{ role: 'user', content: `TASK\n${opts.input.task}\n\nACTIVITY (oldest first)\n${opts.input.activity}`, timestamp: Date.now() }],
  }, { apiKey, signal: opts.signal, maxTokens: 800, ...(model.reasoning && reasoning !== ('off' as string) ? { reasoning } : {}) }), true, opts.attribution);
  const text = message.content.filter(block => block.type === 'text').map(block => (block as { text: string }).text).join('');
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) || '{}') as Partial<WorkSummary>;
  return {
    done: parsed.done ?? [], doing: parsed.doing ?? [], next: parsed.next ?? [], ...(parsed.blocker ? { blocker: parsed.blocker } : {}),
    usage: modelCallUsage(providerId, modelId, message.usage),
  };
}
