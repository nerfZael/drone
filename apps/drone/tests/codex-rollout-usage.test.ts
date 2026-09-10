import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readCodexRolloutUsage } from '../src/CodexRolloutUsage';
import { CodexUsageTracker } from '../src/CodexUsageTracker';
import { AgentUsageAccumulator } from '../src/hub/usage/AgentUsageAccumulator';
import { UsageStore } from '../src/hub/usage/UsageStore';
import { parseBuiltinPromptJobTranscript } from '../src/hub/builtin-transcript-sessions';
import { CodexPromptRunManager } from '../src/codex-prompt-run-manager';

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
const tokens = (input: number, cached: number, output: number, reasoning = 0) => ({
  input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0,
  output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output,
});
const normal = tokens(14400212, 14105472, 40923, 13774);
const compact = tokens(242325, 241920, 3346);
const total = tokens(14642537, 14347392, 44269, 13774);
const record = (response: string, usage: any, cumulative: any, turn = 'turn') => ({ type: 'token_usage_record', payload: {
  thread_id: 'thread', turn_id: turn, response_id: response, usage, turn_token_usage: cumulative,
} });
const fixture = () => [
  record('history', tokens(900, 0, 20), tokens(900, 0, 20), 'old-turn'),
  { type: 'turn_context', payload: { turn_id: 'turn', model: 'gpt-5.6-sol' } },
  record('normal', normal, normal), record('compact', compact, total),
  { type: 'compacted', payload: { compaction_response_id: 'compact' } },
];
async function file(rows: unknown[], suffix = '') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-usage-'));
  directories.push(dir);
  const name = path.join(dir, 'rollout.jsonl');
  await fs.writeFile(name, rows.map((row) => JSON.stringify(row)).join('\n') + '\n' + suffix);
  return name;
}
function live() {
  const tracker = new CodexUsageTracker();
  tracker.observe({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } });
  const usage = { inputTokens: normal.input_tokens, cachedInputTokens: normal.cached_input_tokens, cacheWriteInputTokens: 0,
    outputTokens: normal.output_tokens, reasoningOutputTokens: normal.reasoning_output_tokens, totalTokens: normal.total_tokens };
  return tracker.observe({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'turn', tokenUsage: { total: usage, last: usage } } });
}
const snapshot = (observations: any[]) => ({ type: 'usage.snapshot', sessionId: 'thread', turnId: 'turn', observations });

test('Codex compaction reconciles the audited totals, excludes history, and clears the baseline warning', async () => {
  const observations = await readCodexRolloutUsage(await file(fixture()), 'thread', 'turn');
  expect(observations).toHaveLength(2);
  const projected = parseBuiltinPromptJobTranscript('codex', [...live(), snapshot(observations!)].map((e) => JSON.stringify(e)).join('\n'));
  expect(projected?.usage).toEqual(observations);
  expect(observations![1]).toMatchObject({ purpose: 'compaction', input: 405, cacheRead: 241920, output: 3346 });
  const parser = new AgentUsageAccumulator('codex');
  live().forEach((event) => parser.pushLine(JSON.stringify(event)));
  expect(parser.result()[0].partialReason).toBe('missing-baseline');
  const store = new UsageStore(':memory:');
  try {
    store.addPrice({ provider: 'openai-codex', model: 'gpt-5.6-sol', effectiveAt: store.trackingSince,
      source: 'test', input: 4, cacheRead: .4, cacheWrite: 5, output: 20 });
    const run = { id: 'run', agent: 'codex', startedAt: store.trackingSince, status: 'done' };
    store.record(run, parser.result());
    expect(store.analytics().totals).toMatchObject({ total: 14441135, partial: 1, partialReasons: ['missing-baseline'] });
    // Durable replay must not add the snapshot to the provisional counters.
    parser.pushLine(JSON.stringify(snapshot(observations!)));
    parser.pushLine(JSON.stringify(snapshot(observations!)));
    store.record(run, parser.result());
    store.record(run, parser.result());
    expect(store.analytics().totals).toMatchObject({ total: 14686806, partial: 0, partialReasons: [] });
    expect(store.analytics().totals.estimatedCost).toBeCloseTo(7.8049168, 9);
    expect(store.analytics({ groupBy: 'purpose' }).groups.find((g) => g.key === 'compaction')?.total).toBe(245671);
  } finally { store.close(); }
});

test('incomplete, corrupt, unavailable and conflicting response records retain live usage', async () => {
  expect(await readCodexRolloutUsage('/nonexistent/codex-usage.jsonl', 'thread', 'turn')).toBeNull();
  expect(await readCodexRolloutUsage(await file(fixture(), '{broken'), 'thread', 'turn')).toBeNull();
  expect(await readCodexRolloutUsage(await file([record('compact', compact, total)]), 'thread', 'turn')).toBeNull();
  expect(await readCodexRolloutUsage(await file([...fixture(), record('normal', compact, total)]), 'thread', 'turn')).toBeNull();
  const parser = new AgentUsageAccumulator('codex');
  live().forEach((e) => parser.pushLine(JSON.stringify(e)));
  parser.pushLine(JSON.stringify({ type: 'usage.coverage', sessionId: 'thread', turnId: 'turn', partialReason: 'compaction-unverified' }));
  parser.pushLine(JSON.stringify(snapshot([])));
  const short = await readCodexRolloutUsage(await file([record('small', tokens(10, 0, 1), tokens(10, 0, 1))]), 'thread', 'turn');
  parser.pushLine(JSON.stringify(snapshot(short!)));
  expect(parser.result()).toHaveLength(1);
  expect(parser.result()[0]).toMatchObject({ input: 294740, partialReason: 'compaction-unverified', complete: false });
});

test('response replay is deduplicated and a root snapshot preserves child observations', async () => {
  const observations = await readCodexRolloutUsage(await file([...fixture(), record('compact', compact, total)]), 'thread', 'turn');
  expect(observations).toHaveLength(2);
  const parser = new AgentUsageAccumulator('codex');
  for (const e of live()) {
    parser.pushLine(JSON.stringify(e));
    parser.pushLine(JSON.stringify({ ...e, eventId: 'child', sessionId: 'child-thread' }));
  }
  parser.pushLine(JSON.stringify(snapshot(observations!)));
  expect(parser.result()).toHaveLength(3);
  expect(parser.result().find((o) => o.id === 'child')).toBeDefined();
});

test('manager reconciles before marking a turn complete and restart recovery can replay it', async () => {
  const rolloutPath = await file(fixture());
  let run: any = { id: 'run', state: 'running', threadId: 'thread', turnId: 'turn', rolloutPath,
    messageIds: [], responseMessageId: 'message', startedAt: new Date().toISOString() };
  const parser = new AgentUsageAccumulator('codex');
  live().forEach((e) => parser.pushLine(JSON.stringify(e)));
  let appends = 0;
  const manager = new CodexPromptRunManager<any>({
    loadRun: async () => run, loadMessage: async () => null, saveRun: async (r) => { run = r; },
    saveMessage: async () => {}, createRun: async () => run, appendRunStderr: async () => {},
    mutate: async (op) => op(), appendRunEvents: async (r, events) => {
      expect(r.state).toBe('running');
      appends++;
      events.forEach((e) => parser.pushLine(JSON.stringify(e)));
      return { ...r, transcript: { usage: parser.result() } };
    },
  });
  const session = { activeRun: run, activeTurnId: 'turn', observedTurnIds: new Set(['turn']),
    approvalResolutions: new Map(), queuedMessageIds: [] };
  await (manager as any).completeTurn(session, { params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } });
  expect(run.state).toBe('done');
  expect(run.transcript.usage).toHaveLength(2);
  run = { ...run, state: 'running' };
  await manager.failInterrupted({ codexAppServer: { runId: 'run' } } as any, 'restart');
  expect(run.state).toBe('failed');
  expect(appends).toBe(2);
  expect(parser.result()).toHaveLength(2);
});

test('daemon stores the server-provided rollout path for newly created and resumed threads', async () => {
  for (const resume of [false, true]) {
    const session: any = { threadId: resume ? 'thread' : null, threadReady: false,
      connection: { call: async (method: string) => method === 'config/read'
        ? { config: { model: 'gpt-5.6-sol' } }
        : { thread: { id: 'thread', path: '/local/rollout.jsonl' }, model: 'gpt-5.6-sol' } } };
    const manager = new CodexPromptRunManager<any>({} as any);
    await (manager as any).ensureThread(session, {});
    expect(session.rolloutPath).toBe('/local/rollout.jsonl');
  }
});


test('compaction warnings survive a snapshot that contains only ordinary responses', async () => {
  const parser = new AgentUsageAccumulator('codex');
  live().forEach((e) => parser.pushLine(JSON.stringify(e)));
  const tracker = new CodexUsageTracker();
  for (const method of ['thread/compacted', 'item/completed']) {
    tracker.observe({ method, params: { threadId: 'thread', turnId: 'turn', item: { type: 'contextCompaction' } } })
      .forEach((e) => parser.pushLine(JSON.stringify(e)));
  }
  const incomplete = await readCodexRolloutUsage(await file([record('normal', normal, normal)]), 'thread', 'turn');
  parser.pushLine(JSON.stringify(snapshot(incomplete!)));
  expect(parser.result()[0]).toMatchObject({ complete: false, partialReason: 'compaction-unverified' });
  const missing = [record('normal', normal, normal), { type: 'compacted', payload: {
    compaction_response_id: 'compact', latest_token_usage_record: { thread_id: 'thread', turn_id: 'turn' },
  } }];
  expect(await readCodexRolloutUsage(await file(missing), 'thread', 'turn')).toBeNull();
});
