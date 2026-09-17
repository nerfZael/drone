import { expect, test } from 'bun:test';
import { CompanionJevGate, createJevTranscriptHistory, type JevDecision } from '../src/droneHub/companion/CompanionJevGate';
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

function harness(decisions: JevDecision[] = ['wait']) {
  const sent: string[] = [];
  const inputs: Array<{ text: string; context: string }> = [];
  const errors: string[] = [];
  const history = createJevTranscriptHistory();
  const gate = new CompanionJevGate({ history, intervalMs: 0,
    evaluate: async (text, context) => { inputs.push({ text, context }); return decisions.shift() ?? 'wait'; },
    send: async text => { sent.push(text); }, report() {}, onError: error => errors.push(error),
  });
  return { gate, sent, inputs, errors, history };
}

test('wait retains all speech, send advances only the cursor, and earlier transcripts provide context', async () => {
  const h = harness(['wait', 'send', 'send']);
  try {
    h.gate.append('Hello. Could you open', '1'); await tick();
    h.gate.append(' the settings?', '1'); await tick();
    h.gate.append('Now find my active tasks', '2'); await tick();
    expect(h.sent).toEqual(['Hello. Could you open the settings?', 'Now find my active tasks']);
    expect(h.gate.transcript).toBe('Hello. Could you open the settings?\nNow find my active tasks');
    expect(h.inputs[1].text).toBe('Hello. Could you open the settings?');
    expect(h.inputs[2].context).toContain('Hello. Could you open the settings?');
    expect(h.gate.pending).toBe('');
  } finally { h.gate.stop(); }
});

test('delegates partial text while speech continues and coalesces updates during an in-flight decision', async () => {
  const sent: string[] = [];
  const inputs: string[] = [];
  const resolves: Array<(value: JevDecision) => void> = [];
  const gate = new CompanionJevGate({ intervalMs: 0,
    evaluate: text => { inputs.push(text); return new Promise(resolve => resolves.push(resolve)); },
    send: async text => { sent.push(text); }, report() {},
  });
  try {
    gate.append('Open settings.', '1'); await tick();
    gate.append(' Then', '1'); gate.append(' find tasks.', '1'); await tick();
    expect(inputs).toEqual(['Open settings.']);
    resolves[0]('send'); await tick();
    expect(sent).toEqual(['Open settings.']);
    expect(inputs[1]).toBe(' Then find tasks.');
    resolves[1]('send'); await tick();
    expect(sent).toEqual(['Open settings.', ' Then find tasks.']);
    expect(gate.transcript).toBe('Open settings. Then find tasks.');
  } finally { gate.stop(); }
});

test('final transcript revisions do not resend submitted text or repeat completion events', async () => {
  const h = harness(['send', 'send']);
  try {
    h.gate.append('Open setings.', '1'); await tick();
    h.gate.complete('Open settings.', '1'); await tick();
    h.gate.complete('Open settings.', '1'); h.gate.append('Open settings.', '1'); await tick();
    expect(h.sent).toEqual(['Open setings.']);
    expect(h.gate.transcript).toBe('Open settings.');
    expect(h.gate.pending).toBe('');
  } finally { h.gate.stop(); }
});

test('changed wording in an evaluated prefix invalidates that decision and is evaluated again', async () => {
  let resolve!: (value: JevDecision) => void;
  const sent: string[] = []; const inputs: string[] = [];
  const gate = new CompanionJevGate({ intervalMs: 0,
    evaluate: async text => { inputs.push(text); if (inputs.length === 1) return await new Promise<JevDecision>(r => { resolve = r; }); return 'send'; },
    send: async text => { sent.push(text); }, report() {},
  });
  try {
    gate.append('Delete task', '1'); await tick();
    gate.complete('Do not delete task', '1'); resolve('send'); await tick();
    expect(inputs).toEqual(['Delete task', 'Do not delete task']);
    expect(sent).toEqual(['Do not delete task']);
  } finally { gate.stop(); }
});

test('failed evaluations preserve all text for explicit retry', async () => {
  let fail = true; const sent: string[] = []; const errors: string[] = [];
  const gate = new CompanionJevGate({ intervalMs: 0,
    evaluate: async () => { if (fail) throw new Error('Offline'); return 'send'; },
    send: async text => { sent.push(text); }, report() {}, onError: error => errors.push(error),
  });
  try {
    gate.append('Open settings', '1'); await tick();
    gate.append(' please', '1'); await tick();
    expect(sent).toEqual([]); expect(errors).toEqual(['Offline']);
    fail = false; gate.retry(); await tick();
    expect(sent).toEqual(['Open settings please']);
  } finally { gate.stop(); }
});

test('stop blocks late delegation and reopening retains both earlier and unsent transcript', async () => {
  let decide!: (decision: JevDecision) => void;
  const history = createJevTranscriptHistory(); const sent: string[] = [];
  const gate = new CompanionJevGate({ history, intervalMs: 0,
    evaluate: () => new Promise(resolve => { decide = resolve; }),
    send: async text => { sent.push(text); }, report() {},
  });
  gate.append('Open settings', '1'); await tick(); gate.stop(); decide('send'); await tick();
  expect(sent).toEqual([]); expect(gate.transcript).toBe('Open settings');
  const next = new CompanionJevGate({ history, intervalMs: 0, evaluate: async () => 'send', send: async text => { sent.push(text); }, report() {} });
  try { next.append(' please', '2'); await tick(); expect(sent).toEqual(['Open settings\n please']); }
  finally { next.stop(); }
});


test('stream updates are evaluated with at least 250 ms between starts without waiting for silence', async () => {
  const starts: number[] = [];
  const gate = new CompanionJevGate({ evaluate: async () => { starts.push(Date.now()); return 'wait'; }, send: async () => {}, report() {} });
  try {
    gate.append('Please', '1'); await tick();
    expect(starts).toHaveLength(1);
    gate.append(' open', '1'); await tick(); gate.append(' settings', '1');
    expect(starts).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 280));
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(245);
  } finally { gate.stop(); }
});

test('finalization never consumes newly spoken text without whitespace', async () => {
  const h = harness(['send', 'wait']);
  try {
    h.gate.append('打开设置', '1'); await tick();
    h.gate.complete('打开设置然后查找任务', '1'); await tick();
    expect(h.gate.pending).toBe('然后查找任务');
    expect(h.gate.transcript).toBe('打开设置然后查找任务');
  } finally { h.gate.stop(); }
});


test('changing the interval reschedules a pending decision in the active session', async () => {
  const inputs: string[] = [];
  const gate = new CompanionJevGate({ intervalMs: 10000,
    evaluate: async text => { inputs.push(text); return 'wait'; }, send: async () => {}, report() {} });
  try {
    gate.append('Open', '1'); await tick();
    gate.append(' settings', '1'); await tick();
    expect(inputs).toEqual(['Open']);
    gate.setIntervalMs(50);
    await new Promise(resolve => setTimeout(resolve, 75));
    expect(inputs).toEqual(['Open', 'Open settings']);
  } finally { gate.stop(); }
});


test('pausing blocks a pending send decision and resume reevaluates the retained transcript', async () => {
  let finish!: (value: JevDecision) => void;
  let calls = 0; const sent: string[] = [];
  const gate = new CompanionJevGate({ intervalMs: 0,
    evaluate: async () => { if (++calls === 1) return await new Promise<JevDecision>(resolve => { finish = resolve; }); return 'send'; },
    send: async text => { sent.push(text); }, report() {} });
  try {
    gate.append('Open settings', '1'); await tick();
    gate.pause(true); finish('send'); await tick();
    expect(sent).toEqual([]); expect(gate.pending).toBe('Open settings');
    gate.pause(false); await tick();
    expect(sent).toEqual(['Open settings']);
  } finally { gate.stop(); }
});

test('silence reevaluations replace timing, stop after sending, and annotate only the display', async () => {
  const inputs: Array<{ text: string; silenceMs: number }> = [];
  const sent: string[] = [];
  const gate = new CompanionJevGate({ intervalMs: 50,
    evaluate: async (text, _context, _signal, silenceMs) => {
      inputs.push({ text, silenceMs }); return silenceMs >= 95 ? 'send' : 'wait';
    }, send: async text => { sent.push(text); }, report() {} });
  try {
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(inputs).toHaveLength(0);
    gate.append('Please open settings.', '1');
    await new Promise(resolve => setTimeout(resolve, 180));
    expect(inputs.length).toBeGreaterThanOrEqual(3);
    expect(inputs.every(input => input.text === 'Please open settings.')).toBe(true);
    expect(inputs.at(-1)!.silenceMs).toBeGreaterThanOrEqual(95);
    expect(sent).toEqual(['Please open settings.']);
    expect(gate.transcript).toBe('Please open settings.');
    expect(gate.displayTranscript).toContain(`Please open settings.\n[Silence: ${(inputs.at(-1)!.silenceMs / 1000).toFixed(2)} s]\n[Sent to backend agent]`);
    const displayAtSend = gate.displayTranscript;
    expect(gate.history.delegations).toEqual(sent);
    const count = inputs.length;
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(inputs).toHaveLength(count);
    expect(gate.displayTranscript).toBe(displayAtSend);
  } finally { gate.stop(); }
});

test('new speech resets silence; unchanged finalization does not; pause stops polling', async () => {
  const inputs: number[] = [];
  const gate = new CompanionJevGate({ intervalMs: 50,
    evaluate: async (_text, _context, _signal, silenceMs) => { inputs.push(silenceMs); return 'wait'; },
    send: async () => {}, report() {} });
  try {
    gate.append('A sensitive subject', '1');
    await new Promise(resolve => setTimeout(resolve, 75));
    const before = gate.history.lastTranscriptAt;
    gate.complete('A sensitive subject', '1');
    expect(gate.history.lastTranscriptAt).toBe(before);
    gate.append(' and more', '2');
    expect(gate.silenceMs).toBeLessThan(10);
    gate.pause(true);
    const count = inputs.length;
    await new Promise(resolve => setTimeout(resolve, 110));
    expect(inputs).toHaveLength(count);
    expect(gate.pending).toBe('A sensitive subject\n and more');
  } finally { gate.stop(); }
});

test('speech resuming invalidates an in-flight silence decision', async () => {
  let finish!: (value: JevDecision) => void;
  let calls = 0;
  const sent: string[] = [];
  const history = createJevTranscriptHistory();
  history.items.push({ id: '1', text: 'Something sensitive', sent: 0, final: false });
  history.lastTranscriptAt = Date.now() - 5000;
  const gate = new CompanionJevGate({ history, intervalMs: 50,
    evaluate: async () => { calls++; return calls === 1 ? new Promise(resolve => { finish = resolve; }) : 'wait'; },
    send: async text => { sent.push(text); }, report() {} });
  try {
    gate.retry(); await tick();
    gate.append(' but wait', '1'); finish('send'); await tick();
    expect(sent).toEqual([]);
    expect(gate.pending).toBe('Something sensitive but wait');
  } finally { gate.stop(); }
});
