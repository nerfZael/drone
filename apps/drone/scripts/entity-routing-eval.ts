/**
 * Routing eval for the entity: plays each case in entity/evals/routing-cases.ts against the real front-limb model
 * (Codex, on the subscription) with stand-in workers that stay busy, and reports which routing decisions were right.
 *
 *   bun apps/drone/scripts/entity-routing-eval.ts [--repeat N] [--head openai-codex/gpt-6-luna] [--voice <model>] [--only <text>]
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Entity, chatChannel, keypadChannel, workspaceChannel, type Mind } from '@entity/core';
import { PiAiMind } from '../src/hub/entity/entity-mind';
import { ROUTING_CASES, type RoutingCase } from '../../../entity/evals/routing-cases';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const repeat = Number(arg('repeat') ?? 1);
const head = arg('head') ?? 'openai-codex/gpt-6-luna';
const voice = arg('voice');
const only = arg('only');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The real model for the head and voice; workers just stay busy until stopped, so routing is all that is judged. */
function routingMind(): Mind {
  const real = new PiAiMind('medium');
  return {
    run: input => (input.role === 'task'
      ? new Promise(resolve => { input.signal.addEventListener('abort', () => resolve({ stopReason: 'done' })); setTimeout(() => resolve({ stopReason: 'done' }), 120_000); })
      : real.run(input)),
    fork: () => true,
    forget: () => {},
  };
}

async function play(c: RoutingCase): Promise<{ ok: boolean; why: string | null; ms: number }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'entity-routing-'));
  const entity = new Entity({
    mind: routingMind(),
    channels: [chatChannel(), keypadChannel(), workspaceChannel({ root: dir })],
    models: { head, task: head, voice },
    config: { review: 'off', draftAttention: false },
  });
  const started = Date.now();
  try {
    entity.start();
    await sleep(2000);
    for (const m of c.messages) { await sleep(m.after ?? 3000); entity.input('chat_message', { text: m.text }); }
    // Settled: the front limb has been idle for 5 s (at most 90 s).
    const front = voice ? 'voice' : 'head';
    let quietSince = Date.now();
    for (const end = Date.now() + 90_000; Date.now() < end;) {
      await sleep(250);
      if (entity.snapshot().limbs.find(l => l.id === front)?.runs.length) quietSince = Date.now();
      else if (Date.now() - quietSince > 5000) break;
    }
    const events = entity.log.all();
    const failure = c.check(events as never);
    // On a failure, show what the front limb did, so the cause is visible without replaying.
    const acts = events.filter(e => e.type === 'tool_called' && (e.by === 'head' || e.by === 'voice') && e.data.name !== 'note').map(e => `${e.data.name}(${String(e.data.summary ?? '').slice(0, 60)})`);
    const why = failure && `${failure} · front did: ${acts.join(', ') || 'nothing'}`;
    return { ok: why === null, why, ms: Date.now() - started };
  } finally {
    entity.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const cases = ROUTING_CASES.filter(c => !only || c.name.includes(only));
console.log(`routing eval: ${cases.length} case(s) × ${repeat}, head ${head}${voice ? `, voice ${voice}` : ''}\n`);
let passed = 0, total = 0;
// Cases run at the same time; each has its own entity.
const results = await Promise.all(cases.flatMap(c => Array.from({ length: repeat }, () => play(c).then(r => ({ c, r })))));
for (const c of cases) {
  const mine = results.filter(x => x.c === c);
  const ok = mine.filter(x => x.r.ok).length;
  passed += ok; total += mine.length;
  console.log(`${ok === mine.length ? 'PASS' : 'FAIL'} ${ok}/${mine.length}  ${c.name}`);
  for (const x of mine) if (!x.r.ok) console.log(`       ${x.r.why}`);
}
console.log(`\n${passed}/${total} passed`);
process.exit(0);
