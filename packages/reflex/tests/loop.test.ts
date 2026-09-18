import { expect, test } from 'bun:test';
import { ReflexLoop, ReflexRecorder, replayReflexTrace, runReflexStory, type ReflexAnswers, type ReflexRule, type ReflexTable } from '../src';
import { table } from './rules.test';

const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const answer = (intent: string, p = 0.9, complete = 0.9): ReflexAnswers => ({
  intent: { type: 'choice', choice: intent, probabilities: Object.fromEntries(['request', 'cancel', 'chatter'].map(option => [option, option === intent ? p : (1 - p) / 2])) },
  complete: { type: 'boolean', probability: complete },
  urgency: { type: 'score', score: 0, probabilities: { '0': 1, '1': 0, '2': 0 } },
  'expect:onTopic': { type: 'boolean', probability: 0.9 },
});

function harness(script: ReflexAnswers[] | ((state: string) => Promise<ReflexAnswers>), overrides: Partial<ConstructorParameters<typeof ReflexLoop<string>>[0]> = {}, clearOn = ['send', 'cancel']) {
  let text = '';
  const acted: Array<{ action: string; text: string }> = [];
  const wakes: string[] = [];
  const errors: string[] = [];
  const evaluations: string[] = [];
  const loop = new ReflexLoop<string>({
    table, intervalMs: 0, actions: ['cancel', 'send', 'wait'],
    evaluate: async state => { evaluations.push(state as string); return typeof script === 'function' ? script(state as string) : (script.shift() ?? answer('chatter')); },
    snapshot: () => text ? { state: text, serialized: text, key: text } : null,
    act: (rule: ReflexRule, _answers, snapshot) => { acted.push({ action: rule.do, text: snapshot.state }); if (clearOn.includes(rule.do)) text = ''; },
    onWake: reason => wakes.push(reason),
    onError: message => errors.push(message),
    ...overrides,
  });
  return { loop, acted, wakes, errors, evaluations, speak(delta: string) { text += delta; loop.notify(); }, get text() { return text; } };
}

test('coalesces changes, keeps one evaluation in flight, and acts on the first matching rule', async () => {
  const resolves: Array<(value: ReflexAnswers) => void> = [];
  const h = harness(() => new Promise(resolve => { resolves.push(resolve); }));
  try {
    h.speak('Open settings'); await tick();
    h.speak(' and'); h.speak(' find tasks'); await tick();
    expect(h.evaluations).toEqual(['Open settings']);
    resolves[0](answer('request', 0.9, 0.3)); await tick();
    // Appended text changed the key, so the decision is stale and never acts; the loop re-evaluates the full text.
    expect(h.acted).toEqual([]);
    expect(h.evaluations[1]).toBe('Open settings and find tasks');
    resolves[1](answer('request')); await tick();
    expect(h.acted).toEqual([{ action: 'send', text: 'Open settings and find tasks' }]);
  } finally { h.loop.stop(); }
});

test('custom staleness lets appended text act while rewritten text is re-evaluated', async () => {
  const resolves: Array<(value: ReflexAnswers) => void> = [];
  const h = harness(() => new Promise(resolve => { resolves.push(resolve); }), {
    stillValid: (evaluated, current) => Boolean(current?.state.startsWith(evaluated.state)),
  });
  try {
    h.speak('Delete task'); await tick();
    h.speak(' number two'); resolves[0](answer('request')); await tick();
    expect(h.acted).toEqual([{ action: 'send', text: 'Delete task' }]);
  } finally { h.loop.stop(); }
});

test('errors pause the loop and retry re-evaluates; pause blocks a late decision', async () => {
  let fail = true; let finish!: (value: ReflexAnswers) => void;
  const h = harness(async () => { if (fail) throw new Error('Offline'); return new Promise(resolve => { finish = resolve; }); });
  try {
    h.speak('Open settings'); await tick();
    expect(h.errors).toEqual(['Offline']); expect(h.loop.isPaused).toBe(true);
    fail = false; h.loop.retry(); await tick();
    h.loop.pause(true); finish(answer('request')); await tick();
    expect(h.acted).toEqual([]);
    h.loop.pause(false); await tick(); finish(answer('request')); await tick();
    expect(h.acted).toEqual([{ action: 'send', text: 'Open settings' }]);
  } finally { h.loop.stop(); }
});

test('rules can wake the brain, low confidence wakes after a streak, and cooldown limits wakes', async () => {
  let now = 0;
  // A cancel at 0.6 misses the 0.8 threshold: the fallback waits, but only with 0.4 confidence that cancel should not fire.
  const h = harness([answer('cancel', 0.95), answer('cancel', 0.6), answer('cancel', 0.6), answer('cancel', 0.6), answer('cancel', 0.6), answer('cancel', 0.6), answer('cancel', 0.6)],
    { now: () => now, repollMs: 0 }, ['send']);
  try {
    h.speak('never mind'); await tick();
    expect(h.acted[0].action).toBe('cancel');
    expect(h.wakes).toEqual(['rule:cancel:user cancelled']);
    for (let i = 0; i < 6; i += 1) { now += 300; await new Promise(resolve => setTimeout(resolve, 60)); }
    // Low-confidence ticks: the first streak falls inside the cooldown, the streak keeps growing, and the first tick after the cooldown wakes.
    expect(h.wakes).toEqual(['rule:cancel:user cancelled', 'low-confidence']);
  } finally { h.loop.stop(); }
});

test('expectation violations wake immediately and setTable rejects invalid tables', async () => {
  const h = harness([{ ...answer('request'), 'expect:onTopic': { type: 'boolean', probability: 0.05 } }]);
  try {
    h.speak('Tell me about dinosaurs'); await tick();
    expect(h.wakes).toEqual(['expectation:onTopic']);
    expect(() => h.loop.setTable({ ...table, rules: [] } as ReflexTable)).toThrow(/at least one rule/);
    h.loop.setTable({ ...table, version: 2 });
    expect(h.loop.table.version).toBe(2);
  } finally { h.loop.stop(); }
});

test('stop blocks late actions and a stopped loop never evaluates again', async () => {
  let finish!: (value: ReflexAnswers) => void;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  h.speak('Open settings'); await tick();
  h.loop.stop(); finish(answer('request')); await tick();
  expect(h.acted).toEqual([]);
  h.speak(' please'); await tick();
  expect(h.evaluations).toEqual(['Open settings']);
});

test('the recorder keeps acting ticks and replay reports changed decisions', async () => {
  const recorder = new ReflexRecorder<string>({ maxEntries: 4 });
  const h = harness([answer('request'), answer('chatter'), answer('chatter'), answer('chatter')], { onTick: t => recorder.record(t) });
  try {
    h.speak('Open settings'); await tick();
    h.speak('hmm'); await tick(); h.speak(' more'); await tick(); h.speak(' text'); await tick();
    expect(recorder.entries.filter(t => t.action === 'send')).toHaveLength(1);
    const replay = await replayReflexTrace(recorder.trace(), table, async () => answer('cancel', 0.95));
    expect(replay.ticks).toBe(recorder.entries.length);
    expect(replay.changed.map(c => [c.before, c.after])).toContainEqual(['send', 'cancel']);
    expect(replay.unchanged).toBe(0);
  } finally { h.loop.stop(); }
});

test('stories score expected and forbidden actions inside each step window', async () => {
  const h = harness(state => Promise.resolve(answer(state.includes('cancel') ? 'cancel' : state.endsWith('?') ? 'request' : 'chatter', 0.95)), { repollMs: 0 });
  const listeners = new Set<(t: any) => void>();
  h.loop['options'].onTick = (t: any) => listeners.forEach(l => l(t));
  try {
    const result = await runReflexStory<string>({ name: 'ask then cancel', settleMs: 60, steps: [
      { at: 0, event: 'Could you open settings', forbid: ['send'] },
      { at: 60, event: '?', expect: ['send'] },
      { at: 120, event: 'actually cancel that', expect: ['cancel'], forbid: ['send'] },
      { at: 180, event: ' please', expect: ['send'], label: 'impossible' },
    ] }, { apply: event => h.speak(event), onTick: l => { listeners.add(l); return () => listeners.delete(l); } });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([{ step: 3, label: 'impossible', message: expect.stringContaining('expected send') }]);
    expect(result.actions.map(a => a.action).filter(a => a !== 'wait')).toEqual(['send', 'cancel']);
    expect(result.latencyMs).not.toBeNull();
  } finally { h.loop.stop(); }
});

test('a change can preempt an in-flight evaluation so the new state is evaluated immediately', async () => {
  const seen: string[] = []; const aborted: string[] = [];
  const h = harness((state) => new Promise<ReflexAnswers>((resolve, reject) => { seen.push(state); }), {
    evaluate: (state, _questions, signal) => new Promise<ReflexAnswers>((resolve, reject) => {
      seen.push(state as string);
      signal.addEventListener('abort', () => { aborted.push(state as string); reject(new Error('aborted')); });
      if (state === 'now') setTimeout(() => resolve(answer('request')), 20);
    }),
    preempt: (evaluating, current) => evaluating.state === 'slow' && current.state !== 'slow',
  });
  try {
    h.speak('slow'); await tick();
    expect(seen).toEqual(['slow']);
    h.loop['options'].snapshot = () => ({ state: 'now', serialized: 'now', key: 'now' });
    h.loop.notify(); await new Promise(resolve => setTimeout(resolve, 60));
    expect(aborted).toEqual(['slow']);
    expect(seen).toEqual(['slow', 'now']);
    expect(h.errors).toEqual([]);
    expect(h.acted).toEqual([{ action: 'send', text: 'now' }]);
  } finally { h.loop.stop(); }
});

test('transient failures retry automatically and only pause after the retry budget', async () => {
  let calls = 0;
  const h = harness(async () => { calls += 1; if (calls < 3) throw new Error('timed out'); return answer('request'); }, {
    retryDelayMs: (error, failures) => (/timed out/.test(String((error as Error).message)) && failures < 3 ? 10 : null),
  });
  try {
    h.speak('Open settings'); await new Promise(resolve => setTimeout(resolve, 80));
    expect(calls).toBe(3);
    expect(h.errors).toEqual([]);
    expect(h.acted).toEqual([{ action: 'send', text: 'Open settings' }]);
    expect(h.loop.isPaused).toBe(false);
  } finally { h.loop.stop(); }
  let always = 0;
  const g = harness(async () => { always += 1; throw new Error('timed out'); }, { retryDelayMs: (_error, failures) => (failures < 3 ? 5 : null) });
  try {
    g.speak('Open settings'); await new Promise(resolve => setTimeout(resolve, 80));
    expect(always).toBe(3);
    expect(g.errors).toEqual(['timed out']);
    expect(g.loop.isPaused).toBe(true);
  } finally { g.loop.stop(); }
});
