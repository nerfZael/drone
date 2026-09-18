import { expect, test } from 'bun:test';
import { RetryError } from 'ai-evaluation';
import { companionReflexTable } from '@drone/assistant-chat';
import { tableQuestions } from '@drone/reflex';
import { evaluateReflexQuestions, parseReflexEvaluateInput, reflexEvaluationError } from '../src/hub/reflex/reflex-evaluate';
import { compileReflexTable, parseReflexCompileInput } from '../src/hub/reflex/reflex-compile';
import { registerReflexRoutes } from '../src/hub/reflex/reflex-routes';
import { HubRouter } from '../src/hub/hub-router';
import { upsertStoredProviderApiKey } from '../src/hub/hub-settings';
import { withTempDroneDataDir } from './test-helpers';

const questions = tableQuestions(companionReflexTable('Send clear requests.'));
const answers = {
  delegation: { type: 'choice', choice: 'send', probabilities: { send: 0.9, wait: 0.1 } },
  intent: { type: 'choice', choice: 'request', probabilities: { request: 0.8, greeting: 0, correction: 0.1, cancel: 0.05, chatter: 0.05 } },
  addressed: { type: 'boolean', probability: 0.95 },
};

test('evaluate input is bounded and rebuilt from allowlisted fields', () => {
  const parsed = parseReflexEvaluateInput({ state: { unsentTranscript: 'Open settings' }, questions, apiKey: 'injected' });
  expect(parsed.questions).toEqual(questions);
  expect(JSON.stringify(parsed)).not.toContain('injected');
  for (const value of [null, {}, { state: '', questions }, { state: 'a'.repeat(300_001), questions }, { state: 'x', questions: {} },
    { state: 'x', questions: { q: { type: 'choice', instructions: 'x', criteria: { only: 'one' } } } },
    { state: 'x', questions: { q: { type: 'boolean', instructions: '' } } }]) {
    expect(() => parseReflexEvaluateInput(value)).toThrow();
  }
});

test('SDK evaluation sends the questions as given; provider failures expose no raw details; usage is journaled', async () => {
  await withTempDroneDataDir('reflex-sdk-', async () => {
    await upsertStoredProviderApiKey('ai-gateway', 'test-only-gateway-key');
    const previousFetch = globalThis.fetch;
    let fail = 0;
    const requests: Array<{ model: string | null; body: any }> = [];
    globalThis.fetch = (async (_url, init) => {
      requests.push({ model: new Headers(init?.headers).get('ai-model-id'), body: JSON.parse(String(init?.body)) });
      return fail
        ? Response.json({ error: { type: fail === 429 ? 'rate_limit_exceeded' : 'authentication_error', message: fail === 429 ? 'Gateway credits limit test-only-gateway-key' : 'test-only-gateway-key' } }, { status: fail, headers: { 'retry-after-ms': '1' } })
        : Response.json({ answers, usage: { inputTokens: 283, outputTokens: 21 } });
    }) as typeof fetch;
    try {
      const input = { state: { unsentTranscript: 'Open settings', timing: { silenceMs: 1250 } }, questions };
      const result = await evaluateReflexQuestions(input);
      expect(result.answers).toEqual(answers as any);
      expect(result.usage).toEqual({ input: 283, output: 21 });
      expect(result.model).toBe('typesafe-ai/jev');
      expect(requests[0].model).toBe('typesafe-ai/jev');
      expect(requests[0].body.questions.delegation.instructions).toContain('Send clear requests.');
      expect(requests[0].body.questions.intent.criteria.cancel).toContain('never mind');
      const state = typeof requests[0].body.state === 'string' ? JSON.parse(requests[0].body.state) : requests[0].body.state;
      expect(state.timing).toEqual({ silenceMs: 1250 });
      fail = 401;
      await expect(evaluateReflexQuestions(input)).rejects.toThrow('AI Gateway rejected authentication.');
      expect(requests).toHaveLength(2); // Authentication failures do not retry.
      fail = 429;
      await expect(evaluateReflexQuestions(input)).rejects.toThrow('AI Gateway reported a credits or quota limit.');
      expect(requests).toHaveLength(5); // Initial attempt plus two retries, then stop.
      fail = 0;
      // The SDK rejects answer sets that do not cover every question before the Hub's own check runs.
      await expect(evaluateReflexQuestions({ ...input, questions: { ...questions, extra: { type: 'boolean', instructions: 'Missing answer?' } } })).rejects.toThrow('Reflex evaluation failed. Nothing was acted on.');
    } finally { globalThis.fetch = previousFetch; }
  });
});

test('evaluation errors distinguish limits, configuration, and timeouts without echoing secrets', () => {
  expect(reflexEvaluationError(new RetryError({ message: 'test-secret', reason: 'maxRetriesExceeded', errors: [{ statusCode: 429 }] }))).toContain('rate limiting');
  const cases = [
    [{ statusCode: 429, message: 'credits test-secret' }, 'credits or quota limit'],
    [{ statusCode: 401 }, 'rejected authentication'],
    [{ statusCode: 403 }, 'denied this request'],
    [{ statusCode: 400 }, 'request configuration'],
    [{ name: 'TimeoutError' }, 'timed out'],
    [{ statusCode: 503 }, 'could not complete'],
    [{ message: 'test-secret' }, 'Gateway request failed'],
  ] as const;
  for (const [error, expected] of cases) {
    const result = reflexEvaluationError(error);
    expect(result).toContain(expected);
    expect(result).not.toContain('test-secret');
  }
});

test('routes reject malformed input, never echo credentials, and pass evaluation and compilation through', async () => {
  let body: unknown; let result: any;
  const router = new HubRouter((_res, status, value) => { result = { status, body: value }; }, async () => body);
  const base = companionReflexTable('Send clear requests.');
  registerReflexRoutes(router, {
    evaluate: async input => ({ answers: answers as any, usage: { input: 10, output: 1 }, durationMs: 5, model: 'typesafe-ai/jev' }),
    compile: async input => ({ table: { ...input.base, version: 2, source: 'brain' }, output: { questions: input.base.questions, rules: [] }, model: 'm', provider: 'openai', durationMs: 7 }),
  });
  const post = (path: string) => router.handle({ method: 'POST' } as any, {} as any, new URL(`http://hub.test${path}`));
  body = { state: 'Open settings', questions, apiKey: 'test-only-secret' };
  await post('/api/reflex/evaluate');
  expect(result.status).toBe(200); expect(result.body.answers.delegation.choice).toBe('send');
  expect(JSON.stringify(result)).not.toContain('test-only-secret');
  body = { state: 'x', questions: {} };
  await post('/api/reflex/evaluate'); expect(result.status).toBe(400);
  body = { purpose: 'p', stateDescription: 's', actions: [{ name: 'send', description: 'd' }, { name: 'skip', description: 'd' }, { name: 'cancel', description: 'd' }, { name: 'wait', description: 'd' }], base, guidance: 'g', apiKey: 'test-only-secret' };
  await post('/api/reflex/compile');
  expect(result.status).toBe(200); expect(result.body.table.version).toBe(2);
  expect(JSON.stringify(result)).not.toContain('test-only-secret');
  body = { purpose: 'p', stateDescription: 's', actions: [{ name: 'send', description: 'd' }], base };
  await post('/api/reflex/compile'); expect(result.status).toBe(400); expect(result.body.error).toContain('unknown action');
});

test('the brain compiles with the Companion helper model and returns a validated versioned table', async () => {
  const base = companionReflexTable('Send clear requests.');
  const calls: any[] = [];
  const { z } = await import('zod');
  const compiled = await compileReflexTable(parseReflexCompileInput({ purpose: 'p', stateDescription: 's', actions: [{ name: 'send', description: 'd' }, { name: 'skip', description: 'd' }, { name: 'cancel', description: 'd' }, { name: 'wait', description: 'd' }], base, observations: 'Wake reason: low-confidence.' }), {
    settings: async () => ({ provider: 'openai', model: 'gpt-test' }),
    credential: async () => ({ apiKey: 'test-only-openai-key' }),
    runtime: async () => ({ provider: 'openai', z, modelFactory: (id: string) => id, generateObject: async (input: any) => {
      calls.push(input);
      const parsed = input.schema.parse({
        questions: { delegation: base.questions.delegation, intent: base.questions.intent },
        rules: [
          { id: 'cancel', when: [{ question: 'intent', is: 'cancel', minProbability: 0.9 }], do: 'cancel', wake: 'cancelled' },
          { id: 'send', when: [{ question: 'delegation', is: 'send' }], do: 'send' },
          { id: 'wait', when: [], do: 'wait' },
        ],
        notes: 'Dropped addressed; it never fired.',
      });
      return { object: parsed };
    } }) as any,
  });
  expect(compiled.table).toMatchObject({ version: 2, source: 'brain', notes: 'Dropped addressed; it never fired.', wake: base.wake });
  expect(Object.keys(compiled.table.questions)).toEqual(['delegation', 'intent']);
  expect(compiled.table.rules[0].when).toEqual({ all: [{ question: 'intent', is: 'cancel', minProbability: 0.9 }] });
  expect(calls[0].model).toBe('gpt-test');
  expect(calls[0].prompt).toContain('Wake reason: low-confidence.');
  expect(calls[0].system).toContain('reads literally');
  expect(() => calls[0].schema.parse({ questions: {}, rules: [{ id: 'x', when: [], do: 'explode' }] })).toThrow();
});
