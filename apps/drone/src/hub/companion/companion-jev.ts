import { experimental_evaluate as evaluate, RetryError } from 'ai-evaluation';
import { createGateway } from '@ai-sdk/gateway';
import { resolveAiGatewayApiKeySettings } from '../hub-settings';
import { readCompanionLiveSettings } from './companion-live-settings';

export type JevDecision = 'send' | 'wait';

export function jevEvaluationError(error: unknown): string {
  if (RetryError.isInstance(error)) error = error.lastError;
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const status = value.statusCode;
  // Classify provider details internally; never echo their message or request data.
  const message = typeof value.message === 'string' ? value.message : '';
  let reason = 'The Gateway request failed. Retry when the connection is available.';
  if (status === 402 || (status === 429 && /credit|quota|balance|billing|budget/i.test(message))) {
    reason = 'AI Gateway reported a credits or quota limit. Check credits and spending limits for the Vercel team that owns your Gateway key, then retry.';
  } else if (status === 429) {
    reason = 'AI Gateway is rate limiting requests. Wait briefly, then retry.';
  } else if (status === 401) {
    reason = 'AI Gateway rejected authentication. Check the Gateway key saved in Settings.';
  } else if (status === 403) {
    reason = 'AI Gateway denied this request. Check the key and team access policies.';
  } else if (status === 400 || status === 422) {
    reason = 'AI Gateway rejected the Jev request configuration.';
  } else if (status === 404) {
    reason = 'The Jev model or evaluation endpoint was unavailable on AI Gateway.';
  } else if (value.name === 'TimeoutError' || value.name === 'AbortError' || status === 504) {
    reason = 'The Jev request timed out. Retry to evaluate the retained transcript.';
  } else if (typeof status === 'number' && status >= 500) {
    reason = 'AI Gateway could not complete the Jev request. Retry shortly.';
  }
  return `Jev evaluation failed. No speech was delegated. ${reason} Your transcript is retained.`;
}
export function parseJevInput(value: unknown): { transcript: string; context: string; silenceMs?: number } {
  const input = value as { transcript?: unknown; context?: unknown; silenceMs?: unknown } | null;
  if (!input || typeof input.transcript !== 'string' || !input.transcript.trim() || input.transcript.length > 120_000 ||
    (input.context !== undefined && (typeof input.context !== 'string' || input.context.length > 16_000))) {
    throw new Error('Provide a transcript of 1–120000 characters and at most 16000 characters of context.');
  }
  if (input.silenceMs !== undefined && (typeof input.silenceMs !== 'number' || !Number.isSafeInteger(input.silenceMs) || input.silenceMs < 0)) {
    throw new Error('Silence duration must be a nonnegative integer in milliseconds.');
  }
  return { transcript: input.transcript.trim(), context: typeof input.context === 'string' ? input.context : '',
    ...(input.silenceMs === undefined ? {} : { silenceMs: input.silenceMs as number }) };
}

export type JevDebugRequest = {
  model: 'typesafe-ai/jev'; state: string; instructions: string;
  criteria: { send: string; wait: string };
};

export function parseJevReplay(value: unknown): JevDebugRequest {
  const input = value as Partial<JevDebugRequest> | null;
  if (!input || input.model !== 'typesafe-ai/jev' || typeof input.state !== 'string' || !input.state.trim() || input.state.length > 300_000 ||
      typeof input.instructions !== 'string' || !input.instructions.trim() || input.instructions.length > 16_000 ||
      !input.criteria || typeof input.criteria.send !== 'string' || typeof input.criteria.wait !== 'string' ||
      !input.criteria.send.trim() || !input.criteria.wait.trim() || input.criteria.send.length > 4000 || input.criteria.wait.length > 4000) {
    throw new Error('Provide Jev state, instructions, and send/wait criteria within the displayed limits.');
  }
  // Reconstruct allowlisted fields. No client credentials, URLs, or provider options.
  return { model: 'typesafe-ai/jev', state: input.state, instructions: input.instructions,
    criteria: { send: input.criteria.send, wait: input.criteria.wait } };
}

export async function evaluateCompanionSpeech(input: ReturnType<typeof parseJevInput>): Promise<JevDecision> {
  return (await evaluateCompanionSpeechDetailed(input)).decision;
}

export async function evaluateCompanionSpeechDetailed(input: ReturnType<typeof parseJevInput>) {
  const settings = await readCompanionLiveSettings();
  if (!settings.enabled || settings.mode !== 'jev') throw new Error('Select Jev voice mode before evaluating speech.');
  return replayJevEvaluation({
    model: 'typesafe-ai/jev',
    state: JSON.stringify({ unsentTranscript: input.transcript, previousDelegatedTranscripts: input.context,
      timing: { silenceMs: input.silenceMs ?? 0 } }),
    instructions: `The timing.silenceMs field is milliseconds since the last new or revised transcript text, an estimate of silence rather than acoustic voice detection. It is metadata, not spoken text. Use it to apply any timing rules in the following instructions.\n\n${settings.jevSystemPrompt}`,
    criteria: {
      send: 'A complete request or correction should be sent to the Companion backend now.',
      wait: 'Do not delegate yet. Retain the entire transcript and reconsider as more speech arrives or silence increases.',
    },
  });
}

/** Evaluation only: never invokes Companion, edits settings, or advances transcript cursors. */
export async function replayJevEvaluation(request: JevDebugRequest) {
  const credential = await resolveAiGatewayApiKeySettings();
  if (!credential.apiKey) throw new Error('Configure an AI Gateway API key in Settings.');
  const startedAt = Date.now();
  try {
    const gateway = createGateway({ apiKey: credential.apiKey });
    const result = await evaluate({
      model: gateway.evaluationModel(request.model),
      state: request.state,
      questions: { delegation: { type: 'choice', instructions: request.instructions, criteria: request.criteria } },
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(15_000),
    });
    const decision = result.answers.delegation.choice;
    if (decision !== 'send' && decision !== 'wait') throw new Error('Invalid decision');
    const probabilities = result.answers.delegation.probabilities;
    return { decision, request, startedAt, durationMs: Date.now() - startedAt,
      probabilities: probabilities ? { send: probabilities.send, wait: probabilities.wait } : undefined };
  } catch (error) {
    throw new Error(jevEvaluationError(error));
  }
}
