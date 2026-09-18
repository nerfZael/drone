import { expect, test } from 'bun:test';
import { scaleReflexStory, type ReflexAnswers, type ReflexBrainOutput, type ReflexQuestion } from '@drone/reflex';
import { COMPANION_REFLEX_STORIES, CompanionReflexSession, createCompanionTranscriptHistory, runCompanionStory, type CompanionReflexDecision } from '../src/companion-reflex';

const tick = () => new Promise(resolve => setTimeout(resolve, 10));
type Verdict = 'send' | 'wait' | 'cancel' | 'chatter' | 'away';

/** Scripted answers in the shape Jev returns for the default table. */
export function answersFor(verdict: Verdict, questions: Record<string, ReflexQuestion> = {}): ReflexAnswers {
  const intent = verdict === 'cancel' ? 'cancel' : verdict === 'chatter' || verdict === 'away' ? 'chatter' : 'request';
  const p = verdict === 'chatter' ? 0.9 : 0.95;
  const answers: ReflexAnswers = {
    delegation: { type: 'choice', choice: verdict === 'send' ? 'send' : 'wait', probabilities: verdict === 'send' ? { send: 0.9, wait: 0.1 } : { send: 0.1, wait: 0.9 } },
    intent: { type: 'choice', choice: intent, probabilities: Object.fromEntries(['request', 'greeting', 'correction', 'cancel', 'chatter'].map(option => [option, option === intent ? p : (1 - p) / 4])) },
    addressed: { type: 'boolean', probability: verdict === 'away' ? 0.05 : verdict === 'chatter' ? 0.4 : 0.95 },
  };
  for (const id of Object.keys(questions)) if (!(id in answers)) answers[id] = { type: 'boolean', probability: 0.9 };
  return answers;
}

function harness(verdicts: Verdict[] | ((text: string, silenceMs: number) => Verdict | Promise<Verdict>) = ['wait'], extra: Partial<ConstructorParameters<typeof CompanionReflexSession>[0]> = {}) {
  const sent: string[] = []; const inputs: Array<{ text: string; context: string; silenceMs: number }> = []; const errors: string[] = [];
  const decisions: CompanionReflexDecision[] = []; let cancels = 0;
  const history = createCompanionTranscriptHistory();
  const session = new CompanionReflexSession({
    history, intervalMs: 0, seedInstructions: 'Send clear requests.',
    evaluate: async (state, questions) => {
      const s = state as { unsentTranscript: string; previousDelegatedTranscripts: string; timing: { silenceMs: number } };
      inputs.push({ text: s.unsentTranscript, context: s.previousDelegatedTranscripts, silenceMs: s.timing.silenceMs });
      const verdict = typeof verdicts === 'function' ? await verdicts(s.unsentTranscript, s.timing.silenceMs) : (verdicts.shift() ?? 'wait');
      return answersFor(verdict, questions);
    },
    send: async text => { sent.push(text); },
    cancel: async () => { cancels += 1; },
    onError: error => errors.push(error),
    onDecision: decision => decisions.push(decision),
    ...extra,
  });
  return { session, sent, inputs, errors, decisions, history, get cancels() { return cancels; } };
}

test('wait retains all speech, send advances only the cursor, and earlier transcripts provide context', async () => {
  const h = harness(['wait', 'send', 'send']);
  try {
    h.session.append('Hello. Could you open', '1'); await tick();
    h.session.append(' the settings?', '1'); await tick();
    h.session.append('Now find my active tasks', '2'); await tick();
    expect(h.sent).toEqual(['Hello. Could you open the settings?', 'Now find my active tasks']);
    expect(h.session.transcript.transcript).toBe('Hello. Could you open the settings?\nNow find my active tasks');
    expect(h.inputs[1].text).toBe('Hello. Could you open the settings?');
    expect(h.inputs[2].context).toContain('Hello. Could you open the settings?');
    expect(h.session.pending).toBe('');
    expect(h.decisions.filter(d => d.action === 'send' && d.applied)).toHaveLength(2);
  } finally { h.session.stop(); }
});

test('delegates partial text while speech continues and coalesces updates during an in-flight decision', async () => {
  const resolves: Array<(value: Verdict) => void> = [];
  const h = harness(() => new Promise<Verdict>(resolve => resolves.push(resolve)));
  try {
    h.session.append('Open settings.', '1'); await tick();
    h.session.append(' Then', '1'); h.session.append(' find tasks.', '1'); await tick();
    expect(h.inputs.map(i => i.text)).toEqual(['Open settings.']);
    resolves[0]('send'); await tick();
    expect(h.sent).toEqual(['Open settings.']);
    expect(h.inputs[1].text).toBe(' Then find tasks.');
    resolves[1]('send'); await tick();
    expect(h.sent).toEqual(['Open settings.', ' Then find tasks.']);
  } finally { h.session.stop(); }
});

test('final transcript revisions do not resend submitted text or repeat completion events', async () => {
  const h = harness(['send', 'send']);
  try {
    h.session.append('Open setings.', '1'); await tick();
    h.session.complete('Open settings.', '1'); await tick();
    h.session.complete('Open settings.', '1'); h.session.append('Open settings.', '1'); await tick();
    expect(h.sent).toEqual(['Open setings.']);
    expect(h.session.transcript.transcript).toBe('Open settings.');
    expect(h.session.pending).toBe('');
  } finally { h.session.stop(); }
});

test('changed wording in an evaluated prefix invalidates that decision and is evaluated again', async () => {
  let resolve!: (value: Verdict) => void; let calls = 0;
  const h = harness(async () => (++calls === 1 ? new Promise<Verdict>(r => { resolve = r; }) : 'send'));
  try {
    h.session.append('Delete task', '1'); await tick();
    h.session.complete('Do not delete task', '1'); resolve('send'); await tick();
    expect(h.inputs.map(i => i.text)).toEqual(['Delete task', 'Do not delete task']);
    expect(h.sent).toEqual(['Do not delete task']);
    expect(h.decisions[0].stale).toBe(true);
  } finally { h.session.stop(); }
});

test('failed evaluations preserve all text for explicit retry', async () => {
  let fail = true;
  const h = harness(async () => { if (fail) throw new Error('Offline'); return 'send'; });
  try {
    h.session.append('Open settings', '1'); await tick();
    h.session.append(' please', '1'); await tick();
    expect(h.sent).toEqual([]); expect(h.errors).toEqual(['Offline']);
    fail = false; h.session.retry(); await tick();
    expect(h.sent).toEqual(['Open settings please']);
  } finally { h.session.stop(); }
});

test('stop blocks late delegation and reopening retains both earlier and unsent transcript', async () => {
  let decide!: (v: Verdict) => void;
  const h = harness(() => new Promise<Verdict>(resolve => { decide = resolve; }));
  h.session.append('Open settings', '1'); await tick(); h.session.stop(); decide('send'); await tick();
  expect(h.sent).toEqual([]); expect(h.session.transcript.transcript).toBe('Open settings');
  const next = harness(['send'], { history: h.history });
  try { next.session.append(' please', '2'); await tick(); expect(next.sent).toEqual(['Open settings\n please']); }
  finally { next.session.stop(); }
});

test('stream updates are evaluated with at least 250 ms between starts without waiting for silence', async () => {
  const starts: number[] = [];
  const h = harness(() => { starts.push(Date.now()); return 'wait'; }, { intervalMs: 250 });
  try {
    h.session.append('Please', '1'); await tick();
    expect(starts).toHaveLength(1);
    h.session.append(' open', '1'); await tick(); h.session.append(' settings', '1');
    expect(starts).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 280));
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(245);
  } finally { h.session.stop(); }
});

test('finalization never consumes newly spoken text without whitespace', async () => {
  const h = harness(['send', 'wait']);
  try {
    h.session.append('打开设置', '1'); await tick();
    h.session.complete('打开设置然后查找任务', '1'); await tick();
    expect(h.session.pending).toBe('然后查找任务');
  } finally { h.session.stop(); }
});

test('changing the interval reschedules a pending decision in the active session', async () => {
  const h = harness(() => 'wait', { intervalMs: 10000 });
  try {
    h.session.append('Open', '1'); await tick();
    h.session.append(' settings', '1'); await tick();
    expect(h.inputs.map(i => i.text)).toEqual(['Open']);
    h.session.setIntervalMs(50);
    await new Promise(resolve => setTimeout(resolve, 75));
    expect(h.inputs.map(i => i.text)).toEqual(['Open', 'Open settings']);
  } finally { h.session.stop(); }
});

test('pausing blocks a pending send decision and resume reevaluates the retained transcript', async () => {
  let finish!: (v: Verdict) => void; let calls = 0;
  const h = harness(async () => (++calls === 1 ? new Promise<Verdict>(resolve => { finish = resolve; }) : 'send'));
  try {
    h.session.append('Open settings', '1'); await tick();
    h.session.pause(true); finish('send'); await tick();
    expect(h.sent).toEqual([]); expect(h.session.pending).toBe('Open settings');
    h.session.pause(false); await tick();
    expect(h.sent).toEqual(['Open settings']);
  } finally { h.session.stop(); }
});

test('silence reevaluations replace timing, stop after sending, and annotate only the display', async () => {
  const h = harness((_text, silenceMs) => (silenceMs >= 95 ? 'send' : 'wait'), { intervalMs: 50 });
  try {
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(h.inputs).toHaveLength(0);
    h.session.append('Please open settings.', '1');
    await new Promise(resolve => setTimeout(resolve, 180));
    expect(h.inputs.length).toBeGreaterThanOrEqual(3);
    expect(h.inputs.every(input => input.text === 'Please open settings.')).toBe(true);
    expect(h.sent).toEqual(['Please open settings.']);
    expect(h.session.displayTranscript).toContain('Please open settings.\n[Silence: ');
    expect(h.session.displayTranscript).toContain('[Sent to backend agent]');
    const count = h.inputs.length; const display = h.session.displayTranscript;
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(h.inputs).toHaveLength(count);
    expect(h.session.displayTranscript).toBe(display);
  } finally { h.session.stop(); }
});

test('speech resuming invalidates an in-flight silence decision', async () => {
  let finish!: (v: Verdict) => void; let calls = 0;
  const history = createCompanionTranscriptHistory();
  history.items.push({ id: '1', text: 'Something sensitive', sent: 0, final: false });
  history.lastTranscriptAt = Date.now() - 5000;
  const h = harness(async () => (++calls === 1 ? new Promise<Verdict>(resolve => { finish = resolve; }) : 'wait'), { history, intervalMs: 50 });
  try {
    h.session.retry(); await tick();
    h.session.append(' but wait', '1'); finish('send'); await tick();
    expect(h.sent).toEqual([]);
    expect(h.session.pending).toBe('Something sensitive but wait');
  } finally { h.session.stop(); }
});

test('cancel stops running work and consumes the cancelling speech; chatter is skipped only after silence', async () => {
  const h = harness(['send', 'cancel', 'chatter', 'chatter', 'chatter'], { skipSilenceMs: 60 });
  try {
    h.session.append('Rename the chat to Alpha', '1'); await tick();
    expect(h.sent).toEqual(['Rename the chat to Alpha']);
    h.session.append('never mind cancel that', '2'); await tick();
    expect(h.cancels).toBe(1); expect(h.session.pending).toBe('');
    expect(h.session.displayTranscript).toContain('[Cancelled running work]');
    h.session.append("let's grab lunch at one", '3'); await tick();
    // First chatter decision arrives before the silence threshold: matched but not applied.
    expect(h.decisions.at(-1)).toMatchObject({ action: 'skip', applied: false });
    expect(h.session.pending).toBe("let's grab lunch at one");
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(h.session.pending).toBe('');
    expect(h.session.displayTranscript).toContain('[Skipped: not for the assistant]');
    expect(h.sent).toEqual(['Rename the chat to Alpha']);
  } finally { h.session.stop(); }
});

test('a rule wake asks the brain for a new table and applies it; brain failures are reported without pausing', async () => {
  const compiled: string[] = []; const wakes: string[] = [];
  let failCompile = false;
  const brain = async (input: { base: { version: number } }): Promise<ReflexBrainOutput> => {
    compiled.push(`v${input.base.version}`);
    if (failCompile) throw new Error('Brain offline');
    return { questions: { delegation: { type: 'choice', instructions: 'Send?', criteria: { send: 'yes', wait: 'no' } } },
      rules: [{ id: 'send', when: [{ question: 'delegation', is: 'send' }], do: 'send' }, { id: 'wait', when: [], do: 'wait' }], notes: 'simplified' };
  };
  const h = harness(['cancel', 'send', 'cancel'], { compile: brain, onWake: wake => wakes.push(wake.error ? `error:${wake.error}` : `table:v${wake.table?.version}`) });
  try {
    h.session.append('stop that', '1'); await tick(); await tick();
    expect(compiled).toEqual(['v1']);
    expect(wakes).toEqual(['table:v2']);
    expect(h.session.table.source).toBe('brain');
    expect(Object.keys(h.session.table.questions)).toEqual(['delegation']);
    expect(h.session.insight()).toMatchObject({ decisions: 1, delegations: 0, evaluating: false, compiling: false, paused: false, pending: '', backend: { status: 'idle' },
      lastDecision: { action: 'cancel', applied: true }, wakes: [{ reason: 'rule:cancel:user cancelled work', table: { version: 2 } }] });
    h.session.append('Open settings', '2'); await tick();
    expect(h.sent).toEqual(['Open settings']);
    // The simplified table has no cancel rule, so a cancel verdict now sends; the cooldown also blocks another wake.
    failCompile = true;
    h.session.append('never mind', '3'); await tick(); await tick();
    expect(compiled).toEqual(['v1']);
    expect(h.errors).toEqual([]);
  } finally { h.session.stop(); }
});

test('stories run against a scripted oracle and report per-window outcomes', async () => {
  const oracle = (text: string, silenceMs: number): Verdict => {
    const t = text.toLowerCase();
    if (/never mind|cancel that/.test(t)) return 'cancel';
    if (/lunch|see you/.test(t)) return 'away';
    if (/maybe|not sure|don't do anything/.test(t)) return 'chatter';
    if (/hello|hey|what's up/.test(t)) return silenceMs >= 80 ? 'send' : 'wait';
    if (/help with doing/.test(t)) return silenceMs >= 300 ? 'send' : 'wait';
    if (/设置页面/.test(t)) return 'send';
    if (/settings page|tab|alpha|beta/.test(t) && (t.length > 20 || silenceMs > 300)) return 'send';
    return 'wait';
  };
  const results = [];
  for (const story of COMPANION_REFLEX_STORIES) {
    results.push(await runCompanionStory(scaleReflexStory(story, 0.1), { seedInstructions: 'Send clear requests.', intervalMs: 40, skipSilenceMs: 150,
      evaluate: async (state, questions) => { const s = state as { unsentTranscript: string; timing: { silenceMs: number } }; return answersFor(oracle(s.unsentTranscript, s.timing.silenceMs), questions); } }));
  }
  const failed = results.filter(r => !r.passed).map(r => `${r.name}: ${r.failures.map(f => f.message).join('; ')}`);
  expect(failed).toEqual([]);
  expect(results.find(r => r.name === 'cancel running work')?.cancelled).toBe(1);
  expect(results.find(r => r.name === 'correction after delegation')?.delegated).toHaveLength(2);
}, 20_000);

function autonomousHarness(autonomy: 'observe' | 'act', verdict: (text: string) => Verdict | 'drift' = () => 'wait') {
  const sent: Array<{ text: string; origin: string }> = []; const notes: string[] = []; const decisions: CompanionReflexDecision[] = [];
  let observation: import('../src/companion-reflex').CompanionObservation = { backend: { status: 'idle' } };
  const session = new CompanionReflexSession({
    intervalMs: 0, senseIntervalMs: 20, seedInstructions: 'Send clear requests.', autonomy,
    evaluate: async (state, questions) => {
      const s = state as { unsentTranscript: string };
      const v = verdict(s.unsentTranscript);
      const answers = answersFor(v === 'drift' ? 'wait' : v, questions);
      if (v === 'drift') answers['expect:backendOnTrack'] = { type: 'boolean', probability: 0.05 };
      return answers;
    },
    send: async (text, _signal, origin) => { sent.push({ text, origin }); },
    senses: { observe: () => observation, notify: text => notes.push(text) },
    onDecision: decision => decisions.push(decision),
  });
  return { session, sent, notes, decisions, setBackend(next: typeof observation) { observation = next; } };
}

test('observe mode records a nudge for a stalled backend without sending it; act mode sends it', async () => {
  for (const autonomy of ['observe', 'act'] as const) {
    const h = autonomousHarness(autonomy);
    try {
      expect(h.session.table.facts).toMatchObject({ backendStalled: expect.any(String) });
      h.setBackend({ backend: { status: 'working', startedAt: Date.now() - 70_000, lastActivityAt: Date.now() - 60_000, activity: ['get_app_context'] } });
      await new Promise(resolve => setTimeout(resolve, 80));
      const nudge = h.decisions.find(d => d.action === 'nudge');
      expect(nudge).toBeDefined();
      expect(nudge!.note).toContain('Status check from Companion');
      expect(nudge!.input.transcript).toBe('');
      if (autonomy === 'observe') { expect(nudge).toMatchObject({ applied: false, dryRun: true }); expect(h.sent).toEqual([]); }
      else { expect(nudge).toMatchObject({ applied: true }); expect(h.sent).toEqual([{ text: nudge!.note, origin: 'nudge' }]); }
      expect(h.session.insight().facts).toMatchObject({ backendStalled: true, speechPending: false });
    } finally { h.session.stop(); }
  }
});

test('a drifting backend produces a note only in act mode, and empty speech never sends', async () => {
  const h = autonomousHarness('act', text => (text ? 'send' : 'drift'));
  try {
    h.session.append('Rename the chat to Alpha', '1'); await tick();
    expect(h.sent).toEqual([{ text: 'Rename the chat to Alpha', origin: 'user' }]);
    h.setBackend({ backend: { status: 'working', startedAt: Date.now() - 4_000, lastActivityAt: Date.now() - 1_000, activity: ['delete_chat'] } });
    await new Promise(resolve => setTimeout(resolve, 80));
    const note = h.decisions.find(d => d.action === 'notify');
    expect(note).toMatchObject({ applied: true, note: expect.stringContaining('drifted') });
    expect(h.notes).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  } finally { h.session.stop(); }
});

test('autonomous stories pass against a scripted oracle in act mode', async () => {
  const { COMPANION_AUTONOMOUS_STORIES } = await import('../src/companion-reflex');
  const oracle = (text: string, activity: string[]): Verdict | 'drift' => {
    if (/alpha/i.test(text)) return 'send';
    if (activity.some(a => /delete/.test(a))) return 'drift';
    return text ? 'wait' : 'chatter';
  };
  const results = [];
  for (const story of COMPANION_AUTONOMOUS_STORIES) {
    results.push(await runCompanionStory(scaleReflexStory(story, 0.1), { seedInstructions: 'Send clear requests.', intervalMs: 40, autonomy: 'act',
      evaluate: async (state, questions) => {
        const s = state as { unsentTranscript: string; backend?: { recentActivity?: string[] } };
        const v = oracle(s.unsentTranscript, s.backend?.recentActivity ?? []);
        const answers = answersFor(v === 'drift' ? 'wait' : v, questions);
        if ('expect:backendOnTrack' in questions) answers['expect:backendOnTrack'] = { type: 'boolean', probability: v === 'drift' ? 0.05 : 0.95 };
        return answers;
      } }));
  }
  expect(results.filter(r => !r.passed).map(r => `${r.name}: ${r.failures.map(f => f.message).join('; ')}`)).toEqual([]);
  expect(results[0].nudges).toHaveLength(1);
  expect(results[2].notes).toHaveLength(1);
}, 20_000);
