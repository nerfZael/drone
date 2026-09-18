import type { HubRouter } from '../hub-router';
import { evaluateReflexQuestions, parseReflexEvaluateInput } from './reflex-evaluate';
import { compileReflexTable, parseReflexCompileInput } from './reflex-compile';

/** Evaluation and compilation only. Neither route acts on the Hub; the caller owns the loop and its actions. */
export function registerReflexRoutes(router: HubRouter, overrides: {
  evaluate?: typeof evaluateReflexQuestions;
  compile?: typeof compileReflexTable;
} = {}): void {
  const evaluate = overrides.evaluate ?? evaluateReflexQuestions;
  const compile = overrides.compile ?? compileReflexTable;
  router.post('/api/reflex/evaluate', async ({ readJson, json, fail }) => {
    let input: ReturnType<typeof parseReflexEvaluateInput>;
    try { input = parseReflexEvaluateInput(await readJson()); }
    catch (error) { return fail(400, error instanceof Error ? error.message : 'Invalid reflex evaluation request.'); }
    try { json(200, { ok: true, ...await evaluate(input) }); }
    catch (error) { fail(503, error instanceof Error ? error.message : 'Reflex evaluation failed.'); }
  });
  router.post('/api/reflex/compile', async ({ readJson, json, fail }) => {
    let input: ReturnType<typeof parseReflexCompileInput>;
    try { input = parseReflexCompileInput(await readJson()); }
    catch (error) { return fail(400, error instanceof Error ? error.message : 'Invalid reflex compile request.'); }
    try { json(200, { ok: true, ...await compile(input) }); }
    catch (error) { fail(503, error instanceof Error ? error.message : 'Reflex compilation failed.'); }
  });
}
