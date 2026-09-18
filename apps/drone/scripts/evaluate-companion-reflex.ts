/** Paid, opt-in eval: bun apps/drone/scripts/evaluate-companion-reflex.ts [--story <name>] [--repeat N] [--interval ms] [--scale x] [--seed "<instructions>" | --default-seed] [--brain] [--autonomy off|observe|act] [--autonomous] [--out dir]
 * --autonomous adds the sense-driven stories (stalled, busy, drifting backend); they need --autonomy observe or act (default act when --autonomous is given).
 * Runs the Companion user stories against live Jev through AI Gateway. Delegations are recorded, never executed.
 * Uses AI_GATEWAY_API_KEY or reads only api-key.ai-gateway (and the saved Jev instructions) from HUB_SETTINGS_DB (default local Hub DB).
 * --brain also exercises the compile step with OPENAI_API_KEY (model: --brain-model, default gpt-4o-mini) when a story wakes the brain.
 */
import { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { experimental_evaluate as evaluate } from 'ai-evaluation';
import { createGateway } from '@ai-sdk/gateway';
import { scaleReflexStory, type ReflexAnswers, type ReflexCompileInput } from '@drone/reflex';
import { COMPANION_AUTONOMOUS_STORIES, COMPANION_REFLEX_STORIES, runCompanionStory, type CompanionAutonomy, type CompanionStoryRun } from '@drone/assistant-chat';
import { DEFAULT_COMPANION_JEV_SYSTEM_PROMPT } from '../src/hub/companion/companion-live-settings';
import { compileReflexTable } from '../src/hub/reflex/reflex-compile';

const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
const flag = (name: string) => args.includes(`--${name}`);
const storyFilter = option('story');
const repeat = Number(option('repeat', '1'));
const intervalMs = Number(option('interval', '250'));
const scale = Number(option('scale', '1'));
const autonomous = flag('autonomous');
const autonomy = (option('autonomy', autonomous ? 'act' : 'off') ?? 'off') as CompanionAutonomy;
if (!['off', 'observe', 'act'].includes(autonomy)) throw new Error('--autonomy must be off, observe, or act.');
const outDir = resolve(option('out', 'data/reflex-evals'));
mkdirSync(outDir, { recursive: true });

let apiKey = process.env.AI_GATEWAY_API_KEY?.trim() ?? '';
let seed = flag('default-seed') ? DEFAULT_COMPANION_JEV_SYSTEM_PROMPT : (option('seed') ?? '');
if (!apiKey || !seed) {
  try {
    const db = new Database(process.env.HUB_SETTINGS_DB ?? 'data/profiles/default/drone/hub.sqlite', { readonly: true });
    const setting = (key: string) => { const row = db.query('SELECT value_json FROM hub_canonical_settings WHERE setting_key = ?').get(key) as { value_json: string } | null; return row ? JSON.parse(row.value_json) : {}; };
    apiKey ||= String(setting('api-key.ai-gateway').apiKey ?? '');
    seed ||= String(setting('companion-live-voice').jevSystemPrompt ?? '');
    db.close();
  } catch { /* No local Hub DB; rely on environment. */ }
}
seed ||= DEFAULT_COMPANION_JEV_SYSTEM_PROMPT;
if (!apiKey) throw new Error('No AI Gateway API key. Set AI_GATEWAY_API_KEY or save one in Hub settings.');

const gateway = createGateway({ apiKey });
const liveEvaluate = async (state: unknown, questions: Parameters<typeof evaluate>[0]['questions'], signal: AbortSignal): Promise<ReflexAnswers> => {
  const result = await evaluate({ model: gateway.evaluationModel('typesafe-ai/jev'), state: state as string, questions, maxRetries: 2, abortSignal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  return Object.assign(result.answers as ReflexAnswers, { usage: { input: result.usage?.inputTokens ?? 0, output: result.usage?.outputTokens ?? 0 } });
};
const brain = flag('brain') ? async (input: ReflexCompileInput) => {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey) throw new Error('--brain requires OPENAI_API_KEY.');
  const compiled = await compileReflexTable(input, { settings: async () => ({ provider: 'openai', model: option('brain-model', 'gpt-4o-mini')! }), credential: async () => ({ apiKey: openaiKey }) });
  console.log(JSON.stringify({ brain: { model: compiled.model, durationMs: compiled.durationMs, notes: compiled.table.notes } }));
  return compiled.output;
} : undefined;

const catalog = autonomous ? [...COMPANION_REFLEX_STORIES, ...COMPANION_AUTONOMOUS_STORIES] : COMPANION_REFLEX_STORIES;
const stories = catalog.filter(story => !storyFilter || story.name.includes(storyFilter));
if (!stories.length) throw new Error(`No story matches ${storyFilter}. Known: ${catalog.map(story => story.name).join(', ')}`);
const runs: CompanionStoryRun[] = [];
for (const story of stories) {
  for (let attempt = 1; attempt <= repeat; attempt += 1) {
    const run = await runCompanionStory(scaleReflexStory(story, scale), { evaluate: liveEvaluate, compile: brain, seedInstructions: seed, intervalMs, autonomy });
    runs.push(run);
    const file = join(outDir, `${story.name.replace(/[^a-z0-9]+/gi, '-')}-${attempt}.json`);
    writeFileSync(file, JSON.stringify({ story, seed, intervalMs, scale, autonomy, run }, null, 2) + '\n');
    console.log(JSON.stringify({ story: story.name, attempt, passed: run.passed, failures: run.failures.map(f => `${f.label ?? f.step}: ${f.message}`),
      actions: run.actions.filter(a => a.action !== 'wait').map(a => `${a.action}@${Math.round(a.at)}ms(${a.confidence?.toFixed(2)})`), ticks: run.ticks, latencyMs: run.latencyMs, tokens: run.tokens, wakes: run.wakes.length, wouldWake: run.wouldWake, nudges: run.nudges.length, notes: run.notes, errors: run.errors }));
  }
}
const passed = runs.filter(run => run.passed).length;
const latencies = runs.flatMap(run => (run.latencyMs ? [run.latencyMs.p50] : []));
const summary = { stories: stories.length, runs: runs.length, passed, failed: runs.length - passed, medianP50LatencyMs: latencies.length ? latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)] : null,
  autonomy, inputTokens: runs.reduce((sum, run) => sum + (run.tokens?.input ?? 0), 0), estimatedUsd: Number((runs.reduce((sum, run) => sum + (run.tokens?.input ?? 0), 0) * 0.042 / 1_000_000).toFixed(6)), outDir };
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ ...summary, runs: runs.map(run => ({ name: run.name, passed: run.passed, failures: run.failures })) }, null, 2) + '\n');
console.log(JSON.stringify({ summary }));
if (passed !== runs.length) process.exitCode = 1;
