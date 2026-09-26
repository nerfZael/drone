/**
 * Routing eval for the entity: plays each case in entity/evals/routing-cases.ts against the real front-limb model
 * (Codex, on the subscription) with stand-in workers that stay busy, and reports which routing decisions were right.
 *
 *   bun apps/drone/scripts/entity-routing-eval.ts [--repeat N] [--head openai-codex/gpt-6-luna] [--voice <model>] [--only <text>] [--concurrency 8]
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Entity, chatChannel, keypadChannel, workspaceChannel, type Channel, type Mind } from '@entity/core';
import { PiAiMind } from '../src/hub/entity/entity-mind';
import { priceModelCall } from '../src/hub/usage/priceModelCall';
import { ROUTING_CASES, type RoutingCase } from '../../../entity/evals/routing-cases';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const repeat = Number(arg('repeat') ?? 1);
const head = arg('head') ?? 'openai-codex/gpt-6-luna';
const voice = arg('voice');
const only = arg('only');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The real model for the head and voice; workers just stay busy until stopped, so routing is all that is judged. */
function routingMind(c: RoutingCase): Mind {
  // Priced like the Hub prices every model call: list price, subscription models too.
  const real = new PiAiMind('medium', undefined, priceModelCall);
  const asked = new Set<string>();
  return {
    run: async input => {
      if (input.role !== 'task') return real.run(input);
      // A case's worker may ask the user first: ask ends its turn, and it waits for the answer.
      if (c.workerAsks && !asked.has(input.limbId)) { asked.add(input.limbId); await input.callTool('ask', { question: c.workerAsks }); return { stopReason: 'done' }; }
      return new Promise(resolve => { input.signal.addEventListener('abort', () => resolve({ stopReason: 'done' })); setTimeout(() => resolve({ stopReason: 'done' }), 120_000); });
    },
    fork: () => true,
    forget: () => {},
  };
}

/** Workspaces as the Hub's workspaces channel shows them (state only: routing is judged before any file is touched). */
function grantedWorkspaces(lines: string[]): Channel {
  return {
    name: 'workspaces',
    describe: 'The workspaces you may use: repositories, folders and drones the user granted this session, and your own home folder. What each allows (read, write, run commands) is in state; a call it does not allow is refused.',
    inputs: [], effects: [], init: () => ({}), reduce() {},
    render: () => ({ stable: { workspaces: lines } }),
  };
}

type Spend = { cost: number; tokens: number; unpriced: number };

async function play(c: RoutingCase): Promise<{ ok: boolean; why: string | null; ms: number; spend: Spend }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'entity-routing-'));
  const entity = new Entity({
    mind: routingMind(c),
    channels: [chatChannel(), keypadChannel(), c.workspaces ? grantedWorkspaces(c.workspaces) : workspaceChannel({ root: dir })],
    models: { head, task: head, voice },
    config: { review: 'off', draftAttention: false },
  });
  const started = Date.now();
  try {
    entity.start();
    await sleep(2000);
    for (const m of c.messages) {
      await sleep(m.after ?? 3000);
      const question = m.click ? [...entity.log.all()].reverse().find(e => e.type === 'chat_message' && Array.isArray(e.data.options)) : undefined;
      if (m.click && !question) continue;
      entity.input('chat_message', { text: m.text, ...(question ? { reply_to: question.seq } : {}) });
    }
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
    const u = entity.snapshot().usage;
    const spend = { cost: u.cost, tokens: u.input + u.output + u.cacheRead + u.cacheWrite, unpriced: u.unpriced };
    return { ok: why === null, why, ms: Date.now() - started, spend };
  } finally {
    entity.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const cases = ROUTING_CASES.filter(c => !only || c.name.includes(only));
console.log(`routing eval: ${cases.length} case(s) × ${repeat}, head ${head}${voice ? `, voice ${voice}` : ''}\n`);
let passed = 0, total = 0;
// Cases run a few at a time, each with its own entity: many at once gets throttled by the model provider, which
// fails cases for reasons that have nothing to do with routing.
const concurrency = Number(arg('concurrency') ?? 8);
const jobs = cases.flatMap(c => Array.from({ length: repeat }, () => c));
const results: { c: RoutingCase; r: Awaited<ReturnType<typeof play>> }[] = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
  while (next < jobs.length) { const c = jobs[next++]; results.push({ c, r: await play(c) }); }
}));
const money = (cost: number) => `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`;
const sum = (list: Spend[]): Spend => list.reduce((a, b) => ({ cost: a.cost + b.cost, tokens: a.tokens + b.tokens, unpriced: a.unpriced + b.unpriced }), { cost: 0, tokens: 0, unpriced: 0 });
for (const c of cases) {
  const mine = results.filter(x => x.c === c);
  const ok = mine.filter(x => x.r.ok).length;
  passed += ok; total += mine.length;
  console.log(`${ok === mine.length ? 'PASS' : 'FAIL'} ${ok}/${mine.length}  ${c.name}  (${money(sum(mine.map(x => x.r.spend)).cost)})`);
  for (const x of mine) if (!x.r.ok) console.log(`       ${x.r.why}`);
}
// What the run cost: every model call the entities made, at list price, even on a subscription.
const spent = sum(results.map(x => x.r.spend));
console.log(`\n${passed}/${total} passed · ${money(spent.cost)} at list price · ${Math.round(spent.tokens / 1000)}k tokens${spent.unpriced ? ` · ${spent.unpriced} call(s) with no known price` : ''}`);
process.exit(0);
