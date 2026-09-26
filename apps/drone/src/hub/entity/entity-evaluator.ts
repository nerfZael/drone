import type { Evaluator, ModelUsage } from '@entity/core';
import type { ReflexQuestion } from '@drone/reflex';
import type { Model } from '@mariozechner/pi-ai';
import { resolveBlipProviderApiKey } from '../hub-settings';
import { evaluateReflexQuestions } from '../reflex/reflex-evaluate';
import { trackHubGeneration } from '../usage/trackHubGeneration';
import { priceModelCall } from '../usage/priceModelCall';

/** A pi-ai call's usage for the entity's totals, priced from the Hub's price table. */
export function modelCallUsage(provider: string, model: string, used: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | undefined): ModelUsage | undefined {
  if (!used) return undefined;
  const counts = { input: used.input ?? 0, output: used.output ?? 0, cacheRead: used.cacheRead ?? 0, cacheWrite: used.cacheWrite ?? 0 };
  return { ...counts, cost: priceModelCall(provider, model, { ...counts, reasoning: null }) };
}

export type EvaluatorKind = 'off' | 'jev' | 'qwen';

/** Backs `judge` / `sense` with Jev through the existing Hub evaluate path (AI Gateway key, usage journaling). */
export function createJevEvaluator(): Evaluator {
  return {
    async evaluate(questions, state, signal) {
      if (signal.aborted) throw new Error('aborted');
      const reflexQuestions: Record<string, ReflexQuestion> = Object.fromEntries(questions.map(q => [q.id, {
        type: 'boolean',
        instructions: `${q.question}\nAnswer about the conversation and state below. Unsent draft text is what the user is typing now and has not sent.`,
      } satisfies ReflexQuestion]));
      const result = await evaluateReflexQuestions({ state, questions: reflexQuestions });
      const answers = Object.fromEntries(questions.map(q => {
        const answer = result.answers[q.id];
        return [q.id, answer && answer.type === 'boolean' ? answer.probability : NaN];
      }).filter(([, p]) => Number.isFinite(p as number)));
      const counts = { input: result.usage.input ?? 0, output: result.usage.output ?? 0, cacheRead: 0, cacheWrite: 0 };
      return { answers, usage: { ...counts, cost: priceModelCall('ai-gateway', result.model, { ...counts, reasoning: null }) } };
    },
  };
}

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

/**
 * Backs `judge` / `sense` with a small fast LLM in the same role, for comparison with Jev.
 * The model states a probability per question; unlike Jev, it is not calibrated.
 */
export function createLlmEvaluator(modelRef = 'cerebras/qwen-3.8-27b'): Evaluator {
  const [providerId, ...rest] = modelRef.split('/');
  const modelId = rest.join('/');
  return {
    async evaluate(questions, state, signal) {
      const { getModel, completeSimple } = await (importEsm('@mariozechner/pi-ai') as Promise<typeof import('@mariozechner/pi-ai')>);
      const model = getModel(providerId as never, modelId as never) as Model<any> | undefined;
      if (!model) throw new Error(`Unknown model ${modelRef}`);
      const apiKey = await resolveBlipProviderApiKey(providerId);
      if (!apiKey) throw new Error(`No credentials for ${providerId}`);
      const prompt = [
        'Answer each yes/no question about the state below with the probability (0 to 1) that the answer is yes.',
        'Unsent draft text is what the user is typing now and has not sent.',
        'Reply with only a JSON object mapping question id to probability, e.g. {"q1": 0.12}.',
        '', 'QUESTIONS', ...questions.map(q => `${q.id}: ${q.question}`), '', 'STATE', state,
      ].join('\n');
      const message = await trackHubGeneration(providerId, modelId, () => completeSimple(model, {
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      }, { apiKey, signal, maxTokens: 400 }), true);
      const text = message.content.filter(block => block.type === 'text').map(block => (block as { text: string }).text).join('');
      const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
      const parsed = JSON.parse(json || '{}') as Record<string, unknown>;
      const answers = Object.fromEntries(questions
        .map(q => [q.id, Number(parsed[q.id])] as const)
        .filter(([, p]) => Number.isFinite(p) && p >= 0 && p <= 1));
      return { answers, usage: modelCallUsage(providerId, modelId, message.usage) };
    },
  };
}

export function createEvaluator(kind: EvaluatorKind): Evaluator | undefined {
  return kind === 'jev' ? createJevEvaluator() : kind === 'qwen' ? createLlmEvaluator() : undefined;
}
