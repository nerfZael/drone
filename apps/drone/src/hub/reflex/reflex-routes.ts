import type { HubRouter } from '../hub-router';
import { evaluateReflexQuestions, parseReflexEvaluateInput } from './reflex-evaluate';

/** Evaluation only. The route does not act on the Hub; the caller owns the loop and its actions. */
export function registerReflexRoutes(router: HubRouter, overrides: {
  evaluate?: typeof evaluateReflexQuestions;
} = {}): void {
  const evaluate = overrides.evaluate ?? evaluateReflexQuestions;
  router.post('/api/reflex/evaluate', async ({ readJson, json, fail }) => {
    let input: ReturnType<typeof parseReflexEvaluateInput>;
    try { input = parseReflexEvaluateInput(await readJson()); }
    catch (error) { return fail(400, error instanceof Error ? error.message : 'Invalid reflex evaluation request.'); }
    try { json(200, { ok: true, ...await evaluate(input) }); }
    catch (error) { fail(503, error instanceof Error ? error.message : 'Reflex evaluation failed.'); }
  });
}
