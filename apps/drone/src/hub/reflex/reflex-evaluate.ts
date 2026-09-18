import { experimental_evaluate as evaluate, RetryError } from 'ai-evaluation';
import { createGateway } from '@ai-sdk/gateway';
import { validateReflexQuestions, type ReflexAnswers, type ReflexQuestion } from '@drone/reflex';
import { resolveAiGatewayApiKeySettings } from '../hub-settings';
import { trackHubGeneration } from '../usage/trackHubGeneration';

export const REFLEX_EVALUATION_MODEL = 'typesafe-ai/jev';
export const REFLEX_MAX_STATE_CHARS = 300_000;

export type ReflexEvaluateInput = { state: unknown; questions: Record<string, ReflexQuestion> };
export type ReflexEvaluateResult = { answers: ReflexAnswers; usage: { input: number | null; output: number | null }; durationMs: number; model: string };

export function reflexEvaluationError(error: unknown): string {
  if (RetryError.isInstance(error)) error = error.lastError;
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const status = value.statusCode;
  // Classify provider details internally; never echo their message or request data.
  const message = typeof value.message === 'string' ? value.message : '';
  let reason = 'The Gateway request failed. Retry when the connection is available.';
  if (status === 402 || (status === 429 && /credit|quota|balance|billing|budget/i.test(message))) {
    reason = 'AI Gateway reported a credits or quota limit. Check credits and spending limits for the Vercel team that owns your Gateway key, then retry.';
  } else if (status === 429) reason = 'AI Gateway is rate limiting requests. Wait briefly, then retry.';
  else if (status === 401) reason = 'AI Gateway rejected authentication. Check the Gateway key saved in Settings.';
  else if (status === 403) reason = 'AI Gateway denied this request. Check the key and team access policies.';
  else if (status === 400 || status === 422) reason = 'AI Gateway rejected the evaluation request configuration.';
  else if (status === 404) reason = 'The evaluation model or endpoint was unavailable on AI Gateway.';
  else if (value.name === 'TimeoutError' || value.name === 'AbortError' || status === 504) reason = 'The evaluation request timed out. Retry to evaluate the retained state.';
  else if (typeof status === 'number' && status >= 500) reason = 'AI Gateway could not complete the evaluation request. Retry shortly.';
  return `Reflex evaluation failed. Nothing was acted on. ${reason}`;
}

/** Bounds and reconstructs the request from allowlisted fields only. */
export function parseReflexEvaluateInput(value: unknown): ReflexEvaluateInput {
  const input = value as { state?: unknown; questions?: unknown } | null;
  if (!input || typeof input !== 'object') throw new Error('Provide state and questions.');
  if (input.state === undefined || input.state === null) throw new Error('Provide a state string, object, or array.');
  const stateText = typeof input.state === 'string' ? input.state : JSON.stringify(input.state);
  if (!stateText || !stateText.trim() || stateText.length > REFLEX_MAX_STATE_CHARS) throw new Error(`State must serialize to 1–${REFLEX_MAX_STATE_CHARS} characters.`);
  const errors = validateReflexQuestions(input.questions);
  if (errors.length) throw new Error(errors.join('; '));
  const questions: Record<string, ReflexQuestion> = {};
  for (const [id, question] of Object.entries(input.questions as Record<string, ReflexQuestion>)) {
    questions[id] = question.type === 'choice' ? { type: 'choice', instructions: question.instructions, criteria: { ...question.criteria } }
      : question.type === 'score' ? { type: 'score', instructions: question.instructions, criteria: [...question.criteria] }
        : { type: 'boolean', instructions: question.instructions, ...(question.criteria ? { criteria: { ...(question.criteria.true !== undefined ? { true: question.criteria.true } : {}), ...(question.criteria.false !== undefined ? { false: question.criteria.false } : {}) } } : {}) };
  }
  return { state: input.state, questions };
}

type Dependencies = {
  credential(): Promise<{ apiKey: string | null }>;
  run(apiKey: string, input: ReflexEvaluateInput, signal: AbortSignal): Promise<{ answers: ReflexAnswers; usage?: { inputTokens?: number; outputTokens?: number } }>;
  timeoutMs: number;
};

async function gatewayRun(apiKey: string, input: ReflexEvaluateInput, signal: AbortSignal) {
  const gateway = createGateway({ apiKey });
  const result = await evaluate({ model: gateway.evaluationModel(REFLEX_EVALUATION_MODEL), state: input.state as string, questions: input.questions, maxRetries: 2, abortSignal: signal });
  return { answers: result.answers as ReflexAnswers, usage: result.usage };
}

/** Evaluation only: never acts, edits settings, or retains state. Usage is journaled as auxiliary Hub work. */
export async function evaluateReflexQuestions(input: ReflexEvaluateInput, overrides: Partial<Dependencies> = {}): Promise<ReflexEvaluateResult> {
  const deps: Dependencies = { credential: resolveAiGatewayApiKeySettings, run: gatewayRun, timeoutMs: 8_000, ...overrides };
  const credential = await deps.credential();
  if (!credential.apiKey) throw new Error('Configure an AI Gateway API key in Settings.');
  const startedAt = Date.now();
  let result: Awaited<ReturnType<Dependencies['run']>> & { usage: { inputTokens?: number; outputTokens?: number } };
  try {
    result = await trackHubGeneration('ai-gateway', REFLEX_EVALUATION_MODEL, async () => {
      const response = await deps.run(credential.apiKey!, input, AbortSignal.timeout(deps.timeoutMs));
      const inputTokens = response.usage?.inputTokens;
      return { ...response, usage: { inputTokens, outputTokens: response.usage?.outputTokens, inputTokenDetails: { noCacheTokens: inputTokens ?? null } } };
    });
  } catch (error) {
    throw new Error(reflexEvaluationError(error));
  }
  for (const [id, question] of Object.entries(input.questions)) {
    const answer = result.answers[id];
    if (!answer || answer.type !== question.type) throw new Error('Reflex evaluation failed. Nothing was acted on. The evaluation model returned an incomplete answer set.');
  }
  return { answers: result.answers, usage: { input: result.usage.inputTokens ?? null, output: result.usage.outputTokens ?? null }, durationMs: Date.now() - startedAt, model: REFLEX_EVALUATION_MODEL };
}
