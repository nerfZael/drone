import type { Summarizer, WorkSummary } from '@entity/core';
import type { Model } from '@mariozechner/pi-ai';
import { resolveBlipProviderApiKey } from '../hub-settings';
import { trackHubGeneration } from '../usage/trackHubGeneration';

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

const PROMPT = `You summarize one worker's progress for a live dashboard. The worker is an AI agent handling one user request.
Reply with only a JSON object: {"done": [...], "doing": [...], "next": [...], "blocker": "..."}.
- done: finished steps, most important first. doing: the one or two things in progress. next: what remains, if clear.
- Each item is a short phrase (under 10 words) naming concrete things (files, features, decisions), not tool names.
- blocker: only if the worker is stuck or waiting on something; otherwise omit it.
- At most 4 items per list. Use the worker's own facts only.`;

/** Work view summaries with a cheap model: gpt-6-luna on low reasoning by default (on the Codex subscription). */
export function createWorkSummarizer(modelRef = 'openai-codex/gpt-6-luna'): Summarizer {
  const [providerId, ...rest] = modelRef.split('/');
  const modelId = rest.join('/');
  return {
    async summarize(input, signal): Promise<WorkSummary> {
      const { getModel, completeSimple } = await (importEsm('@mariozechner/pi-ai') as Promise<typeof import('@mariozechner/pi-ai')>);
      const model = getModel(providerId as never, modelId as never) as Model<any> | undefined;
      if (!model) throw new Error(`Unknown model ${modelRef}`);
      const apiKey = await resolveBlipProviderApiKey(providerId);
      if (!apiKey) throw new Error(`No credentials for ${providerId}`);
      const message = await trackHubGeneration(providerId, modelId, () => completeSimple(model, {
        systemPrompt: PROMPT,
        messages: [{ role: 'user', content: `TASK\n${input.task}\n\nACTIVITY (oldest first)\n${input.activity}`, timestamp: Date.now() }],
      }, { apiKey, signal, maxTokens: 800, ...(model.reasoning ? { reasoning: 'low' as const } : {}) }), true);
      const text = message.content.filter(block => block.type === 'text').map(block => (block as { text: string }).text).join('');
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) || '{}') as Partial<WorkSummary>;
      return { done: parsed.done ?? [], doing: parsed.doing ?? [], next: parsed.next ?? [], ...(parsed.blocker ? { blocker: parsed.blocker } : {}) };
    },
  };
}
